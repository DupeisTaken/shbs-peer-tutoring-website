import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { nextPeriod } from "~/lib/period";
import { lockAccountProfile } from "~/server/account-profile";
import { requireAcademicConfirmation } from "~/server/academics";
import { requirePolicy } from "~/server/policy-acceptance";
import { FEATURE_KEYS, getFeatures } from "~/server/program/features";
import { updateContinuationOpening } from "~/server/program/continuation-opening";
import { lockCatalogue } from "~/server/qualifications";
import { lockStudentRequestReview } from "~/server/request-invalidity";
import { lockPlannedRoomSchedule } from "~/server/room-bookings";
import {
  changeSchoolDeparture,
  requireSchoolParticipation,
} from "~/server/school-departure";
import {
  currentStudentSignupPayload,
  studentSignupLocalAnswers,
} from "~/server/student-signup-answers";
import { studentSignupAnswersInput } from "~/server/student-signup-editor";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { recoveryHash, recoveryJson } from "../capture";
import type {
  CheckpointAdapter,
  CheckpointJournalChange,
  CheckpointScopeEntity,
} from "../checkpoint-contract";
import { createRecoveryWorkflowDraft } from "../workflow-draft";
import {
  assertRecoveryAssignmentEligibility,
  inspectRecoveryAssignmentEligibility,
  inspectRecoveryParticipantEligibility,
  recoveryAssignmentSnapshot,
} from "./assignment-eligibility";
import {
  fieldsOnly,
  participantIdentity,
  preservedCheckpointChange,
} from "./shared";

