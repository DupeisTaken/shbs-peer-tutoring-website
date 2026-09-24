import {
  createRoomBlockSchema,
  updateRoomBlockSchema,
  removeRoomBlockSchema,
} from "~/lib/room-blocks";
import {
  assertRoomBlackoutAvailable,
  roomBlockForWrite,
} from "./room-bookings";
import type { TransactionDb } from "./transactions";

/** Requests must be feasible when submitted, but never reserve a room. The
 * actual mutation checks again in the approval transaction before applying it. */
export async function validateRoomBlockProposal(
  db: TransactionDb,
  operation: string,
  value: unknown,
) {
  if (operation === "admin.createRoomUnavailability") {
    await assertRoomBlackoutAvailable(db, createRoomBlockSchema.parse(value));
  } else if (operation === "admin.updateRoomUnavailability") {
    const input = updateRoomBlockSchema.parse(value);
    const block = await roomBlockForWrite(db, input.id);
    await assertRoomBlackoutAvailable(db, {
      ...input,
      roomId: block.roomId,
      excludeBlockId: block.id,
    });
  } else if (operation === "admin.deleteRoomUnavailability") {
    await roomBlockForWrite(db, removeRoomBlockSchema.parse(value).id);
  }
}
