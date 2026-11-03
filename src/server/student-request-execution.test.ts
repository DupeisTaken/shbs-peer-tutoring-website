import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({ emailSender: { send: vi.fn() }, isEmailDeliveryAvailable: () => false }));
import { db } from "./db";
import { closeStudentRequest, stampStudentAssignment } from "./student-request-state";
import { admitStudentRequestExecution, recordStudentRequestExecution, releaseStudentRequestExecution, studentRequestExecutionAssignments } from "./student-request-execution";
import { applyScheduleRejection, assignStudentRequest, resolveStudentReview, studentScheduleRequestSources } from "./student-workflow";
import { lockEntity } from "./transactions";
import { transferredPlanIsCurrent } from "./participant-execution";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const originalTime = new Date("2026-09-01T00:00:00Z");
const deadline = new Date("2099-09-08T00:00:00Z");
async function clearFixture() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
}
beforeEach(async () => {
  await clearFixture();
  await db.term.create({ data: { id: "term", name: "Original request term", schoolYear: "26-27", quarter: "Q1", active: true } });
  await db.tutor.create({ data: { id: "tutor", englishName: "Synthetic tutor", status: "ACTIVE" } });
  await db.user.create({ data: { id: "tutor-user", name: "Synthetic tutor", email: "tutor@example.test", tutorId: "tutor", role: "TUTOR" } });
  await db.tutee.createMany({ data: ["original-a", "original-b", "canonical"].map((id) => ({ id, englishName: id, status: id === "canonical" ? "ACTIVE" as const : "INACTIVE" as const, intakeTermId: "term", signatureName: `Signed ${id}`, signedAt: originalTime, signupSubmittedAt: originalTime })) });
  await db.studentSurvey.createMany({ data: ["a", "b"].map((id) => ({ id: `request-${id}`, tuteeId: `original-${id}`, email: `${id}@example.test`, intakeTermId: "term", payload: { englishName: `Original ${id}`, signatureName: `Signed original-${id}`, email: `${id}@example.test`, firstChoiceId: "future-subject", agreed: true, policyRevision: "original-policy" }, policyRevision: "original-policy", policySnapshot: { original: true }, tokenHash: `synthetic-${id}`, expiresAt: deadline, confirmedAt: originalTime, submittedAt: originalTime, firstAssignedAt: originalTime, verificationDueAt: deadline })) });
  await db.pairing.create({ data: { id: "shared", tutorId: "tutor", termId: "term", subject: "Mathematics", dayOfWeek: 1, startMin: 600, endMin: 660, tutees: { create: { tuteeId: "canonical" } } } });
  await db.participantConsolidation.createMany({ data: ["original-a", "original-b"].map((sourceId) => ({ kind: "TUTEE", sourceId, targetId: "canonical", receiptId: "synthetic-review", effectiveAt: originalTime })) });
});
afterAll(async () => {
  try { await clearFixture(); }
  finally { await db.$disconnect(); }
});
const request = (id: "a" | "b") => db.studentSurvey.findUniqueOrThrow({ where: { id: `request-${id}` } });
async function mapBoth() {
  const rows = await Promise.all([request("a"), request("b")]);
  await db.$transaction(async (tx) => {
    for (const row of rows) await recordStudentRequestExecution(tx, row, "shared", "canonical", "synthetic-review");
  });
  return rows;
}

it("closing one independent request preserves shared execution and the other request's original clocks", async () => {
  const [a, b] = await mapBoth();
  await db.$transaction((tx) => closeStudentRequest(tx, a, "ABORTED"));
  expect(await db.pairingTutee.count({ where: { pairingId: "shared", tuteeId: "canonical" } })).toBe(1);
  expect(await db.tutee.findUnique({ where: { id: "canonical" } })).toMatchObject({ status: "ACTIVE" });
  expect(await request("b")).toEqual(b);
  expect(await studentRequestExecutionAssignments(db, a)).toEqual([]);
  expect(await studentRequestExecutionAssignments(db, b)).toEqual([expect.objectContaining({ surveyId: "request-b", tuteeId: "canonical", sourceTuteeId: "original-b" })]);
  await db.$transaction((tx) => closeStudentRequest(tx, b, "ABORTED"));
  expect(await db.pairingTutee.count({ where: { pairingId: "shared" } })).toBe(0);
  expect(await db.tutee.findUnique({ where: { id: "canonical" } })).toMatchObject({ status: "INACTIVE" });
});

