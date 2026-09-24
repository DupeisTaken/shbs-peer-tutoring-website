import { db } from "~/server/db";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  isDefaultEnabledLocale,
  isLocale,
} from "~/i18n/config";

export type LanguageInfo = {
  code: string;
  label: string;
  builtIn: boolean;
  enabled: boolean;
};

export type StoredLanguage = LanguageInfo & { sortOrder: number };
export type ListLanguageOptions = { includeDisabled?: boolean };

/**
 * Merge stored language settings with the bundled catalogs. Keeping this transformation pure makes
 * visibility rules testable without a database and preserves English as the reliable fallback.
 */
export function mergeLanguages(
  rows: StoredLanguage[],
  { includeDisabled = false }: ListLanguageOptions = {},
): LanguageInfo[] {
  const present = new Set(rows.map((row) => row.code));
  const merged = rows.map((row) => ({
    ...row,
    builtIn: row.builtIn || isLocale(row.code),
    enabled: row.code === DEFAULT_LOCALE || row.enabled,
  }));

  LOCALES.forEach((code, index) => {
    if (!present.has(code)) {
      merged.push({
        code,
        label: LOCALE_LABELS[code] ?? code,
        builtIn: true,
        enabled: isDefaultEnabledLocale(code),
        sortOrder: 1000 + index,
      });
    }
  });

  merged.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  return merged
    .filter((language) => includeDisabled || language.enabled)
    .map(({ code, label, builtIn, enabled }) => ({ code, label, builtIn, enabled }));
}

/**
 * UI languages ordered for selectors and management. Public callers receive enabled languages;
 * translation tools opt into hidden ones. Bundled catalogs are synthesized when rows are missing.
 */
export async function listLanguages(
  options: ListLanguageOptions = {},
): Promise<LanguageInfo[]> {
  try {
    const rows = await db.language.findMany({
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    return mergeLanguages(rows, options);
  } catch {
    return mergeLanguages([], options);
  }
}
