import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  requestAppealToken,
  verifyRequestAppealToken,
  REQUEST_APPEAL_TTL_MS,
} from "./request-appeal-token";
import { createUnsubscribeToken } from "./unsubscribe-token";
const created = new Date("2026-10-01T00:00:00.000Z");
beforeEach(() => vi.stubEnv("AUTH_SECRET", "synthetic-appeal-secret"));
afterEach(() => vi.unstubAllEnvs());
it("keeps a fixed opaque receipt identity/expiry across delivery retries", () => {
  const first = requestAppealToken("notice_123", created);
  expect(requestAppealToken("notice_123", created)).toBe(first);
  expect(verifyRequestAppealToken(first, created.getTime())).toBe("notice_123");
  expect(first).not.toContain("@");
});
it("rejects expiry, tampering, noncanonical/oversized encodings and other purposes", () => {
  const token = requestAppealToken("notice_123", created);
  expect(
    verifyRequestAppealToken(token, created.getTime() + REQUEST_APPEAL_TTL_MS),
  ).toBeNull();
  expect(
    verifyRequestAppealToken(
      token.replace("notice_123", "notice_124"),
      created.getTime(),
    ),
  ).toBeNull();
  expect(verifyRequestAppealToken(`${token}=`, created.getTime())).toBeNull();
  expect(
    verifyRequestAppealToken("a".repeat(513), created.getTime()),
  ).toBeNull();
  expect(
    verifyRequestAppealToken(
      createUnsubscribeToken("notice_123", created.getTime()),
      created.getTime(),
    ),
  ).toBeNull();
});
it("rejects invalid IDs and missing signing configuration", () => {
  expect(() => requestAppealToken("email@example.test", created)).toThrow();
  vi.stubEnv("AUTH_SECRET", "");
  expect(() => requestAppealToken("notice_123", created)).toThrow();
});
