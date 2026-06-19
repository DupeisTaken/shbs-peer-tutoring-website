import { describe, expect, it } from "vitest";

import {
  computeSessionHours,
  monthKey,
  shCount,
  shFactor,
} from "./service-hours";

describe("shFactor", () => {
  it("unexcused tutee absence counts as 1 (tutor still showed up)", () => {
    expect(shFactor("TUTEE_ABSENT_UNEXCUSED", 1)).toBe(1);
    expect(shFactor("TUTEE_ABSENT_UNEXCUSED", 3)).toBe(1);
  });

  it("excused tutee absence and tutor absence count as 0", () => {
    expect(shFactor("TUTEE_ABSENT_EXCUSED", 2)).toBe(0);
    expect(shFactor("TUTOR_ABSENT", 2)).toBe(0);
  });

  it("otherwise returns tuteeCount + 1", () => {
    expect(shFactor("PRESENT", 1)).toBe(2); // 1 tutee -> 2
    expect(shFactor("PRESENT", 2)).toBe(3); // group of 2 -> 3
    expect(shFactor("RESCHEDULED", 1)).toBe(2);
    expect(shFactor("EXTRA_SESSION", 3)).toBe(4);
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
      status: "PRESENT",
      tuteeCount: 2,
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
      status: "TUTEE_ABSENT_EXCUSED",
      tuteeCount: 1,
      startMin: 900,
      endMin: 990,
      date: new Date("2026-06-15T00:00:00Z"),
    });
    expect(r.shFactor).toBe(0);
    expect(r.shCount).toBe(0);
    expect(r.durationMin).toBe(90);
  });
});
