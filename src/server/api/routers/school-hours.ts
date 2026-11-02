import { z } from "zod";
import { adminOnlyProcedure, adminProcedure, createTRPCRouter } from "../trpc";
import { assertFeatureEnabled } from "~/server/program/features";
import {
  schoolHoursBaselineInput,
  schoolHoursGenerateInput,
  schoolHoursMonth,
  schoolHoursSettingsInput,
} from "~/server/school-hours-input";
import {
  changeSchoolHoursLink,
  generateSchoolHours,
  getSchoolHoursReport,
  getSchoolHoursSettings,
  previewSchoolHours,
  retrySchoolHoursReport,
  reviewSchoolHoursBaseline,
  saveSchoolHoursSettings,
  schoolHoursBaselinePreview,
  schoolHoursCsv,
} from "~/server/school-hours";

const reportId = z.object({ id: z.string().min(1).max(128) });
const linkInput = reportId.extend({
  expectedLinkVersion: z.number().int().positive().optional(),
});

/** Retained reports are staff-readable even while service hours is disabled.
 * Only save participates in Coordinator proposals; financial commits never do. */
export const schoolHoursRouter = createTRPCRouter({
  settings: adminProcedure.query(({ ctx }) =>
    getSchoolHoursSettings(ctx.db, ctx.session.role),
  ),
  baselinePreview: adminProcedure.query(({ ctx }) =>
    schoolHoursBaselinePreview(ctx.db),
  ),
  reviewBaseline: adminOnlyProcedure
    .input(schoolHoursBaselineInput)
    .mutation(({ ctx, input }) =>
      reviewSchoolHoursBaseline(ctx.db, input, ctx.session.user.id),
    ),
  save: adminOnlyProcedure
    .input(schoolHoursSettingsInput)
    .mutation(({ ctx, input }) =>
      saveSchoolHoursSettings(ctx.db, input, ctx.session.user.id),
    ),
  preview: adminProcedure
    .input(z.object({ month: schoolHoursMonth }))
    .query(async ({ ctx, input }) => {
      await assertFeatureEnabled(ctx.db, "SERVICE_HOURS");
      return previewSchoolHours(ctx.db, input.month);
    }),
  generate: adminOnlyProcedure
    .input(schoolHoursGenerateInput)
    .mutation(({ ctx, input }) =>
      generateSchoolHours(ctx.db, input, ctx.session.user.id),
    ),
  report: adminProcedure
    .input(reportId)
    .query(({ ctx, input }) => getSchoolHoursReport(ctx.db, input.id)),
  csv: adminProcedure
    .input(reportId)
    .query(({ ctx, input }) => schoolHoursCsv(ctx.db, input.id)),
  retry: adminOnlyProcedure
    .input(reportId)
    .mutation(({ ctx, input }) =>
      retrySchoolHoursReport(ctx.db, input.id, ctx.session.user.id),
    ),
  revokeLink: adminOnlyProcedure
    .input(linkInput)
    .mutation(({ ctx, input }) =>
      changeSchoolHoursLink(
        ctx.db,
        input.id,
        ctx.session.user.id,
        false,
        input.expectedLinkVersion,
      ),
    ),
  reissueLink: adminOnlyProcedure
    .input(linkInput)
    .mutation(({ ctx, input }) =>
      changeSchoolHoursLink(
        ctx.db,
        input.id,
        ctx.session.user.id,
        true,
        input.expectedLinkVersion,
      ),
    ),
});
