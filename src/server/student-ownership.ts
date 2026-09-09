import { TRPCError } from "@trpc/server";
import type { DomainDb, TransactionDb } from "./transactions";

/** Account IDs are stable; emails and the current-intake pointer are not ownership evidence. */
export async function ownedStudentIds(db: DomainDb, userId: string) {
  const [user, records] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { studentId: true } }),
    db.studentProfileOwnership.findMany({
      where: { userId },
      select: { tuteeId: true },
    }),
  ]);
  if (!user) return [];
  return [
    ...new Set([
      ...records.map((r) => r.tuteeId),
      ...(user.studentId ? [user.studentId] : []),
    ]),
  ];
}

/** Called only when the email challenge is consumed, in the same transaction as account linking. */
export async function retainStudentOwnership(
  tx: TransactionDb,
  userId: string,
  tuteeId: string,
) {
  const owner = await tx.studentProfileOwnership.upsert({
    where: { tuteeId },
    update: {},
    create: { tuteeId, userId },
  });
  if (owner.userId !== userId)
    throw new TRPCError({
      code: "CONFLICT",
      message: "This student profile is already linked to another account.",
    });
}
