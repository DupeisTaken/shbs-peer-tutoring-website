import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeEach, expect, it } from "vitest";
import { computeSessionHours } from "~/lib/service-hours";
import { db } from "~/server/db";
import { databaseScope } from "~/server/db-scope";
import { currentPolicy } from "~/server/policy-acceptance";
import { approveQualification } from "~/server/qualifications";
import { resolveStudentReview } from "~/server/student-workflow";
import { readQuarterWithdrawalEvidence } from "~/server/student-quarter-withdrawal";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { applyRecoveryCheckpoint, applyRecoveryCheckpointFromOperator, captureRecoveryCheckpoint, inspectRecoveryCheckpoint } from "./checkpoint";
import type { CheckpointAdapterId } from "./checkpoint-contract";
import { quarterWithdrawalRecoveryBlocker, studentQuarterWithdrawalCheckpointAdapter } from "./adapters/student-quarter-withdrawal";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
  throw new Error("Root-client checkpoint fixtures require the serial shbs_shipping_test database");

const ids = {
  head: "readonly-checkpoint-head", tutor: "readonly-checkpoint-tutor",
  tutee: "readonly-checkpoint-tutee", subject: "readonly-checkpoint-subject",
  slot: "readonly-checkpoint-slot", room: "readonly-checkpoint-room",
  term: "readonly-checkpoint-term", pairing: "readonly-checkpoint-pairing",
  session: "readonly-checkpoint-session", card: "readonly-checkpoint-card",
  survey: "readonly-checkpoint-survey",
};

beforeEach(async () => {
  // These committed fixtures deliberately exercise the root-client transaction
  // branch. A rollback-wrapped fixture would hide forbidden FOR SHARE/UPDATE.
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) =>
    '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.create({ data: { id: ids.head, role: "HEAD", email: "readonly-head@example.test" } });
  await db.term.create({ data: { id: ids.term, name: "Synthetic read-only term", schoolYear: "26-27", quarter: "Q1", active: true } });
  await db.programSettings.create({ data: { signupFields: {}, nameFields: {}, emailNotificationsEnabled: false } });
  await db.subject.create({ data: { id: ids.subject, name: "Synthetic read-only mathematics" } });
  await db.timeSlot.create({ data: { id: ids.slot, label: "Synthetic Monday", dayOfWeek: 1, startMin: 960, endMin: 1020 } });
  await db.room.create({ data: { id: ids.room, name: "Synthetic read-only room" } });
  await db.tutor.create({ data: { id: ids.tutor, englishName: "Synthetic Readonly Tutor", status: "ACTIVE" } });
  await db.tutee.create({ data: { id: ids.tutee, englishName: "Synthetic Readonly Learner", status: "ACTIVE",
    intakeTermId: ids.term, firstChoiceId: ids.subject, signedRulebook: true,
    signatureName: "Synthetic explicit agreement", signedAt: new Date(), availabilities: { create: { slotId: ids.slot } } } });
  await db.user.create({ data: { id: "readonly-tutor-account", role: "TUTOR", email: "readonly-tutor@example.test",
    tutorId: ids.tutor, emailVerifiedAt: new Date(), academicProfile: { create: { status: "NOT_APPLICABLE", reconfirmRequired: false } } } });
  const learner = await db.user.create({ data: { id: "readonly-learner-account", role: "STUDENT", email: "readonly-learner@example.test",
    studentId: ids.tutee, tuteeMember: true, emailVerifiedAt: new Date(), academicProfile: { create: { status: "NOT_APPLICABLE", reconfirmRequired: false } } } });
  for (const [slug, userId] of [["tutor-policy", "readonly-tutor-account"], ["tutee-policy", learner.id]] as const) {
    await db.policyDocument.create({ data: { slug, locale: "en", title: "Synthetic current policy", body: `Synthetic current ${slug} agreement` } });
    const policy = await currentPolicy(db, slug);
    await db.policyAcceptance.create({ data: { userId, slug, revision: policy.revision, snapshot: policy.documents, signature: "Synthetic explicit agreement" } });
  }
  await db.$transaction((tx) => approveQualification(tx, ids.tutor, ids.subject, ids.head));
  await db.pairing.create({ data: { id: ids.pairing, tutorId: ids.tutor, termId: ids.term,
    subject: "Synthetic read-only mathematics", dayOfWeek: 1, startMin: 960, endMin: 1020,
    timeSlotId: ids.slot, roomId: ids.room, scheduleConfirmed: true, tutees: { create: { tuteeId: ids.tutee } } } });
  const date = new Date("2026-10-12T00:00:00Z");
  await db.session.create({ data: { id: ids.session, tutorId: ids.tutor, pairingId: ids.pairing,
    date, startMin: 960, endMin: 1020, schoolYear: "26-27", quarter: "Q1", tutorStatus: "PRESENT",
    ...computeSessionHours({ date, startMin: 960, endMin: 1020, tutorStatus: "PRESENT", tuteeStatuses: ["PRESENT"] }),
    actualRoomId: ids.room, timeSlotId: ids.slot, ratingPreparedness: 3, ratingParticipation: 3,
    ratingUnderstanding: 3, ratingBehavior: 3, ratingProgress: 3,
    tutees: { create: { tuteeId: ids.tutee, status: "PRESENT" } } } });
  await db.disciplinaryCard.create({ data: { id: ids.card, tuteeId: ids.tutee, sessionId: ids.session,
    issuedByTutorId: ids.tutor, color: "YELLOW", source: "TUTOR", reviewStatus: "PENDING", reason: "Synthetic pending request" } });
  const policy = await currentPolicy(db, "tutee-policy");
  await db.studentSurvey.create({ data: { id: ids.survey, email: learner.email, intakeTermId: ids.term,
    tuteeId: ids.tutee, confirmedAt: new Date(), expiresAt: new Date("2099-01-01T00:00:00Z"), tokenHash: "c".repeat(64),
    policyRevision: policy.revision, policySnapshot: policy.documents,
    payload: { firstName: "Synthetic", lastName: "Learner", englishName: "Synthetic Learner",
      email: learner.email, preferredContact: "Synthetic account", firstChoiceId: ids.subject, slotIds: [ids.slot],
      signatureName: "Synthetic explicit agreement", agreed: true, policyRevision: policy.revision } } });
});
afterAll(() => db.$disconnect());

