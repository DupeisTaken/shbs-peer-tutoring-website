import { describe, expect, it } from "vitest";
import { LOCALES } from "~/i18n/config";
import {
  programTimeZoneInputLabel,
  programTimeZoneLabel,
} from "./program-time-zone-label";

describe("date-aware timezone labels", () => {
  it.each([
    ["2026-01-15T12:00:00Z", "EST", "GMT-05:00"],
    ["2026-07-15T12:00:00Z", "EDT", "GMT-04:00"],
    ["2026-03-08T06:59:59Z", "EST", "GMT-05:00"],
    ["2026-03-08T07:00:00Z", "EDT", "GMT-04:00"],
    ["2026-11-01T05:59:59Z", "EDT", "GMT-04:00"],
    ["2026-11-01T06:00:00Z", "EST", "GMT-05:00"],
  ])("resolves New York at %s", (instant, abbreviation, offset) => {
    const date = new Date(instant);
    const label = programTimeZoneLabel("America/New_York", date);
    expect(label).toContain("America / New York");
    expect(label).toContain(`${abbreviation} (${offset})`);
    expect(date.toISOString()).toBe(instant.replace("Z", ".000Z"));
  });

  it.each([
    ["Asia/Shanghai", "GMT+08:00"],
    ["Asia/Kolkata", "GMT+05:30"],
    ["Asia/Kathmandu", "GMT+05:45"],
    ["Etc/GMT+5", "GMT-05:00"],
    ["UTC", "GMT+00:00"],
  ])("supports fixed and fractional offsets for %s", (zone, offset) => {
    for (const month of ["01", "07"]) {
      expect(
        programTimeZoneLabel(zone, new Date(`2026-${month}-15T12:00:00Z`)),
      ).toContain(`(${offset})`);
    }
  });

  it.each(LOCALES)(
    "localizes names while keeping region, abbreviation and offset readable in %s",
    (locale) => {
      const date = new Date("2026-07-15T12:00:00Z");
      const expectedName = new Intl.DateTimeFormat(locale, {
        timeZone: "America/New_York",
        timeZoneName: "long",
      })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")!.value;
      const label = programTimeZoneLabel("America/New_York", date, locale);
      expect(label).toContain(expectedName);
      expect(label).toContain("EDT (GMT-04:00)");
      expect(label).not.toContain("New_York");
    },
  );

  it("uses southern-hemisphere and half-hour daylight saving rules", () => {
    expect(
      programTimeZoneLabel(
        "Australia/Lord_Howe",
        new Date("2026-01-15T12:00:00Z"),
      ),
    ).toContain("GMT+11:00");
    expect(
      programTimeZoneLabel(
        "Australia/Lord_Howe",
        new Date("2026-07-15T12:00:00Z"),
      ),
    ).toContain("GMT+10:30");
  });

  it("previews the entered event date and leaves unresolved local times unambiguous", () => {
    expect(
      programTimeZoneInputLabel("2026-01-15T09:00", "America/New_York"),
    ).toContain("EST (GMT-05:00)");
    expect(
      programTimeZoneInputLabel("2026-07-15T09:00", "America/New_York"),
    ).toContain("EDT (GMT-04:00)");
    for (const input of [
      "",
      "2026-02-30T12:00",
      "2026-03-08T02:30",
      "2026-11-01T01:30",
    ]) {
      expect(programTimeZoneInputLabel(input, "America/New_York")).toBe(
        "America / New York",
      );
    }
  });
});
