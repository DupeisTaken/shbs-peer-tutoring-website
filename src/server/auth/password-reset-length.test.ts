import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { EmailMessage } from "~/server/email/sender";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailConfigured: () => true,
  isEmailDeliveryAvailable: () => true,
}));

import { db } from "~/server/db";
import { hashPassword, verifyPassword } from "./password";
import { verifySigninPassword } from "./credentials";
import { verifyPasswordConfirmation } from "./password-confirmation";
import { issuePasswordReset, resetPassword } from "./password-reset";
import { resetPasswordAction } from "~/app/reset-password/actions";
import { PASSWORD_MAX_LENGTH } from "~/lib/password-contract";

let userId = "";
let serial = 0;
const initialPassword = "InitialPassword123!";

function extractToken(): string {
  const body = mail.send.mock.calls.at(-1)?.[0].text ?? "";
  const match = /token=([A-Za-z0-9_-]+)/.exec(body);
  if (!match?.[1]) throw new Error("No reset token captured in email body.");
  return match[1];
}

function resetForm(token: string, password: string, confirm = password) {
  const form = new FormData();
  form.set("token", token);
  form.set("password", password);
  form.set("confirm", confirm);
  return form;
}

const isSafeTestDb = () => {
  if (!process.env.DATABASE_URL) return false;
  const url = new URL(process.env.DATABASE_URL);
  return (
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname === "/shbs_shipping_test"
  );
};

beforeEach(async () => {
  if (!isSafeTestDb())
    throw new Error("Use the isolated local shbs_shipping_test database.");
  const stamp = Date.now().toString(36);
  userId = `pwlen636-${stamp}-${++serial}`;
  mail.send.mockReset().mockResolvedValue(undefined);
  await db.user.create({
    data: {
      id: userId,
      email: `${userId}@example.test`,
      username: `pwlen${stamp}${serial}`,
      name: "Password Reset Length Test",
      role: "VIEWER",
      emailVerifiedAt: new Date(),
      passwordHash: hashPassword(initialPassword),
    },
  });
});

afterAll(async () => {
  if (!isSafeTestDb()) return;
  await db.user.deleteMany({ where: { id: { startsWith: "pwlen636-" } } });
});

it("rejects 7-char and 1025-char passwords before consuming the reset grant or mutating credentials", async () => {
  await issuePasswordReset(`${userId}@example.test`);
  const token = extractToken();

  const before = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true, sessionVersion: true },
  });

  // Action rejects 7 and 1025 with structured code without consuming token.
  const shortRes = await resetPasswordAction(
    undefined,
    resetForm(token, "short7!"),
  );
  expect(shortRes).toMatchObject({ code: "password-length" });

  const longPassword = "L".repeat(PASSWORD_MAX_LENGTH + 1);
  const longRes = await resetPasswordAction(
    undefined,
    resetForm(token, longPassword),
  );
  expect(longRes).toMatchObject({ code: "password-length" });
  expect(JSON.stringify(longRes)).not.toContain(longPassword);

  // Domain resetPassword also rejects 7 and 1025 directly.
  await expect(resetPassword(token, "short7!")).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await expect(resetPassword(token, longPassword)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });

  const stillUnchanged = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true, sessionVersion: true },
  });
  expect(stillUnchanged.passwordHash).toBe(before.passwordHash);
  expect(stillUnchanged.sessionVersion).toBe(before.sessionVersion);

  const openGrants = await db.passwordResetToken.count({
    where: { userId, consumedAt: null },
  });
  expect(openGrants).toBe(1);

  // The same unconsumed grant still accepts a valid 1024-char password, rotates sessionVersion,
  // signs in, and passes bounded account password confirmation.
  const boundary1024 = "B".repeat(PASSWORD_MAX_LENGTH);
  const okRes = await resetPasswordAction(
    undefined,
    resetForm(token, boundary1024),
  );
  expect(okRes).toMatchObject({ ok: true, email: `${userId}@example.test` });

  const after = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true, sessionVersion: true },
  });
  expect(after.sessionVersion).toBeGreaterThan(before.sessionVersion);
  expect(verifyPassword(boundary1024, after.passwordHash!)).toBe(true);
  expect(
    verifyPasswordConfirmation(userId, boundary1024, after.passwordHash),
  ).toBe(true);

  const signin = await verifySigninPassword(
    `${userId}@example.test`,
    boundary1024,
    "127.0.0.1",
  );
  expect(signin.ok).toBe(true);

  // Reusing the consumed grant returns an invalid/expired error.
  const reuseRes = await resetPasswordAction(
    undefined,
    resetForm(token, "ValidEight1"),
  );
  expect(reuseRes).toEqual({
    error: "This reset link is invalid or has expired.",
  });
});

it("accepts the 8-char lower boundary and rejects wrong or expired grants", async () => {
  expect(await resetPassword("nonexistent-token", "Valid8!!")).toBeNull();

  await issuePasswordReset(`${userId}@example.test`);
  const token = extractToken();
  const ok = await resetPassword(token, "Exact8!!");
  expect(ok).toMatchObject({ email: `${userId}@example.test` });

  // Expired grant returns null even with valid password length.
  await issuePasswordReset(`${userId}@example.test`);
  const expiredToken = extractToken();
  await db.passwordResetToken.updateMany({
    where: { userId, consumedAt: null },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  expect(await resetPassword(expiredToken, "Exact8!!")).toBeNull();
});
