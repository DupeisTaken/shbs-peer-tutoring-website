// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { focusVisibleContext } from "./focus-visible-context";
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
it.each([
  { top: 150, bottom: 180, scroll: null },
  { top: 70, bottom: 110, scroll: -54 },
  { top: 900, bottom: 1044, scroll: 776 },
])(
  "reveals focus using the measured header for top=$top",
  ({ top, bottom, scroll }) => {
    const header = document.createElement("header");
    header.dataset.stickyHeader = "true";
    const target = document.createElement("textarea");
    document.body.append(header, target);
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
    } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top,
      bottom,
    } as DOMRect);
    const move = vi
      .spyOn(window, "scrollBy")
      .mockImplementation(() => undefined);
    focusVisibleContext(target);
    expect(document.activeElement).toBe(target);
    if (scroll === null) expect(move).not.toHaveBeenCalled();
    else
      expect(move).toHaveBeenCalledWith({ top: scroll, behavior: "instant" });
  },
);

it("scrolls the management content panel instead of its non-scrolling window", () => {
  const panel = document.createElement("main");
  panel.style.overflowY = "auto";
  const target = document.createElement("textarea");
  panel.append(target);
  document.body.append(panel);
  const panelScroll = vi.fn();
  Object.defineProperties(panel, {
    scrollHeight: { value: 1600 },
    clientHeight: { value: 500 },
    scrollBy: { value: panelScroll },
  });
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
    top: 100,
    bottom: 600,
  } as DOMRect);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
    top: 750,
    bottom: 900,
  } as DOMRect);
  const windowScroll = vi
    .spyOn(window, "scrollBy")
    .mockImplementation(() => undefined);
  focusVisibleContext(target);
  expect(document.activeElement).toBe(target);
  expect(panelScroll).toHaveBeenCalledWith({
    top: 626,
    behavior: "instant",
  });
  expect(windowScroll).not.toHaveBeenCalled();
});

it.each([
  { contextTop: 700, scroll: 576 },
  { contextTop: 200, scroll: 776 },
])(
  "includes nearby context when it fits, otherwise prioritizes focus ($contextTop)",
  ({ contextTop, scroll }) => {
    const header = document.createElement("header");
    header.dataset.stickyHeader = "true";
    const context = document.createElement("div");
    const target = document.createElement("textarea");
    context.append(target);
    document.body.append(header, context);
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
    } as DOMRect);
    vi.spyOn(context, "getBoundingClientRect").mockReturnValue({
      top: contextTop,
    } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 900,
      bottom: 1044,
    } as DOMRect);
    const move = vi
      .spyOn(window, "scrollBy")
      .mockImplementation(() => undefined);
    focusVisibleContext(target, context);
    expect(document.activeElement).toBe(target);
    expect(move).toHaveBeenCalledWith({ top: scroll, behavior: "instant" });
  },
);
