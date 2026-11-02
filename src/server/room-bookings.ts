import { TRPCError } from "@trpc/server";

import { lockEntity, type TransactionDb } from "~/server/transactions";
import {
  datedUnavailableRooms,
  assertDatedRoomBlackoutAvailable,
} from "~/server/session-planning/room-occupancy";

type PlannedRoomBooking = {
  roomId: string | null | undefined;
  termId: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  excludePairingId?: string;
  excludePairingIds?: string[];
};

type RoomBlackout = {
  roomId: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  excludeBlockId?: string;
};

/** All planned-room writers share one infrequent lock, including slot propagation and blackouts. */
export const lockPlannedRoomSchedule = (db: TransactionDb) =>
  lockEntity(db, "planned-room-schedule");

/**
 * Enforce the published planned-room guarantee inside the caller's write transaction.
 * The shared lock serializes competing bookings, slot propagation, room changes, and blackouts,
 * while strict inequalities keep back-to-back sessions valid. Blackouts recur in every term.
 */
export async function assertPlannedRoomAvailable(
  db: TransactionDb,
  booking: PlannedRoomBooking,
): Promise<void> {
  if (!booking.roomId) return;

  await lockPlannedRoomSchedule(db);
  const excludedIds = [
    ...(booking.excludePairingIds ?? []),
    ...(booking.excludePairingId ? [booking.excludePairingId] : []),
  ];
  const overlap = {
    startMin: { lt: booking.endMin },
    endMin: { gt: booking.startMin },
  };
  // A roster/subject edit can retain the exact booking already shared by a group.
  // Different schedules still see siblings as conflicts until explicitly regrouped.
  const current = booking.excludePairingId
    ? await db.pairing.findUnique({
        where: { id: booking.excludePairingId },
        select: {
          groupId: true,
          roomId: true,
          termId: true,
          dayOfWeek: true,
          startMin: true,
          endMin: true,
        },
      })
    : null;
  const retainedGroup =
    current?.groupId &&
    current.roomId === booking.roomId &&
    current.termId === booking.termId &&
    current.dayOfWeek === booking.dayOfWeek &&
    current.startMin === booking.startMin &&
    current.endMin === booking.endMin
      ? current.groupId
      : null;
  const [blackout, pairing] = await Promise.all([
    db.roomUnavailability.findFirst({
      where: {
        roomId: booking.roomId,
        dayOfWeek: booking.dayOfWeek,
        ...overlap,
      },
      select: { id: true },
    }),
    db.pairing.findFirst({
      where: {
        roomId: booking.roomId,
        termId: booking.termId,
        scheduleConfirmed: true,
        dayOfWeek: booking.dayOfWeek,
        ...overlap,
        ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
        ...(retainedGroup
          ? { OR: [{ groupId: null }, { groupId: { not: retainedGroup } }] }
          : {}),
      },
      select: { id: true },
    }),
  ]);

  if (blackout) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "That room is unavailable during the selected time.",
    });
  }
  if (pairing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "That room is already booked during the selected time.",
    });
  }
  if (
    (await datedUnavailableRooms(db, booking, [booking.roomId])).has(
      booking.roomId,
    )
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "That room is reserved by an agreed dated session or pending offer.",
    });
}

/** Validate creates and edits against other blocks and current planned bookings. */
export async function assertRoomBlackoutAvailable(
  db: TransactionDb,
  blackout: RoomBlackout,
): Promise<void> {
  await lockPlannedRoomSchedule(db);
  const room = await db.room.findUnique({
    where: { id: blackout.roomId },
    select: { id: true },
  });
  if (!room)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This room no longer exists.",
    });
  const otherBlock = await db.roomUnavailability.findFirst({
    where: {
      roomId: blackout.roomId,
      dayOfWeek: blackout.dayOfWeek,
      startMin: { lt: blackout.endMin },
      endMin: { gt: blackout.startMin },
      ...(blackout.excludeBlockId
        ? { id: { not: blackout.excludeBlockId } }
        : {}),
    },
    select: { id: true },
  });
  if (otherBlock)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This time overlaps another blocked period for the room.",
    });
  const pairing = await db.pairing.findFirst({
    where: {
      roomId: blackout.roomId,
      dayOfWeek: blackout.dayOfWeek,
      startMin: { lt: blackout.endMin },
      endMin: { gt: blackout.startMin },
      // A newly configured recurring blackout governs the live room calendar;
      // completed program periods remain historical evidence.
      term: { active: true },
      scheduleConfirmed: true,
    },
    select: { id: true },
  });
  if (pairing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "That room already has a planned booking during this time.",
    });
  }
  await assertDatedRoomBlackoutAvailable(db, blackout);
}

/** Read edit/remove targets under the same lock as schedule writers. */
export async function roomBlockForWrite(db: TransactionDb, id: string) {
  await lockPlannedRoomSchedule(db);
  const block = await db.roomUnavailability.findUnique({ where: { id } });
  if (!block)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This blocked period no longer exists. Refresh the room list.",
    });
  return block;
}

/** Validate the prospective schedule shared by every pairing linked to a catalog slot. */
export async function assertLinkedSlotScheduleAvailable(
  db: TransactionDb,
  slot: { id: string; dayOfWeek: number; startMin: number; endMin: number },
): Promise<void> {
  await lockPlannedRoomSchedule(db);
  const linked = await db.pairing.findMany({
    where: { timeSlotId: slot.id },
    select: { id: true, roomId: true, termId: true, groupId: true },
  });
  const linkedIds = linked.map((pairing) => pairing.id);
  const occupied = new Map<string, string | null>();
  for (const pairing of linked) {
    if (!pairing.roomId) continue;
    const roomPeriod = `${pairing.termId}:${pairing.roomId}`;
    if (
      occupied.has(roomPeriod) &&
      (!pairing.groupId || occupied.get(roomPeriod) !== pairing.groupId)
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "That slot would double-book a room in one program period.",
      });
    }
    occupied.set(roomPeriod, pairing.groupId);
    await assertPlannedRoomAvailable(db, {
      roomId: pairing.roomId,
      termId: pairing.termId,
      dayOfWeek: slot.dayOfWeek,
      startMin: slot.startMin,
      endMin: slot.endMin,
      excludePairingIds: linkedIds,
    });
  }
}
