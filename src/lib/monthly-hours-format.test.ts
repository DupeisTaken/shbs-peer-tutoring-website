import { expect, it } from "vitest";
import { formatMonthlyHours } from "./monthly-hours-format";

it("preserves fractional and negative report credit without unnecessary trailing zeros", () => {
  expect(formatMonthlyHours(1 / 60)).toBe("0.0167");
  expect(formatMonthlyHours(-1 / 60)).toBe("-0.0167");
  expect(formatMonthlyHours(1.25)).toBe("1.25");
  expect(formatMonthlyHours(0)).toBe("0");
  expect(formatMonthlyHours(2)).toBe("2");
});
