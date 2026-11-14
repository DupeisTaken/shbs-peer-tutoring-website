// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceHeaderFrame } from "./workspace-header-frame";

let headerHeight: number;
let boxes: WeakMap<Element, DOMRect>;
let frames: Map<number, FrameRequestCallback>;
let observers: Array<{
  notify: () => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}>;

beforeEach(() => {
  headerHeight = 214;
  boxes = new WeakMap();
  frames = new Map();
  observers = [];
  let nextFrame = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: () => void) {
        observers.push({
          notify: callback,
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return (
        boxes.get(this) ??
        new DOMRect(0, 0, 390, this.tagName === "HEADER" ? headerHeight : 0)
      );
    },
  );
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      return (boxes.has(this)
        ? [boxes.get(this)!]
        : []) as unknown as DOMRectList;
    },
  );
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
  vi.stubGlobal("innerHeight", 812);
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("scroll-padding-top");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushFocus() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  });
}

function fixture() {
  const view = render(
    <div>
      <WorkspaceHeaderFrame>
        <button>Header menu</button>
      </WorkspaceHeaderFrame>
      <main>
        <input type="date" aria-label="Preview date" />
        <select aria-label="Time zone">
          <option>Asia/Shanghai</option>
        </select>
      </main>
    </div>,
  );
  const target = screen.getByLabelText<HTMLInputElement>("Preview date");
  boxes.set(target, new DOMRect(16, 153, 300, 44));
  return {
    view,
    target,
    header: screen.getByRole("banner"),
    main: screen.getByRole("main"),
  };
}

it("updates the native document inset after translated wrapping and viewport resizing without moving focus", () => {
  const { view, target, header } = fixture();
  expect(document.documentElement.style.scrollPaddingTop).toBe("222px");
  expect(observers[0]!.observe).toHaveBeenCalledWith(header);
  headerHeight = 286;
  view.rerender(
    <div>
      <WorkspaceHeaderFrame>更长的工作区标题和语言选项</WorkspaceHeaderFrame>
      <main>
        <input type="date" aria-label="Preview date" />
      </main>
    </div>,
  );
  act(() => observers[0]!.notify());
  expect(document.documentElement.style.scrollPaddingTop).toBe("294px");
  headerHeight = 97;
  window.dispatchEvent(new Event("resize"));
  expect(document.documentElement.style.scrollPaddingTop).toBe("105px");
  expect(window.scrollBy).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(target);
});

it("reveals current focus once when the header grows over it, including native date internal stops", () => {
  const { target } = fixture();
  target.value = "2026-11-14";
  boxes.set(target, new DOMRect(16, 237, 300, 44));
  const focus = vi.spyOn(target, "focus");
  target.focus({ preventScroll: true });
  flushFocus();
  headerHeight = 286;
  act(() => observers[0]!.notify());
  expect(frames.size).toBe(1);
  flushFocus();
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({
    top: -57,
    behavior: "instant",
  });
  act(() => observers[0]!.notify());
  window.dispatchEvent(new Event("resize"));
  expect(frames.size).toBe(0);
  expect(document.activeElement).toBe(target);
  expect(focus).toHaveBeenCalledTimes(1);
  expect(target.value).toBe("2026-11-14");
});

it("yields a queued resize correction when a dialog takes focus", () => {
  const { target, view } = fixture();
  boxes.set(target, new DOMRect(16, 237, 300, 44));
  target.focus({ preventScroll: true });
  flushFocus();
  headerHeight = 286;
  act(() => observers[0]!.notify());
  const dialog = document.createElement("dialog");
  dialog.open = true;
  const child = document.createElement("input");
  dialog.append(child);
  view.container.firstElementChild!.append(dialog);
  boxes.set(child, new DOMRect(16, 153, 300, 44));
  child.focus({ preventScroll: true });
  flushFocus();
  expect(document.activeElement).toBe(child);
  expect(window.scrollBy).not.toHaveBeenCalled();
});

it("unobscures a native date host after focus settles without refocusing or changing its value", () => {
  const { target } = fixture();
  target.value = "2026-11-14";
  const focus = vi.spyOn(target, "focus");
  target.focus({ preventScroll: true });
  expect(window.scrollBy).not.toHaveBeenCalled();
  flushFocus();
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({
    top: -69,
    behavior: "instant",
  });
  expect(document.activeElement).toBe(target);
  expect(focus).toHaveBeenCalledTimes(1);
  expect(target.value).toBe("2026-11-14");
});

it.each(["already visible", "revealed by native scrolling"])(
  "leaves %s focus alone",
  (scenario) => {
    const { target } = fixture();
    if (scenario === "already visible")
      boxes.set(target, new DOMRect(16, 237, 300, 44));
    target.focus({ preventScroll: true });
    boxes.set(target, new DOMRect(16, 237, 300, 44));
    flushFocus();
    expect(window.scrollBy).not.toHaveBeenCalled();
  },
);

