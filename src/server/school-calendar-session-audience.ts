import { portalAccess } from "~/lib/portal-access";
import type { TransactionDb } from "./transactions";

/** Integration seam for the dated-session owner. Include participants in explicit extras,
 * reschedules and dated recurring occurrences on this actual date, including preserved
 * plans on a closure. Attendance-only Session evidence is never a future plan.
 * Use the current cohort roster rather than the original recurring assignment: a
 * separately moved learner belongs to the destination date only. */
export async function getSchoolCalendarDatedSessionUserIds(
  tx: TransactionDb,
  date: string,
): Promise<string[]> {
  const cohorts = await tx.sessionPlanCohort.findMany({
    where: {
      date,
      status: "SCHEDULED",
      participants: {
        some: { status: "SCHEDULED", tutee: { status: "ACTIVE" } },
      },
    },
    select: {
      plan: { select: { tutorId: true, tutor: { select: { status: true } } } },
      participants: {
        where: { status: "SCHEDULED", tutee: { status: "ACTIVE" } },
        select: { tuteeId: true },
      },
    },
    take: 5001,
  });
  if (cohorts.length > 5000)
    throw new Error(
      "Too many dated sessions to safely resolve calendar recipients.",
    );
  const tutorIds = cohorts
    .filter((row) => row.plan.tutor.status === "ACTIVE")
    .map((row) => row.plan.tutorId);
  const tuteeIds = [
    ...new Set(
      cohorts.flatMap((row) =>
        row.participants.map((person) => person.tuteeId),
      ),
    ),
  ];
  if (!tutorIds.length && !tuteeIds.length) return [];
  const owners = await tx.studentProfileOwnership.findMany({
    where: { tuteeId: { in: tuteeIds } },
    select: { userId: true },
  });
  const ownerIds = new Set(owners.map((owner) => owner.userId));
  const users = await tx.user.findMany({
    where: {
      OR: [
        { tutorId: { in: tutorIds } },
        { studentId: { in: tuteeIds } },
        { id: { in: [...ownerIds] } },
      ],
    },
    include: { schoolDeparture: true },
  });
  return users
    .filter(
      (user) =>
        portalAccess(user).canParticipate &&
        ((!!user.tutorId &&
          tutorIds.includes(user.tutorId) &&
          !user.tutorAccessRevoked) ||
          (user.tuteeMember &&
            ((!!user.studentId && tuteeIds.includes(user.studentId)) ||
              ownerIds.has(user.id)))),
    )
    .map((user) => user.id);
}
