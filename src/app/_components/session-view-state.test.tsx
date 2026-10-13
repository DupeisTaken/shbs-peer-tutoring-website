/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  SessionViewProvider,
  useSessionViewState,
  useSessionPageScroll,
  useSessionAccessDenied,
} from "./session-view-state";
import {
  viewEnum,
  viewFields,
  viewPage,
  viewStateKey,
  writeViewState,
} from "~/lib/session-view-state";

const parse = viewEnum(["current", "history"]);
function Probe({
  scope = "period-1",
  enabled = true,
}: {
  scope?: string;
  enabled?: boolean;
}) {
  const [tab, setTab] = useSessionViewState({
    id: "roster-v1",
    scope,
    enabled,
    initialState: "current",
    parse,
  });
  return (
    <>
      <p>{tab}</p>
      <button onClick={() => setTab("history")}>History</button>
      <input aria-label="Private draft" defaultValue="" />
    </>
  );
}
function view(
  identity = "head",
  scope = "period-1",
  enabled = true,
  verified = true,
) {
  return (
    <SessionViewProvider
      identity={identity}
      pathname="/admin/tutees"
      verified={verified}
    >
      <Probe scope={scope} enabled={enabled} />
    </SessionViewProvider>
  );
}
beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

it("normalizes a feature field allowlist in storage instead of reviving removed choices later", () => {
  const key = viewStateKey("head", "/admin/tutees", "fields-v1", "");
  writeViewState(window.sessionStorage, key, { tab: "current", page: 2, unknownPrivateDraft: "private" });
  function Fields() {
    const [state] = useSessionViewState({ id: "fields-v1", initialState: { tab: "current", page: 0 }, parse: viewFields({ tab: parse, page: viewPage }) });
    return <p>{state.tab}:{state.page}</p>;
  }
  render(<SessionViewProvider identity="head" pathname="/admin/tutees" verified><Fields /></SessionViewProvider>);
  expect(screen.getByText("current:2")).toBeTruthy();
  expect(JSON.parse(window.sessionStorage.getItem(key)!)).toEqual({ tab: "current", page: 2 });
});

it("holds an authoritative query denial through transport failures until a fresh successful read", () => {
  function Denial({ code, success = false }: { code?: string; success?: boolean }) {
    const denied = useSessionAccessDenied({ error: code ? { data: { code } } : null, isSuccess: success, isFetching: false });
    return <p>{denied ? "denied" : "authorized"}</p>;
  }
  const panel = render(<Denial success />);
  panel.rerender(<Denial code="FORBIDDEN" />);
  expect(screen.getByText("denied")).toBeTruthy();
  panel.rerender(<Denial code="INTERNAL_SERVER_ERROR" />);
  expect(screen.getByText("denied")).toBeTruthy();
  panel.rerender(<Denial success />);
  expect(screen.getByText("authorized")).toBeTruthy();
});

