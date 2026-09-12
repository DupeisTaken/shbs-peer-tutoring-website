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
            subject: true,
            tutees: {
              where: { tutee: { status: "ACTIVE" } },
              select: { tuteeId: true },
            },
          },
        },
      },
    }),
    db.tutorQualification.findMany({
      select: { tutorId: true, subjectId: true },
    }),
    db.subject.findMany({ select: { id: true, name: true } }),
  ]);
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
  return tutors.map((tutor) => ({
    id: tutor.id,
    name: tutor.englishName,
    gradeLevel: tutor.gradeLevel,
    status: tutor.status,
    subjects: [
      ...new Set([
        ...(qualified.get(tutor.id) ?? []),
        ...tutor.pairings.map((pairing) => pairing.subject),
      ]),
    ].sort(),
    activeTutees: new Set(
      tutor.pairings.flatMap((pairing) =>
        pairing.tutees.map((entry) => entry.tuteeId),
      ),
    ).size,
  }));
}
