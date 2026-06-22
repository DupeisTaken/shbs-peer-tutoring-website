/**
 * Forgot-password flow. The reset link is emailed via the configured provider (Aliyun Direct
 * Mail — see src/server/email/sender.ts). When email isn't configured, the sender logs the
 * message in dev (so the link is still visible) and warns in production. Node runtime only.
 */
import { createHash, randomBytes } from "crypto";

import { db } from "~/server/db";
import { emailSender, isEmailConfigured } from "~/server/email/sender";
import { APP_TITLE } from "~/lib/branding";
import { hashPassword } from "./password";

/** How long an issued reset token stays valid. */
const TOKEN_TTL_MINUTES = 60;

/** New-account setup links live longer than a routine reset — the tutor may not be expecting it. */
const SETUP_TOKEN_TTL_MINUTES = 7 * 24 * 60; // 7 days

/** Base URL for links in emails (no trailing slash). */
function appBaseUrl(): string {
  return (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

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
  const link = `${appBaseUrl()}/reset-password?token=${token}`;

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
/**
 * Consume a reset token and set a new password. On success returns the account's sign-in
 * identifiers (linked tutor username, if any, + email) so the UI can remind the user of the
 * username tied to the email they just proved they control. Returns null on an invalid/expired
 * token. Verifying the emailed link IS the email check.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ username: string | null; email: string } | null> {
  const tokenHash = hashToken(token.trim());
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, consumedAt: true },
  });
  if (!record || record.consumedAt || record.expiresAt < new Date()) return null;

  const updated = await db.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: hashPassword(newPassword),
        // Setting a real password via the emailed link also clears the temp-password flag and
        // marks the email confirmed — so an invited tutor lands straight on the dashboard rather
        // than being bounced back through the onboarding gate.
        mustChangePassword: false,
        emailVerifiedAt: new Date(),
      },
      select: { email: true, tutor: { select: { username: true } } },
    });
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return user;
  });
  return { username: updated.tutor?.username ?? null, email: updated.email };
}

/**
 * Provision (if needed) and invite a tutor to set up their login. Ensures a `User` exists for
 * the tutor — reusing one already on their email, else creating a `TUTOR` account linked to the
 * tutor — then issues a longer-lived setup token and emails a "set your password" link. Returns
 * the link so the admin can copy it (handy when email delivery isn't configured — the sender
 * only logs in dev). Requires the tutor to have an email.
 */
export async function issueTutorSetupLink(tutorId: string): Promise<
  | { ok: true; emailed: boolean; link: string }
  | { ok: false; error: "no-tutor" | "no-email" }
> {
  const tutor = await db.tutor.findUnique({
    where: { id: tutorId },
    select: { id: true, email: true, englishName: true, user: { select: { id: true } } },
  });
  if (!tutor) return { ok: false, error: "no-tutor" };
  const email = tutor.email?.trim().toLowerCase();
  if (!email) return { ok: false, error: "no-email" };

  let userId = tutor.user?.id ?? null;
  if (!userId) {
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      await db.user.update({ where: { id: existing.id }, data: { tutorId: tutor.id } });
      userId = existing.id;
    } else {
      const created = await db.user.create({
        data: {
          email,
          name: tutor.englishName,
          role: "TUTOR",
          tutorId: tutor.id,
          mustChangePassword: true,
        },
        select: { id: true },
      });
      userId = created.id;
    }
  }

  const token = randomBytes(32).toString("hex");
  await db.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SETUP_TOKEN_TTL_MINUTES * 60_000),
    },
  });

  const link = `${appBaseUrl()}/reset-password?token=${token}`;
  await emailSender.send({
    to: email,
    subject: `Set up your ${APP_TITLE} account`,
    text:
      `An account has been created for you on ${APP_TITLE}.\n\n` +
      `Set your password to finish setting up (link valid for 7 days):\n${link}\n\n` +
      `After that you can sign in with this email or your username.`,
    html:
      `<p>An account has been created for you on <strong>${APP_TITLE}</strong>.</p>` +
      `<p><a href="${link}">Set your password</a> to finish setting up — link valid for 7 days.</p>` +
      `<p>After that you can sign in with this email or your username.</p>`,
  });

  return { ok: true, emailed: isEmailConfigured(), link };
}