it("a pending original source can receive canonical execution without replacing its intake or signature", async () => {
  await db.studentSurvey.update({ where: { id: "request-a" }, data: { firstAssignedAt: null, verificationDueAt: null } });
  const a = await request("a");
  await db.$transaction(async (tx) => {
    await recordStudentRequestExecution(tx, a, "shared", "canonical");
    await stampStudentAssignment(tx, a.tuteeId!);
  });
  const assigned = await request("a");
  expect(assigned).toMatchObject({ tuteeId: "original-a", submittedAt: originalTime, payload: a.payload, policySnapshot: a.policySnapshot });
  expect(assigned.firstAssignedAt).toBeInstanceOf(Date);
  expect(+assigned.verificationDueAt! - +assigned.firstAssignedAt!).toBe(7 * 24 * 60 * 60_000);
  await db.$transaction((tx) => stampStudentAssignment(tx, "original-a"));
  expect(await request("a")).toEqual(assigned);
});

it("rolls back request closure, map releases, reviews, notifications and roster together", async () => {
  const [a] = await mapBoth();
  await db.studentRequestReview.create({ data: { id: "pending", surveyId: a.id, kind: "STUDENT_ABORT", requestedByUserId: "tutor-user", reason: "Synthetic review" } });
  const rollback = new Error("synthetic rollback");
  await expect(db.$transaction(async (tx) => { await closeStudentRequest(tx, a, "ABORTED"); throw rollback; })).rejects.toThrow(rollback);
  expect(await request("a")).toEqual(a);
  expect(await db.studentRequestExecutionAssignment.findUnique({ where: { surveyId_pairingId: { surveyId: a.id, pairingId: "shared" } } })).toMatchObject({ releasedAt: null });
  expect(await db.studentRequestReview.findUnique({ where: { id: "pending" } })).toMatchObject({ state: "PENDING" });
  expect(await db.notification.count()).toBe(0);
  expect(await db.pairingTutee.count({ where: { pairingId: "shared" } })).toBe(1);
});

it("released authority cannot revive from a leftover original tuple or a canonical successor", async () => {
  const a = await request("a");
  await db.pairing.create({ data: { id: "original", tutorId: "tutor", termId: "term", subject: "Science", dayOfWeek: 2, startMin: 600, endMin: 660, tutees: { create: { tuteeId: "original-a" } } } });
  await db.pairingExecutionSuccessor.create({ data: { sourcePairingId: "original", targetPairingId: "shared", receiptId: "synthetic-review", effectiveAt: originalTime } });
  expect(await studentRequestExecutionAssignments(db, a)).toEqual([]);
  await db.$transaction((tx) => recordStudentRequestExecution(tx, a, "shared", "canonical"));
  await db.$transaction((tx) => releaseStudentRequestExecution(tx, a));
  expect(await studentRequestExecutionAssignments(db, a)).toEqual([]);
  expect(await db.pairingTutee.count({ where: { pairingId: "original", tuteeId: "original-a" } })).toBe(1);
});

it("releasing one assignment preserves ACTIVE status for another current assignment", async () => {
  const a = await request("a");
  await db.pairing.create({ data: { id: "other", tutorId: "tutor", termId: "term", subject: "Science", dayOfWeek: 2, startMin: 600, endMin: 660, tutees: { create: { tuteeId: "canonical" } } } });
  await db.$transaction(async (tx) => { await recordStudentRequestExecution(tx, a, "shared", "canonical"); await recordStudentRequestExecution(tx, a, "other", "canonical"); });
  await db.$transaction((tx) => releaseStudentRequestExecution(tx, a, { pairingId: "shared", unassignedStatus: "PENDING" }));
  expect(await db.tutee.findUnique({ where: { id: "canonical" } })).toMatchObject({ status: "ACTIVE" });
  expect(await studentRequestExecutionAssignments(db, a)).toEqual([expect.objectContaining({ pairingId: "other" })]);
});

