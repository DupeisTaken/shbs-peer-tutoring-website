import { TRPCError } from "@trpc/server";
import { pairingGroupEligibility } from "~/lib/pairing-group-eligibility";
import {
  findTutorScheduleConflict,
  type TutorPlannedSchedule,
} from "~/lib/planned-scheduling";
import { lockPlannedRoomSchedule } from "~/server/room-bookings";
import type { TransactionDb } from "~/server/transactions";
import { assertSessionPlanningWeeklyAvailable } from "~/server/session-planning";

type PlannedTutorWrite = TutorPlannedSchedule & {
  id?: string;
  excludePairingIds?: readonly string[];
};

/** Scheduling shares the existing period → tutor (when needed) → planned-room
 * lock order. Validate before room-mode/shortage returns: a roomless lesson still
 * occupies the tutor, and only valid explicit group members share an interval. */
export async function assertTutorScheduleAvailable(
  db: TransactionDb,
  schedule: PlannedTutorWrite,
) {
  if (!schedule.scheduleConfirmed) return;
  await lockPlannedRoomSchedule(db);
  const excluded = [
    ...new Set([
      ...(schedule.excludePairingIds ?? []),
      ...(schedule.id ? [schedule.id] : []),
    ]),
  ];
  const conflict = await db.pairing.findFirst({
    where: {
      tutorId: schedule.tutorId,
      termId: schedule.termId,
      scheduleConfirmed: true,
      dayOfWeek: schedule.dayOfWeek,
      startMin: { lt: schedule.endMin },
      endMin: { gt: schedule.startMin },
      ...(excluded.length ? { id: { notIn: excluded } } : {}),
    },
    select: { id: true },
  });
  if (conflict)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This tutor already has another assigned teaching block during the selected time. Choose a different time or combine eligible assignments first.",
    });
  await assertSessionPlanningWeeklyAvailable(db, {
    ...schedule,
    excludePairingIds: excluded,
  });
}

/** Slot propagation plans the complete final cohort before any reservations are
 * cleared. Excluding old cohort clocks alone would miss collisions within it. */
export async function assertTutorScheduleCohortAvailable(
  db: TransactionDb,
  units: readonly (PlannedTutorWrite & { memberIds: readonly string[] })[],
) {
  await lockPlannedRoomSchedule(db);
  const cohortIds = units.flatMap((unit) => [...unit.memberIds]);
  const planned = units.map((unit, index) => ({
    ...unit,
    id: `cohort:${index}`,
  }));
  for (const candidate of planned) {
    if (findTutorScheduleConflict(candidate, planned, [candidate.id]))
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "That slot would overlap two independent teaching blocks for the same tutor in one program period.",
      });
    await assertTutorScheduleAvailable(db, {
      ...candidate,
      id: undefined,
      excludePairingIds: cohortIds,
    });
  }
}

type GroupChange = {
  pairingIds?: string[];
  tuteeIds?: string[];
  removePairingIds?: string[];
  removeTuteeIds?: string[];
  activateTuteeIds?: string[];
  replacement?: {
    id: string;
    subject: string;
    tuteeIds: string[];
    detach: boolean;
  };
};

/** Deliberate management edits must preserve an eligible group, or explicitly
 * split it first. Mandatory departures/discipline use their existing lifecycle:
 * projections flag the resulting group for repair without blocking departure. */
export async function assertPairingGroupsRemainEligible(
  db: TransactionDb,
  change: GroupChange,
) {
  await lockPlannedRoomSchedule(db);
  const pairingIds = [
    ...(change.pairingIds ?? []),
    ...(change.removePairingIds ?? []),
    ...(change.replacement ? [change.replacement.id] : []),
  ];
  const tuteeIds = [
    ...(change.tuteeIds ?? []),
    ...(change.removeTuteeIds ?? []),
    ...(change.activateTuteeIds ?? []),
  ];
  const affected = await db.pairing.findMany({
    where: {
      groupId: { not: null },
      term: { active: true },
      OR: [
        { id: { in: pairingIds } },
        { tutees: { some: { tuteeId: { in: tuteeIds } } } },
      ],
    },
    select: { groupId: true },
  });
  const groupIds = [
    ...new Set(affected.flatMap((row) => (row.groupId ? [row.groupId] : []))),
  ];
  if (!groupIds.length) return;
  const members = await db.pairing.findMany({
    where: { groupId: { in: groupIds } },
    select: {
      id: true,
      groupId: true,
      subject: true,
      tutees: {
        where: {
          OR: [
            { tutee: { status: { not: "INACTIVE" } } },
            { tuteeId: { in: change.activateTuteeIds ?? [] } },
          ],
        },
        select: { tuteeId: true },
      },
    },
  });
  const removedPairings = new Set(change.removePairingIds);
  const removedTutees = new Set(change.removeTuteeIds);
  for (const groupId of groupIds) {
    const prospective = members
      .filter(
        (row) =>
          row.groupId === groupId &&
          !removedPairings.has(row.id) &&
          !(change.replacement?.id === row.id && change.replacement.detach),
      )
      .map((row) => {
        const replacement =
          change.replacement?.id === row.id ? change.replacement : undefined;
        return {
          id: row.id,
          subject: replacement?.subject ?? row.subject,
          tutees: (
            replacement?.tuteeIds.map((tuteeId) => ({ tuteeId })) ?? row.tutees
          ).filter((row) => !removedTutees.has(row.tuteeId)),
        };
      });
    if (!pairingGroupEligibility(prospective).eligible)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "This change would leave a combined group with incomplete student and subject coverage. Repair or split the group before editing its assignments.",
      });
  }
}
