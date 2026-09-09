import { TRPCError } from "@trpc/server";
import { rateLimit } from "~/server/rate-limit";
import { db } from "~/server/db";
import {
  inTransaction,
  lockEntity,
  type TransactionDb,
} from "~/server/transactions";
import { emailSender, isEmailDeliveryAvailable } from "~/server/email/sender";
import { hashCode } from "./registration";
import { generateRegistrationCode } from "./code";
import { verifyPassword } from "./password";

async function available(
  tx: TransactionDb,
  userId: string,
  email: string,
): Promise<void> {
  const me = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { tutorId: true },
  });
  const [account, tutor] = await Promise.all([
    tx.user.findUnique({ where: { email }, select: { id: true } }),
    tx.tutor.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if ((account && account.id !== userId) || (tutor && tutor.id !== me.tutorId))
    throw new TRPCError({
      code: "CONFLICT",
      message: "That email belongs to another account or tutor.",
    });
}

/** Reauthentication plus proof of the destination replaces unsafe email-only identity relinking. */
export async function requestEmailChange(
  userId: string,
  email: string,
  password: string,
): Promise<void> {
  if (
    !rateLimit(`email-change:password:${userId}`, {
      max: 5,
      windowMs: 15 * 60000,
    }).ok
  )
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts. Try again later.",
    });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash || !verifyPassword(password, user.passwordHash))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Current password is incorrect.",
    });
  if (!isEmailDeliveryAvailable())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Email delivery must be configured before changing an account email.",
    });
  const targetEmail = email.trim().toLowerCase();
  const code = generateRegistrationCode();
  await inTransaction(db, async (tx) => {
    await lockEntity(tx, `email-change:${userId}`);
    await available(tx, userId, targetEmail);
    const recent = await tx.emailVerificationCode.findFirst({
      where: {
        userId,
        purpose: "EMAIL_CHANGE",
        createdAt: { gt: new Date(Date.now() - 60000) },
      },
    });
    if (recent)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Wait one minute before requesting another code.",
      });
    await tx.emailVerificationCode.updateMany({
      where: { userId, purpose: "EMAIL_CHANGE", consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.emailVerificationCode.create({
      data: {
        userId,
        purpose: "EMAIL_CHANGE",
        targetEmail,
        codeHash: hashCode(code),
        expiresAt: new Date(Date.now() + 10 * 60000),
      },
    });
  });
  await emailSender.send({
    to: targetEmail,
    subject: "Verify your new account email",
    text: `Your email change code is ${code}. It expires in ten minutes.`,
  });
}

/** Code consumption and both sides of the User/Tutor identity change commit together. */
export async function confirmEmailChange(
  userId: string,
  code: string,
): Promise<boolean> {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, `email-change:${userId}`);
    const row = await tx.emailVerificationCode.findFirst({
      where: { userId, purpose: "EMAIL_CHANGE", consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!row?.targetEmail || row.expiresAt <= new Date() || row.attempts >= 5)
      return false;
    if (hashCode(code) !== row.codeHash) {
      await tx.emailVerificationCode.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }
    await available(tx, userId, row.targetEmail);
    const before = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await tx.emailVerificationCode.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    await tx.user.update({
      where: { id: userId },
      data: { email: row.targetEmail, emailVerifiedAt: new Date() },
    });
    if (before.tutorId)
      await tx.tutor.update({
        where: { id: before.tutorId },
        data: { email: row.targetEmail },
      });
    if (before.studentId) await tx.tutee.update({ where: { id: before.studentId }, data: { email: row.targetEmail } });
    await tx.auditLog.create({
      data: {
        userId,
        userName: before.name,
        action: "Verified account email change",
        entity: "User",
        entityId: userId,
      },
    });
    return true;
  });
}
