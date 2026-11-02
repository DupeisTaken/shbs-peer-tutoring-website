import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, createTRPCRouter, protectedProcedure } from "../trpc";
import {
  getMonthlyHoursSettings,
  type saveMonthlyHoursSettings,
  type previewMonthlyHours,
  type generateMonthlyHours,
  getMonthlyHoursReport,
  monthlyHoursCsv,
  type retryMonthlyHoursReport,
} from "~/server/monthly-hours";
import {
  monthlyHoursMonth,
  monthlyHoursSettingsInput,
  monthlyHoursGenerateInput,
} from "~/server/monthly-hours-input";

const reportId = z.object({ id: z.string().min(1).max(128) });

// Keep stale staff clients readable without letting them restart the replaced
// workflow or queue a new approval. This procedure authorizes no successful write.
const retiredStaffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!["ADMIN", "HEAD", "COORDINATOR"].includes(ctx.session.role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required.",
    });
  return next();
});
function retired<T>(): T {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Monthly overviews have been retired. Use School Month Reports.",
  });
}

/** Historical snapshots and CSVs remain readable; no legacy action can create,
 * alter or resend an overview, even from a tab opened before the replacement. */
export const monthlyHoursRouter = createTRPCRouter({
  settings: adminProcedure.query(({ ctx }) =>
    getMonthlyHoursSettings(ctx.db, ctx.session.role),
  ),
  save: retiredStaffProcedure
    .input(monthlyHoursSettingsInput)
    .mutation(() => retired<ReturnType<typeof saveMonthlyHoursSettings>>()),
  preview: adminProcedure
    .input(z.object({ month: monthlyHoursMonth }))
    .query(() => retired<ReturnType<typeof previewMonthlyHours>>()),
  generate: retiredStaffProcedure
    .input(monthlyHoursGenerateInput)
    .mutation(() => retired<ReturnType<typeof generateMonthlyHours>>()),
  report: adminProcedure
    .input(reportId)
    .query(({ ctx, input }) => getMonthlyHoursReport(ctx.db, input.id)),
  csv: adminProcedure
    .input(reportId)
    .query(({ ctx, input }) => monthlyHoursCsv(ctx.db, input.id)),
  retry: retiredStaffProcedure
    .input(reportId)
    .mutation(() => retired<ReturnType<typeof retryMonthlyHoursReport>>()),
});
