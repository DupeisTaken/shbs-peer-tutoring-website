import { expect, it } from "vitest";
import {
  formatSchoolHours,
  formatSchoolHoursCarryMinutes,
  schoolHoursApproximation,
  schoolHoursRoundedDuration,
} from "./school-hours-format";

it.each([
  [80 / 60, { hours: 1, minutes: 20, sign: "+" }],
  [-80 / 60, { hours: 1, minutes: 20, sign: "-" }],
  [59.5 / 60, { hours: 1, minutes: 0, sign: "+" }],
  [-59.5 / 60, { hours: 1, minutes: 0, sign: "-" }],
  [29 / 3600, { hours: 0, minutes: 0, sign: "" }],
  [-29 / 3600, { hours: 0, minutes: 0, sign: "" }],
  [30 / 3600, { hours: 0, minutes: 1, sign: "+" }],
  [-30 / 3600, { hours: 0, minutes: 1, sign: "-" }],
  [1 + 30 / 3600, { hours: 1, minutes: 1, sign: "+" }],
  [-(1 + 30 / 3600), { hours: 1, minutes: 1, sign: "-" }],
  [2 + 59.5 / 60, { hours: 3, minutes: 0, sign: "+" }],
  [-0, { hours: 0, minutes: 0, sign: "" }],
  [Number.MAX_VALUE, { hours: Number.MAX_VALUE, minutes: 0, sign: "+" }],
] as const)(
  "rounds source %s to minute duration without changing stored hours",
  (value, duration) => {
    expect(schoolHoursRoundedDuration(value, true)).toEqual(duration);
    expect(formatSchoolHours(value)).toBe(
      Object.is(value, -0) ? "0" : value.toString(),
    );
  },
);

it("formats unsigned positive summaries and rejects nonfinite durations", () => {
  expect(schoolHoursRoundedDuration(1.5)).toEqual({
    hours: 1,
    minutes: 30,
    sign: "",
  });
  for (const value of [NaN, Infinity, -Infinity])
    expect(() => schoolHoursRoundedDuration(value)).toThrow(RangeError);
});

it.each([
  ["0", "0"],
  ["0.0333333333333333", "2"],
  ["-0.0333333333333333", "-2"],
  ["1e-2", "0.6"],
  ["0.0123456789", "≈ 0.7407"],
  ["-1e-16", "≈ 0"],
] as const)(
  "formats retained %s hours as informational %s minutes",
  (value, label) => {
    expect(formatSchoolHoursCarryMinutes(value)).toBe(label);
  },
);

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