it("lists only exact authorized original requests and requires a source-bound rejection ticket", async () => {
  await mapBoth();
  const sources = await studentScheduleRequestSources(db, "tutor", "canonical", "shared");
  expect(sources.sources.map((source) => source.surveyId)).toEqual(["request-a", "request-b"]);
  expect(sources.sources[0]).not.toHaveProperty("payload");
  expect(sources.sources[0]).not.toHaveProperty("signatureName");
  await expect(studentScheduleRequestSources(db, "unrelated-tutor", "canonical", "shared")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.studentActionConfirmation.create({ data: { id: "exact-ticket", userId: "tutor-user", action: "SCHEDULE", target: "shared:canonical:request-b", readyAt: originalTime, expiresAt: deadline } });
  await expect(applyScheduleRejection(db, "tutor-user", "tutor", "canonical", "shared", "Synthetic conflict", "exact-ticket")).rejects.toThrow(/Select the original request/);
  await applyScheduleRejection(db, "tutor-user", "tutor", "canonical", "shared", "Synthetic conflict", "exact-ticket", "request-b");
  expect(await db.studentRequestReview.findMany()).toEqual([expect.objectContaining({ surveyId: "request-b", pairingId: "shared" })]);
  const refreshed = await studentScheduleRequestSources(db, "tutor", "canonical", "shared");
  expect(refreshed.sources.map((source) => source.pending)).toEqual([false, true]);
});

it("does not substitute another source after the chosen original request is released", async () => {
  const [a] = await mapBoth();
  await db.$transaction((tx) => releaseStudentRequestExecution(tx, a));
  await db.studentActionConfirmation.create({ data: { id: "stale-ticket", userId: "tutor-user", action: "SCHEDULE", target: "shared:canonical:request-a", readyAt: originalTime, expiresAt: deadline } });
  await expect(applyScheduleRejection(db, "tutor-user", "tutor", "canonical", "shared", "Stale original", "stale-ticket", "request-a")).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.studentRequestReview.count()).toBe(0);
  expect(await db.studentActionConfirmation.findUnique({ where: { id: "stale-ticket" } })).toMatchObject({ usedAt: null });
});

it("does not reactivate an inactive restricted canonical profile when another request is still open", async () => {
  const a = await request("a");
  await db.$transaction((tx) => recordStudentRequestExecution(tx, a, "shared", "canonical"));
  await db.tutee.update({ where: { id: "canonical" }, data: { status: "INACTIVE" } });
  await db.$transaction((tx) => closeStudentRequest(tx, a, "ABORTED"));
  expect(await request("b")).toMatchObject({ state: "OPEN" });
  expect(await db.tutee.findUnique({ where: { id: "canonical" } })).toMatchObject({ status: "INACTIVE" });
});

it("serializes two independent closures and removes shared work only after its last owner closes", async () => {
  const rows = await mapBoth();
  const results = await Promise.all(rows.map((row) => db.$transaction(async (tx) => {
    await lockEntity(tx, "program:period");
    await lockEntity(tx, `student-survey:${row.email}`);
    return closeStudentRequest(tx, row, "ABORTED");
  })));
  expect(results.flatMap((result) => result.removedPairingIds)).toEqual(["shared"]);
  expect(results.flatMap((result) => result.retainedPairingIds)).toEqual(["shared"]);
  expect(await db.pairingTutee.count({ where: { pairingId: "shared" } })).toBe(0);
  expect(await db.tutee.findUnique({ where: { id: "canonical" } })).toMatchObject({ status: "INACTIVE" });
  expect(await db.studentSurvey.count({ where: { state: "ABORTED" } })).toBe(2);
});

it("a duplicate terminal claim rolls back its extra notice and cannot release another source", async () => {
  const [a, b] = await mapBoth();
  await db.$transaction((tx) => closeStudentRequest(tx, a, "ABORTED"));
  const notices = await db.notification.count();
  await expect(db.$transaction((tx) => closeStudentRequest(tx, a, "DISQUALIFIED"))).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.notification.count()).toBe(notices);
  expect(await request("b")).toEqual(b);
  expect(await db.pairingTutee.count({ where: { pairingId: "shared" } })).toBe(1);
});

