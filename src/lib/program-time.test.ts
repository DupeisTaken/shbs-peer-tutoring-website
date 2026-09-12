import { describe, expect, it } from "vitest";
import {
  isProgramTimeZone,
  programDateKey,
  programDateTimeInput,
  parseProgramDateTime,
  programMinuteOfDay,
  programDayEnd,
} from "./program-time";

describe("program-wide time zones", () => {
  it("validates named zones, rejecting ambiguous abbreviations and invalid values", () => {
    for (const zone of [
      "Asia/Shanghai",
      "America/New_York",
      "UTC",
      "Asia/Kolkata",
    ])
      expect(isProgramTimeZone(zone)).toBe(true);
    for (const zone of ["PST", "", "Earth/Nowhere", "GMT+8"])
      expect(isProgramTimeZone(zone)).toBe(false);
  });
  it("converts the same instant independently of the host timezone", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    expect(programDateTimeInput(date, "Asia/Shanghai")).toBe(
      "2026-01-01T08:00",
    );
    expect(programDateTimeInput(date, "America/New_York")).toBe(
      "2025-12-31T19:00",
    );
    expect(programDateKey(date, "America/New_York")).toBe("2025-12-31");
    expect(programMinuteOfDay(date, "Asia/Kolkata")).toBe(330);
  });
  it("round-trips fractional offsets and seasonal daylight-saving offsets", () => {
    expect(
      parseProgramDateTime("2026-01-01T09:30", "Asia/Kolkata").toISOString(),
    ).toBe("2026-01-01T04:00:00.000Z");
    expect(
      parseProgramDateTime(
        "2026-07-01T09:30",
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-07-01T13:30:00.000Z");
    expect(
      parseProgramDateTime(
        "2026-01-01T09:30",
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-01-01T14:30:00.000Z");
  });
  it("rejects nonexistent, repeated, and invalid calendar inputs", () => {
    expect(() =>
      parseProgramDateTime("2026-03-08T02:30", "America/New_York"),
    ).toThrow("does not exist");
    expect(() =>
      parseProgramDateTime("2026-11-01T01:30", "America/New_York"),
    ).toThrow("twice");
    expect(() => parseProgramDateTime("2026-02-30T12:30", "UTC")).toThrow(
      "Invalid calendar",
    );
    expect(() => parseProgramDateTime("2026-02-01T25:30", "UTC")).toThrow();
  });
  it("uses the next local midnight for calendar-day end across daylight saving", () => {
    expect(programDayEnd("2026-03-08", "America/New_York").toISOString()).toBe(
      "2026-03-09T03:59:59.999Z",
    );
    expect(programDayEnd("2026-09-05", "America/Santiago").toISOString()).toBe(
      "2026-09-06T03:59:59.999Z",
    );
  });
});
