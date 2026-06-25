/**
 * Registration-code format helpers (pure — Node `crypto` only, no env/db imports, so the seed and
 * any tooling can import it freely).
 *
 * Codes are 5 characters from an unambiguous uppercase alphanumeric alphabet (Steam-style):
 * digits 2–9 and letters A–Z minus the look-alikes 0/O, 1/I/L. ~31^5 ≈ 28.6M combinations —
 * far larger than the old 6-digit numeric space, and still bounded by single-use, a 7-day expiry,
 * and per-IP/per-code rate limiting. The character set is easy to read aloud and type.
 */
import { randomInt } from "crypto";

/** Unambiguous uppercase alphanumerics — no 0/O, 1/I/L. */
export const REG_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REG_CODE_LENGTH = 5;

/** A cryptographically-random 5-character code from the unambiguous alphabet. */
export function generateRegistrationCode(): string {
  let out = "";
  for (let i = 0; i < REG_CODE_LENGTH; i++) {
    out += REG_CODE_ALPHABET[randomInt(0, REG_CODE_ALPHABET.length)];
  }
  return out;
}

/** Normalize user input: trim, uppercase, drop separators/spaces. Validity is checked by lookup. */
export function normalizeRegCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}
