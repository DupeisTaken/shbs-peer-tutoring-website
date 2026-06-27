import { z } from "zod";

import { createTRPCRouter, publicProcedure, adminProcedure, headProcedure } from "~/server/api/trpc";
import { getFeatures, FEATURE_KEYS } from "~/server/program/features";
import { recordAudit } from "~/server/audit/log";

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

/**
 * Program configuration: the optional-module feature flags. Effective flags are public (any surface
 * can hide a disabled module); staging changes is HEAD-only and takes effect at the next refresh.
 */
export const programRouter = createTRPCRouter({
  /** Effective on/off for every optional module (missing row = on). Public so the landing page and
   *  public signup forms can hide a disabled module. */
  features: publicProcedure.query(({ ctx }) => getFeatures(ctx.db)),

  /** Current + staged (pending) state for the Program UI, plus whether the caller may edit (HEAD). */
  featureSettings: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.programFeature.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return {
      canEdit: ctx.session.role === "HEAD",
      features: FEATURE_KEYS.map((key) => {
        const row = byKey.get(key);
        return { key, enabled: row?.enabled ?? true, pending: row?.pendingEnabled ?? null };
      }),
    };
  }),

  /** Stage a feature change (HEAD only). It activates at the next program refresh. Setting the
   *  target back to the current effective value clears any pending change. */
  setFeaturePending: headProcedure
    .input(z.object({ key: featureKey, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.programFeature.findUnique({
        where: { key: input.key },
        select: { enabled: true },
      });
      const current = existing?.enabled ?? true;
      const pendingEnabled = input.enabled === current ? null : input.enabled;
      await ctx.db.programFeature.upsert({
        where: { key: input.key },
        update: { pendingEnabled, updatedByName: ctx.session.user.name },
        create: { key: input.key, enabled: current, pendingEnabled, updatedByName: ctx.session.user.name },
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
