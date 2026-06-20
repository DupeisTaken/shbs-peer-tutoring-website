"use server";

import { cookies } from "next/headers";

import { LOCALES, type Locale } from "~/i18n/config";

/** Persist the chosen UI locale in the `NEXT_LOCALE` cookie (read by src/i18n/request.ts). */
export async function setLocale(locale: string): Promise<void> {
  const value = (LOCALES as readonly string[]).includes(locale)
    ? (locale as Locale)
    : "en";
  const store = await cookies();
  store.set("NEXT_LOCALE", value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
