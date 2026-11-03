import { TRPCError } from "@trpc/server";
import {
  academicSummary,
  needsAcademicConfirmationForParticipation,
} from "~/lib/academics";
import { standingFromCounts } from "~/lib/discipline";
import type { TransactionDb } from "~/server/transactions";
import { requireAcademicConfirmation } from "~/server/academics";
import {
  findAccountPolicy,
  publishedPolicy,
  requirePolicy,
} from "~/server/policy-acceptance";
import { assertPlannedRoomAvailable } from "~/server/room-bookings";
import { requireSchoolParticipation } from "~/server/school-departure";
import { assertTutorScheduleAvailable } from "~/server/tutor-scheduling";
import { recoveryHash, recoveryJson } from "../capture";
import { participantIdentity } from "./shared";

export type RecoveryAssignmentIntent = {
  pairingId: string;
  tuteeId: string;
  expectedScheduleHash?: string;
  expectedEnrollmentHash?: string;
  /** Only an explicit reviewed lifecycle compensation supplies these overrides.
   * No account restriction, departure, policy or proof may be overridden. */
  restoredTutorStatus?: string;
  restoredTuteeStatus?: string;
  restoredPeriod?: { termId: string; schoolYear: string };
  reversedDepartureUserIds?: string[];
  disciplineAfterCorrection?: { validYellow: number; validRed: number };
};

export async function inspectRecoveryParticipantEligibility(
  tx: TransactionDb,
  input: {
    kind: "TUTOR" | "TUTEE";
    sourceId: string;
    restoredSchoolYear?: string;
    reversedDepartureUserIds?: string[];
    disciplineAfterCorrection?: { validYellow: number; validRed: number };
  },
) {
  const identity = await participantIdentity(tx, input.kind, input.sourceId);
  const blockers: string[] = [],
    policyEvidence = [];
  for (const owner of identity.owners) {
    if (
      owner.suspendedAt ||
      owner.mergedIntoId ||
      owner.recoveryVoidedAt ||
      (input.kind === "TUTOR" && owner.tutorAccessRevoked)
    )
      blockers.push(
        "A current participant account restriction prevents restoration.",
      );
    if (
      input.kind === "TUTOR" &&
      (owner.role === "VIEWER" || owner.tutorId !== input.sourceId)
    )
      blockers.push(
        "Historical ownership does not authorize current tutoring participation.",
      );
    if (
      input.kind === "TUTEE" &&
      (!owner.tuteeMember || owner.studentId !== input.sourceId)
    )
      blockers.push(
        "Historical ownership does not authorize current learner participation.",
      );
    try {
      if (!(
        input.reversedDepartureUserIds?.includes(owner.id) &&
        owner.schoolDeparture?.reason === "GRADUATED"
      ))
        await requireSchoolParticipation(tx, owner.id);
      if (input.restoredSchoolYear) {
        const academic = academicSummary(
          owner.academicProfile
            ? { ...owner.academicProfile, rawGrade: null }
            : null,
          input.restoredSchoolYear,
        );
        if (needsAcademicConfirmationForParticipation(academic))
          blockers.push(
            "Current academic confirmation is required for the restored period.",
          );
      } else await requireAcademicConfirmation(tx, owner.id);
      await requirePolicy(
        tx,
        owner.id,
        input.kind === "TUTOR" ? "tutor-policy" : "tutee-policy",
      );
    } catch (error) {
      if (
        !(error instanceof TRPCError) ||
        !["FORBIDDEN", "PRECONDITION_FAILED", "BAD_REQUEST"].includes(
          error.code,
        )
      )
        throw error;
      blockers.push(error.message);
    }
    const slug = input.kind === "TUTOR" ? "tutor-policy" : "tutee-policy";
    const published = await publishedPolicy(tx, slug);
    const accepted = published
      ? await findAccountPolicy(tx, owner.id, slug, published.revision)
      : null;
    policyEvidence.push({
      userId: owner.id,
      slug,
      revision: published?.revision ?? null,
      acceptanceId: accepted?.id ?? null,
    });
  }
  const cards =
    input.kind === "TUTEE"
      ? await tx.disciplinaryCard.groupBy({
          by: ["color"],
          where: { tuteeId: input.sourceId, reviewStatus: "VALID" },
          _count: { _all: true },
        })
      : [];
  if (
    input.disciplineAfterCorrection &&
    !Object.values(input.disciplineAfterCorrection).every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  )
    throw new Error("Invalid projected disciplinary standing");
  if (
    input.kind === "TUTEE" &&
    standingFromCounts({
      validYellow:
        input.disciplineAfterCorrection?.validYellow ??
        cards.find((row) => row.color === "YELLOW")?._count._all ??
        0,
      validRed:
        input.disciplineAfterCorrection?.validRed ??
        cards.find((row) => row.color === "RED")?._count._all ??
        0,
      pendingYellow: 0,
      pendingRed: 0,
    }).removalPending
  )
    blockers.push(
      "Current disciplinary standing prevents restoring participation.",
    );
  return {
    blockers: [...new Set(blockers)],
    evidence: recoveryJson({
      identity,
      policyEvidence,
      cards,
      disciplineAfterCorrection: input.disciplineAfterCorrection,
    }),
  };
}

