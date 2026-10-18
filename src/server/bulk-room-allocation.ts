import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getFeatures } from "./program/features";
import { lockPlannedRoomSchedule } from "./room-bookings";
import {
  allocateAndPersistRoomUnit,
  assertRoomVersion,
  roomUnitInclude,
  type RoomUnitMember,
} from "./room-allocation";
import { inTransaction, lockEntity, type DomainDb } from "./transactions";

export const bulkRoomAllocationInput = z.object({
  targets: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        expectedRoomVersion: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(500)
    .refine(
      (targets) =>
        new Set(targets.map((target) => target.id)).size === targets.length,
      "Each pairing must appear only once.",
    ),
});

/** The reviewed IDs are the complete write boundary. Validate every reservation
 * before allocating any room; the transaction also rolls back later failures. */
export async function autoAssignUnassignedRooms(
  db: DomainDb,
  input: z.infer<typeof bulkRoomAllocationInput>,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockPlannedRoomSchedule(tx);
    if (!(await getFeatures(tx)).AUTO_ASSIGN_ROOMS)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Automatic room assignment is currently turned off.",
      });

    const targets = new Map(input.targets.map((target) => [target.id, target]));
    const selected = await tx.pairing.findMany({
      where: { id: { in: [...targets.keys()] }, term: { active: true } },
      include: roomUnitInclude,
      orderBy: { id: "asc" },
    });
    const conflict = () =>
      new TRPCError({
        code: "CONFLICT",
        message:
          "Pairings or room assignments changed. Reload before assigning rooms.",
      });
    if (selected.length !== targets.size) throw conflict();
    const groupIds = [
      ...new Set(selected.flatMap((row) => (row.groupId ? [row.groupId] : []))),
    ];
    const grouped = groupIds.length
      ? await tx.pairing.findMany({
          where: { groupId: { in: groupIds } },
          include: roomUnitInclude,
        })
      : [];
    // New siblings may not be silently added to the user's reviewed operation.
    if (grouped.some((row) => !targets.has(row.id))) throw conflict();
    const units = new Map<string, RoomUnitMember[]>();
    for (const pairing of selected) {
      assertRoomVersion(pairing, targets.get(pairing.id)!.expectedRoomVersion);
      if (
        !pairing.scheduleConfirmed ||
        pairing.roomId !== null ||
        !["AUTO", "LEGACY"].includes(pairing.roomMode)
      )
        throw conflict();
      const key = pairing.groupId ?? pairing.id;
      const members = units.get(key) ?? [];
      members.push(pairing);
      units.set(key, members);
    }
    for (const members of units.values()) {
      const first = members[0]!;
      if (
        first.groupId &&
        (!members.some((row) => row.id === first.group?.primaryPairingId) ||
          members.some(
            (row) =>
              row.termId !== first.termId || row.tutorId !== first.tutorId,
          ))
      )
        throw conflict();
    }

    let assigned = 0;
    // Serial allocation preserves existing bookings and lets later units see
    // earlier reservations. Explicit groups use their authoritative primary.
    for (const members of units.values()) {
      const primary =
        members.find((row) => row.id === members[0]!.group?.primaryPairingId) ??
        members[0]!;
      const result = await allocateAndPersistRoomUnit(tx, primary, {
        roomMode: "AUTO",
        expectedRoomVersion: primary.roomVersion,
      });
      if (result.roomId) assigned++;
    }
    return { assigned, unassigned: units.size - assigned, total: units.size };
  });
}
