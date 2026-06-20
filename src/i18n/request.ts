import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

/**
 * Request-scoped i18n config (no locale routing — the active locale comes from the
 * `NEXT_LOCALE` cookie, so the auth middleware matcher is untouched). Messages live in
 * /messages/<locale>.json. An optional `MESSAGES_OVERRIDE` env (deep-merged JSON) lets an
 * org white-label any string without editing the locale files.
 */
const LOADERS: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import("../../messages/en.json"),
  zh: () => import("../../messages/zh.json"),
};

const COOKIE = "NEXT_LOCALE";

/** Recursively merge `override` onto `base` (override wins for non-object leaves). */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const existing = out[k];
    if (
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      v &&
      typeof v === "object" &&
      !Array.isArray(v)
    ) {
      out[k] = deepMerge(
        existing as Record<string, unknown>,
        v as Record<string, unknown>,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}

function loadOverride(): Record<string, unknown> {
  const raw = process.env.MESSAGES_OVERRIDE;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // ignore malformed override
  }
  return {};
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(COOKIE)?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  const base = (await LOADERS[locale]()).default;
  const messages = deepMerge(base, loadOverride());

  return { locale, messages };
});
