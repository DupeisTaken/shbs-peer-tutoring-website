/**
 * Registration-code format helpers (pure — Node `crypto` only, no env/db imports, so the seed and
 * any tooling can import it freely).
 *
 * Codes are 5 characters from an uppercase alphanumeric alphabet (Steam-style):
 * digits 0, 2–9 and letters A–Z minus O/L. O aliases zero and 1 aliases I.
 * Codes remain bounded by single-use, expiry and per-IP/per-code rate limiting.
 */
import { randomInt } from "crypto";
export { normalizeRegCode } from "~/lib/registration-code";

/** Canonical uppercase alphanumerics — 0 and I are generated; O, 1 and L are not. */
export const REG_CODE_ALPHABET = "023456789ABCDEFGHIJKMNPQRSTUVWXYZ";
export const REG_CODE_LENGTH = 5;

/** A cryptographically-random 5-character code from the unambiguous alphabet. */
export function generateRegistrationCode(): string {
  // Rejection sampling keeps the canonical alphabet while ensuring every issued
  // code contains both a letter and a digit.
  for (;;) {
    let out = "";
    for (let i = 0; i < REG_CODE_LENGTH; i++) {
      out += REG_CODE_ALPHABET[randomInt(0, REG_CODE_ALPHABET.length)];
    }
    if (/[A-Z]/.test(out) && /[02-9]/.test(out)) return out;
  }
}
