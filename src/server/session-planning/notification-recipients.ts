import type { User } from "../../../generated/prisma";
import type { TransactionDb } from "~/server/transactions";

export type NotificationTuteeRecipient = {
  tuteeId: string;
  user: User;
};

/** Resolve lifecycle notice destinations, not permission to participate.
 * Non-strict notices retain an existing owner even after membership, departure,
 * suspension or login retirement changes; delivery independently rechecks the
 * address. A retained ownership row is authoritative even if its User is missing.
 */
export async function notificationTuteeRecipients(
  db: Pick<TransactionDb, "studentProfileOwnership" | "user">,
  tuteeIds: readonly string[],
): Promise<NotificationTuteeRecipient[]> {
  const uniqueIds = [...new Set(tuteeIds)];
  if (!uniqueIds.length) return [];
  const ownerships = await db.studentProfileOwnership.findMany({
    where: { tuteeId: { in: uniqueIds } },
    select: { tuteeId: true, userId: true },
  });
  const ownerByTutee = new Map(
    ownerships.map((ownership) => [ownership.tuteeId, ownership.userId]),
  );
  const ownerIds = [
    ...new Set(ownerships.map((ownership) => ownership.userId)),
  ];
  const directIds = uniqueIds.filter((tuteeId) => !ownerByTutee.has(tuteeId));
  const users = await db.user.findMany({
    where: {
      OR: [
        ...(ownerIds.length ? [{ id: { in: ownerIds } }] : []),
        ...(directIds.length ? [{ studentId: { in: directIds } }] : []),
      ],
    },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  const byDirectTutee = new Map(
    users.flatMap((user) =>
      user.studentId === null ? [] : [[user.studentId, user] as const],
    ),
  );
  // Deduplicate only the reads: distinct aliases and repeated input IDs retain
  // their original recipient order and actor identity in the caller's notices.
  return tuteeIds.flatMap((tuteeId) => {
    const user = ownerByTutee.has(tuteeId)
      ? byId.get(ownerByTutee.get(tuteeId)!)
      : byDirectTutee.get(tuteeId);
    return user ? [{ tuteeId, user }] : [];
  });
}
