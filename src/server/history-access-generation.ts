import { TRPCError } from "@trpc/server";
import { inTransaction, type DomainDb, type TransactionDb } from "./transactions";

/** Query response gate, sampled after private reads and before serialization.
 * The baseline must come from fresh preauthorization, not the session cookie.
 * This detects committed access changes without taking locks in writer order;
 * it must not be used to describe an already-committed mutation as cancelled. */
export async function assertHistoryAccessGeneration(
  db: DomainDb,
  baseline: { userId: string; historyAccessRevision: number },
) {
  const current = await db.user.findUnique({
    where: { id: baseline.userId },
    select: { historyAccessRevision: true, mergedIntoId: true, recoveryVoidedAt: true },
  });
  if (!Number.isSafeInteger(baseline.historyAccessRevision) || baseline.historyAccessRevision < 0 ||
      !current || current.mergedIntoId || current.recoveryVoidedAt ||
      current.historyAccessRevision !== baseline.historyAccessRevision)
    throw new TRPCError({ code: "UNAUTHORIZED", message: "History access changed. Sign in again before continuing." });
}

/** Read-state writes have no period/account/room locks. Fence their exact access
 * metadata before reading recipients, then verify the session generation inside
 * that transaction. Correction cannot change ownership between read and write. */
export async function withHistoryReadMutation<T>(db: DomainDb, baseline: { userId: string; historyAccessRevision: number }, work: (tx: TransactionDb) => Promise<T>) {
  return inTransaction(db, async (tx) => {
    await tx.$executeRaw`LOCK TABLE "RetiredHistoryOwnership", "HistoryRowOwnership" IN SHARE MODE`;
    await assertHistoryAccessGeneration(tx, baseline);
    return work(tx);
  });
}