async function publishCurrentMember(withPeer = false) {
  const startsAt = new Date("2099-09-14T02:00:00Z"), endsAt = new Date("2099-09-14T02:45:00Z");
  if (withPeer) {
    await db.tutee.create({ data: { id: "unrelated-peer", englishName: "Independent peer", status: "ACTIVE", intakeTermId: "term" } });
    await db.pairingTutee.create({ data: { pairingId: "shared", tuteeId: "unrelated-peer" } });
  }
  await db.sessionPlan.create({ data: { id: "fresh-plan", generationKey: "fresh-plan", tutorId: "tutor", termId: "term", originalDate: "2099-09-14", timeZone: "Asia/Shanghai", sourceFingerprint: "synthetic", assignments: { create: { pairingId: "shared", subject: "Mathematics", tuteeIds: ["canonical", ...(withPeer ? ["unrelated-peer"] : [])], primary: true } } } });
  await db.sessionPlanCohort.create({ data: { id: "fresh-cohort", planId: "fresh-plan", date: "2099-09-14", startMin: 600, endMin: 645, startsAt, endsAt } });
  await db.sessionPlanParticipant.create({ data: { id: "fresh-participant", planId: "fresh-plan", cohortId: "fresh-cohort", tuteeId: "canonical" } });
  if (withPeer) await db.sessionPlanParticipant.create({ data: { id: "peer-participant", planId: "fresh-plan", cohortId: "fresh-cohort", tuteeId: "unrelated-peer", scheduleOverride: true } });
}

it("keeps a fresh canonical publication until the last independent original request releases it", async () => {
  const [a, b] = await mapBoth();
  await publishCurrentMember();
  await db.$transaction((tx) => closeStudentRequest(tx, a, "ABORTED"));
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: "fresh-participant" } })).toMatchObject({ status: "SCHEDULED" });
  await db.$transaction((tx) => closeStudentRequest(tx, b, "ABORTED"));
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: "fresh-participant" } })).toMatchObject({ status: "CANCELLED" });
  expect(await db.sessionPlanCohort.findUnique({ where: { id: "fresh-cohort" } })).toMatchObject({ status: "CANCELLED" });
  expect(await db.sessionPlanAssignment.findUnique({ where: { planId_pairingId: { planId: "fresh-plan", pairingId: "shared" } } })).toMatchObject({ tuteeIds: ["canonical"] });
});

it("closing the canonical profile's own original survey does not cancel a fresh shared publication", async () => {
  const a = await request("a");
  const canonical = await db.studentSurvey.create({ data: { id: "canonical-request", tuteeId: "canonical", email: "canonical@example.test", intakeTermId: "term", payload: { englishName: "Canonical original" }, policyRevision: "original-policy", policySnapshot: {}, tokenHash: "canonical-token", expiresAt: deadline, confirmedAt: originalTime } });
  await db.$transaction(async (tx) => { await recordStudentRequestExecution(tx, a, "shared", "canonical"); await recordStudentRequestExecution(tx, canonical, "shared", "canonical"); });
  await publishCurrentMember();
  await db.$transaction((tx) => closeStudentRequest(tx, canonical, "ABORTED"));
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: "fresh-participant" } })).toMatchObject({ status: "SCHEDULED" });
  expect(await db.pairingTutee.count({ where: { pairingId: "shared" } })).toBe(1);
  await db.$transaction((tx) => closeStudentRequest(tx, a, "ABORTED"));
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: "fresh-participant" } })).toMatchObject({ status: "CANCELLED" });
  expect(await db.tutee.findUnique({ where: { id: "canonical" } })).toMatchObject({ status: "INACTIVE" });
  expect(await request("b")).toMatchObject({ state: "OPEN", tuteeId: "original-b" });
});

it("the final source release cancels only its later canonical publication and leaves an unrelated peer scheduled", async () => {
  const a = await request("a");
  await db.$transaction((tx) => recordStudentRequestExecution(tx, a, "shared", "canonical"));
  await publishCurrentMember(true);
  const peer = await db.sessionPlanParticipant.findUniqueOrThrow({ where: { id: "peer-participant" } });
  await db.$transaction((tx) => closeStudentRequest(tx, a, "ABORTED"));
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: "fresh-participant" } })).toMatchObject({ status: "CANCELLED" });
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: "peer-participant" } })).toEqual(peer);
  expect(await db.sessionPlanCohort.findUnique({ where: { id: "fresh-cohort" } })).toMatchObject({ status: "SCHEDULED" });
  expect(await db.pairingTutee.findMany({ where: { pairingId: "shared" }, select: { tuteeId: true } })).toEqual([{ tuteeId: "unrelated-peer" }]);
});

