import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";

export const programRoomOrder = [
  { programOrder: "asc" },
  { name: "asc" },
  { id: "asc" },
] as const;
const roomIds = z
  .array(z.string().cuid())
  .max(500)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Select every room exactly once.",
  );
export const roomOrderInput = z
  .object({ ids: roomIds, expectedIds: roomIds })
  .strict();
/** Creation, removal and reordering share this fence; program ordering never touches patrolOrder. */
export const lockProgramRooms = (tx: TransactionDb) =>
  lockEntity(tx, "program:room-catalog");
/** The same complete-catalog check runs before proposal capture and at application. */
export async function assertProgramRoomOrder(
  tx: TransactionDb,
  input: z.infer<typeof roomOrderInput>,
) {
  await lockProgramRooms(tx);
  const rows = await tx.room.findMany({
    orderBy: [...programRoomOrder],
    select: { id: true },
  });
  const current = rows.map((room) => room.id);
  if (JSON.stringify(current) !== JSON.stringify(input.expectedIds))
    throw new TRPCError({
      code: "CONFLICT",
      message: "The room order changed. Reload before saving.",
    });
  if (
    input.ids.length !== current.length ||
    input.ids.some((id) => !current.includes(id))
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select every current room exactly once.",
    });
}
export async function reorderProgramRooms(
  db: DomainDb,
  input: z.infer<typeof roomOrderInput>,
) {
  return inTransaction(db, async (tx) => {
    await assertProgramRoomOrder(tx, input);
    for (const [programOrder, id] of input.ids.entries())
      await tx.room.update({ where: { id }, data: { programOrder } });
    return { ids: input.ids };
  });
}
