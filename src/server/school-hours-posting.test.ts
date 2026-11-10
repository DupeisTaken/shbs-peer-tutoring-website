import { describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma";
import {
  quantizeSchoolHours,
  sumSchoolHoursCarry,
} from "./school-hours-posting";

const ExactDecimal = Prisma.Decimal.clone({ precision: 700 });

function expectConservation(rawChange: number, carryIn = "0") {
  const result = quantizeSchoolHours(rawChange, carryIn);
  expect(
    new ExactDecimal(result.hoursToAdd)
      .plus(result.carryOutHours)
      .eq(new ExactDecimal(rawChange).plus(carryIn)),
  ).toBe(true);
  return result;
}

describe("school posting tenths and exact carry", () => {
  it("posts 80 minutes as 1.3 hours and releases the retained two minutes with four later minutes", () => {
    const first = expectConservation(80 / 60);
    expect(first).toEqual({
      hoursToAdd: 1.3,
      carryOutHours: "0.0333333333333333",
    });
    expect(Number(first.carryOutHours) * 60).toBeCloseTo(2, 12);
    const next = expectConservation(4 / 60, first.carryOutHours);
    expect(next).toEqual({ hoursToAdd: 0.1, carryOutHours: "-3e-17" });
    expect(expectConservation(0, next.carryOutHours)).toEqual({
      hoursToAdd: 0,
      carryOutHours: "-3e-17",
    });
  });

  it("handles negative changes symmetrically, retaining a snapped boundary's exact debt", () => {
    const first = expectConservation(-80 / 60);
    expect(first).toEqual({
      hoursToAdd: -1.3,
      carryOutHours: "-0.0333333333333333",
    });
    expect(expectConservation(-4 / 60, first.carryOutHours)).toEqual({
      hoursToAdd: -0.1,
      carryOutHours: "3e-17",
    });
    expect(expectConservation(-0.19)).toEqual({
      hoursToAdd: -0.1,
      carryOutHours: "-0.09",
    });
  });

  it("offsets existing carry before posting a reversal across zero", () => {
    expect(expectConservation(-0.08, "0.06")).toEqual({
      hoursToAdd: 0,
      carryOutHours: "-0.02",
    });
    expect(expectConservation(-0.11, "-0.02")).toEqual({
      hoursToAdd: -0.1,
      carryOutHours: "-0.03",
    });
    expect(expectConservation(0.04, "-0.03")).toEqual({
      hoursToAdd: 0,
      carryOutHours: "0.01",
    });
  });

  it("conserves every exact stored decimal across a sequence of issues", () => {
    const changes = [80 / 60, 4 / 60, 0, -0.09, 1e-16, 0.23, -0.7, -2 / 60];
    let carry = "0";
    let posted = new ExactDecimal(0);
    let earned = new ExactDecimal(0);
    for (const change of changes) {
      const result = expectConservation(change, carry);
      carry = result.carryOutHours;
      posted = posted.plus(result.hoursToAdd);
      earned = earned.plus(change);
      expect(posted.plus(carry).eq(earned)).toBe(true);
    }
  });

  it("does not snap ordinary deficits or discard tiny genuine source values", () => {
    expect(expectConservation(0.099999999999999)).toEqual({
      hoursToAdd: 0,
      carryOutHours: "0.099999999999999",
    });
    expect(expectConservation(1e-16)).toEqual({
      hoursToAdd: 0,
      carryOutHours: "1e-16",
    });
    expect(expectConservation(-1e-16)).toEqual({
      hoursToAdd: 0,
      carryOutHours: "-1e-16",
    });
    expect(expectConservation(1e-16, "0.03").carryOutHours).toBe(
      "0.0300000000000001",
    );
  });

  it("defaults legacy carry to zero and returns canonical positive zero", () => {
    expect(quantizeSchoolHours(1.25)).toEqual({
      hoursToAdd: 1.2,
      carryOutHours: "0.05",
    });
    expect(quantizeSchoolHours(-0)).toEqual({
      hoursToAdd: 0,
      carryOutHours: "0",
    });
    expect(Object.is(quantizeSchoolHours(-0.01).hoursToAdd, -0)).toBe(false);
  });

  it("combines ownership carry exactly and can post with no new source changes", () => {
    const carries = Object.freeze(["0.06", "0.06", "1e-324"]);
    const combined = sumSchoolHoursCarry(carries);
    expect(
      new ExactDecimal(combined).eq(new ExactDecimal("0.12").plus("1e-324")),
    ).toBe(true);
    const result = expectConservation(0, combined);
    expect(result.hoursToAdd).toBe(0.1);
    expect(
      new ExactDecimal(result.carryOutHours).eq(
        new ExactDecimal("0.02").plus("1e-324"),
      ),
    ).toBe(true);
    expect(carries).toEqual(["0.06", "0.06", "1e-324"]);
    expect(sumSchoolHoursCarry([])).toBe("0");
    expect(sumSchoolHoursCarry(["0.03", "-0.03"])).toBe("0");
  });

  it("retains tiny carry across the finite JS-number range without changing shared Decimal precision", () => {
    const originalPrecision = Prisma.Decimal.precision;
    const carry = "1e-324";
    expect(expectConservation(1e308, carry)).toEqual({
      hoursToAdd: 1e308,
      carryOutHours: carry,
    });
    expect(expectConservation(Number.MIN_VALUE).carryOutHours).toBe("5e-324");
    expect(Prisma.Decimal.precision).toBe(originalPrecision);
  });

  it("rejects unsupported inputs instead of silently losing decimal conservation", () => {
    expect(() => quantizeSchoolHours(Infinity)).toThrow(RangeError);
    expect(() => quantizeSchoolHours(NaN)).toThrow(RangeError);
    for (const carry of [
      "NaN",
      "Infinity",
      "invalid",
      "0x1",
      "1e-325",
      "1e309",
      "1e-10000000000000000",
    ])
      expect(() => quantizeSchoolHours(0, carry)).toThrow(RangeError);
    expect(() => quantizeSchoolHours(9007199254740992, "0.1")).toThrow(
      RangeError,
    );
  });
});
