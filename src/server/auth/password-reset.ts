/**
 * Forgot-password flow (token logic implemented; email delivery SCAFFOLDED).
 *
 * `issuePasswordReset` and `resetPassword` are fully functional against the database —
 * what's *not* wired up is sending the reset link by email (no provider is configured;
 * see src/server/email/sender.ts). Until then the link is logged server-side in dev so
 * the flow can be exercised end-to-end. Swap the `deliverResetLink` body for a real
 * `emailSender.send(...)` call when a provider is chosen.
 *
 * Node runtime only.
 */
import { createHash, randomBytes } from "crypto";

import { db } from "~/server/db";
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
 * SCAFFOLDING: deliver the reset link. No email provider is configured yet, so in
 * development we log the link; in production this is a no-op until a provider is wired.
 * TODO: replace with `emailSender.send({ to, subject, text })`.
 */
async function deliverResetLink(to: string, token: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[password-reset] (email not configured) reset link for ${to}: ` +
        `/reset-password?token=${token}`,
    );
  }
  return Promise.resolve();
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
