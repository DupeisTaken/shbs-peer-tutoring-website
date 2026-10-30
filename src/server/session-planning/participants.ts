import type { TransactionDb } from "~/server/transactions";

/** Verified profile ownership joins roles and retained aliases; names/emails never do. */
export async function participantKeys(
  db: TransactionDb,
  tutorIds: string[],
  tuteeIds: string[],
) {
  // One fresh statement retains direct-link precedence without caching authority.
  // A user matched through either requested role also supplies its other linked
  // role, as the former OR-based User read did, even if that ID was not requested.
  const rows = await db.$queryRaw<
    { role: "tutor" | "tutee"; profileId: string; userId: string }[]
  >`
    WITH direct_users AS (
      SELECT id, "tutorId", "studentId" FROM "User"
      WHERE "tutorId" = ANY(${tutorIds}::text[])
         OR "studentId" = ANY(${tuteeIds}::text[])
    )
    SELECT DISTINCT ON (role, "profileId") role, "profileId", "userId"
    FROM (
      SELECT 'tutor'::text AS role, "tutorId" AS "profileId", "userId", 0 AS priority
      FROM "TutorProfileOwnership" WHERE "tutorId" = ANY(${tutorIds}::text[])
      UNION ALL
      SELECT 'tutee'::text, "tuteeId", "userId", 0
      FROM "StudentProfileOwnership" WHERE "tuteeId" = ANY(${tuteeIds}::text[])
      UNION ALL
      SELECT 'tutor'::text, "tutorId", id, 1 FROM direct_users
      WHERE "tutorId" IS NOT NULL AND "tutorId" <> ''
      UNION ALL
      SELECT 'tutee'::text, "studentId", id, 1 FROM direct_users
      WHERE "studentId" IS NOT NULL AND "studentId" <> ''
    ) AS mappings
    ORDER BY role, "profileId", priority DESC
  `;
  const tutor = new Map(tutorIds.map((id) => [id, `tutor:${id}`]));
  const tutee = new Map(tuteeIds.map((id) => [id, `tutee:${id}`]));
  for (const row of rows)
    (row.role === "tutor" ? tutor : tutee).set(
      row.profileId,
      `user:${row.userId}`,
    );
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
