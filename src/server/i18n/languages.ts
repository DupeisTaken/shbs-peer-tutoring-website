import { db } from "~/server/db";
import { LOCALES, LOCALE_LABELS } from "~/i18n/config";

export type LanguageInfo = { code: string; label: string; builtIn: boolean };

/**
 * Every available UI language, ordered for the picker. Built-in locales (bundled JSON) are always
 * present even without a `Language` row; DB rows override their label/order and add new languages.
 * Falls back to the built-ins if the table is missing / the DB is unavailable.
 */
export async function listLanguages(): Promise<LanguageInfo[]> {
  try {
    const rows = await db.language.findMany({
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    const present = new Set(rows.map((r) => r.code));
    const merged = rows.map((r) => ({
      code: r.code,
      label: r.label,
      builtIn: r.builtIn,
      sortOrder: r.sortOrder,
    }));
    // Ensure built-ins appear even if they don't have a row yet (after the built-ins so any
    // explicitly-ordered rows lead; their relative order stays the bundled order).
    LOCALES.forEach((code, i) => {
      if (!present.has(code)) {
        merged.push({
          code,
          label: LOCALE_LABELS[code] ?? code,
          builtIn: true,
          sortOrder: 1000 + i,
        });
      }
    });
    merged.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    return merged.map(({ code, label, builtIn }) => ({ code, label, builtIn }));
  } catch {
    return LOCALES.map((code) => ({ code, label: LOCALE_LABELS[code] ?? code, builtIn: true }));
  }
}
