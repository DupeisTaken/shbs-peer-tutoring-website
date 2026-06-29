import { type db as DbClient } from "~/server/db";
import { APP_TITLE } from "~/lib/branding";

/**
 * The editable landing page (/). Two text patterns live here:
 *
 *   • Fixed text slots (this file) — hero, CTAs, feature cards. Each slot is a `HomeContent` row
 *     keyed by (key, locale); a missing row falls back to the bundled `messages/*.json`
 *     `landing.<key>` default, so an unconfigured program still renders and clearing an override
 *     reverts to the default. Edited on /admin/landing (translatorProcedure).
 *   • The program-news feed lives in ./news.ts.
 *
 * `HOME_FIELDS` is the single source of truth for which slots exist — shared by the admin editor,
 * the write procedure's key validation, and the landing renderer.
 */

export type HomeFieldKind = "line" | "multiline" | "image";

export interface HomeField {
  /** Stable storage key; for text slots this is also the `landing.<key>` i18n default. */
  key: string;
  kind: HomeFieldKind;
  /** Image slots are locale-agnostic — always stored/read at GLOBAL_LOCALE. */
  global?: boolean;
  /** The bundled default contains the `{appTitle}` placeholder. */
  hasAppTitle?: boolean;
}

/** Locale under which locale-agnostic (image) slots are stored. */
export const GLOBAL_LOCALE = "en";

export const HOME_FIELDS: readonly HomeField[] = [
  { key: "tagline", kind: "line" },
  { key: "heroTitle", kind: "line" },
  { key: "intro", kind: "multiline", hasAppTitle: true },
  { key: "ctaPrimary", kind: "line" },
  { key: "ctaSecondary", kind: "line" },
  { key: "heroImageId", kind: "image", global: true },
  { key: "features.students.title", kind: "line" },
  { key: "features.students.body", kind: "multiline" },
  { key: "features.tutors.title", kind: "line" },
  { key: "features.tutors.body", kind: "multiline" },
  { key: "features.team.title", kind: "line" },
  { key: "features.team.body", kind: "multiline" },
  { key: "footer", kind: "multiline", hasAppTitle: true },
] as const;

export const HOME_FIELD_KEYS = HOME_FIELDS.map((f) => f.key);
const FIELD_BY_KEY = new Map(HOME_FIELDS.map((f) => [f.key, f]));

export function isHomeFieldKey(key: string): boolean {
  return FIELD_BY_KEY.has(key);
}

/** The locale a slot is actually stored under (global slots collapse to GLOBAL_LOCALE). */
export function storageLocale(key: string, locale: string): string {
  return FIELD_BY_KEY.get(key)?.global ? GLOBAL_LOCALE : locale;
}

/** Substitute the supported placeholders into an admin-entered override value. */
export function applyHomeVars(value: string): string {
  return value.replaceAll("{appTitle}", APP_TITLE);
}

/**
 * Resolved overrides for a locale: `{ key → value }`, only for keys that have an override. Text
 * slots read the requested locale; image slots read GLOBAL_LOCALE. The caller falls back to the
 * bundled i18n default for any key not present here.
 */
export async function getHomeOverrides(
  db: typeof DbClient,
  locale: string,
): Promise<Record<string, string>> {
  const rows = await db.homeContent.findMany({
    where: { locale: { in: Array.from(new Set([locale, GLOBAL_LOCALE])) } },
    select: { key: true, locale: true, value: true },
  });
  const out: Record<string, string> = {};
  for (const field of HOME_FIELDS) {
    const want = storageLocale(field.key, locale);
    const row = rows.find((r) => r.key === field.key && r.locale === want);
    if (row) out[field.key] = row.value;
  }
  return out;
}
