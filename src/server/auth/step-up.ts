/**
 * Step-up verification via an emailed one-time code.
 *
 * Used to re-confirm a signed-in user before a sensitive change — currently changing a password
 * (purpose PASSWORD_CHANGE). A fresh 6-digit code is emailed; only its HMAC hash is stored in
 * `EmailVerificationCode` (keyed with AUTH_SECRET, never the plaintext). Verification is
 * constant-time, single-use, expiring, and attempt-capped.
 *
 * When email isn't configured, the shared sender logs the code in development. Production fails
 * closed before creating a code so a sensitive flow cannot claim that undeliverable mail was sent.
 *
 * Node runtime only (DB + Node crypto + SMTP).
 */
import { timingSafeEqual } from "crypto";
import type { VerificationPurpose } from "../../../generated/prisma";

import { db } from "~/server/db";
import { emailSender, isEmailDeliveryAvailable } from "~/server/email/sender";
import { APP_TITLE } from "~/lib/branding";
import { hashCode } from "./registration";
import { generateRegistrationCode } from "./code";

/** How long an emailed step-up code stays valid. */
export const STEP_UP_CODE_TTL_MINUTES = 15;
/** Max guesses before a code is rejected (defence in depth). */
const MAX_STEP_UP_ATTEMPTS = 6;

/** Constant-time compare of two hex-encoded HMAC hashes. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Issue and email a fresh step-up code for a user. Supersedes any earlier unconsumed code for the
 * same purpose (they're deleted first, so only the newest is valid). Returns the user's email so
 * the caller can show a masked "sent to …" hint.
 */
export async function issueStepUpCode(
  userId: string,
  purpose: VerificationPurpose,
): Promise<{ email: string }> {
  if (!isEmailDeliveryAvailable()) {
    throw new Error(
      "Email delivery is unavailable; refusing to issue a step-up code.",
    );
  }

  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, name: true },
  });

  const code = generateRegistrationCode();
  const expiresAt = new Date(Date.now() + STEP_UP_CODE_TTL_MINUTES * 60_000);

  await db.$transaction([
    db.emailVerificationCode.deleteMany({
      where: { userId, purpose, consumedAt: null },
    }),
    db.emailVerificationCode.create({
      data: { userId, purpose, codeHash: hashCode(code), expiresAt },
    }),
  ]);

  await emailSender.send({
    to: user.email,
    subject: `${APP_TITLE}: your verification code`,
    text:
      `Hi ${user.name ?? "there"},\n\n` +
      `Your verification code is ${code}. It expires in ${STEP_UP_CODE_TTL_MINUTES} minutes.\n\n` +
      `If you didn't request this, you can ignore this email — your password hasn't changed.`,
  });

  return { email: user.email };
}

export type StepUpError =
  "no-code" | "expired" | "too-many-attempts" | "incorrect";

/**
 * Verify a step-up code. Checks the latest unconsumed code for the purpose; on success marks it
 * consumed and returns ok. A wrong guess increments `attempts` and fails closed once the cap is
 * hit. Returns a typed error reason rather than throwing, so callers can map it to a message.
 */
export async function verifyStepUpCode(
  userId: string,
  purpose: VerificationPurpose,
  code: string,
): Promise<{ ok: true } | { ok: false; error: StepUpError }> {
  const row = await db.emailVerificationCode.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, error: "no-code" };
  if (row.expiresAt < new Date()) return { ok: false, error: "expired" };
  if (row.attempts >= MAX_STEP_UP_ATTEMPTS)
    return { ok: false, error: "too-many-attempts" };

  if (!hashesEqual(row.codeHash, hashCode(code))) {
    await db.emailVerificationCode.updateMany({
      where: {
        id: row.id,
        consumedAt: null,
        attempts: { lt: MAX_STEP_UP_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, error: "incorrect" };
  }

  const consumed = await db.emailVerificationCode.updateMany({
    where: {
      id: row.id,
      consumedAt: null,
      attempts: { lt: MAX_STEP_UP_ATTEMPTS },
      expiresAt: { gte: new Date() },
    },
    data: { consumedAt: new Date() },
  });
  return consumed.count === 1 ? { ok: true } : { ok: false, error: "no-code" };
}
