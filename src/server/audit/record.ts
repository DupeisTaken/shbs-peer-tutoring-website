/** Audit persistence accepts the caller's transaction and never loads undo/web execution. */
import { z } from "zod";
import type { Prisma } from "../../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";
import { approvalScope, auditActorScope } from "~/server/db-scope";
import { safeAuditSnapshot } from "./evidence";

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
  client: TransactionDb,
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
        evidenceVersion: 1,
        actorRole: args.userId
          ? (args.role ?? actor?.role ?? "UNKNOWN_LEGACY")
          : "SYSTEM",
        outcome: "APPLIED",
        before: safeAuditSnapshot(args.before, args.entity),
        after: safeAuditSnapshot(args.after, args.entity),
        ...(args.before === undefined && args.after === undefined
          ? {
              detailAvailability:
                "Before/after details were not captured by this writer",
            }
          : {}),
        ...(args.originalActionId
          ? { originalActionId: args.originalActionId }
          : {}),
        ...(args.reason ? { reason: args.reason } : {}),
        ...(args.effects ? { effects: args.effects } : {}),
      },
    },
  });
}

