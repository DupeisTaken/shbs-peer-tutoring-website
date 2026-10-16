import { TRPCError } from "@trpc/server";
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

export type AllocationSchedule = {
  id?: string;
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

/** Resolve linked historical aliases through verified ownership, never through mutable email/name. */
async function participantKeys(
  db: TransactionDb,
  tutorIds: string[],
  tuteeIds: string[],
) {
  const [users, tutors, students] = await Promise.all([
    db.user.findMany({
      where: {
        OR: [{ tutorId: { in: tutorIds } }, { studentId: { in: tuteeIds } }],
      },
      select: { id: true, tutorId: true, studentId: true },
    }),
    db.tutorProfileOwnership.findMany({
      where: { tutorId: { in: tutorIds } },
      select: { tutorId: true, userId: true },
    }),
    db.studentProfileOwnership.findMany({
      where: { tuteeId: { in: tuteeIds } },
      select: { tuteeId: true, userId: true },
    }),
  ]);
  const tutor = new Map(tutorIds.map((id) => [id, `tutor:${id}`]));
  const tutee = new Map(tuteeIds.map((id) => [id, `tutee:${id}`]));
  // Familiarity follows the person even across roles; scoring below keeps the tutor's
  // one vote separate from each distinct tutee's one vote.
  for (const row of tutors) tutor.set(row.tutorId, `user:${row.userId}`);
  for (const row of students) tutee.set(row.tuteeId, `user:${row.userId}`);
  for (const user of users) {
    if (user.tutorId) tutor.set(user.tutorId, `user:${user.id}`);
    if (user.studentId) tutee.set(user.studentId, `user:${user.id}`);
  }
  return { tutor, tutee };
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
        ...(schedule.id ? { id: { not: schedule.id } } : {}),
      },
      select: {
        id: true,
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
      occupiedMinutes: evidence.reduce(
        (total, booking) => total + booking.endMin - booking.startMin,
        0,
      ),
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

/** Final-state cohort plan: clearing AUTO reservations inside the transaction permits safe swaps. */
export async function allocateSlotCohort(
  db: TransactionDb,
  slot: { id: string; dayOfWeek: number; startMin: number; endMin: number },
) {
  await lockPlannedRoomSchedule(db);
  const linked = await db.pairing.findMany({
    where: { timeSlotId: slot.id },
    include: {
      tutees: { select: { tuteeId: true } },
      term: { select: { active: true } },
    },
    orderBy: { id: "asc" },
  });
  const enabled = (await getFeatures(db)).AUTO_ASSIGN_ROOMS;
  const movable = linked.filter(
    (pairing) => enabled && pairing.term.active && pairing.roomMode === "AUTO",
  );
  if (movable.length)
    await db.pairing.updateMany({
      where: { id: { in: movable.map((pairing) => pairing.id) } },
      data: { roomId: null },
    });
  // Fixed and retained legacy/history reservations constrain automatic choices first.
  const fixed = linked.filter(
    (pairing) => !movable.some((row) => row.id === pairing.id),
  );
  for (const pairing of fixed) {
    await assertPlannedRoomAvailable(db, {
      ...slot,
      roomId: pairing.roomId,
      termId: pairing.termId,
      excludePairingIds: fixed.map((row) => row.id),
    });
  }
  const occupied = new Set<string>();
  for (const pairing of fixed) {
    if (pairing.roomId) {
      const key = `${pairing.termId}:${pairing.roomId}`;
      if (occupied.has(key))
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "That slot would double-book a fixed room in one program period.",
        });
      occupied.add(key);
    }
  }
  for (const pairing of fixed) {
    // Disabling allocation preserves shortages as well as reservations. Keep
    // their material-change evidence aligned with the copied catalog interval;
    // historical rows never generate new operational shortage notifications.
    const roomShortageKey = pairing.roomNeedsAssignment
      ? shortageSignature({
          ...pairing,
          ...slot,
          tuteeIds: pairing.tutees.map((row) => row.tuteeId),
        })
      : null;
    await db.pairing.update({
      where: { id: pairing.id },
      data: {
        roomId: pairing.roomId,
        scheduleConfirmed: true,
        dayOfWeek: slot.dayOfWeek,
        startMin: slot.startMin,
        endMin: slot.endMin,
        roomVersion: { increment: 1 },
        roomShortageKey,
      },
    });
    if (pairing.term.active && pairing.roomNeedsAssignment) {
      await notifyRoomShortage(
        db,
        pairing.id,
        { ...pairing, roomShortageKey, roomOutcome: "UNAVAILABLE" },
        pairing.roomShortageKey,
      );
    }
  }
  // Reserve every still-eligible existing automatic room before ranking a displaced pairing.
  // Otherwise a low-ID displaced pairing could steal a later pairing's continuity reservation.
  const remaining: typeof movable = [];
  for (const pairing of movable) {
    if (!pairing.roomId) {
      remaining.push(pairing);
      continue;
    }
    try {
      await assertPlannedRoomAvailable(db, {
        ...slot,
        roomId: pairing.roomId,
        termId: pairing.termId,
        excludePairingId: pairing.id,
      });
      await db.pairing.update({
        where: { id: pairing.id },
        data: {
          roomId: pairing.roomId,
          scheduleConfirmed: true,
          dayOfWeek: slot.dayOfWeek,
          startMin: slot.startMin,
          endMin: slot.endMin,
          roomNeedsAssignment: false,
          roomShortageKey: null,
          roomVersion: { increment: 1 },
        },
      });
    } catch (error) {
      if (!(error instanceof TRPCError) || error.code !== "CONFLICT")
        throw error;
      remaining.push(pairing);
    }
  }
  for (const pairing of remaining) {
    const allocation = await allocateRoom(
      db,
      {
        ...pairing,
        ...slot,
        id: pairing.id,
        scheduleConfirmed: true,
        tuteeIds: pairing.tutees.map((row) => row.tuteeId),
      },
      {},
      pairing,
      { preserveLegacy: true },
    );
    await db.pairing.update({
      where: { id: pairing.id },
      data: {
        ...allocationData(allocation),
        scheduleConfirmed: true,
        dayOfWeek: slot.dayOfWeek,
        startMin: slot.startMin,
        endMin: slot.endMin,
        roomVersion: { increment: 1 },
      },
    });
    await notifyRoomShortage(
      db,
      pairing.id,
      allocation,
      pairing.roomShortageKey,
    );
  }
  return linked.length;
}
