/**
 * Client-safe i18n constants (no `next/headers`, so this can be imported from client
 * components like the language switcher). The request config lives in ./request.ts.
 */
export const LOCALES = ["en", "zh", "es", "ja", "ko", "el", "de", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/**
 * A FIXED default time zone for date/time formatting. Must be a constant (not the host's local
 * zone) so the server and client agree — otherwise next-intl warns ENVIRONMENT_FALLBACK and dates
 * can hydrate mismatched. China Standard Time covers the program; change here to relocate.
 */
export const DEFAULT_TIME_ZONE = "Asia/Shanghai";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
  es: "Español",
  ja: "日本語",
  ko: "한국어",
  el: "Ελληνικά",
  de: "Deutsch",
  fr: "Français",
};

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
