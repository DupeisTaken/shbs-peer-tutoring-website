"use server";

import { cookies } from "next/headers";

import { DEFAULT_LOCALE } from "~/i18n/config";
import { listLanguages } from "~/server/i18n/languages";

/** Persist the chosen UI locale in the `NEXT_LOCALE` cookie (read by src/i18n/request.ts). */
export async function setLocale(locale: string): Promise<void> {
  // Validate on the server so stale clients cannot persist a hidden or unknown language.
  const languages = await listLanguages();
  const value = languages.some((language) => language.code === locale)
    ? locale
    : DEFAULT_LOCALE;
  const store = await cookies();
  store.set("NEXT_LOCALE", value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