export async function recoveryAssignmentSnapshot(
  tx: TransactionDb,
  pairingId: string,
  tuteeId: string,
) {
  const pairing = await tx.pairing.findUniqueOrThrow({
    where: { id: pairingId },
    include: { term: true, tutor: true },
  });
  const tutee = await tx.tutee.findUniqueOrThrow({
    where: { id: tuteeId },
    select: {
      id: true,
      status: true,
      signedRulebook: true,
      signedAt: true,
      signatureName: true,
    },
  });
  const survey = await tx.studentSurvey.findUnique({ where: { tuteeId } });
  const tutorIdentity = await participantIdentity(tx, "TUTOR", pairing.tutorId);
  const tuteeIdentity = await participantIdentity(tx, "TUTEE", tuteeId);
  const scheduleHash = recoveryHash({
    pairingId,
    tutorId: pairing.tutorId,
    termId: pairing.termId,
    subject: pairing.subject,
    dayOfWeek: pairing.dayOfWeek,
    startMin: pairing.startMin,
    endMin: pairing.endMin,
    groupId: pairing.groupId,
    timeSlotId: pairing.timeSlotId,
    roomId: pairing.roomId,
    roomMode: pairing.roomMode,
    scheduleConfirmed: pairing.scheduleConfirmed,
  });
  const enrollmentHash = recoveryHash({
    tuteeId,
    termId: pairing.termId,
    surveyId: survey?.id ?? null,
    intakeTermId: survey?.intakeTermId ?? null,
    policyRevision: survey?.policyRevision ?? null,
    policySnapshot: survey?.policySnapshot ?? null,
    originalPayload: survey?.payload ?? null,
    signedRulebook: tutee.signedRulebook,
    signedAt: tutee.signedAt,
    signatureName: tutee.signatureName,
    tutorBinding: tutorIdentity.binding,
    tuteeBinding: tuteeIdentity.binding,
  });
  return {
    pairing,
    tutee,
    survey,
    tutorIdentity,
    tuteeIdentity,
    scheduleHash,
    enrollmentHash,
  };
}

/** Read-only current eligibility for an exact captured assignment. Callers take
 * catalogue → planned-room → session-planning locks before their recovery fence;
 * ordinary schedule checks only reacquire those locks and never materialize plans. */
