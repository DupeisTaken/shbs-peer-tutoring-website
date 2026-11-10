import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { TuteeRemovalRequest } from "../../../generated/prisma";
import { getActivePeriodOrNull } from "~/server/period";
import { requireParticipantSourceParticipation } from "~/server/participant-source-restrictions";
import type { TransactionDb } from "~/server/transactions";

export const punishmentRemovalSnapshot = z.object({
  pairingIds: z.array(z.string()).max(1000),
  status: z.literal("ACTIVE"),
});
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const fields = (value: unknown) => z.array(z.string()).safeParse(value);
/** PostgreSQL to_jsonb renders TIMESTAMP(3) without an offset. Prisma treats
 * these database values as UTC, so journal proof must do the same on every host. */
const journalTime = (value: string) =>
  new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : value + "Z").getTime();
const originFields = [
  "id", "status", "personId", "historyIdentityRevision", "intakeTermId",
  "signupSource", "signupSubmittedAt", "signedRulebook", "signedAt", "signatureName",
];

/** A general updatedAt cannot distinguish a profile edit from a status decision.
 * Prospective database evidence proves this exact removal and every later status
 * transition, including away-and-back writes. Unknown history stays manual. */
async function hasUnchangedRemovalOrigin(
  tx: TransactionDb,
  removal: TuteeRemovalRequest,
  sourceUserIds: string[],
) {
  const roots = await tx.recoveryTrackedEntity.findMany({
    where: { entity: "Tutee", recordId: removal.tuteeId },
    select: { actionId: true }, take: 257,
  });
  if (!roots.length || roots.length > 256) return false;
  const approvals = await tx.recoveryChange.findMany({
    where: {
      actionId: { in: roots.map((root) => root.actionId) },
      entity: "TuteeRemovalRequest", operation: "UPDATE",
      recordKey: { path: ["id"], equals: removal.id },
      AND: [
        { before: { path: ["state"], equals: "PENDING" } },
        { after: { path: ["state"], equals: "APPROVED" } },
      ],
    },
    orderBy: { id: "asc" }, take: 257,
  });
  if (!approvals.length || approvals.length > 256 || !removal.resolvedAt) return false;
  const snapshot = punishmentRemovalSnapshot.parse(removal.pairingSnapshot);
  if (new Set(snapshot.pairingIds).size !== snapshot.pairingIds.length) return false;
  const assignments = await tx.pairing.findMany({
    where: { id: { in: snapshot.pairingIds } }, select: { tutorId: true },
  });
  const tutorIds = assignments.map((pairing) => pairing.tutorId);
  const checkpoints = await tx.recoveryCheckpoint.findMany({
    where: { actionId: { in: approvals.map((row) => row.actionId) } },
    select: { actionId: true, captureTransactionId: true, action: { select: { kind: true } } },
  });
  const events = await tx.recoveryEvent.findMany({
    where: { id: { in: approvals.map((row) => row.eventId) } },
    select: { id: true, actionId: true, transactionId: true },
  });
  // Old overlapping roots also observe this write. Only the prospective root
  // captured by this logical action supplies complete original provenance.
  const owning = approvals.filter((approval) => checkpoints.some((checkpoint) =>
    checkpoint.action.kind === "DOMAIN_CHECKPOINT" && checkpoint.actionId === approval.actionId && events.some((event) =>
      event.id === approval.eventId && event.actionId === approval.actionId &&
      event.transactionId === checkpoint.captureTransactionId)));
  if (owning.length !== 1) return false;
  for (const approval of owning) {
    const changed = fields(approval.changedFields);
    if (!changed.success || !changed.data.includes("state") ||
      object(approval.before).id !== removal.id || object(approval.after).id !== removal.id ||
      object(approval.before).tuteeId !== removal.tuteeId ||
      object(approval.after).tuteeId !== removal.tuteeId)
      return false;
    // Compensation omits its own journal and closes future descendant capture.
    // A receipt therefore invalidates this proof even if status later looks equal.
    if (await tx.recoveryReceipt.findUnique({ where: { actionId: approval.actionId } }))
      return false;
    const candidates = await tx.recoveryChange.findMany({
      where: {
        actionId: approval.actionId, eventId: approval.eventId,
        entity: "Tutee", operation: "UPDATE", id: { lt: approval.id },
        recordKey: { path: ["id"], equals: removal.tuteeId },
      }, take: 101,
    });
    if (candidates.length > 100) return false;
    const anchors = candidates.filter((change) => {
      const before = object(change.before);
      const after = object(change.after);
      const changed = fields(change.changedFields);
      return before.id === removal.tuteeId && after.id === removal.tuteeId &&
        before.status === "ACTIVE" && after.status === "INACTIVE" &&
        typeof after.updatedAt === "string" &&
        journalTime(after.updatedAt) === removal.resolvedAt!.getTime() &&
        changed.success && changed.data.includes("status");
    });
    if (anchors.length !== 1) return false;
    const anchor = anchors[0]!;
    const deleted = await tx.recoveryChange.findMany({ where: {
      actionId: approval.actionId, eventId: approval.eventId,
      entity: "PairingTutee", operation: "DELETE",
      id: { gt: anchor.id, lt: approval.id },
      recordKey: { path: ["tuteeId"], equals: removal.tuteeId },
    }, take: 1001 });
    const deletedIds = deleted.map((change) => object(change.recordKey).pairingId);
    if (deleted.length > 1000 || new Set(deletedIds).size !== deletedIds.length ||
      deletedIds.some((id) => typeof id !== "string") ||
      deleted.some((change) => object(change.before).tuteeId !== removal.tuteeId ||
        object(change.before).pairingId !== object(change.recordKey).pairingId || change.after !== null) ||
      JSON.stringify([...new Set(deletedIds)].sort()) !== JSON.stringify([...snapshot.pairingIds].sort())) return false;
    const later = await tx.recoveryChange.findMany({
      where: {
        actionId: approval.actionId, id: { gt: anchor.id },
        entity: { in: ["Tutee", "Pairing", "PairingTutee", "TuteeRemovalRequest", "StudentSurvey",
          "StudentRequestReview", "StudentQuarterBlock", "SchoolDeparture", "SchoolDepartureEvent",
          "HistoryRowOwnership", "StudentProfileOwnership", "TutorProfileOwnership", "StudentRequestExecutionAssignment",
          "PersonHistoryCorrectionReceipt", "PersonParticipationTransferReceipt", "PersonPartitionReceipt",
          "PersonCombineReceipt", "Person", "ParticipantConsolidation", "PairingExecutionSuccessor", "User"] },
      },
      orderBy: { id: "asc" }, take: 2001,
    });
    if (later.length > 2000) return false;
    for (const change of later) {
      const key = object(change.recordKey);
      const before = object(change.before);
      const after = object(change.after);
      const changed = fields(change.changedFields);
      if (change.entity === "TuteeRemovalRequest" && [key, before, after].some((row) => row.id === removal.id) &&
        change.id > approval.id && (!changed.success || changed.data.some((field) =>
          ["id", "pairingSnapshot", "tuteeId", "kind", "state", "resolvedAt", "removedPeriodKey"].includes(field))))
        return false;
      if (change.entity === "Pairing" && [key, before, after].some((row) =>
        typeof row.id === "string" && snapshot.pairingIds.includes(row.id)) &&
        (change.operation !== "UPDATE" || !changed.success || changed.data.some(
          (field) => ["id", "tutorId", "termId", "subject", "dayOfWeek", "startMin", "endMin",
            "groupId", "timeSlotId", "roomId", "roomMode", "scheduleConfirmed"].includes(field),
        ))) return false;
      if (change.entity === "Tutee" && [key, before, after].some((row) => row.id === removal.tuteeId)) {
        if (change.operation !== "UPDATE" || !changed.success ||
          changed.data.some((field) => originFields.includes(field)) ||
          before.status !== "INACTIVE" || after.status !== "INACTIVE") return false;
      }
      // Ownership/execution decisions remain independent even if the roster's
      // status stays INACTIVE. Profile/contact answer edits have no such effect.
      const ownsSource = key.tuteeId === removal.tuteeId ||
        before.tuteeId === removal.tuteeId || after.tuteeId === removal.tuteeId;
      if (change.entity === "PairingExecutionSuccessor" && [key, before, after].some((row) =>
        [row.sourcePairingId, row.targetPairingId].some((id) => typeof id === "string" && snapshot.pairingIds.includes(id))))
        return false;
      if (change.entity === "TutorProfileOwnership" && [key, before, after].some((row) =>
        typeof row.tutorId === "string" && tutorIds.includes(row.tutorId))) return false;
      if (change.entity === "PairingTutee" && ownsSource && change.id > approval.id) return false;
      if (change.entity === "TuteeRemovalRequest" && ownsSource &&
        key.id !== removal.id && after.state === "APPROVED") return false;
      if (change.entity === "StudentRequestReview" &&
        (before.legacyTuteeId === removal.tuteeId || after.legacyTuteeId === removal.tuteeId) &&
        after.state === "APPROVED") return false;
      if (change.entity === "StudentQuarterBlock" &&
        [before, after].some((row) => row.legacyTuteeId === removal.tuteeId ||
          (typeof row.userId === "string" && sourceUserIds.includes(row.userId)))) return false;
      if (["SchoolDeparture", "SchoolDepartureEvent"].includes(change.entity) &&
        [before, after].some((row) => typeof row.userId === "string" && sourceUserIds.includes(row.userId)))
        return false;
      if (change.entity === "HistoryRowOwnership" && [key, before, after].some(
        (row) => row.entity === "Tutee" && row.recordId === removal.tuteeId,
      )) return false;
      if (["PersonHistoryCorrectionReceipt", "PersonParticipationTransferReceipt", "PersonPartitionReceipt"].includes(change.entity) &&
        [before, after].some((row) => Array.isArray(row.subjects) && row.subjects.some((subject: unknown) =>
          object(subject).entity === "Tutee" && object(subject).recordId === removal.tuteeId))) return false;
      const personId = object(anchor.after).personId;
      if (typeof personId === "string" && (
        (change.entity === "Person" && key.id === personId) ||
        (change.entity === "PersonCombineReceipt" && [before, after].some((row) => row.personId === personId))
      )) return false;
      if (change.entity === "StudentSurvey" && ownsSource &&
        (change.operation !== "UPDATE" || !changed.success || changed.data.some(
          (field) => ["id", "tuteeId", "intakeTermId", "state", "invalidatedAt", "policyRevision", "policySnapshot", "payload"].includes(field),
        ))) return false;
      if (["StudentProfileOwnership", "StudentRequestExecutionAssignment"].includes(change.entity) &&
        (ownsSource || before.sourceTuteeId === removal.tuteeId || after.sourceTuteeId === removal.tuteeId))
        return false;
      if (change.entity === "ParticipantConsolidation" &&
        [before, after].some((row) =>
          (row.kind === "TUTEE" && (row.sourceId === removal.tuteeId || row.targetId === removal.tuteeId)) ||
          (row.kind === "TUTOR" && [row.sourceId, row.targetId].some((id) => typeof id === "string" && tutorIds.includes(id))))) return false;
      if (change.entity === "User" &&
        [key, before, after].some((row) => row.studentId === removal.tuteeId ||
          (typeof row.id === "string" && sourceUserIds.includes(row.id))) &&
        (!changed.success || changed.data.some((field) =>
          ["id", "studentId", "tuteeMember", "mergedIntoId", "personId", "suspendedAt", "recoveryVoidedAt"].includes(field))))
        return false;
    }
  }
  return true;
}

