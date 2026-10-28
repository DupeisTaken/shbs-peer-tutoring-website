import { describe, expect, it } from "vitest";
import { createProgramDateTimeParser } from "./program-time";
import {
  oneNegotiationAction,
  plannedWindow,
  planningWeeks,
  responseDeadline,
  resolvePlanningCalendarDay,
} from "./session-planning";

describe("dated planning contracts", () => {
  it("reuses instants without reusing a lesson's location or skipping input validation", () => {
    const parse = createProgramDateTimeParser();
    const input = { date: "2026-11-02", startMin: 900, roomId: "room-a", online: false };
    const first = plannedWindow(input, "Asia/Shanghai", parse);
    first.startsAt.setTime(0);
    const next = plannedWindow({ ...input, roomId: "room-b" }, "Asia/Shanghai", parse);
    expect(next).toEqual(plannedWindow({ ...input, roomId: "room-b" }, "Asia/Shanghai"));
    expect(plannedWindow({ ...input, online: true }, "Asia/Shanghai", parse).roomId).toBeNull();
    expect(() => plannedWindow({ ...input, roomId: "" }, "Asia/Shanghai", parse)).toThrow();
    for (const [date, startMin, zone] of [
      ["2026-03-08", 150, "America/New_York"],
      ["2026-11-01", 90, "America/New_York"],
      ["2026-10-04", 105, "Australia/Lord_Howe"],
    ] as const) {
      for (let attempt = 0; attempt < 2; attempt++)
        expect(() => plannedWindow({ ...input, date, startMin }, zone, parse)).toThrow();
    }
  });
  it("uses shared school defaults and semantic revisions rather than editor note versions", () => {
    expect(resolvePlanningCalendarDay("2026-10-31", []).isSchoolDay).toBe(
      false,
    );
    expect(
      resolvePlanningCalendarDay("2026-10-31", [
        {
          date: "2026-10-31",
          isSchoolDay: true,
          timetableWeekday: 1,
          version: 8,
          scheduleRevision: 2,
        },
      ]),
    ).toEqual({
      date: "2026-10-31",
      isSchoolDay: true,
      effectiveTimetableWeekday: 1,
      calendarRevision: 2,
    });
    expect(
      resolvePlanningCalendarDay("2026-10-31", [
        {
          date: "2026-10-31",
          isSchoolDay: true,
          timetableWeekday: 1,
          active: false,
          version: 9,
          scheduleRevision: 3,
        },
      ]),
    ).toEqual({
      date: "2026-10-31",
      isSchoolDay: false,
      effectiveTimetableWeekday: null,
      calendarRevision: 3,
    });
  });
  it("keeps visible Monday weeks stable while Sunday prepares one further week", () => {
    expect(
      planningWeeks(new Date("2026-11-01T04:00:00Z"), "Asia/Shanghai"),
    ).toEqual({
      today: "2026-11-01",
      start: "2026-10-26",
      end: "2026-11-08",
      prepareEnd: "2026-11-15",
    });
    expect(
      planningWeeks(new Date("2026-11-01T16:00:00Z"), "Asia/Shanghai").start,
    ).toBe("2026-11-02");
  });
  it("enforces 45-minute plans, including the final midnight boundary", () => {
    const window = plannedWindow(
      { date: "2026-11-01", startMin: 1395, online: false },
      "Asia/Shanghai",
    );
    expect(window.endMin).toBe(1440);
    expect(window.endsAt.toISOString()).toBe("2026-11-01T16:00:00.000Z");
    expect(() =>
      plannedWindow(
        { date: "2026-02-30", startMin: 900, online: false },
        "Asia/Shanghai",
      ),
    ).toThrow();
    expect(() =>
      plannedWindow(
        { date: "2026-11-01", startMin: 1396, online: false },
        "Asia/Shanghai",
      ),
    ).toThrow();
  });
  it("never truncates silence acceptance for a short-notice offer", () => {
    const delivered = new Date("2026-11-01T00:00:00Z");
    expect(
      responseDeadline(delivered, new Date("2026-11-02T00:00:00Z")),
    ).toBeNull();
    expect(
      responseDeadline(
        delivered,
        new Date("2026-11-02T00:00:01Z"),
      )?.toISOString(),
    ).toBe("2026-11-02T00:00:00.000Z");
  });
  it("refuses a DST jump with valid endpoints but a non-45-minute elapsed interval", () => {
    expect(() =>
      plannedWindow(
        { date: "2026-10-04", startMin: 105, online: false },
        "Australia/Lord_Howe",
      ),
    ).toThrow();
    expect(() =>
      plannedWindow(
        { date: "2026-10-04", startMin: 180, online: false },
        "Australia/Lord_Howe",
      ),
    ).not.toThrow();
  });
  it("bounds individual negotiation at C without inventing an absence", () => {
    expect(oneNegotiationAction(1, "REJECT")).toBe("COUNTER");
    expect(oneNegotiationAction(2, "REJECT")).toBe("COUNTER");
    expect(oneNegotiationAction(3, "REJECT")).toBe("CANCEL");
    expect(oneNegotiationAction(3, "ACCEPT")).toBe("AGREE");
  });
});
