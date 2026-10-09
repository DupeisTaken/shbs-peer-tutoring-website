import { expect, it } from "vitest";
import { hasReadyCredentials } from "./account-readiness";

it.each([
  [null, null, false, false],
  [null, new Date(), false, false],
  ["hash", null, false, false],
  ["hash", new Date(), true, false],
  ["hash", new Date(), false, true],
] as const)(
  "credential readiness requires password, verification and completed password setup",
  (passwordHash, emailVerifiedAt, mustChangePassword, expected) => {
    expect(
      hasReadyCredentials({
        passwordHash,
        emailVerifiedAt,
        mustChangePassword,
      }),
    ).toBe(expected);
  },
);
