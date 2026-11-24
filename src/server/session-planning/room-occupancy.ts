import { TRPCError } from "@trpc/server";
import { createSchoolCalendarSnapshot } from "~/lib/school-calendar";
import { isRegularTutoringPaused } from "~/lib/tutoring-policy";
import { programDateKey } from "~/lib/program-time";
import { getProgramTimeZone } from "~/server/program/time-zone-reader";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import {
  executionAssignments,
  pairingEvidenceIds,
  supersededPairingIds,
} from "~/server/participant-execution";
import { plannedWindow } from "~/lib/session-planning";
import { readSessionRefreshSchedules, readSessionRequestSources, sessionExceedsRefresh, sessionRefreshSuppressed, sessionRequestSourceSuppressed } from "./refresh-boundary";

export type OrdinaryCohortCandidate = {
  id: string;
  planId: string;
  date: string;
  startMin: number;
  roomId: string | null;
  rescheduled?: boolean;
  plan: {
    kind?: string;
    termId: string;
    tutorId?: string;
    originalDate: string;
    assignments: readonly { pairingId: string }[];
  };
  participants: readonly { scheduleOverride?: boolean }[];
};

export type OrdinaryCohortStatus = {
  /** True iff the source pairings are still active, confirmed, unsplit,
   * populated, on this exact timetable weekday + startMin, and belong to
   * this tutor/term. */
  scheduleLive: boolean;
  /** True iff scheduleLive AND every source pairing still holds cohort.roomId. */
  roomLive: boolean;
  /** Active tutee IDs (in executing-ID space) still rostered on non-excluded
   * source pairings when scheduleLive is true. */
  liveOrdinaryTuteeIds: Set<string>;
};

type PlanExecutionRow = {
  planId: string;
  tutorId: string;
  assignments: unknown;
};

/** Only an unmoved REGULAR publication with captured source assignments can be
 * a lazily reconciled ordinary weekly projection. Extras, moved dates and
 * explicitly rescheduled cohorts are always treated as dated commitments. */
export function isOrdinaryRegularCohort(
  cohort: OrdinaryCohortCandidate,
): boolean {
  return (
    cohort.plan.kind === "REGULAR" &&
    !cohort.rescheduled &&
    cohort.date === cohort.plan.originalDate &&
    cohort.plan.assignments.length > 0
  );
}

/** Check whether ordinary unmoved REGULAR cohorts still match their live
 * source pairings. Weekly schedule edits mark dirty events rather than
 * rewriting SessionPlanCohort rows synchronously, so stale ordinary projections
 * from moved, split, unscheduled, room-changed or deleted pairings must not
 * falsely block subsequent weekly slot or room changes. */
export async function evaluateOrdinaryCohorts(
  tx: TransactionDb,
  cohorts: readonly OrdinaryCohortCandidate[],
  calendar: ReturnType<typeof createSchoolCalendarSnapshot>,
  excluded: ReadonlySet<string>,
  preloadedExecutions?: readonly PlanExecutionRow[],
): Promise<Map<string, OrdinaryCohortStatus>> {
  const result = new Map<string, OrdinaryCohortStatus>();
  const candidates = cohorts.filter(isOrdinaryRegularCohort);
  if (!candidates.length) return result;

  const planIds = [...new Set(candidates.map((cohort) => cohort.planId))];
  const executions =
    preloadedExecutions ??
    (await tx.sessionPlanExecution.findMany({
      where: { planId: { in: planIds } },
      select: { planId: true, tutorId: true, assignments: true },
    }));
  const executionByPlanId = new Map(
    executions.map((row) => [row.planId, row]),
  );

  const assignmentMaps = new Map<
    string,
    { sourcePairingId: string; livePairingId: string }[]
  >();
  const livePairingIds = new Set<string>();
  for (const cohort of candidates) {
    const execution = executionByPlanId.get(cohort.planId);
    const remapped = execution
      ? new Map(
          executionAssignments
            .parse(execution.assignments)
            .map((row) => [row.sourcePairingId, row.targetPairingId]),
        )
      : null;
    const mapped = cohort.plan.assignments.map((row) => {
      const livePairingId = remapped?.get(row.pairingId) ?? row.pairingId;
      livePairingIds.add(livePairingId);
      return { sourcePairingId: row.pairingId, livePairingId };
    });
    assignmentMaps.set(cohort.id, mapped);
  }

  const [superseded, pairings] = await Promise.all([
    supersededPairingIds(tx),
    tx.pairing.findMany({
      where: { id: { in: [...livePairingIds] } },
      select: {
        id: true,
        tutorId: true,
        termId: true,
        groupId: true,
        scheduleConfirmed: true,
        dayOfWeek: true,
        startMin: true,
        roomId: true,
        term: { select: { active: true } },
        tutor: { select: { status: true } },
        tutees: {
          where: { tutee: { status: { not: "INACTIVE" } } },
          select: { tuteeId: true },
        },
      },
    }),
  ]);
  const supersededSet = new Set(superseded);
  const pairingById = new Map(pairings.map((row) => [row.id, row]));

  for (const cohort of candidates) {
    const mapped = assignmentMaps.get(cohort.id)!;
    const rows = mapped
      .map((item) => pairingById.get(item.livePairingId))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const day = calendar.resolve(cohort.date);
    const execution = executionByPlanId.get(cohort.planId);
    const expectedTutorId = execution?.tutorId ?? cohort.plan.tutorId;
    const sharedGroupId = rows.length > 1 ? rows[0]?.groupId : null;
    const scheduleLive =
      day.isSchoolDay &&
      rows.length === mapped.length &&
      rows.every(
        (row) =>
          !supersededSet.has(row.id) &&
          row.scheduleConfirmed &&
          row.term.active &&
          row.tutor.status === "ACTIVE" &&
          row.termId === cohort.plan.termId &&
          (expectedTutorId === undefined || row.tutorId === expectedTutorId) &&
          row.dayOfWeek === day.effectiveTimetableWeekday &&
          row.startMin === cohort.startMin &&
          (rows.length <= 1 ||
            (sharedGroupId !== null && row.groupId === sharedGroupId)),
      ) &&
      rows.some((row) => row.tutees.length > 0);

    const liveOrdinaryTuteeIds = new Set<string>();
    if (scheduleLive) {
      for (const item of mapped) {
        if (
          excluded.has(item.sourcePairingId) ||
          excluded.has(item.livePairingId)
        )
          continue;
        const row = pairingById.get(item.livePairingId);
        if (!row) continue;
        for (const tutee of row.tutees) liveOrdinaryTuteeIds.add(tutee.tuteeId);
      }
    }

    const roomLive =
      scheduleLive && rows.every((row) => row.roomId === cohort.roomId);

    result.set(cohort.id, {
      scheduleLive,
      roomLive,
      liveOrdinaryTuteeIds,
    });
  }

  return result;
}

