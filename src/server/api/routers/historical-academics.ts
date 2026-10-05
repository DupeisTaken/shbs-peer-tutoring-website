import { createTRPCRouter, adminProcedure } from "../trpc";
import { z } from "zod";
import { historicalCorrectionInput } from "~/lib/historical-academics";
import {
  historicalApplyInput,
  applyHistoricalCorrections,
  historicalListInput,
  historicalPreviewTicket,
  listHistoricalAcademics,
  previewHistoricalCorrections,
} from "~/server/historical-academics";

export const historicalAcademicsRouter = createTRPCRouter({
  list: adminProcedure
    .input(historicalListInput)
    .query(({ ctx, input }) => listHistoricalAcademics(ctx.db, input)),
  // A preview only reads. Coordinators can inspect exact changes before proposing them.
  preview: adminProcedure
    .input(historicalCorrectionInput)
    .mutation(async ({ ctx, input }) => ({
      records: await previewHistoricalCorrections(ctx.db, input),
      ticket: historicalPreviewTicket(input),
    })),
  correctBatch: adminProcedure
    .input(historicalApplyInput)
    .mutation(({ ctx, input }) =>
      applyHistoricalCorrections(ctx.db, ctx.session.user.id, input),
    ),
  audit: adminProcedure
    .input(
      z.object({
        recordId: z.string().min(1).max(256),
        page: z.number().int().min(0).max(10000).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.historicalAcademicCorrection.findMany({
        where: { recordId: input.recordId },
        orderBy: { revision: "desc" },
        skip: input.page * 20,
        take: 21,
      });
      return { rows: rows.slice(0, 20), hasNext: rows.length > 20 };
    }),
});
