import { expect, it, vi } from "vitest";
import type { TransactionDb } from "./transactions";
import { getSchoolCalendarDatedSessionUserIds } from "./school-calendar-session-audience";

const date = "2026-11-01"; // Sunday, independent of the original Wednesday assignment.
const now = new Date("2026-10-31T10:00:00Z");
type Profile = { id: string; status: string };
type Account = {
  id: string;
  role: string;
  tutorId: string | null;
  studentId: string | null;
  tutorAccessRevoked: boolean;
  tuteeMember: boolean;
  suspendedAt: Date | null;
  mergedIntoId: string | null;
  recoveryVoidedAt: Date | null;
  schoolDeparture: { reason: string; observerRevoked: boolean; tutorDerived: boolean } | null;
};
const account = (id: string, fields: Partial<Account>): Account => ({
  id, role: "STUDENT", tutorId: null, studentId: null,
  tutorAccessRevoked: false, tuteeMember: false,
  suspendedAt: null, mergedIntoId: null, recoveryVoidedAt: null,
  schoolDeparture: null, ...fields,
});

function fixture() {
  const plan = {
    id: "original-plan", tutorId: "original-tutor", originalDate: "2026-11-04", kind: "RECURRING",
    tutor: { status: "ACTIVE" },
  };
  const cohorts = [{ id: "moved-cohort", planId: plan.id, plan, date, status: "SCHEDULED", rescheduled: true }];
  const people = [{ id: "original-participant", planId: plan.id, cohortId: "moved-cohort" as string | null, tuteeId: "original-learner", status: "SCHEDULED" }];
  const requests: { id: string; planId: string; plan: typeof plan; status: string; currentOfferId: string | null; participantIds: unknown; kind: string }[] = [];
  const offers: { id: string; requestId: string; date: string; cutoffAt: Date }[] = [];
  const planExecutions = [{ planId: plan.id, tutorId: "current-tutor" }];
  const participantExecutions = [{ participantId: people[0]!.id, tuteeId: "current-learner" }];
  const tutors: Profile[] = [{ id: "original-tutor", status: "ACTIVE" }, { id: "current-tutor", status: "ACTIVE" }];
  const learners: Profile[] = [{ id: "original-learner", status: "ACTIVE" }, { id: "current-learner", status: "ACTIVE" }];
  const owners: { tuteeId: string; userId: string }[] = [];
  // Original actors deliberately remain active: exact execution, rather than
  // retirement as a side effect, must exclude them from the dated audience.
  const users = [
    account("old-tutor", { role: "TUTOR", tutorId: "original-tutor" }),
    account("new-tutor", { role: "TUTOR", tutorId: "current-tutor" }),
    account("old-learner", { studentId: "original-learner", tuteeMember: true }),
    account("new-learner", { studentId: "current-learner", tuteeMember: true }),
  ];
  const profiles = (rows: Profile[], args: { where: { id: { in: string[] }; status: string } }) =>
    rows.filter((row) => args.where.id.in.includes(row.id) && row.status === args.where.status);
  const raw = {
    sessionPlanCohort: { findMany: vi.fn(async (args: { where: { date: string; status: string }; take: number }) =>
      cohorts.filter((row) => row.date === args.where.date && row.status === args.where.status &&
        people.some((person) => person.cohortId === row.id && person.status === "SCHEDULED")).slice(0, args.take)) },
    sessionPlanningRequest: { findMany: vi.fn(async (args: { where: { status: { in: string[] }; offers: { some: { date: string; cutoffAt: { gt: Date } } } }; take: number }) =>
      requests.filter((row) => args.where.status.in.includes(row.status) && offers.some((offer) =>
        offer.requestId === row.id && offer.date === args.where.offers.some.date && offer.cutoffAt > args.where.offers.some.cutoffAt.gt)).slice(0, args.take)) },
    sessionPlanningOffer: { findMany: vi.fn(async (args: { where: { id: { in: string[] }; date: string; cutoffAt: { gt: Date } } }) =>
      offers.filter((row) => args.where.id.in.includes(row.id) && row.date === args.where.date && row.cutoffAt > args.where.cutoffAt.gt)) },
    sessionPlanParticipant: { findMany: vi.fn(async (args: { where: { cohortId?: { in: string[] }; status?: string; planId?: { in: string[] }; tuteeId?: { in: string[] } }; take: number }) =>
      people.filter((row) =>
        (!args.where.cohortId || !!row.cohortId && args.where.cohortId.in.includes(row.cohortId)) &&
        (!args.where.status || args.where.status === row.status) &&
        (!args.where.planId || args.where.planId.in.includes(row.planId)) &&
        (!args.where.tuteeId || args.where.tuteeId.in.includes(row.tuteeId))).slice(0, args.take)) },
    sessionPlanExecution: { findMany: vi.fn(async (args: { where: { planId: { in: string[] } } }) =>
      planExecutions.filter((row) => args.where.planId.in.includes(row.planId))) },
    sessionParticipantExecution: { findMany: vi.fn(async (args: { where: { participantId: { in: string[] } } }) =>
      participantExecutions.filter((row) => args.where.participantId.in.includes(row.participantId))) },
    tutor: { findMany: vi.fn(async (args: Parameters<typeof profiles>[1]) => profiles(tutors, args)) },
    tutee: { findMany: vi.fn(async (args: Parameters<typeof profiles>[1]) => profiles(learners, args)) },
    studentProfileOwnership: { findMany: vi.fn(async (args: { where: { tuteeId: { in: string[] } } }) =>
      owners.filter((row) => args.where.tuteeId.in.includes(row.tuteeId))) },
    // Return even unrelated users so the final capability filter is exercised.
    user: { findMany: vi.fn(async () => users) },
  };
  return { plan, cohorts, people, requests, offers, planExecutions, participantExecutions,
    tutors, learners, owners, users, raw, tx: raw as unknown as TransactionDb };
}

