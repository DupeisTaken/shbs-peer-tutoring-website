/**
 * Shared next-intl error / missing-message handling (client-safe — no server imports, so both the
 * server request config and the client provider use the same behavior).
 *
 * Policy: a missing translation key is NOT a hard error and is NOT silently blanked. It renders as
 * a highlighted placeholder of its ORIGINAL dot-path key (e.g. `⟦admin.users.title⟧`) so gaps are
 * obvious in the UI. Real problems (malformed ICU, etc.) still surface. The locale-parity test
 * (`src/i18n/locales.test.ts`) catches missing keys at build/test time so placeholders shouldn't
 * appear in practice — this is the runtime safety net.
 */

/** Wrap a key so a missing translation is unmistakable on screen. */
export function missingKeyPlaceholder(fullKey: string): string {
  return `⟦${fullKey}⟧`;
}

/** next-intl `getMessageFallback`: render the full (namespaced) key as a highlighted placeholder. */
export function getMessageFallback(info: { namespace?: string; key: string }): string {
  const full = info.namespace ? `${info.namespace}.${info.key}` : info.key;
  return missingKeyPlaceholder(full);
}

/**
 * next-intl `onError`: swallow MISSING_MESSAGE (we render the key placeholder instead) so it never
 * throws or floods logs; surface every other error code (e.g. malformed ICU) so it isn't hidden.
 */
export function onIntlError(error: { code?: string }): void {
  if (error?.code === "MISSING_MESSAGE") return;
  console.error(error);
}
