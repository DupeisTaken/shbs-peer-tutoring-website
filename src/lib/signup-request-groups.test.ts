import { describe, expect, it } from "vitest";
import { bySignupPriority, signupRequestGroup } from "./signup-request-groups";

describe("unified signup queue", () => {
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
