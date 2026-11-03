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
  now = new Date(),
): Promise<string[]> {
  const cohorts = await tx.sessionPlanCohort.findMany({
    where: {
      date,
      status: "SCHEDULED",
      participants: {
        some: { status: "SCHEDULED" },
      },
    },
    select: {
      id: true,
      planId: true,
      plan: { select: { tutorId: true } },
    },
    take: 5001,
  });
  // A calendar change also matters to people considering this date. Only the
  // current live offer counts; historical alternatives do not expand the audience.
  const requests = await tx.sessionPlanningRequest.findMany({
    where: {
      status: { in: ["PENDING", "SPLIT_REQUESTED"] },
      offers: { some: { date, cutoffAt: { gt: now } } },
    },
    select: {
      id: true,
      planId: true,
      currentOfferId: true,
      participantIds: true,
      plan: { select: { tutorId: true } },
    },
    take: 5001,
  });
  if (cohorts.length > 5000 || requests.length > 5000)
    throw new Error(
      "Too many dated sessions to safely resolve calendar recipients.",
    );
  // Fetch exact current IDs separately so arbitrarily many historical offers
  // cannot enlarge this bounded read or contribute old response provenance.
  const currentOfferIds = requests.flatMap((request) =>
    request.currentOfferId ? [request.currentOfferId] : [],
  );
  const offers = currentOfferIds.length
    ? await tx.sessionPlanningOffer.findMany({
        where: { id: { in: currentOfferIds }, date, cutoffAt: { gt: now } },
        select: { id: true, requestId: true },
      })
    : [];
  const liveOfferRequests = new Map(offers.map((offer) => [offer.id, offer.requestId]));
  const current = requests.filter(
    (request) => request.currentOfferId && liveOfferRequests.get(request.currentOfferId) === request.id,
  );
  const requestPeople = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  const [datedParticipants, sources] = await Promise.all([
    cohorts.length
      ? tx.sessionPlanParticipant.findMany({
          where: {
            cohortId: { in: cohorts.map((row) => row.id) },
            status: "SCHEDULED",
          },
          select: { id: true, planId: true, tuteeId: true },
          take: 5001,
        })
      : Promise.resolve([]),
    current.length
      ? tx.sessionPlanParticipant.findMany({
          where: {
            planId: { in: [...new Set(current.map((row) => row.planId))] },
            tuteeId: {
              in: [
                ...new Set(current.flatMap((row) => requestPeople(row.participantIds))),
              ],
            },
          },
          select: { id: true, planId: true, tuteeId: true },
          take: 5001,
        })
      : Promise.resolve([]),
  ]);
  const participants = [...datedParticipants, ...sources];
  const byId = new Map(participants.map((row) => [row.id, row]));
  if (datedParticipants.length > 5000 || sources.length > 5000 || byId.size > 5000)
    throw new Error(
      "Too many dated participants to safely resolve calendar recipients.",
    );
  const planIds = [...new Set([...cohorts, ...current].map((row) => row.planId))];
  if (!planIds.length) return [];
  // Like the agenda/calendar feed, exact published execution rows override the
  // original attribution. Global profile aliases must not retarget other plans.
  // Resolve first: an inactive historical profile can have an active executor.
  const [planExecutions, participantExecutions] = await Promise.all([
    tx.sessionPlanExecution.findMany({
      where: { planId: { in: planIds } },
      select: { planId: true, tutorId: true },
    }),
    byId.size
      ? tx.sessionParticipantExecution.findMany({
          where: { participantId: { in: [...byId.keys()] } },
          select: { participantId: true, tuteeId: true },
        })
      : Promise.resolve([]),
  ]);
  const tutorByPlan = new Map(
    planExecutions.map((row) => [row.planId, row.tutorId]),
  );
  const learnerByParticipant = new Map(
    participantExecutions.map((row) => [row.participantId, row.tuteeId]),
  );
  const learnerByPlan = new Map<string, Map<string, string>>();
  for (const person of byId.values()) {
    let roster = learnerByPlan.get(person.planId);
    if (!roster) learnerByPlan.set(person.planId, (roster = new Map()));
    roster.set(
      person.tuteeId,
      learnerByParticipant.get(person.id) ?? person.tuteeId,
    );
  }
  const candidateTuteeIds = [
    ...new Set([
      ...datedParticipants.map(
        (person) => learnerByParticipant.get(person.id) ?? person.tuteeId,
      ),
      ...current.flatMap((request) =>
        requestPeople(request.participantIds).map(
          (id) => learnerByPlan.get(request.planId)?.get(id) ?? id,
        ),
      ),
    ]),
  ];
  const tuteeIds = (
    await tx.tutee.findMany({
      where: { id: { in: candidateTuteeIds }, status: "ACTIVE" },
      select: { id: true },
    })
  ).map((person) => person.id);
  const activeLearners = new Set(tuteeIds);
  const activeDatedPlans = new Set(
    datedParticipants
      .filter((person) => activeLearners.has(learnerByParticipant.get(person.id) ?? person.tuteeId))
      .map((person) => person.planId),
  );
  const candidateTutorIds = [
    ...new Set([
      ...cohorts.filter((row) => activeDatedPlans.has(row.planId)),
      ...current,
    ].map((row) => tutorByPlan.get(row.planId) ?? row.plan.tutorId)),
  ];
  const tutorIds = (
    await tx.tutor.findMany({
      where: {
        id: { in: candidateTutorIds },
        status: "ACTIVE",
      },
      select: { id: true },
    })
  ).map((row) => row.id);
  if (!tutorIds.length && !tuteeIds.length) return [];
  const owners = await tx.studentProfileOwnership.findMany({
    where: { tuteeId: { in: tuteeIds } },
    select: { userId: true },
  });
  const ownerIds = new Set(owners.map((owner) => owner.userId));
  const users = await tx.user.findMany({
    where: {
      recoveryVoidedAt: null,
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
        !user.recoveryVoidedAt &&
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