it.each([
  { kind: "EXTRA", inactive: false }, { kind: "EXTRA", inactive: true },
  { kind: "RECURRING", inactive: false }, { kind: "RECURRING", inactive: true },
])("contacts exact executors for $kind on another weekday with inactive historical sources: $inactive", async ({ kind, inactive }) => {
  const f = fixture();
  f.plan.kind = kind;
  f.cohorts[0]!.rescheduled = kind === "RECURRING";
  if (inactive) {
    f.tutors[0]!.status = "INACTIVE";
    f.learners[0]!.status = "INACTIVE";
    f.plan.tutor.status = "INACTIVE";
  }
  const original = structuredClone({ plan: f.plan, cohorts: f.cohorts, people: f.people });
  expect((await getSchoolCalendarDatedSessionUserIds(f.tx, date, now)).sort()).toEqual(["new-learner", "new-tutor"]);
  expect(f.raw.sessionPlanCohort.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { date, status: "SCHEDULED", participants: { some: { status: "SCHEDULED" } } },
  }));
  expect(f.raw.tutor.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["current-tutor"] }, status: "ACTIVE" } }));
  expect({ plan: f.plan, cohorts: f.cohorts, people: f.people }).toEqual(original);
});

it("keeps unaffected peers and an independent original-profile plan instead of applying a broad alias", async () => {
  const f = fixture();
  const independent = { ...f.plan, id: "independent-plan" };
  f.cohorts.push({ ...f.cohorts[0]!, id: "independent-cohort", planId: independent.id, plan: independent });
  f.people.push(
    { id: "unaffected-peer", planId: f.plan.id, cohortId: "moved-cohort", tuteeId: "peer", status: "SCHEDULED" },
    { id: "independent-participant", planId: independent.id, cohortId: "independent-cohort", tuteeId: "original-learner", status: "SCHEDULED" },
    { id: "cancelled-peer", planId: f.plan.id, cohortId: "moved-cohort", tuteeId: "cancelled", status: "CANCELLED" },
  );
  f.learners.push({ id: "peer", status: "ACTIVE" }, { id: "cancelled", status: "ACTIVE" });
  f.users.push(account("peer-owner", { studentId: "peer", tuteeMember: true }), account("cancelled-owner", { studentId: "cancelled", tuteeMember: true }));
  expect((await getSchoolCalendarDatedSessionUserIds(f.tx, date, now)).sort()).toEqual([
    "new-learner", "new-tutor", "old-learner", "old-tutor", "peer-owner",
  ]);
});

it.each(["EXTRA", "RESCHEDULE"])("uses only the current live %s offer and its exact plan participant provenance, without response rows", async (kind) => {
  const f = fixture();
  f.cohorts[0]!.date = "2026-11-04";
  const otherPlan = { ...f.plan, id: "other-plan" };
  f.people.push({ ...f.people[0]!, id: "other-participant", planId: otherPlan.id, cohortId: "other-cohort" });
  f.participantExecutions.push({ participantId: "other-participant", tuteeId: "unrelated-executor" });
  f.learners.push({ id: "unrelated-executor", status: "ACTIVE" });
  f.users.push(account("unrelated-owner", { studentId: "unrelated-executor", tuteeMember: true }));
  const request = { id: "request", planId: f.plan.id, plan: f.plan, participantIds: ["original-learner"], currentOfferId: "live" as string | null, status: "PENDING", kind };
  f.requests.push(request);
  f.offers.push({ id: "old", requestId: request.id, date, cutoffAt: new Date("2026-11-01T07:00:00Z") }, { id: "live", requestId: request.id, date, cutoffAt: new Date("2026-11-01T07:00:00Z") });
  const audience = () => getSchoolCalendarDatedSessionUserIds(f.tx, date, now);
  expect((await audience()).sort()).toEqual(["new-learner", "new-tutor"]);
  request.status = "SPLIT_REQUESTED";
  expect((await audience()).sort()).toEqual(["new-learner", "new-tutor"]);
  expect(f.raw.sessionPlanningOffer.findMany).toHaveBeenLastCalledWith({
    where: { id: { in: ["live"] }, date, cutoffAt: { gt: now } }, select: { id: true, requestId: true },
  });
  f.offers[1]!.date = "2026-11-02";
  expect(await audience()).toEqual([]); // Historical Sunday alternative cannot add an audience.
  f.offers[1]!.date = date;
  f.offers[1]!.cutoffAt = now;
  expect(await audience()).toEqual([]); // Exact cutoff is no longer live.
  f.offers[1]!.cutoffAt = new Date("2026-11-01T07:00:00Z");
  request.status = "CANCELLED";
  expect(await audience()).toEqual([]);
});