const restorableAdapterIds = ["PARTICIPANT_TUTOR", "PARTICIPANT_TUTEE", "STUDENT_WORKFLOW",
  "ATTENDANCE", "CARD", "PROGRAM_REFRESH"] as const satisfies readonly CheckpointAdapterId[];
it.each(restorableAdapterIds)("runs the complete %s preview through a root-client READ ONLY transaction", async (adapter) => {
  const sourceId = { PARTICIPANT_TUTOR: ids.tutor, PARTICIPANT_TUTEE: ids.tutee,
    STUDENT_WORKFLOW: ids.survey, ATTENDANCE: ids.session, CARD: ids.card, PROGRAM_REFRESH: ids.term }[adapter];
  const checkpoint = await captureRecoveryCheckpoint(db, { adapter, sourceId }, { id: ids.head });
  expect(databaseScope.getStore()).toBeUndefined();
  const before = await db.recoveryChange.count({ where: { actionId: checkpoint.actionId } });
  // Passing db, not a TransactionDb, makes inspect establish READ ONLY before
  // its first graph query; PostgreSQL itself enforces the no-row-lock contract.
  const plan = await inspectRecoveryCheckpoint(db, checkpoint);
  expect(plan.coverage).toBe("COMPLETE");
  expect(plan.websiteEligible).toBe(true);
  expect(plan.dependentEventCount).toBe(0);
  expect(await db.recoveryChange.count({ where: { actionId: checkpoint.actionId } })).toBe(before);
  expect(await db.recoveryReceipt.count({ where: { actionId: checkpoint.actionId } })).toBe(0);
});

