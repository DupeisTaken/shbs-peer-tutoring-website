/**
 * Password hashing for the Credentials provider. Dependency-free (Node's built-in
 * `crypto` scrypt) so there is no native module to build on Windows/Docker.
 *
 * Node runtime only — never import this into edge code (e.g. `middleware.ts`).
 *
 * Stored format: `scrypt$<salt-hex>$<hash-hex>`.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;
const SCHEME = "scrypt";

/** Hash a plaintext password with a fresh random salt. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${SCHEME}$${salt}$${derived}`;
}

/** Constant-time verify of a plaintext password against a stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== SCHEME || !salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const derived = scryptSync(password, salt, KEY_LENGTH);
  // timingSafeEqual throws on length mismatch — guard first.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
