import { z } from "zod";

import { createTRPCRouter, translatorProcedure } from "~/server/api/trpc";
import { LOCALES } from "~/i18n/config";
import { listLanguages } from "~/server/i18n/languages";
import enMessages from "../../../../messages/en.json";
import zhMessages from "../../../../messages/zh.json";
import esMessages from "../../../../messages/es.json";

/** Bundled message sources, keyed by locale. English is the canonical key set. */
const MESSAGES: Record<string, Record<string, unknown>> = {
  en: enMessages,
  zh: zhMessages,
  es: esMessages,
};

/** Flatten a nested messages object into dot-path → string-leaf entries. */
function flatten(
  obj: Record<string, unknown>,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v as Record<string, unknown>, key, out);
    } else if (typeof v === "string") {
      out[key] = v;
    }
  }
  return out;
}

const isBuiltin = (code: string) => (LOCALES as readonly string[]).includes(code);

/** Resolve to a known language (built-in or translator-added); unknown codes fall back to English. */
async function resolveLocale(locale: string): Promise<string> {
  if (isBuiltin(locale)) return locale;
  const langs = await listLanguages();
  return langs.some((l) => l.code === locale) ? locale : "en";
}

/** Flattened base values for a locale: bundled JSON for built-ins, English for added languages. */
function localeBase(locale: string, enFlat: Record<string, string>): Record<string, string> {
  return isBuiltin(locale) ? flatten(MESSAGES[locale] ?? {}) : enFlat;
}

/**
 * In-app UI translation editor. Reads/writes `MessageOverride` rows that the i18n request config
 * deep-merges over the bundled JSON (so edits go live without a redeploy). Gated by
 * `translatorProcedure` — admins/coordinators or any user an admin flagged `canTranslate`.
 */
export const localizationRouter = createTRPCRouter({
  /**
   * Every English key with the bundled value for `locale` (English fallback) and any override.
   * `refLocales` adds the current value of one or more other languages as a translation reference
   * (English is always shown, so it and the target locale are excluded from the references).
   */
  strings: translatorProcedure
    .input(z.object({ locale: z.string(), refLocales: z.array(z.string()).optional() }))
    .query(async ({ ctx, input }) => {
      const locale = await resolveLocale(input.locale);
      const enFlat = flatten(MESSAGES.en ?? {});
      const localeFlat = localeBase(locale, enFlat);
      const overrides = await ctx.db.messageOverride.findMany({
        where: { locale },
        select: { key: true, value: true },
      });
      const overrideMap = new Map(overrides.map((o) => [o.key, o.value]));

      // Resolve the requested reference languages (dedup; drop the target + English).
      const refCodes: string[] = [];
      for (const raw of input.refLocales ?? []) {
        const rl = await resolveLocale(raw);
        if (rl !== locale && rl !== "en" && !refCodes.includes(rl)) refCodes.push(rl);
      }
      const refData = await Promise.all(
        refCodes.map(async (rl) => {
          const flat = localeBase(rl, enFlat);
          const ovr = await ctx.db.messageOverride.findMany({
            where: { locale: rl },
            select: { key: true, value: true },
          });
          return { locale: rl, flat, map: new Map(ovr.map((o) => [o.key, o.value])) };
        }),
      );

      return Object.keys(enFlat)
        .sort()
        .map((key) => ({
          key,
          en: enFlat[key]!,
          base: localeFlat[key] ?? enFlat[key]!,
          override: overrideMap.get(key) ?? null,
          refs: refData.map((r) => ({
            locale: r.locale,
            value: r.map.get(key) ?? r.flat[key] ?? enFlat[key]!,
          })),
        }));
    }),

  /** Set (or, when blank / equal to the bundled value, clear) the override for one key. */
  setString: translatorProcedure
    .input(z.object({ locale: z.string(), key: z.string().min(1), value: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const locale = await resolveLocale(input.locale);
      const enFlat = flatten(MESSAGES.en ?? {});
      const localeFlat = localeBase(locale, enFlat);
      const base = localeFlat[input.key] ?? enFlat[input.key];
      const value = input.value;
      if (!value.trim() || value === base) {
        await ctx.db.messageOverride.deleteMany({ where: { locale, key: input.key } });
        return { ok: true, cleared: true };
      }
      await ctx.db.messageOverride.upsert({
        where: { locale_key: { locale, key: input.key } },
        update: { value, updatedByName: ctx.session.user.name },
        create: { locale, key: input.key, value, updatedByName: ctx.session.user.name },
      });
      return { ok: true, cleared: false };
    }),
});
