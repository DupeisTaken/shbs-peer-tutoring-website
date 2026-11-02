import { describe, expect, it } from "vitest";
import {
  nextSchoolHoursOccurrence,
  schoolHoursDueAt,
  shiftMonth,
} from "./school-hours-time";

describe("school reporting occurrence calendar", () => {
  it("uses the last day at local noon, including leap February and year rollover", () => {
    expect(schoolHoursDueAt("2026-10", "Asia/Shanghai").toISOString()).toBe(
      "2026-10-31T04:00:00.000Z",
    );
    expect(schoolHoursDueAt("2024-02", "Asia/Shanghai").toISOString()).toBe(
      "2024-02-29T04:00:00.000Z",
    );
    expect(schoolHoursDueAt("2025-02", "Asia/Shanghai").toISOString()).toBe(
      "2025-02-28T04:00:00.000Z",
    );
    expect(schoolHoursDueAt("2026-04", "Asia/Shanghai").toISOString()).toBe(
      "2026-04-30T04:00:00.000Z",
    );
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
  it("keeps each override within its labelled month and leaves other occurrences unchanged", () => {
    const overrides = { "2026-10": "2026-10-29T12:00" };
    expect(
      schoolHoursDueAt("2026-10", "Asia/Shanghai", overrides).toISOString(),
    ).toBe("2026-10-29T04:00:00.000Z");
    expect(
      schoolHoursDueAt("2026-11", "Asia/Shanghai", overrides).toISOString(),
    ).toBe("2026-11-30T04:00:00.000Z");
    expect(() =>
      schoolHoursDueAt("2026-10", "Asia/Shanghai", {
        "2026-10": "2026-11-02T12:00",
      }),
    ).toThrow("Choose a send date within the report month.");
    expect(() =>
      schoolHoursDueAt("2026-11", "Asia/Shanghai", {
        "2026-11": "2026-10-29T12:00",
      }),
    ).toThrow("Choose a send date within the report month.");
  });
  it("does not add a closed-month delay or skip afternoon submissions into the current edition", () => {
    const before = nextSchoolHoursOccurrence(new Date("2026-10-31T03:59:00Z"), {
      timeZone: "Asia/Shanghai",
    });
    expect(before.month).toBe("2026-10");
    const after = nextSchoolHoursOccurrence(new Date("2026-10-31T04:00:00Z"), {
      timeZone: "Asia/Shanghai",
    });
    expect(after.month).toBe("2026-11");
    expect(after.dueAt.toISOString()).toBe("2026-11-30T04:00:00.000Z");
  });
  it("uses program timezone and deterministic DST gap/overlap handling", () => {
    expect(schoolHoursDueAt("2026-10", "America/New_York").toISOString()).toBe(
      "2026-10-31T16:00:00.000Z",
    );
    expect(
      schoolHoursDueAt("2024-03", "America/New_York", {
        "2024-03": "2024-03-10T02:30",
      }).toISOString(),
    ).toBe("2024-03-10T07:00:00.000Z");
    expect(
      schoolHoursDueAt("2024-11", "America/New_York", {
        "2024-11": "2024-11-03T01:30",
      }).toISOString(),
    ).toBe("2024-11-03T05:30:00.000Z");
  });
  it("rejects invalid months and normalized impossible override dates", () => {
    expect(() => schoolHoursDueAt("2026-13", "Asia/Shanghai")).toThrow();
    expect(() =>
      schoolHoursDueAt("2026-02", "Asia/Shanghai", {
        "2026-02": "2026-02-30T12:00",
      }),
    ).toThrow();
    expect(() => schoolHoursDueAt("2026-02", "CST")).toThrow();
  });
});
