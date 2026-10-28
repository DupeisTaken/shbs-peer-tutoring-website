import type { TransactionDb } from "~/server/transactions";

/** Verified profile ownership joins roles and retained aliases; names/emails never do. */
export async function participantKeys(
  db: TransactionDb,
  tutorIds: string[],
  tuteeIds: string[],
) {
  const [users, tutors, students] = await Promise.all([
    db.user.findMany({
      where: {
        OR: [{ tutorId: { in: tutorIds } }, { studentId: { in: tuteeIds } }],
      },
      select: { id: true, tutorId: true, studentId: true },
    }),
    db.tutorProfileOwnership.findMany({
      where: { tutorId: { in: tutorIds } },
      select: { tutorId: true, userId: true },
    }),
    db.studentProfileOwnership.findMany({
      where: { tuteeId: { in: tuteeIds } },
      select: { tuteeId: true, userId: true },
    }),
  ]);
  const tutor = new Map(tutorIds.map((id) => [id, `tutor:${id}`]));
  const tutee = new Map(tuteeIds.map((id) => [id, `tutee:${id}`]));
  for (const row of tutors) tutor.set(row.tutorId, `user:${row.userId}`);
  for (const row of students) tutee.set(row.tuteeId, `user:${row.userId}`);
  for (const user of users) {
    if (user.tutorId) tutor.set(user.tutorId, `user:${user.id}`);
    if (user.studentId) tutee.set(user.studentId, `user:${user.id}`);
  }
  return { tutor, tutee };
}

export function participantsOverlap(
  keys: Awaited<ReturnType<typeof participantKeys>>,
  tutorId: string,
  tuteeIds: readonly string[],
  otherTutorId: string,
  otherTuteeIds: readonly string[],
) {
  const own = new Set([
    keys.tutor.get(tutorId) ?? `tutor:${tutorId}`,
    ...tuteeIds.map((id) => keys.tutee.get(id) ?? `tutee:${id}`),
  ]);
  return [
    keys.tutor.get(otherTutorId) ?? `tutor:${otherTutorId}`,
    ...otherTuteeIds.map((id) => keys.tutee.get(id) ?? `tutee:${id}`),
  ].some((key) => own.has(key));
}
