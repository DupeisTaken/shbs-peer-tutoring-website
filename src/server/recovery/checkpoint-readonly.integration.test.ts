import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { computeSessionHours } from "~/lib/service-hours";
import { db } from "~/server/db";
import { databaseScope } from "~/server/db-scope";
import { currentPolicy } from "~/server/policy-acceptance";
import { approveQualification } from "~/server/qualifications";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { applyRecoveryCheckpoint, captureRecoveryCheckpoint, inspectRecoveryCheckpoint } from "./checkpoint";
import { checkpointAdapterIds } from "./checkpoint-contract";

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

it.each(checkpointAdapterIds)("runs the complete %s preview through a root-client READ ONLY transaction", async (adapter) => {
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
