import { TRPCError } from "@trpc/server";
import { pairingEntries } from "~/lib/pairing-groups";
import {
  rankRoomCandidates,
  type RoomMode,
  type RoomOutcome,
} from "~/lib/room-allocation";
import { getFeatures } from "~/server/program/features";
import { notifyAdmins } from "~/server/notifications/create";
import {
  assertPlannedRoomAvailable,
  lockPlannedRoomSchedule,
} from "~/server/room-bookings";
import type { TransactionDb } from "~/server/transactions";
import {
  assertTutorScheduleAvailable,
  assertTutorScheduleCohortAvailable,
} from "~/server/tutor-scheduling";
import type { Prisma } from "../../generated/prisma";
import { participantKeys } from "~/server/session-planning/participants";
import { datedUnavailableRooms } from "~/server/session-planning/room-occupancy";

export type AllocationSchedule = {
  id?: string;
  /** Only an explicit teaching group shares a reservation; coincident schedules never do. */
  excludePairingIds?: string[];
  termId: string;
  tutorId: string;
  tuteeIds: string[];
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  scheduleConfirmed: boolean;
};
type CurrentAllocation = {
  roomId: string | null;
  roomMode: RoomMode;
  roomNeedsAssignment: boolean;
  roomShortageKey: string | null;
  roomVersion: number;
};
type RoomIntent = {
  roomMode?: Exclude<RoomMode, "LEGACY">;
  roomId?: string | null;
  releaseRoomToAuto?: boolean;
  expectedRoomVersion?: number;
};
export type AllocationResult = {
  roomId: string | null;
  roomMode: RoomMode;
  roomNeedsAssignment: boolean;
  roomShortageKey: string | null;
  roomOutcome: RoomOutcome;
};

export function assertRoomVersion(
  current: CurrentAllocation,
  expected?: number,
) {
  if (expected !== undefined && current.roomVersion !== expected)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This pairing changed. Reload it before saving your schedule or room choice.",
    });
}

/** A stable interval/roster signature suppresses notices for unchanged shortages. */
function shortageSignature(schedule: AllocationSchedule) {
  return [
    schedule.termId,
    schedule.dayOfWeek,
    schedule.startMin,
    schedule.endMin,
    schedule.tutorId,
    ...[...new Set(schedule.tuteeIds)].sort(),
  ].join(":");
}

