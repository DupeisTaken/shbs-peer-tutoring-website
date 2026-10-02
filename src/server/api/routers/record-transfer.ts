import { z } from "zod";
import { Prisma } from "../../../../generated/prisma";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, headProcedure } from "~/server/api/trpc";
import { transferFilesSchema } from "~/lib/record-transfer";
import {
  applyRecords,
  exportRecords,
  previewTicket,
  verifyPreviewTicket,
  type TransferSummary,
} from "~/server/record-transfer";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { lockUsernameNamespace } from "~/server/auth/username";

class PreviewRollback extends Error {
  constructor(readonly summary: TransferSummary) {
    super("Rollback successful preview");
  }
}

// Recheck rank inside the transaction and hold the account row against concurrent demotion.
async function assertHead(tx: TransactionDb, id: string) {
  const rows = await tx.$queryRaw<{ role: string; suspendedAt: Date | null }[]>(
    Prisma.sql`SELECT role,"suspendedAt" FROM "User" WHERE id=${id} FOR SHARE`,
  );
  if (rows[0]?.role !== "HEAD" || rows[0].suspendedAt)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Head access required.",
    });
}

export const recordTransferRouter = createTRPCRouter({
  export: headProcedure
    .input(z.object({ templates: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) =>
      ctx.db.$transaction(
        async (tx) => {
          await assertHead(tx, ctx.session.user.id);
          const result = await exportRecords(tx, input.templates);
          await tx.auditLog.create({
            data: {
              userId: ctx.session.user.id,
              userName: ctx.session.user.name,
              entity: "ProgramRecords",
              operation: "recordTransfer.export",
              action: input.templates
                ? "Downloaded program CSV templates"
                : `Exported ${result.total} program records`,
              details: { count: result.total },
            },
          });
          return result;
        },
        { isolationLevel: "RepeatableRead", timeout: 20_000 },
      ),
    ),

  preview: headProcedure
    .input(z.object({ files: transferFilesSchema }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.db.$transaction(
          async (tx) => {
            if (input.files.some((f) => ["Tutor.csv", "HistoricalAcademicRecord.csv"].includes(f.name)))
              await lockUsernameNamespace(tx);
            await assertHead(tx, ctx.session.user.id);
            await lockEntity(tx, "program-record-transfer");
            const summary = await applyRecords(tx, input.files);
            throw new PreviewRollback(summary);
          },
          { isolationLevel: "Serializable", timeout: 20_000 },
        );
      } catch (error) {
        if (error instanceof PreviewRollback)
          return {
            summary: error.summary,
            ticket: previewTicket(input.files, ctx.session.user.id),
          };
        throw error;
      }
      throw new Error("Preview must always roll back");
    }),

  import: headProcedure
    .input(
      z.object({ files: transferFilesSchema, ticket: z.string().max(200) }),
    )
    .mutation(async ({ ctx, input }) => {
      verifyPreviewTicket(input.files, ctx.session.user.id, input.ticket);
      return ctx.db.$transaction(
        async (tx) => {
          if (input.files.some((f) => ["Tutor.csv", "HistoricalAcademicRecord.csv"].includes(f.name)))
            await lockUsernameNamespace(tx);
          await assertHead(tx, ctx.session.user.id);
          await lockEntity(tx, "program-record-transfer");
          const summary = await applyRecords(tx, input.files);
          const created = summary.reduce((n, row) => n + row.created, 0);
          // Audit evidence commits with the records; CSV contents/PII are never copied into the log.
          await tx.auditLog.create({
            data: {
              userId: ctx.session.user.id,
              userName: ctx.session.user.name,
              entity: "ProgramRecords",
              operation: "recordTransfer.import",
              action: `Imported ${created} historical program records`,
              details: { summary },
            },
          });
          return { summary };
        },
        { isolationLevel: "Serializable", timeout: 20_000 },
      );
    }),
});
