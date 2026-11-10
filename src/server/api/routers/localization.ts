import { requireTranslationLocale } from "~/server/translation-destination";
import { proposeTranslation } from "~/server/translation-drafts";
import { z } from "zod";
import {
  interfaceMessageBases,
  validateInterfaceMessage,
} from "~/server/i18n/interface-message-validation";
import { translationSetterInputs } from "~/lib/translation-intent";
import { dispatchTranslationWrite } from "~/server/translation-intents";

import { createTRPCRouter, translatorProcedure } from "~/server/api/trpc";
import { LOCALES } from "~/i18n/config";
import { listManagedLanguages } from "~/server/i18n/languages";

const isBuiltin = (code: string) =>
  (LOCALES as readonly string[]).includes(code);

/** Resolve to a known language (built-in or translator-added); unknown codes fall back to English. */
async function resolveLocale(locale: string): Promise<string> {
  if (isBuiltin(locale)) return locale;
  const langs = await listManagedLanguages();
  return langs.some((l) => l.code === locale) ? locale : "en";
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
    .input(
      z.object({
        locale: z.string(),
        refLocales: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const locale = await resolveLocale(input.locale);
      const { english: enFlat, local: localeFlat } =
        interfaceMessageBases(locale);
      const overrides = await ctx.db.messageOverride.findMany({
        where: { locale },
        select: { key: true, value: true },
      });
      const overrideMap = new Map(overrides.map((o) => [o.key, o.value]));
      if (!["HEAD", "ADMIN", "COORDINATOR"].includes(ctx.session.role)) {
        const drafts = await ctx.db.translationDraft.findMany({
          where: {
            authorId: ctx.session.user.id,
            state: "PENDING",
            operation: "localization.setString",
          },
          orderBy: { createdAt: "asc" },
        });
        for (const draft of drafts) {
          const data = z
            .object({ locale: z.string(), key: z.string(), value: z.string() })
            .safeParse(draft.payload);
          if (data.success && data.data.locale === locale)
            overrideMap.set(data.data.key, data.data.value);
        }
      }

      // Resolve the requested reference languages (dedup; drop the target + English).
      const refCodes: string[] = [];
      for (const raw of input.refLocales ?? []) {
        const rl = await resolveLocale(raw);
        if (rl !== locale && rl !== "en" && !refCodes.includes(rl))
          refCodes.push(rl);
      }
      const refData = await Promise.all(
        refCodes.map(async (rl) => {
          const { local: flat } = interfaceMessageBases(rl);
          const ovr = await ctx.db.messageOverride.findMany({
            where: { locale: rl },
            select: { key: true, value: true },
          });
          return {
            locale: rl,
            flat,
            map: new Map(ovr.map((o) => [o.key, o.value])),
          };
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
    .input(translationSetterInputs["localization.setString"])
    .mutation(({ ctx, input: parsed }) => {
      const { intent, ...input } = parsed;
      return dispatchTranslationWrite({
        db: ctx.db,
        session: ctx.session,
        operation: "localization.setString",
        intent,
        business: input,
        work: async (tx, actorSession) => {
          // Keep locale lookup on the lock-holding connection. A display helper's
          // error fallback must never redirect a failed custom-language save to English.
          const locale = await requireTranslationLocale(tx, input.locale);
          const value = input.value;
          const { base } = validateInterfaceMessage(locale, input.key, value);
          const draftId = await proposeTranslation(
            tx,
            actorSession,
            "localization.setString",
            {
              ...input,
              locale,
            },
          );
          if (draftId) return { result: { ok: true, cleared: false }, draftId };
          if (!value.trim() || value === base) {
            await tx.messageOverride.deleteMany({
              where: { locale, key: input.key },
            });
            return { result: { ok: true, cleared: true } };
          }
          await tx.messageOverride.upsert({
            where: { locale_key: { locale, key: input.key } },
            update: { value, updatedByName: actorSession.user.name },
            create: {
              locale,
              key: input.key,
              value,
              updatedByName: actorSession.user.name,
            },
          });
          return { result: { ok: true, cleared: false } };
        },
      });
    }),
});
