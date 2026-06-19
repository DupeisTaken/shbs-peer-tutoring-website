/**
 * Email-based 2FA — second factor via a one-time code (SCAFFOLDING, NOT implemented).
 *
 * The architecture is in place so this can be turned on later as a localized change:
 *
 *   1. Sign-in flow (src/server/auth): after the password is verified in the
 *      Credentials `authorize`, if `user.twoFactorEnabled`, call `issueLoginCode`
 *      and route the user to an "enter the code" step instead of completing sign-in.
 *   2. `issueLoginCode` generates a numeric code, stores only its hash in the
 *      `EmailVerificationCode` table (purpose LOGIN_2FA, with `expiresAt`), and sends
 *      the plaintext via the `EmailSender` seam (src/server/email/sender.ts).
 *   3. The code-entry step calls `verifyLoginCode`, which checks the latest unconsumed,
 *      unexpired code (constant-time), increments `attempts`, marks it consumed, and
 *      only then issues the session.
 *
 * None of this is wired up yet — the functions below intentionally throw. The schema
 * (`EmailVerificationCode`, `User.twoFactorEnabled`) and the email seam already exist.
 */

/** Length of the emailed numeric code. */
export const CODE_LENGTH = 6;
/** How long an issued code stays valid. */
export const CODE_TTL_MINUTES = 10;
/** Max verification attempts before a code is rejected. */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * Issue and email a fresh login code for a user. TODO: generate a code, persist its
 * hash to `EmailVerificationCode`, and send the plaintext via `emailSender`
 * (src/server/email/sender.ts).
 */
export async function issueLoginCode(_userId: string): Promise<void> {
  throw new Error("Email-based 2FA is not implemented yet (issueLoginCode).");
}

/**
 * Verify a login code a user submitted. TODO: look up the latest unconsumed, unexpired
 * code, constant-time compare, mark it consumed, and enforce `MAX_CODE_ATTEMPTS`.
 */
export async function verifyLoginCode(
  _userId: string,
  _code: string,
): Promise<boolean> {
  throw new Error("Email-based 2FA is not implemented yet (verifyLoginCode).");
}
