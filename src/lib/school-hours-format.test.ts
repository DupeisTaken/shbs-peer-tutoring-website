import { expect, it } from "vitest";
import {
  formatSchoolHours,
  schoolHoursApproximation,
} from "./school-hours-format";

it("retains fractional account precision, signed corrections and zero without rounding", () => {
  expect(formatSchoolHours(1 / 60)).toBe((1 / 60).toString());
  expect(formatSchoolHours(-1 / 60, true)).toBe((-1 / 60).toString());
  expect(formatSchoolHours(7, true)).toBe("+7");
  expect(formatSchoolHours(-0, true)).toBe("0");
});

it.each([
  [1.7500000000000002, "+1.75"],
  [3.5833333333333335, "+3.5833"],
  [28.041666666666668, "+28.0417"],
  [4.083333333333334, "+4.0833"],
  [1 / 12, "+0.0833"],
  [-1 / 60, "-0.0167"],
] as const)(
  "offers an approximate summary of %s without changing its exact instruction",
  (value, summary) => {
    expect(schoolHoursApproximation(value, true)).toBe(summary);
    expect(formatSchoolHours(value, true)).toBe(
      `${value > 0 ? "+" : ""}${value.toString()}`,
    );
  },
);

it.each([0, -0, 1.75, -2.25, 1e-16, -1e-16, Number.MIN_VALUE])(
  "keeps exact short and tiny nonzero values without an approximation: %s",
  (value) => expect(schoolHoursApproximation(value, true)).toBeNull(),
);
