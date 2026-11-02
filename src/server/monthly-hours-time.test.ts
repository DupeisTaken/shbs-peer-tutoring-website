import { describe, expect, it } from "vitest";
import {
  firstMonthlyHoursOccurrence,
  localMonth,
  monthlyHoursDueAt,
  shiftMonth,
} from "./monthly-hours-time";
import {
  monthlyHoursMonth,
  monthlyHoursSettingsInput,
} from "./monthly-hours-input";

describe("monthly report calendar", () => {
  it("keeps accounting month arithmetic independent of host zone, year and leap days", () => {
    expect(shiftMonth("2024-01", -1)).toBe("2023-12");
    expect(shiftMonth("2024-02", 1)).toBe("2024-03");
    expect(
      monthlyHoursDueAt("2024-02", 3, "09:00", "Asia/Shanghai").toISOString(),
    ).toBe("2024-03-03T01:00:00.000Z");
    expect(localMonth(new Date("2024-02-29T16:30:00Z"), "Asia/Shanghai")).toBe(
      "2024-03",
    );
  });
  it("activation after the due instant starts with the next future occurrence", () => {
    const config = {
      dayOfMonth: 3,
      localTime: "09:00",
      timeZone: "Asia/Shanghai",
    };
    expect(
      firstMonthlyHoursOccurrence(new Date("2026-11-02T00:00:00Z"), config)
        .month,
    ).toBe("2026-10");
    const next = firstMonthlyHoursOccurrence(
      new Date("2026-11-03T01:00:00Z"),
      config,
    );
    expect(next.month).toBe("2026-11");
    expect(next.dueAt.toISOString()).toBe("2026-12-03T01:00:00.000Z");
  });
  it("waits for the stored UTC accounting month to close in positive-offset zones", () => {
    expect(
      monthlyHoursDueAt("2024-02", 1, "00:00", "Asia/Shanghai").toISOString(),
    ).toBe("2024-03-01T00:00:00.000Z");
    const first = firstMonthlyHoursOccurrence(
      new Date("2024-02-29T16:30:00Z"),
      {
        dayOfMonth: 1,
        localTime: "00:00",
        timeZone: "Asia/Shanghai",
      },
    );
    expect(first.month).toBe("2024-02");
    expect(first.dueAt.toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });
  it("uses the earlier repeated clock and advances nonexistent DST times", () => {
    expect(
      monthlyHoursDueAt(
        "2024-10",
        3,
        "01:30",
        "America/New_York",
      ).toISOString(),
    ).toBe("2024-11-03T05:30:00.000Z");
    expect(
      monthlyHoursDueAt(
        "2024-02",
        10,
        "02:30",
        "America/New_York",
      ).toISOString(),
    ).toBe("2024-03-10T07:00:00.000Z");
  });
  it("rejects impossible calendar months, days and clock inputs", () => {
    for (const month of ["2024-00", "2024-13", "2024-1"])
      expect(monthlyHoursMonth.safeParse(month).success).toBe(false);
    const valid = {
      enabled: false,
      recipientUserIds: [],
      dayOfMonth: 3,
      localTime: "09:00",
      timeZone: "Asia/Shanghai",
      expectedVersion: 0,
    };
    expect(monthlyHoursSettingsInput.safeParse(valid).success).toBe(true);
    for (const bad of [
      { dayOfMonth: 29 },
      { localTime: "24:00" },
      { timeZone: "CST" },
      { recipientUserIds: ["one", "one"] },
    ])
      expect(
        monthlyHoursSettingsInput.safeParse({ ...valid, ...bad }).success,
      ).toBe(false);
  });
});
