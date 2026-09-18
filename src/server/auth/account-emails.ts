import { TRPCError } from "@trpc/server";
import { db } from "~/server/db";
import { lockAccountProfile } from "~/server/account-profile";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { rateLimit } from "~/server/rate-limit";
import { emailSender, isEmailDeliveryAvailable } from "~/server/email/sender";
import { verifyPassword } from "./password";
import { hashCode } from "./registration";
import { generateRegistrationCode, normalizeRegCode } from "./code";

export const MAX_SECONDARY_EMAILS = 5;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Pending challenges are account-local UI state, never ownership of an address.
 * Keep expired challenges visible for resend/cancel, without blocking another account.
 * The same union drives both the settings list and the five-secondary limit.
 */
export async function associatedAccountEmails(
  tx: TransactionDb,
  userId: string,
) {
  const [owned, pending] = await Promise.all([
    tx.accountEmail.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { email: true, verifiedAt: true },
    }),
    tx.emailVerificationCode.findMany({
      where: {
        userId,
        purpose: "SECONDARY_EMAIL",
        consumedAt: null,
        targetEmail: { not: null },
      },
      distinct: ["targetEmail"],
      orderBy: { createdAt: "asc" },
      select: { targetEmail: true },
    }),
  ]);
  const emails = new Map(owned.map((address) => [address.email, address]));
  for (const challenge of pending) {
    if (challenge.targetEmail && !emails.has(challenge.targetEmail))
      emails.set(challenge.targetEmail, {
        email: challenge.targetEmail,
        verifiedAt: null,
      });
  }
  return [...emails.values()];
}

/** All email writers lock User first; ownership is ultimately enforced by the address registry. */
export async function authenticateEmailAction(
  tx: TransactionDb,
  userId: string,
  password: string,
) {
  if (
    !rateLimit(`account-emails:${userId}`, { max: 15, windowMs: 15 * 60_000 })
      .ok
  )
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts. Try again later.",
    });
  await lockAccountProfile(tx, userId);
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash || !verifyPassword(password, user.passwordHash))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Current password is incorrect.",
    });
  return user;
}

/** Never infer participation ownership from an email. Check both current account and roster owners. */
export async function assertEmailAvailable(
  tx: TransactionDb,
  userId: string,
  email: string,
) {
  const me = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const [address, tutor, tutee] = await Promise.all([
    tx.accountEmail.findUnique({ where: { email } }),
    tx.tutor.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        id: { not: me.tutorId ?? "" },
      },
      select: { id: true },
    }),
    tx.tutee.findFirst({
      where: {
        email: { equals: email, mode: "insensitive" },
        id: { not: me.studentId ?? "" },
        user: { isNot: null },
      },
      select: { id: true },
    }),
  ]);
  if ((address && address.userId !== userId) || tutor || tutee)
    throw new TRPCError({
      code: "CONFLICT",
      message: "That address is unavailable.",
    });
}

