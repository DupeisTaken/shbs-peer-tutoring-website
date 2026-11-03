import { TRPCError } from "@trpc/server";
import { Prisma } from "../../generated/prisma";
import { auditCaptureScope } from "./db-scope";
import type { TransactionDb } from "./transactions";

/** Release the reviewed members of a reservation under the caller's schedule
 * fence. The row journal needs a defined visit order, and membership triggers
 * must see the entire release before they inspect the remaining siblings. */
export async function releasePairingsInOrder(
  db: TransactionDb,
  units: readonly (readonly string[])[],
  kind: "rooms" | "group",
) {
  // A slot can contain unboundedly many independent units. Keep the plan
  // depth small while preserving the statement boundary of each whole group
  // (the group editor admits six members). Larger legacy groups stay intact.
  const batches: string[][] = [];
  for (const unit of units) {
    if (!unit.length) continue;
    const batch = batches.at(-1);
    if (batch && batch.length + unit.length <= 32) batch.push(...unit);
    else batches.push([...unit]);
  }
  const ids = batches.flat();
  if (!ids.length) return;
  const changedRoster = () => new TRPCError({
    code: "CONFLICT", message: "The pairing roster changed. Reload the schedule and try again.",
  });
  if (new Set(ids).size !== ids.length) throw changedRoster();
  const data = kind === "rooms"
    ? { groupId: null, roomId: null }
    : { groupId: null, scheduleConfirmed: false, roomNeedsAssignment: false, roomShortageKey: null };
  const args = { where: { id: { in: ids } }, data };
  if (ids.length === 1) {
    const result = await db.pairing.updateMany(args);
    if (result.count !== 1) throw changedRoster();
    return;
  }

  const assignments = kind === "rooms"
    ? Prisma.sql`"groupId" = NULL, "roomId" = NULL`
    : Prisma.sql`"groupId" = NULL, "scheduleConfirmed" = false, "roomNeedsAssignment" = false, "roomShortageKey" = NULL`;
  // Only compiler-generated numeric ordinals enter SQL identifiers. Every ID
  // is a bound value. Each UPDATE needs its predecessor's RETURNING row.
  const step = (index: number) => Prisma.raw(`release_${index}`);
  const execute = async () => {
    for (const batch of batches) {
      const updates = batch.map((id, index) => Prisma.sql`
        ${step(index)} AS (
          UPDATE public."Pairing" SET ${assignments} WHERE id = ${id}
          ${index === 0 ? Prisma.empty : Prisma.sql`AND EXISTS (SELECT 1 FROM ${step(index - 1)})`}
          RETURNING id
        )`);
      const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
        WITH ${Prisma.join(updates)} SELECT id FROM ${step(batch.length - 1)}`);
      if (rows.length !== 1 || rows[0]?.id !== batch.at(-1)) throw changedRoster();
    }
    return { count: ids.length };
  };

  const capture = auditCaptureScope.getStore();
  if (!capture) {
    await execute();
    return;
  }
  // Use the normal updateMany evidence writer for one logical release. Its
  // pre/post reads query the real rows and retain the normal safe projections,
  // submitted fields and affected count. Reads use ID order independently of
  // the primary-first order required by a group's row-level recovery journal.
  const delegate = {
    findMany: (query: Prisma.PairingFindManyArgs) =>
      db.pairing.findMany({ ...query, orderBy: { id: "asc" } }),
    updateMany: execute,
  };
  const audited = capture.delegate("pairing", delegate) as Pick<typeof db.pairing, "updateMany">;
  await audited.updateMany(args);
}