it("releases the exact transferred published source while preserving a peer's accepted move and response clocks", async () => {
  const [a] = await mapBoth();
  await db.pairing.create({ data: { id: "original-shared", tutorId: "tutor", termId: "term", subject: "Mathematics", dayOfWeek: 1, startMin: 600, endMin: 645, tutees: { create: ["original-a", "original-b"].map((tuteeId) => ({ tuteeId })) } } });
  await db.pairingExecutionSuccessor.create({ data: { sourcePairingId: "original-shared", targetPairingId: "shared", receiptId: "synthetic-review", effectiveAt: originalTime } });
  await db.sessionPlan.create({ data: { id: "original-plan", generationKey: "original-plan", tutorId: "tutor", termId: "term", originalDate: "2099-09-14", timeZone: "Asia/Shanghai", sourceFingerprint: "original", assignments: { create: { pairingId: "original-shared", subject: "Mathematics", tuteeIds: ["original-a", "original-b"], primary: true } } } });
  await db.sessionPlanCohort.createMany({ data: [
    { id: "original-cohort", planId: "original-plan", date: "2099-09-14", startMin: 600, endMin: 645, startsAt: new Date("2099-09-14T02:00:00Z"), endsAt: new Date("2099-09-14T02:45:00Z") },
    { id: "accepted-cohort", planId: "original-plan", date: "2099-09-14", startMin: 660, endMin: 705, startsAt: new Date("2099-09-14T03:00:00Z"), endsAt: new Date("2099-09-14T03:45:00Z"), rescheduled: true },
  ] });
  await db.sessionPlanParticipant.createMany({ data: [
    { id: "participant-a", planId: "original-plan", cohortId: "original-cohort", tuteeId: "original-a" },
    { id: "participant-b", planId: "original-plan", cohortId: "accepted-cohort", tuteeId: "original-b", scheduleOverride: true },
  ] });
  await db.sessionPlanExecution.create({ data: { planId: "original-plan", tutorId: "tutor", receiptId: "synthetic-review", assignments: [{ sourcePairingId: "original-shared", targetPairingId: "shared" }] } });
  await db.sessionParticipantExecution.createMany({ data: (["a", "b"] as const).map((source) => ({ participantId: `participant-${source}`, tuteeId: "canonical", receiptId: "synthetic-review", sourceSurveyIds: [`request-${source}`] })) });
  await db.sessionPlanningRequest.create({ data: { id: "accepted-request", planId: "original-plan", cohortId: "accepted-cohort", kind: "RESCHEDULE", scope: "ONE", status: "ACCEPTED", participantIds: ["original-b"], currentOfferId: "accepted-offer", offers: { create: { id: "accepted-offer", sequence: 1, authorKey: "tutee:original-b", date: "2099-09-14", startMin: 660, endMin: 705, startsAt: new Date("2099-09-14T03:00:00Z"), endsAt: new Date("2099-09-14T03:45:00Z"), cutoffAt: deadline, responses: { create: { id: "accepted-response", actorKey: "tutor:tutor", actorUserId: "tutor-user", state: "ACCEPTED", deliveredAt: originalTime, deadline, respondedAt: originalTime } } } } } });
  const peer = await db.sessionPlanParticipant.findUniqueOrThrow({ where: { id: "participant-b" } });
  const cohort = await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: "accepted-cohort" } });
  const response = await db.sessionPlanningResponse.findUniqueOrThrow({ where: { id: "accepted-response" } });
  await db.$transaction((tx) => closeStudentRequest(tx, a, "ABORTED"));
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: "participant-a" } })).toMatchObject({ status: "CANCELLED" });
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: "participant-b" } })).toEqual(peer);
  expect(await db.sessionPlanCohort.findUnique({ where: { id: "accepted-cohort" } })).toEqual(cohort);
  expect(await db.sessionPlanningResponse.findUnique({ where: { id: "accepted-response" } })).toEqual(response);
  expect(await db.sessionPlanningRequest.findUnique({ where: { id: "accepted-request" } })).toMatchObject({ status: "ACCEPTED", participantIds: ["original-b"] });
  expect(await db.pairingTutee.count({ where: { pairingId: "original-shared" } })).toBe(2);
  expect(await db.pairingTutee.count({ where: { pairingId: "shared" } })).toBe(1);
  const release = await db.sessionPlanContinuationMember.findFirst({ where: { planId: "original-plan", tuteeId: "original-a" } });
  expect(release).toMatchObject({ sourceSurveyId: "request-a", assignmentId: null });
  expect(release?.releasedAt).toBeInstanceOf(Date);
  const plan = await db.sessionPlan.findUniqueOrThrow({ where: { id: "original-plan" }, include: { term: true, assignments: true, participants: true, continuationMembers: true } });
  expect(await db.$transaction((tx) => transferredPlanIsCurrent(tx, plan, false))).toBe(true);
});

