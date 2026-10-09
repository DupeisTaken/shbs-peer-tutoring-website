import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  createUnsubscribeToken,
  notificationUnsubscribeUrl,
  UNSUBSCRIBE_TTL_SECONDS,
  verifyUnsubscribeToken,
} from "./unsubscribe-token";

const now = new Date("2026-10-09T00:00:00Z").getTime();
beforeEach(() => vi.stubEnv("AUTH_SECRET", "synthetic-unsubscribe-secret"));
afterEach(() => vi.unstubAllEnvs());

it("signs only the delivery identifier, returns it before expiry and rejects the exact expiry boundary", () => {
  const token = createUnsubscribeToken("notice-1", now);
  expect(verifyUnsubscribeToken(token, now)).toBe("notice-1");
  expect(
    verifyUnsubscribeToken(token, now + UNSUBSCRIBE_TTL_SECONDS * 1000 - 1),
  ).toBe("notice-1");
  expect(
    verifyUnsubscribeToken(token, now + UNSUBSCRIBE_TTL_SECONDS * 1000),
  ).toBeNull();
  expect(token).not.toContain("@");
});

it("rejects changed delivery identifiers, signatures, expiry, secrets and oversized input", () => {
  const token = createUnsubscribeToken("notice-1", now);
  expect(
    verifyUnsubscribeToken(token.replace("notice-1", "notice-2"), now),
  ).toBeNull();
  expect(
    verifyUnsubscribeToken(
      token.replace(/\.[^.]+$/, "." + "a".repeat(43)),
      now,
    ),
  ).toBeNull();
  expect(
    verifyUnsubscribeToken(token.replace(/\.(\d+)\./, ".1999999999."), now),
  ).toBeNull();
  expect(verifyUnsubscribeToken("a".repeat(513), now)).toBeNull();
  vi.stubEnv("AUTH_SECRET", "rotated-secret");
  expect(verifyUnsubscribeToken(token, now)).toBeNull();
});

it("does not accept a payload signed for a different application purpose", () => {
  const payload = createUnsubscribeToken("notice-1", now)
    .split(".")
    .slice(0, 3)
    .join(".");
  const otherSignature = createHmac("sha256", "synthetic-unsubscribe-secret")
    .update(payload)
    .digest("base64url");
  expect(
    verifyUnsubscribeToken(`${payload}.${otherSignature}`, now),
  ).toBeNull();
});

it.each(["production", "development", "test"])(
  "fails closed when AUTH_SECRET is missing in %s",
  (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => createUnsubscribeToken("notice-1", now)).toThrow(
      "AUTH_SECRET",
    );
  },
);

it("builds a direct public confirmation URL and rejects unsafe configured origins", () => {
  vi.stubEnv("AUTH_URL", "https://pt.example.test");
  const url = new URL(notificationUnsubscribeUrl("notice-1"));
  expect(url.origin + url.pathname).toBe("https://pt.example.test/unsubscribe");
  expect(verifyUnsubscribeToken(url.searchParams.get("token")!)).toBe(
    "notice-1",
  );
  vi.stubEnv("AUTH_URL", "https://evil.example/path");
  expect(() => notificationUnsubscribeUrl("notice-1")).toThrow();
});
