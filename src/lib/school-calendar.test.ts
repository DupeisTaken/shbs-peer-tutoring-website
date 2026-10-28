import { describe, expect, it } from "vitest";
import {
  createSchoolCalendarSnapshot,
  resolveSchoolCalendarDay,
  schoolCalendarWrite,
  schoolCalendarReset,
  type SchoolCalendarOverride,
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

describe("operation-scoped school calendar snapshots", () => {
  it("matches direct resolution for defaults, mappings, closures and retained reset revisions", () => {
    const overrides: SchoolCalendarOverride[] = [
      { date: "2026-11-01", isSchoolDay: true, timetableWeekday: 2 },
      { date: "2026-11-02", isSchoolDay: false, version: 4 },
      {
        date: "2026-11-03",
        isSchoolDay: false,
        active: false,
        version: 8,
        scheduleRevision: 3,
      },
      { date: "2026-11-04", isSchoolDay: false, version: 9, scheduleRevision: 0 },
    ];
    const snapshot = createSchoolCalendarSnapshot(overrides);
    for (const date of [
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-07",
    ]) {
      expect(snapshot.resolve(date)).toEqual(
        resolveSchoolCalendarDay(date, overrides),
      );
    }
    expect(snapshot.resolve("2026-11-03")).toMatchObject({
      isSchoolDay: true,
      effectiveTimetableWeekday: 2,
      calendarRevision: 3,
    });
    expect(snapshot.resolve("2026-11-04").calendarRevision).toBe(0);
  });

  it("retains first matching duplicate dates and the exact sorted semantic fingerprint input", () => {
    const overrides: SchoolCalendarOverride[] = [
      { date: "2026-11-04", isSchoolDay: false, scheduleRevision: 7 },
      {
        date: "2026-11-02",
        isSchoolDay: false,
        active: false,
        scheduleRevision: 4,
      },
      { date: "2026-11-01", isSchoolDay: true, timetableWeekday: 1 },
      { date: "2026-11-02", isSchoolDay: false, scheduleRevision: 99 },
    ];
    const snapshot = createSchoolCalendarSnapshot(overrides);
    const expected = overrides
      .map((day) => resolveSchoolCalendarDay(day.date, overrides))
      .sort((a, b) => a.date.localeCompare(b.date));
    expect(JSON.stringify(snapshot.semanticDays())).toBe(
      JSON.stringify(expected),
    );
    expect(snapshot.semanticDays().map((day) => day.date)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-02",
      "2026-11-04",
    ]);
    expect(snapshot.resolve("2026-11-02")).toMatchObject({
      isSchoolDay: true,
      effectiveTimetableWeekday: 1,
      calendarRevision: 4,
    });
    expect(snapshot.semanticDays()).toBe(snapshot.semanticDays());
    expect(Object.isFrozen(snapshot.semanticDays())).toBe(true);
    expect(snapshot.semanticDays().every((day) => Object.isFrozen(day))).toBe(true);
  });

  it("isolates input changes and returned objects between operations", () => {
    const row: SchoolCalendarOverride = {
      date: "2026-11-02",
      isSchoolDay: false,
      scheduleRevision: 2,
    };
    const overrides = [row];
    const first = createSchoolCalendarSnapshot(overrides);
    // Mutate before the first read: the snapshot must own primitive facts already.
    row.isSchoolDay = true;
    row.timetableWeekday = 5;
    row.scheduleRevision = 3;
    overrides.push({ date: "2026-11-03", isSchoolDay: false, version: 4 });
    const second = createSchoolCalendarSnapshot(overrides);
    row.date = "2026-11-04";
    const returned = first.resolve("2026-11-02");
    returned.isSchoolDay = true;
    returned.calendarRevision = 100;
    expect(first.resolve("2026-11-02")).toMatchObject({
      isSchoolDay: false,
      effectiveTimetableWeekday: null,
      calendarRevision: 2,
    });
    expect(first.resolve("2026-11-02")).not.toBe(returned);
    expect(first.semanticDays()).toHaveLength(1);
    expect(first.semanticDays()[0]).toMatchObject({
      date: "2026-11-02",
      isSchoolDay: false,
      calendarRevision: 2,
    });
    expect(second.resolve("2026-11-02")).toMatchObject({
      isSchoolDay: true,
      effectiveTimetableWeekday: 5,
      calendarRevision: 3,
    });
    expect(second.semanticDays()).toHaveLength(2);
    expect(first.resolve("2026-11-03").isSchoolDay).toBe(true);
    expect(second.resolve("2026-11-03").isSchoolDay).toBe(false);
  });

  it.each(["2026-02-30", "2026-2-03", "not-a-date"])(
    "keeps real date validation for indexed and semantic reads: %s",
    (date) => {
      const snapshot = createSchoolCalendarSnapshot([
        { date, isSchoolDay: false },
      ]);
      expect(() => snapshot.resolve(date)).toThrow();
      expect(() => snapshot.resolve(date)).toThrow();
      expect(() => snapshot.semanticDays()).toThrow();
      // As in the direct resolver, an unrelated malformed override is never consulted.
      expect(snapshot.resolve("2026-11-02")).toEqual(
        resolveSchoolCalendarDay("2026-11-02"),
      );
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