/** Read all candidate evidence in the scheduling transaction; no preview promises a reservation. */
export async function allocateRoom(
  db: TransactionDb,
  schedule: AllocationSchedule,
  intent: RoomIntent,
  current?: CurrentAllocation,
  options: { preserveLegacy?: boolean } = {},
): Promise<AllocationResult> {
  await lockPlannedRoomSchedule(db);
  if (current) assertRoomVersion(current, intent.expectedRoomVersion);
  // Room intent never changes whether a confirmed lesson occupies its tutor.
  await assertTutorScheduleAvailable(db, schedule);
  const mode =
    intent.roomMode ??
    (intent.roomId
      ? "FIXED"
      : intent.roomId === null
        ? "NONE"
        : current?.roomMode === "LEGACY"
          ? current.roomId
            ? "FIXED"
            : options.preserveLegacy
              ? "LEGACY"
              : "AUTO"
          : (current?.roomMode ?? "AUTO"));
  if (
    current?.roomMode === "FIXED" &&
    mode === "AUTO" &&
    !intent.releaseRoomToAuto
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Explicitly release the fixed room before switching to automatic allocation.",
    });
  const previousRoom = current?.roomId ?? null;
  const chosenRoom = intent.roomId !== undefined ? intent.roomId : previousRoom;
  const result = (
    roomId: string | null,
    roomOutcome: RoomOutcome,
    shortage = false,
  ): AllocationResult => ({
    roomId,
    roomMode: mode,
    roomOutcome,
    roomNeedsAssignment: shortage,
    roomShortageKey: shortage ? shortageSignature(schedule) : null,
  });
  if (mode === "NONE") return result(null, "NONE");
  if (mode === "FIXED") {
    if (!chosenRoom)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose a room for a fixed allocation.",
      });
    if (!(await db.room.count({ where: { id: chosenRoom } })))
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This room no longer exists.",
      });
  }
  if (!schedule.scheduleConfirmed)
    return result(mode === "FIXED" ? chosenRoom : null, "AWAITING");
  if (mode === "LEGACY") return result(previousRoom, "UNASSIGNED");
  if (mode === "FIXED") {
    await assertPlannedRoomAvailable(db, {
      ...schedule,
      roomId: chosenRoom,
      excludePairingId: schedule.id,
    });
    return result(
      chosenRoom,
      previousRoom === chosenRoom
        ? "RETAINED"
        : previousRoom
          ? "MOVED"
          : "ASSIGNED",
    );
  }
  if (!(await getFeatures(db)).AUTO_ASSIGN_ROOMS) {
    // Turning automation off never waives conflict checks or discards a live reservation.
    await assertPlannedRoomAvailable(db, {
      ...schedule,
      roomId: previousRoom,
      excludePairingId: schedule.id,
    });
    return result(
      previousRoom,
      "DISABLED",
      current?.roomNeedsAssignment ?? false,
    );
  }
  const [rooms, bookings, blocks] = await Promise.all([
    db.room.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
    db.pairing.findMany({
      where: {
        termId: schedule.termId,
        scheduleConfirmed: true,
        roomId: { not: null },
        ...(schedule.excludePairingIds?.length
          ? { id: { notIn: schedule.excludePairingIds } }
          : schedule.id
            ? { id: { not: schedule.id } }
            : {}),
      },
      select: {
        id: true,
        groupId: true,
        roomId: true,
        tutorId: true,
        dayOfWeek: true,
        startMin: true,
        endMin: true,
        tutees: { select: { tuteeId: true } },
      },
    }),
    db.roomUnavailability.findMany({
      where: {
        dayOfWeek: schedule.dayOfWeek,
        startMin: { lt: schedule.endMin },
        endMin: { gt: schedule.startMin },
      },
      select: { roomId: true },
    }),
  ]);
  const unavailable = new Set(blocks.map((block) => block.roomId));
  for (const id of await datedUnavailableRooms(
    db,
    {
      ...schedule,
      excludePairingIds: [
        ...(schedule.excludePairingIds ?? []),
        ...(schedule.id ? [schedule.id] : []),
      ],
    },
    rooms.map((room) => room.id),
  ))
    unavailable.add(id);
  for (const booking of bookings)
    if (
      booking.roomId &&
      booking.dayOfWeek === schedule.dayOfWeek &&
      booking.startMin < schedule.endMin &&
      booking.endMin > schedule.startMin
    )
      unavailable.add(booking.roomId);
  const eligible = rooms.filter((room) => !unavailable.has(room.id));
  if (previousRoom && eligible.some((room) => room.id === previousRoom))
    return result(previousRoom, "RETAINED");
  if (!eligible.length) return result(null, "UNAVAILABLE", true);
  const keys = await participantKeys(
    db,
    [...new Set([schedule.tutorId, ...bookings.map((row) => row.tutorId)])],
    [
      ...new Set([
        ...schedule.tuteeIds,
        ...bookings.flatMap((row) => row.tutees.map((tutee) => tutee.tuteeId)),
      ]),
    ],
  );
  const tutorKey = keys.tutor.get(schedule.tutorId)!;
  const tuteeKeys = new Set(schedule.tuteeIds.map((id) => keys.tutee.get(id)!));
  const candidates = eligible.map((room) => {
    const evidence = bookings.filter((booking) => booking.roomId === room.id);
    const familiar = new Set(
      evidence.flatMap((booking) => [
        keys.tutor.get(booking.tutorId)!,
        ...booking.tutees.map((row) => keys.tutee.get(row.tuteeId)!),
      ]),
    );
    return {
      id: room.id,
      familiarParticipants:
        Number(familiar.has(tutorKey)) +
        [...tuteeKeys].filter((key) => familiar.has(key)).length,
      familiarTutor: familiar.has(tutorKey),
      // A combined group's repeated subject rows are one weekly booking, not extra usage.
      occupiedMinutes: [
        ...new Map(
          evidence.map((booking) => [
            booking.groupId
              ? `group:${booking.groupId}`
              : `pairing:${booking.id}`,
            booking.endMin - booking.startMin,
          ]),
        ).values(),
      ].reduce((total, minutes) => total + minutes, 0),
    };
  });
  const selected = rankRoomCandidates(candidates)[0]!.id;
  await assertPlannedRoomAvailable(db, {
    ...schedule,
    roomId: selected,
    excludePairingId: schedule.id,
  });
  return result(selected, previousRoom ? "MOVED" : "ASSIGNED");
}

/** Persist only domain columns. Outcome is response feedback, not durable evidence. */
export function allocationData(allocation: AllocationResult) {
  return {
    roomId: allocation.roomId,
    roomMode: allocation.roomMode,
    roomNeedsAssignment: allocation.roomNeedsAssignment,
    roomShortageKey: allocation.roomShortageKey,
  };
}

