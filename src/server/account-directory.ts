import { TRPCError } from "@trpc/server";
import { accountMembership } from "~/lib/account-membership";
import { academicSummary, normalizeGrade } from "~/lib/academics";
import {
  isHistoricalTutor,
  legacyAcademicRecordId,
} from "~/lib/historical-academics";
import { isHistoricalTutee } from "~/lib/tutee-history";
import { accountHistoryIds } from "./account-history";
import { historicalAcademicSnapshot } from "./historical-academics";
import type { DomainDb } from "./transactions";

/** Staff-only, on-demand projection. Direct attachment and retained ownership are
 * intentionally separate, and no credential hashes or invitation tokens leave the server. */
export async function accountDirectoryDetails(
  db: DomainDb,
  input: { userId: string } | { tutorId: string },
) {
  const user =
    "userId" in input
      ? await db.user.findUnique({
          where: { id: input.userId, mergedIntoId: null },
          select: {
            id: true,
            tutorId: true,
            studentId: true,
            role: true,
            tuteeMember: true,
            tutorAccessRevoked: true,
            canTranslate: true,
            crewStatus: true,
            suspendedAt: true,
            suspendedReason: true,
            mustChangePassword: true,
            academicProfile: true,
          },
        })
      : null;
  if ("userId" in input && !user) throw new TRPCError({ code: "NOT_FOUND" });
  const ownerIds = user ? await accountHistoryIds(db, user.id) : [];
  const [term, retainedTutees, tutors] = await Promise.all([
    db.term.findFirst({
      where: { active: true },
      select: { id: true, schoolYear: true },
    }),
    db.studentProfileOwnership.findMany({
      where: { userId: { in: ownerIds } },
      select: { tuteeId: true },
    }),
    db.tutor.findMany({
      where:
        "tutorId" in input
          ? { id: input.tutorId }
          : {
              OR: [
                { user: { id: { in: ownerIds } } },
                { retainedOwner: { userId: { in: ownerIds } } },
              ],
            },
      select: {
        id: true,
        englishName: true,
        username: true,
        status: true,
        user: { select: { id: true } },
        retainedOwner: {
          select: {
            user: { select: { id: true, name: true, username: true } },
          },
        },
      },
      orderBy: [{ englishName: "asc" }, { id: "asc" }],
    }),
  ]);
  if ("tutorId" in input && !tutors.length)
    throw new TRPCError({ code: "NOT_FOUND" });
  const tutees = user
    ? await db.tutee.findMany({
        where: {
          OR: [
            { user: { id: { in: ownerIds } } },
            { id: { in: retainedTutees.map((row) => row.tuteeId) } },
          ],
        },
        select: {
          id: true,
          englishName: true,
          status: true,
          intakeTermId: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      })
    : [];
  const identities = [
    ...tutors.map((row) => ({
      ...row,
      kind: "TUTOR" as const,
      direct: user ? row.id === user.tutorId : false,
      historical: isHistoricalTutor(row),
      retainedOwner: row.retainedOwner?.user ?? null,
    })),
    ...tutees.map((row) => ({
      ...row,
      username: null,
      kind: "TUTEE" as const,
      direct: row.id === user?.studentId,
      historical: isHistoricalTutee(row, term?.id ?? null),
      retainedOwner: null,
    })),
  ];
  const profiles = await Promise.all(
    identities.map(async (row) => {
      // Always recover the original enrollment/roster year. A linked owner's current
      // academics never replace historical evidence, including a reactivated archive.
      const snapshot = await historicalAcademicSnapshot(
        db,
        legacyAcademicRecordId(row.kind, row.id),
      );
      const preserved = await db.historicalAcademicRecord.count({
        where: { id: snapshot.recordId },
      });
      const historical =
        row.historical || (!!user && !row.direct) || preserved > 0;
      const original = snapshot.original;
      const grade = normalizeGrade(original.rawGrade);
      const academic =
        historical || !user?.academicProfile
          ? {
              ...academicSummary(
                {
                  status: original.academicallyGraduated
                    ? "GRADUATED"
                    : grade.gradeLevel !== null
                      ? "REPORTED"
                      : "UNKNOWN",
                  ...grade,
                  schoolYear: original.schoolYear,
                  confirmedAt: original.originalConfirmedAt,
                  reconfirmRequired: false,
                },
                original.schoolYear,
              ),
              // An archive is evidence, not a request to confirm the current academic year.
              needsConfirmation: false,
            }
          : academicSummary(user.academicProfile, term?.schoolYear);
      return {
        id: row.id,
        name: row.englishName,
        username: row.username,
        kind: row.kind,
        status: row.status,
        direct: row.direct,
        historical,
        academic,
        retainedOwner: row.retainedOwner,
      };
    }),
  );
  return {
    membership: user
      ? accountMembership({
          ...user,
          tutorStatus: tutors.find((row) => row.id === user.tutorId)?.status,
        })
      : null,
    crewStatus: user?.crewStatus ?? null,
    tutorAccessRevoked: user?.tutorAccessRevoked ?? false,
    mustChangePassword: user?.mustChangePassword ?? false,
    suspendedAt: user?.suspendedAt ?? null,
    suspendedReason: user?.suspendedReason ?? null,
    attached: profiles.filter((row) => row.direct || !user),
    retained: profiles.filter((row) => !row.direct && !!user),
  };
}
