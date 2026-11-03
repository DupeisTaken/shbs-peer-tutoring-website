import type { DomainDb } from "~/server/transactions";
import type { AnnouncementCandidate } from "~/lib/announcement-recipients";

/** Minimized roster projection; active tutees are unique ACTIVE students in the active term. */
export async function announcementCandidates(
  db: DomainDb,
): Promise<AnnouncementCandidate[]> {
  const [tutors, qualifications, subjects] = await Promise.all([
    db.tutor.findMany({
      orderBy: { englishName: "asc" },
      select: {
        id: true,
        englishName: true,
        gradeLevel: true,
        status: true,
        pairings: {
          where: { term: { active: true } },
          select: {
            id: true,
            subject: true,
            tutees: {
              where: { tutee: { status: "ACTIVE" } },
              select: { tuteeId: true },
            },
          },
        },
      },
    }),
    db.qualificationGrant.findMany({
      where: { qualification: { status: "APPROVED" } },
      select: { tutorId: true, subjectId: true },
    }),
    db.subject.findMany({ select: { id: true, name: true } }),
  ]);
  const pairingIds = tutors.flatMap((tutor) =>
    tutor.pairings.map((pairing) => pairing.id),
  );
  // Retained sources are historical evidence, not another current assignment.
  // Checking these exact candidates also excludes every source in a transfer chain.
  const superseded = new Set(
    pairingIds.length
      ? (
          await db.pairingExecutionSuccessor.findMany({
            where: { sourcePairingId: { in: pairingIds } },
            select: { sourcePairingId: true },
          })
        ).map((row) => row.sourcePairingId)
      : [],
  );
  const subjectNames = new Map(
    subjects.map((subject) => [subject.id, subject.name]),
  );
  const qualified = new Map<string, string[]>();
  for (const qualification of qualifications) {
    const name = subjectNames.get(qualification.subjectId);
    if (name)
      qualified.set(qualification.tutorId, [
        ...(qualified.get(qualification.tutorId) ?? []),
        name,
      ]);
  }
  return tutors.map((tutor) => {
    const pairings = tutor.pairings.filter(
      (pairing) => !superseded.has(pairing.id),
    );
    return {
      id: tutor.id,
      name: tutor.englishName,
      gradeLevel: tutor.gradeLevel,
      status: tutor.status,
      subjects: [
        ...new Set([
          ...(qualified.get(tutor.id) ?? []),
          ...pairings.map((pairing) => pairing.subject),
        ]),
      ].sort(),
      activeTutees: new Set(
        pairings.flatMap((pairing) =>
          pairing.tutees.map((entry) => entry.tuteeId),
        ),
      ).size,
    };
  });
}
