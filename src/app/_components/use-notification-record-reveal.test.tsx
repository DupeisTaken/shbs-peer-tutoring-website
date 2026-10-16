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
