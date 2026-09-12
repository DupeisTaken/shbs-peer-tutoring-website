import { describe, expect, it } from "vitest";
import {
  bySignupPriority,
  signupRequestGroup,
  isCurrentManualSignup,
} from "./signup-request-groups";

describe("unified signup queue", () => {
  it("excludes ended-quarter profiles and infers legacy active intake only from current pairings", () => {
    const row = {
      status: "ACTIVE",
      intakeTermId: "current",
      signupSubmittedAt: new Date(),
    };
    expect(isCurrentManualSignup(row, "current", false, false)).toBe(true);
    expect(
      isCurrentManualSignup(
        { ...row, intakeTermId: "ended" },
        "current",
        true,
        true,
      ),
    ).toBe(false);
    expect(
      isCurrentManualSignup(
        { ...row, status: "PENDING", intakeTermId: "ended" },
        "current",
        false,
        false,
      ),
    ).toBe(false);
    expect(
      isCurrentManualSignup(
        { ...row, intakeTermId: null },
        "current",
        false,
        false,
      ),
    ).toBe(false);
    expect(
      isCurrentManualSignup(
        { ...row, intakeTermId: null },
        "current",
        true,
        false,
      ),
    ).toBe(true);
    expect(
      isCurrentManualSignup(
        { ...row, status: "PENDING", intakeTermId: null },
        "current",
        false,
        false,
      ),
    ).toBe(true);
    expect(isCurrentManualSignup(row, undefined, true, true)).toBe(false);
    expect(
      isCurrentManualSignup(
        {
          ...row,
          intakeTermId: null,
          signupSubmittedAt: null,
          firstChoiceId: "math",
        },
        "current",
        true,
        false,
      ),
    ).toBe(true);
    expect(
      isCurrentManualSignup(
        { ...row, intakeTermId: null, signupSubmittedAt: null },
        "current",
        true,
        false,
      ),
    ).toBe(false);
  });
  it("keeps empty and partially matched manual or survey requests in matching", () => {
    expect(signupRequestGroup("OPEN", [], [])).toBe("matching");
    expect(signupRequestGroup("OPEN", ["Math", "Biology"], ["Math"])).toBe(
      "matching",
    );
    expect(signupRequestGroup("OPEN", ["Math"], ["Math"])).toBe("assigned");
  });
  it.each(["ABORTED", "RECALLED", "EXPIRED"])(
    "never reopens terminal %s requests",
    (state) => {
      expect(signupRequestGroup(state, ["Math"], [])).toBe("processed");
    },
  );
  it("interleaves sources by original submission time with stable ties", () => {
    const early = { id: "manual", submittedAt: new Date("2026-09-01") };
    const late = { id: "survey", submittedAt: new Date("2026-09-02") };
    const input = [late, early];
    expect(bySignupPriority(input)).toEqual([early, late]);
    expect(input).toEqual([late, early]);
  });
});
