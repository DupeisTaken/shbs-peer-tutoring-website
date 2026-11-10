import { accountHistoryIds } from "../account-history";
import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../../generated/prisma";
import {
  plannedWindow,
  planningWeeks,
  addPlanningDays,
  responseDeadline,
  oneNegotiationAction,
  resolvePlanningCalendarDay,
  type PlanningTime,
} from "~/lib/session-planning";
import {
  participantKeys,
  participantsOverlap,
  createParticipantOverlapChecker,
} from "./participants";
import { notificationTuteeRecipients } from "./notification-recipients";
import { insertSessionNotices } from "./notice-inserts";
import { readContinuationPairingIds } from "./publication-continuations";
import { lockPlanningSources } from "./source-locks";
import { readOverlappingCohorts, readOverlappingHolds } from "./conflict-reads";
import {
  readPublicationValidationSnapshot,
  type PublicationValidationSnapshot,
} from "./publication-validation";
import {
  capturePublicationNotice,
  queuePublicationNotices,
  type PublicationNotice,
} from "./publication-notices";
import { sessionNoticeContext } from "~/server/session-planning-notice-copy";
import { pairingEntries } from "~/lib/pairing-groups";
import {
  createProgramDateTimeParser,
  programDateKey,
} from "~/lib/program-time";
import { createSchoolCalendarSnapshot } from "~/lib/school-calendar";
import {
  isRegularTutoringPaused,
  tutoringPauseSemanticRanges,
  type TutoringPauseRange,
} from "~/lib/tutoring-policy";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { lockPlannedRoomSchedule } from "~/server/room-bookings";
import { ownedStudentIds } from "~/server/student-ownership";
import { requireParticipantSourceParticipation } from "~/server/participant-source-restrictions";
import { requireSchoolParticipation } from "~/server/school-departure";
import { getProgramTimeZone } from "~/server/program/time-zone-reader";
import { readRegularTutoringPausedAt } from "~/server/program/calendar-policy-history";
import { recordDomainAudit } from "~/server/audit/evidence";
import { findAccountPolicy, requirePolicy } from "~/server/policy-acceptance";
import {
  readSchedulingMaintenance,
  acknowledgeSchedulingPublication,
  prepareSchedulingInvalidationBatch,
  completeSchedulingInvalidation,
  retrySchedulingInvalidation,
  finishSchedulingInvalidationBatch,
  inSchedulingMaintenanceTransaction,
} from "./maintenance";
import { executionParticipantId, executionPairingId, executionPlanTutorId, executionResponseActor, executionResponseOwnerIds, executionAssignments, pairingEvidenceIds, supersededPairingIds, transferredPlanIsCurrent } from "~/server/participant-execution";

const planInclude = {
  assignments: true,
  continuationMembers: true,
  participants: { include: { tutee: true } },
  tutor: { include: { user: true } },
  term: true,
} satisfies Prisma.SessionPlanInclude;
type Plan = Prisma.SessionPlanGetPayload<{ include: typeof planInclude }>;
type RecipientPlan = Pick<Plan, "tutorId"> & {
  id?: string;
  tutor: { user: Plan["tutor"]["user"] };
};
type NoticePlan = RecipientPlan &
  Pick<Plan, "timeZone"> & {
    assignments: readonly { subject: string }[];
    participants: readonly { cohortId: string | null; tuteeId: string }[];
  };
type ValidationPlan = Pick<
  Plan,
  "id" | "tutorId" | "termId" | "originalDate" | "timeZone" | "term"
> & { assignments: readonly { pairingId: string }[] };
const sourcePairingInclude = {
  tutees: {
    where: { tutee: { status: { not: "INACTIVE" } } },
    select: { tuteeId: true },
  },
} satisfies Prisma.PairingInclude;
const requestInclude = {
  offers: { include: { responses: true } },
  plan: { include: planInclude },
} satisfies Prisma.SessionPlanningRequestInclude;
type Request = Prisma.SessionPlanningRequestGetPayload<{
  include: typeof requestInclude;
}>;
type Cohort = Prisma.SessionPlanCohortGetPayload<Record<string, never>>;
type PlanningComputation = {
  calendar: ReturnType<typeof createSchoolCalendarSnapshot>;
  parseDateTime: ReturnType<typeof createProgramDateTimeParser>;
  tutoringPauses?: readonly TutoringPauseRange[];
};
type Actor = { id: string; tutorId?: string | null };
type Versioned = { expectedVersion: number; clientKey: string };
type Proposed = PlanningTime &
  Versioned & {
    cohortId: string;
    scope: "ONE" | "ALL";
    tuteeId?: string;
    kind: "RESCHEDULE" | "EXTRA";
    suggestionId?: string;
    pausedOnly?: boolean;
  };
const ids = (value: Prisma.JsonValue): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Original publication remains immutable; later explicit enrollments are separate evidence. */
function assignmentRoster(plan: Plan, assignment: Plan["assignments"][number]) {
  return [
    ...new Set([
      ...ids(assignment.tuteeIds),
      ...plan.continuationMembers
        .filter((member) => member.pairingId === assignment.pairingId)
        .map((member) => member.tuteeId),
    ]),
  ];
}

function continuationPublication(
  plan: Pick<Plan, "generationKey" | "originalDate">,
) {
  const marker = `:${plan.originalDate}:continuation`;
  const index = plan.generationKey.lastIndexOf(marker);
  if (index < 0) return null;
  const suffix = plan.generationKey.slice(index + marker.length);
  if (suffix && !/^:\d+$/.test(suffix)) return null;
  return {
    sourceDate: plan.generationKey.slice(0, index + marker.length),
    revision: suffix ? Number(suffix.slice(1)) : 0,
  };
}

function latestContinuationPublications<
  T extends Pick<Plan, "generationKey" | "originalDate">,
>(plans: T[]) {
  const latest = new Map<string, T>();
  for (const plan of plans) {
    const identity = continuationPublication(plan);
    if (!identity) continue;
    const previous = latest.get(identity.sourceDate);
    if (
      !previous ||
      continuationPublication(previous)!.revision < identity.revision
    )
      latest.set(identity.sourceDate, plan);
  }
  return latest;
}
function fail(
  message: string,
  code: "CONFLICT" | "FORBIDDEN" | "BAD_REQUEST" | "NOT_FOUND" = "BAD_REQUEST",
): never {
  throw new TRPCError({ code, message });
}

/** Shared by the transport completion fence, deadline worker and attendance bridge. */
export async function lockSessionPlanning(tx: TransactionDb) {
  await lockPlannedRoomSchedule(tx);
  await lockEntity(tx, "session-planning");
}

/** Public planning writes follow period → room, then account/profile row guards.
 * Nested allocation/attendance helpers retain their existing caller-owned order. */
async function lockPlanningEntry(tx: TransactionDb) {
  await lockEntity(tx, "program:period");
  await lockSessionPlanning(tx);
}

/** Agenda bookkeeping may defer behind another publication; request decisions
 * still take the blocking source fence below. Try the exact same period → room
 * → planning set in order, releasing any acquired prefix with this short tx.
 */
async function tryLockPlanningMaintenance(tx: TransactionDb) {
  for (const key of ["program:period", "planned-room-schedule", "session-planning"]) {
    const [result] = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
    if (typeof result?.locked !== "boolean")
      throw new Error("Scheduling maintenance lock acquisition is unavailable.");
    if (!result.locked) return false;
  }
  return true;
}

async function actorAccount(tx: TransactionDb, actor: Actor) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
  const account = await tx.user.findUnique({ where: { id: actor.id } });
  if (
    !account ||
    account.role === "VIEWER" ||
    account.suspendedAt ||
    account.mergedIntoId
  )
    fail("This account cannot change sessions.", "FORBIDDEN");
  await requireSchoolParticipation(tx, actor.id);
  return account;
}

async function requireTutor(tx: TransactionDb, actor: Actor, tutorId: string, planId?: string) {
  tutorId = planId ? await executionPlanTutorId(tx, planId, tutorId) : await executionParticipantId(tx, "TUTOR", tutorId);
  const account = await actorAccount(tx, actor);
  const tutor = await tx.tutor.findUnique({ where: { id: tutorId } });
  if (
    account.tutorId !== tutorId ||
    account.tutorAccessRevoked ||
    tutor?.status !== "ACTIVE"
  )
    fail("Only this active tutor can file the formal request.", "FORBIDDEN");
  await requireParticipantSourceParticipation(tx, "TUTOR", tutorId);
  await requirePolicy(tx, actor.id, "tutor-policy");
}

async function studentOwner(tx: TransactionDb, tuteeId: string) {
  tuteeId = await executionParticipantId(tx, "TUTEE", tuteeId);
  const ownership = await tx.studentProfileOwnership.findUnique({
    where: { tuteeId },
  });
  const account = ownership
    ? await tx.user.findUnique({ where: { id: ownership.userId } })
    : await tx.user.findFirst({ where: { studentId: tuteeId } });
  const profile = await tx.tutee.findUnique({
    where: { id: tuteeId },
    select: { status: true },
  });
  if (
    !account?.email ||
    account.role === "VIEWER" ||
    !account.tuteeMember ||
    account.suspendedAt ||
    account.mergedIntoId ||
    profile?.status !== "ACTIVE"
  )
    fail(
      "A participant needs an active linked account and mailbox before formal scheduling.",
    );
  await requireParticipantSourceParticipation(tx, "TUTEE", tuteeId);
  if (
    account.tutorId &&
    !(await findAccountPolicy(tx, account.id, "tutee-policy"))
  )
    fail("Accept the tutee policy before participating.", "FORBIDDEN");
  await requireSchoolParticipation(tx, account.id);
  return account;
}

async function receipt(
  tx: TransactionDb,
  actor: Actor,
  clientKey: string,
  input: unknown,
  work: () => Promise<{ id: string }>,
) {
  const hash = fingerprint(input);
  const previous = await tx.sessionPlanningReceipt.findUnique({
    where: { actorId_clientKey: { actorId: actor.id, clientKey } },
  });
  if (previous) {
    if (previous.payloadHash !== hash)
      fail(
        "This request key was already used with different choices.",
        "CONFLICT",
      );
    return previous.result as { id: string };
  }
  const result = await work();
  await tx.sessionPlanningReceipt.create({
    data: { actorId: actor.id, clientKey, payloadHash: hash, result },
  });
  return result;
}

async function audit(
  tx: TransactionDb,
  id: string,
  action: string,
  system = false,
) {
  await recordDomainAudit(tx, {
    operation: `sessionPlanning.${action}`,
    entity: "SessionPlanningRequest",
    entityId: id,
    action: `Session planning: ${action}`,
    system,
  });
}

async function loadCohort(tx: TransactionDb, id: string) {
  const cohort = await tx.sessionPlanCohort.findUnique({
    where: { id },
    include: { plan: { include: planInclude } },
  });
  if (!cohort) fail("This dated session no longer exists.", "NOT_FOUND");
  return cohort;
}

/** Optional reminders read published commitments through the same source and
 * ownership fences as scheduling. This never publishes, consents or records attendance. */
export async function readCurrentSessionReminderCohort(
  db: DomainDb,
  id: string,
) {
  return inTransaction(db, async (tx) => {
    await lockPlanningEntry(tx);
    const cohort = await tx.sessionPlanCohort.findUnique({
      where: { id },
      include: { plan: { include: planInclude } },
    });
    if (
      cohort?.status !== "SCHEDULED" ||
      cohort.sourceInvalidated ||
      !(await sourceIsCurrent(tx, cohort.plan))
    )
      return null;
    const calendarDay = resolvePlanningTimetableDay(cohort.date, await tx.schoolCalendarDay.findMany());
    if (isRegularTutoringPaused(cohort.date, await pauseRanges(tx)) || !calendarDay.isSchoolDay) {
      const affirmative = await affirmativePauseParticipants(tx, cohort.plan, cohort);
      const scheduled = cohort.plan.participants.filter((person) => person.cohortId === cohort.id && person.status === "SCHEDULED");
      if (!scheduled.length || scheduled.some((person) => !affirmative.has(person.tuteeId))) return null;
    }
    // Delivery uses the reviewed executor while original assignment identifiers
    // continue to identify publication and legacy reminder receipts.
    const execution = await tx.sessionPlanExecution.findUnique({ where: { planId: cohort.planId } });
    const evidence = { tutorId: cohort.plan.tutorId, tuteeIds: cohort.plan.participants.map((row) => row.tuteeId) };
    if (!execution) return { ...cohort, evidence };
    const mappings = await tx.sessionParticipantExecution.findMany({ where: { participantId: { in: cohort.plan.participants.map((row) => row.id) } } });
    const studentIds = new Map(cohort.plan.participants.map((row) => [row.tuteeId, mappings.find((mapping) => mapping.participantId === row.id)?.tuteeId ?? row.tuteeId]));
    const [tutor, students] = await Promise.all([
      tx.tutor.findUniqueOrThrow({ where: { id: execution.tutorId }, include: { user: true } }),
      tx.tutee.findMany({ where: { id: { in: [...studentIds.values()] } } }),
    ]);
    return { ...cohort, evidence, plan: { ...cohort.plan, tutorId: tutor.id, tutor,
      participants: cohort.plan.participants.map((row) => ({ ...row, tuteeId: studentIds.get(row.tuteeId)!, tutee: students.find((student) => student.id === studentIds.get(row.tuteeId)) ?? row.tutee })),
      assignments: cohort.plan.assignments.map((row) => ({ ...row, tuteeIds: ids(row.tuteeIds).map((id) => studentIds.get(id) ?? id) })),
      continuationMembers: cohort.plan.continuationMembers.map((row) => ({ ...row, tuteeId: studentIds.get(row.tuteeId) ?? row.tuteeId })),
    } };
  });
}

/** One source snapshot per invalidation pass, read only after every source fence.
 * Planning, period and source locks remain held until the caller commits; cohort
 * state is deliberately not reused here. Isolated mutation checks stay fresh.
 */
async function loadSourceEvidence(tx: TransactionDb, plans: Plan[]) {
  await lockPlanningSources(
    tx,
    plans.map((plan) => ({
      tutorId: plan.tutorId,
      tuteeIds: plan.participants.map((person) => person.tuteeId),
      pairingIds: plan.assignments.map((row) => row.pairingId),
    })),
  );
  const freshPlans: Plan[] = [];
  for (let offset = 0; offset < plans.length; offset += 500) {
    freshPlans.push(
      ...(await tx.sessionPlan.findMany({
        where: {
          id: { in: plans.slice(offset, offset + 500).map((plan) => plan.id) },
        },
        include: planInclude,
      })),
    );
  }
  const pairingIds = [
    ...new Set(
      freshPlans.flatMap((plan) =>
        plan.assignments.map((row) => row.pairingId),
      ),
    ),
  ];
  const accountIds = [
    ...new Set(
      freshPlans.flatMap((plan) =>
        plan.tutor.user ? [plan.tutor.user.id] : [],
      ),
    ),
  ];
  const departed = new Set<string>();
  for (let offset = 0; offset < accountIds.length; offset += 500) {
    for (const row of await tx.schoolDeparture.findMany({
      where: { userId: { in: accountIds.slice(offset, offset + 500) } },
      select: { userId: true, reason: true },
    }))
      if (row.reason) departed.add(row.userId);
  }
  const pairings: Prisma.PairingGetPayload<{
    include: typeof sourcePairingInclude;
  }>[] = [];
  const continuations: {
    targetPairingId: string | null;
    tuteeId: string;
    assignedAt: Date | null;
  }[] = [];
  const oldest = freshPlans.length
    ? new Date(
        freshPlans.reduce(
          (minimum, plan) => Math.min(minimum, plan.createdAt.getTime()),
          Infinity,
        ),
      )
    : null;
  for (let offset = 0; offset < pairingIds.length; offset += 500) {
    const batch = pairingIds.slice(offset, offset + 500);
    pairings.push(
      ...(await tx.pairing.findMany({
        where: { id: { in: batch } },
        include: sourcePairingInclude,
        orderBy: { id: "asc" },
      })),
    );
    if (oldest)
      continuations.push(
        ...(await tx.studentContinuationAssignment.findMany({
          where: {
            targetPairingId: { in: batch },
            status: "ASSIGNED",
            assignedAt: { gt: oldest },
          },
          select: { targetPairingId: true, tuteeId: true, assignedAt: true },
        })),
      );
  }
  return {
    plans: new Map(freshPlans.map((plan) => [plan.id, plan])),
    executions: new Map((await tx.sessionPlanExecution.findMany({ where: { planId: { in: freshPlans.map((plan) => plan.id) } } })).map((row) => [row.planId, row])),
    departed,
    pairings,
    continuations,
  };
}
type SourceEvidence = Awaited<ReturnType<typeof loadSourceEvidence>>;

