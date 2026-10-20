/** Browser-safe normalization. Numeric codes retain every digit, including leading
 * zeros and 1. Mixed legacy five-character codes retain their O/1 aliases. */
export function normalizeRegCode(raw: string): string {
  return normalizeRegCodeDraft(raw, false);
}

/** A separate mailbox contract preserves outstanding challenges' aliases.
 * Persisted recipient/purpose records, never length, authorize these values. */
export function normalizeEmailCode(raw: string): string {
  return normalizeRegCodeDraft(raw, false);
}

/** Legacy shapes are input compatibility only; stored hashes still decide validity. */
export const EMAIL_CODE_PATTERN =
  "(?:[0-9]{4}|[0-9A-Z]{5}|[0-9A-F]{6}|[0-9A-F]{12})";
export function isEmailCodeFormat(raw: string): boolean {
  return new RegExp(`^${EMAIL_CODE_PATTERN}$`).test(normalizeEmailCode(raw));
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
  return !preserveLegacyDigits && code.length === 5 && /[A-Z]/.test(code)
    ? code.replace(/1/g, "I")
    : code;
}
