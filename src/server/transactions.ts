import type { Prisma, PrismaClient } from "../../generated/prisma";

export type TransactionDb = Prisma.TransactionClient;
export type DomainDb = PrismaClient | TransactionDb;

/** Compose domain operations into the caller's transaction instead of nesting transactions. */
export async function inTransaction<T>(
  db: DomainDb,
  work: (tx: TransactionDb) => Promise<T>,
): Promise<T> {
  return "$transaction" in db
    ? db.$transaction(work, { timeout: 15000 })
    : work(db);
}

/** Serialize one entity across requests and across app processes. Locks end with the transaction. */
export async function lockEntity(
  db: TransactionDb,
  key: string,
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
