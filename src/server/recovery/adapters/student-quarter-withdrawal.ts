import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  lockQuarterWithdrawalScope,
  quarterWithdrawalEvidenceSchema,
  readQuarterWithdrawalEvidence,
  type QuarterWithdrawalEvidence,
} from "~/server/student-quarter-withdrawal";
import { recoveryJson } from "../capture";
import {
  UnsupportedCheckpointSnapshot,
  type CheckpointAdapter,
  type CheckpointScopeEntity,
} from "../checkpoint-contract";

export const quarterWithdrawalRecoveryBlocker =
  "Approved quarter withdrawal is inspection-only. Generic recovery cannot reopen its requests, restore assignments or remove the quarter withdrawal block.";

const snapshotSchema = z.object({
  version: z.literal(1),
  reviewId: z.string().min(1).max(200),
  evidence: quarterWithdrawalEvidenceSchema,
}).strict();

function trackedScope(evidence: QuarterWithdrawalEvidence): CheckpointScopeEntity[] {
  const entries: CheckpointScopeEntity[] = [];
  const add = (entity: string, recordId: string | null | undefined) => {
    if (recordId) entries.push({ entity, recordId });
  };
  add("StudentRequestReview", evidence.review.id);
  add("User", evidence.owner?.id);
  add("Term", evidence.term?.id);
  for (const profile of evidence.profiles) {
    add("Tutee", profile.id);
    add("Tutee", profile.executionTuteeId);
    for (const ownerId of profile.directOwnerIds) add("User", ownerId);
    add("User", profile.retainedOwner?.userId);
  }
  for (const source of evidence.sources) {
    add("StudentSurvey", source.id);
    add("Tutee", source.tuteeId);
  }
  for (const assignment of [...evidence.assignments, ...evidence.effectiveAssignments]) {
    add("StudentSurvey", assignment.surveyId);
    add("Tutee", assignment.sourceTuteeId);
  }
  for (const member of [...evidence.assignments, ...evidence.effectiveAssignments, ...evidence.members, ...evidence.manualAssignments]) {
    add("Pairing", member.pairingId);
    add("Tutee", member.tuteeId);
  }
  for (const assignment of evidence.manualAssignments) {
    add("Pairing", assignment.sourcePairingId);
    add("Tutee", assignment.sourceTuteeId);
    // Every reviewed hop contributes authority, including tutor-only successors
    // and intermediate sources no longer present in the current physical roster.
    for (const edge of assignment.path) {
      add("PairingExecutionSuccessor", edge.sourcePairingId);
      add("Pairing", edge.sourcePairingId);
      add("Pairing", edge.targetPairingId);
      add("Tutee", edge.sourceTuteeId);
      add("Tutee", edge.targetTuteeId);
    }
  }
  for (const pairing of evidence.pairings) {
    add("Pairing", pairing.id);
    add("Term", pairing.termId);
    add("Tutor", pairing.tutorId);
  }
  for (const row of evidence.consolidations) {
    add("Tutee", row.sourceId);
    add("Tutee", row.targetId);
  }
  for (const row of evidence.pendingReviews) add("StudentRequestReview", row.id);
  for (const row of evidence.blocks) add("StudentQuarterBlock", row.id);
  for (const row of evidence.publication.plans) {
    add("SessionPlan", row.id);
    add("Term", row.termId);
  }
  for (const row of evidence.publication.participants) {
    add("SessionPlanParticipant", row.id);
    add("SessionPlan", row.planId);
    add("Tutee", row.tuteeId);
    add("SessionPlanCohort", row.cohortId);
  }
  for (const row of evidence.publication.cohorts) {
    add("SessionPlanCohort", row.id);
    add("SessionPlan", row.planId);
  }
  for (const row of evidence.publication.continuationMembers) {
    add("SessionPlan", row.planId);
    add("Pairing", row.pairingId);
    add("Tutee", row.tuteeId);
    add("Tutee", row.sourceTuteeId);
    add("StudentSurvey", row.sourceSurveyId);
    add("StudentContinuationAssignment", row.assignmentId);
  }
  for (const row of evidence.publication.executions) {
    add("SessionParticipantExecution", row.participantId);
    add("SessionPlanParticipant", row.participantId);
    add("Tutee", row.tuteeId);
    for (const surveyId of row.sourceSurveyIds) add("StudentSurvey", surveyId);
  }
  for (const row of evidence.publication.planExecutions) {
    add("SessionPlanExecution", row.planId);
    add("SessionPlan", row.planId);
    add("Tutor", row.tutorId);
    for (const assignment of row.assignments) {
      add("Pairing", assignment.sourcePairingId);
      add("Pairing", assignment.targetPairingId);
    }
  }
  for (const row of evidence.publication.requests) {
    add("SessionPlanningRequest", row.id);
    add("SessionPlan", row.planId);
    add("SessionPlanningOffer", row.currentOfferId);
  }
  for (const row of evidence.publication.responses) {
    add("SessionPlanningResponse", row.id);
    add("SessionPlanningOffer", row.offerId);
    // Original response authorship remains distinct from current execution.
    add("User", row.actorUserId);
  }
  for (const row of evidence.publication.responseExecutions) {
    add("SessionResponseExecution", row.responseId);
    add("SessionPlanningResponse", row.responseId);
    add("User", row.userId);
    if (row.profileKind === "TUTOR") add("Tutor", row.profileId);
    if (row.profileKind === "TUTEE") add("Tutee", row.profileId);
  }
  const scope = [...new Map(entries.map((entry) => [`${entry.entity}:${entry.recordId}`, entry])).values()]
    .sort((a, b) => `${a.entity}:${a.recordId}`.localeCompare(`${b.entity}:${b.recordId}`));
  // Each evidence collection is bounded independently; the protocol also limits
  // their combined tracked roots. Automatic capture records unsupported format
  // metadata rather than weakening the ordinary withdrawal on oversized history.
  if (scope.length > 1000)
    throw new UnsupportedCheckpointSnapshot("Quarter withdrawal checkpoint scope exceeds the supported limit.");
  return scope;
}

