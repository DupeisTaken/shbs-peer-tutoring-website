import { describe, expect, it } from "vitest";

import { isSignupWindowOpen, signupCountdown } from "./signup-window";

describe("tutee signup window", () => {
  it("preserves open-by-default behavior when no opening time is configured", () => {
    expect(isSignupWindowOpen(null, new Date("2026-08-30T00:00:00Z"))).toBe(
      true,
    );
  });

  it("stays closed before the configured instant and opens exactly on the boundary", () => {
    const opensAt = new Date("2026-09-01T00:00:00Z");
    expect(
      isSignupWindowOpen(opensAt, new Date("2026-08-31T23:59:59.999Z")),
    ).toBe(false);
    expect(isSignupWindowOpen(opensAt, opensAt)).toBe(true);
  });

  it("splits the remaining time into days, hours, minutes, and seconds", () => {
    expect(
      signupCountdown(
        new Date("2026-09-01T01:02:03Z"),
        new Date("2026-08-30T00:00:00Z"),
      ),
    ).toEqual({ days: 2, hours: 1, minutes: 2, seconds: 3 });
  });

  it("never shows a negative countdown after opening", () => {
    expect(
      signupCountdown(
        new Date("2026-08-30T00:00:00Z"),
        new Date("2026-08-30T00:00:01Z"),
      ),
    ).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});
