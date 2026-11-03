import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { lockAccountProfile } from "~/server/account-profile";
import { requireAcademicConfirmation } from "~/server/academics";
import { preserveHistoricalAcademics } from "~/server/historical-academics";
import { requirePolicy } from "~/server/policy-acceptance";
import { lockCatalogue } from "~/server/qualifications";
import {
  lockLegacySignupReview,
  lockStudentRequestReview,
} from "~/server/request-invalidity";
import { lockPlannedRoomSchedule } from "~/server/room-bookings";
import {
  requireSchoolParticipation,
  requireStudentSchoolParticipation,
} from "~/server/school-departure";
import { assertStudentRequestAssignable } from "~/server/student-request-state";
import { assertPairingGroupsRemainEligible } from "~/server/tutor-scheduling";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { recoveryHash, recoveryJson } from "../capture";
import type {
  CheckpointAdapter,
  CheckpointJournalChange,
} from "../checkpoint-contract";
import {
  eligibilityBlocker,
  fieldsOnly,
  participantIdentity,
  preservedCheckpointChange,
} from "./shared";
import {
  assertRecoveryAssignmentEligibility,
  inspectRecoveryAssignmentEligibility,
  inspectRecoveryParticipantEligibility,
  recoveryAssignmentSnapshot,
} from "./assignment-eligibility";

const pairing = z.object({
  id: z.string(),
  tutorId: z.string(),
  termId: z.string(),
  subject: z.string(),
  tuteeIds: z.array(z.string()),
  schedule: z.string(),
});
const snapshot = z.object({
  version: z.literal(1),
  kind: z.enum(["TUTOR", "TUTEE"]),
  id: z.string(),
  status: z.string(),
  termId: z.string().nullable(),
  bindingHash: z.string(),
  pairings: z.array(pairing).max(200),
  children: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["ACTIVE", "PENDING", "INACTIVE"]),
      }),
    )
    .max(400),
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
});

