import { TRPCError } from "@trpc/server";
import type { StudentContinuationAssignment } from "../../generated/prisma";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import {
  allocateRoom,
  allocationData,
  notifyRoomShortage,
  persistRoomUnit,
  roomUnitInclude,
} from "./room-allocation";
import {
  assertStudentRequestAssignable,
  stampStudentAssignment,
} from "./student-request-state";
import {
  syncContinuationPlanMembership,
  lockSessionPlanning,
} from "./session-planning";
import { lockCatalogue } from "./qualifications";
import { lockUsernameNamespace } from "./auth/username";
import { lockStudentRequestReview } from "./request-invalidity";
import { pairingGroupEligibility } from "~/lib/pairing-group-eligibility";
import { preserveHistoricalAcademics } from "./historical-academics";
import {
  managementNotificationRecipients,
  notifyUsers,
  notificationData,
} from "./notifications/create";
import { requestStaffDestination } from "~/lib/request-notification-destination";
import { recordDomainAudit } from "./audit/evidence";
import {
  participantKeys,
  participantsOverlap,
} from "./session-planning/participants";

type Snapshot = {
  tutorId: string;
  subject: string;
  sourceGroupId: string | null;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  timeSlotId: string | null;
};
export type ContinuationAssignmentReason =
  | "SOURCE_CHANGED"
  | "UNCONFIRMED_SCHEDULE"
  | "TUTOR_UNAVAILABLE"
  | "SLOT_UNAVAILABLE"
  | "SUBJECT_UNAVAILABLE"
  | "QUALIFICATION_MISSING"
  | "WILLINGNESS_MISSING"
  | "SCHEDULE_CONFLICT"
  | "ROOM_UNAVAILABLE"
  | "GROUP_REVIEW_REQUIRED"
  | "PARTICIPATION_UNAVAILABLE"
  | "ALREADY_JOINED"
  | "RELEASED";
export type ContinuationAssignmentResult = {
  state: "ASSIGNED" | "UNASSIGNED" | "RELEASED";
  reason: string | null;
  assignmentId: string;
  targetPairingId: string | null;
};
const result = (
  row: StudentContinuationAssignment,
): ContinuationAssignmentResult => ({
  state: row.status as ContinuationAssignmentResult["state"],
  reason: row.reason,
  assignmentId: row.id,
  targetPairingId: row.targetPairingId,
});

async function availabilityReason(
  tx: TransactionDb,
  snapshot: Snapshot,
): Promise<ContinuationAssignmentReason | null> {
  const tutor = await tx.tutor.findUnique({
    where: { id: snapshot.tutorId },
    include: { user: { include: { schoolDeparture: true } } },
  });
  if (
    tutor?.status !== "ACTIVE" ||
    !tutor.user ||
    tutor.user.suspendedAt ||
    tutor.user.mergedIntoId ||
    tutor.user.tutorAccessRevoked ||
    tutor.user.role === "VIEWER" ||
    tutor.user.schoolDeparture?.reason
  )
    return "TUTOR_UNAVAILABLE";
  const available = await tx.tutorAvailability.count({
    where: {
      tutorId: snapshot.tutorId,
      slot: {
        active: true,
        dayOfWeek: snapshot.dayOfWeek,
        startMin: { lte: snapshot.startMin },
        endMin: { gte: snapshot.endMin },
      },
    },
  });
  return available ? null : "SLOT_UNAVAILABLE";
}

