import { describe, expect, it } from "vitest";

import {
  ABSENCE_LIMIT_PER_SEMESTER,
  computeSessionHours,
  DEDUCTION,
  interviewServiceHours,
  monthKey,
  overLimitAbsenceDeduction,
  roundToHalfHour,
  sessionFactor,
  shCount,
} from "./service-hours";

describe("sessionFactor", () => {
  it("is 0 when the tutor wasn't present (rescheduled or absent)", () => {
    expect(sessionFactor("RESCHEDULED", ["PRESENT", "PRESENT"])).toBe(0);
    expect(sessionFactor("TUTOR_ABSENT", ["PRESENT"])).toBe(0);
  });

  it("is 1 + number of present tutees when the tutor is present", () => {
    expect(sessionFactor("PRESENT", ["PRESENT"])).toBe(2); // 1 tutee -> 2
    expect(sessionFactor("PRESENT", ["PRESENT", "PRESENT"])).toBe(3); // group of 2 -> 3
  });

  it("an unexcused absence leaves the tutor the baseline credit of 1", () => {
    expect(sessionFactor("PRESENT", ["UNEXCUSED_ABSENT"])).toBe(1);
    expect(sessionFactor("PRESENT", ["PRESENT", "UNEXCUSED_ABSENT"])).toBe(2);
  });

  it("is 0 when every tutee is excused-absent (no session effectively ran)", () => {
    expect(sessionFactor("PRESENT", ["EXCUSED_ABSENT"])).toBe(0);
    expect(sessionFactor("PRESENT", ["EXCUSED_ABSENT", "EXCUSED_ABSENT"])).toBe(0);
  });
});

describe("shCount rounding", () => {
  it("rounds down when the leftover is <= 10 minutes", () => {
    expect(shCount(60, 1)).toBe(1); // exactly 1h
    expect(shCount(70, 1)).toBe(1); // leftover 10 -> floor to 1.0h
    expect(shCount(130, 1)).toBe(2); // leftover 10 -> 2.0h
  });

  it("rounds up when the leftover is > 10 minutes", () => {
    expect(shCount(71, 1)).toBe(1.5); // leftover 11 -> ceil to 1.5h
    expect(shCount(50, 1)).toBe(1); // leftover 50 -> ceil to 1.0h
    expect(shCount(35, 1)).toBe(1); // leftover 35 -> ceil to 1.0h
    expect(shCount(20, 1)).toBe(0.5); // leftover 20 -> ceil to 0.5h
  });

  it("multiplies the rounded hours by the factor", () => {
    expect(shCount(60, 3)).toBe(3); // 1h x group factor 3
    expect(shCount(90, 2)).toBe(3); // 1.5h x 2
    expect(shCount(60, 0)).toBe(0); // absence factor
  });

  it("the 10/11 minute boundary is the rounding pivot", () => {
    expect(shCount(10, 1)).toBe(0); // leftover 10 -> floor(0.33h*2)/2 = 0
    expect(shCount(11, 1)).toBe(0.5); // leftover 11 -> ceil -> 0.5
  });
});

describe("interviewServiceHours", () => {
  it("equals the interview duration rounded to the nearest half-hour", () => {
    expect(interviewServiceHours(60)).toBe(1);
    expect(interviewServiceHours(20)).toBe(0.5); // 15-20 min demo -> 0.5h
    expect(interviewServiceHours(45)).toBe(1); // leftover 45 -> ceil to 1.0h
  });
});

describe("roundToHalfHour", () => {
  it("matches the session rounding pivot at 10/11 minutes", () => {
    expect(roundToHalfHour(70)).toBe(1); // leftover 10 -> down
    expect(roundToHalfHour(71)).toBe(1.5); // leftover 11 -> up
  });
});

describe("overLimitAbsenceDeduction", () => {
  it("is zero up to and including the per-semester limit", () => {
    expect(overLimitAbsenceDeduction(0)).toBe(0);
    expect(overLimitAbsenceDeduction(ABSENCE_LIMIT_PER_SEMESTER)).toBe(0);
  });

  it("deducts 0.25h for each absence beyond the limit", () => {
    expect(overLimitAbsenceDeduction(4)).toBe(DEDUCTION.OVER_LIMIT_ABSENCE);
    expect(overLimitAbsenceDeduction(6)).toBeCloseTo(0.75);
  });
});

describe("monthKey", () => {
  it("formats as YYYY-MM in UTC", () => {
    expect(monthKey(new Date("2026-06-15T00:00:00Z"))).toBe("2026-06");
    expect(monthKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
    expect(monthKey(new Date("2025-12-31T23:59:59Z"))).toBe("2025-12");
  });
});

describe("computeSessionHours", () => {
  it("derives every stored field for a 1-hour group of 2", () => {
    const r = computeSessionHours({
      tutorStatus: "PRESENT",
      tuteeStatuses: ["PRESENT", "PRESENT"],
      startMin: 930, // 15:30
      endMin: 990, // 16:30
      date: new Date("2026-06-15T00:00:00Z"),
    });
    expect(r).toEqual({
      durationMin: 60,
      shFactor: 3,
      shCount: 3,
      month: "2026-06",
    });
  });

  it("yields zero hours for an excused absence regardless of duration", () => {
    const r = computeSessionHours({
      tutorStatus: "PRESENT",
      tuteeStatuses: ["EXCUSED_ABSENT"],
      startMin: 900,
      endMin: 990,
      date: new Date("2026-06-15T00:00:00Z"),
    });
    expect(r.shFactor).toBe(0);
    expect(r.shCount).toBe(0);
    expect(r.durationMin).toBe(90);
  });
});