it("restores an explicit tab across remounts without saving a private form draft", () => {
  const first = render(view());
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Private unsaved text" },
  });
  first.unmount();
  render(view());
  expect(screen.getByText("history")).toBeTruthy();
  expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("");
  expect(JSON.stringify(window.sessionStorage)).not.toContain(
    "Private unsaved text",
  );
});
it("partitions identity, role and query/period context and clears denied selection", () => {
  const first = render(view());
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  first.rerender(view("head", "period-2"));
  expect(screen.getByText("current")).toBeTruthy();
  first.rerender(view("head", "period-1"));
  expect(screen.getByText("history")).toBeTruthy();
  first.rerender(view("head", "period-1", false));
  expect(screen.getByText("current")).toBeTruthy();
  first.rerender(view("head", "period-1"));
  expect(screen.getByText("current")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  first.rerender(view("head-as-coordinator"));
  expect(screen.getByText("current")).toBeTruthy();
});
it("waits for identity verification and rejects removed choices", () => {
  const key = viewStateKey("head", "/admin/tutees", "roster-v1", "period-1");
  writeViewState(window.sessionStorage, key, "history");
  const first = render(view("head", "period-1", true, false));
  expect(screen.getByText("current")).toBeTruthy();
  first.rerender(view());
  expect(screen.getByText("history")).toBeTruthy();
  first.unmount();
  writeViewState(window.sessionStorage, key, "removed-tab");
  render(view());
  expect(screen.getByText("current")).toBeTruthy();
});

it("drops a formerly allowed selection immediately when its current choices change", () => {
  function Dynamic({ historyAllowed }: { historyAllowed: boolean }) {
    const [tab, setTab] = useSessionViewState({
      id: "dynamic",
      initialState: "current",
      parse: viewEnum(historyAllowed ? ["current", "history"] : ["current"]),
    });
    return (
      <>
        <p>{tab}</p>
        <button onClick={() => setTab("history")}>History</button>
      </>
    );
  }
  const wrap = (allowed: boolean) => (
    <SessionViewProvider identity="head" pathname="/admin/tutees" verified>
      <Dynamic historyAllowed={allowed} />
    </SessionViewProvider>
  );
  const rendered = render(wrap(true));
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  rendered.rerender(wrap(false));
  expect(screen.getByText("current")).toBeTruthy();
  expect(
    window.sessionStorage.getItem(
      viewStateKey("head", "/admin/tutees", "dynamic", ""),
    ),
  ).toBeNull();
});

it("preserves stored room IDs while dynamic options load, then validates the current catalog", () => {
  function Rooms({ ready, ids }: { ready: boolean; ids: string[] }) {
    const [selected] = useSessionViewState({
      id: "room-selection-v1",
      initialState: [] as string[],
      restoreReady: ready,
      parse: (value) =>
        Array.isArray(value) &&
        value.every((id) => typeof id === "string" && ids.includes(id))
          ? (value as string[])
          : undefined,
    });
    return <p>{selected.join(",") || "all rooms"}</p>;
  }
  const key = viewStateKey("head", "/admin/tutees", "room-selection-v1", "");
  writeViewState(window.sessionStorage, key, ["A101"]);
  const view = (ready: boolean, ids: string[]) => (
    <SessionViewProvider identity="head" pathname="/admin/tutees" verified>
      <Rooms ready={ready} ids={ids} />
    </SessionViewProvider>
  );
  const rendered = render(view(false, []));
  expect(screen.getByText("all rooms")).toBeTruthy();
  expect(window.sessionStorage.getItem(key)).toBe('["A101"]');
  rendered.rerender(view(true, ["A101", "A102"]));
  expect(screen.getByText("A101")).toBeTruthy();
  rendered.rerender(view(true, ["A102"]));
  expect(screen.getByText("all rooms")).toBeTruthy();
  expect(window.sessionStorage.getItem(key)).toBeNull();
});

function ScrollProbe({
  ready = true,
  enabled = true,
}: {
  ready?: boolean;
  enabled?: boolean;
}) {
  useSessionPageScroll({ id: "page-v1", scope: "current", ready, enabled });
  return null;
}
function scrollView(ready = true, enabled = true) {
  return (
    <SessionViewProvider identity="head" pathname="/admin/tutees" verified>
      <ScrollProbe ready={ready} enabled={enabled} />
    </SessionViewProvider>
  );
}
function scrollFixture(width = 1440, contentHeight = 2200) {
  vi.useFakeTimers();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 600,
  });
  Object.defineProperty(document, "scrollingElement", {
    configurable: true,
    value: document.documentElement,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    get: () => contentHeight,
  });
  document.documentElement.scrollTop = 0;
  const pane = document.createElement("main");
  pane.id = "admin-content";
  const content = document.createElement("section");
  pane.append(content);
  document.body.append(pane);
  let height = contentHeight;
  Object.defineProperty(pane, "clientHeight", {
    configurable: true,
    value: 500,
  });
  Object.defineProperty(pane, "scrollHeight", {
    configurable: true,
    get: () => height,
  });
  const frames = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = next++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const callbacks: (() => void)[] = [];
  const observed: Element[] = [];
  let disconnected = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe(element: Element) {
        observed.push(element);
      }
      disconnect() { disconnected++; }
    },
  );
  return {
    pane,
    content,
    observed,
    disconnected: () => disconnected,
    pendingFrames: () => frames.size,
    setHeight: (value: number) => {
      height = value;
    },
    resizeContent: () => act(() => callbacks.forEach((callback) => callback())),
    frames: () =>
      act(() => {
        for (let pass = 0; pass < 2; pass++) {
          const pending = [...frames.values()];
          frames.clear();
          pending.forEach((callback) => callback(0));
        }
      }),
    remove: () => pane.remove(),
  };
}
const scrollKey = (size: "desktop" | "mobile") =>
  viewStateKey("head", "/admin/tutees", "scroll:page-v1", "current:" + size);