it("inspects an approved quarter withdrawal under root-client READ ONLY and rejects both apply channels before any effects", async () => {
  const review = await db.studentRequestReview.create({ data: { surveyId: ids.survey,
    kind: "STUDENT_ABORT", requestedByUserId: "readonly-learner-account",
    reason: "Synthetic private withdrawal reason", createdAt: new Date(0) } });
  const ticket = await db.studentActionConfirmation.create({ data: { userId: ids.head,
    action: "APPROVE", target: review.id, readyAt: new Date(0), expiresAt: new Date("2099-01-01T00:00:00Z") } });
  await resolveStudentReview(db, ids.head, review.id, true, ticket.id);
  const checkpoint = await db.recoveryCheckpoint.findFirstOrThrow({ where: {
    adapter: "STUDENT_QUARTER_WITHDRAWAL", sourceId: review.id } });
  expect(checkpoint).toMatchObject({ sourceEntity: "StudentRequestReview", adapterVersion: 1, schemaVersion: 1 });
  const action = await db.recoveryAction.findUniqueOrThrow({ where: { id: checkpoint.actionId } });
  const captured = JSON.stringify(action.before);
  for (const privateValue of ["Synthetic private withdrawal reason", "Synthetic explicit agreement",
    "readonly-learner@example.test", '"payload"', '"currentPayload"', '"signatureName"', '"answers"'])
    expect(captured).not.toContain(privateValue);
  expect(await db.studentRequestReview.findUniqueOrThrow({ where: { id: review.id } })).toMatchObject({ state: "APPROVED" });
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: ids.survey } })).toMatchObject({ state: "ABORTED" });

  const snapshot = async () => ({
    evidence: await readQuarterWithdrawalEvidence(db, { reviewId: review.id }),
    receipts: await db.recoveryReceipt.findMany(),
    drafts: await db.recoveryWorkflowDraft.findMany(),
    cancellations: await db.recoveryDeliveryCancellation.findMany(),
    fences: await db.recoveryFence.findMany({ orderBy: { actionId: "asc" } }),
    journal: await db.recoveryChange.count(),
    events: await db.recoveryEvent.count(),
    tracked: await db.recoveryTrackedEntity.count(),
    notices: await db.notification.findMany({ select: { id: true, readAt: true, recoveryWithdrawnAt: true }, orderBy: { id: "asc" } }),
    deliveries: await db.emailDelivery.findMany({ select: { id: true, status: true, attempts: true, attemptId: true }, orderBy: { id: "asc" } }),
  });
  expect(databaseScope.getStore()).toBeUndefined();
  const before = await snapshot();
  // A root client is essential: inspect establishes PostgreSQL READ ONLY itself.
  // The post-close reader must not re-enter pending-only withdrawal validation.
  const plan = await inspectRecoveryCheckpoint(db, { checkpointId: checkpoint.id });
  expect(plan).toMatchObject({ coverage: "UNKNOWN", websiteEligible: false, receiptId: null });
  expect(plan.blockers).toContain(quarterWithdrawalRecoveryBlocker);
  expect(plan.delivery.effects.length).toBeGreaterThan(0);
  expect(await snapshot()).toEqual(before);
  for (const apply of [applyRecoveryCheckpoint, applyRecoveryCheckpointFromOperator]) {
    const error = await apply(db, { checkpointId: checkpoint.id, expectedFingerprint: plan.fingerprint,
      clientKey: randomUUID(), reason: "Synthetic blocked quarter withdrawal recovery" }, { id: ids.head })
      .then(() => null, (cause: unknown) => cause);
    expect(error).toBeInstanceOf(TRPCError);
    if (!(error instanceof TRPCError)) throw new Error("Expected a blocked withdrawal recovery error");
    expect(error.code).toBe("PRECONDITION_FAILED");
    expect(error.message).toContain(quarterWithdrawalRecoveryBlocker);
    expect(await snapshot()).toEqual(before);
  }
  await expect(studentQuarterWithdrawalCheckpointAdapter.apply(db, review.id, action.before,
    { id: ids.head }, "Synthetic direct adapter defense", { actionId: action.id,
      scope: [], changes: [], events: [] }))
    .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: quarterWithdrawalRecoveryBlocker });
  expect(await snapshot()).toEqual(before);

  const notice = plan.delivery.effects.find((effect) => !effect.deliveryId && effect.notificationId);
  expect(notice).toBeDefined();
  await db.notification.update({ where: { id: notice!.notificationId! }, data: { readAt: new Date() } });
  const observed = await inspectRecoveryCheckpoint(db, { checkpointId: checkpoint.id });
  expect(observed.fingerprint).not.toBe(plan.fingerprint);
  expect(observed.delivery.fingerprint).not.toBe(plan.delivery.fingerprint);
  expect(observed.delivery.effects).toContainEqual(expect.objectContaining({
    id: notice!.id, disposition: "OBSERVED_NOTICE" }));
  expect(observed.blockers).toContain(quarterWithdrawalRecoveryBlocker);
  expect(observed.websiteEligible).toBe(false);
});

it("binds a root-client signup preview to catalogue A→B→A revisions and current normalization configuration", async () => {
  const checkpoint = await captureRecoveryCheckpoint(db, { adapter: "STUDENT_WORKFLOW", sourceId: ids.survey }, { id: ids.head });
  const before = await inspectRecoveryCheckpoint(db, checkpoint);
  expect(before.coverage).toBe("COMPLETE");
  await db.timeSlot.update({ where: { id: ids.slot }, data: { label: "Changed synthetic availability" } });
  await db.timeSlot.update({ where: { id: ids.slot }, data: { label: "Synthetic Monday" } });
  const returned = await inspectRecoveryCheckpoint(db, checkpoint);
  expect(returned.fingerprint).not.toBe(before.fingerprint);
  await expect(applyRecoveryCheckpoint(db, { checkpointId: checkpoint.checkpointId,
    expectedFingerprint: before.fingerprint, clientKey: randomUUID(), reason: "Synthetic obsolete catalogue preview" },
  { id: ids.head })).rejects.toMatchObject({ code: "CONFLICT" });
  await db.programSettings.update({ where: { id: "program" }, data: { nameFieldsVersion: { increment: 1 } } });
  const configurationChanged = await inspectRecoveryCheckpoint(db, checkpoint);
  expect(configurationChanged.fingerprint).not.toBe(returned.fingerprint);
  expect(await db.recoveryReceipt.count({ where: { actionId: checkpoint.actionId } })).toBe(0);
});
