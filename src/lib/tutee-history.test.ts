import { expect, it } from "vitest";
import { isHistoricalTutee, matchesTuteeHistoryView } from "./tutee-history";
it("does not infer departure from missing account or undated active enrollment", () => {
  expect(isHistoricalTutee({ status: "ACTIVE" }, "now")).toBe(false);
  expect(
    isHistoricalTutee({ status: "PENDING", intakeTermId: null }, "now"),
  ).toBe(false);
  expect(
    isHistoricalTutee({ status: "ACTIVE", intakeTermId: "now" }, "now"),
  ).toBe(false);
  expect(
    isHistoricalTutee({ status: "INACTIVE", intakeTermId: "now" }, "now"),
  ).toBe(true);
  expect(
    isHistoricalTutee({ status: "ACTIVE", intakeTermId: "past" }, "now"),
  ).toBe(true);
});
it("keeps current and historical filters disjoint and all complete", () => {
  for (const past of [true, false]) {
    expect(matchesTuteeHistoryView(past, "current")).toBe(!past);
    expect(matchesTuteeHistoryView(past, "historical")).toBe(past);
    expect(matchesTuteeHistoryView(past, "all")).toBe(true);
  }
});
