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
import type { UserFilterMember } from "~/lib/user-filters";

/** A directory row is a presentation choice, not an authorization or membership
 * union. Keep all original logins/participations reachable through staff details. */
export async function groupDirectoryRows<
  T extends UserFilterMember & {
    personId: string | null;
    userId: string | null;
    tutorId: string | null;
    tuteeId: string | null;
    name: string;
    email: string | null;
    username: string | null;
  },
>(db: DomainDb, rows: T[]) {
  const people = await db.person.findMany({
    where: {
      id: {
        in: [
          ...new Set(
            rows.flatMap((row) => (row.personId ? [row.personId] : [])),
          ),
        ],
      },
    },
    select: {
      id: true,
      primaryUserId: true,
      resolutionState: true,
      users: {
        select: {
          id: true,
          mergedIntoId: true,
          name: true,
          email: true,
          username: true,
        },
      },
      tutors: {
        select: {
          id: true,
          englishName: true,
          email: true,
          username: true,
          user: { select: { id: true } },
          retainedOwner: { select: { userId: true } },
        },
      },
      tutees: {
        select: {
          id: true,
          englishName: true,
          email: true,
          user: { select: { id: true } },
        },
      },
      _count: { select: { users: true, tutors: true, tutees: true } },
    },
  });
  const studentOwners = await db.studentProfileOwnership.findMany({
    where: {
      tuteeId: {
        in: people.flatMap((person) => person.tutees.map((row) => row.id)),
      },
    },
    select: { tuteeId: true, userId: true },
  });
  const studentOwnerById = new Map(
    studentOwners.map((row) => [row.tuteeId, row.userId]),
  );
  const byPerson = new Map(people.map((person) => [person.id, person]));
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key =
      row.personId ??
      `${row.userId ? "USER" : row.tutorId ? "TUTOR" : "TUTEE"}:${row.userId ?? row.tutorId ?? row.tuteeId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.entries()].map(([key, members]) => {
    const person = byPerson.get(key);
    const representative =
      members.find(
        (row) => row.userId && row.userId === person?.primaryUserId,
      ) ??
      members.find((row) => row.userId) ??
      members[0]!;
    return {
      ...representative,
      // Preserve each member's complete filter facts. Display badges and actions
      // continue to use the representative; this array grants no capabilities.
      directoryMembers: members.map((row): UserFilterMember => {
        const family = new Set(row.userId ? [row.userId] : []);
        let size = -1;
        while (size !== family.size) {
          size = family.size;
          for (const account of person?.users ?? [])
            if (account.mergedIntoId && family.has(account.mergedIntoId))
              family.add(account.id);
        }
        const aliases = person
          ? [
              ...person.users
                .filter((account) => family.has(account.id))
                .flatMap((account) => [
                  account.name,
                  account.email,
                  account.username,
                ]),
              ...person.tutors
                .filter(
                  (source) =>
                    source.id === row.tutorId ||
                    family.has(source.user?.id ?? "") ||
                    family.has(source.retainedOwner?.userId ?? ""),
                )
                .flatMap((source) => [
                  source.englishName,
                  source.email,
                  source.username,
                ]),
              ...person.tutees
                .filter(
                  (source) =>
                    source.id === row.tuteeId ||
                    family.has(source.user?.id ?? "") ||
                    family.has(studentOwnerById.get(source.id) ?? ""),
                )
                .flatMap((source) => [source.englishName, source.email]),
            ].filter((value): value is string => !!value)
          : [];
        return {
          role: row.role,
          tutorStatus: row.tutorStatus,
          account: row.account,
          tutorId: row.tutorId,
          tutorAccessRevoked: row.tutorAccessRevoked,
          tuteeMember: row.tuteeMember,
          canTranslate: row.canTranslate,
          crewStatus: row.crewStatus,
          emailVerifiedAt: row.emailVerifiedAt,
          userId: row.userId,
          currentTutee: row.currentTutee,
          hasTuteeHistory: row.hasTuteeHistory,
          hasTutorHistory: row.hasTutorHistory,
          name: row.name,
          firstName: row.firstName,
          lastName: row.lastName,
          preferredName: row.preferredName,
          alternativeNames: row.alternativeNames,
          legacyName: row.legacyName,
          username: row.username,
          email: row.email,
          tutor: row.tutor
            ? { status: row.tutor.status, username: row.tutor.username }
            : null,
          searchTerms: aliases,
        };
      }),
      identityReviewRequired: person?.resolutionState === "REVIEW_REQUIRED",
      combinedRecordCount: person
        ? person._count.users + person._count.tutors + person._count.tutees
        : 1,
      personSearchTerms: person
        ? [
            ...person.users.flatMap((row) => [
              row.name,
              row.email,
              row.username,
            ]),
            ...person.tutors.flatMap((row) => [
              row.englishName,
              row.email,
              row.username,
            ]),
            ...person.tutees.flatMap((row) => [row.englishName, row.email]),
          ].filter((value): value is string => !!value)
        : [],
    };
  });
}

/** Staff-only, on-demand projection. Direct attachment and retained ownership are
 * intentionally separate, and no credential hashes or invitation tokens leave the server. */
export async function accountDirectoryDetails(
  db: DomainDb,
  input: { userId: string } | { tutorId: string } | { tuteeId: string },
) {
  const user =
    "userId" in input
      ? await db.user.findUnique({
          where: { id: input.userId, mergedIntoId: null },
          select: {
            id: true,
            personId: true,
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
  const source =
    user ??
    ("tutorId" in input
      ? await db.tutor.findUnique({
          where: { id: input.tutorId },
          select: { personId: true },
        })
      : "tuteeId" in input
        ? await db.tutee.findUnique({
            where: { id: input.tuteeId },
            select: { personId: true },
          })
        : null);
  if (!source) throw new TRPCError({ code: "NOT_FOUND" });
  const group = source.personId
    ? await db.person.findUnique({
        where: { id: source.personId },
        select: {
          id: true,
          resolutionState: true,
          primaryUserId: true,
          users: {
            where: { mergedIntoId: null },
            select: {
              id: true,
              name: true,
              email: true,
              username: true,
              role: true,
              firstName: true,
              lastName: true,
              preferredName: true,
              legacyName: true,
              alternativeNames: true,
              profileVersion: true,
              tuteeMember: true,
              tutorId: true,
              tutorAccessRevoked: true,
              canTranslate: true,
              crewStatus: true,
              tutor: { select: { status: true } },
            },
            orderBy: { id: "asc" },
          },
          tutors: {
            select: { id: true, englishName: true, status: true },
            orderBy: { id: "asc" },
          },
          tutees: {
            select: {
              id: true,
              englishName: true,
              status: true,
              intakeTermId: true,
            },
            orderBy: { id: "asc" },
          },
        },
      })
    : null;
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
        "tuteeId" in input
          ? { id: { in: [] } }
          : "tutorId" in input
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
  const tutees =
    user || "tuteeId" in input
      ? await db.tutee.findMany({
          where:
            "tuteeId" in input
              ? { id: input.tuteeId }
              : {
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
    group,
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