it("restores the management pane independently of document, tables and dialogs", () => {
  const fixture = scrollFixture();
  writeViewState(window.sessionStorage, scrollKey("desktop"), 700);
  const rendered = render(scrollView());
  fixture.frames();
  expect(fixture.pane.scrollTop).toBe(700);
  expect(document.documentElement.scrollTop).toBe(0);
  expect(fixture.observed).toContain(fixture.content);
  rendered.unmount();
  fixture.remove();
});
it("waits for page readiness and retries fixed-pane content height after an asynchronous load", () => {
  const fixture = scrollFixture(1440, 550);
  writeViewState(window.sessionStorage, scrollKey("desktop"), 900);
  const rendered = render(scrollView(false));
  fixture.frames();
  expect(fixture.pane.scrollTop).toBe(0);
  rendered.rerender(scrollView());
  fixture.frames();
  expect(fixture.pane.scrollTop).toBe(50);
  fixture.setHeight(1900);
  fixture.resizeContent();
  expect(fixture.pane.scrollTop).toBe(900);
  rendered.unmount();
  fixture.remove();
});
it("corrects a late framework reset after first fit without saving zero, then lets user intent win", () => {
  const fixture = scrollFixture();
  writeViewState(window.sessionStorage, scrollKey("desktop"), 700);
  const rendered = render(scrollView());
  fixture.frames();
  fixture.pane.scrollTop = 0;
  fireEvent.scroll(fixture.pane);
  expect(window.sessionStorage.getItem(scrollKey("desktop"))).toBe("700");
  fixture.frames();
  expect(fixture.pane.scrollTop).toBe(700);
  // The correction's own event schedules no further frame.
  fireEvent.scroll(fixture.pane);
  expect(fixture.pendingFrames()).toBe(0);
  fireEvent.wheel(window);
  fixture.pane.scrollTop = 540;
  fireEvent.scroll(fixture.pane);
  fixture.frames();
  fixture.resizeContent();
  expect(fixture.pane.scrollTop).toBe(540);
  expect(window.sessionStorage.getItem(scrollKey("desktop"))).toBe("540");
  rendered.unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(fixture.pendingFrames()).toBe(0);
  expect(fixture.disconnected()).toBeGreaterThan(0);
  fixture.remove();
});
it("flushes the last valid restored position when exit precedes a late-reset correction and tears recovery down", () => {
  const fixture = scrollFixture();
  writeViewState(window.sessionStorage, scrollKey("desktop"), 700);
  const rendered = render(scrollView());
  fixture.frames();
  fixture.pane.scrollTop = 0;
  fireEvent.scroll(fixture.pane);
  rendered.unmount();
  expect(window.sessionStorage.getItem(scrollKey("desktop"))).toBe("700");
  expect(vi.getTimerCount()).toBe(0);
  expect(fixture.pendingFrames()).toBe(0);
  fixture.resizeContent();
  fixture.frames();
  expect(fixture.pane.scrollTop).toBe(0);
  expect(fixture.disconnected()).toBeGreaterThan(0);
  fixture.remove();
});
it.each(["hash", "wheel", "keyboard"])(
  "lets %s navigation or user intent win over recovery",
  (kind) => {
    const fixture = scrollFixture();
    writeViewState(window.sessionStorage, scrollKey("desktop"), 700);
    if (kind === "hash") window.history.replaceState(null, "", "#attendance");
    const rendered = render(scrollView());
    if (kind === "wheel") fireEvent.wheel(window);
    if (kind === "keyboard") fireEvent.keyDown(window, { key: "PageDown" });
    fixture.frames();
    fixture.resizeContent();
    expect(fixture.pane.scrollTop).toBe(0);
    rendered.unmount();
    fixture.remove();
  },
);
it("flushes the final measured position when a route exits before the scheduled frame", () => {
  const fixture = scrollFixture();
  const rendered = render(scrollView());
  fixture.pane.scrollTop = 509;
  fireEvent.scroll(fixture.pane);
  rendered.unmount();
  expect(window.sessionStorage.getItem(scrollKey("desktop"))).toBe("509");
  fixture.remove();
});
it("changes from the fixed desktop pane to document scroll at the responsive breakpoint", () => {
  const fixture = scrollFixture();
  writeViewState(window.sessionStorage, scrollKey("desktop"), 300);
  writeViewState(window.sessionStorage, scrollKey("mobile"), 80);
  const rendered = render(scrollView());
  fixture.frames();
  expect(fixture.pane.scrollTop).toBe(300);
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 390,
  });
  fireEvent(window, new Event("resize"));
  fixture.frames();
  expect(document.documentElement.scrollTop).toBe(80);
  fireEvent.wheel(window);
  document.documentElement.scrollTop = 120;
  fireEvent.scroll(window);
  rendered.unmount();
  expect(window.sessionStorage.getItem(scrollKey("mobile"))).toBe("120");
  expect(fixture.pane.scrollTop).toBe(300);
  fixture.remove();
});
