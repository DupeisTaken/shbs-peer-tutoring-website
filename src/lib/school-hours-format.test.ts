import { expect, it } from "vitest";
import { formatSchoolHours } from "./school-hours-format";

it("retains fractional account precision, signed corrections and zero without rounding", () => {
  expect(formatSchoolHours(1 / 60)).toBe((1 / 60).toString());
  expect(formatSchoolHours(-1 / 60, true)).toBe((-1 / 60).toString());
  expect(formatSchoolHours(7, true)).toBe("+7");
  expect(formatSchoolHours(-0, true)).toBe("0");
});
