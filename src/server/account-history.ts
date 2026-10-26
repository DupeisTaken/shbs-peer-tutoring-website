import type { DomainDb } from "./transactions";

/** Only credential retirement extends login history ownership. A Person group may
 * contain several still-live logins awaiting review and is deliberately not used here.
 * Walk immutable retirement edges so adding a previously combined family preserves
 * every original actor without rewriting protected historical User rows. */
export async function accountHistoryIds(db: DomainDb, userId: string) {
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
