/**
 * Forgot-password flow. The reset link is emailed via the configured provider (Aliyun Direct
 * Mail — see src/server/email/sender.ts). When email isn't configured, the sender logs the
 * message in dev (so the link is still visible) and warns in production. Node runtime only.
 */
import { createHash, randomBytes } from "crypto";

import { db } from "~/server/db";
import { emailSender } from "~/server/email/sender";
import { APP_TITLE } from "~/lib/branding";
import { hashPassword } from "./password";

/** How long an issued reset token stays valid. */
const TOKEN_TTL_MINUTES = 60;

/** SHA-256 of the token (the plaintext token is high-entropy, so a fast hash is fine). */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a password-reset token for whoever matches `identifier` (email or tutor username),
 * and "send" the reset link. Always resolves the same way regardless of whether an account
 * was found — callers must show an identical message either way (no account enumeration).
 */
export async function issuePasswordReset(identifier: string): Promise<void> {
  const id = identifier.trim().toLowerCase();
  if (!id) return;

  const user = await db.user.findFirst({
    where: { OR: [{ email: id }, { tutor: { username: id } }] },
    select: { id: true, email: true },
  });
  if (!user) return; // silently no-op — don't reveal whether the account exists

  const token = randomBytes(32).toString("hex");
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000),
    },
  });

  await deliverResetLink(user.email, token);
}

/**
 * Email the reset link. With a provider configured this sends a real message; otherwise the
 * sender logs it in dev (link included) and warns in production.
 */
async function deliverResetLink(to: string, token: string): Promise<void> {
  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const link = `${base}/reset-password?token=${token}`;

  await emailSender.send({
    to,
    subject: `Reset your ${APP_TITLE} password`,
    text:
      `We received a request to reset your ${APP_TITLE} password.\n\n` +
      `Reset it within ${TOKEN_TTL_MINUTES} minutes:\n${link}\n\n` +
      `If you didn't request this, you can safely ignore this email.`,
    html:
      `<p>We received a request to reset your <strong>${APP_TITLE}</strong> password.</p>` +
      `<p><a href="${link}">Reset your password</a> — link valid for ${TOKEN_TTL_MINUTES} minutes.</p>` +
      `<p>If you didn't request this, you can safely ignore this email.</p>`,
  });
}

/**
 * Consume a reset token and set a new password. Returns true on success, false if the
 * token is unknown, expired, or already used. Single-use: the token is marked consumed.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<boolean> {
  const tokenHash = hashToken(token.trim());
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, consumedAt: true },
  });
  if (!record || record.consumedAt || record.expiresAt < new Date()) return false;

  await db.$transaction([
    db.user.update({
      where: { id: record.userId },
      data: { passwordHash: hashPassword(newPassword) },
    }),
    db.passwordResetToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
  ]);
  return true;
}
