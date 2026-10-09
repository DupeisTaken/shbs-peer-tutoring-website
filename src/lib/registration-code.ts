/** Browser-safe code normalization shared by entry fields and authoritative server lookups.
 * O aliases zero. Five-character codes also alias 1 to I; longer legacy hexadecimal
 * receipts and mailbox OTPs must retain their original digit 1 and persisted hashes. */
export function normalizeRegCode(raw: string): string {
  return normalizeRegCodeDraft(raw, false);
}

/** Legacy editors preserve digit 1 while a partial draft passes through length five. */
export function normalizeRegCodeDraft(
  raw: string,
  preserveLegacyDigits: boolean,
): string {
  const code = raw
    .trim()
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[^0-9A-Z]/g, "");
  // A legacy editor can pass through five characters while retyping a longer code.
  // Its final submission still uses the default authoritative length-based rule.
  return !preserveLegacyDigits && code.length === 5
    ? code.replace(/1/g, "I")
    : code;
}