async function state(tx: TransactionDb, kind: "TUTOR" | "TUTEE", id: string) {
  const identity = await participantIdentity(tx, kind, id);
  const term = await tx.term.findFirst({
    where: { active: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const record =
    kind === "TUTOR"
      ? await tx.tutor.findUniqueOrThrow({
          where: { id },
          select: {
            id: true,
            status: true,
            updatedAt: true,
            preferredAssignedBlocks: true,
            workloadPreferenceVersion: true,
          },
        })
      : await tx.tutee.findUniqueOrThrow({
          where: { id },
          select: { id: true, status: true, updatedAt: true },
        });
  const pairings = term
    ? await tx.pairing.findMany({
        where: {
          termId: term.id,
          ...(kind === "TUTOR"
            ? { tutorId: id }
            : { tutees: { some: { tuteeId: id } } }),
        },
        include: {
          tutees: { orderBy: { tuteeId: "asc" } },
          tutor: { select: { status: true } },
        },
        orderBy: { id: "asc" },
        take: 201,
      })
    : [];
  return {
    identity,
    termId: term?.id ?? null,
    record,
    pairings: pairings.map((row) => ({
      id: row.id,
      tutorId: row.tutorId,
      termId: row.termId,
      subject: row.subject,
      tuteeIds: row.tutees.map((link) => link.tuteeId),
      tutorStatus: row.tutor.status,
      schedule: recoveryHash({
        dayOfWeek: row.dayOfWeek,
        startMin: row.startMin,
        endMin: row.endMin,
        roomId: row.roomId,
        roomMode: row.roomMode,
        timeSlotId: row.timeSlotId,
        groupId: row.groupId,
        scheduleConfirmed: row.scheduleConfirmed,
      }),
    })),
  };
}
async function eligible(
  tx: TransactionDb,
  kind: "TUTOR" | "TUTEE",
  id: string,
  desired: string,
  readOnly = false,
) {
  if (desired !== "ACTIVE" && desired !== "PENDING") return;
  const identity = await participantIdentity(tx, kind, id);
  if (kind === "TUTEE") {
    await requireStudentSchoolParticipation(tx, id);
    if (!readOnly) await assertStudentRequestAssignable(tx, id);
    else {
      const survey = await tx.studentSurvey.findUnique({
        where: { tuteeId: id },
      });
      const invalidity = !survey
        ? await tx.tuteeRequestInvalidity.findUnique({ where: { tuteeId: id } })
        : null;
      if (
        (survey &&
          (survey.state !== "OPEN" ||
            survey.invalidatedAt ||
            (!survey.confirmedAt &&
              survey.verificationDueAt &&
              survey.verificationDueAt <= new Date()))) ||
        invalidity?.invalidatedAt
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Current signup is closed, invalid or past its verification deadline.",
        });
      const term = await tx.term.findFirst({
        where: { active: true },
        select: { id: true },
      });
      if (
        !survey &&
        term &&
        (await tx.studentRequestReview.findFirst({
          where: {
            legacyTuteeId: id,
            legacyIntakeTermId: term.id,
            kind: "STUDENT_ABORT",
            state: "APPROVED",
          },
        }))
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Current-quarter withdrawal requires a fresh participation decision.",
        });
    }
  }
  for (const owner of identity.owners) {
    if (
      owner.mergedIntoId ||
      owner.suspendedAt ||
      owner.recoveryVoidedAt ||
      (kind === "TUTOR" && owner.tutorAccessRevoked)
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Current account restrictions prevent restoring participation.",
      });
    await requireSchoolParticipation(tx, owner.id);
    if (desired === "ACTIVE") {
      await requireAcademicConfirmation(tx, owner.id);
      await requirePolicy(
        tx,
        owner.id,
        kind === "TUTOR" ? "tutor-policy" : "tutee-policy",
      );
    }
  }
}
function supported(
  change: CheckpointJournalChange,
  kind: "TUTOR" | "TUTEE",
  id: string,
  pairingIds: Set<string>,
  childIds: Set<string>,
  originEvents: Set<string>,
) {
  if (preservedCheckpointChange(change)) return true;
  const key =
    change.recordKey &&
    typeof change.recordKey === "object" &&
    !Array.isArray(change.recordKey)
      ? change.recordKey
      : {};
  if (
    key.id === id &&
    fieldsOnly(change, kind === "TUTOR" ? "Tutor" : "Tutee", [
      "status",
      "updatedAt",
      "preferredAssignedBlocks",
      "workloadPreferenceVersion",
    ])
  )
    return true;
  if (
    typeof key.id === "string" &&
    childIds.has(key.id) &&
    originEvents.has(change.eventId) &&
    fieldsOnly(change, "Tutee", ["status", "updatedAt"])
  )
    return true;
  if (
    typeof key.id === "string" &&
    pairingIds.has(key.id) &&
    fieldsOnly(change, "Pairing", ["roomVersion", "roomShortageKey"])
  )
    return true;
  if (
    change.entity === "PairingTutee" &&
    ["INSERT", "DELETE"].includes(change.operation)
  )
    return (
      typeof key.pairingId === "string" &&
      pairingIds.has(key.pairingId) &&
      (kind === "TUTOR" || key.tuteeId === id)
    );
  // Resolved requests remain immutable evidence. The new recovery receipt and
  // reversal audit record compensation rather than reopening their decisions.
  const parentField = kind === "TUTOR" ? "tutorId" : "tuteeId";
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
    key[parentField] === id &&
    before[parentField] === id &&
    after[parentField] === id &&
    fieldsOnly(
      change,
      kind === "TUTOR" ? "TutorStatusRequest" : "TuteeRemovalRequest",
      [
        "state",
        "resolvedAt",
        "resolvedById",
        "resolvedByName",
        "pairingSnapshot",
        "removedPeriodKey",
      ],
    )
  );
}
function create(kind: "TUTOR" | "TUTEE"): CheckpointAdapter {
  return {
    id: kind === "TUTOR" ? "PARTICIPANT_TUTOR" : "PARTICIPANT_TUTEE",
    version: 1,
    sourceEntity: kind === "TUTOR" ? "Tutor" : "Tutee",
    directRoles: ["ADMIN", "HEAD"],
    async lock(tx, id, raw) {
      await lockCatalogue(tx);
      await lockPlannedRoomSchedule(tx);
      await lockEntity(tx, "session-planning");
      const current = await state(tx, kind, id);
      const saved = raw ? snapshot.parse(raw) : null;
      const tuteeIds = [
        ...new Set([
          ...(kind === "TUTEE" ? [id] : []),
          ...current.pairings.flatMap((row) => row.tuteeIds),
          ...(saved?.pairings.flatMap((row) => row.tuteeIds) ?? []),
        ]),
      ].sort();
      const tutorIds = [
        ...new Set([
          ...(kind === "TUTOR" ? [id] : []),
          ...current.pairings.map((row) => row.tutorId),
          ...(saved?.pairings.map((row) => row.tutorId) ?? []),
        ]),
      ].sort();
      const ownerIds = new Set(current.identity.ownerIds);
      for (const sourceId of tutorIds)
        for (const ownerId of (await participantIdentity(tx, "TUTOR", sourceId))
          .ownerIds)
          ownerIds.add(ownerId);
      for (const sourceId of tuteeIds)
        for (const ownerId of (await participantIdentity(tx, "TUTEE", sourceId))
          .ownerIds)
          ownerIds.add(ownerId);
      for (const ownerId of [...ownerIds].sort())
        await lockAccountProfile(tx, ownerId);
      for (const tuteeId of tuteeIds) {
        const survey = await tx.studentSurvey.findUnique({
          where: { tuteeId },
        });
        if (survey) await lockStudentRequestReview(tx, survey);
        else await lockLegacySignupReview(tx, tuteeId);
        await lockEntity(tx, `tutee:${tuteeId}`);
      }
      if (kind === "TUTOR") {
        await lockEntity(tx, `membership:tutor:${id}`);
        await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id=${id} FOR UPDATE`;
      } else
        await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id=${id} FOR UPDATE`;
    },
    async capture(tx, id) {
      const current = await state(tx, kind, id);
      const memberships = [];
      const memberScope = [];
      for (const row of current.pairings)
        for (const tuteeId of row.tuteeIds.filter(
          (sourceId) => kind === "TUTOR" || sourceId === id,
        )) {
          const captured = await recoveryAssignmentSnapshot(
            tx,
            row.id,
            tuteeId,
          );
          memberships.push({
            pairingId: row.id,
            tuteeId,
            scheduleHash: captured.scheduleHash,
            enrollmentHash: captured.enrollmentHash,
          });
          for (const identity of [
            captured.tutorIdentity,
            captured.tuteeIdentity,
          ]) {
            memberScope.push(
              ...identity.ownerIds.map((recordId) => ({
                entity: "User",
                recordId,
              })),
            );
            if (identity.binding.source.personId)
              memberScope.push({
                entity: "Person",
                recordId: identity.binding.source.personId,
              });
          }
        }
      const captured = snapshot.parse({
        version: 1,
        kind,
        id,
        status: current.record.status,
        termId: current.termId,
        bindingHash: recoveryHash(current.identity.binding),
        pairings: current.pairings,
        memberships,
        children:
          kind === "TUTOR"
            ? await tx.tutee.findMany({
                where: {
                  id: { in: current.pairings.flatMap((row) => row.tuteeIds) },
                },
                select: { id: true, status: true },
                orderBy: { id: "asc" },
              })
            : [],
      });
      return {
        snapshot: recoveryJson(captured),
        scope: [
          ...memberScope,
          ...current.identity.ownerIds.map((recordId) => ({
            entity: "User",
            recordId,
          })),
          ...(current.identity.binding.source.personId
            ? [
                {
                  entity: "Person",
                  recordId: current.identity.binding.source.personId,
                },
              ]
            : []),
          ...current.pairings.map((row) => ({
            entity: "Pairing",
            recordId: row.id,
          })),
          ...current.pairings.flatMap((row) =>
            row.tuteeIds.map((recordId) => ({ entity: "Tutee", recordId })),
          ),
        ],
      };
    },
    async inspect(tx, id, raw, context) {
      const saved = snapshot.parse(raw);
      const current = await state(tx, kind, id);
      const blockers: string[] = [];
      if (
        saved.kind !== kind ||
        saved.id !== id ||
        saved.termId !== current.termId ||
        saved.bindingHash !== recoveryHash(current.identity.binding)
      )
        blockers.push(
          "Participant period, grouping or exact ownership changed.",
        );
      const ids = new Set(saved.pairings.map((row) => row.id));
      if (current.pairings.some((row) => !ids.has(row.id)))
        blockers.push(
          "New independent assignments require their owning workflow.",
        );
      const retained = await tx.pairing.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, tutorId: true, termId: true, subject: true },
      });
      if (
        saved.pairings.some(
          (row) =>
            !retained.some(
              (now) =>
                now.id === row.id &&
                now.tutorId === row.tutorId &&
                now.termId === row.termId &&
                now.subject === row.subject,
            ),
        )
      )
        blockers.push("A captured assignment was removed or rebound.");
      if (
        current.pairings.some(
          (row) =>
            saved.pairings.find((old) => old.id === row.id)?.schedule !==
            row.schedule,
        )
      )
        blockers.push("Assignment scheduling changed.");
      const originEvents = new Set(
        context.events
          .filter(
            (event) => event.transactionId === context.captureTransactionId,
          )
          .map((event) => event.id),
      );
      if (
        context.changes.some(
          (change) =>
            !supported(
              change,
              kind,
              id,
              ids,
              new Set(saved.children.map((row) => row.id)),
              originEvents,
            ),
        )
      )
        blockers.push(
          "Unsupported participant descendant changes require a separate correction.",
        );
      const assignmentEvidence = [];
      for (const link of saved.memberships) {
        if (!retained.some((row) => row.id === link.pairingId)) continue;
        const inspected = await inspectRecoveryAssignmentEligibility(tx, {
          ...link,
          expectedScheduleHash: link.scheduleHash,
          expectedEnrollmentHash: link.enrollmentHash,
          ...(kind === "TUTOR"
            ? {
                restoredTutorStatus: saved.status,
                restoredTuteeStatus: saved.children.find(
                  (row) => row.id === link.tuteeId,
                )?.status,
              }
            : { restoredTuteeStatus: saved.status }),
        });
        blockers.push(...inspected.blockers);
        assignmentEvidence.push(inspected.evidence);
      }
      const blocked = await eligibilityBlocker(() =>
        eligible(tx, kind, id, saved.status, true),
      );
      if (blocked) blockers.push(blocked);
      const access = ["ACTIVE", "PENDING"].includes(saved.status)
        ? await inspectRecoveryParticipantEligibility(tx, {
            kind,
            sourceId: id,
          })
        : null;
      if (access) blockers.push(...access.blockers);
      if (
        !(
          ["ACTIVE", "PENDING", "INACTIVE"].includes(saved.status) &&
          kind === "TUTEE"
        ) &&
        !(
          [
            "ACTIVE",
            "PENDING",
            "ARCHIVED",
            "OPTED_OUT",
            "GRADUATED",
            "TRANSFERRED",
          ].includes(saved.status) && kind === "TUTOR"
        )
      )
        blockers.push("Unsupported participant status.");
      return {
        current: recoveryJson({ ...current, assignmentEvidence, access }),
        blockers,
        warnings: [
          "Assignments with later attendance, consent or other unsupported work cannot be replayed.",
        ],
        effects: [
          `Restore ${kind} ${id} lifecycle to ${saved.status}.`,
          "Restore only the captured memberships in retained current-period assignments.",
        ],
        preserved: [
          "Current credentials, access restrictions, names, academic reports and policy agreements.",
          "Original requests, decisions, attendance and service-hour history.",
        ],
      };
    },
    async apply(tx, id, raw) {
      const saved = snapshot.parse(raw);
      await eligible(tx, kind, id, saved.status);
      if (["ACTIVE", "PENDING"].includes(saved.status)) {
        const access = await inspectRecoveryParticipantEligibility(tx, {
          kind,
          sourceId: id,
        });
        if (access.blockers.length)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: access.blockers.join(" "),
          });
      }
      for (const link of saved.memberships)
        await assertRecoveryAssignmentEligibility(tx, {
          ...link,
          expectedScheduleHash: link.scheduleHash,
          expectedEnrollmentHash: link.enrollmentHash,
          ...(kind === "TUTOR"
            ? {
                restoredTutorStatus: saved.status,
                restoredTuteeStatus: saved.children.find(
                  (row) => row.id === link.tuteeId,
                )?.status,
              }
            : { restoredTuteeStatus: saved.status }),
        });
      const status =
        kind === "TUTOR"
          ? z
              .enum([
                "ACTIVE",
                "PENDING",
                "ARCHIVED",
                "OPTED_OUT",
                "GRADUATED",
                "TRANSFERRED",
              ])
              .parse(saved.status)
          : z.enum(["ACTIVE", "PENDING", "INACTIVE"]).parse(saved.status);
      if (status === "ACTIVE" || status === "PENDING")
        await preserveHistoricalAcademics(tx, kind, id);
      if (kind === "TUTOR")
        await tx.tutor.update({
          where: { id },
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
              .parse(status),
          },
        });
      else
        await tx.tutee.update({
          where: { id },
          data: {
            status: z.enum(["ACTIVE", "PENDING", "INACTIVE"]).parse(status),
          },
        });
      if (kind === "TUTOR")
        for (const child of saved.children)
          await tx.tutee.update({
            where: { id: child.id },
            data: { status: child.status },
          });
      const desired = saved.pairings.flatMap((row) =>
        row.tuteeIds
          .filter((tuteeId) => kind === "TUTOR" || tuteeId === id)
          .map((tuteeId) => ({ pairingId: row.id, tuteeId })),
      );
      const current = await tx.pairingTutee.findMany({
        where: {
          pairingId: { in: saved.pairings.map((row) => row.id) },
          ...(kind === "TUTEE" ? { tuteeId: id } : {}),
        },
      });
      for (const link of current)
        if (
          !desired.some(
            (old) =>
              old.pairingId === link.pairingId && old.tuteeId === link.tuteeId,
          )
        )
          await tx.pairingTutee.delete({ where: { pairingId_tuteeId: link } });
      for (const link of desired)
        if (
          !current.some(
            (now) =>
              now.pairingId === link.pairingId && now.tuteeId === link.tuteeId,
          )
        ) {
          await assertStudentRequestAssignable(tx, link.tuteeId);
          const target = await tx.pairing.findUniqueOrThrow({
            where: { id: link.pairingId },
            include: { tutor: true, term: true },
          });
          const learner = await tx.tutee.findUniqueOrThrow({
            where: { id: link.tuteeId },
            select: { status: true },
          });
          if (
            !target.term.active ||
            target.tutor.status !== "ACTIVE" ||
            learner.status === "INACTIVE"
          )
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Current participant eligibility prevents restoring this assignment.",
            });
          await tx.pairingTutee.create({ data: link });
        }
      await assertPairingGroupsRemainEligible(tx, {
        pairingIds: saved.pairings.map((row) => row.id),
      });
      return { participantId: id, status, restoredMemberships: desired.length };
    },
  };
}
export const tutorCheckpointAdapter = create("TUTOR");
export const tuteeCheckpointAdapter = create("TUTEE");
