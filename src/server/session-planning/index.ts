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
import { participantKeys, participantsOverlap } from "./participants";
import { sessionNoticeContext } from "~/server/session-planning-notice-copy";
import { pairingEntries } from "~/lib/pairing-groups";
import { programDateKey } from "~/lib/program-time";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { lockPlannedRoomSchedule } from "~/server/room-bookings";
import { ownedStudentIds } from "~/server/student-ownership";
import { requireSchoolParticipation } from "~/server/school-departure";
import { getProgramTimeZone } from "~/server/program/time-zone";
import { recordDomainAudit } from "~/server/audit/evidence";
import { findAccountPolicy, requirePolicy } from "~/server/policy-acceptance";

const planInclude = {
  assignments: true,
  continuationMembers: true,
  participants: { include: { tutee: true } },
  tutor: { include: { user: true } },
  term: true,
} satisfies Prisma.SessionPlanInclude;
type Plan = Prisma.SessionPlanGetPayload<{ include: typeof planInclude }>;
const requestInclude = {
  offers: { include: { responses: true } },
  plan: { include: planInclude },
} satisfies Prisma.SessionPlanningRequestInclude;
type Request = Prisma.SessionPlanningRequestGetPayload<{
  include: typeof requestInclude;
}>;
type Cohort = Prisma.SessionPlanCohortGetPayload<Record<string, never>>;
type Actor = { id: string; tutorId?: string | null };
type Versioned = { expectedVersion: number; clientKey: string };
type Proposed = PlanningTime &
  Versioned & {
    cohortId: string;
    scope: "ONE" | "ALL";
    tuteeId?: string;
    kind: "RESCHEDULE" | "EXTRA";
    suggestionId?: string;
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

async function requireTutor(tx: TransactionDb, actor: Actor, tutorId: string) {
  const account = await actorAccount(tx, actor);
  const tutor = await tx.tutor.findUnique({ where: { id: tutorId } });
  if (
    account.tutorId !== tutorId ||
    account.tutorAccessRevoked ||
    tutor?.status !== "ACTIVE"
  )
    fail("Only this active tutor can file the formal request.", "FORBIDDEN");
  await requirePolicy(tx, actor.id, "tutor-policy");
}

async function studentOwner(tx: TransactionDb, tuteeId: string) {
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

/** Compare assignment evidence, not mutable personal names or inbox addresses. */
async function sourceIsCurrent(
  tx: TransactionDb,
  plan: Plan,
  allowEndedTerm = false,
) {
  const tuteeIds = plan.participants.map((person) => person.tuteeId).sort();
  const pairingIds = plan.assignments.map((row) => row.pairingId).sort();
  const owners = await tx.studentProfileOwnership.findMany({
    where: { tuteeId: { in: tuteeIds } },
    select: { userId: true },
  });
  const linked = await tx.user.findMany({
    where: { OR: [{ tutorId: plan.tutorId }, { studentId: { in: tuteeIds } }] },
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
    (
      await tx.schoolDeparture.findUnique({
        where: { userId: plan.tutor.user.id },
      })
    )?.reason
  )
    return false;
  // Ended, published lessons retain their captured roster instead of using today's enrollment.
  if (!plan.term.active && allowEndedTerm) return true;
  return assignmentSourceMatches(tx, plan);
}

/** Consent deltas preserve a publication; an unrelated roster edit starts a new
 * publication revision. Account availability does not itself mint revisions. */
async function assignmentSourceMatches(
  tx: TransactionDb,
  plan: Plan,
  addition?: { pairingId: string; tuteeId: string },
) {
  const pairingIds = plan.assignments.map((row) => row.pairingId);
  const rows = await tx.pairing.findMany({
    where: { id: { in: plan.assignments.map((row) => row.pairingId) } },
    include: {
      tutees: {
        where: { tutee: { status: { not: "INACTIVE" } } },
        select: { tuteeId: true },
      },
    },
    orderBy: { id: "asc" },
  });
  const laterContinuations = await tx.studentContinuationAssignment.findMany({
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
  if (cohort.status !== "SCHEDULED" || cohort.startsAt <= now)
    fail(
      "This session has started or is no longer available for scheduling.",
      "CONFLICT",
    );
  if (!(await sourceIsCurrent(tx, cohort.plan)))
    fail("The assignment or roster changed. Reload the session.", "CONFLICT");
}

async function recipients(
  tx: TransactionDb,
  plan: Plan,
  participantIds: string[],
  strict = true,
) {
  const tutor = plan.tutor.user;
  if (!tutor?.email && strict)
    fail("The tutor needs a linked account and mailbox.");
  const result: {
    actorKey: string;
    user: NonNullable<typeof tutor>;
    name: string;
  }[] = tutor?.email
    ? [
        {
          actorKey: `tutor:${plan.tutorId}`,
          user: tutor,
          name: plan.tutor.englishName,
        },
      ]
    : [];
  for (const tuteeId of participantIds) {
    let user: Awaited<ReturnType<typeof studentOwner>>;
    try {
      user = await studentOwner(tx, tuteeId);
    } catch (error) {
      if (strict) throw error;
      // Lifecycle outcomes must commit even if one former recipient can no longer receive mail.
      const ownership = await tx.studentProfileOwnership.findUnique({
        where: { tuteeId },
      });
      const previous = ownership
        ? await tx.user.findUnique({ where: { id: ownership.userId } })
        : await tx.user.findFirst({ where: { studentId: tuteeId } });
      if (!previous) continue;
      user = previous;
    }
    result.push({
      actorKey: `tutee:${tuteeId}`,
      user,
      name:
        plan.participants.find((row) => row.tuteeId === tuteeId)?.tutee
          .englishName ?? "Tutee",
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
  plan: Plan,
  time: PlanningTime,
  participantIds: string[],
  source: Cohort,
  scope: string,
  excludeRequestId?: string,
  now = new Date(),
  sharingSource = false,
) {
  let window: ReturnType<typeof plannedWindow>;
  try {
    window = plannedWindow(time, plan.timeZone);
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
    !(await tx.room.findUnique({ where: { id: window.roomId } }))
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
    currentRequest?.kind === "EXTRA" ? sharedExtra?.id : plan.id;
  const sourceRoster = await tx.sessionPlanParticipant.findMany({
    where: { cohortId: source.id, status: "SCHEDULED" },
    select: { tuteeId: true },
  });
  const mayReleaseSource =
    currentRequest?.kind !== "EXTRA" &&
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
  const overlap = {
    startsAt: { lt: window.endsAt },
    endsAt: { gt: window.startsAt },
    status: "SCHEDULED",
  };
  const cohorts = await tx.sessionPlanCohort.findMany({
    where: overlap,
    include: { plan: true, participants: { where: { status: "SCHEDULED" } } },
  });
  const holds = await tx.sessionPlanningRequest.findMany({
    where: {
      status: "PENDING",
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
    },
    include: { plan: true, offers: true },
  });
  const calendar = await tx.schoolCalendarDay.findMany();
  const timetable = resolvePlanningTimetableDay(time.date, calendar);
  const weekday = new Date(`${time.date}T00:00:00Z`).getUTCDay() || 7;
  const recurring = !timetable.isSchoolDay
    ? []
    : await tx.pairing.findMany({
        where: {
          termId: plan.termId,
          scheduleConfirmed: true,
          dayOfWeek: timetable.effectiveTimetableWeekday ?? weekday,
          startMin: { lt: window.endMin },
        },
        include: { tutees: { select: { tuteeId: true } } },
      });
  const keys = await participantKeys(
    tx,
    [
      ...new Set([
        plan.tutorId,
        ...cohorts.map((row) => row.plan.tutorId),
        ...holds.map((row) => row.plan.tutorId),
        ...recurring.map((row) => row.tutorId),
      ]),
    ],
    [
      ...new Set([
        ...participantIds,
        ...cohorts.flatMap((row) =>
          row.participants.map((person) => person.tuteeId),
        ),
        ...holds.flatMap((row) => ids(row.participantIds)),
        ...recurring.flatMap((row) =>
          row.tutees.map((person) => person.tuteeId),
        ),
      ]),
    ],
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
        keys,
        plan.tutorId,
        participantIds,
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
          keys,
          plan.tutorId,
          participantIds,
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
    (await tx.roomUnavailability.findFirst({
      where: {
        roomId: window.roomId,
        dayOfWeek: weekday,
        startMin: { lt: window.endMin },
        endMin: { gt: window.startMin },
      },
    }))
  )
    fail("That room is blocked during this time.", "CONFLICT");
  // Unmaterialized recurrence must participate too; a dated exception replaces its own default.
  for (const pairing of recurring) {
    if (pairing.startMin + 45 <= window.startMin) continue;
    const own =
      plan.assignments.some((row) => row.pairingId === pairing.id) &&
      time.date === plan.originalDate;
    if (own && (mayReleaseSource || mayShareSource)) continue;
    const materialized = await tx.sessionPlanAssignment.findFirst({
      where: {
        pairingId: pairing.id,
        plan: { originalDate: time.date, kind: "REGULAR" },
      },
    });
    if (materialized) continue; // effective cohorts checked above, including cancellation/moves
    if (
      (window.roomId && pairing.roomId === window.roomId) ||
      participantsOverlap(
        keys,
        plan.tutorId,
        participantIds,
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
  plan: Plan,
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
  for (const person of audience)
    await tx.sessionNotice.upsert({
      where: {
        dedupeKey: `cohort:${cohort.id}:${cohort.version}:${event}:${person.actorKey}`,
      },
      update: {},
      create: {
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
      },
    });
}

async function reconcileOrdinaryPlans(
  tx: TransactionDb,
  prefix: string,
  schedule: { dayOfWeek: number; startMin: number; roomId: string | null },
  timeZone: string,
  overrides: Parameters<typeof resolvePlanningTimetableDay>[1],
  now: Date,
) {
  const scheduleHash = fingerprint([
    schedule.dayOfWeek,
    schedule.startMin,
    schedule.roomId,
    timeZone,
    overrides
      .map((day) => resolvePlanningTimetableDay(day.date, overrides))
      .sort((a, b) => a.date.localeCompare(b.date)),
  ]);
  const plans = await tx.sessionPlan.findMany({
    where: {
      generationKey: { startsWith: prefix },
      kind: "REGULAR",
      OR: [
        { sourceScheduleFingerprint: { not: scheduleHash } },
        { cohorts: { some: { sourceInvalidated: true } } },
        { participants: { some: { calendarSuppressed: true } } },
      ],
    },
    include: planInclude,
  });
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
          !person.scheduleOverride &&
          (person.status === "SCHEDULED" || person.calendarSuppressed),
      );
      const protectedPeople = people.filter(
        (person) => person.scheduleOverride && person.status === "SCHEDULED",
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
      const day = resolvePlanningTimetableDay(plan.originalDate, overrides);
      const applies =
        day.isSchoolDay && day.effectiveTimetableWeekday === schedule.dayOfWeek;
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
        window && clockChanged
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
      if (window && clockChanged && (protectedPeople.length || shared)) {
        // A shared clock does not transfer one learner's explicit agreement to peers.
        // Exact matches coalesce into one physical lesson even when the ordinary
        // source has no protected learner left; an emptied source retires its UID.
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
  return inTransaction(db, async (tx) => {
    await lockPlanningEntry(tx);
    const timeZone = await getProgramTimeZone(tx);
    const weeks = planningWeeks(now, timeZone);
    const affected = await tx.sessionPlanAssignment.findMany({
      where: {
        plan: {
          cohorts: {
            some: {
              startsAt: { gt: now },
              OR: [
                { status: "SCHEDULED" },
                { participants: { some: { calendarSuppressed: true } } },
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
    let normalized = 0;
    const overrides = await tx.schoolCalendarDay.findMany();
    for (const entry of pairingEntries(rows)) {
      const primary = entry.primary;
      if (
        entry.groupStatus === "needsRepair" ||
        !primary.tutees.length ||
        primary.startMin > 1395
      ) {
        unavailable++;
        continue;
      }
      if (primary.endMin - primary.startMin !== 45) normalized++;
      const prefix = `regular:${primary.termId}:${entry.id}:`;
      const scheduleHash = await reconcileOrdinaryPlans(
        tx,
        prefix,
        primary,
        timeZone,
        overrides,
        now,
      );
      const rosterHash = fingerprint(
        entry.pairings.map((row) => [
          row.id,
          row.subject,
          row.tutees.map((item) => item.tuteeId).sort(),
        ]),
      );
      const continuationCount = await tx.studentContinuationPairing.count({
        where: {
          pairingId: { in: entry.pairings.map((pairing) => pairing.id) },
        },
      });
      const continuing = continuationCount === entry.pairings.length;
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
        const day = resolvePlanningTimetableDay(date, overrides);
        if (
          !day.isSchoolDay ||
          day.effectiveTimetableWeekday !== primary.dayOfWeek
        )
          continue;
        if (
          (primary.term.startDate &&
            date < programDateKey(primary.term.startDate, timeZone)) ||
          (primary.term.endDate &&
            date > programDateKey(primary.term.endDate, timeZone))
        )
          continue;
        // Only explicit consent deltas retain the current publication. Manual
        // roster edits replace its cancelled future plans, including a later
        // return to an older roster; obsolete publications are never revived.
        const continuationKey = `${prefix}${date}:continuation`;
        const previous = publications?.get(continuationKey);
        if (previous && (await assignmentSourceMatches(tx, previous))) continue;
        const generationKey = continuing
          ? `${continuationKey}:${previous ? continuationPublication(previous)!.revision + 1 : 0}`
          : `${prefix}${date}:${rosterHash}`;
        if (await tx.sessionPlan.findUnique({ where: { generationKey } }))
          continue;
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
          );
        } catch {
          unavailable++;
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
        await tx.sessionPlan.create({
          data: {
            id: planId,
            generationKey,
            tutorId: primary.tutorId,
            termId: primary.termId,
            originalDate: date,
            timeZone,
            sourceScheduleFingerprint: scheduleHash,
            sourceFingerprint: rosterHash,
            assignments: {
              create: entry.pairings.map((row, index) => ({
                pairingId: row.id,
                subject: row.subject,
                tuteeIds: row.tutees.map((item) => item.tuteeId),
                primary: index === 0,
              })),
            },
          },
        });
        let available = true;
        const plan = await tx.sessionPlan.findUniqueOrThrow({
          where: { id: planId },
          include: planInclude,
        });
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
          await validateTarget(
            tx,
            plan,
            window,
            roster,
            candidate,
            "ALL",
            undefined,
            now,
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
            sourceInvalidated: !available,
          },
        });
        await tx.sessionPlanParticipant.createMany({
          data: roster.map((tuteeId) => ({
            planId,
            tuteeId,
            cohortId,
            status: available ? "SCHEDULED" : "CANCELLED",
            calendarSuppressed: !available,
          })),
        });
        const complete = await tx.sessionPlan.findUniqueOrThrow({
          where: { id: planId },
          include: planInclude,
        });
        await notifyPlanChange(
          tx,
          complete,
          published,
          available ? "schedule_updated" : "cancelled",
        );
      }
    }
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
  if (
    !(await sourceIsCurrent(tx, request.plan)) ||
    (source.status !== "SCHEDULED" && !calendarSuppressed) ||
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
      (person.status === "SCHEDULED" || person.calendarSuppressed),
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
        data: { planId: targetPlanId, tuteeId, cohortId: cohort.id },
      });
    else
      await tx.sessionPlanParticipant.update({
        where: { planId_tuteeId: { planId: request.planId, tuteeId } },
        data: {
          cohortId: cohort.id,
          status: "SCHEDULED",
          scheduleOverride: true,
          calendarSuppressed: false,
          version: { increment: 1 },
        },
      });
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
    automatic ? "autoaccepted" : "accepted",
    now,
  );
}

/** Only provider acceptance of the current essential notice starts this response's 24 hours. */
export async function markSessionResponseDelivered(
  tx: TransactionDb,
  responseId: string,
  acceptedAt: Date,
) {
  await lockSessionPlanning(tx);
  const response = await tx.sessionPlanningResponse.findUnique({
    where: { id: responseId },
    include: { offer: { include: { request: true } } },
  });
  if (
    response?.state !== "PENDING" ||
    response.deliveredAt ||
    response.offer.request.status !== "PENDING" ||
    response.offer.request.currentOfferId !== response.offerId
  )
    return false;
  await tx.sessionPlanningResponse.update({
    where: { id: response.id },
    data: {
      deliveredAt: acceptedAt,
      deadline: responseDeadline(acceptedAt, response.offer.cutoffAt),
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
  if (
    offer.responses.some(
      (response) =>
        !audience.some(
          (person) =>
            person.actorKey === response.actorKey &&
            person.user.id === response.actorUserId,
        ),
    )
  ) {
    await closeRequest(tx, request, "STALE", "stale", now);
    return;
  }
  // Cutoff wins over late mail and late worker execution: short notice never invents consent.
  if (offer.cutoffAt <= now) {
    const missedAutomaticWindow = offer.responses.some(
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
  const changed = await tx.sessionPlanningResponse.updateMany({
    where: {
      offerId: offer.id,
      state: "PENDING",
      deliveredAt: { not: null },
      deadline: { lte: now },
    },
    data: { state: "ACCEPTED", acceptedBy: "TIMEOUT", respondedAt: now },
  });
  if (changed.count)
    await tx.sessionPlanningRequest.update({
      where: { id: request.id },
      data: { version: { increment: 1 } },
    });
  const current = await reloadRequest(tx, request.id);
  await finishAgreement(tx, current, now, true);
  const latest = await reloadRequest(tx, request.id);
  if (changed.count && latest.status === "PENDING")
    await notice(tx, latest, "response_autoaccepted");
}

export async function sweepSessionPlanning(db: DomainDb, now = new Date()) {
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
      await inTransaction(db, async (tx) => {
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
      });
    } catch {
      console.error(
        "[session-planning] One request could not settle; remaining deadlines continue.",
      );
      await inTransaction(db, async (tx) => {
        await lockPlanningEntry(tx);
        const current = await tx.sessionPlanningRequest.findUnique({
          where: { id: candidate.id },
          select: { updatedAt: true },
        });
        if (current)
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
      });
    }
  }
  return candidates.length;
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
      const owned = await ownedStudentIds(tx, actor.id);
      const participant = cohort.plan.participants.find(
        (row) =>
          row.cohortId === cohort.id &&
          row.status === "SCHEDULED" &&
          owned.includes(row.tuteeId),
      );
      if (!participant)
        return fail(
          "Only this session's tutee can suggest a change.",
          "FORBIDDEN",
        );
      await validateTarget(
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
              startsAt: plannedWindow(
                input,
                cohort.plan.timeZone,
              ).startsAt.toISOString(),
              endsAt: plannedWindow(
                input,
                cohort.plan.timeZone,
              ).endsAt.toISOString(),
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
      await requireTutor(tx, actor, cohort.plan.tutorId);
      await ensureWritable(tx, cohort, input.expectedVersion, now);
      const roster = cohort.plan.participants
        .filter(
          (row) => row.cohortId === cohort.id && row.status === "SCHEDULED",
        )
        .map((row) => row.tuteeId);
      const people =
        input.scope === "ALL"
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
  if (account.tutorId === request.plan.tutorId) {
    await requireTutor(tx, actor, request.plan.tutorId);
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
      const response = offer.responses.find(
        (row) => row.actorKey === key && row.actorUserId === actor.id,
      );
      if (response?.state !== "PENDING")
        return fail(
          "Your response is already recorded or is not required.",
          "CONFLICT",
        );
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
        await requireTutor(tx, actor, parent.plan.tutorId);
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
                row.actorUserId === actor.id &&
                row.state === "ACCEPTED",
            ) &&
            offer.responses.some(
              (row) =>
                row.actorKey === `tutee:${tuteeId}` &&
                row.actorUserId === owner.id &&
                row.state === "ACCEPTED",
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

export async function readSessionAgenda(
  db: DomainDb,
  actor: Actor,
  role: "tutor" | "tutee",
  now = new Date(),
) {
  const publication = await ensureSessionPlanningWindow(db, now);
  await sweepSessionPlanning(db, now);
  return inTransaction(db, async (tx) => {
    await actorAccount(tx, actor);
    const owned = await ownedStudentIds(tx, actor.id);
    const account = await tx.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    if (role === "tutee" && !account.tuteeMember)
      return fail(
        "Accept the tutee policy before entering the tutee area.",
        "FORBIDDEN",
      );
    const tutor = account.tutorId
      ? await tx.tutor.findUnique({ where: { id: account.tutorId } })
      : null;
    if (role === "tutor" && (!tutor || account.tutorAccessRevoked))
      return fail("Tutor access is required.", "FORBIDDEN");
    const visibility: Prisma.SessionPlanWhereInput =
      role === "tutor"
        ? { tutorId: tutor!.id }
        : { participants: { some: { tuteeId: { in: owned } } } };
    const rows = await tx.sessionPlanCohort.findMany({
      where: {
        plan: visibility,
        OR: [
          { date: { gte: publication.start, lte: publication.end } },
          { endsAt: { lt: now }, status: "SCHEDULED", sessions: { none: {} } },
        ],
      },
      include: {
        plan: { include: planInclude },
        participants: { include: { tutee: true } },
        sessions: { select: { id: true } },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 300,
    });
    const roomRows = await tx.room.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const calendar = await tx.schoolCalendarDay.findMany();
    const cohorts = rows.flatMap((row) => {
      const roster = row.participants.filter(
        (person) => person.status === "SCHEDULED",
      );
      if (
        role === "tutee" &&
        !row.participants.some((person) => owned.includes(person.tuteeId))
      )
        return [];
      const personal =
        role === "tutee"
          ? row.participants.filter((person) => owned.includes(person.tuteeId))
          : roster;
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
          roomName:
            roomRows.find((room) => room.id === row.roomId)?.name ?? null,
          online: row.online,
          kind: row.plan.kind,
          rescheduled:
            role === "tutee"
              ? personal.some((person) => person.scheduleOverride)
              : row.rescheduled ||
                roster.some((person) => person.scheduleOverride),
          schoolClosed: !resolvePlanningTimetableDay(row.date, calendar)
            .isSchoolDay,
          unavailable: row.sourceInvalidated,
          status:
            role === "tutee" &&
            personal.every((person) => person.status === "CANCELLED")
              ? "CANCELLED"
              : row.sessions.length
                ? "RECORDED"
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
              ? roster.map((person) => ({
                  id: person.tuteeId,
                  name: person.tutee.englishName,
                }))
              : roster
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
            role === "tutor" &&
            tutor?.status === "ACTIVE" &&
            !row.sessions.length &&
            roster.length > 0 &&
            sorted.length > 0 &&
            row.status === "SCHEDULED" &&
            row.endsAt <= now,
        },
      ];
    });
    const requests = await tx.sessionPlanningRequest.findMany({
      where: {
        plan: visibility,
        status: { in: ["PENDING", "SPLIT_REQUESTED"] },
      },
      include: requestInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const projected = [];
    for (const request of requests) {
      if (
        role === "tutee" &&
        !ids(request.participantIds).some((id) => owned.includes(id))
      )
        continue;
      const offer = request.offers.find(
        (row) => row.id === request.currentOfferId,
      );
      const responses =
        offer?.responses
          .filter(
            (response) =>
              role === "tutor" ||
              response.actorUserId === actor.id ||
              response.actorKey.startsWith("tutor:"),
          )
          .map((response) => ({
            id: response.id,
            actorKey: response.actorKey,
            name: response.actorKey.startsWith("tutor:")
              ? request.plan.tutor.englishName
              : (request.plan.participants.find(
                  (person) => `tutee:${person.tuteeId}` === response.actorKey,
                )?.tutee.englishName ?? "Tutee"),
            state: response.state,
            deadline: response.deadline,
            deliveredAt: response.deliveredAt,
            acceptedBy: response.acceptedBy,
            isMe: response.actorUserId === actor.id,
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
            : ids(request.participantIds).filter((id) => owned.includes(id)),
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
    const suggestions = await tx.sessionPlanningSuggestion.findMany({
      where: {
        usedAt: null,
        plan: visibility,
        ...(role === "tutee" ? { tuteeId: { in: owned } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
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
    return {
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
      suggestions: suggestions.map((row) => ({
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
  await requireTutor(tx, actor, cohort.plan.tutorId);
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
  return {
    cohortId: cohort.id,
    version: cohort.version,
    planId: cohort.planId,
    tutorId: cohort.plan.tutorId,
    date: cohort.date,
    startMin: cohort.startMin,
    endMin: cohort.endMin,
    roomId: cohort.roomId,
    online: cohort.online,
    kind: cohort.plan.kind,
    rescheduled:
      cohort.rescheduled ||
      participants.some((person) => person.scheduleOverride),
    tuteeIds: participants.map((person) => person.tuteeId),
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
  input: {
    assignmentId: string;
    pairingId: string;
    tuteeId: string;
    joinedAt: Date;
    releasedAt?: Date;
  },
  now = new Date(),
) {
  await lockSessionPlanning(tx);
  const sourcePairing = !input.releasedAt
    ? await tx.pairing.findUnique({ where: { id: input.pairingId } })
    : null;
  const calendar = !input.releasedAt
    ? await tx.schoolCalendarDay.findMany()
    : [];
  const plans = await tx.sessionPlan.findMany({
    where: { assignments: { some: { pairingId: input.pairingId } } },
    include: { ...planInclude, cohorts: true },
  });
  const publications = latestContinuationPublications(plans);
  for (const plan of plans) {
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
          cohort.sourceInvalidated &&
          plan.participants.some(
            (person) =>
              person.cohortId === cohort.id && person.calendarSuppressed,
          ),
      );
      const candidate: Cohort = {
        id: randomUUID(),
        planId: plan.id,
        ...window,
        status: suppressed ? "CANCELLED" : "SCHEDULED",
        sourceInvalidated: Boolean(suppressed),
        rescheduled: false,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      if (!shared && !suppressedSource && !suppressed)
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
    if (!input.releasedAt && original && !suppressed)
      await validateTarget(
        tx,
        plan,
        original,
        [input.tuteeId],
        original,
        "ALL",
        undefined,
        now,
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
          status: suppressed ? "CANCELLED" : "SCHEDULED",
          scheduleOverride: false,
          calendarSuppressed: Boolean(suppressed),
        },
      });
      const changed = await tx.sessionPlanCohort.update({
        where: { id: original.id },
        data: {
          ...(!suppressed
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

/** Existing lifecycle writers may call this under their room fence; reads also catch stale requests. */
export async function invalidateSessionPlansForPairings(
  tx: TransactionDb,
  pairingIds: string[],
  now = new Date(),
) {
  await lockSessionPlanning(tx);
  const plans = await tx.sessionPlan.findMany({
    where: {
      assignments: { some: { pairingId: { in: pairingIds } } },
      OR: [
        { cohorts: { some: { status: "SCHEDULED", startsAt: { gt: now } } } },
        {
          cohorts: {
            some: {
              startsAt: { gt: now },
              participants: { some: { calendarSuppressed: true } },
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
  for (const plan of plans) {
    if (await sourceIsCurrent(tx, plan)) continue;
    const cohorts = await tx.sessionPlanCohort.findMany({
      where: {
        planId: plan.id,
        startsAt: { gt: now },
        OR: [
          { status: "SCHEDULED" },
          { participants: { some: { calendarSuppressed: true } } },
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
  },
  now = new Date(),
) {
  await lockSessionPlanning(tx);
  if (schedule.startMin < 0 || schedule.startMin > 1395)
    return fail("Choose a 45-minute planned session within one school date.");
  const overrides = await tx.schoolCalendarDay.findMany();
  const timeZone = await getProgramTimeZone(tx);
  const excluded = new Set(schedule.excludePairingIds ?? []);
  const term = await tx.term.findUniqueOrThrow({
    where: { id: schedule.termId },
  });
  const applies = (date: string) => {
    const day = resolvePlanningTimetableDay(date, overrides);
    return (
      day.isSchoolDay &&
      day.effectiveTimetableWeekday === schedule.dayOfWeek &&
      (!term.startDate || date >= programDateKey(term.startDate, timeZone)) &&
      (!term.endDate || date <= programDateKey(term.endDate, timeZone))
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