/** Preview is advisory; the admitted mutation repeats every guard under its shared fences. */
export async function getContinuationAssignmentReason(
  tx: TransactionDb,
  sourcePairing: { id: string },
  tuteeId?: string,
): Promise<ContinuationAssignmentReason | null> {
  const source = await tx.pairing.findUnique({
    where: { id: sourcePairing.id },
  });
  if (!source) return "SOURCE_CHANGED";
  if (
    !source.scheduleConfirmed ||
    source.endMin <= source.startMin ||
    source.startMin > 1395
  )
    return "UNCONFIRMED_SCHEDULE";
  const subject = await tx.subject.findUnique({
    where: { name: source.subject },
    include: { level: true },
  });
  if (!subject?.active || subject.level?.active === false)
    return "SUBJECT_UNAVAILABLE";
  const unavailable = await availabilityReason(tx, {
    ...source,
    sourceGroupId: source.groupId,
  });
  if (unavailable) return unavailable;
  if (
    !(await tx.qualificationGrant.count({
      where: {
        tutorId: source.tutorId,
        subjectId: subject.id,
        qualification: { status: "APPROVED" },
      },
    }))
  )
    return "QUALIFICATION_MISSING";
  if (
    !(await tx.tutorSubjectWillingness.count({
      where: { tutorId: source.tutorId, subjectId: subject.id, willing: true },
    }))
  )
    return "WILLINGNESS_MISSING";
  if (tuteeId) {
    const student = await tx.tutee.findUnique({ where: { id: tuteeId } });
    if (!student || student.status === "INACTIVE")
      return "PARTICIPATION_UNAVAILABLE";
  }
  return null;
}

/** Caller owns period → username → catalogue → planning → request/profile locks.
 * A savepoint lets a failed individual assignment retain its accepted signup evidence. */