export const roomUnitInclude = {
  tutees: { select: { tuteeId: true, tutee: { select: { status: true } } } },
  term: { select: { active: true } },
  group: { select: { primaryPairingId: true } },
} satisfies Prisma.PairingInclude;
export type RoomUnitMember = Prisma.PairingGetPayload<{
  include: typeof roomUnitInclude;
}>;

/** Caller holds the schedule fence; primary identity is authoritative for shared intent. */
export async function roomUnitMembers(
  db: TransactionDb,
  pairing: RoomUnitMember,
) {
  const members = pairing.groupId
    ? await db.pairing.findMany({
        where: {
          groupId: pairing.groupId,
          tutorId: pairing.tutorId,
          termId: pairing.termId,
        },
        include: roomUnitInclude,
        orderBy: { id: "asc" },
      })
    : [pairing];
  const primaryId = pairing.group?.primaryPairingId ?? pairing.id;
  // Current membership governs live plans only. Archived groups retain their
  // original roster after departure and still follow existing catalog corrections.
  if (
    pairing.groupId &&
    pairing.term.active &&
    pairingEntries(
      members.map((member) => ({
        ...member,
        tutees: member.tutees.filter((row) => row.tutee.status !== "INACTIVE"),
      })),
    )[0]?.groupStatus === "needsRepair"
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This combined group needs repair. Every student must have the same complete set of subjects. Repair or split the group before scheduling it.",
    });
  return members.sort(
    (a, b) =>
      Number(b.id === primaryId) - Number(a.id === primaryId) ||
      (a.id < b.id ? -1 : 1),
  );
}

export function roomUnitSchedule(members: RoomUnitMember[]) {
  const primary = members[0]!;
  return {
    ...primary,
    excludePairingIds: members.map((member) => member.id),
    tuteeIds: [
      ...new Set(
        members.flatMap((member) => member.tutees.map((row) => row.tuteeId)),
      ),
    ],
  };
}

/** Detach while copying a complete unit, then restore its explicit group atomically.
 * The existing ownership trigger intentionally detaches independent management edits. */
export async function persistRoomUnit(
  db: TransactionDb,
  members: RoomUnitMember[],
  allocation: AllocationResult,
  schedule: {
    timeSlotId: string | null;
    dayOfWeek: number;
    startMin: number;
    endMin: number;
    scheduleConfirmed: boolean;
  } = members[0]!,
) {
  const ids = members.map((member) => member.id);
  if (members[0]!.groupId)
    await db.pairing.updateMany({
      where: { id: { in: ids } },
      data: {
        groupId: null,
        scheduleConfirmed: false,
        roomNeedsAssignment: false,
        roomShortageKey: null,
      },
    });
  for (const member of members) {
    await db.pairing.update({
      where: { id: member.id },
      data: {
        ...allocationData(allocation),
        timeSlotId: schedule.timeSlotId,
        dayOfWeek: schedule.dayOfWeek,
        startMin: schedule.startMin,
        endMin: schedule.endMin,
        scheduleConfirmed: schedule.scheduleConfirmed,
        groupId: member.groupId,
        roomVersion: { increment: 1 },
      },
    });
  }
}

/** Shared room-only and tutor scheduling entry point: a stale member cannot move siblings. */
export async function allocateAndPersistRoomUnit(
  db: TransactionDb,
  selected: RoomUnitMember,
  intent: RoomIntent,
  schedule?: {
    timeSlotId: string;
    dayOfWeek: number;
    startMin: number;
    endMin: number;
    scheduleConfirmed: boolean;
  },
) {
  await lockPlannedRoomSchedule(db);
  assertRoomVersion(selected, intent.expectedRoomVersion);
  const members = await roomUnitMembers(db, selected);
  const primary = members[0]!;
  const allocation = await allocateRoom(
    db,
    { ...roomUnitSchedule(members), ...schedule },
    { ...intent, expectedRoomVersion: undefined },
    primary,
  );
  await persistRoomUnit(db, members, allocation, schedule);
  await notifyRoomShortage(db, primary.id, allocation, primary.roomShortageKey);
  return {
    ...(await db.pairing.findUniqueOrThrow({ where: { id: selected.id } })),
    roomOutcome: allocation.roomOutcome,
  };
}

/** In-app rows become visible only when the scheduling transaction commits. */
export async function notifyRoomShortage(
  db: TransactionDb,
  pairingId: string,
  allocation: AllocationResult,
  previousKey?: string | null,
) {
  if (
    !allocation.roomNeedsAssignment ||
    allocation.roomShortageKey === previousKey
  )
    return;
  await notifyAdmins(
    {
      title: "Pairing needs a room",
      body: "A confirmed tutoring schedule has no available room. Review the pairing to retry allocation or select a room.",
      link: `/admin/pairings#${encodeURIComponent(pairingId)}`,
      inAppOnly: true,
    },
    undefined,
    db,
  );
}

