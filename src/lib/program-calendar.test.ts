import { describe, expect, it } from "vitest";
import { programCalendarWrite } from "./program-calendar";

const notice = { date: "2026-10-12", reason: "Exam week", expectedVersion: 0 };

describe("inclusive program calendar ranges", () => {
  it("normalizes legacy one-day inputs and retains explicit inclusive endpoints", () => {
    expect(programCalendarWrite.parse(notice).endDate).toBe(notice.date);
    expect(
      programCalendarWrite.parse({ ...notice, endDate: notice.date }).endDate,
    ).toBe(notice.date);
    expect(
      programCalendarWrite.parse({ ...notice, endDate: "2026-10-16" }).endDate,
    ).toBe("2026-10-16");
  });

  it("accepts leap days and ranges across month and year boundaries", () => {
    for (const [date, endDate] of [
      ["2028-02-29", "2028-03-01"],
      ["2026-12-31", "2027-01-02"],
    ]) {
      expect(
        programCalendarWrite.safeParse({ ...notice, date, endDate }).success,
      ).toBe(true);
    }
  });

  it("rejects invalid dates, reversed endpoints and timestamp substitutes", () => {
    for (const endDate of [
      "2026-02-29",
      "2026-10-11",
      "2026-13-01",
      "2026-10-16T00:00:00Z",
      "",
    ]) {
      expect(
        programCalendarWrite.safeParse({ ...notice, endDate }).success,
      ).toBe(false);
    }
    expect(
      programCalendarWrite.safeParse({ ...notice, date: "2026-02-30" }).success,
    ).toBe(false);
  });
});
