/**
 * Client-safe i18n constants (no `next/headers`, so this can be imported from client
 * components like the language switcher). The request config lives in ./request.ts.
 */
export const LOCALES = ["en", "zh", "es", "ja", "ko", "el", "de", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Languages that are ready for the public picker on a fresh install. Other bundled catalogs stay
 * available to translators, but start hidden until a language manager publishes them.
 */
export const DEFAULT_ENABLED_LOCALES: readonly Locale[] = ["en", "zh"];

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

export function isDefaultEnabledLocale(value: string): boolean {
  return (DEFAULT_ENABLED_LOCALES as readonly string[]).includes(value);
}
