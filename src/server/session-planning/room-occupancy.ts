import { TRPCError } from "@trpc/server";
import { resolvePlanningCalendarDay } from "~/lib/session-planning";
import { programDateKey } from "~/lib/program-time";
import { getProgramTimeZone } from "~/server/program/time-zone";
import { lockEntity, type TransactionDb } from "~/server/transactions";

type RoomSchedule = {
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
  const [calendar, term, timeZone, cohorts, requests] = await Promise.all([
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
        participants: { where: { status: "SCHEDULED" }, select: { id: true } },
      },
      take: 5001,
    }),
    tx.sessionPlanningRequest.findMany({
      where: {
        status: "PENDING",
        offers: { some: { roomId: { in: roomIds } } },
      },
      include: { offers: true },
      take: 5001,
    }),
  ]);
  if (cohorts.length > 5000 || requests.length > 5000)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Too many dated room bookings to safely review this change.",
    });
  const excluded = new Set([
    ...(schedule.excludePairingIds ?? []),
    ...(schedule.excludePairingId ? [schedule.excludePairingId] : []),
  ]);
  const applies = (date: string, start: number, end: number) => {
    const day = resolvePlanningCalendarDay(date, calendar);
    return (
      day.isSchoolDay &&
      day.effectiveTimetableWeekday === schedule.dayOfWeek &&
      start < schedule.startMin + 45 &&
      end > schedule.startMin &&
      (!term.startDate || date >= programDateKey(term.startDate, timeZone)) &&
      (!term.endDate || date <= programDateKey(term.endDate, timeZone))
    );
  };
  const blocked = new Set<string>();
  for (const cohort of cohorts) {
    if (
      !cohort.roomId ||
      !cohort.participants.length ||
      !applies(cohort.date, cohort.startMin, cohort.endMin)
    )
      continue;
    const own =
      cohort.plan.originalDate === cohort.date &&
      cohort.plan.assignments.length > 0 &&
      (cohort.plan.assignments.every((row) => excluded.has(row.pairingId)) ||
        (cohort.startMin === schedule.startMin &&
          cohort.endMin === schedule.endMin &&
          cohort.plan.assignments.some((row) => excluded.has(row.pairingId))));
    if (!own) blocked.add(cohort.roomId);
  }
  for (const request of requests) {
    const offer = request.offers.find(
      (row) => row.id === request.currentOfferId,
    );
    if (offer?.roomId && applies(offer.date, offer.startMin, offer.endMin))
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
  const [cohorts, requests] = await Promise.all([
    tx.sessionPlanCohort.findMany({
      where: {
        roomId: blackout.roomId,
        status: "SCHEDULED",
        endsAt: { gt: now },
      },
      include: {
        participants: { where: { status: "SCHEDULED" }, select: { id: true } },
      },
      take: 5001,
    }),
    tx.sessionPlanningRequest.findMany({
      where: {
        status: "PENDING",
        offers: { some: { roomId: blackout.roomId } },
      },
      include: { offers: true },
      take: 5001,
    }),
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
  if (
    cohorts.some(
      (cohort) =>
        cohort.participants.length &&
        overlaps(cohort.date, cohort.startMin, cohort.endMin),
    ) ||
    requests.some((request) => {
      const offer = request.offers.find(
        (row) => row.id === request.currentOfferId,
      );
      return (
        offer?.roomId === blackout.roomId &&
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
