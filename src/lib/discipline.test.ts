import { describe, expect, it } from "vitest";

import { type CardLike, disciplineStanding } from "./discipline";

const valid = (color: "YELLOW" | "RED"): CardLike => ({
  color,
  reviewStatus: "VALID",
});
const pending = (color: "YELLOW" | "RED"): CardLike => ({
  color,
  reviewStatus: "PENDING",
});
const invalid = (color: "YELLOW" | "RED"): CardLike => ({
  color,
  reviewStatus: "INVALID",
});

describe("disciplineStanding", () => {
  it("is empty for no cards", () => {
    const s = disciplineStanding([]);
    expect(s.effectiveReds).toBe(0);
    expect(s.removalPending).toBe(false);
  });

  it("counts only VALID cards toward standing", () => {
    const s = disciplineStanding([pending("RED"), invalid("RED"), valid("YELLOW")]);
    expect(s.validRed).toBe(0);
    expect(s.validYellow).toBe(1);
    expect(s.pendingRed).toBe(1);
    expect(s.effectiveReds).toBe(0);
  });

  it("escalates 3 valid yellows into 1 red", () => {
    const s = disciplineStanding([valid("YELLOW"), valid("YELLOW"), valid("YELLOW")]);
    expect(s.effectiveReds).toBe(1);
    expect(s.yellowsTowardNextRed).toBe(0);
    expect(s.removalPending).toBe(false);
  });

  it("leaves leftover yellows that haven't formed a red", () => {
    const s = disciplineStanding([valid("YELLOW"), valid("YELLOW")]);
    expect(s.effectiveReds).toBe(0);
    expect(s.yellowsTowardNextRed).toBe(2);
  });

  it("triggers removal at 2 effective reds (direct)", () => {
    const s = disciplineStanding([valid("RED"), valid("RED")]);
    expect(s.effectiveReds).toBe(2);
    expect(s.removalPending).toBe(true);
  });

  it("triggers removal via a mix of reds and escalated yellows", () => {
    // 1 valid red + 3 valid yellows (= 1 red) -> 2 effective reds -> removal.
    const s = disciplineStanding([
      valid("RED"),
      valid("YELLOW"),
      valid("YELLOW"),
      valid("YELLOW"),
    ]);
    expect(s.effectiveReds).toBe(2);
    expect(s.removalPending).toBe(true);
  });
});
