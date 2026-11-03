import { z } from "zod";
import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";
import {
  applyAdmissionRecovery,
  inspectAdmissionRecovery,
} from "~/server/recovery/admission";
import {
  captureRecoveryCheckpoint,
  captureCheckpointInput,
  inspectRecoveryCheckpoint,
  applyRecoveryCheckpoint,
  restoreCheckpointInput,
} from "~/server/recovery/checkpoint";
import { readRecoveryReceipt } from "~/server/recovery/receipt";

const actionId = z.string().min(1).max(200);

/** Website transport deliberately cannot choose OPERATOR or bypass the graph gate.
 * Coordinator writes are queued by the shared authority middleware; replay uses
 * the current reviewer's authority and revalidates the original fingerprint. */
export const recoveryRouter = createTRPCRouter({
  captureCheckpoint: adminProcedure
    .input(captureCheckpointInput)
    .mutation(({ ctx, input }) =>
      captureRecoveryCheckpoint(ctx.db, input, { id: ctx.session.user.id }),
    ),
  checkpoints: adminProcedure
    .input(z.object({ cursor: actionId.optional() }).strict())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.recoveryCheckpoint.findMany({
        select: {
          id: true,
          actionId: true,
          adapter: true,
          adapterVersion: true,
          schemaVersion: true,
          sourceEntity: true,
          sourceId: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        take: 51,
      });
      return {
        items: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      };
    }),
  inspectCheckpoint: adminProcedure
    .input(z.object({ checkpointId: actionId }).strict())
    .query(({ ctx, input }) => inspectRecoveryCheckpoint(ctx.db, input)),
  restoreCheckpoint: adminProcedure
    .input(restoreCheckpointInput)
    .mutation(({ ctx, input }) =>
      applyRecoveryCheckpoint(ctx.db, input, { id: ctx.session.user.id }),
    ),
  list: adminProcedure
    .input(z.object({ cursor: actionId.optional() }).strict())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.recoveryAction.findMany({
        where: { kind: "INITIAL_ADMISSION" },
        select: { id: true, applicationId: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        take: 51,
      });
      const applications = await ctx.db.tutorApplication.findMany({
        where: {
          id: {
            in: rows
              .slice(0, 50)
              .flatMap((row) => (row.applicationId ? [row.applicationId] : [])),
          },
        },
        select: { id: true, name: true },
      });
      return {
        items: rows.slice(0, 50).map((row) => ({
          ...row,
          applicantName:
            applications.find(
              (application) => application.id === row.applicationId,
            )?.name ?? null,
        })),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      };
    }),
  inspect: adminProcedure
    .input(z.object({ actionId }).strict())
    .query(({ ctx, input }) => inspectAdmissionRecovery(ctx.db, input)),
  receipt: adminProcedure
    .input(z.object({ id: actionId }).strict())
    .query(({ ctx, input }) =>
      readRecoveryReceipt(ctx.db, input.id, ctx.session.user.id),
    ),
  voidAdmission: adminProcedure
    .input(
      z
        .object({
          actionId,
          expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          clientKey: z.string().uuid(),
          reason: z.string().trim().min(5).max(2000),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) =>
      applyAdmissionRecovery(ctx.db, input, { id: ctx.session.user.id }),
    ),
});
