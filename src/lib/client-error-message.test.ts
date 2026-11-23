import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";

import en from "../../messages/en.json";
import zh from "../../messages/zh.json";
import { errorRecoveryKey, formatClientError } from "./client-error-message";

describe("client error recovery mapping", () => {
  it.each([
    ["UNAUTHORIZED", "errorRecovery.unauthorized"],
    ["FORBIDDEN", "errorRecovery.forbidden"],
    ["NOT_FOUND", "errorRecovery.notFound"],
    ["CONFLICT", "errorRecovery.conflict"],
    ["TOO_MANY_REQUESTS", "errorRecovery.tooManyRequests"],
    ["TIMEOUT", "errorRecovery.timeout"],
    ["PRECONDITION_FAILED", "errorRecovery.preconditionFailed"],
    ["BAD_REQUEST", "errorRecovery.badRequest"],
    ["INTERNAL_SERVER_ERROR", "errorRecovery.internal"],
  ] as const)("maps tRPC code %s to %s", (code, expected) => {
    expect(errorRecoveryKey({ data: { code }, message: "Raw server text" })).toBe(
      expected,
    );
  });

  it("maps browser network errors and unknown errors without leaking raw strings", () => {
    expect(errorRecoveryKey({ message: "Failed to fetch" })).toBe(
      "errorRecovery.network",
    );
    expect(errorRecoveryKey({ message: "Prisma P2002 unique constraint" })).toBe(
      "errorRecovery.generic",
    );
  });

  it.each([
    ["en", en],
    ["zh", zh],
  ] as const)("formats localized recovery copy in %s", (locale, messages) => {
    const t = createTranslator({ locale, messages });
    const text = formatClientError(
      { data: { code: "CONFLICT" }, message: "optimistic lock version mismatch" },
      (k) => t(k as Parameters<typeof t>[0]),
    );
    expect(text).toBe(messages.errorRecovery.conflict);
    expect(text).not.toContain("optimistic");
  });
});