it("preserves ordinary live-offer recipients even when legacy participant provenance has no row", async () => {
  const f = fixture();
  f.cohorts.length = 0;
  f.people.length = 0;
  f.planExecutions.length = 0;
  f.requests.push({ id: "request", planId: f.plan.id, plan: f.plan, participantIds: ["original-learner", null, 42], currentOfferId: "live", status: "PENDING", kind: "EXTRA" });
  f.offers.push({ id: "live", requestId: "request", date, cutoffAt: new Date("2026-11-01T07:00:00Z") });
  expect((await getSchoolCalendarDatedSessionUserIds(f.tx, date, now)).sort()).toEqual(["old-learner", "old-tutor"]);
});

it("rejects a foreign current-offer pointer even when this request has a historical offer on the date", async () => {
  const f = fixture();
  f.cohorts[0]!.date = "2026-11-04";
  f.requests.push({ id: "request", planId: f.plan.id, plan: f.plan, participantIds: ["original-learner"], currentOfferId: "foreign-offer", status: "PENDING", kind: "RESCHEDULE" });
  f.offers.push(
    { id: "historical-offer", requestId: "request", date, cutoffAt: new Date("2026-11-01T07:00:00Z") },
    { id: "foreign-offer", requestId: "another-request", date, cutoffAt: new Date("2026-11-01T07:00:00Z") },
  );
  expect(await getSchoolCalendarDatedSessionUserIds(f.tx, date, now)).toEqual([]);
  expect(f.raw.sessionPlanParticipant.findMany).not.toHaveBeenCalled();
  expect(f.raw.user.findMany).not.toHaveBeenCalled();
});

it("resolves retained ownership of the executor without requiring its direct student pointer", async () => {
  const f = fixture();
  f.users.find((row) => row.id === "new-learner")!.studentId = null;
  f.owners.push({ tuteeId: "current-learner", userId: "new-learner" });
  expect((await getSchoolCalendarDatedSessionUserIds(f.tx, date, now)).sort()).toEqual(["new-learner", "new-tutor"]);
});

it.each([
  ["suspension", { suspendedAt: now }],
  ["login retirement", { mergedIntoId: "retained-login" }],
  ["recovery retirement", { recoveryVoidedAt: now }],
  ["viewer access", { role: "VIEWER" }],
  ["departure", { schoolDeparture: { reason: "Synthetic departure", observerRevoked: false, tutorDerived: false } }],
] satisfies [string, Partial<Account>][])("does not contact a current executor after %s", async (_label, fields) => {
  const f = fixture();
  for (const user of f.users.filter((row) => row.id.startsWith("new-"))) Object.assign(user, fields);
  expect(await getSchoolCalendarDatedSessionUserIds(f.tx, date, now)).toEqual([]);
});

it("keeps role-specific revocation and membership checks on each current executor", async () => {
  const f = fixture();
  f.users.find((row) => row.id === "new-tutor")!.tutorAccessRevoked = true;
  expect(await getSchoolCalendarDatedSessionUserIds(f.tx, date, now)).toEqual(["new-learner"]);
  f.users.find((row) => row.id === "new-learner")!.tuteeMember = false;
  expect(await getSchoolCalendarDatedSessionUserIds(f.tx, date, now)).toEqual([]);
});

it("checks active executor profiles after projection and does not fall back to an active original", async () => {
  const f = fixture();
  f.tutors.find((row) => row.id === "current-tutor")!.status = "INACTIVE";
  expect(await getSchoolCalendarDatedSessionUserIds(f.tx, date, now)).toEqual(["new-learner"]);
  f.learners.find((row) => row.id === "current-learner")!.status = "INACTIVE";
  expect(await getSchoolCalendarDatedSessionUserIds(f.tx, date, now)).toEqual([]);
});

it.each(["cohorts", "requests", "participants"])("refuses oversized %s rather than sending a partial audience", async (scope) => {
  const f = fixture();
  if (scope === "cohorts") {
    f.raw.sessionPlanCohort.findMany.mockResolvedValue(Array.from({ length: 5001 }, (_, index) => ({ ...f.cohorts[0]!, id: `cohort-${index}` })));
  } else if (scope === "requests") {
    f.raw.sessionPlanningRequest.findMany.mockResolvedValue(Array.from({ length: 5001 }, (_, index) => ({ id: `request-${index}`, planId: f.plan.id, plan: f.plan, participantIds: [], currentOfferId: null, status: "PENDING", kind: "EXTRA" })));
  } else {
    f.people.push(...Array.from({ length: 5000 }, (_, index) => ({ ...f.people[0]!, id: `participant-${index}` })));
  }
  await expect(getSchoolCalendarDatedSessionUserIds(f.tx, date, now)).rejects.toThrow("Too many dated");
  expect(f.raw.user.findMany).not.toHaveBeenCalled();
});
