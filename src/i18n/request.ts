import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

import { db } from "~/server/db";
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
  es: () => import("../../messages/es.json"),
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

/** Deep-set a dot-path key (e.g. "admin.users.title") to a string value, creating objects. */
function setByPath(obj: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split(".");
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    const next = node[k];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      node[k] = {};
    }
    node = node[k] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
}

/**
 * In-app translation overrides (edited on /localization). Applied on top of the bundled JSON +
 * env override. Wrapped so a missing table / DB hiccup never breaks rendering — text just falls
 * back to the bundled messages.
 */
async function applyDbOverrides(
  messages: Record<string, unknown>,
  locale: string,
): Promise<void> {
  try {
    const rows = await db.messageOverride.findMany({
      where: { locale },
      select: { key: true, value: true },
    });
    for (const { key, value } of rows) setByPath(messages, key, value);
  } catch {
    // No overrides table yet / transient DB error — fall back to bundled messages.
  }
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
  await applyDbOverrides(messages, locale);

  return { locale, messages };
});
