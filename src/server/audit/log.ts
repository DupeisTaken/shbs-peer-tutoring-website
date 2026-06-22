/**
 * Audit log + typed undo. Every admin mutation that's hard to reverse by hand records an
 * AuditLog entry carrying a typed `undo` describing its inverse, so it can be reverted from
 * /admin/audit. See the "Admin design philosophies" note in CLAUDE.md (revertibility).
 *
 * Node runtime only.
 */
import { z } from "zod";

import { db } from "~/server/db";

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
    }),
  }),
  z.object({
    kind: z.literal("card.review"),
    payload: z.object({
      id: z.string(),
      reviewStatus: z.enum(["PENDING", "VALID", "INVALID"]),
      reviewNote: z.string().nullable(),
    }),
  }),
  z.object({
    kind: z.literal("application.status"),
    payload: z.object({
      id: z.string(),
      status: z.enum(["PENDING", "INTERVIEW", "ACCEPTED", "REJECTED"]),
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
}

export async function recordAudit(args: RecordAuditArgs): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: args.userId ?? null,
      userName: args.userName ?? null,
      action: args.action,
      entity: args.entity,
      entityId: args.entityId ?? null,
      undoData: args.undo ?? undefined,
    },
  });
}

/**
 * Apply the inverse described by a stored undo payload. Returns false if the payload is
 * malformed; throws (propagated) on a DB failure (e.g. unique-name collision on restore).
 */
export async function applyUndo(raw: unknown): Promise<boolean> {
  const parsed = undoSchema.safeParse(raw);
  if (!parsed.success) return false;
  const undo = parsed.data;

  switch (undo.kind) {
    case "subject.restore":
      await db.subject.create({ data: undo.payload });
      return true;
    case "announcement.restore":
      await db.announcement.create({ data: undo.payload });
      return true;
    case "card.review":
      await db.disciplinaryCard.update({
        where: { id: undo.payload.id },
        data: { reviewStatus: undo.payload.reviewStatus, reviewNote: undo.payload.reviewNote },
      });
      return true;
    case "application.status":
      await db.tutorApplication.update({
        where: { id: undo.payload.id },
        data: { status: undo.payload.status },
      });
      return true;
    case "tutee.status":
      await db.tutee.update({
        where: { id: undo.payload.id },
        data: { status: undo.payload.status },
      });
      return true;
  }
}
