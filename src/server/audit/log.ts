import { preserveHistoricalAcademics } from "~/server/historical-academics";
import { approvalScope, auditActorScope } from "~/server/db-scope";
import { safeAuditSnapshot } from "./evidence";
import type { Prisma } from "../../../generated/prisma";
/**
 * Audit log + typed undo. Every admin mutation that's hard to reverse by hand records an
 * AuditLog entry carrying a typed `undo` describing its inverse, so it can be reverted from
 * /admin/audit. See the "Admin design philosophies" note in docs/contributing.md (revertibility).
 *
 * Node runtime only.
 */
import { z } from "zod";

import { db } from "~/server/db";
import { inTransaction, type TransactionDb } from "~/server/transactions";
import { reconcileApplication } from "~/server/tutors/application-status";
import { syncPunishmentRemoval } from "~/server/discipline/removal";

/** Discriminated union of revert operations. Each is validated again at undo time. */
export const undoSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("subject.restore"),
    payload: z.object({
      id: z.string(),
      name: z.string(),
      levelId: z.string().nullable(),
      active: z.boolean(),
    }),
  }),
  z.object({
    kind: z.literal("announcement.restore"),
    payload: z.object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      pinned: z.boolean(),
      active: z.boolean(),
      createdById: z.string().nullable(),
      createdAt: z.string().optional(),
      audienceRestricted: z.boolean().default(false),
      recipientTutorIds: z.array(z.string()).default([]),
      acks: z
        .array(z.object({ userId: z.string(), ackedAt: z.string() }))
        .optional(),
    }),
  }),
  z.object({
    kind: z.literal("card.review"),
    payload: z.object({
      id: z.string(),
      reviewStatus: z.enum(["PENDING", "VALID", "INVALID"]),
      reviewNote: z.string().nullable(),
      expectedUpdatedAt: z.string().optional(),
      reviewedAt: z.string().nullable().optional(),
      reviewedById: z.string().nullable().optional(),
    }),
  }),
  z.object({
    kind: z.literal("application.status"),
    payload: z.object({
      id: z.string(),
      status: z.enum(["PENDING", "INTERVIEW", "ACCEPTED", "REJECTED"]),
      expectedUpdatedAt: z.string().optional(),
    }),
  }),
  z.object({
    kind: z.literal("tutee.status"),
    payload: z.object({
      id: z.string(),
      status: z.enum(["PENDING", "ACTIVE", "INACTIVE"]),
    }),
  }),
]);

export type UndoData = z.infer<typeof undoSchema>;

export interface RecordAuditArgs {
  userId?: string | null;
  userName?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  undo?: UndoData;
  operation?: string;
  role?: string;
  before?: unknown;
  after?: unknown;
  originalActionId?: string;
  reason?: string;
  effects?: Prisma.InputJsonValue;
}

export async function recordAudit(
  args: RecordAuditArgs,
  client: TransactionDb = db,
): Promise<void> {
  const actor = auditActorScope.getStore();
  await client.auditLog.create({
    data: {
      userId: args.userId ?? null,
      userName: args.userName ?? null,
      action: args.action,
      entity: args.entity,
      entityId: args.entityId ?? null,
      undoData: args.undo ?? undefined,
      approvalId: approvalScope.getStore(),
      operation: args.operation,
      details: {
        evidenceVersion: 1, actorRole: args.userId ? args.role ?? actor?.role ?? "UNKNOWN_LEGACY" : "SYSTEM",
        outcome: "APPLIED", before: safeAuditSnapshot(args.before, args.entity), after: safeAuditSnapshot(args.after, args.entity),
        ...(args.before === undefined && args.after === undefined ? { detailAvailability: "Before/after details were not captured by this writer" } : {}),
        ...(args.originalActionId ? { originalActionId: args.originalActionId } : {}),
        ...(args.reason ? { reason: args.reason } : {}),
        ...(args.effects ? { effects: args.effects } : {}),
      },
    },
  });
}

/**
 * Apply the inverse described by a stored undo payload. Returns false if the payload is
 * malformed; throws (propagated) on a DB failure (e.g. unique-name collision on restore).
 */
export async function applyUndo(
  raw: unknown,
  client: TransactionDb = db,
): Promise<boolean> {
  return inTransaction(client, async (tx) => {
    const parsed = undoSchema.safeParse(raw);
    if (!parsed.success) return false;
    const undo = parsed.data;

    switch (undo.kind) {
      case "subject.restore":
        await tx.subject.create({ data: undo.payload });
        return true;
      case "announcement.restore":
        await tx.announcement.create({
          data: {
            ...undo.payload,
            createdAt: undo.payload.createdAt
              ? new Date(undo.payload.createdAt)
              : undefined,
            acks: {
              create: (undo.payload.acks ?? []).map((a) => ({
                userId: a.userId,
                ackedAt: new Date(a.ackedAt),
              })),
            },
          },
        });
        return true;
      case "card.review": {
        if (undo.payload.expectedUpdatedAt) {
          const current = await tx.disciplinaryCard.findUniqueOrThrow({
            where: { id: undo.payload.id },
          });
          if (
            current.updatedAt.toISOString() !== undo.payload.expectedUpdatedAt
          )
            throw new Error("Card changed since this review.");
        }
        const card = await tx.disciplinaryCard.update({
          where: {
            id: undo.payload.id,
            ...(undo.payload.expectedUpdatedAt
              ? { updatedAt: new Date(undo.payload.expectedUpdatedAt) }
              : {}),
          },
          data: {
            reviewStatus: undo.payload.reviewStatus,
            reviewNote: undo.payload.reviewNote,
            reviewedById: undo.payload.reviewedById,
            ...(undo.payload.reviewedAt === undefined
              ? {}
              : {
                  reviewedAt: undo.payload.reviewedAt
                    ? new Date(undo.payload.reviewedAt)
                    : null,
                }),
          },
        });
        await syncPunishmentRemoval(tx, card.tuteeId);
        return true;
      }
      case "application.status": {
        if (undo.payload.expectedUpdatedAt) {
          const current = await tx.tutorApplication.findUniqueOrThrow({
            where: { id: undo.payload.id },
          });
          if (
            current.updatedAt.toISOString() !== undo.payload.expectedUpdatedAt
          )
            throw new Error("Application changed since this decision.");
        }
        await tx.tutorApplication.update({
          where: {
            id: undo.payload.id,
            ...(undo.payload.expectedUpdatedAt
              ? { updatedAt: new Date(undo.payload.expectedUpdatedAt) }
              : {}),
          },
          data: { status: undo.payload.status },
        });
        await reconcileApplication(tx, undo.payload.id);
        return true;
      }
      case "tutee.status":
        if (undo.payload.status !== "INACTIVE")
          await preserveHistoricalAcademics(tx, "TUTEE", undo.payload.id);
        await tx.tutee.update({
          where: { id: undo.payload.id },
          data: { status: undo.payload.status },
        });
        return true;
    }
  });
}