type RoomSchedule = {
  preservedPlanIds?: readonly string[];
  termId: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  excludePairingIds?: readonly string[];
  excludePairingId?: string;
};

/** Caller owns planned-room-schedule. This module never imports the allocator or
 * planning service, so the final room guard has no runtime dependency cycle. */
export async function datedUnavailableRooms(
  tx: TransactionDb,
  schedule: RoomSchedule,
  roomIds: string[],
  now = new Date(),
) {
  if (!roomIds.length) return new Set<string>();
  await lockEntity(tx, "session-planning");
  const [calendar, term, timeZone, cohorts, requests, tutoringPauses, refreshSchedules] = await Promise.all([
    tx.schoolCalendarDay.findMany(),
    tx.term.findUniqueOrThrow({ where: { id: schedule.termId } }),
    getProgramTimeZone(tx),
    tx.sessionPlanCohort.findMany({
      where: {
        status: "SCHEDULED",
        startsAt: { gt: now },
        roomId: { in: roomIds },
      },
      include: {
        plan: { include: { assignments: true } },
        participants: {
          where: { status: "SCHEDULED" },
          select: { id: true, scheduleOverride: true },
        },
      },
      take: 5001,
    }),
    tx.sessionPlanningRequest.findMany({
      where: {
        status: "PENDING",
        kind: { not: "CANCEL" },
        offers: { some: { roomId: { in: roomIds } } },
      },
      include: { offers: true, plan: { select: { termId: true } } },
      take: 5001,
    }),
    tx.programCalendarDay.findMany({ where: { active: true, schedulingEffect: "PAUSE_REGULAR" } }),
    readSessionRefreshSchedules(tx),
  ]);
  if (cohorts.length > 5000 || requests.length > 5000)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Too many dated room bookings to safely review this change.",
    });
  // Inactive historical periods never publish future weekly sessions and must
  // not collide with live dated bookings from a newer active period.
  if (term.active === false) return new Set<string>();
  const excluded = new Set(await pairingEvidenceIds(tx, [
    ...(schedule.excludePairingIds ?? []),
    ...(schedule.excludePairingId ? [schedule.excludePairingId] : []),
  ]));
  const requestSources = await readSessionRequestSources(tx, requests);
  const calendarSnapshot = createSchoolCalendarSnapshot(calendar);
  // Keep these facts local to the transaction. Resolve bounds only when reached,
  // preserving short-circuit validation for empty or nonapplicable reservations.
  let termStart: string | undefined;
  let termEnd: string | undefined;
  const scheduledRefresh = refreshSchedules.get(schedule.termId);
  const applies = (date: string, start: number, end: number) => {
    const day = calendarSnapshot.resolve(date);
    return (
      day.isSchoolDay &&
      !isRegularTutoringPaused(date, tutoringPauses) &&
      day.effectiveTimetableWeekday === schedule.dayOfWeek &&
      start < schedule.startMin + 45 &&
      end > schedule.startMin &&
      (!term.startDate ||
        date >= (termStart ??= programDateKey(term.startDate, timeZone))) &&
      (!term.endDate ||
        date <= (termEnd ??= programDateKey(term.endDate, timeZone))) &&
      (scheduledRefresh?.state !== "SCHEDULED" || !sessionRefreshSuppressed(plannedWindow({ date, startMin: schedule.startMin, online: false }, timeZone), scheduledRefresh, now))
    );
  };
  const blocked = new Set<string>();
  const ordinaryCandidates: (typeof cohorts)[number][] = [];
  for (const cohort of cohorts) {
    if (schedule.preservedPlanIds?.includes(cohort.planId)) continue;
    if (
      !cohort.roomId ||
      cohort.refreshSuppressed || sessionRefreshSuppressed(cohort, refreshSchedules.get(cohort.plan.termId), now) ||
      !cohort.participants.length ||
      !applies(cohort.date, cohort.startMin, cohort.endMin)
    )
      continue;
    const own =
      cohort.plan.originalDate === cohort.date &&
      cohort.plan.assignments.length > 0 &&
      (cohort.plan.assignments.every((row) => excluded.has(row.pairingId)) ||
        (cohort.startMin === schedule.startMin &&
          (cohort.endMin === schedule.endMin ||
            cohort.endMin === schedule.startMin + 45) &&
          cohort.plan.assignments.some((row) => excluded.has(row.pairingId))));
    if (own) continue;
    if (
      isOrdinaryRegularCohort(cohort) &&
      cohort.participants.every((person) => !person.scheduleOverride)
    )
      ordinaryCandidates.push(cohort);
    else blocked.add(cohort.roomId);
  }
  if (ordinaryCandidates.length) {
    const ordinaryStatus = await evaluateOrdinaryCohorts(
      tx,
      ordinaryCandidates,
      calendarSnapshot,
      excluded,
    );
    for (const cohort of ordinaryCandidates)
      if (cohort.roomId && ordinaryStatus.get(cohort.id)?.roomLive)
        blocked.add(cohort.roomId);
  }
  for (const request of requests) {
    if (schedule.preservedPlanIds?.includes(request.planId)) continue;
    if (sessionRequestSourceSuppressed(requestSources.get(request.cohortId), refreshSchedules, now)) continue;
    const offer = request.offers.find(
      (row) => row.id === request.currentOfferId,
    );
    if (offer?.roomId && !sessionExceedsRefresh(offer, refreshSchedules.get(request.plan.termId)) && applies(offer.date, offer.startMin, offer.endMin))
      blocked.add(offer.roomId);
  }
  return blocked;
}

