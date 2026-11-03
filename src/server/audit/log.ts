import { preserveHistoricalAcademics } from "~/server/historical-academics";
import { assertStudentRequestAssignable } from "~/server/student-request-state";
import { lockApplicationReview } from "~/server/request-invalidity";
import { lockUsernameNamespace } from "~/server/auth/username";
/**
 * Audit log + typed undo. Every admin mutation that's hard to reverse by hand records an
 * AuditLog entry carrying a typed `undo` describing its inverse, so it can be reverted from
 * /admin/audit. See docs/reference/technical-report.md#approval-transactions for transaction boundaries.
 *
 * Node runtime only.
 */

import { db } from "~/server/db";
import {
  inTransaction,
  lockEntity,
  type TransactionDb,
} from "~/server/transactions";
import { reconcileApplication } from "~/server/tutors/application-status";
import { syncPunishmentRemoval } from "~/server/discipline/removal";

import { recordAudit as recordAuditWithDb, undoSchema, type RecordAuditArgs } from "./record";
export { undoSchema, type UndoData, type RecordAuditArgs } from "./record";

/** Web convenience wrapper; domain writers pass their existing transaction. */
export function recordAudit(args: RecordAuditArgs, client: TransactionDb = db): Promise<void> {
  return recordAuditWithDb(args, client);
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
        // Match card recovery: acquire the global consequence fence and exact
        // participant fence before any card row lock or journaled mutation.
        await lockEntity(tx, "program:period");
        const source = await tx.disciplinaryCard.findUniqueOrThrow({
          where: { id: undo.payload.id },
          select: { tuteeId: true },
        });
        await lockEntity(tx, `tutee:${source.tuteeId}`);
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
        await lockUsernameNamespace(tx);
        await lockApplicationReview(tx, undo.payload.id);
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
        if (undo.payload.status !== "INACTIVE") {
          await assertStudentRequestAssignable(tx, undo.payload.id);
          await preserveHistoricalAcademics(tx, "TUTEE", undo.payload.id);
        }
        await tx.tutee.update({
          where: { id: undo.payload.id },
          data: { status: undo.payload.status },
        });
        return true;
    }
  });
}