export async function inspectRecoveryAssignmentEligibility(
  tx: TransactionDb,
  intent: RecoveryAssignmentIntent,
) {
  const current = await recoveryAssignmentSnapshot(
    tx,
    intent.pairingId,
    intent.tuteeId,
  );
  const { pairing, tutee, survey, tutorIdentity, tuteeIdentity } = current;
  const blockers: string[] = [];
  if (!pairing.term.active && intent.restoredPeriod?.termId !== pairing.termId)
    blockers.push("Captured assignment belongs to an ended period.");
  if ((intent.restoredTutorStatus ?? pairing.tutor.status) !== "ACTIVE")
    blockers.push("Assignment tutor is not currently eligible to teach.");
  if (
    !["ACTIVE", "PENDING"].includes(intent.restoredTuteeStatus ?? tutee.status)
  )
    blockers.push("Assignment learner is not currently participating.");
  if (
    intent.expectedScheduleHash &&
    intent.expectedScheduleHash !== current.scheduleHash
  )
    blockers.push("Captured assignment schedule or ownership changed.");
  if (
    intent.expectedEnrollmentHash &&
    intent.expectedEnrollmentHash !== current.enrollmentHash
  )
    blockers.push("Captured enrollment consent or exact ownership changed.");
  if (
    survey &&
    (survey.intakeTermId !== pairing.termId ||
      survey.state !== "OPEN" ||
      survey.invalidatedAt ||
      (!survey.confirmedAt &&
        survey.verificationDueAt &&
        survey.verificationDueAt <= new Date()))
  )
    blockers.push(
      "Current enrollment is closed, invalid, in another period or past its proof deadline.",
    );
  const legacyInvalidity = !survey
    ? await tx.tuteeRequestInvalidity.findUnique({
        where: { tuteeId: tutee.id },
      })
    : null;
  if (legacyInvalidity?.invalidatedAt)
    blockers.push("Current legacy signup invalidity remains in effect.");
  const withdrawal = await tx.studentRequestReview.findFirst({
    where: {
      state: "APPROVED",
      kind: "STUDENT_ABORT",
      OR: [
        ...(survey ? [{ surveyId: survey.id }] : []),
        { legacyTuteeId: tutee.id, legacyIntakeTermId: pairing.termId },
      ],
    },
    select: { id: true },
  });
  const block = await tx.studentQuarterBlock.findFirst({
    where: {
      intakeTermId: pairing.termId,
      OR: [
        { legacyTuteeId: tutee.id },
        ...(survey ? [{ surveyId: survey.id }] : []),
        { userId: { in: tuteeIdentity.ownerIds } },
      ],
    },
    select: { id: true },
  });
  if (withdrawal || block)
    blockers.push(
      "Current-quarter withdrawal restrictions require their owning restoration workflow.",
    );
  const subject = await tx.subject.findUnique({
    where: { name: pairing.subject },
    include: { level: true },
  });
  const grants = subject
    ? await tx.qualificationGrant.findMany({
        where: {
          tutorId: pairing.tutorId,
          subjectId: subject.id,
          qualification: { status: "APPROVED" },
        },
        select: { tutorId: true, sourceSubjectId: true, subjectId: true },
        orderBy: { sourceSubjectId: "asc" },
      })
    : [];
  if (!subject?.active || subject.level?.active === false || !grants.length)
    blockers.push(
      "Current approved tutor qualification is required; old override proof cannot be reused.",
    );
  const policyEvidence = [];
  for (const [kind, sourceId] of [
    ["TUTOR", pairing.tutorId],
    ["TUTEE", tutee.id],
  ] as const) {
    const access = await inspectRecoveryParticipantEligibility(tx, {
      kind,
      sourceId,
      restoredSchoolYear: intent.restoredPeriod?.schoolYear,
      reversedDepartureUserIds: intent.reversedDepartureUserIds,
      disciplineAfterCorrection: intent.disciplineAfterCorrection,
    });
    blockers.push(...access.blockers);
    policyEvidence.push(access.evidence);
  }
  const group = pairing.groupId
    ? await tx.pairing.findMany({
        where: { groupId: pairing.groupId },
        select: {
          id: true,
          tutorId: true,
          termId: true,
          dayOfWeek: true,
          startMin: true,
          endMin: true,
          roomId: true,
        },
        orderBy: { id: "asc" },
      })
    : [];
  const sameGroup = group.every(
    (row) =>
      row.tutorId === pairing.tutorId &&
      row.termId === pairing.termId &&
      row.dayOfWeek === pairing.dayOfWeek &&
      row.startMin === pairing.startMin &&
      row.endMin === pairing.endMin &&
      row.roomId === pairing.roomId,
  );
  if (!sameGroup)
    blockers.push("Captured teaching group has conflicting current schedules.");
  if (pairing.scheduleConfirmed) {
    try {
      await assertTutorScheduleAvailable(tx, {
        ...pairing,
        id: pairing.id,
        excludePairingIds: sameGroup ? group.map((row) => row.id) : [],
      });
      await assertPlannedRoomAvailable(tx, {
        ...pairing,
        excludePairingId: pairing.id,
        excludePairingIds: sameGroup ? group.map((row) => row.id) : [],
      });
    } catch (error) {
      if (
        !(error instanceof TRPCError) ||
        !["CONFLICT", "BAD_REQUEST", "PRECONDITION_FAILED"].includes(error.code)
      )
        throw error;
      blockers.push(error.message);
    }
  }
  return {
    scheduleHash: current.scheduleHash,
    enrollmentHash: current.enrollmentHash,
    blockers: [...new Set(blockers)],
    evidence: recoveryJson({
      scheduleHash: current.scheduleHash,
      enrollmentHash: current.enrollmentHash,
      tutorIdentity,
      tuteeIdentity,
      subject: subject
        ? {
            id: subject.id,
            active: subject.active,
            levelActive: subject.level?.active,
          }
        : null,
      grants,
      policyEvidence,
      withdrawal,
      block,
      legacyInvalidity,
      group,
      survey: survey
        ? {
            id: survey.id,
            state: survey.state,
            confirmedAt: survey.confirmedAt,
            verificationDueAt: survey.verificationDueAt,
            invalidityVersion: survey.invalidityVersion,
          }
        : null,
    }),
  };
}
export async function assertRecoveryAssignmentEligibility(
  tx: TransactionDb,
  intent: RecoveryAssignmentIntent,
) {
  const current = await inspectRecoveryAssignmentEligibility(tx, intent);
  if (current.blockers.length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: current.blockers.join(" "),
    });
  return current;
}
