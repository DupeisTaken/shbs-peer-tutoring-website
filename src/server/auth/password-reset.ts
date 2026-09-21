import { signinIdentifiers } from "./signin-identifiers";
import { lockAccountProfile } from "~/server/account-profile";
import { updateAccountProfile } from "~/server/account-profile";
/**
 * Forgot-password flow. The reset link is emailed via the configured provider (Aliyun Direct
 * Mail — see src/server/email/sender.ts). When email isn't configured, the sender logs the
 * message in dev (so the link is still visible) and warns in production. Node runtime only.
 */
import { createHash, randomBytes } from "crypto";

import { db } from "~/server/db";
import {
  emailSender,
  isEmailConfigured,
  isEmailDeliveryAvailable,
} from "~/server/email/sender";
import { APP_TITLE } from "~/lib/branding";
import { hashPassword } from "./password";
import { ensureUniqueUsername, ensureUserUsername } from "./username";
import { TRPCError } from "@trpc/server";
import { lockEntity } from "~/server/transactions";

/** Staff can resend setup to an existing account ID, never to a client-supplied address.
 * Uses the existing email-proof/password setup flow and does not alter any participation link. */
export async function issueAccountVerification(
  userId: string,
): Promise<{ emailed: boolean }> {
  if (!isEmailDeliveryAvailable()) return { emailed: false };
  const token = randomBytes(32).toString("hex");
  const email = await db.$transaction(async (tx) => {
    await lockEntity(tx, `account-verification:${userId}`);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This account email is already verified.",
      });
    const recent = await tx.passwordResetToken.count({
      where: { userId, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Wait one minute before sending another verification link.",
      });
    await tx.passwordResetToken.create({
      data: {
        userId,
        targetEmail: user.email,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SETUP_TOKEN_TTL_MINUTES * 60_000),
      },
    });
    return user.email;
  });
  const link = `${appBaseUrl()}/reset-password?token=${token}`;
  await emailSender.send({
    to: email,
    subject: `Verify and set up your ${APP_TITLE} account`,
    text: `The program team sent you an account setup link. Open it to verify this email and set your password. This does not change your tutor or tutee participation.\n\n${link}\n\nThe link expires in seven days. Ignore it if you did not request an account.`,
  });
  return { emailed: isEmailConfigured() };
}

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
  if (!isEmailDeliveryAvailable()) return;

  const id = identifier.trim().toLowerCase();
  if (!id) return;

  const user = await db.user.findFirst({
    where: { OR: signinIdentifiers(id) },
    select: {
      id: true,
      email: true,
      emails: { where: { verifiedAt: { not: null } }, select: { email: true } },
    },
  });
  if (!user) return; // silently no-op — don't reveal whether the account exists

  const targetEmail = user.emails.some((address) => address.email === id)
    ? id
    : user.email;
  const token = randomBytes(32).toString("hex");
  const issued = await db.$transaction(async (tx) => {
    await lockAccountProfile(tx, user.id);
    const address = await tx.accountEmail.findUnique({
      where: { email: targetEmail },
    });
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (
      address?.userId !== user.id ||
      (current.email !== targetEmail && !address.verifiedAt)
    )
      return false;
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        targetEmail,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000),
      },
    });
    return true;
  });
  if (issued) await deliverResetLink(targetEmail, token);
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
  });
  if (!record) return null;
  return db.$transaction(async (tx) => {
    await lockAccountProfile(tx, record.userId);
    const grant = await tx.passwordResetToken.findUnique({
      where: { id: record.id },
    });
    if (
      !grant ||
      grant.consumedAt ||
      grant.expiresAt <= new Date() ||
      !grant.targetEmail
    )
      return null;
    const account = await tx.user.findUniqueOrThrow({
      where: { id: grant.userId },
    });
    const address = await tx.accountEmail.findUnique({
      where: { email: grant.targetEmail },
    });
    if (
      address?.userId !== account.id ||
      (address.email !== account.email && !address.verifiedAt)
    )
      return null;
    const updated = await tx.user.update({
      where: { id: account.id },
      data: {
        passwordHash: hashPassword(newPassword),
        mustChangePassword: false,
        ...(address.email === account.email
          ? { emailVerifiedAt: new Date() }
          : {}),
      },
      select: {
        email: true,
        username: true,
        tutor: { select: { username: true } },
      },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: account.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return {
      username: updated.username ?? updated.tutor?.username ?? null,
      email: updated.email,
    };
  });
}

/**
 * Provision (if needed) and invite a tutor to set up their login. Ensures a `User` exists for
 * the tutor — reusing one already on their email, else creating a `TUTOR` account linked to the
 * tutor — then issues a longer-lived setup token and emails a "set your password" link. Returns
 * the link so the admin can copy it (handy when email delivery isn't configured — the sender
 * only logs in dev). Requires the tutor to have an email.
 */
export async function issueTutorSetupLink(
  tutorId: string,
  actorId: string,
): Promise<
  | { ok: true; emailed: boolean; link: string }
  | { ok: false; error: "no-tutor" | "no-email" }
> {
  const tutor = await db.tutor.findUnique({
    where: { id: tutorId },
    select: {
      id: true,
      email: true,
      englishName: true,
      alternativeNames: true,
      username: true,
      user: { select: { id: true } },
    },
  });
  if (!tutor) return { ok: false, error: "no-tutor" };
  const email = tutor.email?.trim().toLowerCase();
  if (!email) return { ok: false, error: "no-email" };

  let userId = tutor.user?.id ?? null;
  if (!userId) {
    const actor = await db.user.findUnique({ where: { id: actorId }, select: { role: true, suspendedAt: true } });
    if (actor?.role !== "HEAD" || actor.suspendedAt)
      throw new TRPCError({ code: "FORBIDDEN", message: "Only Head can provision tutor access. Existing account setup links may be resent." });
    const existing = await db.user.findUnique({
      where: { email },
      select: { id: true, role: true, tutorId: true },
    });
    if (existing) {
      if (existing.role === "VIEWER" || (existing.tutorId && existing.tutorId !== tutor.id))
        throw new TRPCError({ code: "CONFLICT", message: "Review the existing account membership before linking this tutor." });
      await db.user.update({
        where: { id: existing.id },
        data: { tutorId: tutor.id, tutorAccessRevoked: false },
      });
      userId = existing.id;
    } else {
      // Mirror the tutor's handle onto the login (unique across both spaces).
      const username = await ensureUniqueUsername(
        tutor.username ?? tutor.englishName,
      );
      const created = await db.user.create({
        data: {
          email,
          username,
          name: tutor.englishName,
          alternativeNames: tutor.alternativeNames,
          role: "TUTOR",
          tutorId: tutor.id,
          mustChangePassword: true,
        },
        select: { id: true },
      });
      userId = created.id;
    }
  }
  await updateAccountProfile(db, userId);
  // Make sure the (possibly pre-existing) login carries a username.
  await ensureUserUsername(userId);

  const token = randomBytes(32).toString("hex");
  await db.passwordResetToken.create({
    data: {
      userId,
      targetEmail: email,
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
