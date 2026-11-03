import type { DomainDb } from "./transactions";

/** Permanent credential family, used for anti-replay budgets rather than private
 * read authority. Correcting history must never refund a consumed patrol window. */
export async function accountRetirementFamilyIds(db: DomainDb, userId: string) {
  const ids = new Set([userId]);
  let frontier = [userId];
  while (frontier.length) {
    const retired = await db.user.findMany({
      where: { mergedIntoId: { in: frontier } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    frontier = retired.map((row) => row.id).filter((id) => !ids.has(id));
    for (const id of frontier) ids.add(id);
  }
  return [...ids];
}

/** Resolve exact original-source ownership without changing attribution. Retirement
 * writes atomically retarget incoming mappings to the surviving live reader.
 * Never traverse another source's correction: correcting A must not also move B. */
export async function accountHistoryReaderId(db: DomainDb, sourceUserId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: sourceUserId }, select: { mergedIntoId: true, recoveryVoidedAt: true },
  });
  if (!user || user.recoveryVoidedAt) return null;
  if (!user.mergedIntoId) return sourceUserId;
  const ownership = await db.retiredHistoryOwnership.findUnique({ where: { sourceUserId } });
  if (ownership?.state !== "ASSIGNED" || !ownership.readerUserId) return null;
  const reader = await db.user.findUnique({
    where: { id: ownership.readerUserId }, select: { mergedIntoId: true, recoveryVoidedAt: true },
  });
  return reader && !reader.mergedIntoId && !reader.recoveryVoidedAt ? ownership.readerUserId : null;
}

/** Missing and quarantined mappings fail closed after the authoritative backfill.
 * A Person group or immutable retirement edge is never a private-read grant. */
export async function accountHistoryIds(db: DomainDb, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { mergedIntoId: true, recoveryVoidedAt: true } });
  if (!user || user.mergedIntoId || user.recoveryVoidedAt) return [];
  const ownerships = await db.retiredHistoryOwnership.findMany({
    where: { readerUserId: userId, state: "ASSIGNED" }, select: { sourceUserId: true },
  });
  if (!ownerships.length) return [userId];
  // Validate originals as well as readers; malformed rows cannot grant live data.
  const originals = await db.user.findMany({
    where: { id: { in: ownerships.map((row) => row.sourceUserId) }, mergedIntoId: { not: null }, recoveryVoidedAt: null },
    select: { id: true }, orderBy: { id: "asc" },
  });
  return [userId, ...originals.map((row) => row.id)];
}

/** Resolve only the permanent credential-retirement chain, never display grouping. */
export async function accountRetirementChain(db: DomainDb, userId: string) {
  const chain: string[] = [];
  let next: string | null = userId;
  while (next) {
    if (chain.includes(next))
      throw new Error("Invalid account retirement cycle.");
    chain.push(next);
    const user: { mergedIntoId: string | null } =
      await db.user.findUniqueOrThrow({
        where: { id: next },
        select: { mergedIntoId: true },
      });
    next = user.mergedIntoId;
  }
  return chain;
}
