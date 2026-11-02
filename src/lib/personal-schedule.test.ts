import { expect, it } from "vitest";
import {
  canExcusePersonalMeeting,
  personalScheduleWindow,
  personalScheduleReadInput,
  personalSchedulePage,
} from "./personal-schedule";

it("uses current and next school weeks and advances only on school-local Monday", () => {
  const sunday = personalScheduleWindow(
    new Date("2026-11-01T15:59:59Z"),
    "Asia/Shanghai",
  );
  expect(sunday.window).toEqual({
    start: "2026-10-26",
    end: "2026-11-08",
    timeZone: "Asia/Shanghai",
  });
  expect(sunday.startsAt.toISOString()).toBe("2026-10-25T16:00:00.000Z");
  expect(sunday.endsBefore.toISOString()).toBe("2026-11-08T16:00:00.000Z");
  expect(
    personalScheduleWindow(new Date("2026-11-01T16:00:00Z"), "Asia/Shanghai")
      .window.start,
  ).toBe("2026-11-02");
});

it("defaults old callers to Upcoming and bounds both independent page inputs", () => {
  expect(personalScheduleReadInput.parse(undefined)).toEqual({
    view: "upcoming",
    limit: 20,
    includeSummary: true,
  });
  expect(
    personalScheduleReadInput.parse({
      view: "history",
      limit: 50,
      cursor: { at: new Date("2026-10-01"), id: "record" },
    }).view,
  ).toBe("history");
  for (const input of [
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { view: "unknown" },
    { cursor: { at: "2026-10-01", id: "record" } },
    { taskCursor: { at: new Date(), id: "" } },
  ]) {
    expect(personalScheduleReadInput.safeParse(input).success).toBe(false);
  }
});

it("reports continuation explicitly and preserves timestamp/ID ties without inventing event times", () => {
  const at = new Date("2026-10-01");
  const rows = ["a", "b", "c"].map((id) => ({ id, at }));
  const cursorOf = (row: (typeof rows)[number]) => ({ at: row.at, id: row.id });
  expect(personalSchedulePage(rows, 2, cursorOf)).toEqual({
    items: rows.slice(0, 2),
    pageInfo: { hasMore: true, nextCursor: { at, id: "b" } },
  });
  expect(personalSchedulePage(rows.slice(2), 2, cursorOf)).toEqual({
    items: rows.slice(2),
    pageInfo: { hasMore: false, nextCursor: null },
  });
  expect(personalSchedulePage([], 2, cursorOf).pageInfo).toEqual({
    hasMore: false,
    nextCursor: null,
  });
});

it("uses local midnight across DST instead of a fixed elapsed fourteen days", () => {
  const result = personalScheduleWindow(
    new Date("2026-11-01T12:00:00Z"),
    "America/New_York",
  );
  expect(result.startsAt.toISOString()).toBe("2026-10-26T04:00:00.000Z");
  expect(result.endsBefore.toISOString()).toBe("2026-11-09T05:00:00.000Z");
});

it("preserves the inclusive sixty-minute meeting cutoff", () => {
  const date = new Date("2026-10-28T10:00:00Z");
  expect(canExcusePersonalMeeting(date, new Date("2026-10-28T09:00:00Z"))).toBe(
    true,
  );
  expect(
    canExcusePersonalMeeting(date, new Date("2026-10-28T09:00:00.001Z")),
  ).toBe(false);
});
