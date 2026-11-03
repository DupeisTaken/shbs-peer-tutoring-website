import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db } from "~/server/db";
import { decideMembership } from "~/server/membership";
import { readNextRecruitment } from "~/server/program/next-recruitment";
import { applyProgramRefresh } from "~/server/program/refresh";
import { currentPolicy } from "~/server/policy-acceptance";
import { editOwnedStudentSignup } from "~/server/student-signup-editor";
import { recallStudentRequest } from "~/server/student-workflow";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { applyRecoveryCheckpoint, applyRecoveryCheckpointFromOperator, captureRecoveryCheckpoint,
  inspectRecoveryCheckpoint, withAutomaticRecoveryCheckpoint } from "./checkpoint";
import { consumeRecoveryWorkflowDraft, readRecoveryWorkflowDraft } from "./workflow-draft";
import { recoveryJson } from "./capture";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
afterAll(() => db.$disconnect());
const rollback = "rollback synthetic domain checkpoint";
async function fixture(work: (tx: TransactionDb, data: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  await expect(db.$transaction(async (tx) => {
    const data = await setup(tx);
    await work(tx, data);
    throw new Error(rollback);
  }, { timeout: 40000 })).rejects.toThrow(rollback);
}
async function setup(tx: TransactionDb) {
  const prefix = `checkpoint-${randomUUID()}`;
  await tx.term.updateMany({ where: { active: true }, data: { active: false } });
  const term = await tx.term.create({ data: { id: `${prefix}-term`, schoolYear: "84-85", quarter: "Q1", name: "Synthetic checkpoint term", active: true } });
  const actor = await tx.user.create({ data: { id: `${prefix}-admin`, role: "ADMIN", email: `${prefix}-admin@example.test`, name: "Synthetic reviewer" } });
  const tutor = await tx.tutor.create({ data: { id: `${prefix}-tutor`, englishName: "Synthetic roster tutor", status: "ACTIVE", preferredAssignedBlocks: 3 } });
  return { prefix, term, actor, tutor };
}
function intent(checkpointId: string, fingerprint: string) {
  return { checkpointId, expectedFingerprint: fingerprint, clientKey: randomUUID(), reason: "Synthetic reviewed checkpoint compensation" };
}

it("captures an ordinary tutor decision atomically and compensates lifecycle while retaining its decision history", async () => {
  await fixture(async (tx, { tutor, actor }) => {
    const request = await tx.tutorStatusRequest.create({ data: { tutorId: tutor.id, kind: "OPT_OUT", eligibleAt: new Date(0) } });
    await decideMembership(tx, "tutor", request.id, true, actor);
    const checkpoint = await tx.recoveryCheckpoint.findFirstOrThrow({ where: { adapter: "PARTICIPANT_TUTOR", sourceId: tutor.id } });
    expect(checkpoint.schemaVersion).toBe(1);
    expect(await tx.recoveryAction.findUniqueOrThrow({ where: { id: checkpoint.actionId } })).toMatchObject({ applicationId: null });
    expect((await tx.tutor.findUniqueOrThrow({ where: { id: tutor.id } })).status).toBe("OPTED_OUT");
    const plan = await inspectRecoveryCheckpoint(tx, { checkpointId: checkpoint.id });
    expect(plan.coverage).toBe("COMPLETE");
    expect(plan.dependentEventCount).toBe(0);
    expect(plan.websiteEligible).toBe(true);
    const input = intent(checkpoint.id, plan.fingerprint);
    const receipt = await applyRecoveryCheckpoint(tx, input, actor);
    expect(await applyRecoveryCheckpoint(tx, input, actor)).toMatchObject({ receiptId: receipt.receiptId, replayed: true });
    expect(await tx.tutor.findUniqueOrThrow({ where: { id: tutor.id } })).toMatchObject({ status: "ACTIVE", preferredAssignedBlocks: 0 });
    expect(await tx.tutorStatusRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ state: "APPROVED" });
    expect(await tx.recoveryReceipt.count({ where: { actionId: checkpoint.actionId } })).toBe(1);
  });
});

