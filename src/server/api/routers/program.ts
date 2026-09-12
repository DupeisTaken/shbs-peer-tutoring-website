import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
  adminProcedure,
  adminOnlyProcedure,
  headProcedure,
} from "~/server/api/trpc";
import {
  getFeatures,
  FEATURE_KEYS,
  DEFAULT_FEATURES,
} from "~/server/program/features";
import { recordAudit } from "~/server/audit/log";
import { isEmailDeliveryAvailable } from "~/server/email/sender";

import { getProgramTimeZone } from "~/server/program/time-zone";
import { isProgramTimeZone } from "~/lib/program-time";
import { programTimeZoneOptions } from "~/lib/program-time-zone-options";
import { inTransaction, lockEntity } from "~/server/transactions";

const featureKey = z.enum([
  "CREW",
  "DISCIPLINE",
  "MEETINGS",
  "INTERVIEWS",
  "SERVICE_HOURS",
  "QUARTER_SYSTEM",
  "VIEWER_SIGNUP",
  "EMAIL_2FA",
]);

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Preview link must use http:// or https://.",
  });

/**
 * Program configuration: the optional-module feature flags. Effective flags are public (any surface
 * can hide a disabled module); staging changes is HEAD-only and takes effect at the next refresh.
 */
export const programRouter = createTRPCRouter({
  timeZoneSettings: adminProcedure.query(async ({ ctx }) => {
    const timeZone=await getProgramTimeZone(ctx.db);
    return {timeZone, timeZoneOptions:programTimeZoneOptions(timeZone),
      canEdit:ctx.session.role === "HEAD" || ctx.session.role === "ADMIN"};
  }),
  // Program configuration requires HEAD/ADMIN directly; coordinators cannot queue this change.
  setTimeZone: adminOnlyProcedure
    .input(z.object({ timeZone: z.string().max(100).refine(isProgramTimeZone, "Choose a valid IANA time zone."), expectedTimeZone: z.string() }))
    .mutation(async ({ ctx, input }) => inTransaction(ctx.db, async tx => {
      await lockEntity(tx, "program-timezone");
      const previous = await getProgramTimeZone(tx);
      if (previous !== input.expectedTimeZone) throw new TRPCError({ code: "CONFLICT", message: "The program time zone changed. Reload and review the latest setting." });
      if (previous === input.timeZone) return { timeZone: previous };
      await tx.programSettings.upsert({ where: { id: "program" }, create: { id: "program", timeZone: input.timeZone }, update: { timeZone: input.timeZone } });
      await tx.auditLog.create({ data: {
        userId: ctx.session.user.id, userName: ctx.session.user.name,
        entity: "ProgramSettings", entityId: "program", operation: "program.setTimeZone",
        action: "Changed program time zone", details: { before: previous, after: input.timeZone, weeklyClockTimesPreserved: true, storedTimestampsPreserved: true },
      } });
      return { timeZone: input.timeZone };
    })),
  /** Effective on/off for every optional module (missing row = on). Public so the landing page and
   *  public signup forms can hide a disabled module. */
  features: publicProcedure.query(async ({ ctx }) => ({
    ...(await getFeatures(ctx.db)),
    EMAIL_DELIVERY_AVAILABLE: isEmailDeliveryAvailable(),
  })),

  /** Save the active quarter's tutee-signup opening time and optional preview sheet. This takes
   *  effect immediately; the public mutation independently enforces the timestamp. */
  setSignupWindow: adminOnlyProcedure
    .input(
      z
        .object({
          opensAt: z.date().nullable(),
          previewUrl: httpUrl.nullable(),
        })
        .superRefine((value, ctx) => {
          if (value.opensAt && !value.previewUrl) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["previewUrl"],
              message:
                "A preview sheet link is required while signups are scheduled.",
            });
          }
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const active = await ctx.db.term.findFirst({
        where: { active: true },
        orderBy: { createdAt: "desc" },
        select: { id: true, quarter: true },
      });
      if (!active) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No active program period. Create or seed one first.",
        });
      }

      const updated = await ctx.db.term.update({
        where: { id: active.id },
        data: {
          signupOpensAt: input.opensAt,
          signupPreviewUrl: input.previewUrl,
        },
        select: { signupOpensAt: true, signupPreviewUrl: true },
      });
      const openingDescription = input.opensAt
        ? `at ${input.opensAt.toISOString()}`
        : "immediately";
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Set ${active.quarter} tutee signups to open ${openingDescription}`,
        entity: "Term",
        entityId: active.id,
      });
      return updated;
    }),

  /** Current + staged (pending) state for the Program UI, plus whether the caller may edit (HEAD). */
  featureSettings: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.programFeature.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return {
      canEdit: ctx.session.role === "HEAD",
      features: FEATURE_KEYS.map((key) => {
        const row = byKey.get(key);
        return {
          key,
          enabled: row?.enabled ?? DEFAULT_FEATURES[key],
          pending: row?.pendingEnabled ?? null,
        };
      }),
    };
  }),

  /** Stage a feature change (HEAD only). It activates at the next program refresh. Setting the
   *  target back to the current effective value clears any pending change. */
  setFeaturePending: headProcedure
    .input(z.object({ key: featureKey, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (
        input.key === "EMAIL_2FA" &&
        input.enabled &&
        !isEmailDeliveryAvailable()
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Configure SMTP before enabling email two-factor authentication.",
        });
      }
      const existing = await ctx.db.programFeature.findUnique({
        where: { key: input.key },
        select: { enabled: true },
      });
      const current = existing?.enabled ?? DEFAULT_FEATURES[input.key];
      const pendingEnabled = input.enabled === current ? null : input.enabled;
      await ctx.db.programFeature.upsert({
        where: { key: input.key },
        update: { pendingEnabled, updatedByName: ctx.session.user.name },
        create: {
          key: input.key,
          enabled: current,
          pendingEnabled,
          updatedByName: ctx.session.user.name,
        },
      });
      await recordAudit({
        userId: ctx.session.user.id,
        userName: ctx.session.user.name,
        action: `Staged ${input.key} ${input.enabled ? "on" : "off"} for next refresh`,
        entity: "ProgramFeature",
        entityId: input.key,
      });
      return { ok: true };
    }),
});