/** Add/resend does not activate an alias. Each address gets its own expiring challenge. */
export async function requestSecondaryEmail(
  userId: string,
  inputEmail: string,
  password: string,
) {
  if (!isEmailDeliveryAvailable())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Email delivery is unavailable.",
    });
  const email = normalizeEmail(inputEmail);
  const code = generateRegistrationCode();
  const challenge = await db.$transaction(async (tx) => {
    const user = await authenticateEmailAction(tx, userId, password);
    if (email === user.email)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This is already your primary email.",
      });
    await assertEmailAvailable(tx, userId, email);
    const address = await tx.accountEmail.findUnique({ where: { email } });
    if (address?.verifiedAt)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This address is already verified.",
      });
    const emails = await associatedAccountEmails(tx, userId);
    if (
      !emails.some((entry) => entry.email === email) &&
      emails.length >= MAX_SECONDARY_EMAILS + 1
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "You can keep up to five secondary addresses. Remove one first.",
      });
    const recent = await tx.emailVerificationCode.findFirst({
      where: {
        userId,
        purpose: "SECONDARY_EMAIL",
        targetEmail: email,
        createdAt: { gt: new Date(Date.now() - 60_000) },
      },
    });
    if (recent)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Wait one minute before resending.",
      });
    await tx.emailVerificationCode.updateMany({
      where: {
        userId,
        purpose: "SECONDARY_EMAIL",
        targetEmail: email,
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });
    return tx.emailVerificationCode.create({
      data: {
        userId,
        purpose: "SECONDARY_EMAIL",
        targetEmail: email,
        codeHash: hashCode(code),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
  });
  try {
    await emailSender.send({
      to: email,
      subject: "Verify your secondary email",
      text: `Your verification code is ${code}. It expires in ten minutes. If you did not request this, ignore this message.`,
    });
  } catch (error) {
    // Retire only this failed delivery's challenge; never cancel a newer resend.
    await db.emailVerificationCode.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    throw error;
  }
}

export async function confirmSecondaryEmail(
  userId: string,
  inputEmail: string,
  code: string,
) {
  const email = normalizeEmail(inputEmail);
  return db.$transaction(async (tx) => {
    await lockAccountProfile(tx, userId);
    const row = await tx.emailVerificationCode.findFirst({
      where: {
        userId,
        purpose: "SECONDARY_EMAIL",
        targetEmail: email,
        consumedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!row || row.expiresAt <= new Date() || row.attempts >= 5) return false;
    if (hashCode(normalizeRegCode(code)) !== row.codeHash) {
      await tx.emailVerificationCode.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }
    // Different accounts can request the same address. Only proof can claim it,
    // with PostgreSQL's unique key also arbitrating races with legacy signup writers.
    await lockEntity(tx, `account-email:${email}`);
    const address = await tx.accountEmail.findUnique({ where: { email } });
    if (address?.userId === userId) return false;
    await assertEmailAvailable(tx, userId, email);
    const emails = await associatedAccountEmails(tx, userId);
    if (emails.length > MAX_SECONDARY_EMAILS + 1)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Remove a secondary address before adding another.",
      });
    const claimed = await tx.accountEmail.createMany({
      data: [{ email, userId, verifiedAt: new Date() }],
      skipDuplicates: true,
    });
    if (!claimed.count)
      throw new TRPCError({
        code: "CONFLICT",
        message: "That address is unavailable.",
      });
    await tx.emailVerificationCode.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    await tx.$executeRaw`SELECT queue_account_email(${userId}, 'security', 'secondary_added')`;
    return true;
  });
}

/** Changing the primary preserves ID/roles/history and only updates explicitly linked contact rows. */
export async function promoteEmail(
  tx: TransactionDb,
  userId: string,
  email: string,
) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  if (email === user.email) return;
  await assertEmailAvailable(tx, userId, email);
  const address = await tx.accountEmail.findUnique({ where: { email } });
  if (!address?.verifiedAt || address.userId !== userId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Verify this address before making it primary.",
    });
  await tx.user.update({
    where: { id: userId },
    data: { email, emailVerifiedAt: address.verifiedAt },
  });
  if (user.tutorId)
    await tx.tutor.update({ where: { id: user.tutorId }, data: { email } });
  if (user.studentId)
    await tx.tutee.update({ where: { id: user.studentId }, data: { email } });
}

export async function manageSecondaryEmail(
  userId: string,
  inputEmail: string,
  password: string,
  action: "primary" | "remove",
) {
  const email = normalizeEmail(inputEmail);
  await db.$transaction(async (tx) => {
    const user = await authenticateEmailAction(tx, userId, password);
    const address = await tx.accountEmail.findUnique({ where: { email } });
    const pending = await tx.emailVerificationCode.findFirst({
      where: {
        userId,
        purpose: "SECONDARY_EMAIL",
        targetEmail: email,
        consumedAt: null,
      },
    });
    if (address?.userId !== userId && !pending)
      throw new TRPCError({ code: "NOT_FOUND" });
    if (action === "primary") return promoteEmail(tx, userId, email);
    if (email === user.email)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose another primary email before removing this address.",
      });
    // A pending challenge can outlive a different person's successful claim.
    // Cancellation must never remove that person's verified registry row.
    if (address?.userId === userId)
      await tx.accountEmail.delete({ where: { email } });
    // The removed address cannot be recovered via an old grant, even if later re-added.
    await tx.passwordResetToken.updateMany({
      where: { userId, targetEmail: email, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.emailVerificationCode.updateMany({
      where: {
        userId,
        consumedAt: null,
        OR: [
          { targetEmail: email },
          { purpose: { in: ["LOGIN_2FA", "PASSWORD_CHANGE"] } },
        ],
      },
      data: { consumedAt: new Date() },
    });
    if (address?.userId === userId && address.verifiedAt)
      await tx.$executeRaw`SELECT queue_account_email(${userId}, 'security', 'secondary_removed')`;
  });
}