it.each([false, true])("resolves A to B publication to C release using exact remaining request authority (independent owner: %s)", async (independent) => {
  const a = await request("a"), b = await request("b");
  await db.$transaction((tx) => recordStudentRequestExecution(tx, a, "shared", "canonical"));
  if (independent) await db.$transaction((tx) => recordStudentRequestExecution(tx, b, "shared", "canonical"));
  await publishCurrentMember(true);
  await db.tutee.create({ data: { id: "third", englishName: "Third execution profile", status: "ACTIVE", intakeTermId: "term" } });
  await db.pairing.create({ data: { id: "second-successor", tutorId: "tutor", termId: "term", subject: "Mathematics", dayOfWeek: 1, startMin: 600, endMin: 660, tutees: { create: [{ tuteeId: "third" }, { tuteeId: "unrelated-peer" }] } } });
  await db.pairingExecutionSuccessor.create({ data: { sourcePairingId: "shared", targetPairingId: "second-successor", receiptId: "second-review", effectiveAt: originalTime } });
  await db.participantConsolidation.create({ data: { kind: "TUTEE", sourceId: "canonical", targetId: "third", receiptId: "second-review", effectiveAt: originalTime } });
  await db.$transaction(async (tx) => {
    await recordStudentRequestExecution(tx, a, "second-successor", "third", "second-review");
    if (independent) await recordStudentRequestExecution(tx, b, "second-successor", "third", "second-review");
    await tx.studentRequestExecutionAssignment.updateMany({ where: { pairingId: "shared" }, data: { releasedAt: originalTime, revision: { increment: 1 } } });
  });
  await db.sessionPlanExecution.create({ data: { planId: "fresh-plan", tutorId: "tutor", receiptId: "second-review", assignments: [{ sourcePairingId: "shared", targetPairingId: "second-successor" }] } });
  await db.sessionParticipantExecution.create({ data: { participantId: "fresh-participant", tuteeId: "third", receiptId: "second-review", sourceSurveyIds: [a.id, ...(independent ? [b.id] : [])] } });
  const peer = await db.sessionPlanParticipant.findUniqueOrThrow({ where: { id: "peer-participant" } });
  await db.$transaction((tx) => closeStudentRequest(tx, a, "ABORTED"));
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: "fresh-participant" } })).toMatchObject({ status: independent ? "SCHEDULED" : "CANCELLED" });
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: "peer-participant" } })).toEqual(peer);
  expect(await db.sessionPlanCohort.findUnique({ where: { id: "fresh-cohort" } })).toMatchObject({ status: "SCHEDULED" });
  expect(await db.pairingTutee.count({ where: { pairingId: "second-successor", tuteeId: "third" } })).toBe(independent ? 1 : 0);
  const plan = await db.sessionPlan.findUniqueOrThrow({ where: { id: "fresh-plan" }, include: { term: true, assignments: true, participants: true, continuationMembers: true } });
  expect(await db.$transaction((tx) => transferredPlanIsCurrent(tx, plan, false))).toBe(true);
});

