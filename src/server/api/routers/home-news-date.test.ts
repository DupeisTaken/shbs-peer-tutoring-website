import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { programDateKey } from "~/lib/program-time";
import { parseNewsPublishedAt } from "./home";

describe("parseNewsPublishedAt (#788)", () => {
  it.each([
    { timeZone: "Asia/Shanghai", date: "2026-11-21", expectedDay: "Nov 21, 2026" },
    { timeZone: "Pacific/Kiritimati", date: "2026-11-21", expectedDay: "Nov 21, 2026" },
    { timeZone: "America/Los_Angeles", date: "2026-11-21", expectedDay: "Nov 21, 2026" },
    { timeZone: "America/New_York", date: "2026-06-15", expectedDay: "Jun 15, 2026" },
    { timeZone: "UTC", date: "2026-11-21", expectedDay: "Nov 21, 2026" },
  ])(
    "round-trips $date identically across editor and public card in $timeZone",
    ({ timeZone, date, expectedDay }) => {
      const stored = parseNewsPublishedAt(date, timeZone);
      expect(programDateKey(stored, timeZone)).toBe(date);
      expect(
        new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeZone,
        }).format(stored),
      ).toBe(expectedDay);
    },
  );

  it("rejects impossible calendar dates and malformed strings", () => {
    expect(() => parseNewsPublishedAt("2026-02-30", "Asia/Shanghai")).toThrow(
      "Invalid publish date.",
    );
    expect(() => parseNewsPublishedAt("not-a-date", "America/Los_Angeles")).toThrow(
      "Invalid publish date.",
    );
  });
});
