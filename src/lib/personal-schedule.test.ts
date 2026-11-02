import { expect, it } from "vitest";
import {
  canExcusePersonalMeeting,
  personalScheduleWindow,
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
