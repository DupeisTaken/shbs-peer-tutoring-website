/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";
import {
  clearOtherViewIdentities,
  isViewState,
  readViewState,
  viewStateKey,
  writeViewState,
  viewIdentifier,
  viewSearch,
} from "./session-view-state";
beforeEach(() => window.sessionStorage.clear());
it("accepts bounded presentation scalars but rejects nested records and long bodies", () => {
  expect(isViewState({ tab: "current", page: 2, roles: ["TUTOR"] })).toBe(true);
  expect(isViewState({ record: { secret: "private" } })).toBe(false);
  expect(isViewState("x".repeat(161))).toBe(false);
  expect(isViewState(NaN)).toBe(false);
});

it("keeps live text independent of storage and retains the ID boundary", () => {
  const long = "x".repeat(200);
  expect(viewSearch(long)).toBe(long);
  expect(viewSearch(9)).toBeUndefined();
  expect(viewIdentifier("user-1")).toBe("user-1");
  expect(viewIdentifier(long)).toBeUndefined();
});

it("removes stale saved criteria for an oversized new value without touching unrelated keys", () => {
  const key = viewStateKey("head", "/admin", "filters", "");
  sessionStorage.setItem("unrelated", "keep");
  writeViewState(sessionStorage, key, "old search");
  writeViewState(sessionStorage, key, "x".repeat(200));
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(sessionStorage.getItem("unrelated")).toBe("keep");
  writeViewState(sessionStorage, key, "short again");
  expect(readViewState(sessionStorage, key)).toBe("short again");
});

it.each(["x", "中"])(
  "bounds UTF-8 key plus value for %s route contexts",
  (character) => {
    const raw = JSON.stringify("history");
    const prefix = viewStateKey("head", "/admin", "scroll", "");
    const encoder = new TextEncoder();
    const count = Math.floor(
      (4096 - encoder.encode(prefix + raw).byteLength) /
        encoder.encode(character).byteLength,
    );
    const allowed = viewStateKey(
      "head",
      "/admin",
      "scroll",
      character.repeat(count),
    );
    const oversized = viewStateKey(
      "head",
      "/admin",
      "scroll",
      character.repeat(count + 1),
    );
    writeViewState(sessionStorage, allowed, "history");
    expect(readViewState(sessionStorage, allowed)).toBe("history");
    sessionStorage.setItem(oversized, raw);
    writeViewState(sessionStorage, oversized, "history");
    expect(sessionStorage.getItem(oversized)).toBeNull();
    sessionStorage.setItem(oversized, raw);
    expect(readViewState(sessionStorage, oversized)).toBeUndefined();
    expect(sessionStorage.getItem(oversized)).toBeNull();
    expect(readViewState(sessionStorage, allowed)).toBe("history");
  },
);

it("does not evict other owned entries when a capacity write fails", () => {
  for (let index = 0; index < 100; index++)
    writeViewState(
      sessionStorage,
      viewStateKey("head", "/admin", "view" + index, ""),
      index,
    );
  const saved = { ...sessionStorage };
  const key = viewStateKey("head", "/admin", "new", "");
  const failed = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  try {
    writeViewState(sessionStorage, key, "current");
    expect({ ...sessionStorage }).toEqual(saved);
    expect(sessionStorage.getItem(key)).toBeNull();
  } finally {
    failed.mockRestore();
  }
});

it("removes only the current stale value when an update hits a quota error", () => {
  const key = viewStateKey("head", "/admin", "filters", "");
  writeViewState(sessionStorage, key, "old");
  sessionStorage.setItem("unrelated", "keep");
  const failed = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  try {
    writeViewState(sessionStorage, key, "new");
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem("unrelated")).toBe("keep");
  } finally {
    failed.mockRestore();
  }
});
it("drops malformed storage and partitions identity, route and query context", () => {
  const key = viewStateKey("head", "/admin", "filters-v1", "year-1");
  window.sessionStorage.setItem(key, "{bad");
  expect(readViewState(window.sessionStorage, key)).toBeUndefined();
  writeViewState(window.sessionStorage, key, "history");
  expect(readViewState(window.sessionStorage, key)).toBe("history");
  expect(
    readViewState(
      window.sessionStorage,
      viewStateKey("other", "/admin", "filters-v1", "year-1"),
    ),
  ).toBeUndefined();
  clearOtherViewIdentities(window.sessionStorage, "other");
  expect(window.sessionStorage.getItem(key)).toBeNull();
});
it("bounds entries without deleting unrelated session keys and tolerates blocked storage", () => {
  window.sessionStorage.setItem("unrelated", "keep");
  for (let index = 0; index < 120; index++)
    writeViewState(
      window.sessionStorage,
      viewStateKey("head", "/admin", "view" + index, ""),
      index,
    );
  expect(window.sessionStorage.length).toBe(101);
  expect(window.sessionStorage.getItem("unrelated")).toBe("keep");
  const blocked = {
    getItem: vi.fn(() => {
      throw new Error("blocked");
    }),
    setItem: vi.fn(() => {
      throw new Error("quota");
    }),
  } as unknown as Storage;
  expect(readViewState(blocked, "key")).toBeUndefined();
  expect(() => writeViewState(blocked, "key", "current")).not.toThrow();
});
