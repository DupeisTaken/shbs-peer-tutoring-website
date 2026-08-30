import { describe, expect, it } from "vitest";

import { DEFAULT_FEATURES } from "./features";

describe("program feature defaults", () => {
  it("keeps ordinary modules available but requires an explicit email 2FA opt-in", () => {
    expect(DEFAULT_FEATURES.EMAIL_2FA).toBe(false);
    expect(
      Object.entries(DEFAULT_FEATURES).filter(
        ([key, enabled]) => key !== "EMAIL_2FA" && !enabled,
      ),
    ).toEqual([]);
  });
});
