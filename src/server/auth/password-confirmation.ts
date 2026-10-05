import { TRPCError } from "@trpc/server";
import { rateLimit } from "~/server/rate-limit";
import { verifyPassword } from "./password";

export const PASSWORD_CONFIRMATION_MAX_LENGTH = 1024;
export const PASSWORD_CONFIRMATION_MAX_ATTEMPTS = 10;
export const PASSWORD_CONFIRMATION_WINDOW_MS = 15 * 60_000;

/** All authenticated password checks share the caller's stable account ID, never an IP,
 * action name, session or target account. Reserve before synchronous scrypt; a failed
 * surrounding transaction must not refund the attempt. Success also consumes a slot:
 * later MFA/action failures cannot turn a correct password into an unlimited hash path.
 * Recovery is expiry only; denied calls do not slide the window forward. This uses the
 * application's single-process limiter (restart resets it; replicas require shared storage).
 */
export function verifyPasswordConfirmation(
  userId: string,
  password: string,
  passwordHash: string | null,
): passwordHash is string {
  // Enforce at the hashing boundary as well as route schemas: internal callers count too.
  if (!password || password.length > PASSWORD_CONFIRMATION_MAX_LENGTH)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a password of 1–1024 characters." });
  if (!rateLimit(`password-confirmation:${userId}`, {
    max: PASSWORD_CONFIRMATION_MAX_ATTEMPTS,
    windowMs: PASSWORD_CONFIRMATION_WINDOW_MS,
  }).ok)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many password confirmations. Wait fifteen minutes before trying again.",
    });
  return !!passwordHash && verifyPassword(password, passwordHash);
}
