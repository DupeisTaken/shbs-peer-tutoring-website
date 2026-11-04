import { z } from "zod";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";
import { assertFeatureEnabled } from "~/server/program/features";
import { expectedUpdatedAt, staleConflict } from "~/server/concurrency";
import { syncPunishmentRemoval } from "~/server/discipline/removal";
import { recordAudit } from "~/server/audit/record";

export const cardReviewInput = z.object({
  id: z.string().min(1),
  reviewStatus: z.enum(["VALID", "INVALID"]),
  reviewNote: z.string().trim().max(500).optional(),
  expectedUpdatedAt,
});
const cardCorrectionInput = cardReviewInput.extend({
  reviewStatus: z.enum(["PENDING", "VALID", "INVALID"]),
});

/** A recovery is a fresh review by the current actor. Original issuance and
 * earlier review evidence remain immutable; standing uses all current cards. */
export async function reviewCard(
  db: DomainDb,
  raw: z.input<typeof cardReviewInput>,
  actor: { id: string; name?: string | null },
) {
  return correctCardReview(db, cardReviewInput.parse(raw), actor);
}

/** Restoring a pending checkpoint reopens review through a new attributed action,
 * without copying the original reviewer or review timestamp. */
export async function correctCardReview(
  db: DomainDb,
  raw: z.input<typeof cardCorrectionInput>,
  actor: { id: string; name?: string | null },
) {
  const input = cardCorrectionInput.parse(raw);
  return inTransaction(db, async (tx) => {
    const { withAutomaticRecoveryCheckpoint } =
      await import("~/server/recovery/checkpoint");
    return withAutomaticRecoveryCheckpoint(
      tx,
      { adapter: "CARD", sourceId: input.id },
      actor,
      async () => {
        await assertFeatureEnabled(tx, "DISCIPLINE");
        const prev = await tx.disciplinaryCard.findUniqueOrThrow({
          where: { id: input.id },
          select: {
            reviewStatus: true,
            reviewNote: true,
            reviewedAt: true,
            reviewedById: true,
            tuteeId: true,
            tutee: { select: { englishName: true } },
          },
        });
        // Standing and card review share the same participant fence as recovery.
        await lockEntity(tx, `tutee:${prev.tuteeId}`);
        const res = await tx.disciplinaryCard.updateMany({
          where: { id: input.id, updatedAt: input.expectedUpdatedAt },
          data: {
            reviewStatus: input.reviewStatus,
            reviewNote: input.reviewNote?.trim()
              ? input.reviewNote.trim()
              : null,
            reviewedById: actor.id,
            reviewedAt: new Date(),
          },
        });
        if (res.count === 0) staleConflict();
        // Validating a card can push the tutee over the removal threshold — auto-remove if so
        // (the helper sets them INACTIVE, detaches pairings, and notifies the tutor + admins).
        await syncPunishmentRemoval(tx, prev.tuteeId);
        const after = await tx.disciplinaryCard.findUniqueOrThrow({
          where: { id: input.id },
          select: { updatedAt: true },
        });
        await recordAudit(
          {
            userId: actor.id,
            userName: actor.name,
            action: `Flagged ${prev.tutee.englishName}'s card ${input.reviewStatus.toLowerCase()}`,
            entity: "DisciplinaryCard",
            entityId: input.id,
            undo: {
              kind: "card.review",
              payload: {
                id: input.id,
                reviewStatus: prev.reviewStatus,
                reviewNote: prev.reviewNote,
                reviewedAt: prev.reviewedAt?.toISOString() ?? null,
                reviewedById: prev.reviewedById,
                expectedUpdatedAt: after.updatedAt.toISOString(),
              },
            },
          },
          tx,
        );
        return { ok: true };
      },
    );
  });
}
