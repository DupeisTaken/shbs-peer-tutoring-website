import { TRPCError } from "@trpc/server";
import type { TransactionDb } from "~/server/transactions";

/** Validate actual room references without imposing the generator's ID format.
 * Key-share locks retain the rooms until commit, so deletion cannot win between
 * this check and the attendance/patrol insert. Sort multi-room locks consistently.
 * Call after accepted-submission replay checks: an existing receipt stays valid.
 */
export async function requireExistingRooms(
  tx: TransactionDb,
  roomIds: string[],
): Promise<void> {
  const ids = [...new Set(roomIds)].sort();
  if (!ids.length) return;
  const rooms = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Room" WHERE id = ANY(${ids}::text[])
    ORDER BY id FOR KEY SHARE
  `;
  if (rooms.length !== ids.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A selected room no longer exists. Refresh the room list and select the room used.",
    });
  }
}
