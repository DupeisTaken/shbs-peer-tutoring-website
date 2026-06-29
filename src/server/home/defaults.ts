import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import es from "../../../messages/es.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";
import el from "../../../messages/el.json";
import de from "../../../messages/de.json";
import fr from "../../../messages/fr.json";

/**
 * Bundled `landing.*` defaults, flattened to dot-paths (e.g. "features.students.title"). These are
 * the values the landing page shows when a HomeContent override is absent, so the editor displays
 * them as placeholders / "revert to default" targets. A missing per-locale string falls back to
 * English — matching how the rest of the app resolves an untranslated key.
 */

type Json = Record<string, unknown>;

function flattenLanding(messages: Json): Record<string, string> {
  const landing = (messages.landing ?? {}) as Json;
  const out: Record<string, string> = {};
  const walk = (obj: Json, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        walk(v as Json, key);
      } else if (typeof v === "string") {
        out[key] = v;
      }
    }
  };
  walk(landing, "");
  return out;
}

const FLAT: Record<string, Record<string, string>> = {
  en: flattenLanding(en),
  zh: flattenLanding(zh),
  es: flattenLanding(es),
  ja: flattenLanding(ja),
  ko: flattenLanding(ko),
  el: flattenLanding(el),
  de: flattenLanding(de),
  fr: flattenLanding(fr),
};

/** The bundled `landing.<key>` default for a locale (English fallback); null if no such default. */
export function landingDefault(locale: string, key: string): string | null {
  return FLAT[locale]?.[key] ?? FLAT.en?.[key] ?? null;
}