it("moves only the overflowing desktop pane and adds no second header inset", () => {
  const { target, main } = fixture();
  main.style.overflowY = "auto";
  const scrollBy = vi.fn(({ top }: ScrollToOptions) => {
    const box = boxes.get(target)!;
    boxes.set(
      target,
      new DOMRect(box.x, box.y - (top ?? 0), box.width, box.height),
    );
  });
  Object.defineProperties(main, {
    clientHeight: { value: 500 },
    scrollHeight: { value: 1800 },
    scrollTop: { value: 500, writable: true },
    scrollBy: { value: scrollBy },
  });
  boxes.set(main, new DOMRect(0, 240, 1100, 500));
  boxes.set(target, new DOMRect(16, 250, 300, 44));
  target.focus({ preventScroll: true });
  flushFocus();
  expect(scrollBy).not.toHaveBeenCalled();
  boxes.set(target, new DOMRect(16, 220, 300, 44));
  target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  flushFocus();
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({
    top: -28,
    behavior: "instant",
  });
  expect(window.scrollBy).not.toHaveBeenCalled();
});

it("reveals a control clipped below its pane with the smallest movement", () => {
  const { target, main } = fixture();
  main.style.overflowY = "auto";
  const scrollBy = vi.fn(({ top }: ScrollToOptions) => {
    const box = boxes.get(target)!;
    boxes.set(
      target,
      new DOMRect(box.x, box.y - (top ?? 0), box.width, box.height),
    );
  });
  Object.defineProperties(main, {
    clientHeight: { value: 500 },
    scrollHeight: { value: 1800 },
    scrollBy: { value: scrollBy },
  });
  boxes.set(main, new DOMRect(0, 240, 1100, 500));
  boxes.set(target, new DOMRect(16, 720, 300, 44));
  target.focus({ preventScroll: true });
  flushFocus();
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({
    top: 32,
    behavior: "instant",
  });
  expect(window.scrollBy).not.toHaveBeenCalled();
});

it("checks outer clipping even when a nested list already contains the focused control", () => {
  const { target, main } = fixture();
  const list = document.createElement("div");
  main.append(list);
  list.append(target);
  main.style.overflowY = list.style.overflowY = "auto";
  const listScroll = vi.fn();
  const outerScroll = vi.fn(({ top }: ScrollToOptions) => {
    for (const element of [target, list]) {
      const box = boxes.get(element)!;
      boxes.set(
        element,
        new DOMRect(box.x, box.y - (top ?? 0), box.width, box.height),
      );
    }
  });
  Object.defineProperties(main, {
    clientHeight: { value: 500 },
    scrollHeight: { value: 1800 },
    scrollBy: { value: outerScroll },
  });
  Object.defineProperties(list, {
    clientHeight: { value: 300 },
    scrollHeight: { value: 900 },
    scrollBy: { value: listScroll },
  });
  boxes.set(main, new DOMRect(0, 240, 1100, 500));
  boxes.set(list, new DOMRect(0, 600, 1000, 300));
  boxes.set(target, new DOMRect(16, 760, 300, 44));
  target.focus({ preventScroll: true });
  flushFocus();
  expect(listScroll).not.toHaveBeenCalled();
  expect(outerScroll).toHaveBeenCalledExactlyOnceWith({
    top: 72,
    behavior: "instant",
  });
  expect(target.getBoundingClientRect().bottom).toBe(732);
  expect(window.scrollBy).not.toHaveBeenCalled();
});

it("reveals the residual occlusion through the document after an inner pane reaches its start", () => {
  const { target, main } = fixture();
  main.style.overflowY = "auto";
  const scrollBy = vi.fn(({ top }: ScrollToOptions) => {
    main.scrollTop += top ?? 0;
    const box = boxes.get(target)!;
    boxes.set(
      target,
      new DOMRect(box.x, box.y - (top ?? 0), box.width, box.height),
    );
  });
  Object.defineProperties(main, {
    clientHeight: { value: 500 },
    scrollHeight: { value: 1800 },
    scrollTop: { value: 20, writable: true },
    scrollBy: { value: scrollBy },
  });
  boxes.set(main, new DOMRect(0, 100, 390, 500));
  target.focus({ preventScroll: true });
  flushFocus();
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({
    top: -20,
    behavior: "instant",
  });
  expect(main.scrollTop).toBe(0);
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({
    top: -49,
    behavior: "instant",
  });
});

it.each(["hidden pane", "pane at its start", "horizontal wrapper"])(
  "lets the document reveal focus in a %s",
  (scenario) => {
    const { target, main } = fixture();
    main.style.overflowY = "auto";
    main.style.overflowX = "auto";
    const scrollBy = vi.fn();
    Object.defineProperties(main, {
      clientHeight: { value: scenario === "hidden pane" ? 90 : 500 },
      scrollHeight: { value: scenario === "horizontal wrapper" ? 500 : 1800 },
      scrollBy: { value: scrollBy },
    });
    boxes.set(
      main,
      new DOMRect(0, 100, 390, scenario === "hidden pane" ? 90 : 500),
    );
    target.focus({ preventScroll: true });
    flushFocus();
    expect(scrollBy).not.toHaveBeenCalled();
    expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith({
      top: -69,
      behavior: "instant",
    });
  },
);

