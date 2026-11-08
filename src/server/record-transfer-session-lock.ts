import { lockEntity, type TransactionDb } from "~/server/transactions";

/** A native primary flag compares the whole merged roster. Importing a sibling
 * must own that primary's fence before provenance and attendance can change. */
export async function lockImportedSessionSources(
  tx: TransactionDb,
  sessionIds: Iterable<string>,
  incomingPrimaryIds: Iterable<string> = [],
) {
  const ids = new Set([...sessionIds, ...incomingPrimaryIds]);
  if (!ids.size) return;
  const existing = await tx.session.findMany({
    where: { id: { in: [...ids] } },
    select: { mergeGroupId: true },
  });
  for (const row of existing) if (row.mergeGroupId) ids.add(row.mergeGroupId);
  for (const id of [...ids].sort()) await lockEntity(tx, `session-flag:${id}`);
}
