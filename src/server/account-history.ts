import type { DomainDb } from "./transactions";

/** Only a recorded HEAD combine extends ownership. Names and email never grant history access.
 * Merges with existing merge families are blocked, keeping this explicit mapping one level deep. */
export async function accountHistoryIds(db: DomainDb, userId: string) {
  const retired = await db.user.findMany({
    where: { mergedIntoId: userId },
    select: { id: true },
  });
  return [userId, ...retired.map((row) => row.id)];
}
