import type { TransactionDb } from "~/server/transactions";

/** Normal submissions/corrections share this barrier and retain their per-tutor/day locks.
 * Catalogue propagation takes it exclusively before discovering affected historical blocks,
 * so neither newly inserted sessions nor corrections can escape the propagation snapshot. */
export async function lockAttendanceSchedule(
  tx: TransactionDb,
  exclusive = false,
) {
  const key = "attendance:catalogue-propagation";
  if (exclusive)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  else
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
}
