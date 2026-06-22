/**
 * Client-safe i18n constants (no `next/headers`, so this can be imported from client
 * components like the language switcher). The request config lives in ./request.ts.
 */
export const LOCALES = ["en", "zh", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
  es: "Español",
};

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
