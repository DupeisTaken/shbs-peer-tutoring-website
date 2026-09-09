import { TRPCError } from "@trpc/server";

import { lockEntity, type TransactionDb } from "~/server/transactions";

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
        dayOfWeek: booking.dayOfWeek,
        ...overlap,
        ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
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
}

/** Keep a newly declared recurring blackout from invalidating a current planned booking. */
export async function assertRoomBlackoutAvailable(
  db: TransactionDb,
  blackout: RoomBlackout,
): Promise<void> {
  await lockPlannedRoomSchedule(db);
  const pairing = await db.pairing.findFirst({
    where: {
      roomId: blackout.roomId,
      dayOfWeek: blackout.dayOfWeek,
      startMin: { lt: blackout.endMin },
      endMin: { gt: blackout.startMin },
      // A newly configured recurring blackout governs the live room calendar;
      // completed program periods remain historical evidence.
      term: { active: true },
    },
    select: { id: true },
  });
  if (pairing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "That room already has a planned booking during this time.",
    });
  }
}

/** Validate the prospective schedule shared by every pairing linked to a catalog slot. */
export async function assertLinkedSlotScheduleAvailable(
  db: TransactionDb,
  slot: { id: string; dayOfWeek: number; startMin: number; endMin: number },
): Promise<void> {
  await lockPlannedRoomSchedule(db);
  const linked = await db.pairing.findMany({
    where: { timeSlotId: slot.id },
    select: { id: true, roomId: true, termId: true },
  });
  const linkedIds = linked.map((pairing) => pairing.id);
  const occupied = new Set<string>();
  for (const pairing of linked) {
    if (!pairing.roomId) continue;
    const roomPeriod = `${pairing.termId}:${pairing.roomId}`;
    if (occupied.has(roomPeriod)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "That slot would double-book a room in one program period.",
      });
    }
    occupied.add(roomPeriod);
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