export async function attemptContinuationAssignment(
  tx: TransactionDb,
  input: {
    surveyId: string;
    tuteeId: string;
    sourcePairingId: string;
    sourceTuteeId: string;
    targetTermId: string;
    now: Date;
  },
): Promise<ContinuationAssignmentResult> {
  const request = await tx.studentSurvey.findUnique({
    where: { id: input.surveyId },
  });
  if (
    request?.tuteeId !== input.tuteeId ||
    request.intakeTermId !== input.targetTermId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "The continuation request does not own this target profile.",
    });
  const prior = await tx.studentContinuationAssignment.findUnique({
    where: {
      surveyId_sourcePairingId: {
        surveyId: input.surveyId,
        sourcePairingId: input.sourcePairingId,
      },
    },
  });
  if (prior) return result(prior); // An accepted selection never silently retries or reattaches.
  const source = await tx.pairing.findUnique({
    where: { id: input.sourcePairingId },
    include: {
      term: true,
      tutees: { select: { tuteeId: true } },
    },
  });
  const target = await tx.term.findUnique({
    where: { id: input.targetTermId },
  });
  const snapshot: Snapshot | null = source
    ? {
        tutorId: source.tutorId,
        subject: source.subject,
        sourceGroupId: source.groupId,
        dayOfWeek: source.dayOfWeek,
        startMin: source.startMin,
        endMin: source.endMin,
        timeSlotId: source.timeSlotId,
      }
    : null;
  const row = await tx.studentContinuationAssignment.create({
    data: {
      surveyId: input.surveyId,
      tuteeId: input.tuteeId,
      sourcePairingId: input.sourcePairingId,
      sourceTuteeId: input.sourceTuteeId,
      targetTermId: input.targetTermId,
      tutorId: source?.tutorId,
      snapshot: snapshot ?? {},
      createdAt: input.now,
    },
  });
  const unassigned = async (reason: ContinuationAssignmentReason) =>
    result(
      await tx.studentContinuationAssignment.update({
        where: { id: row.id },
        data: { reason },
      }),
    );
  if (
    !source ||
    !snapshot ||
    !target?.active ||
    source.term.schoolYear !== target.schoolYear ||
    !(
      (source.term.quarter === "Q1" && target.quarter === "Q2") ||
      (source.term.quarter === "Q3" && target.quarter === "Q4")
    ) ||
    !source.tutees.some((person) => person.tuteeId === input.sourceTuteeId)
  )
    return unassigned("SOURCE_CHANGED");
  const reason = await getContinuationAssignmentReason(
    tx,
    source,
    input.tuteeId,
  );
  if (reason) return unassigned(reason);
  const duplicate = await tx.pairingTutee.findFirst({
    where: {
      tuteeId: input.tuteeId,
      pairing: { termId: input.targetTermId, subject: source.subject },
    },
  });
  if (duplicate) return unassigned("ALREADY_JOINED");
  await tx.$executeRawUnsafe("SAVEPOINT continuation_assignment");
  try {
    await assertStudentRequestAssignable(tx, input.tuteeId);
    await preserveHistoricalAcademics(tx, "TUTEE", input.tuteeId);
    const mapped = await tx.studentContinuationPairing.findUnique({
      where: {
        sourcePairingId_targetTermId: {
          sourcePairingId: source.id,
          targetTermId: target.id,
        },
      },
    });
    const current = mapped
      ? await tx.pairing.findUnique({
          where: { id: mapped.pairingId },
          include: { tutees: true },
        })
      : null;
    if (
      mapped &&
      (!current ||
        !sameCommitment(current, snapshot) ||
        !current.scheduleConfirmed)
    )
      throw new TRPCError({ code: "CONFLICT", message: "SOURCE_CHANGED" });
    const roster = [
      ...new Set([
        ...(current?.tutees.map((person) => person.tuteeId) ?? []),
        input.tuteeId,
      ]),
    ];
    const sourceSiblings = source.groupId
      ? await tx.pairing.findMany({
          where: { groupId: source.groupId },
          select: { id: true },
        })
      : [];
    const siblingMappings = sourceSiblings.length
      ? await tx.studentContinuationPairing.findMany({
          where: {
            targetTermId: target.id,
            sourcePairingId: {
              in: sourceSiblings.map((pairing) => pairing.id),
              not: source.id,
            },
          },
        })
      : [];
    const siblings = siblingMappings.length
      ? await tx.pairing.findMany({
          where: {
            id: { in: siblingMappings.map((mapping) => mapping.pairingId) },
          },
          include: { tutees: true },
        })
      : [];
    if (
      current?.groupId &&
      !siblings.some((sibling) => sibling.groupId === current.groupId)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "GROUP_REVIEW_REQUIRED",
      });
    if (
      siblings.length &&
      (!siblings.every((sibling) =>
        sameCommitment(sibling, { ...snapshot, subject: sibling.subject }),
      ) ||
        !pairingGroupEligibility([
          ...siblings,
          {
            subject: source.subject,
            tutees: roster.map((tuteeId) => ({ tuteeId })),
          },
        ]).eligible)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "GROUP_REVIEW_REQUIRED",
      });
    // New group membership would reinterpret already published physical lessons.
    if (
      siblings.length &&
      !current?.groupId &&
      (await tx.sessionPlanAssignment.count({
        where: {
          pairingId: { in: siblings.map((sibling) => sibling.id) },
        },
      }))
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "GROUP_REVIEW_REQUIRED",
      });
    const excluded = [
      ...siblings.map((sibling) => sibling.id),
      ...(current ? [current.id] : []),
    ];
    // Dated plans may not exist yet. Weekly learner/dual-role conflicts must be
    // checked here as well as the allocator's existing tutor/room checks.
    const overlapping = await tx.pairing.findMany({
      where: {
        termId: target.id,
        scheduleConfirmed: true,
        dayOfWeek: snapshot.dayOfWeek,
        startMin: { lt: snapshot.endMin },
        endMin: { gt: snapshot.startMin },
        id: { notIn: excluded },
      },
      include: {
        tutees: {
          where: { tutee: { status: { not: "INACTIVE" } } },
          select: { tuteeId: true },
        },
      },
    });
    const identities = await participantKeys(
      tx,
      [snapshot.tutorId, ...overlapping.map((pairing) => pairing.tutorId)],
      [
        ...roster,
        ...overlapping.flatMap((pairing) =>
          pairing.tutees.map((person) => person.tuteeId),
        ),
      ],
    );
    if (
      overlapping.some((pairing) =>
        participantsOverlap(
          identities,
          snapshot.tutorId,
          roster,
          pairing.tutorId,
          pairing.tutees.map((person) => person.tuteeId),
        ),
      )
    )
      throw new TRPCError({ code: "CONFLICT", message: "SCHEDULE_CONFLICT" });
    const allocation = await allocateRoom(
      tx,
      {
        ...snapshot,
        id: current?.id,
        termId: target.id,
        tuteeIds: roster,
        scheduleConfirmed: true,
        excludePairingIds: excluded,
      },
      current ? {} : { roomMode: "AUTO" },
      current ?? undefined,
    );
    if (
      allocation.roomNeedsAssignment ||
      (!allocation.roomId && allocation.roomMode !== "NONE")
    )
      throw new TRPCError({ code: "CONFLICT", message: "ROOM_UNAVAILABLE" });
    const slot = snapshot.timeSlotId
      ? await tx.timeSlot.findUnique({ where: { id: snapshot.timeSlotId } })
      : null;
    const timeSlotId =
      slot?.active &&
      slot.dayOfWeek === snapshot.dayOfWeek &&
      slot.startMin === snapshot.startMin &&
      slot.endMin === snapshot.endMin
        ? slot.id
        : null;
    const groupId =
      current?.groupId ?? siblings.find((sibling) => sibling.groupId)?.groupId;
    const group = siblings.length
      ? groupId
        ? await tx.pairingGroup.findUniqueOrThrow({ where: { id: groupId } })
        : await tx.pairingGroup.create({
            data: {
              tutorId: source.tutorId,
              termId: target.id,
              primaryPairingId: siblings[0]!.id,
            },
          })
      : null;
    // Room guards run per row: reserve a new member only after its whole group
    // has been detached, then restore the complete unit inside this savepoint.
    if (group)
      await tx.pairing.updateMany({
        where: { id: { in: excluded } },
        data: {
          groupId: null,
          scheduleConfirmed: false,
          roomNeedsAssignment: false,
          roomShortageKey: null,
        },
      });
    const pairing = current
      ? await tx.pairing.update({
          where: { id: current.id },
          data: {
            ...allocationData(allocation),
            roomVersion: { increment: 1 },
            tutees: { create: { tuteeId: input.tuteeId } },
          },
        })
      : await tx.pairing.create({
          data: {
            tutorId: snapshot.tutorId,
            subject: snapshot.subject,
            termId: target.id,
            dayOfWeek: snapshot.dayOfWeek,
            startMin: snapshot.startMin,
            endMin: snapshot.endMin,
            timeSlotId,
            scheduleConfirmed: !group,
            ...allocationData(allocation),
            tutees: { create: { tuteeId: input.tuteeId } },
          },
        });
    if (!mapped)
      await tx.studentContinuationPairing.create({
        data: {
          sourcePairingId: source.id,
          targetTermId: target.id,
          pairingId: pairing.id,
        },
      });
    if (group) {
      const members = await tx.pairing.findMany({
        where: {
          id: { in: [pairing.id, ...siblings.map((sibling) => sibling.id)] },
        },
        include: roomUnitInclude,
      });
      await persistRoomUnit(
        tx,
        members.map((member) => ({ ...member, groupId: group.id })),
        allocation,
        {
          timeSlotId,
          dayOfWeek: snapshot.dayOfWeek,
          startMin: snapshot.startMin,
          endMin: snapshot.endMin,
          scheduleConfirmed: true,
        },
      );
    }
    await tx.tutee.update({
      where: { id: input.tuteeId },
      data: { status: "ACTIVE" },
    });
    await stampStudentAssignment(tx, input.tuteeId);
    const assigned = await tx.studentContinuationAssignment.update({
      where: { id: row.id },
      data: {
        targetPairingId: pairing.id,
        status: "ASSIGNED",
        assignedAt: input.now,
        reason: null,
      },
    });
    await syncContinuationPlanMembership(
      tx,
      {
        assignmentId: row.id,
        pairingId: pairing.id,
        tuteeId: input.tuteeId,
        joinedAt: input.now,
      },
      input.now,
    );
    await notifyRoomShortage(
      tx,
      pairing.id,
      allocation,
      current?.roomShortageKey,
    );
    await recordDomainAudit(tx, {
      operation: "studentContinuation.assign",
      entity: "StudentContinuationAssignment",
      entityId: row.id,
      action: "Assigned an explicitly selected continuing session",
      after: { status: "ASSIGNED", targetPairingId: pairing.id },
      effects: {
        surveyId: input.surveyId,
        sourcePairingId: source.id,
        tuteeId: input.tuteeId,
        priorHistoryPreserved: true,
      },
    });
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT continuation_assignment");
    return result(assigned);
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT continuation_assignment");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT continuation_assignment");
    if (!(error instanceof TRPCError)) throw error;
    const expected = [
      "SOURCE_CHANGED",
      "GROUP_REVIEW_REQUIRED",
      "ROOM_UNAVAILABLE",
    ] as const;
    return unassigned(
      expected.find((value) => error.message === value) ??
        (error.code === "FORBIDDEN" || error.code === "PRECONDITION_FAILED"
          ? "PARTICIPATION_UNAVAILABLE"
          : "SCHEDULE_CONFLICT"),
    );
  }
}

