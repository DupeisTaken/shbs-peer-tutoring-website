import { signinIdentifiers } from "./signin-identifiers";
import { lockAccountProfile } from "~/server/account-profile";
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
import { emailOrigin } from "~/server/email/urls";
import { hashPassword } from "./password";
import { TRPCError } from "@trpc/server";
import { lockEntity } from "~/server/transactions";

/** Staff can resend setup to an existing account ID, never to a client-supplied address.
 * Uses the existing email-proof/password setup flow and does not alter any participation link. */
export async function issueAccountVerification(
  userId: string,
): Promise<{ emailed: boolean }> {
  if (!isEmailDeliveryAvailable("SECURITY")) return { emailed: false };
  const token = randomBytes(32).toString("hex");
  const email = await db.$transaction(async (tx) => {
    await lockEntity(tx, `account-verification:${userId}`);
    await lockAccountProfile(tx, userId);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mergedIntoId)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This login has been retired.",
      });
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
    category: "SECURITY",
    to: email,
    subject: `Verify and set up your ${APP_TITLE} account`,
    presentation: { action: { label: "Set up your account", url: link } },
    text: `The program team sent you an account setup link. Open it to verify this email and set your password. This does not change your tutor or tutee participation.\n\n${link}\n\nThe link expires in seven days. Ignore it if you did not request an account.`,
  });
  return { emailed: isEmailConfigured("SECURITY") };
}

/** How long an issued reset token stays valid. */
const TOKEN_TTL_MINUTES = 60;

/** New-account setup links live longer than a routine reset — the tutor may not be expecting it. */
const SETUP_TOKEN_TTL_MINUTES = 7 * 24 * 60; // 7 days

/** Base URL for links in emails (no trailing slash). */
function appBaseUrl(): string {
  return emailOrigin();
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
  if (!isEmailDeliveryAvailable("SECURITY")) return;

  const id = identifier.trim().toLowerCase();
  if (!id) return;

  const user = await db.user.findFirst({
    where: { mergedIntoId: null, OR: signinIdentifiers(id) },
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
      current.mergedIntoId ||
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
    category: "SECURITY",
    to,
    subject: `Reset your ${APP_TITLE} password`,
    text:
      `We received a request to reset your ${APP_TITLE} password.\n\n` +
      `Reset it within ${TOKEN_TTL_MINUTES} minutes:\n${link}\n\n` +
      `If you didn't request this, you can safely ignore this email.`,
    presentation: { action: { label: "Reset your password", url: link } },
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
      account.mergedIntoId ||
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
 * Invite an accountless tutor through recipient-owned redemption, or send deliberate recovery
 * for an existing linked login. Staff never receive a credential or bearer secret.
 */
export async function issueTutorSetupLink(
  tutorId: string,
  actorId: string,
): Promise<
  { ok: true; emailed: boolean } | { ok: false; error: "no-tutor" | "no-email" }
> {
  if (!isEmailDeliveryAvailable("SECURITY"))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Email delivery must be configured before sending account setup links.",
    });
  const tutor = await db.tutor.findUnique({
    where: { id: tutorId },
    include: { user: true },
  });
  if (!tutor) return { ok: false, error: "no-tutor" };
  const email = (tutor.user?.email ?? tutor.email)?.trim().toLowerCase();
  if (!email) return { ok: false, error: "no-email" };
  if (tutor.user) {
    // Existing-account recovery remains deliberate and never returns a bearer secret to staff.
    await issuePasswordReset(tutor.user.email);
    return { ok: true, emailed: true };
  }
  const { issueRegistrationCode, setEmailVerification } =
    await import("./registration");
  const { deliverAccountInvitation } = await import("./account-invitations");
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (actor?.role !== "HEAD" || actor.suspendedAt)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only Head can provision tutor access. Existing account setup links may be resent.",
    });
  // An accountless roster is not a login. Only recipient redemption creates credentials or links
  // participation; the staff action merely authorizes and delivers the typed Tutor invitation.
  await db.$transaction(
    async (tx) => {
      const { lockUsernameNamespace } = await import("./username");
      await lockUsernameNamespace(tx);
      await lockAccountProfile(tx, actor.id);
      const currentActor = await tx.user.findUnique({
        where: { id: actor.id },
      });
      if (currentActor?.role !== "HEAD" || currentActor.suspendedAt)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Head can provision tutor access.",
        });
      const issued = await issueRegistrationCode(
        {
          tutorId,
          email,
          kind: "TUTOR",
          issuedById: actor.id,
          issuedByName: actor.name,
        },
        tx,
      );
      const row = await tx.registrationCode.findUniqueOrThrow({
        where: { id: issued.id },
      });
      const staged = await setEmailVerification(row, email, tx);
      if (!staged.ok)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Invitation changed. Retry sending setup.",
        });
      const current = await tx.registrationCode.findUniqueOrThrow({
        where: { id: issued.id },
      });
      await deliverAccountInvitation(tx, {
        kind: "TUTOR",
        email,
        code: staged.emailCode,
        sourceKey: "staff:" + current.id + ":" + current.emailCodeHash,
        source: {
          type: "staff",
          id: current.id,
          challenge: current.emailCodeHash!,
        },
      });
    },
    { timeout: 20000 },
  );
  return { ok: true, emailed: true };
}