it("preserves a large tabpanel's visible intersection", () => {
  const { main } = fixture();
  main.tabIndex = 0;
  boxes.set(main, new DOMRect(0, 0, 390, 6738));
  main.focus({ preventScroll: true });
  flushFocus();
  expect(document.activeElement).toBe(main);
  expect(window.scrollBy).not.toHaveBeenCalled();
});

it.each(["header", "outside shell", "dialog", "nested dialog"])(
  "leaves %s focus and its scroll ownership alone",
  (scenario) => {
    const { target, header, view } = fixture();
    const container = document.createElement(
      scenario.includes("dialog") ? "dialog" : "div",
    );
    if (scenario === "nested dialog") {
      const outer = document.createElement("dialog");
      view.container.firstElementChild!.append(outer);
      outer.append(container);
    } else if (scenario === "header") header.append(container);
    else if (scenario === "outside shell") document.body.append(container);
    else view.container.firstElementChild!.append(container);
    if (container instanceof HTMLDialogElement) container.open = true;
    container.append(target);
    target.focus({ preventScroll: true });
    flushFocus();
    expect(document.activeElement).toBe(target);
    expect(window.scrollBy).not.toHaveBeenCalled();
    if (scenario === "outside shell") container.remove();
  },
);

it("cancels stale focus frames and ignores disconnected or hidden targets", () => {
  const { target } = fixture();
  const zone = screen.getByLabelText("Time zone");
  boxes.set(zone, new DOMRect(16, 237, 300, 44));
  target.focus({ preventScroll: true });
  zone.focus({ preventScroll: true });
  expect(frames.size).toBe(1);
  flushFocus();
  target.focus({ preventScroll: true });
  target.hidden = true;
  flushFocus();
  target.hidden = false;
  target.style.visibility = "hidden";
  target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  flushFocus();
  target.style.visibility = "visible";
  target.focus({ preventScroll: true });
  target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  target.remove();
  flushFocus();
  expect(window.scrollBy).not.toHaveBeenCalled();
});

it("cleans up pending frames and measurement listeners while restoring the prior inset and priority", () => {
  const addDocument = vi.spyOn(document, "addEventListener");
  const removeDocument = vi.spyOn(document, "removeEventListener");
  const addWindow = vi.spyOn(window, "addEventListener");
  const removeWindow = vi.spyOn(window, "removeEventListener");
  document.documentElement.style.setProperty(
    "scroll-padding-top",
    "3rem",
    "important",
  );
  const { target, view } = fixture();
  target.focus({ preventScroll: true });
  expect(frames.size).toBe(1);
  view.unmount();
  expect(removeDocument).toHaveBeenCalledWith(
    "focusin",
    addDocument.mock.calls.find(([name]) => name === "focusin")![1],
  );
  expect(removeWindow).toHaveBeenCalledWith(
    "resize",
    addWindow.mock.calls.find(([name]) => name === "resize")![1],
  );
  expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1);
  expect(frames.size).toBe(0);
  expect(document.documentElement.style.scrollPaddingTop).toBe("3rem");
  expect(
    document.documentElement.style.getPropertyPriority("scroll-padding-top"),
  ).toBe("important");
  headerHeight = 400;
  window.dispatchEvent(new Event("resize"));
  target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  flushFocus();
  expect(document.documentElement.style.scrollPaddingTop).toBe("3rem");
  expect(window.scrollBy).not.toHaveBeenCalled();
});

it("keeps resize measurement working when ResizeObserver is unavailable", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  fixture();
  headerHeight = 318;
  window.dispatchEvent(new Event("resize"));
  expect(document.documentElement.style.scrollPaddingTop).toBe("326px");
  expect(window.scrollBy).not.toHaveBeenCalled();
});

it("retains the original inset across overlapping replacement headers and StrictMode cleanup", () => {
  document.documentElement.style.scrollPaddingTop = "2rem";
  const first = render(
    <StrictMode>
      <WorkspaceHeaderFrame>First</WorkspaceHeaderFrame>
    </StrictMode>,
  );
  headerHeight = 286;
  const second = render(
    <WorkspaceHeaderFrame>Replacement</WorkspaceHeaderFrame>,
  );
  first.unmount();
  expect(document.documentElement.style.scrollPaddingTop).toBe("294px");
  second.unmount();
  expect(document.documentElement.style.scrollPaddingTop).toBe("2rem");
});

it("does not overwrite a root inset deliberately replaced by another owner", () => {
  const { view } = fixture();
  document.documentElement.style.setProperty(
    "scroll-padding-top",
    "4rem",
    "important",
  );
  view.unmount();
  expect(document.documentElement.style.scrollPaddingTop).toBe("4rem");
  expect(
    document.documentElement.style.getPropertyPriority("scroll-padding-top"),
  ).toBe("important");
});
