export type EmailLocale = "en" | "zh";
export const DEFAULT_EMAIL_LOCALE: EmailLocale = "en";

/** Email has two maintained languages; unsupported or historical values use English. */
export function normalizeEmailLocale(value: unknown): EmailLocale {
  return value === "zh" ? "zh" : DEFAULT_EMAIL_LOCALE;
}

export function emailText<T>(locale: EmailLocale, copy: { en: T; zh: T }): T {
  return copy[normalizeEmailLocale(locale)];
}

/** Public signup takes only the selected supported UI cookie, never Accept-Language
 * or an actor's guessed language. Existing recipients use their account preference. */
export function emailLocaleFromHeaders(headers?: Headers): EmailLocale {
  const cookie = headers?.get("cookie");
  if (!cookie) return DEFAULT_EMAIL_LOCALE;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "NEXT_LOCALE") return normalizeEmailLocale(value.join("="));
  }
  return DEFAULT_EMAIL_LOCALE;
}