/** Shared by ordinary correction and recovery's consequence projection. A valid
 * card correction can commit while an independent participation blocker remains. */
export async function canReinstatePunishmentRemoval(
  tx: TransactionDb,
  tutee: { id: string; status: string },
  removal: TuteeRemovalRequest | null | undefined,
) {
  if (removal?.tuteeId !== tutee.id || removal.kind !== "PUNISHMENT" ||
    removal.state !== "APPROVED" || tutee.status !== "INACTIVE" ||
    !punishmentRemovalSnapshot.safeParse(removal.pairingSnapshot).success)
    return false;
  const period = await getActivePeriodOrNull(tx);
  if (!period || removal.removedPeriodKey !== `${period.schoolYear} ${period.quarter}`)
    return false;
  try {
    const source = await requireParticipantSourceParticipation(tx, "TUTEE", tutee.id);
    if (!await hasUnchangedRemovalOrigin(tx, removal, source.sourceUserIds)) return false;
    // This predicate also runs during read-only checkpoint projection. Do not
    // acquire request-row locks ahead of the checkpoint's scheduling lock order.
    if (await tx.legacySignupDecline.findUnique({ where: { tuteeId: tutee.id } })) return false;
    const survey = await tx.studentSurvey.findUnique({ where: { tuteeId: tutee.id } });
    if (survey && (survey.intakeTermId !== period.termId || survey.state !== "OPEN" ||
      survey.invalidatedAt || (!survey.confirmedAt && survey.verificationDueAt &&
        survey.verificationDueAt <= new Date()))) return false;
    if (!survey && (await tx.tuteeRequestInvalidity.findUnique({ where: { tuteeId: tutee.id } }))?.invalidatedAt)
      return false;
    if (await tx.studentRequestReview.findFirst({ where: {
      kind: "STUDENT_ABORT", state: "APPROVED",
      OR: [
        { legacyTuteeId: tutee.id, legacyIntakeTermId: period.termId },
        ...(survey ? [{ surveyId: survey.id }] : []),
      ],
    } })) return false;
    const owners = await tx.user.findMany({
      where: { id: { in: source.sourceUserIds } }, select: { email: true },
    });
    if (await tx.studentQuarterBlock.findFirst({ where: {
      intakeTermId: period.termId,
      OR: [
        { legacyTuteeId: tutee.id },
        ...(survey ? [{ surveyId: survey.id }] : []),
        { userId: { in: source.sourceUserIds } },
        { email: { in: owners.map((owner) => owner.email) } },
      ],
    } })) return false;
  } catch (error) {
    if (error instanceof TRPCError &&
      ["FORBIDDEN", "PRECONDITION_FAILED", "BAD_REQUEST", "CONFLICT"].includes(error.code))
      return false;
    throw error;
  }
  return true;
}
