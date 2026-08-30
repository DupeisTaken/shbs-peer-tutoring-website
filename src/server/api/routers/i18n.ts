import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  adminProcedure,
  createTRPCRouter,
  publicProcedure,
  translatorProcedure,
} from "~/server/api/trpc";
import {
  DEFAULT_LOCALE,
  isDefaultEnabledLocale,
  isLocale,
  LOCALE_LABELS,
} from "~/i18n/config";
import { listLanguages } from "~/server/i18n/languages";

/**
 * UI languages. `languages` is public (the language picker is everywhere). Translators can add a
 * new language (its strings come from MessageOverride rows, English fallback); admins reorder and
 * remove added languages. Built-in locales (the bundled set in src/i18n/config.ts: en, zh, es,
 * ja, ko, el, de, fr) can be reordered but not removed.
 */
export const i18nRouter = createTRPCRouter({
  languages: publicProcedure.query(() => listLanguages()),

  /** Hidden languages remain available to translators while they are being polished. */
  managedLanguages: translatorProcedure.query(() =>
    listLanguages({ includeDisabled: true }),
  ),

  /** Whether the current translator may also reorder/remove languages (head/admins/coordinators). */
  canManageLanguages: translatorProcedure.query(
    ({ ctx }) =>
      ctx.session.role === "HEAD" ||
      ctx.session.role === "ADMIN" ||
      ctx.session.role === "COORDINATOR",
  ),

  addLanguage: translatorProcedure
    .input(
      z.object({
        code: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, "Use a code like “fr” or “pt-BR”.")
          .transform((s) => s.toLowerCase()),
        label: z.string().trim().min(1).max(40),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (isLocale(input.code)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That is already a built-in language." });
      }
      const existing = await ctx.db.language.findUnique({ where: { code: input.code } });
      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That language already exists." });
      }
      const max = await ctx.db.language.aggregate({ _max: { sortOrder: true } });
      await ctx.db.language.create({
        data: {
          code: input.code,
          label: input.label,
          sortOrder: (max._max.sortOrder ?? 100) + 1,
          builtIn: false,
          enabled: false,
        },
      });
      return { ok: true };
    }),

  setLanguageEnabled: adminProcedure
    .input(z.object({ code: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.code === DEFAULT_LOCALE && !input.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "English is the required fallback and can't be hidden.",
        });
      }

      const existing = await ctx.db.language.findUnique({ where: { code: input.code } });
      if (!existing && !isLocale(input.code)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Language not found." });
      }

      await ctx.db.language.upsert({
        where: { code: input.code },
        update: { enabled: input.enabled },
        create: {
          code: input.code,
          label: isLocale(input.code) ? (LOCALE_LABELS[input.code] ?? input.code) : input.code,
          sortOrder: 1000,
          builtIn: isLocale(input.code),
          enabled: input.enabled,
        },
      });
      return { ok: true };
    }),

  reorderLanguages: adminProcedure
    .input(z.object({ codes: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Persist the new order; upsert so built-ins get a row the first time they're reordered.
      await ctx.db.$transaction(
        input.codes.map((code, i) =>
          ctx.db.language.upsert({
            where: { code },
            update: { sortOrder: i },
            create: {
              code,
              label: isLocale(code) ? (LOCALE_LABELS[code] ?? code) : code,
              sortOrder: i,
              builtIn: isLocale(code),
              enabled: isDefaultEnabledLocale(code),
            },
          }),
        ),
      );
      return { ok: true };
    }),

  deleteLanguage: adminProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (isLocale(input.code)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Built-in languages can't be removed." });
      }
      await ctx.db.messageOverride.deleteMany({ where: { locale: input.code } });
      await ctx.db.language.deleteMany({ where: { code: input.code, builtIn: false } });
      return { ok: true };
    }),
});
