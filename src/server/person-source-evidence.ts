import type { DomainDb } from "./transactions";
import type { PersonSource } from "./person-identity";

export type PersonSourceEvidence = {
  periods: string[];
  lessons: number;
  meetings: number;
  amendments: number;
  policyAcceptances: number;
  patrols: number;
};

/** Batch original-source evidence, never effective-reader totals or today's term.
 * Counts describe preserved records; none authorize participation or ownership. */
export async function personSourceEvidence(db: DomainDb, sources: PersonSource[]) {
  const ids = (kind: PersonSource["kind"]) => sources.filter((row) => row.kind === kind).map((row) => row.id);
  const tutorIds = ids("TUTOR"), tuteeIds = ids("TUTEE"), userIds = ids("USER");
  const [lessons, meetings, amendments, tutors, students, studentLessons, policies, patrols] = await Promise.all([
    db.session.groupBy({ by: ["tutorId", "schoolYear", "quarter"], where: { tutorId: { in: tutorIds } }, _count: { _all: true } }),
    db.meetingAttendance.groupBy({ by: ["tutorId"], where: { tutorId: { in: tutorIds } }, _count: { _all: true } }),
    db.serviceHourAdjustment.groupBy({ by: ["tutorId"], where: { tutorId: { in: tutorIds } }, _count: { _all: true } }),
    db.tutor.findMany({ where: { id: { in: tutorIds } }, select: { id: true, gradeSchoolYear: true } }),
    db.tutee.findMany({ where: { id: { in: tuteeIds } }, select: { id: true, intakeTermId: true } }),
    db.$queryRaw<{ tuteeId: string; schoolYear: string; quarter: string; count: number }[]>`SELECT attendance."tuteeId", lesson."schoolYear", lesson.quarter::TEXT AS quarter, COUNT(*)::INTEGER AS count FROM "SessionTutee" attendance JOIN "Session" lesson ON lesson.id=attendance."sessionId" WHERE attendance."tuteeId"=ANY(${tuteeIds}::TEXT[]) GROUP BY attendance."tuteeId",lesson."schoolYear",lesson.quarter`,
    db.policyAcceptance.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _count: { _all: true } }),
    db.patrol.groupBy({ by: ["crewUserId"], where: { crewUserId: { in: userIds } }, _count: { _all: true } }),
  ]);
  const terms = await db.term.findMany({ where: { id: { in: students.flatMap((row) => row.intakeTermId ? [row.intakeTermId] : []) } }, select: { id: true, schoolYear: true, quarter: true } });
  return new Map(sources.map((source) => {
    const evidence: PersonSourceEvidence = { periods: [], lessons: 0, meetings: 0, amendments: 0, policyAcceptances: 0, patrols: 0 };
    if (source.kind === "TUTOR") {
      const rows = lessons.filter((row) => row.tutorId === source.id);
      evidence.lessons = rows.reduce((sum, row) => sum + row._count._all, 0);
      evidence.periods = rows.map((row) => `${row.schoolYear} ${row.quarter}`);
      const originalYear = tutors.find((row) => row.id === source.id)?.gradeSchoolYear;
      if (originalYear) evidence.periods.push(originalYear);
      evidence.meetings = meetings.find((row) => row.tutorId === source.id)?._count._all ?? 0;
      evidence.amendments = amendments.find((row) => row.tutorId === source.id)?._count._all ?? 0;
    } else if (source.kind === "TUTEE") {
      const rows = studentLessons.filter((row) => row.tuteeId === source.id);
      evidence.lessons = rows.reduce((sum, row) => sum + row.count, 0);
      evidence.periods = rows.map((row) => `${row.schoolYear} ${row.quarter}`);
      const term = terms.find((row) => row.id === students.find((student) => student.id === source.id)?.intakeTermId);
      if (term) evidence.periods.push(`${term.schoolYear} ${term.quarter}`);
    } else {
      evidence.policyAcceptances = policies.find((row) => row.userId === source.id)?._count._all ?? 0;
      evidence.patrols = patrols.find((row) => row.crewUserId === source.id)?._count._all ?? 0;
    }
    evidence.periods = [...new Set(evidence.periods)].sort();
    return [`${source.kind}:${source.id}`, evidence] as const;
  }));
}