const member = z.object({
  id: z.string(),
  status: z.string(),
  bindingHash: z.string(),
});
const term = z.object({
  id: z.string(),
  signupOpensAt: z.string().nullable(),
  tutorSignupOpensAt: z.string().nullable(),
});
const savedSchema = z.object({
  version: z.literal(1),
  sourceId: z.string(),
  source: term,
  destination: z.object({
    schoolYear: z.string(),
    quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
  }),
  destinationBefore: term.nullable(),
  tutors: z.array(member).max(1000),
  tutees: z.array(member).max(1000),
  departures: z
    .array(
      z.object({
        userId: z.string(),
        reason: z.string().nullable(),
        revision: z.number(),
      }),
    )
    .max(1000),
  features: z.array(
    z.object({ key: z.enum(FEATURE_KEYS), enabled: z.boolean() }),
  ),
  scheduleId: z.string().nullable(),
  memberships: z
    .array(
      z.object({
        pairingId: z.string(),
        tuteeId: z.string(),
        scheduleHash: z.string(),
        enrollmentHash: z.string(),
      }),
    )
    .max(400),
  surveys: z
    .array(
      z.object({
        id: z.string(),
        tuteeId: z.string().nullable(),
        state: z.string(),
        answers: z.json(),
      }),
    )
    .max(400),
});
async function sourceState(tx: TransactionDb, sourceId: string) {
  const source = await tx.term.findUniqueOrThrow({ where: { id: sourceId } });
  const features = await getFeatures(tx);
  const destination = nextPeriod(source, !features.QUARTER_SYSTEM);
  const destinationBefore = await tx.term.findUnique({
    where: { schoolYear_quarter: destination },
  });
  const tutors = await tx.tutor.findMany({
    where: { status: { in: ["ACTIVE", "PENDING"] } },
    select: { id: true, status: true },
    orderBy: { id: "asc" },
    take: 1001,
  });
  const links = await tx.pairingTutee.findMany({
    where: { pairing: { termId: source.id } },
    orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }],
    take: 401,
  });
  const tutees = await tx.tutee.findMany({
    where: {
      OR: [
        { status: { in: ["ACTIVE", "PENDING"] } },
        { id: { in: links.map((link) => link.tuteeId) } },
      ],
    },
    select: { id: true, status: true },
    orderBy: { id: "asc" },
    take: 1001,
  });
  const owners = await tx.user.findMany({
    where: {
      OR: [
        { tutorId: { in: tutors.map((row) => row.id) } },
        { studentId: { in: tutees.map((row) => row.id) } },
      ],
    },
    select: { email: true },
  });
  const surveys = await tx.studentSurvey.findMany({
    where: {
      OR: [
        { tuteeId: { in: tutees.map((row) => row.id) } },
        { email: { in: owners.map((owner) => owner.email) } },
      ],
      state: "OPEN",
    },
    orderBy: { id: "asc" },
    take: 401,
  });
  return {
    source,
    features,
    destination,
    destinationBefore,
    tutors,
    tutees,
    links,
    surveys,
  };
}
const termFields = [
  "active",
  "signupOpensAt",
  "tutorSignupOpensAt",
  "signupOpeningStateSince",
  "signupFirstOpenedAt",
  "continuationSourceTermId",
  "continuationQuarterTransition",
  "nextRecruitmentRevision",
];
function forwardChange(
  change: CheckpointJournalChange,
  saved: z.infer<typeof savedSchema>,
  destinationId: string | undefined,
) {
  const key =
    change.recordKey &&
    typeof change.recordKey === "object" &&
    !Array.isArray(change.recordKey)
      ? change.recordKey
      : {};
  const capturedTutor = saved.tutors.some((row) => row.id === key.id);
  const capturedTutee = saved.tutees.some((row) => row.id === key.id);
  if (
    change.entity === "User" &&
    !saved.departures.some((row) => row.userId === key.id)
  )
    return false;
  if (
    (change.entity === "Tutor" && !capturedTutor) ||
    (change.entity === "Tutee" && !capturedTutee)
  )
    return false;
  if (
    change.entity === "SchoolDeparture" ||
    change.entity === "SchoolDepartureEvent"
  ) {
    if (!saved.departures.some((row) => row.userId === key.userId))
      return false;
  }
  if (
    change.entity === "Term" &&
    (typeof key.id !== "string" ||
      ![saved.sourceId, destinationId].includes(key.id))
  )
    return false;
  if (
    change.entity === "ProgramFeature" &&
    !saved.features.some((row) => row.key === key.key)
  )
    return false;
  if (change.entity === "Person") return false;
  if (preservedCheckpointChange(change)) return true;
  if (change.entity === "Term" && change.operation === "INSERT")
    return key.id === destinationId;
  if (fieldsOnly(change, "Term", termFields)) return true;
  if (
    fieldsOnly(change, "ProgramFeature", [
      "enabled",
      "pendingEnabled",
      "revision",
      "updatedAt",
    ])
  )
    return true;
  if (
    fieldsOnly(change, "Tutor", [
      "status",
      "updatedAt",
      "preferredAssignedBlocks",
      "workloadPreferenceVersion",
    ])
  )
    return true;
  if (fieldsOnly(change, "Tutee", ["status", "updatedAt"])) return true;
  if (change.entity === "PairingTutee" && change.operation === "DELETE")
    return saved.memberships.some(
      (row) => row.pairingId === key.pairingId && row.tuteeId === key.tuteeId,
    );
  if (
    fieldsOnly(change, "SchoolDeparture", [
      "reason",
      "revision",
      "confirmedAt",
      "confirmedById",
      "source",
      "effectiveAt",
      "tutorDerived",
      "observerRevoked",
    ])
  )
    return true;
  if (change.entity === "SchoolDeparture" && change.operation === "INSERT")
    return true;
  if (fieldsOnly(change, "StudentSurvey", ["state", "resolvedAt"]))
    return saved.surveys.some((row) => row.id === key.id);
  if (
    fieldsOnly(change, "ScheduledProgramRefresh", [
      "state",
      "completedAt",
      "blockedReason",
      "version",
      "updatedAt",
    ])
  )
    return key.id === saved.scheduleId;
  if (
    fieldsOnly(change, "TutorStatusRequest", [
      "state",
      "resolvedAt",
      "resolvedById",
      "resolvedByName",
    ])
  )
    return saved.tutors.some((row) => row.id === key.tutorId);
  if (
    fieldsOnly(change, "StudentRequestReview", [
      "state",
      "resolvedAt",
      "resolvedByUserId",
    ])
  )
    return (
      saved.surveys.some((row) => row.id === key.surveyId) ||
      saved.tutees.some((row) => row.id === key.legacyTuteeId)
    );
  return false;
}
function laterPreserved(
  change: CheckpointJournalChange,
  saved: z.infer<typeof savedSchema>,
  destinationId: string | undefined,
) {
  const key =
    change.recordKey &&
    typeof change.recordKey === "object" &&
    !Array.isArray(change.recordKey)
      ? change.recordKey
      : {};
  if (
    change.entity === "User" &&
    !saved.departures.some((row) => row.userId === key.id)
  )
    return false;
  if (
    change.entity === "Tutor" &&
    !saved.tutors.some((row) => row.id === key.id)
  )
    return false;
  if (
    change.entity === "Tutee" &&
    !saved.tutees.some((row) => row.id === key.id)
  )
    return false;
  if (
    change.entity === "Term" &&
    (typeof key.id !== "string" ||
      ![saved.sourceId, destinationId].includes(key.id))
  )
    return false;
  if (
    change.entity === "ProgramFeature" &&
    !saved.features.some((row) => row.key === key.key)
  )
    return false;
  if (
    change.entity === "SchoolDeparture" &&
    !saved.departures.some((row) => row.userId === key.userId)
  )
    return false;
  if (change.entity === "Person") return false;
  return (
    preservedCheckpointChange(change) ||
    fieldsOnly(change, "Term", ["signupFirstOpenedAt"]) ||
    fieldsOnly(change, "ProgramFeature", [
      "pendingEnabled",
      "revision",
      "updatedAt",
      "updatedByName",
    ]) ||
    fieldsOnly(change, "SchoolDeparture", [
      "observerRevoked",
      "revision",
      "confirmedAt",
      "confirmedById",
      "source",
    ])
  );
}
export const programRefreshCheckpointAdapter: CheckpointAdapter = {
  id: "PROGRAM_REFRESH",
  version: 1,
  sourceEntity: "Term",
  directRoles: ["HEAD"],
  async lock(tx, sourceId, raw) {
    await lockCatalogue(tx);
    await lockPlannedRoomSchedule(tx);
    await lockEntity(tx, "session-planning");
    const current = await sourceState(tx, sourceId);
    const saved = raw ? savedSchema.parse(raw) : null;
    const ownerIds = new Set<string>();
    const tutors = [
      ...new Set([
        ...current.tutors.map((row) => row.id),
        ...(saved?.tutors.map((row) => row.id) ?? []),
      ]),
    ].sort();
    const tutees = [
      ...new Set([
        ...current.tutees.map((row) => row.id),
        ...(saved?.tutees.map((row) => row.id) ?? []),
      ]),
    ].sort();
    for (const id of tutors)
      for (const ownerId of (await participantIdentity(tx, "TUTOR", id))
        .ownerIds)
        ownerIds.add(ownerId);
    for (const id of tutees)
      for (const ownerId of (await participantIdentity(tx, "TUTEE", id))
        .ownerIds)
        ownerIds.add(ownerId);
    for (const ownerId of [...ownerIds].sort())
      await lockAccountProfile(tx, ownerId);
    for (const survey of current.surveys)
      await lockStudentRequestReview(tx, survey);
    for (const id of tutors) {
      await lockEntity(tx, `membership:tutor:${id}`);
      await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id=${id} FOR UPDATE`;
    }
    for (const id of tutees) {
      const survey = await tx.studentSurvey.findUnique({
        where: { tuteeId: id },
      });
      if (survey) await lockStudentRequestReview(tx, survey);
      await lockEntity(tx, `tutee:${id}`);
      await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id=${id} FOR UPDATE`;
    }
    await tx.$queryRaw`SELECT id FROM "Term" WHERE id=${sourceId} OR active=true ORDER BY id FOR UPDATE`;
  },
  async capture(tx, sourceId) {
    const current = await sourceState(tx, sourceId);
    const scope: CheckpointScopeEntity[] = [];
    const tutors: z.infer<typeof member>[] = [],
      tutees: z.infer<typeof member>[] = [];
    const departures: z.infer<typeof savedSchema>["departures"] = [],
      memberships: z.infer<typeof savedSchema>["memberships"] = [];
    const ownerIds = new Set<string>();
    for (const [kind, rows, target] of [
      ["TUTOR", current.tutors, tutors],
      ["TUTEE", current.tutees, tutees],
    ] as const) {
      for (const row of rows) {
        const identity = await participantIdentity(tx, kind, row.id);
        target.push({ ...row, bindingHash: recoveryHash(identity.binding) });
        scope.push({
          entity: kind === "TUTOR" ? "Tutor" : "Tutee",
          recordId: row.id,
        });
        if (identity.binding.source.personId)
          scope.push({
            entity: "Person",
            recordId: identity.binding.source.personId,
          });
        for (const ownerId of identity.ownerIds) ownerIds.add(ownerId);
      }
    }
    for (const userId of [...ownerIds].sort()) {
      const departure = await tx.schoolDeparture.findUnique({
        where: { userId },
      });
      departures.push({
        userId,
        reason: departure?.reason ?? null,
        revision: departure?.revision ?? 0,
      });
      scope.push({ entity: "User", recordId: userId });
    }
    for (const link of current.links) {
      const captured = await recoveryAssignmentSnapshot(
        tx,
        link.pairingId,
        link.tuteeId,
      );
      memberships.push({
        ...link,
        scheduleHash: captured.scheduleHash,
        enrollmentHash: captured.enrollmentHash,
      });
      scope.push({ entity: "Pairing", recordId: link.pairingId });
    }
    for (const feature of FEATURE_KEYS)
      scope.push({ entity: "ProgramFeature", recordId: feature });
    if (current.destinationBefore)
      scope.push({ entity: "Term", recordId: current.destinationBefore.id });
    const schedule = await tx.scheduledProgramRefresh.findUnique({
      where: { sourceTermId: sourceId },
      select: { id: true },
    });
    if (schedule)
      scope.push({ entity: "ScheduledProgramRefresh", recordId: schedule.id });
    for (const survey of current.surveys)
      scope.push({ entity: "StudentSurvey", recordId: survey.id });
    const saved = savedSchema.parse(
      recoveryJson({
        version: 1,
        sourceId,
        source: current.source,
        destination: current.destination,
        destinationBefore: current.destinationBefore,
        tutors,
        tutees,
        departures,
        memberships,
        scheduleId: schedule?.id ?? null,
        features: FEATURE_KEYS.map((key) => ({
          key,
          enabled: current.features[key],
        })),
        surveys: current.surveys.map((survey) => ({
          id: survey.id,
          tuteeId: survey.tuteeId,
          state: survey.state,
          answers: studentSignupLocalAnswers(
            currentStudentSignupPayload(survey),
          ),
        })),
      }),
    );
    return { snapshot: recoveryJson(saved), scope };
  },
  async inspect(tx, sourceId, raw, context) {
    const saved = savedSchema.parse(raw);
    const blockers: string[] = [];
    if (saved.sourceId !== sourceId)
      blockers.push("Refresh checkpoint source does not match.");
    const active = await tx.term.findMany({
      where: { active: true },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    const source = await tx.term.findUniqueOrThrow({ where: { id: sourceId } });
    const destination = await tx.term.findUnique({
      where: { schoolYear_quarter: saved.destination },
    });
    if (
      active.length !== 1 ||
      ![source.id, destination?.id].includes(active[0]?.id)
    )
      blockers.push(
        "Another period activation requires a separate reviewed recovery.",
      );
    const native = await tx.recoveryCheckpoint.findMany({
      where: {
        adapter: "PROGRAM_REFRESH",
        sourceId,
        captureTransactionId: {
          in: context.events.map((event) => event.transactionId),
        },
      },
      select: { captureTransactionId: true },
    });
    const nativeTransactions = new Set(
      native.map((row) => row.captureTransactionId),
    );
    const originalEvents = new Set(
      context.events
        .filter((event) => nativeTransactions.has(event.transactionId))
        .map((event) => event.id),
    );
    for (const change of context.changes)
      if (
        !(originalEvents.has(change.eventId)
          ? forwardChange(change, saved, destination?.id)
          : laterPreserved(change, saved, destination?.id))
      )
        blockers.push(`Unsupported refresh descendant: ${change.entity}.`);
    const currentMembers = [],
      departures = [],
      assignmentEvidence = [],
      drafts = [];
    for (const [kind, rows] of [
      ["TUTOR", saved.tutors],
      ["TUTEE", saved.tutees],
    ] as const)
      for (const row of rows) {
        const identity = await participantIdentity(tx, kind, row.id);
        if (recoveryHash(identity.binding) !== row.bindingHash)
          blockers.push(
            "Refresh participant grouping or exact ownership changed.",
          );
        const record =
          kind === "TUTOR"
            ? await tx.tutor.findUniqueOrThrow({
                where: { id: row.id },
                select: { id: true, status: true, updatedAt: true },
              })
            : await tx.tutee.findUniqueOrThrow({
                where: { id: row.id },
                select: { id: true, status: true, updatedAt: true },
              });
        currentMembers.push({ kind, record, identity });
      }
    const newTutors = await tx.tutor.findMany({
      where: {
        status: { in: ["ACTIVE", "PENDING"] },
        id: { notIn: saved.tutors.map((row) => row.id) },
      },
      select: { id: true },
      take: 1,
    });
    const newTutees = await tx.tutee.findMany({
      where: {
        status: { in: ["ACTIVE", "PENDING"] },
        id: { notIn: saved.tutees.map((row) => row.id) },
      },
      select: { id: true },
      take: 1,
    });
    if (newTutors.length || newTutees.length)
      blockers.push(
        "New independent participation prevents reversing this period activation.",
      );
    const reversedDepartureUserIds = [];
    for (const before of saved.departures) {
      const current = await tx.schoolDeparture.findUnique({
        where: { userId: before.userId },
      });
      departures.push(current);
      if (
        current?.reason &&
        current.reason !== before.reason &&
        (before.reason || current.reason !== "GRADUATED")
      )
        blockers.push(
          "Independent departure facts cannot be replaced by refresh recovery.",
        );
      if (!before.reason && current?.reason === "GRADUATED")
        reversedDepartureUserIds.push(before.userId);
    }
    for (const survey of saved.surveys) {
      const current = await tx.studentSurvey.findUniqueOrThrow({
        where: { id: survey.id },
        select: {
          id: true,
          state: true,
          tuteeId: true,
          confirmedAt: true,
          verificationDueAt: true,
        },
      });
      if (
        survey.state === "OPEN" &&
        (current.state !== "OPEN" ||
          (!current.confirmedAt &&
            current.verificationDueAt &&
            current.verificationDueAt <= new Date()))
      ) {
        const identity = survey.tuteeId
          ? await participantIdentity(tx, "TUTEE", survey.tuteeId)
          : null;
        if (
          identity?.ownerIds.length !== 1 ||
          !studentSignupAnswersInput.safeParse(survey.answers).success
        )
          blockers.push(
            "A closed refresh-derived request lacks exact owner/draft evidence.",
          );
        drafts.push(current);
      }
    }
    const draftTutees = new Set(
      drafts.flatMap((row) => (row.tuteeId ? [row.tuteeId] : [])),
    );
    const accessEvidence = [];
    for (const [kind, rows] of [
      ["TUTOR", saved.tutors],
      ["TUTEE", saved.tutees],
    ] as const)
      for (const row of rows) {
        if (
          !["ACTIVE", "PENDING"].includes(row.status) ||
          (kind === "TUTEE" && draftTutees.has(row.id))
        )
          continue;
        const unchanged = currentMembers.some(
          (current) =>
            current.kind === kind &&
            current.record.id === row.id &&
            current.record.status === row.status,
        );
        if (unchanged) continue;
        const access = await inspectRecoveryParticipantEligibility(tx, {
          kind,
          sourceId: row.id,
          restoredSchoolYear: source.schoolYear,
          reversedDepartureUserIds,
        });
        blockers.push(...access.blockers);
        accessEvidence.push(access.evidence);
      }
    for (const link of saved.memberships) {
      if (draftTutees.has(link.tuteeId)) continue;
      // Source-period and refresh-derived departure checks become valid only
      // after the reviewed period/departure compensation. Hash current evidence
      // now; the same full ordinary eligibility guard runs before any reattach.
      const tutorId = (
        await tx.pairing.findUniqueOrThrow({
          where: { id: link.pairingId },
          select: { tutorId: true },
        })
      ).tutorId;
      const inspected = await inspectRecoveryAssignmentEligibility(tx, {
        pairingId: link.pairingId,
        tuteeId: link.tuteeId,
        expectedScheduleHash: link.scheduleHash,
        expectedEnrollmentHash: link.enrollmentHash,
        restoredTutorStatus: saved.tutors.find((row) => row.id === tutorId)
          ?.status,
        restoredTuteeStatus: saved.tutees.find((row) => row.id === link.tuteeId)
          ?.status,
        restoredPeriod: { termId: sourceId, schoolYear: source.schoolYear },
        reversedDepartureUserIds,
      });
      blockers.push(...inspected.blockers);
      assignmentEvidence.push(inspected.evidence);
    }
    const features = await tx.programFeature.findMany({
      orderBy: { key: "asc" },
    });
    return {
      current: recoveryJson({
        active,
        source,
        destination,
        currentMembers,
        departures,
        assignmentEvidence,
        accessEvidence,
        features,
        drafts,
      }),
      blockers,
      warnings: drafts.length
        ? [
            "Closed graduation-derived requests remain closed; their owners must submit fresh reviewed drafts.",
          ]
        : [],
      effects: [
        "Restore the captured source period and attributable lifecycle effects, preserving actual opening and completed schedule history.",
        "Retain current security settings; restore eligible captured memberships with current consent and qualification checks.",
        ...(drafts.length
          ? [
              `Create ${drafts.length} owner-review draft(s); restoration awaits their ordinary fresh submissions.`,
            ]
          : []),
      ],
      preserved: [
        "Current credentials, security features, restrictions, consent and immutable decisions.",
        "Completed refresh schedules, actual signup-opening evidence, new staged settings and all original history.",
      ],
      compensatedEventIds: [...originalEvents].filter((eventId) =>
        context.changes.some(
          (change) =>
            change.eventId === eventId && !preservedCheckpointChange(change),
        ),
      ),
    };
  },
  async apply(tx, sourceId, raw, actor, reason, context) {
    const saved = savedSchema.parse(raw);
    const destination = await tx.term.findUnique({
      where: { schoolYear_quarter: saved.destination },
    });
    if (destination && destination.id !== sourceId) {
      await updateContinuationOpening(tx, destination.id, {
        active: false,
        ...(saved.destinationBefore
          ? {
              signupOpensAt: saved.destinationBefore.signupOpensAt
                ? new Date(saved.destinationBefore.signupOpensAt)
                : null,
              tutorSignupOpensAt: saved.destinationBefore.tutorSignupOpensAt
                ? new Date(saved.destinationBefore.tutorSignupOpensAt)
                : null,
            }
          : {}),
      });
      await tx.term.update({
        where: { id: destination.id },
        data: { nextRecruitmentRevision: { increment: 1 } },
      });
    }
    await updateContinuationOpening(tx, sourceId, { active: true });
    await tx.term.update({
      where: { id: sourceId },
      data: { nextRecruitmentRevision: { increment: 1 } },
    });
    for (const feature of saved.features)
      if (feature.key !== "EMAIL_2FA") {
        const current = await tx.programFeature.findUnique({
          where: { key: feature.key },
        });
        if (current && current.enabled !== feature.enabled)
          await tx.programFeature.update({
            where: { key: feature.key },
            data: { enabled: feature.enabled, revision: { increment: 1 } },
          });
      }
    for (const before of saved.departures) {
      const current = await tx.schoolDeparture.findUnique({
        where: { userId: before.userId },
      });
      if (!before.reason && current?.reason === "GRADUATED")
        await changeSchoolDeparture(
          tx,
          {
            userId: before.userId,
            action: "RETURN",
            expectedRevision: current.revision,
            explanation: reason,
          },
          actor.id,
          "PROGRAM_REFRESH_RECOVERY",
        );
    }
    const drafts = [],
      draftTutees = new Set<string>();
    for (const survey of saved.surveys) {
      const current = await tx.studentSurvey.findUniqueOrThrow({
        where: { id: survey.id },
        select: { state: true, confirmedAt: true, verificationDueAt: true },
      });
      if (
        survey.state === "OPEN" &&
        (current.state !== "OPEN" ||
          (!current.confirmedAt &&
            current.verificationDueAt &&
            current.verificationDueAt <= new Date())) &&
        survey.tuteeId
      ) {
        drafts.push(
          await createRecoveryWorkflowDraft(tx, {
            actionId: context.actionId,
            sourceSurveyId: survey.id,
            sourceTuteeId: survey.tuteeId,
            answers: survey.answers,
          }),
        );
        draftTutees.add(survey.tuteeId);
      }
    }
    for (const row of saved.tutors) {
      const current = await tx.tutor.findUniqueOrThrow({
        where: { id: row.id },
        select: { status: true },
      });
      if (current.status === row.status) continue;
      if (row.status === "ACTIVE") {
        const identity = await participantIdentity(tx, "TUTOR", row.id);
        for (const owner of identity.owners) {
          if (
            owner.suspendedAt ||
            owner.mergedIntoId ||
            owner.recoveryVoidedAt ||
            owner.tutorAccessRevoked
          )
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Current restrictions prevent restoring tutoring participation.",
            });
          await requireSchoolParticipation(tx, owner.id);
          await requireAcademicConfirmation(tx, owner.id);
          await requirePolicy(tx, owner.id, "tutor-policy");
        }
      }
      await tx.tutor.update({
        where: { id: row.id },
        data: {
          status: z
            .enum([
              "ACTIVE",
              "PENDING",
              "ARCHIVED",
              "OPTED_OUT",
              "GRADUATED",
              "TRANSFERRED",
            ])
            .parse(row.status),
        },
      });
    }
    for (const row of saved.tutees)
      if (!draftTutees.has(row.id)) {
        const current = await tx.tutee.findUniqueOrThrow({
          where: { id: row.id },
          select: { status: true },
        });
        if (current.status === row.status) continue;
        if (["ACTIVE", "PENDING"].includes(row.status)) {
          const access = await inspectRecoveryParticipantEligibility(tx, {
            kind: "TUTEE",
            sourceId: row.id,
          });
          if (access.blockers.length)
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: access.blockers.join(" "),
            });
        }
        await tx.tutee.update({
          where: { id: row.id },
          data: {
            status: z.enum(["ACTIVE", "PENDING", "INACTIVE"]).parse(row.status),
          },
        });
      }
    for (const link of saved.memberships)
      if (!draftTutees.has(link.tuteeId)) {
        await assertRecoveryAssignmentEligibility(tx, {
          ...link,
          expectedScheduleHash: link.scheduleHash,
          expectedEnrollmentHash: link.enrollmentHash,
        });
        await tx.pairingTutee.createMany({
          data: { pairingId: link.pairingId, tuteeId: link.tuteeId },
          skipDuplicates: true,
        });
      }
    return recoveryJson({
      outcome: drafts.length ? "AWAITING_OWNER_ACTION" : "APPLIED",
      sourceTermId: sourceId,
      destinationTermId: destination?.id ?? null,
      drafts,
    });
  },
};