it("rolls failed ordinary validation back together with its prospective checkpoint", async () => {
  let sourceId = "";
  await expect(db.$transaction(async (tx) => {
    const data = await setup(tx);
    sourceId = data.tutor.id;
    const request = await tx.tutorStatusRequest.create({ data: { tutorId: data.tutor.id, kind: "OPT_OUT", eligibleAt: new Date(Date.now() + 3600000) } });
    await decideMembership(tx, "tutor", request.id, true, data.actor);
  }, { timeout: 40000 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(sourceId).not.toBe("");
  expect(await db.recoveryCheckpoint.count({ where: { sourceId } })).toBe(0);
  expect(await db.tutor.count({ where: { id: sourceId } })).toBe(0);
});

it("rejects a changed review fingerprint and counts later logical events rather than changed rows", async () => {
  await fixture(async (tx, { tutor, actor }) => {
    const checkpoint = await captureRecoveryCheckpoint(tx, { adapter: "PARTICIPANT_TUTOR", sourceId: tutor.id }, actor);
    const before = await inspectRecoveryCheckpoint(tx, checkpoint);
    await tx.tutor.update({ where: { id: tutor.id }, data: { englishName: "Independent current name" } });
    await expect(applyRecoveryCheckpoint(tx, intent(checkpoint.checkpointId, before.fingerprint), actor)).rejects.toMatchObject({ code: "CONFLICT" });
    // Synthetic event identities represent two distinct later committed actions.
    // The real trigger's same-transaction row grouping is covered separately.
    for (const sequence of [1, 2]) {
      const event = await tx.recoveryEvent.create({ data: { actionId: checkpoint.actionId, transactionId: `synthetic-later-${sequence}`, kind: "UNSUPPORTED" } });
      for (let row = 0; row < sequence; row++) await tx.recoveryChange.create({ data: {
        actionId: checkpoint.actionId, eventId: event.id, entity: "Tutor", operation: "UPDATE",
        recordKey: { id: tutor.id }, before: { id: tutor.id }, after: { id: tutor.id }, changedFields: ["englishName", "updatedAt"],
      } });
    }
    const plan = await inspectRecoveryCheckpoint(tx, checkpoint);
    expect(plan.coverage).toBe("COMPLETE");
    expect(plan.dependentEventCount).toBe(2);
    expect(plan.websiteEligible).toBe(false);
    await expect(applyRecoveryCheckpoint(tx, intent(checkpoint.checkpointId, plan.fingerprint), actor)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(applyRecoveryCheckpointFromOperator(tx, intent(checkpoint.checkpointId, plan.fingerprint), actor)).resolves.toMatchObject({ replayed: false });
  });
});

it("does not treat a source event label as authority to restore another participant's request", async () => {
  await fixture(async (tx, { prefix, tutor, actor }) => {
    const other = await tx.tutor.create({ data: { id: `${prefix}-other`, englishName: "Other independent tutor" } });
    const request = await tx.tutorStatusRequest.create({ data: { tutorId: other.id, kind: "OPT_OUT", eligibleAt: new Date(0) } });
    await withAutomaticRecoveryCheckpoint(tx, { adapter: "PARTICIPANT_TUTOR", sourceId: tutor.id }, actor,
      () => tx.tutorStatusRequest.update({ where: { id: request.id }, data: { state: "DENIED", resolvedAt: new Date() } }));
    const checkpoint = await tx.recoveryCheckpoint.findFirstOrThrow({ where: { sourceId: tutor.id } });
    const plan = await inspectRecoveryCheckpoint(tx, { checkpointId: checkpoint.id });
    expect(plan.coverage).toBe("UNKNOWN");
    expect(plan.blockers.join(" ")).toContain("Unsupported participant descendant");
    await expect(applyRecoveryCheckpointFromOperator(tx, intent(checkpoint.id, plan.fingerprint), actor)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await tx.tutorStatusRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ state: "DENIED", tutorId: other.id });
  });
});

it("requires journal coverage for unknown Recovery-prefixed domain tables", async () => {
  await fixture(async (tx, { tutor, actor }) => {
    const checkpoint = await captureRecoveryCheckpoint(tx, { adapter: "PARTICIPANT_TUTOR", sourceId: tutor.id }, actor);
    await tx.$executeRawUnsafe('CREATE TABLE "RecoveryUnexpectedCheckpointDomain" (id TEXT PRIMARY KEY)');
    const plan = await inspectRecoveryCheckpoint(tx, checkpoint);
    expect(plan.coverage).toBe("UNKNOWN");
    expect(plan.blockers.join(" ")).toContain("RecoveryUnexpectedCheckpointDomain");
  });
});

async function signup(tx: TransactionDb, data: Awaited<ReturnType<typeof setup>>, options: { malformedPayload?: boolean } = {}) {
  const { prefix, term } = data;
  await tx.programSettings.upsert({ where: { id: "program" }, create: { signupFields: {}, nameFields: {} }, update: { signupFields: {}, nameFields: {}, offeredGrades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] } });
  await tx.policyDocument.upsert({ where: { slug_locale: { slug: "tutee-policy", locale: "en" } }, create: { slug: "tutee-policy", locale: "en", title: "Synthetic policy", body: "Synthetic current participation policy" }, update: { body: "Synthetic current participation policy" } });
  const policy = await currentPolicy(tx, "tutee-policy");
  const subject = await tx.subject.create({ data: { id: `${prefix}-subject`, name: `${prefix} subject` } });
  const slot = await tx.timeSlot.create({ data: { id: `${prefix}-slot`, label: "Synthetic Monday availability", dayOfWeek: 1, startMin: 960, endMin: 1020 } });
  const tutee = await tx.tutee.create({ data: { id: `${prefix}-tutee`, englishName: "Canonical synthetic owner", intakeTermId: term.id, firstChoiceId: subject.id, status: "ACTIVE", availabilities: { create: { slotId: slot.id } } } });
  const owner = await tx.user.create({ data: { id: `${prefix}-owner`, role: "STUDENT", email: `${prefix}-owner@example.test`, emailVerifiedAt: new Date(), studentId: tutee.id, tuteeMember: true, passwordHash: "synthetic-unchanged-credential" } });
  await tx.studentProfileOwnership.create({ data: { userId: owner.id, tuteeId: tutee.id } });
  await tx.policyAcceptance.create({ data: { userId: owner.id, slug: "tutee-policy", revision: policy.revision, snapshot: policy.documents, signature: "private-original-signature" } });
  const answers = { firstName: "Synthetic", lastName: "Owner", englishName: "Synthetic Owner", preferredContact: "Original local contact", firstChoiceId: subject.id, slotIds: [slot.id] };
  const survey = await tx.studentSurvey.create({ data: {
    id: `${prefix}-survey`, email: owner.email, intakeTermId: term.id, tuteeId: tutee.id,
    payload: options.malformedPayload ? { legacyAnswer: "synthetic-unrecognized-format" }
      : { ...answers, email: owner.email, signatureName: "private-original-signature", agreed: true, policyRevision: policy.revision },
    policyRevision: policy.revision, policySnapshot: policy.documents, confirmedAt: new Date(),
    tokenHash: randomUUID().replaceAll("-", "").repeat(2), expiresAt: new Date(Date.now() + 3600000),
  } });
  return { owner, tutee, survey, answers };
}

it("captures an ordinary signup edit and appends compensation without replacing original consent or credentials", async () => {
  await fixture(async (tx, data) => {
    const source = await signup(tx, data);
    await editOwnedStudentSignup(tx, source.owner.id, { id: source.survey.id, expectedVersion: 0, clientKey: randomUUID(), answers: { ...source.answers, secondChoiceId: undefined, preferredContact: "Later local contact" } });
    const checkpoint = await tx.recoveryCheckpoint.findFirstOrThrow({ where: { adapter: "STUDENT_WORKFLOW", sourceId: source.survey.id } });
    const plan = await inspectRecoveryCheckpoint(tx, { checkpointId: checkpoint.id });
    expect(plan.coverage).toBe("COMPLETE");
    await applyRecoveryCheckpoint(tx, intent(checkpoint.id, plan.fingerprint), data.actor);
    const restored = await tx.studentSurvey.findUniqueOrThrow({ where: { id: source.survey.id } });
    expect(restored).toMatchObject({ currentVersion: 2, payload: source.survey.payload,
      policySnapshot: source.survey.policySnapshot, policyRevision: source.survey.policyRevision,
      tokenHash: source.survey.tokenHash, submittedAt: source.survey.submittedAt, confirmedAt: source.survey.confirmedAt });
    expect(restored.currentPayload).toHaveProperty("preferredContact", "Original local contact");
    expect(await tx.studentSignupRevision.count({ where: { surveyId: source.survey.id } })).toBe(2);
    expect(await tx.user.findUniqueOrThrow({ where: { id: source.owner.id } })).toMatchObject({ passwordHash: source.owner.passwordHash, sessionVersion: source.owner.sessionVersion });
  });
});

it("keeps a recalled request closed and requires exact-owner fresh submission through a consumed draft receipt", async () => {
  await fixture(async (tx, data) => {
    const source = await signup(tx, data);
    const ticket = await tx.studentActionConfirmation.create({ data: { userId: source.owner.id, action: "RECALL", target: source.survey.id, readyAt: new Date(0), expiresAt: new Date(Date.now() + 3600000) } });
    await recallStudentRequest(tx, source.owner.id, source.survey.id, ticket.id);
    const checkpoint = await tx.recoveryCheckpoint.findFirstOrThrow({ where: { adapter: "STUDENT_WORKFLOW", sourceId: source.survey.id } });
    const plan = await inspectRecoveryCheckpoint(tx, { checkpointId: checkpoint.id });
    expect(plan.coverage).toBe("COMPLETE");
    expect(plan.warnings.join(" ")).toContain("owner");
    await applyRecoveryCheckpoint(tx, intent(checkpoint.id, plan.fingerprint), data.actor);
    const draft = await tx.recoveryWorkflowDraft.findFirstOrThrow({ where: { actionId: checkpoint.actionId } });
    expect(await readRecoveryWorkflowDraft(tx, { draftId: draft.id }, source.owner)).toMatchObject({ state: "PENDING_OWNER_REVIEW", version: 1 });
    await expect(readRecoveryWorkflowDraft(tx, { draftId: draft.id }, data.actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(JSON.stringify(draft.answers)).not.toContain("private-original-signature");
    expect(await tx.studentSurvey.findUniqueOrThrow({ where: { id: source.survey.id } })).toMatchObject({ state: "RECALLED", tokenHash: source.survey.tokenHash });
    expect((await tx.studentActionConfirmation.findUniqueOrThrow({ where: { id: ticket.id } })).usedAt).not.toBeNull();
    const fresh = await tx.studentSurvey.create({ data: {
      email: source.owner.email, intakeTermId: data.term.id, payload: recoveryJson({ ...(source.survey.payload as object), signatureName: "new-explicit-agreement" }),
      policyRevision: source.survey.policyRevision, policySnapshot: recoveryJson(source.survey.policySnapshot),
      tokenHash: randomUUID().replaceAll("-", "").repeat(2), expiresAt: new Date(Date.now() + 3600000),
      submittedAt: new Date(draft.createdAt.getTime() + 1),
    } });
    const adoption = { draftId: draft.id, expectedVersion: 1, surveyId: fresh.id };
    expect(await consumeRecoveryWorkflowDraft(tx, adoption, source.owner)).toMatchObject({ replayed: false, verificationRequired: true });
    expect(await consumeRecoveryWorkflowDraft(tx, adoption, source.owner)).toMatchObject({ replayed: true, verificationRequired: true });
    expect((await tx.studentSurvey.findUniqueOrThrow({ where: { id: fresh.id } })).confirmedAt).toBeNull();
    expect(await tx.recoveryWorkflowDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ state: "CONSUMED", version: 2, submittedSurveyId: fresh.id });
    expect(await tx.notification.findFirst({ where: { userId: source.owner.id, event: "recovery_workflow_draft" } })).toMatchObject({ inAppOnly: true, category: "tutoring" });
  });
});

it("allows an ordinary legacy correction while recording that its malformed old snapshot cannot be restored", async () => {
  await fixture(async (tx, data) => {
    const source = await signup(tx, data, { malformedPayload: true });
    const ticket = await tx.studentActionConfirmation.create({ data: { userId: source.owner.id, action: "RECALL", target: source.survey.id, readyAt: new Date(0), expiresAt: new Date(Date.now() + 3600000) } });
    await expect(recallStudentRequest(tx, source.owner.id, source.survey.id, ticket.id)).resolves.toMatchObject({ ok: true });
    const checkpoint = await tx.recoveryCheckpoint.findFirstOrThrow({ where: { sourceId: source.survey.id } });
    expect(checkpoint.schemaVersion).toBe(0);
    const plan = await inspectRecoveryCheckpoint(tx, { checkpointId: checkpoint.id });
    expect(plan.coverage).toBe("UNKNOWN");
    expect(plan.blockers.join(" ")).toContain("unsupported legacy data");
    await expect(applyRecoveryCheckpointFromOperator(tx, intent(checkpoint.id, plan.fingerprint), data.actor)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await tx.studentSurvey.findUniqueOrThrow({ where: { id: source.survey.id } })).state).toBe("RECALLED");
  });
});

it("captures the native refresh, requires current Head and preserves activated security while reversing supported effects", async () => {
  await fixture(async (tx, data) => {
    await tx.user.updateMany({ where: { role: "HEAD" }, data: { role: "ADMIN" } });
    const head = await tx.user.create({ data: { id: `${data.prefix}-head`, role: "HEAD", email: `${data.prefix}-head@example.test` } });
    await tx.tutor.updateMany({ where: { id: { not: data.tutor.id }, status: "ACTIVE" }, data: { status: "ARCHIVED" } });
    await tx.tutee.updateMany({ where: { status: { in: ["ACTIVE", "PENDING"] } }, data: { status: "INACTIVE" } });
    const learner = await tx.tutee.create({ data: { englishName: "Synthetic refresh learner", status: "ACTIVE" } });
    await tx.programFeature.updateMany({ data: { pendingEnabled: null } });
    await tx.programFeature.upsert({ where: { key: "QUARTER_SYSTEM" }, create: { key: "QUARTER_SYSTEM", enabled: true }, update: { enabled: true, pendingEnabled: null } });
    await tx.programFeature.upsert({ where: { key: "CREW" }, create: { key: "CREW", enabled: true, pendingEnabled: false }, update: { enabled: true, pendingEnabled: false } });
    await tx.programFeature.upsert({ where: { key: "EMAIL_2FA" }, create: { key: "EMAIL_2FA", enabled: false, pendingEnabled: true }, update: { enabled: false, pendingEnabled: true } });
    const preparation = await readNextRecruitment(tx);
    await applyProgramRefresh(tx, { confirm: "REFRESH", expectedTermId: data.term.id, expectedPreparation: preparation.refreshEvidence }, head);
    const checkpoint = await tx.recoveryCheckpoint.findFirstOrThrow({ where: { adapter: "PROGRAM_REFRESH", sourceId: data.term.id } });
    const plan = await inspectRecoveryCheckpoint(tx, { checkpointId: checkpoint.id });
    expect(plan.coverage).toBe("COMPLETE");
    expect(plan.dependentEventCount).toBe(0);
    await expect(applyRecoveryCheckpointFromOperator(tx, intent(checkpoint.id, plan.fingerprint), data.actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await applyRecoveryCheckpoint(tx, intent(checkpoint.id, plan.fingerprint), head);
    expect(await tx.term.findUniqueOrThrow({ where: { id: data.term.id } })).toMatchObject({ active: true });
    expect(await tx.tutee.findUniqueOrThrow({ where: { id: learner.id } })).toMatchObject({ status: "ACTIVE" });
    expect(await tx.programFeature.findUniqueOrThrow({ where: { key: "CREW" } })).toMatchObject({ enabled: true, pendingEnabled: null });
    expect(await tx.programFeature.findUniqueOrThrow({ where: { key: "EMAIL_2FA" } })).toMatchObject({ enabled: true, pendingEnabled: null });
    const destination = await tx.term.findUniqueOrThrow({ where: { schoolYear_quarter: { schoolYear: "84-85", quarter: "Q2" } } });
    expect(destination.active).toBe(false);
    expect(destination.signupFirstOpenedAt).not.toBeNull();
  });
});
