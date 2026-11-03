import { z } from "zod";
import {
  attendanceCorrectionInput,
  correctAttendance,
} from "~/server/corrections/attendance";
import { lockAttendanceSchedule } from "~/server/attendance-schedule";
import { reconsiderSessionFlag } from "~/server/crew/flags";
import { getFeatures } from "~/server/program/features";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { recoveryHash, recoveryJson } from "../capture";
import {
  UnsupportedCheckpointSnapshot,
  type CheckpointAdapter,
  type CheckpointJournalChange,
} from "../checkpoint-contract";
import {
  fieldsOnly,
  participantIdentity,
  preservedCheckpointChange,
} from "./shared";
import {
  correctionParticipant,
  correctionParticipantState,
  inspectCorrectionRestoration,
  lockCorrectionAssignments,
} from "./correction-state";
import { independentCard, supportedCardConsequence } from "./card";

const inputSchema = z
  .object(attendanceCorrectionInput.shape)
  .omit({ id: true, expectedUpdatedAt: true, reason: true });
const snapshot = z.object({
  version: z.literal(1),
  id: z.string(),
  structureHash: z.string(),
  tutorBindingHash: z.string(),
  input: inputSchema,
  participants: z.array(correctionParticipant),
  flagIds: z.array(z.string()),
});
const sessionFields = [
  "date",
  "startMin",
  "endMin",
  "tutorStatus",
  "tutorAbsentReason",
  "comments",
  "online",
  "actualRoomId",
  "ratingPreparedness",
  "ratingParticipation",
  "ratingUnderstanding",
  "ratingBehavior",
  "ratingProgress",
  "month",
  "durationMin",
  "shFactor",
  "shCount",
  "updatedAt",
];
const object = (value: CheckpointJournalChange["recordKey"]) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
async function state(tx: TransactionDb, id: string) {
  const requested = await tx.session.findUniqueOrThrow({ where: { id } });
  const primaryId = requested.mergeGroupId ?? requested.id;
  const sessions = await tx.session.findMany({
    where: { OR: [{ id: primaryId }, { mergeGroupId: primaryId }] },
    include: {
      tutees: { orderBy: { tuteeId: "asc" } },
      cards: { orderBy: { id: "asc" } },
      flags: true,
    },
    orderBy: { id: "asc" },
  });
  const primary = sessions.find((row) => row.id === primaryId);
  if (!primary) throw new Error("Attendance primary record is missing.");
  const tutorIdentity = await participantIdentity(tx, "TUTOR", primary.tutorId);
  const tuteeIds = [
    ...new Set(
      sessions.flatMap((row) => row.tutees.map((link) => link.tuteeId)),
    ),
  ].sort();
  const participants = [];
  for (const tuteeId of tuteeIds)
    participants.push(await correctionParticipantState(tx, tuteeId));
  const deductions = await tx.serviceHourAdjustment.findMany({
    where: {
      id: {
        in: sessions.flatMap((row) =>
          row.flags.map((flag) => `flag:${flag.id}`),
        ),
      },
    },
    orderBy: { id: "asc" },
  });
  const structure = sessions.map((row) => ({
    id: row.id,
    tutorId: row.tutorId,
    pairingId: row.pairingId,
    mergeGroupId: row.mergeGroupId,
    timeSlotId: row.timeSlotId,
    planningCohortId: row.planningCohortId,
    schoolYear: row.schoolYear,
    quarter: row.quarter,
    roster: row.tutees.map((link) => link.tuteeId),
  }));
  return {
    primary,
    sessions,
    tutorIdentity,
    tuteeIds,
    participants,
    deductions,
    structure,
    features: await getFeatures(tx),
  };
}
function correctionInput(current: Awaited<ReturnType<typeof state>>) {
  const input = inputSchema.parse({
    ...current.primary,
    tutees: current.tuteeIds.map((id) => {
      const row = current.sessions
        .flatMap((session) => session.tutees)
        .find((entry) => entry.tuteeId === id)!;
      return {
        tuteeId: id,
        status: row.status,
        absenceReason: row.absenceReason,
      };
    }),
  });
  // Capture must satisfy the writer's cross-field refinements as well as shape.
  // Invalid legacy evidence is recorded as unsupported by automatic capture.
  attendanceCorrectionInput.parse({
    ...input,
    id: current.primary.id,
    expectedUpdatedAt: current.primary.updatedAt,
    reason: "Validate captured attendance",
  });
  return input;
}
export const attendanceCheckpointAdapter: CheckpointAdapter = {
  id: "ATTENDANCE",
  version: 1,
  sourceEntity: "Session",
  directRoles: ["ADMIN", "HEAD"],
  async lock(tx, id, raw) {
    await lockCorrectionAssignments(tx);
    await lockAttendanceSchedule(tx);
    const requested = await tx.session.findUniqueOrThrow({ where: { id } });
    const primaryId = requested.mergeGroupId ?? requested.id;
    await lockEntity(tx, `attendance-correction:${primaryId}`);
    const current = await state(tx, id);
    const saved = raw ? snapshot.parse(raw) : null;
    const dates = [
      ...new Set(
        [current.primary.date, ...(saved ? [saved.input.date] : [])].map(
          (date) => date.toISOString().slice(0, 10),
        ),
      ),
    ].sort();
    for (const date of dates)
      await lockEntity(tx, `attendance-day:${current.primary.tutorId}:${date}`);
    for (const tuteeId of current.tuteeIds)
      await lockEntity(tx, `tutee:${tuteeId}`);
    await lockEntity(tx, `session-flag:${primaryId}`);
  },
  async capture(tx, id) {
    const current = await state(tx, id);
    const input = correctionInput(current);
    for (const session of current.sessions) {
      const common = inputSchema.parse({ ...session, tutees: input.tutees });
      if (
        session.tutorId !== current.primary.tutorId ||
        recoveryHash(common) !== recoveryHash(input)
      )
        throw new UnsupportedCheckpointSnapshot(
          "Merged attendance has differing shared evidence; its earlier rows cannot be flattened into one correction.",
        );
    }
    // A merged block must have one coherent correction input before capture.
    for (const session of current.sessions)
      for (const row of session.tutees) {
        const chosen = input.tutees.find(
          (entry) => entry.tuteeId === row.tuteeId,
        )!;
        if (
          chosen.status !== row.status ||
          chosen.absenceReason !== row.absenceReason
        )
          throw new UnsupportedCheckpointSnapshot(
            "Merged attendance has conflicting student evidence; its earlier state cannot be safely replayed.",
          );
      }
    return {
      snapshot: recoveryJson(
        snapshot.parse({
          version: 1,
          id,
          structureHash: recoveryHash(current.structure),
          tutorBindingHash: recoveryHash(current.tutorIdentity.binding),
          input,
          participants: current.participants.map((row) => row.snapshot),
          flagIds: current.sessions.flatMap((row) =>
            row.flags.map((flag) => flag.id),
          ),
        }),
      ),
      scope: [
        { entity: "Tutor", recordId: current.primary.tutorId },
        ...current.sessions.map((row) => ({
          entity: "Session",
          recordId: row.id,
        })),
        ...current.tuteeIds.map((recordId) => ({ entity: "Tutee", recordId })),
        ...current.participants.flatMap((row) =>
          row.memberships.map((link) => ({
            entity: "Pairing",
            recordId: link.pairingId,
          })),
        ),
        ...current.participants.flatMap((row) =>
          row.groupPairings.map((pairing) => ({
            entity: "Pairing",
            recordId: pairing.id,
          })),
        ),
        ...current.sessions.flatMap((row) =>
          row.cards.map((card) => ({
            entity: "DisciplinaryCard",
            recordId: card.id,
          })),
        ),
      ],
    };
  },
  async inspect(tx, id, raw, context) {
    const saved = snapshot.parse(raw);
    const current = await state(tx, id);
    const blockers: string[] = [];
    if (
      saved.id !== id ||
      saved.structureHash !== recoveryHash(current.structure) ||
      saved.tutorBindingHash !== recoveryHash(current.tutorIdentity.binding)
    )
      blockers.push(
        "Attendance ownership, merge structure, roster, period or original scheduling association changed.",
      );
    const restorationEvidence = [];
    for (const participant of current.participants) {
      const before = saved.participants.find(
        (row) => row.id === participant.record.id,
      );
      if (!before) blockers.push("Attendance has an uncaptured participant.");
      else {
        const desired = saved.input.tutees.find(
          (row) => row.tuteeId === participant.record.id,
        )!;
        const automatic = current.sessions
          .flatMap((row) => row.cards)
          .filter(
            (card) =>
              card.tuteeId === participant.record.id && card.source === "AUTO",
          );
        const previouslyUnexcused = current.sessions.some((session) =>
          session.tutees.some(
            (row) =>
              row.tuteeId === participant.record.id &&
              row.status === "UNEXCUSED_ABSENT",
          ),
        );
        const restoration = await inspectCorrectionRestoration(
          tx,
          before,
          participant,
          {
            reviews:
              desired.status === "UNEXCUSED_ABSENT"
                ? []
                : automatic.map((card) => ({
                    id: card.id,
                    reviewStatus: "INVALID" as const,
                  })),
            addedRed:
              desired.status === "UNEXCUSED_ABSENT" &&
              current.features.DISCIPLINE &&
              !previouslyUnexcused &&
              !automatic.some((card) => card.reviewStatus === "VALID")
                ? 1
                : 0,
          },
        );
        blockers.push(...restoration.blockers);
        restorationEvidence.push(restoration.evidence);
      }
    }
    const sessionIds = new Set(current.sessions.map((row) => row.id));
    const flagIds = new Set([
      ...saved.flagIds,
      ...current.sessions.flatMap((row) => row.flags.map((flag) => flag.id)),
      ...context.changes.flatMap((change) => {
        const sessionId = object(change.after ?? change.before).sessionId;
        const flagId = object(change.recordKey).id;
        return change.entity === "SessionFlag" && typeof sessionId === "string"
          && sessionIds.has(sessionId) && typeof flagId === "string" ? [flagId] : [];
      }),
    ]);
    const tuteeIds = new Set(current.tuteeIds);
    const direct = (change: CheckpointJournalChange) =>
      typeof object(change.recordKey).id === "string" &&
      sessionIds.has(object(change.recordKey).id as string) &&
      fieldsOnly(change, "Session", sessionFields);
    const events = new Set(
      context.changes.filter(direct).map((row) => row.eventId),
    );
    const supported = (change: CheckpointJournalChange) => {
      if (preservedCheckpointChange(change) || direct(change)) return true;
      const body = object(change.after ?? change.before);
      // Other cards keep their current judgment. A later manual judgment of this
      // block's own automatic card needs its own review before overwriting it.
      if (
        !(
          body.source === "AUTO" &&
          typeof body.sessionId === "string" &&
          sessionIds.has(body.sessionId)
        ) &&
        current.tuteeIds.some((tuteeId) => independentCard(change, "", tuteeId))
      )
        return true;
      if (!events.has(change.eventId)) return false;
      const key = object(change.recordKey);
      if (
        fieldsOnly(change, "SessionTutee", ["status", "absenceReason"]) ||
        (change.entity === "SessionTutee" &&
          change.operation === "UPDATE" &&
          Array.isArray(change.changedFields) &&
          change.changedFields.length === 0)
      )
        return (
          typeof key.sessionId === "string" &&
          sessionIds.has(key.sessionId) &&
          typeof key.tuteeId === "string" &&
          tuteeIds.has(key.tuteeId)
        );
      if (
        change.entity === "DisciplinaryCard" &&
        body.source === "AUTO" &&
        typeof body.sessionId === "string" &&
        sessionIds.has(body.sessionId)
      )
        return (
          change.operation === "INSERT" ||
          fieldsOnly(change, "DisciplinaryCard", [
            "reviewStatus",
            "reviewNote",
            "updatedAt",
          ])
        );
      if (
        change.entity === "SessionFlag" &&
        typeof body.sessionId === "string" &&
        sessionIds.has(body.sessionId)
      )
        return (
          ["INSERT", "DELETE"].includes(change.operation) ||
          fieldsOnly(change, "SessionFlag", [
            "expected",
            "observed",
            "state",
            "decisionNote",
            "resolvedAt",
            "resolvedById",
            "resolvedByName",
          ])
        );
      if (
        change.entity === "ServiceHourAdjustment" &&
        change.operation === "DELETE" &&
        typeof key.id === "string" &&
        [...flagIds].some((flagId) => key.id === `flag:${flagId}`)
      )
        return true;
      return supportedCardConsequence(
        change,
        tuteeIds,
        events,
        new Set(
          current.participants.flatMap((participant) =>
            participant.removals
              .filter((row) => row.kind === "PUNISHMENT")
              .map((row) => row.id),
          ),
        ),
        new Set(
          saved.participants.flatMap((participant) => [
            ...participant.memberships.map((row) => row.pairingId),
            ...participant.groupPairingIds,
          ]),
        ),
      );
    };
    if (context.changes.some((change) => !supported(change)))
      blockers.push(
        "Independent attendance, patrol, card or membership decisions require their own correction.",
      );
    return {
      current: recoveryJson({ ...current, restorationEvidence }),
      compensatedEventIds: [...events],
      blockers,
      warnings: [
        "Patrol evidence is evaluated again. A previous flag decision or service-hour deduction is never copied back.",
      ],
      effects: [
        "Apply a new attendance correction across the complete merged block.",
        "Recompute service hours, automatic absence cards and punishment consequences.",
        "Reopen the current discrepancy for fresh review when applicable.",
      ],
      preserved: [
        "Original submissions, correction audits and merged-block associations.",
        "Independent cards, patrol observations, access restrictions and consent.",
      ],
    };
  },
  async apply(tx, id, raw, actor, reason) {
    const saved = snapshot.parse(raw);
    const current = await state(tx, id);
    await correctAttendance(
      tx,
      {
        ...saved.input,
        id: current.primary.id,
        expectedUpdatedAt: current.primary.updatedAt,
        reason: reason.slice(0, 1000),
      },
      actor,
    );
    // A compensation is fresh evidence review even when its date/roster match.
    await reconsiderSessionFlag(tx, current.primary.id);
    return {
      sessionId: current.primary.id,
      mergedSessionIds: current.sessions.map((row) => row.id),
      hoursRecomputed: true,
      flagReview: "FRESH",
    };
  },
};
