import { z } from "zod";
import type { TransactionDb } from "~/server/transactions";
import { recoveryHash, recoveryJson } from "../capture";
import { participantIdentity } from "./shared";
import {
  inspectRecoveryAssignmentEligibility,
  recoveryAssignmentSnapshot,
} from "./assignment-eligibility";
import { lockCatalogue } from "~/server/qualifications";
import { lockPlannedRoomSchedule } from "~/server/room-bookings";
import { lockSessionPlanning } from "~/server/session-planning";
import { standingFromCounts } from "~/lib/discipline";

export const correctionMembership = z.object({
  pairingId: z.string(),
  scheduleHash: z.string(),
  enrollmentHash: z.string(),
});
export const correctionParticipant = z.object({
  id: z.string(),
  bindingHash: z.string(),
  memberships: z.array(correctionMembership),
  groupPairingIds: z.array(z.string()),
});
const removalSnapshot = z.object({
  pairingIds: z.array(z.string()),
  status: z.enum(["ACTIVE", "PENDING", "INACTIVE"]),
});

/** Fingerprints bind retained assignments and enrollment consent, not credentials.
 * A correction may recompute standing; it cannot invent consent to a new roster. */
export async function correctionParticipantState(
  tx: TransactionDb,
  id: string,
) {
  const identity = await participantIdentity(tx, "TUTEE", id);
  const record = await tx.tutee.findUniqueOrThrow({
    where: { id },
    select: { id: true, status: true, updatedAt: true },
  });
  const links = await tx.pairingTutee.findMany({
    where: { tuteeId: id },
    orderBy: { pairingId: "asc" },
  });
  const removals = await tx.tuteeRemovalRequest.findMany({
    where: { tuteeId: id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const cards = await tx.disciplinaryCard.findMany({
    where: { tuteeId: id },
    orderBy: { id: "asc" },
  });
  const latest = removals
    .filter((row) => row.kind === "PUNISHMENT" && row.state === "APPROVED")
    .sort(
      (a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0),
    )[0];
  const previous = removalSnapshot.safeParse(latest?.pairingSnapshot);
  const pairingIds = [
    ...new Set([
      ...links.map((link) => link.pairingId),
      ...(previous.success ? previous.data.pairingIds : []),
    ]),
  ].sort();
  const survey = await tx.studentSurvey.findUnique({ where: { tuteeId: id } });
  const pairings = await tx.pairing.findMany({
    where: { id: { in: pairingIds } },
    include: { term: true },
    orderBy: { id: "asc" },
  });
  const groups = pairings.flatMap((pairing) =>
    pairing.groupId ? [pairing.groupId] : [],
  );
  const groupPairings = groups.length
    ? await tx.pairing.findMany({
        where: { groupId: { in: groups } },
        select: { id: true, groupId: true, tutorId: true, termId: true },
        orderBy: { id: "asc" },
      })
    : [];
  const memberships = [];
  for (const pairing of pairings) {
    const binding = await recoveryAssignmentSnapshot(tx, pairing.id, id);
    memberships.push({
      pairingId: pairing.id,
      scheduleHash: binding.scheduleHash,
      enrollmentHash: binding.enrollmentHash,
    });
  }
  const restoration =
    latest &&
    previous.success &&
    record.status === "INACTIVE" &&
    latest.resolvedAt?.getTime() === record.updatedAt.getTime()
      ? {
          requestId: latest.id,
          pairingIds: previous.data.pairingIds,
          status: previous.data.status,
        }
      : null;
  return {
    identity,
    record,
    links,
    removals,
    cards,
    pairings,
    groupPairings,
    memberships,
    restoration,
    snapshot: {
      id,
      bindingHash: recoveryHash(identity.binding),
      memberships,
      groupPairingIds: groupPairings.map((row) => row.id),
    },
    fingerprint: recoveryJson({
      identity,
      record,
      links,
      removals,
      cards,
      pairings,
      groupPairings,
      survey,
    }),
  };
}

export function correctionParticipantBlockers(
  saved: z.infer<typeof correctionParticipant>,
  current: Awaited<ReturnType<typeof correctionParticipantState>>,
  restoreMemberships = true,
) {
  const blockers: string[] = [];
  if (
    saved.id !== current.record.id ||
    saved.bindingHash !== recoveryHash(current.identity.binding)
  )
    blockers.push("Recorded participant ownership or grouping changed.");
  for (const pairingId of restoreMemberships
    ? (current.restoration?.pairingIds ?? [])
    : []) {
    const before = saved.memberships.find((row) => row.pairingId === pairingId);
    const now = current.memberships.find((row) => row.pairingId === pairingId);
    if (
      !before ||
      before.scheduleHash !== now?.scheduleHash ||
      before.enrollmentHash !== now?.enrollmentHash
    )
      blockers.push(
        "Punishment reversal would restore an assignment whose identity, schedule or enrollment consent changed.",
      );
  }
  return blockers;
}

export async function lockCorrectionAssignments(tx: TransactionDb) {
  await lockCatalogue(tx);
  await lockPlannedRoomSchedule(tx);
  await lockSessionPlanning(tx);
}

export async function inspectCorrectionRestoration(
  tx: TransactionDb,
  saved: z.infer<typeof correctionParticipant>,
  current: Awaited<ReturnType<typeof correctionParticipantState>>,
  projection: {
    reviews: Array<{
      id: string;
      reviewStatus: "PENDING" | "VALID" | "INVALID";
    }>;
    addedRed?: number;
  },
) {
  // Evaluate the reviewed correction, not the mistaken contribution it removes.
  // Every independent current card remains in these counts.
  const valid = current.cards.filter(
    (card) =>
      (projection.reviews.find((review) => review.id === card.id)
        ?.reviewStatus ?? card.reviewStatus) === "VALID",
  );
  const disciplineAfterCorrection = {
    validYellow: valid.filter((card) => card.color === "YELLOW").length,
    validRed:
      valid.filter((card) => card.color === "RED").length +
      (projection.addedRed ?? 0),
  };
  const restores = !standingFromCounts({
    ...disciplineAfterCorrection,
    pendingYellow: 0,
    pendingRed: 0,
  }).removalPending;
  const blockers = correctionParticipantBlockers(saved, current, restores);
  const evidence = [];
  for (const pairingId of restores
    ? (current.restoration?.pairingIds ?? [])
    : []) {
    const before = saved.memberships.find((row) => row.pairingId === pairingId);
    if (!before || !current.pairings.some((row) => row.id === pairingId))
      continue;
    const inspected = await inspectRecoveryAssignmentEligibility(tx, {
      pairingId,
      tuteeId: saved.id,
      expectedScheduleHash: before.scheduleHash,
      expectedEnrollmentHash: before.enrollmentHash,
      restoredTuteeStatus: current.restoration?.status,
      disciplineAfterCorrection,
    });
    blockers.push(...inspected.blockers);
    evidence.push(inspected.evidence);
  }
  return { blockers, evidence, disciplineAfterCorrection, restores };
}
