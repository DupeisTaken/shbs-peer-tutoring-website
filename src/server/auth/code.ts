/**
 * Registration-code format helpers (pure — Node `crypto` only, no env/db imports, so the seed and
 * any tooling can import it freely).
 *
 * Invitations use the legacy mixed alphanumeric alphabet; mailbox challenges use four digits.
 * Both remain strings so their canonical characters, including leading zeros, survive.
 * Codes remain bounded by single-use, expiry and per-IP/per-code rate limiting.
 */
import { randomInt } from "crypto";
export { normalizeRegCode, normalizeEmailCode } from "~/lib/registration-code";

/** Canonical uppercase alphanumerics — 0 and I are generated; O, 1 and L are not. */
export const REG_CODE_ALPHABET = "023456789ABCDEFGHIJKMNPQRSTUVWXYZ";
export const REG_CODE_LENGTH = 5;
export const EMAIL_CODE_LENGTH = 4;

/** Rejection sampling preserves a uniform distribution among mixed five-character
 * codes. Bound retries so a faulty random source cannot hold a request open. */
export function generateRegistrationCode(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = "";
    for (let index = 0; index < REG_CODE_LENGTH; index++) {
      code += REG_CODE_ALPHABET[randomInt(0, REG_CODE_ALPHABET.length)];
    }
    if (/[A-Z]/.test(code) && /[0-9]/.test(code)) return code;
  }
  throw new Error("Could not generate a mixed registration code.");
}

/** Per-flow caps stay at five/six guesses to preserve outstanding challenges' budgets.
 * Four digits give 0.05%–0.06% per challenge; recipient/IP limits and expiry also apply.
 * randomInt uses unbiased cryptographic sampling; padding preserves leading zeros. */
export function generateEmailVerificationCode(): string {
  return randomInt(0, 10 ** EMAIL_CODE_LENGTH)
    .toString()
    .padStart(EMAIL_CODE_LENGTH, "0");
}