/** Blackouts apply to physical civil weekdays even on school-closure dates:
 * an explicitly agreed holiday extra still reserves its real room. */
export async function assertDatedRoomBlackoutAvailable(
  tx: TransactionDb,
  blackout: {
    roomId: string;
    dayOfWeek: number;
    startMin: number;
    endMin: number;
  },
  now = new Date(),
) {
  await lockEntity(tx, "session-planning");
  const [cohorts, requests, refreshSchedules] = await Promise.all([
    tx.sessionPlanCohort.findMany({
      where: {
        roomId: blackout.roomId,
        status: "SCHEDULED",
        endsAt: { gt: now },
      },
      include: {
        plan: { select: { termId: true } },
        participants: { where: { status: "SCHEDULED" }, select: { id: true } },
      },
      take: 5001,
    }),
    tx.sessionPlanningRequest.findMany({
      where: {
        status: "PENDING",
        kind: { not: "CANCEL" },
        offers: { some: { roomId: blackout.roomId } },
      },
      include: { offers: true, plan: { select: { termId: true } } },
      take: 5001,
    }),
    readSessionRefreshSchedules(tx),
  ]);
  if (cohorts.length > 5000 || requests.length > 5000)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Too many dated reservations to safely review this room block.",
    });
  const overlaps = (date: string, start: number, end: number) =>
    (new Date(`${date}T00:00:00Z`).getUTCDay() || 7) === blackout.dayOfWeek &&
    start < blackout.endMin &&
    end > blackout.startMin;
  const requestSources = await readSessionRequestSources(tx, requests);
  if (
    cohorts.some(
      (cohort) =>
        cohort.participants.length &&
        !cohort.refreshSuppressed && !sessionRefreshSuppressed(cohort, refreshSchedules.get(cohort.plan.termId), now) &&
        overlaps(cohort.date, cohort.startMin, cohort.endMin),
    ) ||
    requests.some((request) => {
      const offer = request.offers.find(
        (row) => row.id === request.currentOfferId,
      );
      return (
        offer?.roomId === blackout.roomId &&
        !sessionRequestSourceSuppressed(requestSources.get(request.cohortId), refreshSchedules, now) &&
        !sessionExceedsRefresh(offer, refreshSchedules.get(request.plan.termId)) &&
        offer.cutoffAt > now &&
        overlaps(offer.date, offer.startMin, offer.endMin)
      );
    })
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "That room block conflicts with an agreed dated session or pending offer.",
    });
}
