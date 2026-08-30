/**
 * Email-based login 2FA via a one-time code.
 *
 * Codes use the same 5-character unambiguous alphanumeric format as registration keys. Only the
 * HMAC hash is stored, codes are single-use, and each new login code supersedes older unconsumed
 * login codes for the same user.
 */
import { timingSafeEqual } from "crypto";

import { APP_TITLE } from "~/lib/branding";
import { db } from "~/server/db";
import { emailSender, isEmailDeliveryAvailable } from "~/server/email/sender";
import {
  generateRegistrationCode,
  normalizeRegCode,
  REG_CODE_LENGTH,
} from "./code";
import { hashCode } from "./registration";

/** Length of the emailed code. */
export const CODE_LENGTH = REG_CODE_LENGTH;
/** How long an issued code stays valid. */
export const CODE_TTL_MINUTES = 10;
/** Max verification attempts before a code is rejected. */
export const MAX_CODE_ATTEMPTS = 5;

function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Issue and email a fresh login code for a user. Returns the target email for masked UI hints. */
export async function issueLoginCode(
  userId: string,
): Promise<{ email: string }> {
  if (!isEmailDeliveryAvailable()) {
    throw new Error(
      "Email delivery is unavailable; refusing to issue a login code.",
    );
  }

  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, name: true },
  });

  const code = generateRegistrationCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

  await db.$transaction([
    db.emailVerificationCode.deleteMany({
      where: { userId, purpose: "LOGIN_2FA", consumedAt: null },
    }),
    db.emailVerificationCode.create({
      data: {
        userId,
        purpose: "LOGIN_2FA",
        codeHash: hashCode(code),
        expiresAt,
      },
    }),
  ]);

  await emailSender.send({
    to: user.email,
    subject: `${APP_TITLE}: your sign-in code`,
    text:
      `Hi ${user.name ?? "there"},\n\n` +
      `Your sign-in code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.\n\n` +
      "If you did not just try to sign in, change your password or contact the program team.",
  });

  return { email: user.email };
}

/** Verify and consume the latest unexpired login code for a user. */
export async function verifyLoginCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const row = await db.emailVerificationCode.findFirst({
    where: { userId, purpose: "LOGIN_2FA", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return false;
  if (row.expiresAt < new Date()) return false;
  if (row.attempts >= MAX_CODE_ATTEMPTS) return false;

  if (!hashesEqual(row.codeHash, hashCode(normalizeRegCode(code)))) {
    await db.emailVerificationCode.updateMany({
      where: {
        id: row.id,
        consumedAt: null,
        attempts: { lt: MAX_CODE_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    return false;
  }

  // The conditional write is the single-use boundary: concurrent correct submissions can both
  // read the row, but only one is allowed to transition it from unconsumed to consumed.
  const consumed = await db.emailVerificationCode.updateMany({
    where: {
      id: row.id,
      consumedAt: null,
      attempts: { lt: MAX_CODE_ATTEMPTS },
      expiresAt: { gte: new Date() },
    },
    data: { consumedAt: new Date() },
  });
  return consumed.count === 1;
}
