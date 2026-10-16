// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef } from "react";
import {
  useNotificationRecordReveal,
  type NotificationRecordArrival,
} from "./use-notification-record-reveal";

const first: NotificationRecordArrival = {
  pathname: "/admin/requests",
  hash: "#request-signup-123",
  sequence: 1,
};
const cancel = vi.fn();
const scroll = vi.fn();
function Page({
  ready = true,
  mounted = true,
  arrival = first,
}: {
  ready?: boolean;
  mounted?: boolean;
  arrival?: NotificationRecordArrival | null;
}) {
  useNotificationRecordReveal(arrival, ready, cancel);
  return (
    <main id="admin-content">
      {mounted && <article id="request-signup-123">Exact request</article>}
    </main>
  );
}
beforeEach(() => {
  cancel.mockClear();
  scroll.mockClear();
  window.history.replaceState(null, "", "/admin/requests#request-signup-123");
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.scrollTop = 0;
});

it("keeps the desktop shell fixed while revealing a record within its actual scrollable pane", () => {
  vi.stubGlobal("innerWidth", 1440);
  document.documentElement.scrollTop = 0;
  // Reproduce the measured browser ancestor chain: the native pane clamps at
  // 5132, then all-ancestor centering additionally moves the document by291.
  // JSDOM supplies lifecycle only; these recorded geometry/native clamps are
  // explicit fixtures, not a claim that JSDOM measures browser layout.
  const allAncestors = vi.fn(() => {
    const pane = document.getElementById("admin-content")!;
    pane.scrollTop = 5132;
    document.documentElement.scrollTop = 291;
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: allAncestors,
  });
  function DesktopPage() {
    const paneRef = useRef<HTMLElement>(null);
    const recordRef = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
      const pane = paneRef.current!,
        record = recordRef.current!;
      let top = 0;
      Object.defineProperties(pane, {
        clientHeight: { configurable: true, value: 883 },
        scrollHeight: { configurable: true, value: 6015 },
        scrollTop: {
          configurable: true,
          get: () => top,
          set: (value: number) => {
            top = Math.max(0, Math.min(5132, value));
          },
        },
      });
      vi.spyOn(pane, "getBoundingClientRect").mockImplementation(
        () =>
          new DOMRect(0, 93 - document.documentElement.scrollTop, 1100, 883),
      );
      vi.spyOn(record, "getBoundingClientRect").mockImplementation(
        () =>
          new DOMRect(
            0,
            5762 - top - document.documentElement.scrollTop,
            1000,
            346,
          ),
      );
    }, []);
    useNotificationRecordReveal(first, true, cancel);
    return (
      <>
        <header>Global header</header>
        <main ref={paneRef} id="admin-content" style={{ overflowY: "auto" }}>
          <article ref={recordRef} id="request-signup-123">
            Exact request
          </article>
        </main>
      </>
    );
  }
  render(<DesktopPage />);
  const pane = screen.getByRole("main"),
    record = screen.getByText("Exact request");
  expect(document.documentElement.scrollTop).toBe(0);
  expect(pane.scrollTop).toBe(5132);
  expect(record.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    pane.getBoundingClientRect().top,
  );
  expect(record.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    pane.getBoundingClientRect().bottom,
  );
  expect(document.activeElement).toBe(record);
  expect(allAncestors).not.toHaveBeenCalled();
});

it("retains mobile document-native reveal even with an overflow-auto positive-height pane", () => {
  vi.stubGlobal("innerWidth", 390);
  function MobilePage() {
    const paneRef = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
      Object.defineProperty(paneRef.current!, "clientHeight", {
        configurable: true,
        value: 883,
      });
    }, []);
    useNotificationRecordReveal(first, true, cancel);
    return (
      <main ref={paneRef} id="admin-content" style={{ overflowY: "auto" }}>
        <article id="request-signup-123">Exact request</article>
      </main>
    );
  }
  render(<MobilePage />);
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "center" });
  expect(screen.getByRole("main").scrollTop).toBe(0);
  expect(document.activeElement).toBe(screen.getByText("Exact request"));
});

it("waits for both the authorized read and a later actual DOM mount, then yields to subsequent scrolling", async () => {
  const page = render(<Page ready={false} mounted={false} />);
  expect(scroll).not.toHaveBeenCalled();
  page.rerender(<Page mounted={false} />);
  expect(scroll).not.toHaveBeenCalled();
  // A nested authorized child can mount after the filter owner's commit.
  const target = document.createElement("article");
  target.id = "request-signup-123";
  target.textContent = "Delayed request";
  act(() => {
    screen.getByRole("main").append(target);
  });
  await waitFor(() => expect(document.activeElement).toBe(target));
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "center" });
  expect(target.tabIndex).toBe(-1);
  fireEvent.wheel(window);
  act(() => {
    target.textContent = "Background refresh";
  });
  expect(scroll).toHaveBeenCalledOnce();
  expect(cancel).not.toHaveBeenCalled();
});

it.each(["wheel", "pointerdown", "keydown", "touchstart"])(
  "cancels a pending read on %s rather than stealing later focus",
  (gesture) => {
    const page = render(<Page ready={false} />);
    fireEvent(window, new Event(gesture));
    page.rerender(<Page />);
    expect(scroll).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(screen.getByText("Exact request"));
  },
);

it("abandons an obsolete location and supports a new explicit same-fragment arrival", () => {
  const page = render(<Page ready={false} />);
  act(() => {
    window.history.replaceState(null, "", "/admin");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  page.rerender(<Page />);
  expect(scroll).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
  act(() => {
    window.history.replaceState(null, "", "/admin/requests#request-signup-123");
  });
  page.rerender(<Page arrival={{ ...first, sequence: 2 }} />);
  expect(scroll).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(screen.getByText("Exact request"));
});

it("does not reveal a hidden node and stops observing on access loss", async () => {
  const rect = vi
    .spyOn(Element.prototype, "getClientRects")
    .mockReturnValue({ length: 0 } as DOMRectList);
  const page = render(<Page />);
  expect(scroll).not.toHaveBeenCalled();
  page.rerender(<Page arrival={null} />);
  rect.mockReturnValue({ length: 1 } as DOMRectList);
  act(() => {
    screen.getByText("Exact request").className = "now-visible";
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(scroll).not.toHaveBeenCalled();
});
