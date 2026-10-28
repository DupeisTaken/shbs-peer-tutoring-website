import { describe, expect, it } from "vitest";
import {
  resolveSchoolCalendarDay,
  schoolCalendarWrite,
  schoolCalendarReset,
} from "./school-calendar";

describe("school calendar facts", () => {
  it("defaults to school weekdays and closed weekends, independently of machine timezone", () => {
    expect(resolveSchoolCalendarDay("2026-11-02")).toEqual({
      date: "2026-11-02",
      isSchoolDay: true,
      effectiveTimetableWeekday: 1,
      calendarRevision: 0,
    });
    expect(resolveSchoolCalendarDay("2026-11-01")).toEqual({
      date: "2026-11-01",
      isSchoolDay: false,
      effectiveTimetableWeekday: null,
      calendarRevision: 0,
    });
  });

  it("maps an open Sunday to Monday without replacing the actual date", () => {
    expect(
      resolveSchoolCalendarDay("2026-11-01", [
        {
          date: "2026-11-01",
          isSchoolDay: true,
          timetableWeekday: 1,
          active: true,
          version: 3,
        },
      ]),
    ).toEqual({
      date: "2026-11-01",
      isSchoolDay: true,
      effectiveTimetableWeekday: 1,
      calendarRevision: 3,
    });
  });

  it("keeps unmapped legacy make-up days on their civil weekday and ignores other dates", () => {
    expect(
      resolveSchoolCalendarDay("2026-11-01", [
        { date: "2026-11-01", isSchoolDay: true },
        { date: "2026-11-02", isSchoolDay: false },
      ]),
    ).toMatchObject({
      isSchoolDay: true,
      effectiveTimetableWeekday: 7,
      calendarRevision: 0,
    });
  });

  it("uses stable semantic revision instead of a later note-only editor version", () => {
    expect(
      resolveSchoolCalendarDay("2026-11-01", [
        {
          date: "2026-11-01",
          isSchoolDay: true,
          timetableWeekday: 1,
          version: 8,
          scheduleRevision: 3,
        },
      ]),
    ).toMatchObject({ calendarRevision: 3 });
  });

  it("suppresses recurring timetables on closed dates and restores defaults through tombstones", () => {
    expect(
      resolveSchoolCalendarDay("2026-11-02", [
        {
          date: "2026-11-02",
          isSchoolDay: false,
          version: 2,
        },
      ]),
    ).toMatchObject({
      isSchoolDay: false,
      effectiveTimetableWeekday: null,
      calendarRevision: 2,
    });
    expect(
      resolveSchoolCalendarDay("2026-11-02", [
        {
          date: "2026-11-02",
          isSchoolDay: false,
          active: false,
          version: 3,
        },
      ]),
    ).toMatchObject({
      isSchoolDay: true,
      effectiveTimetableWeekday: 1,
      calendarRevision: 3,
    });
  });

  it.each(["2026-02-30", "2026-2-03", "not-a-date"])(
    "rejects invalid date labels: %s",
    (date) => {
      expect(() => resolveSchoolCalendarDay(date)).toThrow();
      expect(
        schoolCalendarWrite.safeParse({
          date,
          isSchoolDay: true,
          note: "",
          expectedVersion: 0,
        }).success,
      ).toBe(false);
    },
  );
});

describe("school calendar writes", () => {
  const input = {
    date: "2026-11-01",
    isSchoolDay: true,
    note: "  Make-up school day  ",
    expectedVersion: 0,
  };
  it("accepts ISO weekdays and normalizes missing mappings without weakening edit versions", () => {
    expect(schoolCalendarWrite.parse(input)).toMatchObject({
      note: "Make-up school day",
      timetableWeekday: null,
      expectedVersion: 0,
    });
    expect(
      schoolCalendarWrite.parse({ ...input, expectedVersion: undefined }),
    ).toMatchObject({ expectedVersion: 0 });
    for (const timetableWeekday of [1, 7])
      expect(
        schoolCalendarWrite.safeParse({ ...input, timetableWeekday }).success,
      ).toBe(true);
  });
  it.each([0, 8, 1.5, "1"])(
    "rejects an invalid mapped weekday: %s",
    (timetableWeekday) => {
      expect(
        schoolCalendarWrite.safeParse({ ...input, timetableWeekday }).success,
      ).toBe(false);
    },
  );
  it("rejects contradictory closure/mapping and unversioned resets", () => {
    expect(
      schoolCalendarWrite.safeParse({
        ...input,
        isSchoolDay: false,
        timetableWeekday: 1,
      }).success,
    ).toBe(false);
    expect(schoolCalendarReset.safeParse({ date: input.date }).success).toBe(
      false,
    );
    expect(
      schoolCalendarReset.safeParse({ date: input.date, expectedVersion: 0 })
        .success,
    ).toBe(false);
    expect(
      schoolCalendarReset.parse({ date: input.date, expectedVersion: 2 }),
    ).toMatchObject({ expectedVersion: 2 });
  });
});
