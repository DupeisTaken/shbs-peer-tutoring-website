import { expect } from "vitest";

/** Numeric OTPs can coincidentally occur inside timestamps, IDs and hashes.
 * Inspect JSON fields instead: reject code/proof fields and secret-valued leaves,
 * including a secret copied under an unexpected key. */
export function expectNoCodeSecrets(value: unknown, secrets: readonly string[]) {
  if (typeof value === "string") {
    expect(secrets).not.toContain(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) expectNoCodeSecrets(entry, secrets);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      expect(key).not.toMatch(
        /^(?:code|codeHash|emailCode|emailCodeHash|proof|completionProof|token|tokenHash)$/i,
      );
      expectNoCodeSecrets(entry, secrets);
    }
  }
}