export const studentQuarterWithdrawalCheckpointAdapter: CheckpointAdapter = {
  id: "STUDENT_QUARTER_WITHDRAWAL",
  version: 1,
  sourceEntity: "StudentRequestReview",
  directRoles: ["ADMIN", "HEAD"],
  async lock(tx, reviewId, raw) {
    if (raw !== undefined) {
      // Both apply channels lock before inspection. Terminal evidence must reach
      // the permanent blocker without re-entering pending-only domain admission.
      snapshotSchema.parse(raw);
      return;
    }
    // The ordinary writer prelocks and reuses this complete authoritative scope.
    // Explicit prospective capture acquires the same locks before recovery fences.
    await lockQuarterWithdrawalScope(tx, { reviewId });
  },
  async capture(tx, reviewId) {
    const evidence = await readQuarterWithdrawalEvidence(tx, { reviewId });
    if (evidence.review.id !== reviewId || evidence.review.kind !== "STUDENT_ABORT" || evidence.review.state !== "PENDING")
      throw new UnsupportedCheckpointSnapshot("Quarter withdrawal capture requires its pending withdrawal review.");
    const snapshot = snapshotSchema.parse({ version: 1, reviewId, evidence });
    return { snapshot: recoveryJson(snapshot), scope: trackedScope(evidence) };
  },
  async inspect(tx, reviewId, raw) {
    const saved = snapshotSchema.parse(raw);
    const current = await readQuarterWithdrawalEvidence(tx, { reviewId });
    const blockers = [quarterWithdrawalRecoveryBlocker];
    if (saved.reviewId !== reviewId || saved.evidence.review.id !== reviewId ||
      saved.evidence.review.kind !== "STUDENT_ABORT" || current.review.kind !== "STUDENT_ABORT" ||
      saved.evidence.review.surveyId !== current.review.surveyId ||
      saved.evidence.review.legacyTuteeId !== current.review.legacyTuteeId ||
      saved.evidence.term?.id !== current.term?.id)
      blockers.push("Quarter withdrawal evidence does not match the originating review.");
    return {
      current: recoveryJson(current),
      blockers,
      warnings: [],
      effects: [],
      preserved: [
        "Keep all withdrawn requests closed, released execution assignments and the quarter withdrawal block.",
        "Original requests, approved decision, exact ownership, published session history and delivery evidence.",
      ],
      // Omit compensatedEventIds: normal delivery evidence and its fingerprint
      // remain visible even though this domain boundary forbids compensation.
    };
  },
  async apply() {
    // Defense in depth for direct adapter callers. The protocol rejects the
    // permanent blocker before attempting any delivery cancellation or receipt.
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: quarterWithdrawalRecoveryBlocker });
  },
};
