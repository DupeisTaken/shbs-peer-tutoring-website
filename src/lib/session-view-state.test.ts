/** @vitest-environment jsdom */
import { beforeEach, expect, it, vi } from "vitest";
import {
  clearOtherViewIdentities,
  isViewState,
  readViewState,
  viewStateKey,
  writeViewState,
} from "./session-view-state";
beforeEach(() => window.sessionStorage.clear());
it("accepts bounded presentation scalars but rejects nested records and long bodies", () => {
  expect(isViewState({ tab: "current", page: 2, roles: ["TUTOR"] })).toBe(true);
  expect(isViewState({ record: { secret: "private" } })).toBe(false);
  expect(isViewState("x".repeat(161))).toBe(false);
  expect(isViewState(NaN)).toBe(false);
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