/** Compare assignment evidence, not mutable personal names or inbox addresses. */
async function sourceIsCurrent(
  tx: TransactionDb,
  plan: Plan,
  allowEndedTerm = false,
  evidence?: SourceEvidence,
) {
  if (evidence) {
    const fresh = evidence.plans.get(plan.id);
    if (!fresh) return false;
    plan = fresh;
  }
  // A reviewed execution successor has its own exact roster/ownership check.
  // Batch absence is authoritative within this fenced snapshot: no per-plan query.
  const transferred = await transferredPlanIsCurrent(tx, plan, allowEndedTerm, undefined, evidence ? evidence.executions.get(plan.id) ?? null : undefined);
  if (transferred !== null) return transferred;
  if (!evidence) {
    const tuteeIds = plan.participants.map((person) => person.tuteeId).sort();
    const pairingIds = plan.assignments.map((row) => row.pairingId).sort();
    const owners = await tx.studentProfileOwnership.findMany({
      where: { tuteeId: { in: tuteeIds } },
      select: { userId: true },
    });
    const linked = await tx.user.findMany({
      where: {
        OR: [{ tutorId: plan.tutorId }, { studentId: { in: tuteeIds } }],
      },
      select: { id: true },
    });
    const userIds = [
      ...new Set([
        ...owners.map((row) => row.userId),
        ...linked.map((row) => row.id),
      ]),
    ].sort();
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=ANY(${userIds}::text[]) ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id=${plan.tutorId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id=ANY(${tuteeIds}::text[]) ORDER BY id FOR SHARE`;
    // Parent UPDATE locks also fence insertion of new roster joins through their FK;
    // join-row SHARE locks fence removals. Re-read after waiting for either writer.
    await tx.$queryRaw`SELECT id FROM "Pairing" WHERE id=ANY(${pairingIds}::text[]) ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT "pairingId","tuteeId" FROM "PairingTutee" WHERE "pairingId"=ANY(${pairingIds}::text[]) ORDER BY "pairingId","tuteeId" FOR SHARE`;
    plan = await tx.sessionPlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: planInclude,
    });
  }
  if (
    (!plan.term.active && !allowEndedTerm) ||
    plan.tutor.status !== "ACTIVE" ||
    !plan.tutor.user ||
    plan.tutor.user.role === "VIEWER" ||
    plan.tutor.user.suspendedAt ||
    plan.tutor.user.tutorAccessRevoked ||
    plan.tutor.user.mergedIntoId
  )
    return false;
  if (
    evidence
      ? evidence.departed.has(plan.tutor.user.id)
      : Boolean(
          (
            await tx.schoolDeparture.findUnique({
              where: { userId: plan.tutor.user.id },
            })
          )?.reason,
        )
  )
    return false;
  // Ended, published lessons retain their captured roster instead of using today's enrollment.
  if (!plan.term.active && allowEndedTerm) return true;
  return assignmentSourceMatches(tx, plan, undefined, evidence);
}

/** Consent deltas preserve a publication; an unrelated roster edit starts a new
 * publication revision. Account availability does not itself mint revisions. */
async function assignmentSourceMatches(
  tx: TransactionDb,
  plan: Plan,
  addition?: { pairingId: string; tuteeId: string },
  evidence?: SourceEvidence,
) {
  const transferred = await transferredPlanIsCurrent(tx, plan, false, addition, evidence ? evidence.executions.get(plan.id) ?? null : undefined);
  if (transferred !== null) return transferred;
  const pairingIds = plan.assignments.map((row) => row.pairingId);
  const rows = evidence
    ? evidence.pairings.filter((row) => pairingIds.includes(row.id))
    : await tx.pairing.findMany({
        where: { id: { in: plan.assignments.map((row) => row.pairingId) } },
        include: sourcePairingInclude,
        orderBy: { id: "asc" },
      });
  const laterContinuations = evidence
    ? evidence.continuations.filter(
        (row) =>
          row.targetPairingId !== null &&
          pairingIds.includes(row.targetPairingId) &&
          row.assignedAt !== null &&
          row.assignedAt > plan.createdAt,
      )
    : await tx.studentContinuationAssignment.findMany({
        where: {
          targetPairingId: { in: pairingIds },
          status: "ASSIGNED",
          assignedAt: { gt: plan.createdAt },
        },
        select: { targetPairingId: true, tuteeId: true },
      });
  return (
    rows.length === plan.assignments.length &&
    rows.every((row) => {
      const before = plan.assignments.find(
        (item) => item.pairingId === row.id,
      )!;
      const released = new Set(
        plan.continuationMembers
          .filter(
            (member) =>
              member.pairingId === row.id && member.releasedAt !== null,
          )
          .map((member) => member.tuteeId),
      );
      const expected = [
        ...new Set([
          ...assignmentRoster(plan, before).filter((id) => !released.has(id)),
          ...laterContinuations
            .filter((member) => member.targetPairingId === row.id)
            .map((member) => member.tuteeId),
          ...(addition?.pairingId === row.id ? [addition.tuteeId] : []),
        ]),
      ].sort();
      return (
        row.tutorId === plan.tutorId &&
        row.termId === plan.termId &&
        row.subject === before.subject &&
        JSON.stringify(row.tutees.map((item) => item.tuteeId).sort()) ===
          JSON.stringify(expected)
      );
    })
  );
}

async function ensureWritable(
  tx: TransactionDb,
  cohort: Awaited<ReturnType<typeof loadCohort>>,
  version: number,
  now: Date,
) {
  if (cohort.version !== version)
    fail("The session changed. Reload before continuing.", "CONFLICT");
  const pausedSource = cohort.plan.participants.some((person) =>
    person.cohortId === cohort.id && person.tutoringPauseSuppressed) &&
    isRegularTutoringPaused(cohort.date, await pauseRanges(tx));
  if ((cohort.status !== "SCHEDULED" && !pausedSource) || cohort.startsAt <= now)
    fail(
      "This session has started or is no longer available for scheduling.",
      "CONFLICT",
    );
  if (!(await sourceIsCurrent(tx, cohort.plan)))
    fail("The assignment or roster changed. Reload the session.", "CONFLICT");
}

async function recipients(
  tx: TransactionDb,
  plan: RecipientPlan,
  participantIds: string[],
  strict = true,
) {
  const executorId = plan.id ? await executionPlanTutorId(tx, plan.id, plan.tutorId) : await executionParticipantId(tx, "TUTOR", plan.tutorId);
  const tutor = executorId === plan.tutorId ? plan.tutor.user : (await tx.tutor.findUnique({ where: { id: executorId }, include: { user: true } }))?.user;
  if (!tutor?.email && strict)
    fail("The tutor needs a linked account and mailbox.");
  const result: {
    actorKey: string;
    user: NonNullable<typeof tutor>;
  }[] = tutor?.email
    ? [
        {
          actorKey: `tutor:${plan.tutorId}`,
          user: tutor,
        },
      ]
    : [];
  if (!strict) {
    const canonical = new Map(await Promise.all(participantIds.map(async (sourceId) => [sourceId, await executionParticipantId(tx, "TUTEE", sourceId)] as const)));
    const owners = await notificationTuteeRecipients(tx, [...canonical.values()]);
    for (const sourceId of participantIds) {
      const user = owners.find((row) => row.tuteeId === canonical.get(sourceId))?.user;
      if (user) result.push({ actorKey: `tutee:${sourceId}`, user });
    }
    return result;
  }
  for (const tuteeId of participantIds) {
    const user = await studentOwner(tx, tuteeId);
    result.push({
      actorKey: `tutee:${tuteeId}`,
      user,
    });
  }
  return result;
}

async function notice(
  tx: TransactionDb,
  request: Request,
  event: string,
  offerId?: string,
) {
  const offer = request.offers.find(
    (row) => row.id === (offerId ?? request.currentOfferId),
  );
  const initial = await tx.sessionNotice.findFirst({
    where: { requestId: request.id, event: "proposed" },
    orderBy: { createdAt: "asc" },
    select: { context: true },
  });
  const context = initial?.context;
  const original =
    context &&
    typeof context === "object" &&
    !Array.isArray(context) &&
    typeof context.originalStartsAt === "string"
      ? context.originalStartsAt
      : ((
          await tx.sessionPlanCohort.findUnique({
            where: { id: request.cohortId },
            select: { startsAt: true },
          })
        )?.startsAt.toISOString() ?? null);
  const room = offer?.roomId
    ? await tx.room.findUnique({
        where: { id: offer.roomId },
        select: { name: true },
      })
    : null;
  const requiresExplicitAcceptance = !!offer && await offerRequiresExplicitAgreement(tx, offer);
  for (const recipient of await recipients(
    tx,
    request.plan,
    ids(request.participantIds),
    false,
  )) {
    const response = offer?.responses.find(
      (row) => row.actorKey === recipient.actorKey && row.state === "PENDING",
    );
    const actionable =
      ["proposed", "countered"].includes(event) &&
      request.status === "PENDING" &&
      Boolean(response) &&
      request.currentOfferId === offer?.id;
    await tx.sessionNotice.upsert({
      where: {
        dedupeKey: `${request.id}:${request.version}:${event}:${recipient.actorKey}`,
      },
      update: {},
      create: {
        dedupeKey: `${request.id}:${request.version}:${event}:${recipient.actorKey}`,
        requestId: request.id,
        offerId: offer?.id,
        responseId: actionable ? response?.id : null,
        recipientUserId: recipient.user.id,
        recipientEmail: recipient.user.email,
        event,
        context: {
          isActionable: actionable,
          ...(requiresExplicitAcceptance ? { requiresExplicitAcceptance: true } : {}),
          startsAt: offer?.startsAt.toISOString() ?? null,
          endsAt: offer?.endsAt.toISOString() ?? null,
          originalStartsAt: original,
          subjectLabel: [
            ...new Set(request.plan.assignments.map((row) => row.subject)),
          ]
            .join(" / ")
            .slice(0, 200),
          roomLabel: room?.name.slice(0, 120) ?? null,
          online: offer?.online ?? false,
          timeZone: request.plan.timeZone,
          stage: ["A", "B", "C"][request.stage - 1] ?? "GROUP",
          scope: request.scope,
          kind: request.kind,
          ...(event === "deadline_missed"
            ? { outcomeReason: "MISSED_AUTOMATIC_RESPONSE_WINDOW" }
            : {}),
        },
      },
    });
  }
}

async function reloadRequest(tx: TransactionDb, id: string) {
  const request = await tx.sessionPlanningRequest.findUnique({
    where: { id },
    include: requestInclude,
  });
  if (!request) fail("Scheduling request not found.", "NOT_FOUND");
  return request;
}

async function validateTarget(
  tx: TransactionDb,
  plan: ValidationPlan,
  time: PlanningTime,
  participantIds: string[],
  source: Cohort,
  scope: string,
  excludeRequestId?: string,
  now = new Date(),
  computation?: PlanningComputation,
  sharingSource = false,
  publication?: PublicationValidationSnapshot,
  previewKind?: "RESCHEDULE" | "EXTRA",
) {
  let window: ReturnType<typeof plannedWindow>;
  try {
    window = plannedWindow(time, plan.timeZone, computation?.parseDateTime);
  } catch {
    return fail("Choose a valid 45-minute time in the program timezone.");
  }
  if (window.startsAt <= now)
    fail("The proposed lesson must start in the future.");
  if (
    (plan.term.startDate &&
      time.date < programDateKey(plan.term.startDate, plan.timeZone)) ||
    (plan.term.endDate &&
      time.date > programDateKey(plan.term.endDate, plan.timeZone))
  )
    fail("Choose a date within this program period.");
  if (
    window.roomId &&
    !(publication
      ? publication.roomExists
      : await tx.room.findUnique({ where: { id: window.roomId } }))
  )
    fail("That room no longer exists.");
  const currentRequest = excludeRequestId
    ? await tx.sessionPlanningRequest.findUnique({
        where: { id: excludeRequestId },
      })
    : null;
  // Only children of one explicit split-extra request share an extra root. An
  // ordinary sibling cohort is never spare capacity for a new extra lesson.
  const sharedExtra =
    currentRequest?.kind === "EXTRA" && currentRequest.parentRequestId
      ? await tx.sessionPlan.findUnique({
          where: { generationKey: `extra:${currentRequest.parentRequestId}` },
          select: { id: true },
        })
      : null;
  const reusablePlanId =
    (currentRequest?.kind ?? previewKind) === "EXTRA"
      ? sharedExtra?.id
      : plan.id;
  // Only initial publication supplies a snapshot: its new cohort UUID has not
  // been inserted, so it cannot already own participants or a pending request.
  const sourceRoster = publication
    ? []
    : await tx.sessionPlanParticipant.findMany({
        where: { cohortId: source.id, status: "SCHEDULED" },
        select: { tuteeId: true },
      });
  const mayReleaseSource =
    (currentRequest?.kind ?? previewKind) !== "EXTRA" &&
    // ALL captures its request's original audience. A later continuation can
    // leave someone at the source, so only actual roster coverage vacates it.
    // Initial publication validates a synthetic source without participants.
    (sourceRoster.length
      ? sourceRoster.every((person) => participantIds.includes(person.tuteeId))
      : scope === "ALL");
  // Enrollment/default reconciliation can share the unchanged physical lesson
  // without acquiring a request's authority to vacate its existing roster.
  const mayShareSource =
    sharingSource &&
    source.startsAt.getTime() === window.startsAt.getTime() &&
    source.endsAt.getTime() === window.endsAt.getTime() &&
    source.roomId === window.roomId &&
    source.online === window.online;
  const cohorts =
    publication?.cohorts ??
    (await readOverlappingCohorts(tx, window.startsAt, window.endsAt));
  const holds =
    publication?.holds ??
    (await readOverlappingHolds(
      tx,
      window.startsAt,
      window.endsAt,
      excludeRequestId,
    ));
  // Retain the authoritative calendar read here; publication's earlier snapshot
  // is only reused for enumeration and reconciliation calculations.
  const timetable =
    publication?.timetable ??
    resolvePlanningTimetableDay(
      time.date,
      await tx.schoolCalendarDay.findMany(),
    );
  const weekday = new Date(`${time.date}T00:00:00Z`).getUTCDay() || 7;
  const recurring = isRegularTutoringPaused(time.date, computation?.tutoringPauses ?? await pauseRanges(tx)) ? [] :
    publication?.recurring ??
    (!timetable.isSchoolDay
      ? []
      : await tx.pairing.findMany({
          where: {
            id: { notIn: await supersededPairingIds(tx) },
            termId: plan.termId,
            scheduleConfirmed: true,
            dayOfWeek: timetable.effectiveTimetableWeekday ?? weekday,
            startMin: { lt: window.endMin },
          },
          include: { tutees: { select: { tuteeId: true } } },
        }));
  const execution = publication ? null : await tx.sessionPlanExecution.findUnique({ where: { planId: plan.id } });
  const originalPeople = execution ? await tx.sessionPlanParticipant.findMany({ where: { planId: plan.id, tuteeId: { in: participantIds } }, select: { id: true, tuteeId: true } }) : [];
  const peopleExecution = execution ? await tx.sessionParticipantExecution.findMany({ where: { participantId: { in: originalPeople.map((row) => row.id) } } }) : [];
  const actorTutorId = execution?.tutorId ?? plan.tutorId;
  const actorStudentIds = participantIds.map((id) => peopleExecution.find((mapping) => originalPeople.some((person) => person.id === mapping.participantId && person.tuteeId === id))?.tuteeId ?? id);
  const actorPairingIds = execution ? executionAssignments.parse(execution.assignments).map((row) => row.targetPairingId) : plan.assignments.map((row) => row.pairingId);
  const keys =
    publication?.keys ??
    (await participantKeys(
      tx,
      [
        ...new Set([
          actorTutorId,
          ...cohorts.map((row) => row.plan.tutorId),
          ...holds.map((row) => row.plan.tutorId),
          ...recurring.map((row) => row.tutorId),
        ]),
      ],
      [
        ...new Set([
          ...actorStudentIds,
          ...cohorts.flatMap((row) =>
            row.participants.map((person) => person.tuteeId),
          ),
          ...holds.flatMap((row) => ids(row.participantIds)),
          ...recurring.flatMap((row) =>
            row.tutees.map((person) => person.tuteeId),
          ),
        ]),
      ],
    ));
  // Reuse this operation's current execution party, not its immutable original
  // evidence actors, when comparing all freshly read commitments.
  const participantsOverlap = createParticipantOverlapChecker(
    keys,
    actorTutorId,
    actorStudentIds,
  );
  for (const cohort of cohorts) {
    if (
      !cohort.participants.length ||
      (cohort.id === source.id && (mayReleaseSource || mayShareSource))
    )
      continue;
    if (
      cohort.planId === reusablePlanId &&
      cohort.id !== source.id &&
      cohort.startsAt.getTime() === window.startsAt.getTime() &&
      cohort.endsAt.getTime() === window.endsAt.getTime() &&
      cohort.roomId === window.roomId &&
      cohort.online === window.online
    )
      continue;
    if (
      (window.roomId && cohort.roomId === window.roomId) ||
      participantsOverlap(
        cohort.plan.tutorId,
        cohort.participants.map((row) => row.tuteeId),
      )
    )
      fail(
        "That time conflicts with another tutor, learner or room commitment.",
        "CONFLICT",
      );
  }
  // An original booking remains real when only part of its cohort may move.
  if (
    !mayReleaseSource &&
    !mayShareSource &&
    source.status === "SCHEDULED" &&
    sourceRoster.length > 0 &&
    source.startsAt < window.endsAt &&
    source.endsAt > window.startsAt
  )
    fail(
      "The tutor still needs the original session window. Choose a nonoverlapping time.",
      "CONFLICT",
    );
  for (const hold of holds) {
    const offer = hold.offers.find((row) => row.id === hold.currentOfferId);
    if (
      currentRequest?.parentRequestId &&
      currentRequest.parentRequestId === hold.parentRequestId &&
      currentRequest.kind === hold.kind &&
      offer?.startsAt.getTime() === window.startsAt.getTime() &&
      offer.endsAt.getTime() === window.endsAt.getTime() &&
      offer.roomId === window.roomId &&
      offer.online === window.online
    )
      continue;
    if (
      offer?.startsAt &&
      offer.startsAt < window.endsAt &&
      offer.endsAt > window.startsAt &&
      ((window.roomId && offer.roomId === window.roomId) ||
        participantsOverlap(
          hold.plan.tutorId,
          ids(hold.participantIds),
        ))
    )
      fail(
        "That time is held by another pending scheduling request.",
        "CONFLICT",
      );
  }
  if (
    window.roomId &&
    (publication
      ? publication.roomBlocked
      : await tx.roomUnavailability.findFirst({
          where: {
            roomId: window.roomId,
            dayOfWeek: weekday,
            startMin: { lt: window.endMin },
            endMin: { gt: window.startMin },
          },
        }))
  )
    fail("That room is blocked during this time.", "CONFLICT");
  const recurringCandidates = recurring.filter((pairing) => {
    if (pairing.startMin + 45 <= window.startMin) return false;
    const own =
      actorPairingIds.includes(pairing.id) &&
      time.date === plan.originalDate;
    return !(own && (mayReleaseSource || mayShareSource));
  });
  // Keep all regular exceptions, including cancellations/moves. Bound SQL parameters
  // without one round trip per recurring candidate; the scheduling fence is still held.
  const materialized = publication?.materialized ?? new Set<string>();
  for (
    let offset = 0;
    !publication && offset < recurringCandidates.length;
    offset += 500
  ) {
    const assignments = await tx.sessionPlanAssignment.findMany({
      where: {
        pairingId: {
          in: await pairingEvidenceIds(tx, recurringCandidates.slice(offset, offset + 500).map((row) => row.id)),
        },
        plan: { originalDate: time.date, kind: "REGULAR" },
      },
      select: { pairingId: true },
    });
    for (const assignment of assignments)
      materialized.add(await executionPairingId(tx, assignment.pairingId));
  }
  // Unmaterialized recurrence must participate too; a dated exception replaces its own default.
  for (const pairing of recurringCandidates) {
    if (materialized.has(pairing.id)) continue;
    if (
      (window.roomId && pairing.roomId === window.roomId) ||
      participantsOverlap(
        pairing.tutorId,
        pairing.tutees.map((row) => row.tuteeId),
      )
    )
      fail("That time conflicts with a recurring assignment.", "CONFLICT");
  }
  return window;
}

async function notifyPlanChange(
  tx: TransactionDb,
  plan: NoticePlan,
  cohort: Cohort,
  event: string,
  originalStartsAt = cohort.startsAt,
  affectedTuteeIds?: readonly string[],
) {
  const audience = await recipients(
    tx,
    plan,
    plan.participants
      .filter(
        (person) =>
          person.cohortId === cohort.id &&
          (!affectedTuteeIds || affectedTuteeIds.includes(person.tuteeId)),
      )
      .map((person) => person.tuteeId),
    false,
  );
  const room = cohort.roomId
    ? await tx.room.findUnique({
        where: { id: cohort.roomId },
        select: { name: true },
      })
    : null;
  await insertSessionNotices(
    tx,
    audience.map((person) => ({
      dedupeKey: `cohort:${cohort.id}:${cohort.version}:${event}:${person.actorKey}`,
      recipientUserId: person.user.id,
      recipientEmail: person.user.email,
      event,
      context: {
        isActionable: false,
        startsAt: cohort.startsAt.toISOString(),
        endsAt: cohort.endsAt.toISOString(),
        timeZone: plan.timeZone,
        originalStartsAt: originalStartsAt.toISOString(),
        subjectLabel: [...new Set(plan.assignments.map((row) => row.subject))]
          .join(" / ")
          .slice(0, 200),
        roomLabel: room?.name.slice(0, 120) ?? null,
        online: cohort.online,
      },
    })),
  );
}

const affirmativeAcceptance = new Set(["AUTHOR", "MATCHED", "EXPLICIT"]);

async function affirmativeResponseProvenance(
  tx: TransactionDb,
  request: Request,
  offer: Request["offers"][number],
  response: Request["offers"][number]["responses"][number],
  depth = 0,
): Promise<boolean> {
  if (response.state !== "ACCEPTED" || !affirmativeAcceptance.has(response.acceptedBy ?? "") || depth > 8) return false;
  if (response.acceptedBy !== "MATCHED" || !request.parentRequestId) return true;
  // Older splits labelled carried TIMEOUT consent MATCHED. Verify the exact
  // parent offer instead of trusting that lossy historical label.
  const parent = await reloadRequest(tx, request.parentRequestId);
  const prior = parent.offers.find((row) => row.id === parent.currentOfferId);
  if (prior?.date !== offer.date || prior.startMin !== offer.startMin || prior.endMin !== offer.endMin ||
      prior.roomId !== offer.roomId || prior.online !== offer.online ||
      prior.startsAt.getTime() !== offer.startsAt.getTime() || prior.endsAt.getTime() !== offer.endsAt.getTime()) return false;
  const evidence = prior.responses.find((row) => row.actorKey === response.actorKey);
  return !!evidence && affirmativeResponseProvenance(tx, parent, prior, evidence, depth + 1);
}

/** Only an exact accepted offer by the current tutor and learner authorizes a
 * paused-date exception. Flags and historical timeout acceptance are not consent. */
async function affirmativePauseParticipants(tx: TransactionDb, plan: Plan, cohort: Cohort) {
  const extraRoot = plan.kind === "EXTRA" && plan.generationKey.startsWith("extra:")
    ? plan.generationKey.slice(6) : null;
  const requests = await tx.sessionPlanningRequest.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ planId: plan.id }, ...(extraRoot ? [{ id: extraRoot }, { parentRequestId: extraRoot }] : [])],
    },
    include: requestInclude,
  });
  const result = new Set<string>();
  for (const request of requests) {
    const offer = request.offers.find((row) => row.id === request.currentOfferId);
    if (offer?.date !== cohort.date || offer.startMin !== cohort.startMin ||
        offer.endMin !== cohort.endMin || offer.roomId !== cohort.roomId || offer.online !== cohort.online ||
        offer.startsAt.getTime() !== cohort.startsAt.getTime() || offer.endsAt.getTime() !== cohort.endsAt.getTime()) continue;
    const owners = await executionResponseOwnerIds(tx, offer.responses.map((row) => row.id));
    const affirmative = new Set<string>();
    for (const response of offer.responses)
      if (await affirmativeResponseProvenance(tx, request, offer, response)) affirmative.add(response.id);
    for (const tuteeId of ids(request.participantIds)) {
      if (!plan.participants.some((person) => person.tuteeId === tuteeId && person.cohortId === cohort.id)) continue;
      try {
        const audience = await recipients(tx, request.plan, [tuteeId]);
        if (audience.length >= 2 && audience.every((actor) => offer.responses.some((response) =>
          response.actorKey === actor.actorKey &&
          (owners.get(response.id) ?? response.actorUserId) === actor.user.id &&
          affirmative.has(response.id)))) result.add(tuteeId);
      } catch {
        // Missing/currently ineligible owners require a fresh agreement.
      }
    }
  }
  return result;
}

async function pauseRanges(tx: TransactionDb) {
  return tx.programCalendarDay.findMany({ where: { active: true, schedulingEffect: "PAUSE_REGULAR" } });
}

async function offerRequiresExplicitAgreement(tx: TransactionDb, offer: { id: string; date: string }) {
  if (isRegularTutoringPaused(offer.date, await pauseRanges(tx))) return true;
  // Once transport may have delivered explicit-only terms, every completion
  // and decision for that exact offer must honor them, even after policy reset.
  return !!(await tx.sessionNotice.count({ where: { offerId: offer.id, attemptStartedAt: { not: null },
    context: { path: ["requiresExplicitAcceptance"], equals: true },
  } }));
}

/** Policy changes reconcile every future publication, including moved/extra
 * cohorts outside the visible two-week window. Separate tombstones preserve
 * user cancellations and school-calendar suppression across overlapping resets. */
async function reconcileTutoringPauses(tx: TransactionDb, ranges: readonly TutoringPauseRange[], now: Date) {
  const rows = await tx.sessionPlanCohort.findMany({
    where: { startsAt: { gt: now }, status: { in: ["SCHEDULED", "CANCELLED"] }, sessions: { none: {} },
      OR: [...ranges.map((range) => ({ date: { gte: range.date, lte: range.endDate } })),
        { participants: { some: { tutoringPauseSuppressed: true } } }],
    },
    include: { plan: { include: planInclude } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  if (!rows.length && !ranges.length) return;
  const calendar = createSchoolCalendarSnapshot(await tx.schoolCalendarDay.findMany());
  for (const cohort of rows) {
    const plan = cohort.plan;
    const people = plan.participants.filter((person) => person.cohortId === cohort.id &&
      (person.status === "SCHEDULED" || person.tutoringPauseSuppressed || person.calendarSuppressed));
    if (!people.length || !(await sourceIsCurrent(tx, plan))) continue;
    const paused = isRegularTutoringPaused(cohort.date, ranges);
    const affirmative = paused ? await affirmativePauseParticipants(tx, plan, cohort) : new Set<string>();
    const suppress = people.filter((person) => paused && !affirmative.has(person.tuteeId) && !person.tutoringPauseSuppressed);
    const restore = people.filter((person) => person.tutoringPauseSuppressed && (!paused || affirmative.has(person.tuteeId)));
    if (!suppress.length && !restore.length) continue;
    const changedIds: string[] = [];
    if (suppress.length) {
      await tx.sessionPlanParticipant.updateMany({
        where: { id: { in: suppress.map((person) => person.id) } },
        data: { status: "CANCELLED", tutoringPauseSuppressed: true, version: { increment: 1 } },
      });
      changedIds.push(...suppress.map((person) => person.tuteeId));
    }
    for (const person of restore) {
      if (!paused && plan.kind === "REGULAR" && !person.scheduleOverride &&
          cohort.date === plan.originalDate && !cohort.rescheduled) {
        // The weekly clock may have changed during the pause. Hand ordinary
        // restoration to its owner, which safely splits/coalesces current clocks
        // around retained exceptions and retries conflicts on later dirty events.
        await tx.sessionPlanParticipant.update({ where: { id: person.id }, data: {
          tutoringPauseSuppressed: false, calendarSuppressed: true, status: "CANCELLED", version: { increment: 1 },
        } });
        continue;
      }
      const day = calendar.resolve(cohort.date);
      const primary = plan.assignments.find((assignment) => assignment.primary) ?? plan.assignments[0];
      const pairing = primary ? await tx.pairing.findUnique({ where: { id: await executionPairingId(tx, primary.pairingId) }, select: { dayOfWeek: true, scheduleConfirmed: true } }) : null;
      const calendarBlocked = plan.kind === "REGULAR" && !person.scheduleOverride
        ? !pairing?.scheduleConfirmed || !day.isSchoolDay || day.effectiveTimetableWeekday !== pairing.dayOfWeek
        : person.calendarSuppressed;
      let available = !calendarBlocked;
      if (available) {
        try {
          await validateTarget(tx, plan, cohort, [person.tuteeId], cohort, "ALL", undefined, now, undefined, true);
        } catch { available = false; }
      }
      // A conflict stays a reversible pause tombstone and retries when dirtied.
      if (!available && !calendarBlocked) continue;
      await tx.sessionPlanParticipant.update({
        where: { id: person.id },
        data: { status: available ? "SCHEDULED" : "CANCELLED", tutoringPauseSuppressed: false,
          calendarSuppressed: calendarBlocked, version: { increment: 1 } },
      });
      changedIds.push(person.tuteeId);
    }
    if (!changedIds.length) continue;
    const remaining = await tx.sessionPlanParticipant.count({ where: { cohortId: cohort.id, status: "SCHEDULED" } });
    const changed = await tx.sessionPlanCohort.update({
      where: { id: cohort.id }, data: { status: remaining ? "SCHEDULED" : "CANCELLED", version: { increment: 1 } },
    });
    const currentPlan = await tx.sessionPlan.findUniqueOrThrow({ where: { id: plan.id }, include: planInclude });
    await notifyPlanChange(tx, currentPlan, changed, remaining ? "schedule_updated" : "cancelled", cohort.startsAt, changedIds);
    await audit(tx, plan.id, "tutoringPauseUpdated", true);
  }
  // A newly added pause invalidates silence-based acceptance even when some
  // recipients previously timed out on the still-pending exact offer.
  const pending = await tx.sessionPlanningRequest.findMany({ where: { status: { in: ["PENDING", "SPLIT_REQUESTED"] } }, include: requestInclude });
  for (const request of pending) await settleRequest(tx, request, now);
}

export async function previewProgramCalendarImpact(
  db: DomainDb,
  input: { date: string; endDate: string; schedulingEffect?: string; remove?: boolean },
  now = new Date(),
) {
  return inTransaction(db, async (tx) => {
    const existing = await tx.programCalendarDay.findMany();
    const current = existing.find((row) => row.date === input.date);
    const next = existing.filter((row) => row.date !== input.date);
    if (!input.remove) next.push({ ...current, date: input.date, endDate: input.endDate,
      schedulingEffect: input.schedulingEffect ?? current?.schedulingEffect ?? "NOTICE", active: true } as typeof existing[number]);
    const start = current && current.date < input.date ? current.date : input.date;
    const end = current && current.endDate > input.endDate ? current.endDate : input.endDate;
    const cohorts = await tx.sessionPlanCohort.findMany({
      where: { date: { gte: start, lte: end }, startsAt: { gt: now }, sessions: { none: {} }, status: { in: ["SCHEDULED", "CANCELLED"] } },
      include: { plan: { include: planInclude } },
    });
    const counts = { scope: "publishedFutureParticipants" as const, pauseCount: 0, retainedExceptionCount: 0, confirmationCount: 0, restorationCount: 0 };
    const computation: PlanningComputation = {
      calendar: createSchoolCalendarSnapshot(await tx.schoolCalendarDay.findMany()),
      parseDateTime: createProgramDateTimeParser(), tutoringPauses: next,
    };
    for (const cohort of cohorts) {
      if (!(await sourceIsCurrent(tx, cohort.plan))) continue;
      const explicit = await affirmativePauseParticipants(tx, cohort.plan, cohort);
      for (const person of cohort.plan.participants.filter((row) => row.cohortId === cohort.id && (row.status === "SCHEDULED" || row.tutoringPauseSuppressed || row.calendarSuppressed))) {
        if (isRegularTutoringPaused(cohort.date, next)) {
          if (explicit.has(person.tuteeId)) counts.retainedExceptionCount++;
          else if (person.scheduleOverride || cohort.plan.kind === "EXTRA" || cohort.rescheduled) counts.confirmationCount++;
          else counts.pauseCount++;
        } else if (person.tutoringPauseSuppressed) {
          const day = computation.calendar.resolve(cohort.date);
          const primary = cohort.plan.assignments.find((assignment) => assignment.primary) ?? cohort.plan.assignments[0];
          const pairing = primary ? await tx.pairing.findUnique({ where: { id: await executionPairingId(tx, primary.pairingId) }, select: { scheduleConfirmed: true, dayOfWeek: true, startMin: true, roomId: true } }) : null;
          const ordinary = cohort.plan.kind === "REGULAR" && !person.scheduleOverride;
          const blocked = ordinary
            ? !pairing?.scheduleConfirmed || !day.isSchoolDay || day.effectiveTimetableWeekday !== pairing.dayOfWeek
            : person.calendarSuppressed;
          if (!blocked) try {
            const target = ordinary && pairing
              ? plannedWindow({ date: cohort.plan.originalDate, startMin: pairing.startMin, roomId: pairing.roomId, online: false }, cohort.plan.timeZone, computation.parseDateTime)
              : cohort;
            await validateTarget(tx, cohort.plan, target, [person.tuteeId], cohort, "ALL", undefined, now, computation, true);
            counts.restorationCount++;
          } catch { /* Conflicted restoration is not promised by the preview. */ }
        }
      }
    }
    return counts;
  });
}

async function reconcileOrdinaryPlans(
  tx: TransactionDb,
  prefix: string,
  schedule: { dayOfWeek: number; startMin: number; roomId: string | null },
  timeZone: string,
  computation: PlanningComputation,
  now: Date,
) {
  const { calendar, parseDateTime } = computation;
  const semanticPauses = tutoringPauseSemanticRanges(computation.tutoringPauses ?? []);
  const scheduleHash = fingerprint([
    schedule.dayOfWeek,
    schedule.startMin,
    schedule.roomId,
    timeZone,
    calendar.semanticDays(),
    // Keep the ordinary five-element publication identity byte-for-byte stable.
    ...(semanticPauses.length ? [semanticPauses] : []),
  ]);
  const candidateWhere: Prisma.SessionPlanWhereInput = {
    generationKey: { startsWith: prefix },
    kind: "REGULAR",
    OR: [
      { sourceScheduleFingerprint: { not: scheduleHash } },
      { cohorts: { some: { sourceInvalidated: true } } },
      { participants: { some: { calendarSuppressed: true } } },
    ],
  };
  // Capture candidates under the planning fence before hydrating relations: an
  // empty include still issues relation queries. Source authority is re-read
  // below after its own locks, just as for the original reconciliation query.
  const candidates = await tx.sessionPlan.findMany({
    where: candidateWhere,
    select: { id: true },
  });
  if (!candidates.length) return scheduleHash;
  const plans: Plan[] = [];
  for (let offset = 0; offset < candidates.length; offset += 500)
    plans.push(
      ...(await tx.sessionPlan.findMany({
        where: {
          ...candidateWhere,
          id: {
            in: candidates.slice(offset, offset + 500).map((row) => row.id),
          },
        },
        include: planInclude,
      })),
    );
  for (const plan of plans) {
    if (!(await sourceIsCurrent(tx, plan))) {
      await invalidateSessionPlansForPairings(
        tx,
        plan.assignments.map((row) => row.pairingId),
        now,
      );
      continue;
    }
    const hasPending = Boolean(
      await tx.sessionPlanningRequest.count({
        where: {
          planId: plan.id,
          status: { in: ["PENDING", "SPLIT_REQUESTED"] },
        },
      }),
    );
    let deferred = false;
    const cohorts = await tx.sessionPlanCohort.findMany({
      where: {
        planId: plan.id,
        date: plan.originalDate,
        startsAt: { gt: now },
        status: { in: ["SCHEDULED", "CANCELLED"] },
      },
    });
    for (const original of cohorts) {
      const people = await tx.sessionPlanParticipant.findMany({
        where: { cohortId: original.id },
      });
      const ordinary = people.filter(
        (person) =>
          !person.scheduleOverride && !person.tutoringPauseSuppressed &&
          (person.status === "SCHEDULED" || person.calendarSuppressed),
      );
      const protectedPeople = people.filter(
        (person) => person.scheduleOverride && !person.tutoringPauseSuppressed && person.status === "SCHEDULED",
      );
      // Older automatic tombstones kept participant status SCHEDULED. Accepted
      // request evidence backfills each learner's override; revive only that
      // future agreement, never a user/lifecycle cancellation or past lesson.
      if (
        original.sourceInvalidated &&
        original.status === "CANCELLED" &&
        protectedPeople.length
      ) {
        try {
          await validateTarget(
            tx,
            plan,
            original,
            protectedPeople.map((person) => person.tuteeId),
            original,
            "ALL",
            undefined,
            now,
            computation,
          );
          // Legacy repair is deliberately conservative: an existing exact
          // sibling needs explicit coalescing, never a second physical event.
          if (
            await tx.sessionPlanCohort.findFirst({
              where: {
                planId: plan.id,
                id: { not: original.id },
                status: "SCHEDULED",
                startsAt: original.startsAt,
                endsAt: original.endsAt,
                roomId: original.roomId,
                online: original.online,
              },
              select: { id: true },
            })
          )
            fail(
              "An existing physical lesson requires review before restoring this commitment.",
              "CONFLICT",
            );
        } catch {
          // Keep the unavailable tombstone visible and retry after conflicts are
          // resolved; neither historical consent nor a reset overrides new work.
          deferred = true;
          continue;
        }
        await tx.sessionPlanParticipant.updateMany({
          where: { id: { in: protectedPeople.map((person) => person.id) } },
          data: { calendarSuppressed: false, version: { increment: 1 } },
        });
        const restored = await tx.sessionPlanCohort.update({
          where: { id: original.id },
          data: {
            status: "SCHEDULED",
            sourceInvalidated: false,
            version: { increment: 1 },
          },
        });
        const currentPlan = await tx.sessionPlan.findUniqueOrThrow({
          where: { id: plan.id },
          include: planInclude,
        });
        await notifyPlanChange(
          tx,
          currentPlan,
          restored,
          "schedule_updated",
          original.startsAt,
          protectedPeople.map((person) => person.tuteeId),
        );
      }
      if (!ordinary.length) continue;
      const ordinaryIds = ordinary.map((person) => person.id);
      const ordinaryTuteeIds = ordinary.map((person) => person.tuteeId);
      const day = calendar.resolve(plan.originalDate);
      const applies =
        day.isSchoolDay && day.effectiveTimetableWeekday === schedule.dayOfWeek &&
        !isRegularTutoringPaused(plan.originalDate, computation.tutoringPauses ?? []);
      if (
        hasPending &&
        applies &&
        !ordinary.some((person) => person.calendarSuppressed)
      ) {
        deferred = true;
        continue;
      }
      let window: ReturnType<typeof plannedWindow> | null = null;
      if (applies) {
        try {
          const target = plannedWindow(
            {
              date: plan.originalDate,
              startMin: schedule.startMin,
              roomId: schedule.roomId,
              online: false,
            },
            plan.timeZone,
            parseDateTime,
          );
          const samePhysicalWindow =
            original.startsAt.getTime() === target.startsAt.getTime() &&
            original.endsAt.getTime() === target.endsAt.getTime() &&
            original.roomId === target.roomId &&
            original.online === target.online;
          window = await validateTarget(
            tx,
            plan,
            target,
            ordinaryTuteeIds,
            original,
            protectedPeople.length && !samePhysicalWindow ? "ONE" : "ALL",
            undefined,
            now,
            computation,
            samePhysicalWindow,
          );
        } catch {
          /* Surface unavailable plans rather than double-book a dated exception. */
        }
      }
      const clockChanged = Boolean(
        window &&
        (original.startsAt.getTime() !== window.startsAt.getTime() ||
          original.endsAt.getTime() !== window.endsAt.getTime() ||
          original.startMin !== window.startMin ||
          original.roomId !== window.roomId ||
          original.online !== window.online),
      );
      const changed = !window
        ? ordinary.some(
            (person) =>
              person.status !== "CANCELLED" || !person.calendarSuppressed,
          )
        : original.status !== "SCHEDULED" ||
          clockChanged ||
          ordinary.some(
            (person) =>
              person.status !== "SCHEDULED" || person.calendarSuppressed,
          );
      if (!changed) continue;
      let cohort: Cohort;
      const shared =
        window
          ? await tx.sessionPlanCohort.findFirst({
              where: {
                planId: plan.id,
                date: window.date,
                startMin: window.startMin,
                endMin: window.endMin,
                roomId: window.roomId,
                online: window.online,
                status: "SCHEDULED",
                id: { not: original.id },
              },
            })
          : null;
      if (window && (shared || (clockChanged && protectedPeople.length))) {
        // A shared clock does not transfer one learner's explicit agreement to peers.
        // Restoration can rejoin an exact agreed sibling without changing the
        // weekly clock. Keep that lesson's UID and retire the emptied source.
        cohort = shared
          ? await tx.sessionPlanCohort.update({
              where: { id: shared.id },
              data: { version: { increment: 1 } },
            })
          : await tx.sessionPlanCohort.create({
              data: { planId: plan.id, ...window },
            });
        await tx.sessionPlanParticipant.updateMany({
          where: { id: { in: ordinaryIds } },
          data: {
            cohortId: cohort.id,
            status: "SCHEDULED",
            calendarSuppressed: false,
            version: { increment: 1 },
          },
        });
        await tx.sessionPlanCohort.update({
          where: { id: original.id },
          data: {
            status: protectedPeople.length ? "SCHEDULED" : "CANCELLED",
            sourceInvalidated: false,
            version: { increment: 1 },
          },
        });
      } else {
        cohort = await tx.sessionPlanCohort.update({
          where: { id: original.id },
          data: {
            ...(window ?? {}),
            status:
              window || protectedPeople.length ? "SCHEDULED" : "CANCELLED",
            sourceInvalidated: !window && !protectedPeople.length,
            version: { increment: 1 },
          },
        });
        await tx.sessionPlanParticipant.updateMany({
          where: { id: { in: ordinaryIds } },
          data: {
            status: window ? "SCHEDULED" : "CANCELLED",
            calendarSuppressed: !window,
            version: { increment: 1 },
          },
        });
      }
      const currentPlan = await tx.sessionPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: planInclude,
      });
      await notifyPlanChange(
        tx,
        currentPlan,
        cohort,
        window ? "schedule_updated" : "cancelled",
        original.startsAt,
        ordinaryTuteeIds,
      );
      await audit(tx, plan.id, "weeklyPlanUpdated", true);
    }
    if (!deferred)
      await tx.sessionPlan.update({
        where: { id: plan.id },
        data: { sourceScheduleFingerprint: scheduleHash },
      });
  }
  return scheduleHash;
}

/** Idempotent publication only inserts new dates; no weekly refresh rewrites an exception. */
export async function ensureSessionPlanningWindow(
  db: DomainDb,
  now = new Date(),
) {
  return inSchedulingMaintenanceTransaction(db, async (tx) => {
    await lockPlanningEntry(tx);
    const timeZone = await getProgramTimeZone(tx);
    const weeks = planningWeeks(now, timeZone);
    const maintenance = await readSchedulingMaintenance(tx, {
      ...weeks,
      timeZone,
    });
    if (maintenance.current)
      return {
        ...weeks,
        timeZone,
        unavailable: maintenance.unavailable,
        normalized: maintenance.normalized,
      };
    const affected = await tx.sessionPlanAssignment.findMany({
      where: {
        plan: {
          cohorts: {
            some: {
              startsAt: { gt: now },
              OR: [
                { status: "SCHEDULED" },
                { participants: { some: { OR: [{ calendarSuppressed: true }, { tutoringPauseSuppressed: true }] } } },
              ],
            },
          },
        },
      },
      select: { pairingId: true },
      distinct: ["pairingId"],
    });
    if (affected.length)
      await invalidateSessionPlansForPairings(
        tx,
        affected.map((row) => row.pairingId),
        now,
      );
    const rows = await tx.pairing.findMany({
      where: {
        id: { notIn: await supersededPairingIds(tx) },
        term: { active: true },
        scheduleConfirmed: true,
        tutor: { status: "ACTIVE" },
      },
      include: {
        group: { select: { primaryPairingId: true } },
        term: true,
        tutees: {
          where: { tutee: { status: { not: "INACTIVE" } } },
          select: { tuteeId: true },
        },
      },
      orderBy: { id: "asc" },
    });
    let unavailable = 0;
    let warmUnavailable = 0;
    let normalized = 0;
    const overrides = await tx.schoolCalendarDay.findMany();
    // Reuse immutable calculations within publication. Keep live conflict and
    // authority reads outside these caches, including the validation calendar.
    const computation: PlanningComputation = {
      calendar: createSchoolCalendarSnapshot(overrides),
      parseDateTime: createProgramDateTimeParser(),
      tutoringPauses: await pauseRanges(tx),
    };
    await reconcileTutoringPauses(tx, computation.tutoringPauses ?? [], now);
    const publicationNotices: PublicationNotice[] = [];
    const evidencePairingIds = await pairingEvidenceIds(tx, rows.map((row) => row.id));
    const continuationPairingIds = await readContinuationPairingIds(tx, evidencePairingIds);
    const successorRows = await tx.pairingExecutionSuccessor.findMany({ where: { sourcePairingId: { in: evidencePairingIds } } });
    for (;;) {
      const before = continuationPairingIds.size;
      for (const successor of successorRows) if (continuationPairingIds.has(successor.sourcePairingId)) continuationPairingIds.add(successor.targetPairingId);
      if (before === continuationPairingIds.size) break;
    }
    for (const entry of pairingEntries(rows)) {
      const primary = entry.primary;
      const currentPairingIds = entry.pairings.map((row) => row.id);
      const predecessors = (await pairingEvidenceIds(tx, currentPairingIds)).filter((id) => !currentPairingIds.includes(id));
      const inheritedDates = new Set(predecessors.length ? (await tx.sessionPlan.findMany({ where: { assignments: { some: { pairingId: { in: predecessors } } }, originalDate: { gte: weeks.start, lte: weeks.prepareEnd } }, select: { originalDate: true } })).map((row) => row.originalDate) : []);
      if (
        entry.groupStatus === "needsRepair" ||
        !primary.tutees.length ||
        primary.startMin > 1395
      ) {
        unavailable++;
        warmUnavailable++;
        continue;
      }
      if (primary.endMin - primary.startMin !== 45) normalized++;
      const prefix = `regular:${primary.termId}:${entry.id}:`;
      const scheduleHash = await reconcileOrdinaryPlans(
        tx,
        prefix,
        primary,
        timeZone,
        computation,
        now,
      );
      const rosterHash = fingerprint(
        entry.pairings.map((row) => [
          row.id,
          row.subject,
          row.tutees.map((item) => item.tuteeId).sort(),
        ]),
      );
      const candidates: { date: string; generationKey: string }[] = [];
      let termStart: string | undefined;
      let termEnd: string | undefined;
      const continuing = entry.pairings.every((pairing) =>
        continuationPairingIds.has(pairing.id),
      );
      const publications = continuing
        ? latestContinuationPublications(
            await tx.sessionPlan.findMany({
              where: { generationKey: { startsWith: prefix }, kind: "REGULAR" },
              include: planInclude,
            }),
          )
        : null;
      for (
        let date = weeks.start;
        date <= weeks.prepareEnd;
        date = addPlanningDays(date, 1)
      ) {
        // The original publication/event identity survives execution transfer,
        // including cancelled or moved commitments. Only later dates publish anew.
        if (inheritedDates.has(date)) continue;
        const day = computation.calendar.resolve(date);
        const pausedClosedSource = !day.isSchoolDay &&
          isRegularTutoringPaused(date, computation.tutoringPauses ?? []) &&
          (new Date(`${date}T00:00:00Z`).getUTCDay() || 7) === primary.dayOfWeek;
        if (
          !pausedClosedSource && (!day.isSchoolDay ||
          day.effectiveTimetableWeekday !== primary.dayOfWeek)
        )
          continue;
        if (
          (primary.term.startDate &&
            date <
              (termStart ??= programDateKey(
                primary.term.startDate,
                timeZone,
              ))) ||
          (primary.term.endDate &&
            date > (termEnd ??= programDateKey(primary.term.endDate, timeZone)))
        )
          continue;
        // Only explicit consent deltas retain the current publication. Manual
        // roster edits replace cancelled future plans with a new revision.
        const continuationKey = `${prefix}${date}:continuation`;
        const previous = publications?.get(continuationKey);
        if (previous && (await assignmentSourceMatches(tx, previous))) continue;
        const generationKey = continuing
          ? `${continuationKey}:${previous ? continuationPublication(previous)!.revision + 1 : 0}`
          : `${prefix}${date}:${rosterHash}`;
        candidates.push({ date, generationKey });
      }
      // At most 21 keys per entry. Cancelled/moved plans also suppress regeneration.
      const existing = new Set(
        candidates.length
          ? (
              await tx.sessionPlan.findMany({
                where: {
                  generationKey: {
                    in: candidates.map((row) => row.generationKey),
                  },
                },
                select: { generationKey: true },
              })
            ).map((row) => row.generationKey)
          : [],
      );
      for (const { date, generationKey } of candidates) {
        if (existing.has(generationKey)) continue;
        let window: ReturnType<typeof plannedWindow>;
        try {
          window = plannedWindow(
            {
              date,
              startMin: primary.startMin,
              roomId: primary.roomId,
              online: false,
            },
            timeZone,
            computation.parseDateTime,
          );
        } catch {
          unavailable++;
          warmUnavailable++;
          continue;
        }
        // Launch/catch-up never fabricates past appointments or duplicate old attendance.
        if (window.endsAt <= now) continue;
        const planId = randomUUID(),
          cohortId = randomUUID();
        const roster = [
          ...new Set(
            entry.pairings.flatMap((row) =>
              row.tutees.map((item) => item.tuteeId),
            ),
          ),
        ];
        // Both inserts keep database defaults and recovery triggers. No returned
        // plan row is needed: validation uses these immutable publication facts.
        await tx.sessionPlan.createMany({
          data: {
            id: planId,
            generationKey,
            tutorId: primary.tutorId,
            termId: primary.termId,
            originalDate: date,
            timeZone,
            sourceScheduleFingerprint: scheduleHash,
            sourceFingerprint: rosterHash,
          },
        });
        await tx.sessionPlanAssignment.createMany({
          data: entry.pairings.map((row, index) => ({
            planId,
            pairingId: row.id,
            subject: row.subject,
            tuteeIds: row.tutees.map((item) => item.tuteeId),
            primary: index === 0,
          })),
        });
        existing.add(generationKey);
        const tutoringPaused = isRegularTutoringPaused(date, computation.tutoringPauses ?? []);
        const schoolSuppressed = !computation.calendar.resolve(date).isSchoolDay;
        let available = !tutoringPaused;
        // Validation needs only immutable publication facts; don't hydrate the
        // complete plan/roster/account graph twice for each newly inserted date.
        const plan: ValidationPlan = {
          id: planId,
          tutorId: primary.tutorId,
          termId: primary.termId,
          originalDate: date,
          timeZone,
          term: primary.term,
          assignments: entry.pairings.map((row) => ({ pairingId: row.id })),
        };
        const candidate = {
          id: cohortId,
          planId,
          ...window,
          rescheduled: false,
          sourceInvalidated: false,
          status: "SCHEDULED",
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        try {
          // Read a fresh coherent context after this plan's assignment and all
          // preceding reservations. Never preinsert later candidate assignments:
          // their existence would hide unmaterialized recurring commitments.
          const publication = await readPublicationValidationSnapshot(tx, {
            tutorId: plan.tutorId,
            termId: plan.termId,
            originalDate: plan.originalDate,
            participantIds: roster,
            // A narrowing hint only: the statement rereads the calendar and
            // falls back to an unfiltered snapshot if the hint is no longer true.
            weekdayHint:
              computation.calendar.resolve(date).effectiveTimetableWeekday ?? 0,
            ...window,
          });
          if (!tutoringPaused) await validateTarget(
            tx,
            plan,
            window,
            roster,
            candidate,
            "ALL",
            undefined,
            now,
            computation,
            false,
            publication,
          );
        } catch {
          available = false;
          unavailable++;
        }
        const published = await tx.sessionPlanCohort.create({
          data: {
            id: cohortId,
            planId,
            ...window,
            status: available ? "SCHEDULED" : "CANCELLED",
            sourceInvalidated: !available && (!tutoringPaused || schoolSuppressed),
          },
        });
        await tx.sessionPlanParticipant.createMany({
          data: roster.map((tuteeId) => ({
            planId,
            tuteeId,
            cohortId,
            status: available ? "SCHEDULED" : "CANCELLED",
            calendarSuppressed: (!available && !tutoringPaused) || schoolSuppressed,
            tutoringPauseSuppressed: tutoringPaused,
          })),
        });
        publicationNotices.push(
          capturePublicationNotice({
            tutorId: primary.tutorId,
            timeZone,
            subjects: entry.pairings.map((row) => row.subject),
            tuteeIds: roster,
            cohort: published,
            event: available ? "schedule_updated" : "cancelled",
          }),
        );
      }
    }
    // Only non-actionable new-publication notices are deferred. Resolve current
    // contact destinations once at finalization; delivery rechecks admission.
    // Any failure still rolls back the complete publication transaction.
    await queuePublicationNotices(tx, publicationNotices);
    // Preserve the old next-call counters: a newly published cancellation is
    // counted on this call only; invalid unmaterialized groups/clocks recur.
    // Only pre-pass IDs are acknowledged. Our own dated writes remain dirty for
    // one further pass; concurrently committed or late-ID events cannot be lost.
    await acknowledgeSchedulingPublication(tx, {
      eventIds: maintenance.eventIds,
      stateRevision: maintenance.stateRevision,
      ...weeks,
      timeZone,
      unavailable: warmUnavailable,
      normalized,
    });
    return { ...weeks, timeZone, unavailable, normalized };
  });
}

async function makeOffer(
  tx: TransactionDb,
  requestId: string,
  authorKey: string,
  time: PlanningTime,
  now: Date,
  matchedKey?: string,
) {
  const request = await reloadRequest(tx, requestId);
  const source = await loadCohort(tx, request.cohortId);
  const people = ids(request.participantIds);
  const window = await validateTarget(
    tx,
    request.plan,
    time,
    people,
    source,
    request.scope,
    requestId,
    now,
  );
  const cutoffAt = new Date(
    Math.min(source.startsAt.getTime(), window.startsAt.getTime()),
  );
  const sequence = request.offers.length + 1;
  const offerId = randomUUID();
  const audience = await recipients(tx, request.plan, people);
  await tx.sessionPlanningOffer.create({
    data: {
      id: offerId,
      requestId,
      sequence,
      authorKey,
      ...window,
      cutoffAt,
      responses: {
        create: audience.map((recipient) => ({
          actorKey: recipient.actorKey,
          actorUserId: recipient.user.id,
          state:
            recipient.actorKey === authorKey ||
            recipient.actorKey === matchedKey
              ? "ACCEPTED"
              : "PENDING",
          acceptedBy:
            recipient.actorKey === authorKey
              ? "AUTHOR"
              : recipient.actorKey === matchedKey
                ? "MATCHED"
                : null,
          respondedAt:
            recipient.actorKey === authorKey ||
            recipient.actorKey === matchedKey
              ? now
              : null,
        })),
      },
    },
  });
  await tx.sessionPlanningRequest.update({
    where: { id: requestId },
    data: { currentOfferId: offerId, version: { increment: 1 } },
  });
  const current = await reloadRequest(tx, requestId);
  await notice(tx, current, sequence === 1 ? "proposed" : "countered");
  return current;
}

async function closeRequest(
  tx: TransactionDb,
  request: Request,
  status: string,
  event: string,
  now: Date,
) {
  await tx.sessionPlanningRequest.update({
    where: { id: request.id },
    data: { status, version: { increment: 1 } },
  });
  await notice(tx, await reloadRequest(tx, request.id), event);
  await audit(tx, request.id, event, true);
  void now;
}

async function finishAgreement(
  tx: TransactionDb,
  request: Request,
  now: Date,
  automatic = false,
) {
  const offer = request.offers.find((row) => row.id === request.currentOfferId);
  if (!offer) return;
  if (offer.responses.some((row) => row.state !== "ACCEPTED")) return;
  const pausedTarget = await offerRequiresExplicitAgreement(tx, offer);
  if (pausedTarget) {
    for (const response of offer.responses)
      if (!(await affirmativeResponseProvenance(tx, request, offer, response))) return;
    const audience = await recipients(tx, request.plan, ids(request.participantIds));
    const owners = await executionResponseOwnerIds(tx, offer.responses.map((row) => row.id));
    if (!audience.every((actor) => offer.responses.some((response) => response.actorKey === actor.actorKey &&
      (owners.get(response.id) ?? response.actorUserId) === actor.user.id))) {
      await closeRequest(tx, request, "STALE", "stale", now);
      return;
    }
  }
  const source = await loadCohort(tx, request.cohortId);
  const sourceCalendar = resolvePlanningTimetableDay(
    source.plan.originalDate,
    await tx.schoolCalendarDay.findMany(),
  );
  const sourcePairing = await tx.pairing.findUnique({
    where: {
      id:
        source.plan.assignments.find((row) => row.primary)?.pairingId ??
        source.plan.assignments[0]!.pairingId,
    },
    select: { dayOfWeek: true },
  });
  const calendarSuppressed =
    (source.sourceInvalidated ||
      source.plan.participants.some(
        (person) => person.cohortId === source.id && person.calendarSuppressed,
      )) &&
    source.plan.kind === "REGULAR" &&
    !source.rescheduled &&
    (!sourceCalendar.isSchoolDay ||
      sourceCalendar.effectiveTimetableWeekday !== sourcePairing?.dayOfWeek);
  const tutoringPauseSuppressed = source.plan.participants.some((person) =>
    person.cohortId === source.id && person.tutoringPauseSuppressed) &&
    isRegularTutoringPaused(source.date, await pauseRanges(tx));
  if (
    !(await sourceIsCurrent(tx, request.plan)) ||
    (source.status !== "SCHEDULED" && !calendarSuppressed && !tutoringPauseSuppressed) ||
    source.startsAt <= now ||
    offer.startsAt <= now
  ) {
    await closeRequest(tx, request, "STALE", "stale", now);
    return;
  }
  const people = ids(request.participantIds);
  try {
    await validateTarget(
      tx,
      request.plan,
      offer,
      people,
      source,
      request.scope,
      request.id,
      now,
    );
  } catch (error) {
    if (!(error instanceof TRPCError)) throw error;
    await closeRequest(tx, request, "STALE", "stale", now);
    return;
  }
  let targetPlanId = request.planId;
  if (request.kind === "EXTRA") {
    const generationKey = `extra:${request.parentRequestId ?? request.id}`;
    const extra = await tx.sessionPlan.upsert({
      where: { generationKey },
      update: {},
      create: {
        generationKey,
        tutorId: request.plan.tutorId,
        termId: request.plan.termId,
        originalDate: offer.date,
        timeZone: request.plan.timeZone,
        kind: "EXTRA",
        sourceFingerprint: request.plan.sourceFingerprint,
        continuationMembers: {
          create: request.plan.continuationMembers.map((member) => ({
            pairingId: member.pairingId,
            tuteeId: member.tuteeId,
            assignmentId: member.assignmentId,
            sourceSurveyId: member.sourceSurveyId,
            joinedAt: member.joinedAt,
            releasedAt: member.releasedAt,
          })),
        },
        assignments: {
          create: request.plan.assignments.map((row) => ({
            pairingId: row.pairingId,
            subject: row.subject,
            tuteeIds: assignmentRoster(request.plan, row),
            primary: row.primary,
          })),
        },
      },
    });
    targetPlanId = extra.id;
  }
  const sourceRoster = request.plan.participants.filter(
    (person) =>
      person.cohortId === source.id &&
      (person.status === "SCHEDULED" || person.calendarSuppressed || person.tutoringPauseSuppressed),
  );
  const movesWholeCohort =
    request.kind !== "EXTRA" &&
    sourceRoster.length > 0 &&
    sourceRoster.every((person) => people.includes(person.tuteeId));
  const shared =
    request.kind !== "EXTRA" || request.parentRequestId
      ? await tx.sessionPlanCohort.findFirst({
          where: {
            planId: targetPlanId,
            date: offer.date,
            startMin: offer.startMin,
            endMin: offer.endMin,
            roomId: offer.roomId,
            online: offer.online,
            status: "SCHEDULED",
            id: { not: source.id },
          },
        })
      : null;
  const clocks = {
    date: offer.date,
    startMin: offer.startMin,
    endMin: offer.endMin,
    startsAt: offer.startsAt,
    endsAt: offer.endsAt,
    roomId: offer.roomId,
    online: offer.online,
  };
  const cohort =
    movesWholeCohort && !shared
      ? await tx.sessionPlanCohort.update({
          where: { id: source.id },
          data: {
            ...clocks,
            rescheduled: true,
            status: "SCHEDULED",
            sourceInvalidated: false,
            version: { increment: 1 },
          },
        })
      : (shared ??
        (await tx.sessionPlanCohort.create({
          data: {
            planId: targetPlanId,
            ...clocks,
            rescheduled: request.kind === "RESCHEDULE",
          },
        })));
  if (shared)
    await tx.sessionPlanCohort.update({
      where: { id: shared.id },
      data: { version: { increment: 1 } },
    });
  for (const tuteeId of people) {
    if (request.kind === "EXTRA")
      await tx.sessionPlanParticipant.create({
        data: { planId: targetPlanId, tuteeId, cohortId: cohort.id, scheduleOverride: true },
      });
    else
      await tx.sessionPlanParticipant.update({
        where: { planId_tuteeId: { planId: request.planId, tuteeId } },
        data: {
          cohortId: cohort.id,
          status: "SCHEDULED",
          scheduleOverride: true,
          calendarSuppressed: false,
          tutoringPauseSuppressed: false,
          version: { increment: 1 },
        },
      });
  }
  if (targetPlanId !== request.planId) {
    const execution = await tx.sessionPlanExecution.findUnique({ where: { planId: request.planId } });
    if (execution) {
      await tx.sessionPlanExecution.upsert({ where: { planId: targetPlanId }, create: { planId: targetPlanId, tutorId: execution.tutorId, assignments: execution.assignments as Prisma.InputJsonValue, receiptId: execution.receiptId }, update: {} });
      const originalMembers = await tx.sessionParticipantExecution.findMany({ where: { participantId: { in: request.plan.participants.map((row) => row.id) } } });
      const childMembers = await tx.sessionPlanParticipant.findMany({ where: { planId: targetPlanId } });
      for (const child of childMembers) {
        const original = request.plan.participants.find((row) => row.tuteeId === child.tuteeId);
        const authority = originalMembers.find((row) => row.participantId === original?.id);
        if (authority) await tx.sessionParticipantExecution.upsert({ where: { participantId: child.id }, create: { participantId: child.id, tuteeId: authority.tuteeId, sourceSurveyIds: authority.sourceSurveyIds, receiptId: execution.receiptId }, update: {} });
      }
    }
  }
  if (request.kind !== "EXTRA" && cohort.id !== source.id) {
    const remaining = await tx.sessionPlanParticipant.count({
      where: { cohortId: source.id, status: "SCHEDULED" },
    });
    await tx.sessionPlanCohort.update({
      where: { id: source.id },
      data: {
        status:
          remaining && !source.sourceInvalidated ? "SCHEDULED" : "CANCELLED",
        version: { increment: 1 },
      },
    });
  }
  await closeRequest(
    tx,
    request,
    "ACCEPTED",
    automatic && !pausedTarget ? "autoaccepted" : "accepted",
    now,
  );
}

/** Provider acceptance records delivery. A response starts a silence clock only
 * when neither live policy nor any already-admitted guidance required consent. */
export async function markSessionResponseDelivered(
  tx: TransactionDb,
  responseId: string,
  acceptedAt: Date,
  admittedExplicitOnly = false,
) {
  await lockSessionPlanning(tx);
  const response = await tx.sessionPlanningResponse.findUnique({
    where: { id: responseId },
    include: { offer: { include: { request: true } } },
  });
  if (
    response?.state !== "PENDING" ||
    response.offer.request.status !== "PENDING" ||
    response.offer.request.currentOfferId !== response.offerId
  )
    return false;
  const explicitOnly = admittedExplicitOnly || await offerRequiresExplicitAgreement(tx, response.offer);
  if (response.deliveredAt) {
    // A delayed normal completion must not outvote a stricter receipt admitted
    // concurrently, including a provider attempt whose acknowledgement was lost.
    if (explicitOnly && response.deadline)
      await tx.sessionPlanningResponse.update({ where: { id: response.id }, data: { deadline: null } });
    return false;
  }
  await tx.sessionPlanningResponse.update({
    where: { id: response.id },
    data: {
      deliveredAt: acceptedAt,
      deadline: explicitOnly
        ? null : responseDeadline(acceptedAt, response.offer.cutoffAt),
    },
  });
  return true;
}

async function settleRequest(tx: TransactionDb, request: Request, now: Date) {
  if (request.status === "SPLIT_REQUESTED") {
    const source = await loadCohort(tx, request.cohortId);
    if (source.startsAt <= now)
      await closeRequest(tx, request, "EXPIRED", "expired", now);
    else if (!(await sourceIsCurrent(tx, request.plan)))
      await closeRequest(tx, request, "STALE", "stale", now);
    return;
  }
  if (request.status !== "PENDING") return;
  const offer = request.offers.find((row) => row.id === request.currentOfferId);
  if (!offer) return;
  const pausedTarget = await offerRequiresExplicitAgreement(tx, offer);
  if (!(await sourceIsCurrent(tx, request.plan))) {
    await closeRequest(tx, request, "STALE", "stale", now);
    return;
  }
  let audience: Awaited<ReturnType<typeof recipients>>;
  try {
    audience = await recipients(tx, request.plan, ids(request.participantIds));
  } catch {
    await closeRequest(tx, request, "STALE", "stale", now);
    return;
  }
  const responseOwners = await executionResponseOwnerIds(tx, offer.responses.map((row) => row.id));
  if (
    offer.responses.some(
      (response) =>
        !audience.some(
          (person) =>
            person.actorKey === response.actorKey &&
            person.user.id === (responseOwners.get(response.id) ?? response.actorUserId),
        ),
    )
  ) {
    await closeRequest(tx, request, "STALE", "stale", now);
    return;
  }
  // Cutoff wins over late mail and late worker execution: short notice never invents consent.
  if (offer.cutoffAt <= now) {
    const missedAutomaticWindow = !pausedTarget && offer.responses.some(
      (response) =>
        response.state === "PENDING" &&
        response.deliveredAt &&
        response.deadline &&
        response.deadline < offer.cutoffAt,
    );
    await closeRequest(
      tx,
      request,
      "EXPIRED",
      missedAutomaticWindow ? "deadline_missed" : "expired",
      now,
    );
    return;
  }
  const unconfirmed = [];
  if (pausedTarget) for (const response of offer.responses)
    if (response.state === "ACCEPTED" && !(await affirmativeResponseProvenance(tx, request, offer, response))) unconfirmed.push(response.id);
  const changed = pausedTarget
    ? await tx.sessionPlanningResponse.updateMany({
        where: { offerId: offer.id, id: { in: unconfirmed }, state: "ACCEPTED" },
        data: { state: "PENDING", acceptedBy: null, respondedAt: null, deadline: null },
      })
    : await tx.sessionPlanningResponse.updateMany({
    where: {
      offerId: offer.id,
      state: "PENDING",
      deliveredAt: { not: null },
      deadline: { lte: now },
    },
    data: { state: "ACCEPTED", acceptedBy: "TIMEOUT", respondedAt: now },
  });
  // Time spent under an explicit-only pause cannot become silence consent when
  // the pause is later removed. Preserve delivery evidence, never restart clocks.
  const cleared = pausedTarget ? await tx.sessionPlanningResponse.updateMany({
    where: { offerId: offer.id, state: "PENDING", deadline: { not: null } },
    data: { deadline: null },
  }) : { count: 0 };
  if (changed.count || cleared.count)
    await tx.sessionPlanningRequest.update({
      where: { id: request.id },
      data: { version: { increment: 1 } },
    });
  const current = await reloadRequest(tx, request.id);
  await finishAgreement(tx, current, now, true);
  const latest = await reloadRequest(tx, request.id);
  if ((changed.count || cleared.count) && latest.status === "PENDING")
    await notice(tx, latest, pausedTarget ? "proposed" : "response_autoaccepted");
}

export async function sweepSessionPlanning(db: DomainDb, now = new Date()) {
  return runSessionPlanningSweep(db, now, false);
}

async function runSessionPlanningSweep(
  db: DomainDb,
  now: Date,
  opportunisticMetadata: boolean,
) {
  const maintainRequestMetadata = await inSchedulingMaintenanceTransaction(db, async (tx) => {
    if (opportunisticMetadata) {
      // Publication has already committed. Do not queue this reader behind a
      // second expensive publication merely to maintain the derived work list.
      // A later uncontended read or blocking standalone sweep resumes it.
      if (!(await tryLockPlanningMaintenance(tx))) return false;
    } else await lockPlanningEntry(tx);
    return prepareSchedulingInvalidationBatch(tx);
  });
  // Due work wins over undelivered future offers. Each request has its own atomic
  // decision so one broken lifecycle row cannot roll back the whole deadline sweep.
  const candidates = await db.$queryRaw<{ id: string }[]>`
    SELECT r.id FROM "SessionPlanningRequest" r
    LEFT JOIN "SessionPlanningOffer" o ON o.id=r."currentOfferId"
    LEFT JOIN "SessionPlanCohort" c ON c.id=r."cohortId"
    WHERE r.status IN ('PENDING','SPLIT_REQUESTED')
    ORDER BY CASE WHEN
      (r.status='PENDING' AND (o."cutoffAt"<=${now} OR EXISTS
        (SELECT 1 FROM "SessionPlanningResponse" s WHERE s."offerId"=o.id AND s.state='PENDING' AND s."deliveredAt" IS NOT NULL AND s.deadline<=${now})))
      OR (r.status='SPLIT_REQUESTED' AND c."startsAt"<=${now}) THEN 0 ELSE 1 END,
      r."updatedAt",r.id LIMIT 200`;
  for (const candidate of candidates) {
    try {
      await inSchedulingMaintenanceTransaction(db, async (tx) => {
        await lockPlanningEntry(tx);
        const request = await reloadRequest(tx, candidate.id);
        await settleRequest(tx, request, now);
        await tx.sessionPlanningRequest.updateMany({
          where: {
            id: candidate.id,
            status: { in: ["PENDING", "SPLIT_REQUESTED"] },
          },
          data: {
            updatedAt: new Date(
              Math.max(now.getTime(), request.updatedAt.getTime() + 1),
            ),
          },
        });
        // Dirty metadata tracks completed checks; it never chooses visitors or
        // skips current-source settlement, fairness touches or recovery evidence.
        if (maintainRequestMetadata)
          await completeSchedulingInvalidation(tx, candidate.id);
      });
    } catch {
      console.error(
        "[session-planning] One request could not settle; remaining deadlines continue.",
      );
      await inSchedulingMaintenanceTransaction(db, async (tx) => {
        await lockPlanningEntry(tx);
        const current = await tx.sessionPlanningRequest.findUnique({
          where: { id: candidate.id },
          select: { updatedAt: true, status: true },
        });
        if (current) {
          await tx.sessionPlanningRequest.updateMany({
            where: {
              id: candidate.id,
              status: { in: ["PENDING", "SPLIT_REQUESTED"] },
            },
            data: {
              updatedAt: new Date(
                Math.max(now.getTime(), current.updatedAt.getTime() + 1),
              ),
            },
          });
          if (["PENDING", "SPLIT_REQUESTED"].includes(current.status))
            await retrySchedulingInvalidation(tx, candidate.id);
          else await completeSchedulingInvalidation(tx, candidate.id);
        } else await completeSchedulingInvalidation(tx, candidate.id);
      });
    }
  }
  if (candidates.length && maintainRequestMetadata)
    await inSchedulingMaintenanceTransaction(db, async (tx) => {
      await lockPlanningEntry(tx);
      await finishSchedulingInvalidationBatch(tx);
    });
  return candidates.length;
}

export type SessionLocationPreview = PlanningTime & {
  mode: "propose" | "suggest" | "alternative";
  cohortId: string;
  expectedVersion: number;
  scope: "ONE" | "ALL";
  tuteeId?: string;
  kind: "RESCHEDULE" | "EXTRA";
  requestId?: string;
  requestVersion?: number;
  offerId?: string;
  pausedOnly?: boolean;
};

/** Preview reserves nothing. The editor submits this exact room through the
 * existing locked validator; a race must fail, never silently replace consent. */
export async function previewSessionLocation(
  db: DomainDb,
  actor: Actor,
  input: SessionLocationPreview,
) {
  return inTransaction(db, async (tx) => {
    await lockPlanningEntry(tx);
    await actorAccount(tx, actor);
    const now = new Date();
    const cohort = await loadCohort(tx, input.cohortId);
    let scope = input.scope;
    let kind = input.kind;
    let requestId: string | undefined;
    let people: string[];
    const roster = cohort.plan.participants
      .filter((row) => row.cohortId === cohort.id &&
        (input.pausedOnly ? row.tutoringPauseSuppressed : row.status === "SCHEDULED" || row.tutoringPauseSuppressed))
      .map((row) => row.tuteeId);
    if (input.mode === "alternative") {
      if (!input.requestId)
        return fail("Select the current scheduling request.");
      const request = await reloadRequest(tx, input.requestId);
      const key = await respondingActor(tx, actor, request);
      const offer = request.offers.find(
        (row) => row.id === request.currentOfferId,
      );
      if (
        request.cohortId !== cohort.id ||
        request.status !== "PENDING" ||
        request.version !== input.requestVersion ||
        offer?.id !== input.offerId ||
        !offer ||
        offer.cutoffAt <= now ||
        !offer.responses.some(
          (row) =>
            row.actorKey === key &&
            row.actorUserId === actor.id &&
            row.state === "PENDING",
        ) ||
        (request.scope === "ONE" && request.stage >= 3) ||
        (request.scope === "ALL" && ids(request.rejectionKeys).includes(key))
      )
        return fail(
          "This offer is no longer available for a counteroffer.",
          "CONFLICT",
        );
      people = ids(request.participantIds);
      scope = request.scope === "ONE" ? "ONE" : "ALL";
      kind = request.kind === "EXTRA" ? "EXTRA" : "RESCHEDULE";
      requestId = request.id;
    } else if (input.mode === "suggest") {
      const owned = await ownedStudentIds(tx, actor.id);
      const person = roster.find((id) => owned.includes(id));
      if (!person)
        return fail(
          "Only this session's tutee can suggest a change.",
          "FORBIDDEN",
        );
      people = [person];
      scope = "ONE";
      kind = "RESCHEDULE";
    } else {
      await requireTutor(tx, actor, cohort.plan.tutorId);
      people =
        scope === "ALL"
          ? roster
          : input.tuteeId && roster.includes(input.tuteeId)
            ? [input.tuteeId]
            : [];
      if (!people.length)
        return fail("Select a current learner in this dated session.");
      const pending = await tx.sessionPlanningRequest.findMany({
        where: {
          planId: cohort.planId,
          status: { in: ["PENDING", "SPLIT_REQUESTED"] },
        },
      });
      if (
        pending.some((row) =>
          ids(row.participantIds).some((id) => people.includes(id)),
        )
      )
        return fail(
          "A scheduling request is already open for these learners.",
          "CONFLICT",
        );
    }
    await ensureWritable(tx, cohort, input.expectedVersion, now);
    const validate = (roomId: string | null) =>
      validateTarget(
        tx,
        cohort.plan,
        { ...input, roomId },
        people,
        cohort,
        scope,
        requestId,
        now,
        undefined,
        false,
        undefined,
        kind,
      );
    if (input.online) {
      await validate(null);
      return { roomId: null, roomName: null, online: true };
    }
    const rooms = await tx.room.findMany({
      orderBy: [{ programOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    });
    // Retaining a usable source/suggestion room avoids needless location changes.
    const preferred = input.roomId ?? cohort.roomId;
    const candidates = [
      ...rooms.filter((room) => room.id === preferred),
      ...rooms.filter((room) => room.id !== preferred),
    ];
    for (const room of candidates) {
      try {
        await validate(room.id);
        return { roomId: room.id, roomName: room.name, online: false };
      } catch (error) {
        if (!(error instanceof TRPCError) || error.code !== "CONFLICT")
          throw error;
      }
    }
    return fail(
      "No room is available for this session. Choose another time or Online.",
      "CONFLICT",
    );
  });
}

export async function suggestSessionTime(
  db: DomainDb,
  actor: Actor,
  input: PlanningTime & Versioned & { cohortId: string },
) {
  return inTransaction(db, async (tx) => {
    await lockPlanningEntry(tx);
    await actorAccount(tx, actor);
    return receipt(tx, actor, input.clientKey, ["suggest", input], async () => {
      const cohort = await loadCohort(tx, input.cohortId);
      await ensureWritable(tx, cohort, input.expectedVersion, new Date());
      const owned = await operationalStudentSources(tx, cohort.plan, await ownedStudentIds(tx, actor.id));
      const participant = cohort.plan.participants.find(
        (row) =>
          row.cohortId === cohort.id &&
          (row.status === "SCHEDULED" || row.tutoringPauseSuppressed) &&
          owned.includes(row.tuteeId),
      );
      if (!participant)
        return fail(
          "Only this session's tutee can suggest a change.",
          "FORBIDDEN",
        );
      const window = await validateTarget(
        tx,
        cohort.plan,
        input,
        [participant.tuteeId],
        cohort,
        "ONE",
      );
      const suggestion = await tx.sessionPlanningSuggestion.create({
        data: {
          planId: cohort.planId,
          cohortId: cohort.id,
          tuteeId: participant.tuteeId,
          actorUserId: actor.id,
          sourceVersion: cohort.version,
          date: input.date,
          startMin: input.startMin,
          roomId: input.online ? null : input.roomId,
          online: input.online,
        },
      });
      const audience = await recipients(tx, cohort.plan, [participant.tuteeId]);
      const room = input.roomId
        ? await tx.room.findUnique({
            where: { id: input.roomId },
            select: { name: true },
          })
        : null;
      for (const person of audience)
        await tx.sessionNotice.create({
          data: {
            dedupeKey: `suggestion:${suggestion.id}:${person.actorKey}`,
            recipientUserId: person.user.id,
            recipientEmail: person.user.email,
            event: "suggestion",
            context: {
              isActionable: false,
              startsAt: window.startsAt.toISOString(),
              endsAt: window.endsAt.toISOString(),
              timeZone: cohort.plan.timeZone,
              originalStartsAt: cohort.startsAt.toISOString(),
              subjectLabel: [
                ...new Set(cohort.plan.assignments.map((row) => row.subject)),
              ]
                .join(" / ")
                .slice(0, 200),
              roomLabel: room?.name.slice(0, 120) ?? null,
              online: input.online,
            },
          },
        });
      await audit(tx, suggestion.id, "suggestion");
      return { id: suggestion.id };
    });
  });
}

export async function proposeSession(
  db: DomainDb,
  actor: Actor,
  input: Proposed,
) {
  return inTransaction(db, async (tx) => {
    await lockPlanningEntry(tx);
    await actorAccount(tx, actor);
    return receipt(tx, actor, input.clientKey, ["propose", input], async () => {
      const now = new Date(),
        cohort = await loadCohort(tx, input.cohortId);
      await requireTutor(tx, actor, cohort.plan.tutorId, cohort.plan.id);
      await ensureWritable(tx, cohort, input.expectedVersion, now);
      const roster = cohort.plan.participants
        .filter(
          (row) => row.cohortId === cohort.id &&
            (input.pausedOnly ? row.tutoringPauseSuppressed : row.status === "SCHEDULED" || row.tutoringPauseSuppressed),
        )
        // Relation reads have no implicit order. Capture a stable new audience
        // so later split children and their audit/recovery writes keep its order.
        .map((row) => row.tuteeId)
        .sort();
      const requestedSources = input.tuteeId ? await operationalStudentSources(tx, cohort.plan, [input.tuteeId]) : [];
      const requestedId = input.tuteeId && roster.includes(input.tuteeId) ? input.tuteeId : requestedSources.find((id) => roster.includes(id));
      const people =
        input.scope === "ALL"
          ? roster
          : requestedId
            ? [requestedId]
            : [];
      if (!people.length)
        return fail("Select a current learner in this dated session.");
      const pending = await tx.sessionPlanningRequest.findMany({
        where: {
          planId: cohort.planId,
          status: { in: ["PENDING", "SPLIT_REQUESTED"] },
        },
      });
      if (
        pending.some((row) =>
          ids(row.participantIds).some((id) => people.includes(id)),
        )
      )
        return fail(
          "A scheduling request is already open for these learners.",
          "CONFLICT",
        );
      const request = await tx.sessionPlanningRequest.create({
        data: {
          planId: cohort.planId,
          cohortId: cohort.id,
          kind: input.kind,
          scope: input.scope,
          participantIds: people,
        },
      });
      let matchedKey: string | undefined;
      if (input.suggestionId) {
        if (input.kind !== "RESCHEDULE")
          return fail(
            "A reschedule suggestion cannot authorize an extra lesson.",
            "CONFLICT",
          );
        const suggestion = await tx.sessionPlanningSuggestion.findUnique({
          where: { id: input.suggestionId },
        });
        if (!suggestion)
          return fail("The suggestion no longer exists.", "CONFLICT");
        if (
          suggestion.usedAt ||
          suggestion.cohortId !== cohort.id ||
          suggestion.sourceVersion !== cohort.version ||
          !people.includes(suggestion.tuteeId) ||
          suggestion.date !== input.date ||
          suggestion.startMin !== input.startMin ||
          suggestion.online !== input.online ||
          suggestion.roomId !==
            (input.online ? null : (input.roomId ?? null)) ||
          (await studentOwner(tx, suggestion.tuteeId)).id !==
            suggestion.actorUserId
        )
          return fail(
            "The suggestion changed or does not exactly match this proposal.",
            "CONFLICT",
          );
        matchedKey = `tutee:${suggestion.tuteeId}`;
        await tx.sessionPlanningSuggestion.update({
          where: { id: suggestion.id },
          data: { usedAt: now },
        });
      }
      const current = await makeOffer(
        tx,
        request.id,
        `tutor:${cohort.plan.tutorId}`,
        input,
        now,
        matchedKey,
      );
      await finishAgreement(tx, current, now);
      await audit(tx, request.id, "proposed");
      return { id: request.id };
    });
  });
}

async function respondingActor(
  tx: TransactionDb,
  actor: Actor,
  request: Request,
) {
  const account = await actorAccount(tx, actor);
  const currentOffer = request.offers.find((row) => row.id === request.currentOfferId);
  for (const response of currentOffer?.responses ?? []) {
    const execution = await executionResponseActor(tx, response);
    if (execution.userId !== actor.id || response.state !== "PENDING") continue;
    if (execution.actorKey.startsWith("tutor:")) await requireTutor(tx, actor, request.plan.tutorId, request.plan.id);
    else if ((await studentOwner(tx, execution.actorKey.slice(6))).id !== actor.id) return fail("This profile's owner changed.", "FORBIDDEN");
    return response.actorKey;
  }
  if (account.tutorId === await executionPlanTutorId(tx, request.plan.id, request.plan.tutorId)) {
    await requireTutor(tx, actor, request.plan.tutorId, request.plan.id);
    return `tutor:${request.plan.tutorId}`;
  }
  const owned = await ownedStudentIds(tx, actor.id);
  const offer = request.offers.find((row) => row.id === request.currentOfferId);
  const pending = offer?.responses.find(
    (row) =>
      row.actorUserId === actor.id &&
      row.state === "PENDING" &&
      row.actorKey.startsWith("tutee:"),
  );
  const tuteeId = pending
    ? pending.actorKey.slice("tutee:".length)
    : ids(request.participantIds).find((id) => owned.includes(id));
  if (tuteeId && !owned.includes(tuteeId))
    return fail("This profile's owner changed.", "FORBIDDEN");
  if (!tuteeId)
    return fail("This request does not belong to your session.", "FORBIDDEN");
  if ((await studentOwner(tx, tuteeId)).id !== actor.id)
    return fail("This profile's owner changed.", "FORBIDDEN");
  return `tutee:${tuteeId}`;
}

export async function respondSession(
  db: DomainDb,
  actor: Actor,
  input: Versioned & {
    requestId: string;
    offerId: string;
    decision: "ACCEPT" | "REJECT";
    alternative?: PlanningTime;
  },
) {
  return inTransaction(db, async (tx) => {
    await lockPlanningEntry(tx);
    return receipt(tx, actor, input.clientKey, ["respond", input], async () => {
      const now = new Date();
      let request = await reloadRequest(tx, input.requestId);
      const key = await respondingActor(tx, actor, request);
      await settleRequest(tx, request, now);
      request = await reloadRequest(tx, request.id);
      if (
        request.status !== "PENDING" ||
        request.version !== input.expectedVersion ||
        request.currentOfferId !== input.offerId
      )
        return fail(
          "This offer is no longer current. Reload its outcome.",
          "CONFLICT",
        );
      const offer = request.offers.find((row) => row.id === input.offerId)!;
      const responseOwners = await executionResponseOwnerIds(tx, offer.responses.map((row) => row.id));
      const response = offer.responses.find(
        (row) => row.actorKey === key && (responseOwners.get(row.id) ?? row.actorUserId) === actor.id,
      );
      if (response?.state !== "PENDING")
        return fail(
          "Your response is already recorded or is not required.",
          "CONFLICT",
        );
      // Only transferred responses have execution evidence to advance. Issuing
      // an empty update for an ordinary response creates a spurious audit entry.
      if (responseOwners.has(response.id)) {
        await tx.sessionResponseExecution.updateMany({
          where: { responseId: response.id },
          data: { respondedByUserId: actor.id, revision: { increment: 1 } },
        });
      }
      if (input.decision === "ACCEPT") {
        await tx.sessionPlanningResponse.update({
          where: { id: response.id },
          data: { state: "ACCEPTED", acceptedBy: "EXPLICIT", respondedAt: now },
        });
        await tx.sessionPlanningRequest.update({
          where: { id: request.id },
          data: { version: { increment: 1 } },
        });
        await finishAgreement(tx, await reloadRequest(tx, request.id), now);
        const latest = await reloadRequest(tx, request.id);
        if (latest.status === "PENDING")
          await notice(tx, latest, "response_accepted");
      } else {
        const action =
          request.scope === "ONE"
            ? oneNegotiationAction(request.stage, input.decision)
            : "COUNTER";
        const used = ids(request.rejectionKeys);
        if (request.scope === "ALL" && used.includes(key))
          return fail(
            "Your group rejection is already used. Ask for separate rescheduling.",
            "CONFLICT",
          );
        if (action !== "CANCEL" && !input.alternative)
          return fail("Supply an alternative available time.");
        await tx.sessionPlanningResponse.update({
          where: { id: response.id },
          data: { state: "REJECTED", respondedAt: now },
        });
        if (action === "CANCEL") {
          if (request.kind !== "EXTRA")
            await tx.sessionPlanParticipant.updateMany({
              where: {
                planId: request.planId,
                tuteeId: { in: ids(request.participantIds) },
              },
              data: {
                status: "CANCELLED",
                calendarSuppressed: false,
                tutoringPauseSuppressed: false,
                version: { increment: 1 },
              },
            });
          if (request.kind !== "EXTRA") {
            const remaining = await tx.sessionPlanParticipant.count({
              where: { cohortId: request.cohortId, status: "SCHEDULED" },
            });
            const source = await tx.sessionPlanCohort.findUniqueOrThrow({
              where: { id: request.cohortId },
            });
            await tx.sessionPlanCohort.update({
              where: { id: request.cohortId },
              data: {
                status:
                  remaining && !source.sourceInvalidated
                    ? "SCHEDULED"
                    : "CANCELLED",
                version: { increment: 1 },
              },
            });
          }
          await closeRequest(tx, request, "CANCELLED", "cancelled", now);
        } else {
          await tx.sessionPlanningRequest.update({
            where: { id: request.id },
            data: {
              stage:
                request.scope === "ONE" ? request.stage + 1 : request.stage,
              rejectionKeys: [...used, key],
            },
          });
          await makeOffer(tx, request.id, key, input.alternative!, now);
        }
      }
      await audit(tx, request.id, "responded");
      return { id: request.id };
    });
  });
}

export async function requestSeparateSession(
  db: DomainDb,
  actor: Actor,
  input: Versioned & { requestId: string },
) {
  return inTransaction(db, async (tx) => {
    await lockPlanningEntry(tx);
    return receipt(tx, actor, input.clientKey, ["split", input], async () => {
      let request = await reloadRequest(tx, input.requestId);
      const key = await respondingActor(tx, actor, request);
      await settleRequest(tx, request, new Date());
      request = await reloadRequest(tx, request.id);
      if (
        request.scope !== "ALL" ||
        request.status !== "PENDING" ||
        request.version !== input.expectedVersion ||
        !ids(request.rejectionKeys).includes(key)
      )
        return fail(
          "Separate rescheduling is not available for this request.",
          "CONFLICT",
        );
      // Changing parent state immediately removes its hold and disables every old deadline.
      await closeRequest(
        tx,
        request,
        "SPLIT_REQUESTED",
        "split_requested",
        new Date(),
      );
      return { id: request.id };
    });
  });
}

export async function formalizeSeparateSessions(
  db: DomainDb,
  actor: Actor,
  input: Versioned & { requestId: string },
) {
  return inTransaction(db, async (tx) => {
    await lockPlanningEntry(tx);
    return receipt(
      tx,
      actor,
      input.clientKey,
      ["formalizeSplit", input],
      async () => {
        const parent = await reloadRequest(tx, input.requestId);
        await requireTutor(tx, actor, parent.plan.tutorId, parent.plan.id);
        if (
          parent.status !== "SPLIT_REQUESTED" ||
          parent.version !== input.expectedVersion
        )
          return fail("The split request changed. Reload first.", "CONFLICT");
        const offer = parent.offers.find(
          (row) => row.id === parent.currentOfferId,
        )!;
        const now = new Date();
        const source = await loadCohort(tx, parent.cohortId);
        if (source.startsAt <= now || !(await sourceIsCurrent(tx, parent.plan)))
          return fail(
            "The original session has started or its roster changed. Reload the split outcome.",
            "CONFLICT",
          );
        const responseOwners = await executionResponseOwnerIds(tx, offer.responses.map((row) => row.id));
        for (const tuteeId of ids(parent.participantIds)) {
          const child = await tx.sessionPlanningRequest.create({
            data: {
              planId: parent.planId,
              cohortId: parent.cohortId,
              kind: parent.kind,
              scope: "ONE",
              participantIds: [tuteeId],
              parentRequestId: parent.id,
            },
          });
          const owner = await studentOwner(tx, tuteeId);
          const mutual =
            offer.responses.some(
              (row) =>
                row.actorKey === `tutor:${parent.plan.tutorId}` &&
                (responseOwners.get(row.id) ?? row.actorUserId) === actor.id &&
                row.state === "ACCEPTED" && affirmativeAcceptance.has(row.acceptedBy ?? ""),
            ) &&
            offer.responses.some(
              (row) =>
                row.actorKey === `tutee:${tuteeId}` &&
                (responseOwners.get(row.id) ?? row.actorUserId) === owner.id &&
                row.state === "ACCEPTED" && affirmativeAcceptance.has(row.acceptedBy ?? ""),
            );
          const current = await makeOffer(
            tx,
            child.id,
            `tutor:${parent.plan.tutorId}`,
            offer,
            now,
            mutual ? `tutee:${tuteeId}` : undefined,
          );
          await finishAgreement(tx, current, now);
        }
        await closeRequest(tx, parent, "SPLIT", "split", now);
        return { id: parent.id };
      },
    );
  });
}

async function operationalStudentSources(tx: TransactionDb, plan: Pick<Plan, "participants">, currentIds: readonly string[]) {
  const mappings = await tx.sessionParticipantExecution.findMany({ where: { participantId: { in: plan.participants.map((row) => row.id) } } });
  return plan.participants.filter((row) => currentIds.includes(mappings.find((mapping) => mapping.participantId === row.id)?.tuteeId ?? row.tuteeId)).map((row) => row.tuteeId);
}

async function agendaActorContext(
  tx: TransactionDb,
  actor: Actor,
  role: "tutor" | "tutee",
  history = false,
) {
  // Historical evidence follows exact private ownership, independently of a
  // current participation capability or a transferred execution identity.
  const account = history ? await tx.user.findUnique({ where: { id: actor.id } }) : await actorAccount(tx, actor);
  if (!account || account.mergedIntoId || account.recoveryVoidedAt || account.suspendedAt)
    return fail("History access is unavailable.", "FORBIDDEN");
  let owned = await ownedStudentIds(tx, actor.id);
  const currentStudentIds = history ? owned : (await tx.tutee.findMany({ where: { id: { in: owned }, status: "ACTIVE" }, select: { id: true } })).map((row) => row.id);
  if (!history && role === "tutee" && !account.tuteeMember)
    return fail(
      "Accept the tutee policy before entering the tutee area.",
      "FORBIDDEN",
    );
  const tutor = account.tutorId
    ? await tx.tutor.findUnique({ where: { id: account.tutorId } })
    : null;
  if (!history && role === "tutor" && (!tutor || account.tutorAccessRevoked))
    return fail("Tutor access is required.", "FORBIDDEN");
  let visibility: Prisma.SessionPlanWhereInput;
  if (history) {
    const readerIds = await accountHistoryIds(tx, actor.id);
    const tutors = role === "tutor" ? await tx.tutor.findMany({ where: { OR: [{ user: { id: { in: readerIds } } }, { retainedOwner: { userId: { in: readerIds } } }] }, select: { id: true } }) : [];
    visibility = role === "tutor" ? { tutorId: { in: tutors.map((row) => row.id) } } : { participants: { some: { tuteeId: { in: owned } } } };
  }
  else if (role === "tutor") {
    const native = await tx.sessionPlan.findMany({ where: { tutorId: tutor!.id }, select: { id: true } });
    const mappings = await tx.sessionPlanExecution.findMany({ where: { OR: [{ planId: { in: native.map((row) => row.id) } }, { tutorId: tutor!.id }] } });
    visibility = { OR: [{ tutorId: tutor!.id, id: { notIn: mappings.map((row) => row.planId) } }, { id: { in: mappings.filter((row) => row.tutorId === tutor!.id).map((row) => row.planId) } }] };
  } else {
    const native = await tx.sessionPlanParticipant.findMany({ where: { tuteeId: { in: currentStudentIds } }, select: { id: true, tuteeId: true } });
    const mappings = await tx.sessionParticipantExecution.findMany({ where: { OR: [{ participantId: { in: native.map((row) => row.id) } }, { tuteeId: { in: currentStudentIds } }] } });
    const allowedIds = [...native.filter((row) => !mappings.some((mapping) => mapping.participantId === row.id)).map((row) => row.id), ...mappings.filter((row) => currentStudentIds.includes(row.tuteeId)).map((row) => row.participantId)];
    owned = (await tx.sessionPlanParticipant.findMany({ where: { id: { in: allowedIds } }, select: { tuteeId: true } })).map((row) => row.tuteeId);
    visibility = { participants: { some: { id: { in: allowedIds } } } };
  }
  return { owned, currentStudentIds, account, tutor, visibility };
}

const agendaCohortInclude = {
  plan: { include: planInclude },
  participants: { include: { tutee: true } },
  sessions: { select: { id: true } },
} satisfies Prisma.SessionPlanCohortInclude;
type AgendaCohortRow = Prisma.SessionPlanCohortGetPayload<{
  include: typeof agendaCohortInclude;
}>;

/** History reads captured planning evidence, never live Pairings or actual attendance.
 * A fully moved/cancelled source can have no remaining cohort joins; its immutable
 * published assignment roster still identifies the planned source participants. */
function projectAgendaCohort(
  row: AgendaCohortRow,
  role: "tutor" | "tutee",
  { owned, tutor }: Awaited<ReturnType<typeof agendaActorContext>>,
  roomRows: readonly { id: string; name: string }[],
  calendar: Parameters<typeof resolvePlanningTimetableDay>[1],
  now: Date,
  history = false,
  tutoringPauses: readonly TutoringPauseRange[] = [],
) {
  const roster = row.participants.filter(
    (person) => person.status === "SCHEDULED",
  );
  const pauseReasons = row.participants.filter((person) => person.tutoringPauseSuppressed &&
    (role === "tutor" || owned.includes(person.tuteeId)));
  const policyPaused = isRegularTutoringPaused(row.date, tutoringPauses);
  const paused = policyPaused ? pauseReasons : [];
  const restorationBlocked = !history && !policyPaused && pauseReasons.length > 0;
  const ordinaryUnavailable = !history && !policyPaused && row.participants.some((person) =>
    person.calendarSuppressed && person.status === "CANCELLED" && (role === "tutor" || owned.includes(person.tuteeId)));
  const activePersonal = roster.filter((person) => role === "tutor" || owned.includes(person.tuteeId));
  const eligible = activePersonal.length ? activePersonal : paused;
  const tutoringPaused = paused.length > 0 && !activePersonal.length;
  const capturedIds = new Set(
    row.plan.assignments.flatMap((assignment) =>
      assignmentRoster(row.plan, assignment),
    ),
  );
  const captured = row.plan.participants.filter((person) =>
    capturedIds.has(person.tuteeId),
  );
  const displayRoster =
    history && !row.participants.length ? captured : row.participants;
  if (
    role === "tutee" &&
    !displayRoster.some((person) => owned.includes(person.tuteeId))
  )
    return [];
  const personal =
    role === "tutee"
      ? displayRoster.filter((person) => owned.includes(person.tuteeId))
      : history
        ? displayRoster
        : eligible;
  const assignments = row.plan.assignments.filter((assignment) =>
    assignmentRoster(row.plan, assignment).some((id) =>
      personal.some((person) => person.tuteeId === id),
    ),
  );
  const sorted = [...assignments].sort(
    (a, b) =>
      Number(b.primary) - Number(a.primary) ||
      a.pairingId.localeCompare(b.pairingId),
  );
  return [
    {
      id: row.id,
      planId: row.planId,
      version: row.version,
      date: row.date,
      startMin: row.startMin,
      endMin: row.endMin,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      roomId: row.roomId,
      roomName: roomRows.find((room) => room.id === row.roomId)?.name ?? null,
      online: row.online,
      kind: row.plan.kind,
      rescheduled:
        role === "tutee"
          ? personal.some((person) => person.scheduleOverride)
          : row.rescheduled || roster.some((person) => person.scheduleOverride),
      schoolClosed: !resolvePlanningTimetableDay(row.date, calendar)
        .isSchoolDay,
      unavailable: restorationBlocked || (!activePersonal.length && ordinaryUnavailable) || (row.sourceInvalidated && !paused.length),
      ...(paused.length ? {
        tutoringPaused,
        canArrangeException: !history && !row.sessions.length && row.startsAt > now,
        pausedTutees: paused.map((person) => ({ id: person.tuteeId, name: person.tutee.englishName })),
      } : {}),
      status:
        role === "tutee" &&
        personal.every((person) => person.status === "CANCELLED")
          ? "CANCELLED"
          : row.sessions.length
            ? "RECORDED"
            : history
              ? row.status
              : !roster.length
                ? "CANCELLED"
                : row.status,
      subjects: [...new Set(assignments.map((item) => item.subject))],
      pairingIds: sorted.map((item) => item.pairingId),
      primaryPairingId: sorted[0]?.pairingId ?? null,
      tutorId: row.plan.tutorId,
      tutorName: row.plan.tutor.englishName,
      tutees:
        role === "tutor"
          ? (history ? displayRoster : eligible).map((person) => ({
              id: person.tuteeId,
              name: person.tutee.englishName,
            }))
          : (history ? displayRoster : eligible)
              .filter((person) => owned.includes(person.tuteeId))
              .map((person) => ({
                id: person.tuteeId,
                name: person.tutee.englishName,
              })),
      needsAttendance:
        !row.sessions.length &&
        roster.length > 0 &&
        row.status === "SCHEDULED" &&
        row.endsAt <= now,
      canRecordAttendance:
        !history &&
        role === "tutor" &&
        tutor?.status === "ACTIVE" &&
        !row.sessions.length &&
        roster.length > 0 &&
        sorted.length > 0 &&
        row.status === "SCHEDULED" &&
        row.endsAt <= now,
    },
  ];
}

export type SessionAgendaHistoryInput = {
  role: "tutor" | "tutee";
  view?: "history" | "all";
  cursor?: { startsAt: Date; id: string };
  limit?: number;
};

/** Planned commitments, ended by default. This read never publishes plans, settles
 * responses or rebuilds historical attendance from mutable recurring Pairings. */
export async function readSessionAgendaHistory(
  db: DomainDb,
  actor: Actor,
  input: SessionAgendaHistoryInput,
  now = new Date(),
) {
  return inTransaction(db, async (tx) => {
    const context = await agendaActorContext(tx, actor, input.role, true);
    const limit = Math.min(50, Math.max(1, input.limit ?? 50));
    const rows = await tx.sessionPlanCohort.findMany({
      where: {
        plan: context.visibility,
        ...(input.view === "all" ? {} : { endsAt: { lte: now } }),
        ...(input.role === "tutee"
          ? {
              AND: [
                {
                  OR: [
                    {
                      participants: {
                        some: { tuteeId: { in: context.owned } },
                      },
                    },
                    {
                      participants: { none: {} },
                      plan: {
                        OR: [
                          {
                            assignments: {
                              some: {
                                OR: context.owned.map((id) => ({
                                  tuteeIds: { array_contains: [id] },
                                })),
                              },
                            },
                          },
                          {
                            continuationMembers: {
                              some: { tuteeId: { in: context.owned } },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            }
          : {}),
        ...(input.cursor
          ? {
              OR: [
                { startsAt: { lt: input.cursor.startsAt } },
                {
                  startsAt: input.cursor.startsAt,
                  id: { lt: input.cursor.id },
                },
              ],
            }
          : {}),
      },
      include: agendaCohortInclude,
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const [rooms, calendar] = await Promise.all([
      tx.room.findMany({ select: { id: true, name: true } }),
      tx.schoolCalendarDay.findMany(),
    ]);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      cohorts: page.flatMap((row) =>
        projectAgendaCohort(
          row,
          input.role,
          context,
          rooms,
          calendar,
          now,
          true,
        ),
      ),
      // The cursor belongs to the last source row, not a mutable count or offset.
      nextCursor:
        rows.length > limit && last
          ? { startsAt: last.startsAt, id: last.id }
          : null,
    };
  });
}

export async function readSessionAgenda(
  db: DomainDb,
  actor: Actor,
  role: "tutor" | "tutee",
  now = new Date(),
) {
  const publication = await ensureSessionPlanningWindow(db, now);
  await runSessionPlanningSweep(db, now, true);
  return inTransaction(db, async (tx) => {
    const context = await agendaActorContext(tx, actor, role);
    const { owned, account, tutor, visibility } = context;
    const requests = await tx.sessionPlanningRequest.findMany({
      where: {
        plan: visibility,
        status: { in: ["PENDING", "SPLIT_REQUESTED"] },
      },
      include: requestInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const suggestions = await tx.sessionPlanningSuggestion.findMany({
      where: {
        usedAt: null,
        plan: visibility,
        ...(role === "tutee" ? { tuteeId: { in: owned } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const sourceIds = [
      ...new Set([
        ...requests.map((request) => request.cohortId),
        ...suggestions.map((suggestion) => suggestion.cohortId),
      ]),
    ];
    // Bound publication and overdue work independently: old attendance backlog
    // cannot consume every slot and hide this week's actionable sessions. Sources
    // of loaded requests/suggestions remain available regardless of those limits.
    const [windowRows, backlogRows, sourceRows] = await Promise.all([
      tx.sessionPlanCohort.findMany({
        where: {
          plan: visibility,
          date: { gte: publication.start, lte: publication.end },
        },
        include: agendaCohortInclude,
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: 300,
      }),
      tx.sessionPlanCohort.findMany({
        where: {
          plan: visibility,
          endsAt: { lte: now },
          status: "SCHEDULED",
          sessions: { none: {} },
        },
        include: agendaCohortInclude,
        orderBy: [{ startsAt: "desc" }, { id: "desc" }],
        take: 301,
      }),
      sourceIds.length
        ? tx.sessionPlanCohort.findMany({
            where: { plan: visibility, id: { in: sourceIds } },
            include: agendaCohortInclude,
            orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          })
        : [],
    ]);
    const rows = [
      ...new Map(
        [...windowRows, ...backlogRows.slice(0, 300), ...sourceRows].map(
          (row) => [row.id, row],
        ),
      ).values(),
    ].sort(
      (left, right) =>
        left.startsAt.getTime() - right.startsAt.getTime() ||
        left.id.localeCompare(right.id),
    );
    const roomRows = await tx.room.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const calendar = await tx.schoolCalendarDay.findMany();
    const tutoringPauses = await pauseRanges(tx);
    // Read execution only for the bounded agenda results. Published actors and
    // roster keys remain the evidence used to match consent and personal access.
    const liveRows = rows.filter((row) => !row.sessions.length);
    const planIds = [...new Set(liveRows.map((row) => row.planId))];
    const relevantPlans = role === "tutee"
      ? [...rows.map((row) => row.plan), ...requests.map((request) => request.plan)]
      : liveRows.map((row) => row.plan);
    const participantIds = [...new Set(relevantPlans.flatMap((plan) => plan.participants.map((person) => person.id)))];
    const currentResponses = requests.flatMap((request) =>
      request.offers.find((offer) => offer.id === request.currentOfferId)?.responses ?? []);
    const [planExecutions, participantExecutions, responseExecutions] = await Promise.all([
      planIds.length ? tx.sessionPlanExecution.findMany({ where: { planId: { in: planIds } } }) : [],
      participantIds.length ? tx.sessionParticipantExecution.findMany({ where: { participantId: { in: participantIds } }, select: { participantId: true, tuteeId: true } }) : [],
      currentResponses.length ? tx.sessionResponseExecution.findMany({ where: { responseId: { in: currentResponses.map((response) => response.id) } }, select: { responseId: true, userId: true, profileKind: true, profileId: true } }) : [],
    ]);
    const executionByPlan = new Map(planExecutions.map((row) => [row.planId, row]));
    const executingStudent = new Map(participantExecutions.map((row) => [row.participantId, row.tuteeId]));
    const executionByResponse = new Map(responseExecutions.map((row) => [row.responseId, row]));
    const pendingIds = new Set(currentResponses.filter((response) => response.state === "PENDING").map((response) => response.id));
    const pendingExecutions = responseExecutions.filter((row) => pendingIds.has(row.responseId));
    const tutorIds = [...new Set([...planExecutions.map((row) => row.tutorId), ...pendingExecutions.filter((row) => row.profileKind === "TUTOR").map((row) => row.profileId)])];
    const studentIds = [...new Set([...executingStudent.values(), ...pendingExecutions.filter((row) => row.profileKind === "TUTEE").map((row) => row.profileId)])];
    const [tutorProfiles, studentProfiles] = await Promise.all([
      tutorIds.length ? tx.tutor.findMany({ where: { id: { in: tutorIds } }, select: { id: true, englishName: true } }) : [],
      studentIds.length ? tx.tutee.findMany({ where: { id: { in: studentIds } }, select: { id: true, englishName: true } }) : [],
    ]);
    const tutorNames = new Map(tutorProfiles.map((row) => [row.id, row.englishName]));
    const studentNames = new Map(studentProfiles.map((row) => [row.id, row.englishName]));
    const currentStudents = new Set(context.currentStudentIds);
    const ownedSources = (plan: Pick<Plan, "participants">) => plan.participants
      .filter((person) => currentStudents.has(executingStudent.get(person.id) ?? person.tuteeId))
      .map((person) => person.tuteeId);
    const cohorts = [];
    for (const row of rows) {
      const rowContext = role === "tutee" ? { ...context, owned: ownedSources(row.plan) } : context;
      const projectedRows = projectAgendaCohort(row, role, rowContext, roomRows, calendar, now, false, tutoringPauses);
      if (projectedRows.some((projected) => projected.canArrangeException) && !(await sourceIsCurrent(tx, row.plan))) {
        for (const projected of projectedRows) { projected.canArrangeException = false; projected.unavailable = true; }
      }
      const execution = executionByPlan.get(row.planId);
      if (execution && !row.sessions.length) {
        const assignmentMap = new Map(executionAssignments.parse(execution.assignments).map((mapping) => [mapping.sourcePairingId, mapping.targetPairingId]));
        const studentMap = new Map(row.participants.map((person) => [person.tuteeId, executingStudent.get(person.id)]));
        for (const projected of projectedRows) {
          projected.tutorId = execution.tutorId;
          projected.tutorName = tutorNames.get(execution.tutorId) ?? fail("The executing tutor profile is unavailable.", "CONFLICT");
          projected.pairingIds = projected.pairingIds.map((pairingId) => assignmentMap.get(pairingId) ?? pairingId);
          projected.primaryPairingId = projected.primaryPairingId ? assignmentMap.get(projected.primaryPairingId) ?? projected.primaryPairingId : null;
          projected.tutees = projected.tutees.map((person) => {
            const id = studentMap.get(person.id);
            return id ? { id, name: studentNames.get(id) ?? fail("The executing learner profile is unavailable.", "CONFLICT") } : person;
          });
          if (projected.pausedTutees) projected.pausedTutees = projected.pausedTutees.map((person) => {
            const id = studentMap.get(person.id);
            return id ? { id, name: studentNames.get(id) ?? fail("The executing learner profile is unavailable.", "CONFLICT") } : person;
          });
        }
      }
      cohorts.push(...projectedRows);
    }
    const projected = [];
    for (const request of requests) {
      const requestOwned = role === "tutee" ? ownedSources(request.plan) : owned;
      if (
        role === "tutee" &&
        !ids(request.participantIds).some((id) => requestOwned.includes(id))
      )
        continue;
      const offer = request.offers.find(
        (row) => row.id === request.currentOfferId,
      );
      const responseName = (response: Request["offers"][number]["responses"][number]) => {
        const pin = response.state === "PENDING" ? executionByResponse.get(response.id) : undefined;
        if (pin) {
          const names = pin.profileKind === "TUTOR" ? tutorNames : studentNames;
          return names.get(pin.profileId) ?? fail("The executing response profile is unavailable.", "CONFLICT");
        }
        return response.actorKey.startsWith("tutor:") ? request.plan.tutor.englishName
          : request.plan.participants.find((person) => `tutee:${person.tuteeId}` === response.actorKey)?.tutee.englishName ?? "Tutee";
      };
      const responses =
        offer?.responses
          .filter(
            (response) =>
              role === "tutor" ||
              (executionByResponse.get(response.id)?.userId ?? response.actorUserId) === actor.id ||
              response.actorKey.startsWith("tutor:"),
          )
          .map((response) => ({
            id: response.id,
            actorKey: response.actorKey,
            name: responseName(response),
            state: response.state,
            deadline: response.deadline,
            deliveredAt: response.deliveredAt,
            acceptedBy: response.acceptedBy,
            isMe: (executionByResponse.get(response.id)?.userId ?? response.actorUserId) === actor.id,
          })) ?? [];
      const myResponse =
        responses.find(
          (response) => response.isMe && response.state === "PENDING",
        ) ??
        responses.find((response) => response.isMe) ??
        null;
      projected.push({
        id: request.id,
        version: request.version,
        planId: request.planId,
        cohortId: request.cohortId,
        kind: request.kind,
        scope: request.scope,
        status: request.status,
        stage: request.stage,
        participantIds:
          role === "tutor"
            ? ids(request.participantIds)
            : ids(request.participantIds).filter((id) => requestOwned.includes(id)),
        currentOffer: offer
          ? {
              id: offer.id,
              date: offer.date,
              startMin: offer.startMin,
              endMin: offer.endMin,
              roomId: offer.roomId,
              online: offer.online,
              startsAt: offer.startsAt,
              endsAt: offer.endsAt,
              cutoffAt: offer.cutoffAt,
              ...(await offerRequiresExplicitAgreement(tx, offer) ? { requiresExplicitAcceptance: true } : {}),
              responses,
              myResponse,
              schoolClosed: !resolvePlanningTimetableDay(offer.date, calendar)
                .isSchoolDay,
              canReject:
                myResponse?.state === "PENDING" &&
                (request.scope === "ONE" ||
                  !ids(request.rejectionKeys).includes(myResponse.actorKey)),
              canRequestSplit:
                request.status === "PENDING" &&
                request.scope === "ALL" &&
                Boolean(
                  myResponse?.actorKey &&
                  ids(request.rejectionKeys).includes(myResponse.actorKey),
                ),
            }
          : null,
      });
    }
    const notices = await tx.sessionNotice.findMany({
      where: { recipientUserId: actor.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        requestId: true,
        event: true,
        status: true,
        lastError: true,
        acceptedAt: true,
        createdAt: true,
        context: true,
      },
    });
    // Optional at the type boundary for older consumers/fixtures, but always
    // returned by this reader. Newest work is bounded without claiming a total.
    const visibleSuggestions = [];
    for (const suggestion of suggestions) {
      const sourcePlan = rows.find((row) => row.planId === suggestion.planId)?.plan;
      if (role === "tutor" || sourcePlan && ownedSources(sourcePlan).includes(suggestion.tuteeId)) visibleSuggestions.push(suggestion);
    }
    const backlogPage: { attendanceBacklogHasMore?: boolean } = {
      attendanceBacklogHasMore: backlogRows.length > 300,
    };
    return {
      ...backlogPage,
      timeZone: publication.timeZone,
      windowStart: publication.start,
      windowEnd: publication.end,
      canTutorWrite:
        role === "tutor" &&
        tutor?.status === "ACTIVE" &&
        !account.tutorAccessRevoked,
      weeklyPublication: {
        unavailable: publication.unavailable,
        normalized: publication.normalized,
        preparedThrough: publication.prepareEnd,
      },
      rooms: roomRows,
      ...(tutoringPauses.length ? {
        tutoringPauses: tutoringPauses.map(({ date, endDate, schedulingEffect, active }) => ({ date, endDate, schedulingEffect, active })),
      } : {}),
      schoolCalendarDays: calendar.map(
        (day: {
          date: string;
          isSchoolDay: boolean;
          timetableWeekday?: number | null;
          active?: boolean;
        }) => ({
          date: day.date,
          isSchoolDay: day.isSchoolDay,
          timetableWeekday: day.timetableWeekday ?? null,
          active: day.active !== false,
        }),
      ),
      cohorts,
      requests: projected,
      suggestions: visibleSuggestions.map((row) => ({
        id: row.id,
        planId: row.planId,
        cohortId: row.cohortId,
        tuteeId: row.tuteeId,
        date: row.date,
        startMin: row.startMin,
        roomId: row.roomId,
        online: row.online,
        version: row.version,
        tuteeName:
          rows
            .flatMap((item) => item.plan.participants)
            .find((person) => person.tuteeId === row.tuteeId)?.tutee
            .englishName ?? "Tutee",
      })),
      notices: notices.map((row) => ({
        ...row,
        context: sessionNoticeContext(row.context),
        actionRequired: row.event === "deadline_missed",
      })),
    };
  });
}

/** Adapter accepts the extended calendar shape without changing its owning writer/schema. */
export function resolvePlanningTimetableDay(
  date: string,
  overrides: Parameters<typeof resolvePlanningCalendarDay>[1],
) {
  return resolvePlanningCalendarDay(date, overrides);
}

/** Attendance uses the effective dated roster, never the whole recurring assignment roster. */
export async function sessionAttendanceContext(
  tx: TransactionDb,
  actor: Actor,
  cohortId: string,
  expectedVersion?: number,
  now = new Date(),
) {
  await lockSessionPlanning(tx);
  const cohort = await loadCohort(tx, cohortId);
  await requireTutor(tx, actor, cohort.plan.tutorId, cohort.plan.id);
  if (expectedVersion !== undefined && cohort.version !== expectedVersion)
    return fail(
      "The dated session changed. Reload before recording attendance.",
      "CONFLICT",
    );
  if (cohort.status !== "SCHEDULED" || cohort.endsAt > now)
    return fail(
      "Attendance is available after this scheduled session ends.",
      "CONFLICT",
    );
  if (!(await sourceIsCurrent(tx, cohort.plan, true)))
    return fail(
      "The session roster or assignments changed. Ask management to review this dated record.",
      "CONFLICT",
    );
  if (await tx.session.count({ where: { planningCohortId: cohort.id } }))
    return fail(
      "Attendance already exists for this dated session.",
      "CONFLICT",
    );
  const participants = cohort.plan.participants.filter(
    (person) => person.cohortId === cohort.id && person.status === "SCHEDULED",
  );
  if (!participants.length)
    return fail("This session has no active commitments.", "CONFLICT");
  if (await readRegularTutoringPausedAt(tx, cohort.date, cohort.startsAt)) {
    const affirmative = await affirmativePauseParticipants(tx, cohort.plan, cohort);
    if (participants.some((person) => !affirmative.has(person.tuteeId)))
      return fail("This tutoring date required explicit agreement before attendance could be recorded.", "CONFLICT");
  }
  const assignments = cohort.plan.assignments
    .map((row) => ({
      pairingId: row.pairingId,
      subject: row.subject,
      primary: row.primary,
      tuteeIds: assignmentRoster(cohort.plan, row).filter((id) =>
        participants.some((person) => person.tuteeId === id),
      ),
    }))
    .filter((row) => row.tuteeIds.length);
  assignments.sort(
    (a, b) =>
      Number(b.primary) - Number(a.primary) ||
      a.pairingId.localeCompare(b.pairingId),
  );
  const execution = await tx.sessionPlanExecution.findUnique({ where: { planId: cohort.planId } });
  const studentExecutions = execution ? await tx.sessionParticipantExecution.findMany({ where: { participantId: { in: participants.map((person) => person.id) } } }) : [];
  const studentMap = new Map(participants.map((person) => [person.tuteeId, studentExecutions.find((mapping) => mapping.participantId === person.id)?.tuteeId ?? person.tuteeId]));
  if (execution) {
    const pairingMap = new Map(executionAssignments.parse(execution.assignments).map((row) => [row.sourcePairingId, row.targetPairingId]));
    for (const assignment of assignments) {
      assignment.pairingId = pairingMap.get(assignment.pairingId) ?? assignment.pairingId;
      assignment.tuteeIds = assignment.tuteeIds.map((id) => studentMap.get(id) ?? id);
    }
  }
  return {
    cohortId: cohort.id,
    version: cohort.version,
    planId: cohort.planId,
    tutorId: execution?.tutorId ?? cohort.plan.tutorId,
    date: cohort.date,
    startMin: cohort.startMin,
    endMin: cohort.endMin,
    roomId: cohort.roomId,
    online: cohort.online,
    kind: cohort.plan.kind,
    rescheduled:
      cohort.rescheduled ||
      participants.some((person) => person.scheduleOverride),
    tuteeIds: participants.map((person) => studentMap.get(person.tuteeId) ?? person.tuteeId),
    primaryPairingId: assignments[0]!.pairingId,
    pairingIds: assignments.map((row) => row.pairingId),
    assignments,
  };
}

/** Called inside the attendance transaction after actual evidence has been saved. */
export async function markSessionCohortRecorded(
  tx: TransactionDb,
  cohortId: string,
) {
  await lockSessionPlanning(tx);
  await tx.sessionPlanCohort.update({
    where: { id: cohortId },
    data: { status: "RECORDED", version: { increment: 1 } },
  });
}

/** Continuation enrollment changes only that learner's future commitments. Original
 * publication, peer agreements and completed attendance remain retained evidence. */
export async function syncContinuationPlanMembership(
  tx: TransactionDb,
  rawInput: {
    assignmentId?: string;
    sourceSurveyId?: string;
    sourceTuteeId?: string;
    pairingId: string;
    tuteeId: string;
    joinedAt: Date;
    releasedAt?: Date;
  },
  now = new Date(),
) {
  const input = rawInput;
  if (Boolean(input.assignmentId) === Boolean(input.sourceSurveyId)) fail("Select exactly one original membership authority.");
  await lockSessionPlanning(tx);
  const sourcePairing = !input.releasedAt
    ? await tx.pairing.findUnique({ where: { id: input.pairingId } })
    : null;
  const calendar = !input.releasedAt
    ? await tx.schoolCalendarDay.findMany()
    : [];
  const tutoringPauses = !input.releasedAt ? await pauseRanges(tx) : [];
  const plans = await tx.sessionPlan.findMany({
    where: { assignments: { some: { pairingId: { in: await pairingEvidenceIds(tx, [input.pairingId]) } } } },
    include: { ...planInclude, cohorts: true },
  });
  const publications = latestContinuationPublications(plans);
  for (const plan of plans) {
    const execution = await tx.sessionPlanExecution.findUnique({ where: { planId: plan.id } });
    const executedMembers = execution ? await tx.sessionParticipantExecution.findMany({ where: { participantId: { in: plan.participants.map((row) => row.id) }, tuteeId: rawInput.tuteeId } }) : [];
    let originalMember = plan.participants.find((row) => executedMembers.some((mapping) => mapping.participantId === row.id));
    if (rawInput.sourceSurveyId) {
      const authority = executedMembers.find((row) => row.sourceSurveyIds.includes(rawInput.sourceSurveyId!));
      if (authority) {
        const otherOwners = await tx.studentRequestExecutionAssignment.findMany({ where: { surveyId: { in: authority.sourceSurveyIds.filter((id) => id !== rawInput.sourceSurveyId) }, pairingId: rawInput.pairingId, tuteeId: rawInput.tuteeId, releasedAt: null }, select: { surveyId: true, sourceTuteeId: true } });
        const open = await tx.studentSurvey.findMany({ where: { id: { in: otherOwners.map((row) => row.surveyId) }, state: "OPEN" }, select: { id: true, tuteeId: true } });
        if (open.some((row) => otherOwners.some((owner) => owner.surveyId === row.id && owner.sourceTuteeId === row.tuteeId))) continue;
        originalMember = plan.participants.find((row) => row.id === authority.participantId);
      } else {
        // Fresh canonical publications and older empty-provenance mappings are
        // released only when the exact current physical membership really ends.
        if (executedMembers.some((row) => row.sourceSurveyIds.length) || await tx.pairingTutee.count({ where: { pairingId: rawInput.pairingId, tuteeId: rawInput.tuteeId } })) continue;
        originalMember ??= plan.participants.find((row) => row.tuteeId === rawInput.tuteeId);
      }
      if (!originalMember) continue;
    }
    const originalPairing = execution ? executionAssignments.parse(execution.assignments).find((row) => row.targetPairingId === rawInput.pairingId)?.sourcePairingId : null;
    const input = { ...rawInput, pairingId: originalPairing ?? rawInput.pairingId, tuteeId: originalMember?.tuteeId ?? rawInput.tuteeId };
    if (!input.releasedAt) {
      const publication = continuationPublication(plan);
      if (
        (publication &&
          publications.get(publication.sourceDate)?.id !== plan.id) ||
        !(await assignmentSourceMatches(tx, plan, input))
      )
        continue;
    }
    const existing = plan.participants.find(
      (person) => person.tuteeId === input.tuteeId,
    );
    if (!input.releasedAt && (existing || plan.kind !== "REGULAR")) continue;
    let original = plan.cohorts.find(
      (cohort) =>
        cohort.date === plan.originalDate &&
        !cohort.rescheduled &&
        cohort.status === "SCHEDULED",
    );
    const day = resolvePlanningTimetableDay(plan.originalDate, calendar);
    const tutoringPaused = !input.releasedAt && isRegularTutoringPaused(plan.originalDate, tutoringPauses);
    const suppressed =
      !input.releasedAt &&
      (!day.isSchoolDay ||
        day.effectiveTimetableWeekday !== sourcePairing?.dayOfWeek);
    if (!input.releasedAt && !original && sourcePairing) {
      // Peers may already have completed an earlier agreed move. The new
      // learner still receives a future weekly default, never that past move.
      const window = plannedWindow(
        {
          date: plan.originalDate,
          startMin: sourcePairing.startMin,
          roomId: sourcePairing.roomId,
          online: false,
        },
        plan.timeZone,
      );
      if (window.startsAt <= now) continue;
      // Returning to the weekly clock does not erase peers' explicit consent.
      // Share only a live physical cohort; cancelled UIDs remain tombstones.
      const shared = plan.cohorts.find(
        (cohort) =>
          cohort.status === "SCHEDULED" &&
          cohort.startsAt.getTime() === window.startsAt.getTime() &&
          cohort.endsAt.getTime() === window.endsAt.getTime() &&
          cohort.roomId === window.roomId &&
          cohort.online === window.online,
      );
      // Calendar suppression remains reversible source state. Prefer any live
      // exact cohort above it; explicit cancellations never qualify here.
      const suppressedSource = plan.cohorts.find(
        (cohort) =>
          cohort.date === plan.originalDate &&
          !cohort.rescheduled &&
          cohort.status === "CANCELLED" &&
          plan.participants.some(
            (person) =>
              person.cohortId === cohort.id && (person.calendarSuppressed || person.tutoringPauseSuppressed),
          ),
      );
      const candidate: Cohort = {
        id: randomUUID(),
        planId: plan.id,
        ...window,
        status: suppressed || tutoringPaused ? "CANCELLED" : "SCHEDULED",
        sourceInvalidated: Boolean(suppressed),
        rescheduled: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      if (!shared && !suppressedSource && !suppressed && !tutoringPaused)
        await validateTarget(
          tx,
          plan,
          candidate,
          [input.tuteeId],
          candidate,
          "ALL",
          undefined,
          now,
        );
      original =
        shared ??
        suppressedSource ??
        (await tx.sessionPlanCohort.create({ data: candidate }));
    }
    if (!input.releasedAt && (!original || original.startsAt <= now)) continue;
    if (!input.releasedAt && original && !suppressed && !tutoringPaused)
      await validateTarget(
        tx,
        plan,
        original,
        [input.tuteeId],
        original,
        "ALL",
        undefined,
        now,
        undefined,
        true,
      );
    await tx.sessionPlanContinuationMember.upsert({
      where: {
        planId_pairingId_tuteeId: {
          planId: plan.id,
          pairingId: input.pairingId,
          tuteeId: input.tuteeId,
        },
      },
      create: {
        planId: plan.id,
        pairingId: input.pairingId,
        tuteeId: input.tuteeId,
        assignmentId: input.assignmentId,
        sourceSurveyId: input.sourceSurveyId,
        joinedAt: input.joinedAt,
        releasedAt: input.releasedAt,
      },
      update: input.releasedAt ? { releasedAt: input.releasedAt } : {},
    });
    if (input.releasedAt) {
      if (!existing?.cohortId) continue;
      const cohort = plan.cohorts.find((item) => item.id === existing.cohortId);
      if (!cohort || cohort.startsAt <= now || cohort.status === "RECORDED")
        continue;
      const refreshed = await tx.sessionPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: planInclude,
      });
      const stillAssigned = refreshed.assignments.some(
        (assignment) =>
          assignmentRoster(refreshed, assignment).includes(input.tuteeId) &&
          !refreshed.continuationMembers.some(
            (member) =>
              member.pairingId === assignment.pairingId &&
              member.tuteeId === input.tuteeId &&
              member.releasedAt !== null,
          ),
      );
      if (!stillAssigned) {
        await tx.sessionPlanParticipant.update({
          where: { id: existing.id },
          data: {
            status: "CANCELLED",
            calendarSuppressed: false,
            tutoringPauseSuppressed: false,
            version: { increment: 1 },
          },
        });
        const remaining = await tx.sessionPlanParticipant.count({
          where: { cohortId: cohort.id, status: "SCHEDULED" },
        });
        const changed = await tx.sessionPlanCohort.update({
          where: { id: cohort.id },
          data: {
            status: remaining ? cohort.status : "CANCELLED",
            version: { increment: 1 },
            ...(!remaining ? { sourceInvalidated: false } : {}),
          },
        });
        await notifyPlanChange(
          tx,
          refreshed,
          changed,
          "cancelled",
          cohort.startsAt,
          [input.tuteeId],
        );
      }
      const pending = await tx.sessionPlanningRequest.findMany({
        where: {
          planId: plan.id,
          status: { in: ["PENDING", "SPLIT_REQUESTED"] },
        },
        include: requestInclude,
      });
      for (const request of pending)
        if (ids(request.participantIds).includes(input.tuteeId))
          await closeRequest(tx, request, "STALE", "stale", now);
    } else if (original) {
      await tx.sessionPlanParticipant.create({
        data: {
          planId: plan.id,
          tuteeId: input.tuteeId,
          cohortId: original.id,
          status: suppressed || tutoringPaused ? "CANCELLED" : "SCHEDULED",
          scheduleOverride: false,
          calendarSuppressed: Boolean(suppressed),
          tutoringPauseSuppressed: Boolean(tutoringPaused),
        },
      });
      const changed = await tx.sessionPlanCohort.update({
        where: { id: original.id },
        data: {
          ...(!suppressed && !tutoringPaused
            ? { status: "SCHEDULED", sourceInvalidated: false }
            : {}),
          version: { increment: 1 },
        },
      });
      const refreshed = await tx.sessionPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: planInclude,
      });
      await notifyPlanChange(
        tx,
        refreshed,
        changed,
        suppressed ? "cancelled" : "schedule_updated",
        original.startsAt,
        [input.tuteeId],
      );
    }
  }
}

/** Release only this original request's published actors. Current shared roster
 * authority belongs to the remaining requests; completed cohorts stay unchanged. */
export async function releaseSessionRequestParticipation(
  tx: TransactionDb,
  input: { surveyId: string; sourceTuteeId: string; assignments: readonly { pairingId: string; tuteeId: string }[] },
  now = new Date(),
) {
  const source = await tx.studentSurvey.findUnique({ where: { id: input.surveyId }, select: { tuteeId: true, submittedAt: true } });
  if (source?.tuteeId !== input.sourceTuteeId) fail("The original request membership changed.");
  for (const assignment of input.assignments) await syncContinuationPlanMembership(tx, {
    sourceSurveyId: input.surveyId, sourceTuteeId: input.sourceTuteeId,
    pairingId: assignment.pairingId, tuteeId: assignment.tuteeId,
    joinedAt: source.submittedAt, releasedAt: now,
  }, now);
}

/** Existing lifecycle writers may call this under their room fence; reads also catch stale requests. */
export async function invalidateSessionPlansForPairings(
  tx: TransactionDb,
  pairingIds: string[],
  now = new Date(),
) {
  await lockSessionPlanning(tx);
  const plans = await tx.sessionPlan.findMany({
    where: {
      assignments: { some: { pairingId: { in: await pairingEvidenceIds(tx, pairingIds) } } },
      OR: [
        { cohorts: { some: { status: "SCHEDULED", startsAt: { gt: now } } } },
        {
          cohorts: {
            some: {
              startsAt: { gt: now },
              participants: { some: { OR: [{ calendarSuppressed: true }, { tutoringPauseSuppressed: true }] } },
            },
          },
        },
        {
          requests: {
            some: { status: { in: ["PENDING", "SPLIT_REQUESTED"] } },
          },
        },
      ],
    },
    include: planInclude,
  });
  const evidence = await loadSourceEvidence(tx, plans);
  for (const plan of plans) {
    if (await sourceIsCurrent(tx, plan, false, evidence)) continue;
    const cohorts = await tx.sessionPlanCohort.findMany({
      where: {
        planId: plan.id,
        startsAt: { gt: now },
        OR: [
          { status: "SCHEDULED" },
          { participants: { some: { OR: [{ calendarSuppressed: true }, { tutoringPauseSuppressed: true }] } } },
        ],
      },
    });
    for (const cohort of cohorts) {
      const cancelled = await tx.sessionPlanCohort.update({
        where: { id: cohort.id },
        data: {
          status: "CANCELLED",
          sourceInvalidated: false,
          version: { increment: 1 },
        },
      });
      await tx.sessionPlanParticipant.updateMany({
        where: { cohortId: cohort.id },
        data: {
          status: "CANCELLED",
          calendarSuppressed: false,
          tutoringPauseSuppressed: false,
          version: { increment: 1 },
        },
      });
      await notifyPlanChange(tx, plan, cancelled, "cancelled");
    }
    const requests = await tx.sessionPlanningRequest.findMany({
      where: {
        planId: plan.id,
        status: { in: ["PENDING", "SPLIT_REQUESTED"] },
      },
      include: requestInclude,
    });
    for (const request of requests)
      await closeRequest(tx, request, "STALE", "stale", now);
  }
}

/** Extend the existing recurring allocator with dated exceptions/holds. The caller
 * still owns ordinary weekly conflict checks and must hold this shared fence. */
export async function assertSessionPlanningWeeklyAvailable(
  tx: TransactionDb,
  schedule: {
    tutorId: string;
    termId: string;
    dayOfWeek: number;
    startMin: number;
    roomId?: string | null;
    excludePairingIds?: readonly string[];
    tuteeIds?: readonly string[];
    preservedPlanIds?: readonly string[];
  },
  now = new Date(),
) {
  await lockSessionPlanning(tx);
  if (schedule.startMin < 0 || schedule.startMin > 1395)
    return fail("Choose a 45-minute planned session within one school date.");
  const overrides = await tx.schoolCalendarDay.findMany();
  const timeZone = await getProgramTimeZone(tx);
  const excluded = new Set(await pairingEvidenceIds(tx, schedule.excludePairingIds ?? []));
  const term = await tx.term.findUniqueOrThrow({
    where: { id: schedule.termId },
  });
  const calendar = createSchoolCalendarSnapshot(overrides);
  const tutoringPauses = await pauseRanges(tx);
  let termStart: string | undefined;
  let termEnd: string | undefined;
  const applies = (date: string) => {
    const day = calendar.resolve(date);
    return (
      day.isSchoolDay &&
      !isRegularTutoringPaused(date, tutoringPauses) &&
      day.effectiveTimetableWeekday === schedule.dayOfWeek &&
      (!term.startDate ||
        date >= (termStart ??= programDateKey(term.startDate, timeZone))) &&
      (!term.endDate ||
        date <= (termEnd ??= programDateKey(term.endDate, timeZone)))
    );
  };
  const cohorts = await tx.sessionPlanCohort.findMany({
    where: { status: "SCHEDULED", startsAt: { gt: now } },
    include: {
      plan: { include: { assignments: true } },
      participants: {
        where: { status: "SCHEDULED" },
        select: { tuteeId: true },
      },
    },
    take: 5001,
  });
  if (cohorts.length > 5000)
    return fail(
      "Too many dated commitments to safely review this weekly change.",
      "CONFLICT",
    );
  const requests = await tx.sessionPlanningRequest.findMany({
    where: { status: "PENDING" },
    include: { plan: true, offers: true },
    take: 5001,
  });
  if (requests.length > 5000)
    return fail(
      "Too many pending offers to safely review this weekly change.",
      "CONFLICT",
    );
  const planIds = [...new Set([...cohorts.map((row) => row.planId), ...requests.map((row) => row.planId)])];
  const executions = await tx.sessionPlanExecution.findMany({ where: { planId: { in: planIds } } });
  const originalPeople = executions.length ? await tx.sessionPlanParticipant.findMany({ where: { planId: { in: executions.map((row) => row.planId) } }, select: { id: true, planId: true, tuteeId: true } }) : [];
  const learnerExecutions = originalPeople.length ? await tx.sessionParticipantExecution.findMany({ where: { participantId: { in: originalPeople.map((row) => row.id) } } }) : [];
  const learner = (planId: string, sourceId: string) => learnerExecutions.find((mapping) => originalPeople.some((row) => row.id === mapping.participantId && row.planId === planId && row.tuteeId === sourceId))?.tuteeId ?? sourceId;
  for (const cohort of cohorts) {
    cohort.plan.tutorId = executions.find((row) => row.planId === cohort.planId)?.tutorId ?? cohort.plan.tutorId;
    for (const person of cohort.participants) person.tuteeId = learner(cohort.planId, person.tuteeId);
  }
  for (const request of requests) {
    request.plan.tutorId = executions.find((row) => row.planId === request.planId)?.tutorId ?? request.plan.tutorId;
    request.participantIds = ids(request.participantIds).map((id) => learner(request.planId, id));
  }
  const keys = await participantKeys(
    tx,
    [
      ...new Set([
        schedule.tutorId,
        ...cohorts.map((row) => row.plan.tutorId),
        ...requests.map((row) => row.plan.tutorId),
      ]),
    ],
    [
      ...new Set([
        ...(schedule.tuteeIds ?? []),
        ...cohorts.flatMap((row) =>
          row.participants.map((person) => person.tuteeId),
        ),
        ...requests.flatMap((row) => ids(row.participantIds)),
      ]),
    ],
  );
  for (const cohort of cohorts) {
    if (schedule.preservedPlanIds?.includes(cohort.planId)) continue;
    if (
      !cohort.participants.length ||
      !applies(cohort.date) ||
      cohort.startMin >= schedule.startMin + 45 ||
      cohort.endMin <= schedule.startMin
    )
      continue;
    if (
      cohort.plan.originalDate === cohort.date &&
      cohort.plan.assignments.length &&
      cohort.plan.assignments.every((row) => excluded.has(row.pairingId))
    )
      continue;
    if (
      (schedule.roomId && schedule.roomId === cohort.roomId) ||
      participantsOverlap(
        keys,
        schedule.tutorId,
        schedule.tuteeIds ?? [],
        cohort.plan.tutorId,
        cohort.participants.map((person) => person.tuteeId),
      )
    )
      return fail(
        "The weekly change conflicts with an agreed dated session.",
        "CONFLICT",
      );
  }
  for (const request of requests) {
    if (schedule.preservedPlanIds?.includes(request.planId)) continue;
    const offer = request.offers.find(
      (row) => row.id === request.currentOfferId,
    );
    if (
      !offer ||
      !applies(offer.date) ||
      offer.startMin >= schedule.startMin + 45 ||
      offer.endMin <= schedule.startMin
    )
      continue;
    if (
      (schedule.roomId && offer.roomId === schedule.roomId) ||
      participantsOverlap(
        keys,
        schedule.tutorId,
        schedule.tuteeIds ?? [],
        request.plan.tutorId,
        ids(request.participantIds),
      )
    )
      return fail(
        "The weekly change conflicts with a pending dated offer.",
        "CONFLICT",
      );
  }
}