function sameCommitment(
  pairing: {
    tutorId: string;
    subject: string;
    dayOfWeek: number;
    startMin: number;
    endMin: number;
  },
  snapshot: Snapshot,
) {
  return (
    pairing.tutorId === snapshot.tutorId &&
    pairing.subject === snapshot.subject &&
    pairing.dayOfWeek === snapshot.dayOfWeek &&
    pairing.startMin === snapshot.startMin &&
    pairing.endMin === snapshot.endMin
  );
}

/** Call under the admission fences, before locking the tutor account. Legacy
 * request actions insert participant notifications while holding their request;
 * their User foreign-key locks must not wait behind our account row lock. */
export async function lockTutorContinuationRequests(
  tx: TransactionDb,
  tutorId: string,
) {
  const active = await tx.term.findFirst({
    where: { active: true }, select: { id: true },
  });
  if (!active) return;
  const assignments = await tx.studentContinuationAssignment.findMany({
    where: { tutorId, targetTermId: active.id, status: "ASSIGNED" },
    select: { surveyId: true },
  });
  const requests = await tx.studentSurvey.findMany({
    where: { id: { in: assignments.map((assignment) => assignment.surveyId) } },
    select: { id: true, email: true },
    orderBy: [{ email: "asc" }, { id: "asc" }],
  });
  for (const request of requests) await lockStudentRequestReview(tx, request);
}

