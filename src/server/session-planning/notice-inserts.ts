import type { Prisma } from "../../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";

const NOTICE_BATCH_SIZE = 500;

/** Insert immutable notice intents without changing existing queue receipts.
 * The caller owns the transaction and planning fence shared by notice producers,
 * and must let failures roll back that transaction. This helper neither acquires
 * a separate lock nor sends mail. Ordinary createMany keeps row recovery triggers
 * and unique/FK errors active; only already-observed dedupe keys are skipped.
 */
export async function insertSessionNotices(
  tx: Pick<TransactionDb, "sessionNotice">,
  intents: readonly Prisma.SessionNoticeCreateManyInput[],
): Promise<void> {
  const firstByKey = new Map<string, Prisma.SessionNoticeCreateManyInput>();
  for (const intent of intents)
    if (!firstByKey.has(intent.dedupeKey))
      firstByKey.set(intent.dedupeKey, intent);
  const unique = [...firstByKey.values()];
  const existing = new Set<string>();
  // Finish all reads before writing: a failed later chunk must not be treated as
  // missing evidence. The producer fence keeps these keys stable until insertion.
  for (let offset = 0; offset < unique.length; offset += NOTICE_BATCH_SIZE) {
    const rows = await tx.sessionNotice.findMany({
      where: {
        dedupeKey: {
          in: unique
            .slice(offset, offset + NOTICE_BATCH_SIZE)
            .map((intent) => intent.dedupeKey),
        },
      },
      select: { dedupeKey: true },
    });
    for (const row of rows) existing.add(row.dedupeKey);
  }
  const missing = unique.filter((intent) => !existing.has(intent.dedupeKey));
  for (let offset = 0; offset < missing.length; offset += NOTICE_BATCH_SIZE)
    await tx.sessionNotice.createMany({
      data: missing.slice(offset, offset + NOTICE_BATCH_SIZE),
    });
}
