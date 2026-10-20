/**
 * Registration-code format helpers (pure — Node `crypto` only, no env/db imports, so the seed and
 * any tooling can import it freely).
 *
 * Invitations and mailbox challenges use separate numeric contracts. Strings retain zeros.
 * Codes remain bounded by single-use, expiry and per-IP/per-code rate limiting.
 */
import { randomInt } from "crypto";
export { normalizeRegCode, normalizeEmailCode } from "~/lib/registration-code";

export const REG_CODE_ALPHABET = "0123456789";
export const REG_CODE_LENGTH = 5;
export const EMAIL_CODE_LENGTH = 4;
/** randomInt uses unbiased cryptographic sampling; padding preserves leading zeros. */
export function generateRegistrationCode(): string {
  return randomInt(0, 10 ** REG_CODE_LENGTH)
    .toString()
    .padStart(REG_CODE_LENGTH, "0");
}

/** Per-flow caps stay at five/six guesses to preserve outstanding challenges' budgets.
 * Four digits give 0.05%–0.06% per challenge; recipient/IP limits and expiry also apply. */
export function generateEmailVerificationCode(): string {
  return randomInt(0, 10 ** EMAIL_CODE_LENGTH)
    .toString()
    .padStart(EMAIL_CODE_LENGTH, "0");
}
