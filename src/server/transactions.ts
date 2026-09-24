import type { Prisma, PrismaClient } from "../../generated/prisma";
export type TransactionDb = Prisma.TransactionClient;
export type DomainDb = PrismaClient | TransactionDb;

/** Compose helpers with an existing decision transaction instead of opening a nested one. */
export async function inTransaction<T>(
  client: DomainDb,
  work: (tx: TransactionDb) => Promise<T>,
): Promise<T> {
  return "$transaction" in client
    ? client.$transaction(work, { timeout: 20000 })
    : work(client);
}

/** Database locks serialize repeated submissions and decisions across server instances. */
export async function lockEntity(
  client: TransactionDb,
  key: string,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
