import type { TransactionDb } from "~/server/transactions";

const READ_BATCH_SIZE = 500;

/** Read membership once within the caller's period/planning fences, which also
 * serialize continuation writers. This operation-local set only selects the
 * publication key scheme; source authority and conflict checks remain live.
 */
export async function readContinuationPairingIds(
  tx: Pick<TransactionDb, "studentContinuationPairing">,
  pairingIds: readonly string[],
): Promise<Set<string>> {
  const uniqueIds = [...new Set(pairingIds)];
  const continuing = new Set<string>();
  for (let offset = 0; offset < uniqueIds.length; offset += READ_BATCH_SIZE) {
    const rows = await tx.studentContinuationPairing.findMany({
      where: {
        pairingId: { in: uniqueIds.slice(offset, offset + READ_BATCH_SIZE) },
      },
      select: { pairingId: true },
    });
    for (const row of rows) continuing.add(row.pairingId);
  }
  return continuing;
}
