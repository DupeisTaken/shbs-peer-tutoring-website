import { z } from "zod";
import type { DisciplinaryCard } from "../../../../generated/prisma";
import { correctCardReview } from "~/server/corrections/card";
import { getFeatures } from "~/server/program/features";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { recoveryHash, recoveryJson } from "../capture";
import type {
  CheckpointAdapter,
  CheckpointJournalChange,
} from "../checkpoint-contract";
import { fieldsOnly, preservedCheckpointChange } from "./shared";
import {
  correctionParticipant,
  correctionParticipantState,
  inspectCorrectionRestoration,
  lockCorrectionAssignments,
} from "./correction-state";

const snapshot = z.object({
  version: z.literal(1),
  id: z.string(),
  issuanceHash: z.string(),
  reviewStatus: z.enum(["PENDING", "VALID", "INVALID"]),
  participant: correctionParticipant,
});
const reviewFields = [
  "reviewStatus",
  "reviewNote",
  "reviewedById",
  "reviewedAt",
  "updatedAt",
];
function issuance(card: DisciplinaryCard) {
  return {
    id: card.id,
    tuteeId: card.tuteeId,
    color: card.color,
    source: card.source,
    reason: card.reason,
    issuedByTutorId: card.issuedByTutorId,
    sessionId: card.sessionId,
    createdAt: card.createdAt,
  };
}
function key(change: CheckpointJournalChange) {
  return change.recordKey &&
    typeof change.recordKey === "object" &&
    !Array.isArray(change.recordKey)
    ? change.recordKey
    : {};
}
export function independentCard(
  change: CheckpointJournalChange,
  selectedId: string,
  tuteeId: string,
) {
  if (change.entity !== "DisciplinaryCard" || key(change).id === selectedId)
    return false;
  const body = change.after ?? change.before;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    body.tuteeId !== tuteeId
  )
    return false;
  // Their current judgments contribute to standing but are never replayed. A
  // delete/rebind or accompanying lifecycle action still requires its own review.
  return (
    change.operation === "INSERT" ||
    fieldsOnly(change, "DisciplinaryCard", reviewFields)
  );
}
export function supportedCardConsequence(
  change: CheckpointJournalChange,
  tuteeIds: Set<string>,
  causalEvents: Set<string>,
  punishmentIds: Set<string>,
  pairingIds: Set<string>,
) {
  if (!causalEvents.has(change.eventId)) return false;
  const record = key(change);
  const body = change.after ?? change.before;
  const owner =
    body && typeof body === "object" && !Array.isArray(body)
      ? body.tuteeId
      : null;
  if (
    change.entity === "Pairing" &&
    typeof record.id === "string" &&
    pairingIds.has(record.id) &&
    fieldsOnly(change, "Pairing", ["roomVersion"])
  ) {
    const before =
      change.before &&
      typeof change.before === "object" &&
      !Array.isArray(change.before)
        ? change.before
        : {};
    const after =
      change.after &&
      typeof change.after === "object" &&
      !Array.isArray(change.after)
        ? change.after
        : {};
    return (
      typeof before.roomVersion === "number" &&
      after.roomVersion === before.roomVersion + 1
    );
  }
  if (
    change.entity === "Tutee" &&
    typeof record.id === "string" &&
    tuteeIds.has(record.id)
  )
    return fieldsOnly(change, "Tutee", ["status", "updatedAt"]);
  if (
    change.entity === "PairingTutee" &&
    typeof record.tuteeId === "string" &&
    tuteeIds.has(record.tuteeId)
  )
    return ["INSERT", "DELETE"].includes(change.operation);
  if (
    change.entity === "TuteeRemovalRequest" &&
    typeof record.id === "string" &&
    punishmentIds.has(record.id) &&
    typeof owner === "string" &&
    tuteeIds.has(owner)
  )
    return (
      change.operation === "INSERT" ||
      fieldsOnly(change, "TuteeRemovalRequest", [
        "state",
        "resolvedAt",
        "resolvedByName",
        "pairingSnapshot",
        "removedPeriodKey",
      ])
    );
  return false;
}
async function state(tx: TransactionDb, id: string) {
  const card = await tx.disciplinaryCard.findUniqueOrThrow({ where: { id } });
  return {
    card,
    features: await getFeatures(tx),
    participant: await correctionParticipantState(tx, card.tuteeId),
    cards: await tx.disciplinaryCard.findMany({
      where: { tuteeId: card.tuteeId },
      orderBy: { id: "asc" },
    }),
  };
}
export const cardCheckpointAdapter: CheckpointAdapter = {
  id: "CARD",
  version: 1,
  sourceEntity: "DisciplinaryCard",
  directRoles: ["ADMIN", "HEAD"],
  async lock(tx, id) {
    await lockCorrectionAssignments(tx);
    const card = await tx.disciplinaryCard.findUniqueOrThrow({
      where: { id },
      select: { tuteeId: true },
    });
    await lockEntity(tx, `tutee:${card.tuteeId}`);
    await tx.$queryRaw`SELECT id FROM "DisciplinaryCard" WHERE id=${id} FOR UPDATE`;
  },
  async capture(tx, id) {
    const current = await state(tx, id);
    return {
      snapshot: recoveryJson(
        snapshot.parse({
          version: 1,
          id,
          issuanceHash: recoveryHash(issuance(current.card)),
          reviewStatus: current.card.reviewStatus,
          participant: current.participant.snapshot,
        }),
      ),
      scope: [
        { entity: "Tutee", recordId: current.card.tuteeId },
        ...current.participant.identity.ownerIds.map((recordId) => ({
          entity: "User",
          recordId,
        })),
        ...current.participant.memberships.map((row) => ({
          entity: "Pairing",
          recordId: row.pairingId,
        })),
        ...current.participant.groupPairings.map((row) => ({
          entity: "Pairing",
          recordId: row.id,
        })),
      ],
    };
  },
  async inspect(tx, id, raw, context) {
    const saved = snapshot.parse(raw);
    const current = await state(tx, id);
    const restoration = await inspectCorrectionRestoration(
      tx,
      saved.participant,
      current.participant,
      { reviews: [{ id, reviewStatus: saved.reviewStatus }] },
    );
    const blockers = restoration.blockers;
    if (!current.features.DISCIPLINE)
      blockers.push("The discipline module must be enabled before reviewing a card.");
    if (
      saved.id !== id ||
      saved.issuanceHash !== recoveryHash(issuance(current.card))
    )
      blockers.push("Original card issuance changed.");
    const events = new Set(
      context.changes
        .filter(
          (change) =>
            key(change).id === id &&
            fieldsOnly(change, "DisciplinaryCard", reviewFields),
        )
        .map((change) => change.eventId),
    );
    if (
      context.changes.some(
        (change) =>
          !preservedCheckpointChange(change) &&
          !independentCard(change, id, current.card.tuteeId) &&
          !(
            key(change).id === id &&
            fieldsOnly(change, "DisciplinaryCard", reviewFields)
          ) &&
          !supportedCardConsequence(
            change,
            new Set([current.card.tuteeId]),
            events,
            new Set(
              current.participant.removals
                .filter((row) => row.kind === "PUNISHMENT")
                .map((row) => row.id),
            ),
            new Set([
              ...saved.participant.memberships.map((row) => row.pairingId),
              ...saved.participant.groupPairingIds,
            ]),
          ),
      )
    )
      blockers.push(
        "Independent discipline, membership or attendance decisions require their own correction.",
      );
    return {
      current: recoveryJson({ ...current, restoration }),
      compensatedEventIds: [...events],
      blockers,
      warnings: [
        "Standing is recomputed from all current cards; historical balances and reviewer credentials are never restored.",
      ],
      effects: [
        `Record a new ${saved.reviewStatus.toLowerCase()} review of this card.`,
        "Recompute punishment consequences with current participation checks.",
      ],
      preserved: [
        "Original issuance and all previous review/removal evidence.",
        "Independent cards, credentials, access restrictions and policy agreements.",
      ],
    };
  },
  async apply(tx, id, raw, actor, reason) {
    const saved = snapshot.parse(raw);
    const current = await state(tx, id);
    await correctCardReview(
      tx,
      {
        id,
        expectedUpdatedAt: current.card.updatedAt,
        reviewStatus: saved.reviewStatus,
        reviewNote: `Recovery: ${reason}`.slice(0, 500),
      },
      actor,
    );
    return {
      cardId: id,
      reviewStatus: saved.reviewStatus,
      reviewerId: actor.id,
      standingRecomputed: true,
    };
  },
};