it("resolves a pending original schedule review after login transfer without rewriting its requester or removing another request", async () => {
  await mapBoth();
  await db.pairing.create({ data: { id: "review-original", tutorId: "tutor", termId: "term", subject: "Mathematics", dayOfWeek: 1, startMin: 600, endMin: 660, tutees: { create: { tuteeId: "original-a" } } } });
  await db.studentRequestReview.create({ data: { id: "original-review", surveyId: "request-a", pairingId: "review-original", kind: "SCHEDULE_CONFLICT", requestedByUserId: "tutor-user", reason: "Original pending conflict" } });
  await db.pairingExecutionSuccessor.create({ data: { sourcePairingId: "review-original", targetPairingId: "shared", receiptId: "synthetic-review", effectiveAt: originalTime } });
  await db.user.update({ where: { id: "tutor-user" }, data: { tutorId: null } });
  await db.user.createMany({ data: [{ id: "retained-tutor-user", name: "Current tutor login", email: "retained-tutor@example.test", role: "TUTOR", tutorId: "tutor" }, { id: "reviewer", name: "Synthetic reviewer", email: "reviewer@example.test", role: "HEAD" }] });
  await db.studentActionConfirmation.create({ data: { id: "approval-ticket", userId: "reviewer", action: "APPROVE", target: "original-review", readyAt: originalTime, expiresAt: deadline } });
  await resolveStudentReview(db, "reviewer", "original-review", true, "approval-ticket");
  expect(await db.studentRequestReview.findUnique({ where: { id: "original-review" } })).toMatchObject({ state: "APPROVED", requestedByUserId: "tutor-user", pairingId: "review-original", surveyId: "request-a" });
  expect(await studentRequestExecutionAssignments(db, await request("a"))).toEqual([]);
  expect(await studentRequestExecutionAssignments(db, await request("b"))).toEqual([expect.objectContaining({ pairingId: "shared" })]);
  expect(await db.pairingTutee.count({ where: { pairingId: "shared", tuteeId: "canonical" } })).toBe(1);
  expect(await db.pairingTutee.count({ where: { pairingId: "review-original", tuteeId: "original-a" } })).toBe(1);
});

it("admits a fresh exact independent request on a canonical profile with closed own intake without reopening either source", async () => {
  const b = await request("b");
  await db.studentSurvey.create({ data: { id: "closed-canonical", tuteeId: "canonical", email: "canonical@example.test", intakeTermId: "term", state: "ABORTED", resolvedAt: originalTime, payload: { englishName: "Original canonical" }, policyRevision: "original-policy", policySnapshot: {}, tokenHash: "closed-canonical-token", expiresAt: deadline } });
  await db.pairingTutee.deleteMany({ where: { pairingId: "shared" } });
  await db.tutee.update({ where: { id: "canonical" }, data: { status: "INACTIVE" } });
  await db.subject.create({ data: { id: "future-subject", name: "Science" } });
  await db.tutorQualification.create({ data: { tutorId: "tutor", subjectId: "future-subject", approvedById: "reviewer", grants: { create: { subjectId: "future-subject" } } } });
  await db.user.create({ data: { id: "reviewer", email: "reviewer@example.test", name: "Synthetic reviewer", role: "HEAD" } });
  await db.studentActionConfirmation.create({ data: { id: "fresh-assignment-ticket", userId: "reviewer", action: "ASSIGN", target: b.id, readyAt: originalTime, expiresAt: deadline } });
  // Ordinary raw writes cannot use directory/execution family membership as proof.
  await expect(db.pairingTutee.create({ data: { pairingId: "shared", tuteeId: "canonical" } })).rejects.toThrow(/Closed or expired student request/);
  await assignStudentRequest(db, b.id, "reviewer", "fresh-assignment-ticket", "future-subject", "tutor");
  const members = await studentRequestExecutionAssignments(db, b);
  expect(members).toEqual([expect.objectContaining({ surveyId: b.id, sourceTuteeId: "original-b", tuteeId: "canonical" })]);
  expect(await request("b")).toEqual(b);
  expect(await db.studentSurvey.findUnique({ where: { id: "closed-canonical" } })).toMatchObject({ state: "ABORTED", tuteeId: "canonical" });
  expect(await db.tutee.findUnique({ where: { id: "canonical" } })).toMatchObject({ status: "ACTIVE" });
  await expect(db.tutee.update({ where: { id: "canonical" }, data: { status: "PENDING" } })).rejects.toThrow(/Closed or expired student request/);
  const pairingId = members[0]!.pairingId;
  await db.$transaction((tx) => releaseStudentRequestExecution(tx, b, { pairingId }));
  await expect(db.$transaction((tx) => admitStudentRequestExecution(tx, b, pairingId, "canonical"))).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(db.pairingTutee.create({ data: { pairingId, tuteeId: "canonical" } })).rejects.toThrow(/Closed or expired student request/);
});
