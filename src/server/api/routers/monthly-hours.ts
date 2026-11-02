import { z } from "zod";
import { adminOnlyProcedure, adminProcedure, createTRPCRouter } from "../trpc";
import { assertFeatureEnabled } from "~/server/program/features";
import {
  getMonthlyHoursSettings,
  saveMonthlyHoursSettings,
  previewMonthlyHours,
  generateMonthlyHours,
  getMonthlyHoursReport,
  monthlyHoursCsv,
  retryMonthlyHoursReport,
} from "~/server/monthly-hours";
import {
  monthlyHoursMonth,
  monthlyHoursSettingsInput,
  monthlyHoursGenerateInput,
} from "~/server/monthly-hours-input";

const reportId = z.object({ id: z.string().min(1).max(128) });

/** Saved reports remain inspectable when the module is off. New generation is
 * gated separately; roster filters are never accepted as report parameters. */
export const monthlyHoursRouter = createTRPCRouter({
  settings: adminProcedure.query(({ ctx }) =>
    getMonthlyHoursSettings(ctx.db, ctx.session.role),
  ),
  save: adminOnlyProcedure
    .input(monthlyHoursSettingsInput)
    .mutation(({ ctx, input }) =>
      saveMonthlyHoursSettings(ctx.db, input, ctx.session.user.id),
    ),
  preview: adminProcedure
    .input(z.object({ month: monthlyHoursMonth }))
    .query(async ({ ctx, input }) => {
      await assertFeatureEnabled(ctx.db, "SERVICE_HOURS");
      return previewMonthlyHours(ctx.db, input.month);
    }),
  generate: adminOnlyProcedure
    .input(monthlyHoursGenerateInput)
    .mutation(({ ctx, input }) =>
      generateMonthlyHours(ctx.db, input, ctx.session.user.id),
    ),
  report: adminProcedure
    .input(reportId)
    .query(({ ctx, input }) => getMonthlyHoursReport(ctx.db, input.id)),
  csv: adminProcedure
    .input(reportId)
    .query(({ ctx, input }) => monthlyHoursCsv(ctx.db, input.id)),
  retry: adminOnlyProcedure
    .input(reportId)
    .mutation(({ ctx, input }) =>
      retryMonthlyHoursReport(ctx.db, input.id, ctx.session.user.id),
    ),
});