/** Plan complete explicit units; clear only movable reservations before safe swaps. */
export async function allocateSlotCohort(
  db: TransactionDb,
  slot: { id: string; dayOfWeek: number; startMin: number; endMin: number },
) {
  await lockPlannedRoomSchedule(db);
  const linked = await db.pairing.findMany({
    // A catalog correction never promotes a legacy awaiting placeholder into a
    // confirmed lesson. Only existing confirmed reservations follow its clocks.
    where: { timeSlotId: slot.id, scheduleConfirmed: true },
    include: roomUnitInclude,
    orderBy: { id: "asc" },
  });
  const units: RoomUnitMember[][] = [];
  const seen = new Set<string>();
  for (const member of linked) {
    if (seen.has(member.id)) continue;
    const unit = await roomUnitMembers(db, member);
    unit.forEach((row) => seen.add(row.id));
    units.push(unit);
  }
  await assertTutorScheduleCohortAvailable(
    db,
    units.map((unit) => ({
      ...roomUnitSchedule(unit),
      ...slot,
      scheduleConfirmed: true,
      memberIds: unit.map((member) => member.id),
    })),
  );
  const enabled = (await getFeatures(db)).AUTO_ASSIGN_ROOMS;
  const movable = units.filter(
    (unit) => enabled && unit[0]!.term.active && unit[0]!.roomMode === "AUTO",
  );
  const fixed = units.filter((unit) => !movable.includes(unit));
  const movableIds = movable.flatMap((unit) => unit.map((row) => row.id));
  if (movableIds.length)
    await db.pairing.updateMany({
      where: { id: { in: movableIds } },
      data: { groupId: null, roomId: null },
    });
  const fixedIds = fixed.flatMap((unit) => unit.map((row) => row.id));
  const occupied = new Set<string>();
  for (const unit of fixed) {
    const primary = unit[0]!;
    await assertPlannedRoomAvailable(db, {
      ...slot,
      roomId: primary.roomId,
      termId: primary.termId,
      excludePairingIds: fixedIds,
    });
    if (primary.roomId) {
      const key = primary.termId + ":" + primary.roomId;
      if (occupied.has(key))
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "That slot would double-book a fixed room in one program period.",
        });
      occupied.add(key);
    }
  }
  for (const unit of fixed) {
    const primary = unit[0]!;
    const roomShortageKey = primary.roomNeedsAssignment
      ? shortageSignature({ ...roomUnitSchedule(unit), ...slot })
      : null;
    const allocation: AllocationResult = {
      ...primary,
      roomShortageKey,
      roomOutcome: primary.roomNeedsAssignment ? "UNAVAILABLE" : "RETAINED",
    };
    await persistRoomUnit(db, unit, allocation, {
      ...slot,
      timeSlotId: slot.id,
      scheduleConfirmed: true,
    });
    if (primary.term.active)
      await notifyRoomShortage(
        db,
        primary.id,
        allocation,
        primary.roomShortageKey,
      );
  }
  // Reserve every eligible old automatic room first so a displaced earlier unit
  // cannot steal another unit's continuity reservation.
  const remaining: RoomUnitMember[][] = [];
  for (const unit of movable) {
    const primary = unit[0]!;
    if (!primary.roomId) {
      remaining.push(unit);
      continue;
    }
    try {
      await assertPlannedRoomAvailable(db, {
        ...slot,
        roomId: primary.roomId,
        termId: primary.termId,
        excludePairingIds: unit.map((row) => row.id),
      });
    } catch (error) {
      if (!(error instanceof TRPCError) || error.code !== "CONFLICT")
        throw error;
      remaining.push(unit);
      continue;
    }
    await persistRoomUnit(
      db,
      unit,
      {
        ...primary,
        roomNeedsAssignment: false,
        roomShortageKey: null,
        roomOutcome: "RETAINED",
      },
      { ...slot, timeSlotId: slot.id, scheduleConfirmed: true },
    );
  }
  for (const unit of remaining) {
    const primary = unit[0]!;
    const allocation = await allocateRoom(
      db,
      { ...roomUnitSchedule(unit), ...slot, scheduleConfirmed: true },
      {},
      primary,
      { preserveLegacy: true },
    );
    await persistRoomUnit(db, unit, allocation, {
      ...slot,
      timeSlotId: slot.id,
      scheduleConfirmed: true,
    });
    await notifyRoomShortage(
      db,
      primary.id,
      allocation,
      primary.roomShortageKey,
    );
  }
  return linked.length;
}
