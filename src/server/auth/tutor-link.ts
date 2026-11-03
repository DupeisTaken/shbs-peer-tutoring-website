import type { DomainDb } from "~/server/transactions";

/** Public student signup proves email ownership, not permission to claim a legacy tutor profile. */
export async function resolveTutorLink(
  db: DomainDb,
  userId: string,
  email: string | null,
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      tutorId: true,
      emailVerifiedAt: true,
      tutorAccessRevoked: true,
    },
  });
  if (
    !user ||
    user.tutorAccessRevoked ||
    user.tutorId ||
    !email ||
    !user.emailVerifiedAt ||
    user.role !== "TUTOR"
  )
    return user?.tutorId ?? null;
  const tutor = await db.tutor.findUnique({
    where: { email },
    select: {
      id: true,
      user: { select: { id: true } },
      retainedOwner: { select: { userId: true } },
    },
  });
  if (
    !tutor ||
    (tutor.user && tutor.user.id !== userId) ||
    (tutor.retainedOwner && tutor.retainedOwner.userId !== userId)
  )
    return null;

  // Email is only a legacy linking hint. Reviewed ownership/quarantine and an
  // operational successor take precedence; never follow a successor to claim it.
  const ownership = await db.historyRowOwnership.findUnique({
    where: { entity_recordId: { entity: "Tutor", recordId: tutor.id } },
    select: { readerUserId: true },
  });
  if (ownership && ownership.readerUserId !== userId) return null;
  const consolidation = await db.participantConsolidation.findUnique({
    where: { kind_sourceId: { kind: "TUTOR", sourceId: tutor.id } },
    select: { active: true },
  });
  return consolidation?.active ? null : tutor.id;
}
