import type { DomainDb } from "~/server/transactions";

/** Public student signup proves email ownership, not permission to claim a legacy tutor profile. */
export async function resolveTutorLink(
  db: DomainDb,
  userId: string,
  email: string | null,
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, tutorId: true, emailVerifiedAt: true },
  });
  if (
    !user ||
    user.tutorId ||
    !email ||
    !user.emailVerifiedAt ||
    !["TUTOR", "COORDINATOR", "ADMIN", "HEAD"].includes(user.role)
  )
    return user?.tutorId ?? null;
  const tutor = await db.tutor.findUnique({
    where: { email },
    select: { id: true },
  });
  return tutor?.id ?? null;
}