/** Caller has the same period/catalogue/planning fences as admission. Release is
 * receipt-based, so repeated saves and restored availability cannot reattach. */
export async function reconcileTutorContinuations(
  tx: TransactionDb,
  tutorId: string,
  now = new Date(),
) {
  const active = await tx.term.findFirst({
    where: { active: true },
    select: { id: true },
  });
  if (!active) return { released: 0 };
  const rows = await tx.studentContinuationAssignment.findMany({
    where: { tutorId, targetTermId: active.id, status: "ASSIGNED" },
    orderBy: { id: "asc" },
  });
  let released = 0;
  for (const row of rows) {
    const survey = await tx.studentSurvey.findUnique({
      where: { id: row.surveyId },
    });
    if (survey) await lockStudentRequestReview(tx, survey);
    const snapshot = row.snapshot as unknown as Snapshot;
    const pairing = row.targetPairingId
      ? await tx.pairing.findUnique({
          where: { id: row.targetPairingId },
          include: { tutees: true },
        })
      : null;
    const sameTuple =
      pairing && sameCommitment(pairing, snapshot) && pairing.scheduleConfirmed;
    const unchanged =
      sameTuple &&
      pairing.tutees.some((person) => person.tuteeId === row.tuteeId);
    const reason = unchanged
      ? await availabilityReason(tx, snapshot)
      : "SOURCE_CHANGED";
    if (!reason) continue;
    // Explicit staff replacement ends our ownership; never undo its newer tuple.
    if (sameTuple && pairing) {
      if (unchanged) {
        await preserveHistoricalAcademics(tx, "TUTEE", row.tuteeId);
        await tx.pairingTutee.deleteMany({
          where: { pairingId: pairing.id, tuteeId: row.tuteeId },
        });
      }
      await syncContinuationPlanMembership(
        tx,
        {
          assignmentId: row.id,
          pairingId: pairing.id,
          tuteeId: row.tuteeId,
          joinedAt: row.assignedAt ?? row.createdAt,
          releasedAt: now,
        },
        now,
      );
      if (!(await tx.pairingTutee.count({ where: { pairingId: pairing.id } })))
        await tx.pairing.update({
          where: { id: pairing.id },
          data: {
            scheduleConfirmed: false,
            roomId: null,
            roomNeedsAssignment: false,
            roomShortageKey: null,
            roomVersion: { increment: 1 },
          },
        });
      if (
        !(await tx.pairingTutee.count({
          where: { tuteeId: row.tuteeId, pairing: { termId: active.id } },
        }))
      )
        await tx.tutee.update({
          where: { id: row.tuteeId },
          data: { status: "PENDING" },
        });
    }
    await tx.studentContinuationAssignment.update({
      where: { id: row.id },
      data: { status: "RELEASED", reason, releasedAt: now },
    });
    const managers = await managementNotificationRecipients(tx);
    const owner = await tx.studentProfileOwnership.findUnique({
      where: { tuteeId: row.tuteeId },
    });
    const participants = await tx.user.findMany({
      where: {
        suspendedAt: null,
        mergedIntoId: null,
        OR: [
          { tutorId },
          { studentId: row.tuteeId },
          ...(owner ? [{ id: owner.userId }] : []),
        ],
      },
      select: { id: true, tutorId: true },
    });
    const detail =
      reason === "SOURCE_CHANGED"
        ? "The assignment was changed separately. / 安排已另行变更。"
        : reason === "TUTOR_UNAVAILABLE"
          ? "The tutor is no longer available. / 导师目前无法继续。"
          : "The previous weekly time is no longer available. / 原每周上课时间已不可用。";
    const body = `${snapshot.subject}: ${detail} The signup request is retained for staff review. / 报名申请已保留，等待管理人员处理。`;
    const event = notificationData("student_continuation_released");
    await notifyUsers(
      managers.map((person) => person.id),
      {
        ...event,
        body,
        link: requestStaffDestination({ kind: "survey", id: row.surveyId }),
      },
      tx,
    );
    for (const participant of participants.filter(
      (person) => !managers.some((manager) => manager.id === person.id),
    ))
      await notifyUsers(
        [participant.id],
        {
          ...event,
          body,
          link: participant.tutorId === tutorId ? "/dashboard" : "/student",
        },
        tx,
      );
    await recordDomainAudit(tx, {
      operation: "studentContinuation.release",
      entity: "StudentContinuationAssignment",
      entityId: row.id,
      action: unchanged
        ? "Released a continuing assignment after tutor availability changed"
        : "Retired continuation tracking after assignment replacement",
      before: { status: row.status },
      after: { status: "RELEASED", reason },
      effects: {
        surveyId: row.surveyId,
        targetPairingId: row.targetPairingId,
        tuteeId: row.tuteeId,
        signupRequestPreserved: true,
        attendancePreserved: true,
        assignmentDetached: Boolean(unchanged),
      },
    });
    released++;
  }
  return { released };
}

/** Catch-up covers lifecycle/import writers and downtime without granting old
 * assignments a new opt-in window or silently restoring released links. */
export async function reconcileStudentContinuations(
  db: DomainDb,
  now = new Date(),
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockCatalogue(tx);
    await lockSessionPlanning(tx);
    const active = await tx.term.findFirst({
      where: { active: true },
      select: { id: true },
    });
    if (!active) return { released: 0 };
    const tutors = await tx.studentContinuationAssignment.findMany({
      where: {
        targetTermId: active.id,
        status: "ASSIGNED",
        tutorId: { not: null },
      },
      select: { tutorId: true },
      distinct: ["tutorId"],
      orderBy: { tutorId: "asc" },
    });
    let released = 0;
    for (const tutor of tutors)
      released += (await reconcileTutorContinuations(tx, tutor.tutorId!, now))
        .released;
    return { released };
  });
}
