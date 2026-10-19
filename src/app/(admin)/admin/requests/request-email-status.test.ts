import { describe, expect, it } from "vitest";
import { requestEmailStatus } from "./request-email-status";

const confirmedAt = new Date("2026-10-01T00:00:00Z");
const verified = {
  email: "learner@example.test",
  emailVerifiedAt: confirmedAt,
};

describe("legacy request contact evidence", () => {
  it.each([null, undefined, "", "   "])(
    "has no status for absent contact %s",
    (email) => {
      expect(requestEmailStatus(email, verified)).toBeNull();
    },
  );

  it("requires confirmation of the same address, normalizing case and whitespace", () => {
    expect(requestEmailStatus(" LEARNER@example.test ", verified)).toBe(
      "verified",
    );
    expect(
      requestEmailStatus("learner@example.test", {
        ...verified,
        email: " LEARNER@EXAMPLE.TEST ",
      }),
    ).toBe("verified");
    expect(
      requestEmailStatus("learner@example.test", {
        ...verified,
        emailVerifiedAt: null,
      }),
    ).toBe("unverified");
  });

  it.each([
    null,
    undefined,
    {},
    { email: null },
    { email: "learner@example.test" },
    { email: "other@example.test", emailVerifiedAt: confirmedAt },
    { email: "other@example.test", emailVerifiedAt: null },
  ])(
    "does not turn absent or unrelated evidence into verification: %j",
    (owner) => {
      expect(requestEmailStatus("learner@example.test", owner)).toBe("unknown");
    },
  );
});
