import { describe, expect, it } from "vitest";
import {
  continuationOpeningDue,
  newContinuationOpening,
} from "./continuation-opening";

const at = (hour: number) => new Date(Date.UTC(2026, 10, 1, hour));
const state = {
  active: true,
  signupEnabled: true,
  signupOpensAt: at(10),
  signupClosesAt: at(11),
  signupOpeningStateSince: at(9),
  signupFirstOpenedAt: null,
};

describe("effective first opening", () => {
  it("records the scheduled instant even after the entire window elapsed without reads", () => {
    expect(continuationOpeningDue(state, at(9))).toBeNull();
    expect(continuationOpeningDue(state, at(10))).toEqual(at(10));
    expect(continuationOpeningDue(state, at(12))).toEqual(at(10));
  });
  it("bounds null and past openings by actual activation or enabling", () => {
    expect(
      continuationOpeningDue({ ...state, signupOpensAt: null }, at(10)),
    ).toEqual(at(9));
    expect(
      continuationOpeningDue({ ...state, signupOpensAt: at(8) }, at(10)),
    ).toEqual(at(9));
    expect(
      continuationOpeningDue(
        { ...state, signupOpeningStateSince: at(10) },
        at(10),
      ),
    ).toEqual(at(10));
  });
  it.each([
    { active: false },
    { signupEnabled: false },
    { signupOpeningStateSince: null },
    { signupFirstOpenedAt: at(8) },
    { signupOpeningStateSince: at(11) },
  ])(
    "does not invent an opening for ineligible or already recorded state %j",
    (patch) => {
      expect(continuationOpeningDue({ ...state, ...patch }, at(12))).toBeNull();
    },
  );
});

describe("actual refresh provenance", () => {
  it.each([
    ["Q1", "Q2", false, "26-27", true],
    ["Q3", "Q4", false, "26-27", true],
    ["Q1", "Q2", true, "26-27", false],
    ["Q3", "Q4", true, "26-27", false],
    ["Q1", "Q3", true, "26-27", false],
    ["Q2", "Q3", false, "26-27", false],
    ["Q1", "Q3", false, "26-27", false],
    ["Q2", "Q2", false, "26-27", false],
    ["Q4", "Q2", false, "26-27", false],
    ["Q4", "Q1", false, "27-28", false],
    ["Q1", "Q2", false, "27-28", false],
    ["Q3", "Q4", false, "27-28", false],
  ] as const)(
    "%s to %s, semester=%s, year=%s",
    (from, to, semester, year, eligible) => {
      expect(
        newContinuationOpening(
          { id: "source", schoolYear: "26-27", quarter: from },
          { schoolYear: year, quarter: to },
          semester,
          at(9),
        ),
      ).toEqual({
        signupOpeningStateSince: at(9),
        continuationSourceTermId: eligible ? "source" : null,
        continuationQuarterTransition: eligible,
      });
    },
  );
  it("never equates bootstrap creation with a refresh from an adjacent term", () => {
    expect(
      newContinuationOpening(
        null,
        { schoolYear: "26-27", quarter: "Q2" },
        false,
        at(9),
      ),
    ).toMatchObject({
      continuationSourceTermId: null,
      continuationQuarterTransition: false,
    });
  });
});
