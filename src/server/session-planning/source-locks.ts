import type { TransactionDb } from "~/server/transactions";

export type PlanningSource = {
  tutorId: string;
  tuteeIds: readonly string[];
  pairingIds: readonly string[];
};

/** Batch the existing source fence in one globally ordered pass. This only locks:
 * callers must re-read source evidence after waiting, before deciding authority.
 * Neither ownership discovery nor a successful lock is an eligibility snapshot.
 */
export async function lockPlanningSources(
  tx: TransactionDb,
  sources: readonly PlanningSource[],
): Promise<void> {
  if (!sources.length) return;
  const tutorIds = [...new Set(sources.map((source) => source.tutorId))].sort();
  const tuteeIds = [
    ...new Set(sources.flatMap((source) => source.tuteeIds)),
  ].sort();
  const pairingIds = [
    ...new Set(sources.flatMap((source) => source.pairingIds)),
  ].sort();
  // Lock retained owners as well as directly attached accounts, just as the
  // isolated source checker does; a retained owner never suppresses a live link.
  const owners = await tx.studentProfileOwnership.findMany({
    where: { tuteeId: { in: tuteeIds } },
    select: { userId: true },
  });
  const linked = await tx.user.findMany({
    where: {
      OR: [{ tutorId: { in: tutorIds } }, { studentId: { in: tuteeIds } }],
    },
    select: { id: true },
  });
  const userIds = [
    ...new Set([
      ...owners.map((row) => row.userId),
      ...linked.map((row) => row.id),
    ]),
  ].sort();

  await tx.$queryRaw`SELECT id FROM "User" WHERE id=ANY(${userIds}::text[]) ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Tutor" WHERE id=ANY(${tutorIds}::text[]) ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Tutee" WHERE id=ANY(${tuteeIds}::text[]) ORDER BY id FOR SHARE`;
  // Parent UPDATE locks fence new FK roster joins; SHARE on current joins fences
  // removal. Keep this order/strength identical to isolated source verification.
  await tx.$queryRaw`SELECT id FROM "Pairing" WHERE id=ANY(${pairingIds}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT "pairingId","tuteeId" FROM "PairingTutee" WHERE "pairingId"=ANY(${pairingIds}::text[]) ORDER BY "pairingId","tuteeId" FOR SHARE`;
}
