import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import type { TransactionDb } from "./transactions";
import { hashPassword } from "./auth/password";
import { db } from "./db";
import { closeStudentRequest } from "./student-request-state";
import { requireParticipantSourceParticipation } from "./participant-source-restrictions";
import { currentPolicy } from "./policy-acceptance";
import { ensureSessionPlanningWindow, readSessionAgenda, respondSession, sessionAttendanceContext, sweepSessionPlanning } from "./session-planning";
import { plannedWindow } from "~/lib/session-planning";
import { previewPersonParticipationTransfer, transferPersonParticipation, personParticipationTransferReceipt } from "./person-participation";
import { executionParticipantId, executionPlanTutorId, executionResponseActor, pairingEvidenceIds, supersededPairingIds, transferredPlanIsCurrent } from "./participant-execution";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
assertIsolatedTestDatabase(process.env.DATABASE_URL);
const password = "Synthetic-transfer-review-460!";
const passwordHash = hashPassword(password);
afterAll(async () => db.$disconnect());

async function fixture(work: (tx: TransactionDb, ids: Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  const rollback = new Error("Rollback participation fixture");
  await db.$transaction(async (tx) => { await work(tx, await seed(tx)); throw rollback; }, { timeout: 30000 }).catch((error: unknown) => { if (error !== rollback) throw error; });
}
async function seed(tx: TransactionDb) {
  const prefix = `transfer-${randomUUID()}`;
  const id = (suffix: string) => `${prefix}-${suffix}`;
  const personId = id("person"), reviewerId = id("reviewer"), userA = id("user-a"), userB = id("user-b"), tutorA = id("tutor-a"), tutorB = id("tutor-b"), student = id("student"), termId = id("term"), pairingId = id("pairing");
  await tx.person.create({ data: { id: personId } });
  await tx.term.updateMany({ where: { active: true }, data: { active: false } });
  await tx.term.create({ data: { id: termId, name: "Synthetic current period", schoolYear: `synthetic-${prefix}`, quarter: "Q1", active: true } });
  await tx.tutor.createMany({ data: [tutorA, tutorB].map((id) => ({ id, personId, englishName: id, status: "ACTIVE" })) });
  await tx.tutee.create({ data: { id: student, englishName: "Synthetic original learner", status: "ACTIVE", intakeTermId: termId } });
  await tx.user.createMany({ data: [
    { id: id("student-user"), email: `${id("student-user")}@example.test`, studentId: student, tuteeMember: true, emailVerifiedAt: new Date("2026-01-01T00:00:00Z") },
    { id: reviewerId, email: `${reviewerId}@example.test`, role: "ADMIN", passwordHash },
    ...[{ id: userA, tutorId: tutorA }, { id: userB, tutorId: tutorB }].map((row) => ({ ...row, personId, email: `${row.id}@example.test`, role: "TUTOR" as const, passwordHash, emailVerifiedAt: new Date("2026-01-01T00:00:00Z") })),
  ] });
  await tx.pairing.create({ data: { id: pairingId, tutorId: tutorA, termId, subject: "Synthetic mathematics", dayOfWeek: 2, startMin: 600, endMin: 645, scheduleConfirmed: true, roomMode: "NONE", tutees: { create: { tuteeId: student } } } });
  const selection = { personId, retainedUserId: userB, activeTutorId: tutorB, activeTuteeId: null, tutorIds: [tutorA, tutorB], tuteeIds: [], acknowledgeHistoryAccessCorrection: true };
  return { id, personId, reviewerId, userA, userB, tutorA, tutorB, student, termId, pairingId, selection };
}
async function reviewed(tx: TransactionDb, f: Awaited<ReturnType<typeof seed>>, selection = f.selection) {
  const preview = await previewPersonParticipationTransfer(tx, selection);
  return { ...selection, fingerprint: preview.fingerprint, operationId: randomUUID(), reason: "Reviewed exact original sources and future execution ownership", acknowledged: true as const, confirmPassword: password };
}

it("merges live recurring work while preserving original assignment and completed attendance", async () => fixture(async (tx, f) => {
  await tx.session.create({ data: { id: f.id("session"), tutorId: f.tutorA, pairingId: f.pairingId, date: new Date("2026-01-06T00:00:00Z"), startMin: 600, endMin: 645, durationMin: 45, shCount: 1.5, shFactor: 2, month: "2026-01", schoolYear: "26-27", quarter: "Q1" } });
  const before = { pairing: await tx.pairing.findUniqueOrThrow({ where: { id: f.pairingId } }), sessions: await tx.session.findMany({ where: { pairingId: f.pairingId } }) };
  const result = await transferPersonParticipation(tx, f.reviewerId, await reviewed(tx, f));
  expect(await tx.pairing.findUniqueOrThrow({ where: { id: f.pairingId } })).toEqual(before.pairing);
  expect(await tx.session.findMany({ where: { pairingId: f.pairingId } })).toEqual(before.sessions);
  expect(await tx.pairing.findUniqueOrThrow({ where: { id: result.successorPairingIds[0]! }, include: { tutees: true } })).toMatchObject({ tutorId: f.tutorB, termId: f.termId, tutees: [{ tuteeId: f.student }] });
  expect(await tx.user.findUniqueOrThrow({ where: { id: f.userB } })).toMatchObject({ tutorId: f.tutorB });
  expect(await tx.user.findUniqueOrThrow({ where: { id: f.userA } })).toMatchObject({ tutorId: null });
  expect(await executionParticipantId(tx, "TUTOR", f.tutorA)).toBe(f.tutorB);
  expect(await supersededPairingIds(tx)).toContain(f.pairingId);
}));

it("recovers an accepted response by immutable receipt without repeating the transfer", async () => fixture(async (tx, f) => {
  const input = await reviewed(tx, f);
  const accepted = await transferPersonParticipation(tx, f.reviewerId, input);
  expect(await transferPersonParticipation(tx, f.reviewerId, input)).toEqual(accepted);
  expect(await personParticipationTransferReceipt(tx, f.reviewerId, input.operationId)).toEqual(accepted);
  expect(await tx.pairingExecutionSuccessor.count({ where: { sourcePairingId: f.pairingId } })).toBe(1);
}));

it("rejects a wrong confirmation without changing participation, then accepts a fresh review", async () => fixture(async (tx, f) => {
  const input = await reviewed(tx, f);
  const snapshot = async () => ({
    users: await tx.user.findMany({ where: { id: { in: [f.userA, f.userB] } }, orderBy: { id: "asc" } }),
    tutors: await tx.tutor.findMany({ where: { id: { in: [f.tutorA, f.tutorB] } }, orderBy: { id: "asc" } }),
    pairing: await tx.pairing.findUniqueOrThrow({ where: { id: f.pairingId } }),
    successors: await tx.pairingExecutionSuccessor.findMany({ where: { sourcePairingId: f.pairingId } }),
  });
  const before = await snapshot();
  await expect(transferPersonParticipation(tx, f.reviewerId, { ...input, confirmPassword: "Incorrect synthetic password" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Password is incorrect." });
  expect(await snapshot()).toEqual(before);
  expect(await personParticipationTransferReceipt(tx, f.reviewerId, input.operationId)).toBeNull();
  const fresh = { ...await reviewed(tx, f), reason: input.reason };
  expect(await transferPersonParticipation(tx, f.reviewerId, fresh)).toMatchObject({ ok: true, receiptId: fresh.operationId });
}));

it.each(["demoted", "suspended", "missing"] as const)("keeps participation reviewer %s failures distinct from password input", async (condition) => fixture(async (tx, f) => {
  const input = await reviewed(tx, f);
  if (condition === "demoted") await tx.user.update({ where: { id: f.reviewerId }, data: { role: "COORDINATOR" } });
  if (condition === "suspended") await tx.user.update({ where: { id: f.reviewerId }, data: { suspendedAt: new Date() } });
  const actorId = condition === "missing" ? f.id("missing-reviewer") : f.reviewerId;
  await expect(transferPersonParticipation(tx, actorId, { ...input, confirmPassword: "Incorrect synthetic password" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await tx.personParticipationTransferReceipt.findUnique({ where: { id: input.operationId } })).toBeNull();
  expect(await tx.pairingExecutionSuccessor.count({ where: { sourcePairingId: f.pairingId } })).toBe(0);
}));

it("does not permit a nonselected tutor target in a learner-only request", async () => fixture(async (tx, f) => {
  const before = await tx.user.findMany({ where: { id: { in: [f.userA, f.userB] } } });
  await expect(previewPersonParticipationTransfer(tx, { ...f.selection, tutorIds: [], tuteeIds: [f.student], activeTuteeId: f.student })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await tx.user.findMany({ where: { id: { in: [f.userA, f.userB] } } })).toEqual(before);
  expect(await tx.tutor.findUniqueOrThrow({ where: { id: f.tutorB } })).toMatchObject({ status: "ACTIVE" });
}));

it("does not permit a nonselected learner target in a tutor-only request", async () => fixture(async (tx, f) => {
  await expect(previewPersonParticipationTransfer(tx, { ...f.selection, activeTuteeId: f.student })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await tx.user.findUniqueOrThrow({ where: { id: f.userB } })).toMatchObject({ studentId: null });
}));

it("rejects an unrelated selected source without changing its active pointer", async () => fixture(async (tx, f) => {
  const outside = f.id("outside");
  await tx.tutor.create({ data: { id: outside, englishName: "Unrelated", status: "ARCHIVED" } });
  await expect(previewPersonParticipationTransfer(tx, { ...f.selection, activeTutorId: outside, tutorIds: [f.tutorA, outside] })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await tx.tutor.findUniqueOrThrow({ where: { id: outside } })).toMatchObject({ status: "ARCHIVED", personId: null });
}));

it("retains only the approved concrete qualification tuples and original approver", async () => fixture(async (tx, f) => {
  await tx.tutorQualification.create({ data: { tutorId: f.tutorA, subjectId: f.id("source-subject"), approvedById: f.reviewerId, grants: { create: { subjectId: f.id("old-concrete") } } } });
  await transferPersonParticipation(tx, f.reviewerId, await reviewed(tx, f));
  expect(await tx.qualificationGrant.findMany({ where: { tutorId: f.tutorB }, select: { sourceSubjectId: true, subjectId: true } })).toEqual([{ sourceSubjectId: f.id("source-subject"), subjectId: f.id("old-concrete") }]);
  expect(await tx.qualificationTransferGrant.findFirst({ where: { targetTutorId: f.tutorB } })).toMatchObject({ sourceTutorId: f.tutorA, approvedById: f.reviewerId });
}));

it("advances source authority when explicitly returning A to B to A", async () => fixture(async (tx, f) => {
  await transferPersonParticipation(tx, f.reviewerId, await reviewed(tx, f));
  const back = { ...f.selection, activeTutorId: f.tutorA };
  const preview = await previewPersonParticipationTransfer(tx, back);
  expect(preview.canTransfer).toBe(true);
  await transferPersonParticipation(tx, f.reviewerId, await reviewed(tx, f, back));
  expect(await executionParticipantId(tx, "TUTOR", f.tutorB)).toBe(f.tutorA);
  expect(await executionParticipantId(tx, "TUTOR", f.tutorA)).toBe(f.tutorA);
  expect(await tx.participantConsolidation.findUnique({ where: { kind_sourceId: { kind: "TUTOR", sourceId: f.tutorA } } })).toMatchObject({ active: false, revision: 2 });
}));

it("does not erase current or prior response evidence when rebinding execution", async () => fixture(async (tx, f) => {
  const planId = f.id("plan"), cohortId = f.id("cohort"), requestId = f.id("request"), offerId = f.id("offer"), responseId = f.id("response");
  const future = new Date(Date.now() + 14 * 86400000);
  future.setUTCDate(future.getUTCDate() + (2 - future.getUTCDay() + 7) % 7);
  const date = future.toISOString().slice(0, 10);
  const { startsAt, endsAt } = plannedWindow({ date, startMin: 600, online: false }, "Asia/Shanghai");
  await tx.policyDocument.upsert({ where: { slug_locale: { slug: "tutor-policy", locale: "en" } }, create: { slug: "tutor-policy", locale: "en", title: "Synthetic policy", body: "Synthetic tutoring rules", version: "1" }, update: {} });
  const policy = await currentPolicy(tx, "tutor-policy");
  await tx.policyAcceptance.create({ data: { userId: f.userB, slug: "tutor-policy", revision: policy.revision, snapshot: policy.documents, signature: "Synthetic current tutor" } });
  await tx.sessionPlan.create({ data: { id: planId, generationKey: planId, tutorId: f.tutorA, termId: f.termId, originalDate: startsAt.toISOString().slice(0, 10), timeZone: "Asia/Shanghai", sourceFingerprint: "original", assignments: { create: { pairingId: f.pairingId, subject: "Synthetic mathematics", tuteeIds: [f.student], primary: true } } } });
  await tx.sessionPlanCohort.create({ data: { id: cohortId, planId, date, startMin: 600, endMin: 645, startsAt, endsAt } });
  await tx.sessionPlanParticipant.create({ data: { planId, tuteeId: f.student, cohortId } });
  await tx.sessionPlanningRequest.create({ data: { id: requestId, planId, cohortId, kind: "RESCHEDULE", scope: "ONE", participantIds: [f.student], currentOfferId: offerId, offers: { create: { id: offerId, sequence: 1, authorKey: `tutee:${f.student}`, date: startsAt.toISOString().slice(0, 10), startMin: 660, endMin: 705, startsAt: new Date(+startsAt + 3600000), endsAt: new Date(+endsAt + 3600000), cutoffAt: startsAt, responses: { create: { id: responseId, actorKey: `tutor:${f.tutorA}`, actorUserId: f.userA, deliveredAt: new Date(), deadline: new Date(Date.now() + 86400000) } } } } } });
  const before = await tx.sessionPlanningResponse.findUniqueOrThrow({ where: { id: responseId } });
  await transferPersonParticipation(tx, f.reviewerId, await reviewed(tx, f));
  expect(await tx.sessionPlanningResponse.findUniqueOrThrow({ where: { id: responseId } })).toEqual(before);
  expect(await executionResponseActor(tx, before)).toEqual({ userId: f.userB, actorKey: `tutor:${f.tutorB}` });
  expect(await executionPlanTutorId(tx, planId, f.tutorA)).toBe(f.tutorB);
  const plan = await tx.sessionPlan.findUniqueOrThrow({ where: { id: planId }, include: { term: true, assignments: true, participants: true, continuationMembers: true } });
  expect(await transferredPlanIsCurrent(tx, plan, false)).toBe(true);
  await readSessionAgenda(tx, { id: f.userB, tutorId: f.tutorB }, "tutor");
  await sweepSessionPlanning(tx);
  const pending = await tx.sessionPlanningRequest.findUniqueOrThrow({ where: { id: requestId } });
  expect(pending.status).toBe("PENDING");
  expect(await tx.sessionPlanningResponse.findUniqueOrThrow({ where: { id: responseId } })).toEqual(before);
  await tx.user.update({ where: { id: f.userA }, data: { suspendedAt: new Date() } });
  expect(await transferredPlanIsCurrent(tx, plan, false)).toBe(false);
  await expect(respondSession(tx, { id: f.userB, tutorId: f.tutorB }, { requestId, offerId, expectedVersion: pending.version, clientKey: randomUUID(), decision: "ACCEPT" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await tx.sessionPlanningResponse.findUniqueOrThrow({ where: { id: responseId } })).toEqual(before);
  await tx.user.update({ where: { id: f.userA }, data: { suspendedAt: null } });
  await respondSession(tx, { id: f.userB, tutorId: f.tutorB }, { requestId, offerId, expectedVersion: pending.version, clientKey: randomUUID(), decision: "ACCEPT" });
  expect(await tx.sessionPlanningRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: "ACCEPTED" });
  expect(await tx.sessionPlanningResponse.findUniqueOrThrow({ where: { id: responseId } })).toMatchObject({ actorUserId: f.userA, actorKey: before.actorKey, state: "ACCEPTED", deliveredAt: before.deliveredAt, deadline: before.deadline });
  expect(await tx.sessionResponseExecution.findUniqueOrThrow({ where: { responseId } })).toMatchObject({ respondedByUserId: f.userB });
  await tx.term.update({ where: { id: f.termId }, data: { active: false } });
  await tx.tutee.update({ where: { id: f.student }, data: { status: "INACTIVE" } });
  expect(await transferredPlanIsCurrent(tx, { ...plan, term: { ...plan.term, active: false } }, true)).toBe(true);
  const agreed = await tx.sessionPlanParticipant.findUniqueOrThrow({ where: { planId_tuteeId: { planId, tuteeId: f.student } }, include: { cohort: true } });
  expect(await sessionAttendanceContext(tx, { id: f.userB, tutorId: f.tutorB }, agreed.cohortId!, undefined, new Date(+agreed.cohort!.endsAt + 1))).toMatchObject({ tutorId: f.tutorB, tuteeIds: [f.student] });
}));

it("includes transitive predecessor evidence after repeated family transfer", async () => fixture(async (tx, f) => {
  const future = new Date(Date.now() + 7 * 86400000);
  future.setUTCDate(future.getUTCDate() + (2 - future.getUTCDay() + 7) % 7);
  const date = future.toISOString().slice(0, 10), planId = f.id("cancelled-plan");
  const window = plannedWindow({ date, startMin: 600, online: false }, "Asia/Shanghai");
  await tx.sessionPlan.create({ data: { id: planId, generationKey: planId, tutorId: f.tutorA, termId: f.termId, originalDate: date, timeZone: "Asia/Shanghai", sourceFingerprint: "original-cancelled", assignments: { create: { pairingId: f.pairingId, subject: "Synthetic mathematics", tuteeIds: [f.student], primary: true } }, cohorts: { create: { ...window, status: "CANCELLED" } } } });
  const before = await tx.sessionPlan.findUniqueOrThrow({ where: { id: planId }, include: { cohorts: true, assignments: true } });
  const first = await transferPersonParticipation(tx, f.reviewerId, await reviewed(tx, f));
  const tutorC = f.id("tutor-c");
  await tx.tutor.create({ data: { id: tutorC, personId: f.personId, englishName: "Third source", status: "ACTIVE" } });
  const selection = { ...f.selection, tutorIds: [f.tutorB, tutorC], activeTutorId: tutorC };
  const second = await transferPersonParticipation(tx, f.reviewerId, await reviewed(tx, f, selection));
  expect(await pairingEvidenceIds(tx, second.successorPairingIds)).toEqual(expect.arrayContaining([f.pairingId, ...first.successorPairingIds, ...second.successorPairingIds]));
  await ensureSessionPlanningWindow(tx);
  expect(await tx.sessionPlan.findUniqueOrThrow({ where: { id: planId }, include: { cohorts: true, assignments: true } })).toEqual(before);
  expect(await tx.sessionPlan.count({ where: { originalDate: date, assignments: { some: { pairingId: { in: [...first.successorPairingIds, ...second.successorPairingIds] } } } } })).toBe(0);
}));


it("keeps later exact source restrictions on canonical participation without inheriting unrelated Person restrictions", async () => fixture(async (tx, f) => {
  await tx.user.create({ data: { id: f.id("unrelated-group-account"), email: `${f.id("unrelated-group-account")}@example.test`, personId: f.personId, suspendedAt: new Date() } });
  expect((await previewPersonParticipationTransfer(tx, f.selection)).canTransfer).toBe(true);
  await transferPersonParticipation(tx, f.reviewerId, await reviewed(tx, f));
  const ownership = await tx.historyRowOwnership.findUniqueOrThrow({ where: { entity_recordId: { entity: "Tutor", recordId: f.tutorB } } });
  expect(ownership.sourceUserIds).toEqual(expect.arrayContaining([f.userA, f.userB]));
  expect(ownership.sourceUserIds).not.toContain(f.id("unrelated-group-account"));
  await tx.user.update({ where: { id: f.userA }, data: { suspendedAt: new Date() } });
  await expect(requireParticipantSourceParticipation(tx, "TUTOR", f.tutorB)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const preview = await previewPersonParticipationTransfer(tx, { ...f.selection, tutorIds: [f.tutorB] });
  expect(preview.canTransfer).toBe(false);
  const canonicalRestriction = preview.sourceRestrictions.find((source) => source.sourceId === f.tutorB);
  expect(canonicalRestriction?.blockers).toContainEqual({ userId: f.userA, reason: "SUSPENDED" });
}));


it("transfers compatible live work backed by an independent open request when the canonical profile's own intake is closed", async () => fixture(async (tx, f) => {
  const original = f.id("original-request-student"), surveyId = f.id("independent-survey");
  await tx.tutee.create({ data: { id: original, englishName: "Original independent request", status: "INACTIVE", intakeTermId: f.termId } });
  const submittedAt = new Date("2026-01-01T00:00:00Z");
  await tx.studentSurvey.createMany({ data: [
    { id: f.id("closed-own-survey"), tuteeId: f.student, state: "ABORTED" as const },
    { id: surveyId, tuteeId: original, state: "OPEN" as const },
  ].map((row) => ({ ...row, email: `${row.id}@example.test`, intakeTermId: f.termId, payload: {}, policyRevision: "original", policySnapshot: {}, tokenHash: row.id, expiresAt: new Date("2099-01-01T00:00:00Z"), confirmedAt: submittedAt, submittedAt, firstAssignedAt: submittedAt })) });
  await tx.participantConsolidation.create({ data: { kind: "TUTEE", sourceId: original, targetId: f.student, receiptId: "synthetic-prior-transfer", effectiveAt: submittedAt } });
  await tx.studentRequestExecutionAssignment.create({ data: { surveyId, pairingId: f.pairingId, tuteeId: f.student, sourceTuteeId: original } });
  const before = await tx.studentSurvey.findUniqueOrThrow({ where: { id: surveyId } });
  const result = await transferPersonParticipation(tx, f.reviewerId, await reviewed(tx, f));
  expect(await tx.pairingTutee.findMany({ where: { pairingId: result.successorPairingIds[0] } })).toEqual([{ pairingId: result.successorPairingIds[0], tuteeId: f.student }]);
  expect(await tx.studentRequestExecutionAssignment.findUniqueOrThrow({ where: { surveyId_pairingId: { surveyId, pairingId: result.successorPairingIds[0]! } } })).toMatchObject({ tuteeId: f.student, sourceTuteeId: original, releasedAt: null });
  expect(await tx.studentSurvey.findUniqueOrThrow({ where: { id: surveyId } })).toEqual(before);
}));


it.each([false, true])("preserves original request authority through real A→B→publication→C transfers (independent B request: %s)", async (independentB) => fixture(async (tx, f) => {
  const learnerPersonId = f.id("learner-person"), learnerB = f.id("learner-b"), learnerC = f.id("learner-c"), learnerUser = f.id("retained-learner-user"), peerId = f.id("unrelated-peer");
  const now = new Date(), submittedAt = new Date("2026-01-01T00:00:00Z"), verificationDueAt = new Date("2026-01-08T00:00:00Z");
  await tx.person.create({ data: { id: learnerPersonId } });
  await tx.tutee.update({ where: { id: f.student }, data: { personId: learnerPersonId } });
  await tx.user.update({ where: { id: f.id("student-user") }, data: { personId: learnerPersonId } });
  await tx.tutee.createMany({ data: [
    { id: learnerB, personId: learnerPersonId, englishName: "Intermediate learner B" },
    { id: learnerC, personId: learnerPersonId, englishName: "Chosen learner C" },
    { id: peerId, personId: null, englishName: "Unrelated peer" },
  ].map((row) => ({ ...row, status: "ACTIVE" as const, intakeTermId: f.termId })) });
  await tx.user.createMany({ data: [
    { id: learnerUser, personId: learnerPersonId, studentId: learnerB, email: `${learnerUser}@example.test`, passwordHash, tuteeMember: true, emailVerifiedAt: submittedAt },
    { id: f.id("peer-user"), studentId: peerId, email: `${f.id("peer-user")}@example.test`, tuteeMember: true, emailVerifiedAt: submittedAt },
  ] });
  await tx.pairingTutee.createMany({ data: [peerId, ...(independentB ? [learnerB] : [])].map((tuteeId) => ({ pairingId: f.pairingId, tuteeId })) });
  const requests = [];
  for (const tuteeId of [f.student, ...(independentB ? [learnerB] : [])]) {
    requests.push(await tx.studentSurvey.create({ data: {
      id: f.id(`survey-${tuteeId}`), tuteeId, intakeTermId: f.termId,
      email: `${tuteeId}@example.test`, tokenHash: f.id(`token-${tuteeId}`),
      payload: { englishName: tuteeId, signatureName: `Original signature ${tuteeId}` },
      policyRevision: "original-reviewed-policy", policySnapshot: { signedBy: tuteeId },
      submittedAt, confirmedAt: submittedAt, firstAssignedAt: submittedAt, verificationDueAt,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    } }));
  }
  const originalA = requests[0]!, originalB = requests[1];
  const transfer = async (tuteeIds: string[], activeTuteeId: string) => {
    const selection = { personId: learnerPersonId, retainedUserId: learnerUser, tutorIds: [], activeTutorId: null, tuteeIds, activeTuteeId, acknowledgeHistoryAccessCorrection: true };
    const preview = await previewPersonParticipationTransfer(tx, selection);
    expect(preview.blockers).toEqual([]);
    return transferPersonParticipation(tx, f.reviewerId, { ...selection, fingerprint: preview.fingerprint, operationId: randomUUID(), reason: "Review exact original requests through repeated learner execution transfer", acknowledged: true, confirmPassword: password });
  };

  // Both aliases and all provenance below must be written by the real transfer
  // service. Publication then captures B through the ordinary planning writer.
  const first = await transfer([f.student, learnerB], learnerB);
  expect(await executionParticipantId(tx, "TUTEE", f.student)).toBe(learnerB);
  await ensureSessionPlanningWindow(tx, now);
  const published = await tx.sessionPlan.findFirstOrThrow({
    where: { assignments: { some: { pairingId: { in: first.successorPairingIds } } }, cohorts: { some: { status: "SCHEDULED", startsAt: { gt: now } } } },
    include: { assignments: true, participants: true, cohorts: true }, orderBy: { originalDate: "asc" },
  });
  const originalParticipant = published.participants.find((row) => row.tuteeId === learnerB)!;
  const peerBefore = published.participants.find((row) => row.tuteeId === peerId)!;
  expect(originalParticipant).toBeDefined();
  expect(peerBefore).toBeDefined();
  expect(await tx.sessionParticipantExecution.findUnique({ where: { participantId: originalParticipant.id } })).toBeNull();
  const assignmentsBefore = published.assignments;
  const second = await transfer([learnerB, learnerC], learnerC);
  const successorId = second.successorPairingIds[0]!;
  expect(await executionParticipantId(tx, "TUTEE", f.student)).toBe(learnerC);
  const pinBefore = await tx.sessionParticipantExecution.findUniqueOrThrow({ where: { participantId: originalParticipant.id } });
  expect(pinBefore).toMatchObject({ tuteeId: learnerC });
  expect([...pinBefore.sourceSurveyIds].sort()).toEqual(requests.map((row) => row.id).sort());

  const assertPeerAndPublicationSurvive = async (learnerScheduled: boolean) => {
    // Exercise ordinary invalidation/publication after the real request release;
    // a false stale-source result would cancel the unrelated peer here.
    await ensureSessionPlanningWindow(tx, now);
    expect(await tx.sessionPlanParticipant.findUniqueOrThrow({ where: { id: peerBefore.id } })).toEqual(peerBefore);
    expect(await tx.sessionPlanCohort.findUniqueOrThrow({ where: { id: peerBefore.cohortId! } })).toMatchObject({ status: "SCHEDULED" });
    expect(await tx.sessionPlanParticipant.findUniqueOrThrow({ where: { id: originalParticipant.id } })).toMatchObject({ tuteeId: learnerB, status: learnerScheduled ? "SCHEDULED" : "CANCELLED" });
    expect(await tx.pairingTutee.count({ where: { pairingId: successorId, tuteeId: learnerC } })).toBe(learnerScheduled ? 1 : 0);
    expect(await tx.sessionPlanAssignment.findMany({ where: { planId: published.id } })).toEqual(assignmentsBefore);
    expect(await tx.sessionParticipantExecution.findUniqueOrThrow({ where: { participantId: originalParticipant.id } })).toEqual(pinBefore);
    const currentPlan = await tx.sessionPlan.findUniqueOrThrow({ where: { id: published.id }, include: { term: true, assignments: true, participants: true, continuationMembers: true } });
    expect(await transferredPlanIsCurrent(tx, currentPlan, false)).toBe(true);
  };
  await closeStudentRequest(tx, await tx.studentSurvey.findUniqueOrThrow({ where: { id: originalA.id } }), "ABORTED", now);
  await assertPeerAndPublicationSurvive(independentB);
  expect(await tx.studentSurvey.findUniqueOrThrow({ where: { id: originalA.id } })).toMatchObject({ state: "ABORTED", tuteeId: originalA.tuteeId, payload: originalA.payload, policySnapshot: originalA.policySnapshot, submittedAt, firstAssignedAt: submittedAt, verificationDueAt });
  if (originalB) {
    expect(await tx.studentSurvey.findUniqueOrThrow({ where: { id: originalB.id } })).toEqual(originalB);
    await closeStudentRequest(tx, originalB, "ABORTED", now);
    await assertPeerAndPublicationSurvive(false);
  }
}));
