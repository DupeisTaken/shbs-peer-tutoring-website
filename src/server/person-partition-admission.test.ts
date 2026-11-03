import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { db } from "./db";
import { hashPassword } from "./auth/password";
import { partitionPersonRecords, previewPersonPartition } from "./person-partition";
import { beginAdmissionRecoveryCapture, finishAdmissionRecoveryCapture } from "./recovery/capture";
import { applyAdmissionRecoveryFromOperator, inspectAdmissionRecovery } from "./recovery/admission";
import { reconcileApplication } from "./tutors/application-status";
import type { TransactionDb } from "./transactions";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const password = "Synthetic-partition-admission-460!";
const passwordHash = hashPassword(password);
const reason = "Synthetic private separation evidence reviewed against original records";
const tutorSource = (id: string) => ({ kind: "TUTOR" as const, id });

/** Same isolated, serial fixture contract as the identity integration suites. */
async function clearFixture() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
}

beforeEach(async () => {
  (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore?.clear();
  await clearFixture();
  await db.term.create({ data: { id: "term", name: "Synthetic recovery term", schoolYear: "26-27", quarter: "Q1", active: true } });
  await db.user.createMany({ data: [
    { id: "admin", role: "ADMIN", name: "Synthetic Admin", email: "admin@example.test", passwordHash, emailVerifiedAt: new Date("2026-10-01T00:00:00Z") },
    { id: "head", role: "HEAD", name: "Synthetic Head", email: "head@example.test", passwordHash, emailVerifiedAt: new Date("2026-10-01T00:00:00Z") },
  ] });
});
afterAll(async () => {
  await clearFixture();
  await db.$disconnect();
});

/** Real acceptance capture and promotion; no registration or fabricated recovery root. */
async function admission() {
  const application = await db.tutorApplication.create({ data: {
    name: "Synthetic Candidate", firstName: "Synthetic", lastName: "Candidate",
    email: "candidate@example.test", status: "INTERVIEW",
    interviewCompletedAt: new Date("2026-09-18T03:00:00Z"), interviewDurationMin: 45,
  } });
  const actionId = await db.$transaction(async (tx) => {
    const action = await beginAdmissionRecoveryCapture(tx, application.id);
    if (!action) throw new Error("Synthetic initial acceptance was not captured");
    await tx.tutorApplication.update({ where: { id: application.id }, data: { status: "ACCEPTED", decidedAt: new Date(), decisionComment: "Synthetic reviewed acceptance" } });
    await reconcileApplication(tx, application.id);
    await tx.auditLog.create({ data: { userId: "admin", entity: "TutorApplication", entityId: application.id, operation: "tutorApplication.accept", action: "Synthetic initial admission accepted" } });
    await finishAdmissionRecoveryCapture(tx, action);
    return action;
  });
  const accepted = await db.tutorApplication.findUniqueOrThrow({ where: { id: application.id } });
  if (!accepted.promotedTutorId) throw new Error("Synthetic acceptance did not establish a tutor");
  return { actionId, applicationId: application.id, tutorId: accepted.promotedTutorId };
}

async function partition(personId: string, tutorId: string) {
  const selection = { personId, sources: [tutorSource(tutorId)] };
  const review = await previewPersonPartition(db, selection);
  expect(review.canSplit).toBe(true);
  return partitionPersonRecords(db, "admin", {
    ...selection, fingerprint: review.fingerprint, reason,
    acknowledged: true, operationId: randomUUID(), confirmPassword: password,
  });
}

const rootEvidence = async (actionId: string) => ({
  action: await db.recoveryAction.findUniqueOrThrow({ where: { id: actionId } }),
  events: await db.recoveryEvent.findMany({ where: { actionId }, orderBy: { id: "asc" } }),
  changes: await db.recoveryChange.findMany({ where: { actionId }, orderBy: { id: "asc" } }),
  tracked: await db.recoveryTrackedEntity.findMany({ where: { actionId }, orderBy: [{ entity: "asc" }, { recordId: "asc" }] }),
  fence: await db.recoveryFence.findUnique({ where: { actionId } }),
});

it("recognizes complete journal coverage for a clean real admission with no separation receipts", async () => {
  const source = await admission();
  expect(await db.personPartitionReceipt.count()).toBe(0);
  const before = await rootEvidence(source.actionId);
  const plan = await inspectAdmissionRecovery(db, source);
  expect(plan, plan.blockers.join(" ")).toMatchObject({ coverage: "COMPLETE", websiteEligible: true, dependentEventCount: 0 });
  expect(plan.blockers).toEqual([]);
  expect(await rootEvidence(source.actionId)).toEqual(before);
});

it("keeps an unrelated separation by the admission's Admin outside the existing causal root", async () => {
  const source = await admission();
  await db.person.create({ data: { id: "unrelated-group" } });
  await db.tutor.createMany({ data: [
    { id: "unrelated-a", personId: "unrelated-group", englishName: "Unrelated original source", status: "ARCHIVED" },
    { id: "unrelated-b", personId: "unrelated-group", englishName: "Unrelated remaining source", status: "ARCHIVED" },
  ] });
  const baseline = await inspectAdmissionRecovery(db, source);
  expect(baseline, baseline.blockers.join(" ")).toMatchObject({ coverage: "COMPLETE", websiteEligible: true, dependentEventCount: 0 });
  const evidence = await rootEvidence(source.actionId);
  const receipt = await partition("unrelated-group", "unrelated-a");
  expect(await db.personPartitionReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId } })).toMatchObject({ actorId: "admin" });
  expect(await db.auditLog.count({ where: { userId: "admin", entityId: source.applicationId } })).toBe(1);
  const after = await inspectAdmissionRecovery(db, source);
  expect(after.fingerprint).toBe(baseline.fingerprint);
  expect(after.dependentEventCount).toBe(baseline.dependentEventCount);
  expect(after.coverage).toBe("COMPLETE");
  expect(after.websiteEligible).toBe(true);
  expect(await rootEvidence(source.actionId)).toEqual(evidence);
});

it("journals the exact affected admission source and blocks recovery after its separation", async () => {
  const source = await admission();
  const admitted = await db.tutor.findUniqueOrThrow({ where: { id: source.tutorId } });
  if (!admitted.personId) throw new Error("Accepted tutor lacks its initialized directory identity");
  await db.tutor.create({ data: { id: "unowned-sibling", personId: admitted.personId, englishName: "Unowned original archive", status: "ARCHIVED" } });
  // Establish the baseline after adding a sibling: that source insertion can
  // itself be journaled and must not be attributed to the later separation.
  const baseline = await inspectAdmissionRecovery(db, source);
  const baselineEvents = await db.recoveryEvent.count({ where: { actionId: source.actionId } });
  const receipt = await partition(admitted.personId, source.tutorId);
  const change = await db.recoveryChange.findFirstOrThrow({ where: { actionId: source.actionId, entity: "PersonPartitionReceipt", operation: "INSERT", recordKey: { path: ["id"], equals: receipt.receiptId } } });
  expect(change.recordKey).toEqual({ id: receipt.receiptId });
  const journal = z.object({
    id: z.string(), personId: z.string(), newPersonId: z.string(),
    subjects: z.array(z.object({ entity: z.string(), recordId: z.string() })),
  }).strict().parse(change.after);
  expect(journal).toMatchObject({ id: receipt.receiptId, personId: admitted.personId, newPersonId: receipt.newPersonId });
  expect(journal.subjects).toContainEqual({ entity: "Tutor", recordId: source.tutorId });
  expect(journal.subjects).toContainEqual({ entity: "Person", recordId: admitted.personId });
  expect(journal.subjects).toContainEqual({ entity: "Person", recordId: receipt.newPersonId });
  expect(journal.subjects).not.toContainEqual({ entity: "User", recordId: "admin" });
  expect(JSON.stringify(journal)).not.toContain(reason);
  expect(JSON.stringify(journal)).not.toContain(password);
  expect(change.changedFields).toEqual(expect.arrayContaining(["subjects", "sources", "inputHash"]));
  const event = await db.recoveryEvent.findUniqueOrThrow({ where: { id: change.eventId } });
  expect(event.kind).toBe("UNSUPPORTED");
  expect(await db.recoveryEvent.count({ where: { actionId: source.actionId } })).toBe(baselineEvents + 1);
  const after = await inspectAdmissionRecovery(db, source);
  expect(after.fingerprint).not.toBe(baseline.fingerprint);
  expect(after.dependentEventCount).toBe(baseline.dependentEventCount + 1);
  expect(after).toMatchObject({ coverage: "UNKNOWN", websiteEligible: false });
  expect(after.blockers).toContain("Unsupported dependent event: UNSUPPORTED.");
  const separatedTutor = await db.tutor.findUniqueOrThrow({ where: { id: source.tutorId } });
  await expect(applyAdmissionRecoveryFromOperator(db, {
    actionId: source.actionId, expectedFingerprint: after.fingerprint, clientKey: randomUUID(),
    reason: "Synthetic recovery attempted after separately reviewed identity correction",
  }, { id: "admin" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.recoveryReceipt.count({ where: { actionId: source.actionId } })).toBe(0);
  expect(await db.tutor.findUniqueOrThrow({ where: { id: source.tutorId } })).toEqual(separatedTutor);
  expect(await db.personPartitionReceipt.findUnique({ where: { id: receipt.receiptId } })).not.toBeNull();
});

/** Transactional DDL always rolls back, including when inspection fails. */
async function withRolledBackDDL<T>(work: (tx: TransactionDb) => Promise<T>): Promise<T> {
  const rollback = new Error("Roll back synthetic trigger coverage alteration");
  let result!: T;
  try {
    await db.$transaction(async (tx) => {
      result = await work(tx);
      throw rollback;
    }, { timeout: 20000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  return result;
}

const triggerState = () => db.$queryRaw<{ definition: string; enabled: string }[]>`
  SELECT pg_get_triggerdef(oid,true) AS definition,tgenabled::text AS enabled
  FROM pg_trigger WHERE tgrelid='"PersonPartitionReceipt"'::regclass
    AND tgname='recovery_change_journal'`;
const journalTrigger = 'CREATE TRIGGER recovery_change_journal AFTER INSERT OR UPDATE OR DELETE ON "PersonPartitionReceipt"';
const alteredTriggers = [
  { name: "missing", statements: ['DROP TRIGGER recovery_change_journal ON "PersonPartitionReceipt"'] },
  { name: "disabled", statements: ['ALTER TABLE "PersonPartitionReceipt" DISABLE TRIGGER recovery_change_journal'] },
  { name: "wrong function", statements: ['DROP TRIGGER recovery_change_journal ON "PersonPartitionReceipt"', `${journalTrigger} FOR EACH ROW EXECUTE FUNCTION recovery_capture_change()`] },
  { name: "conditional", statements: ['DROP TRIGGER recovery_change_journal ON "PersonPartitionReceipt"', `${journalTrigger} FOR EACH ROW WHEN (true) EXECUTE FUNCTION recovery_capture_person_partition()`] },
  { name: "statement-level", statements: ['DROP TRIGGER recovery_change_journal ON "PersonPartitionReceipt"', `${journalTrigger} FOR EACH STATEMENT EXECUTE FUNCTION recovery_capture_person_partition()`] },
  { name: "unexpected arguments", statements: ['DROP TRIGGER recovery_change_journal ON "PersonPartitionReceipt"', `${journalTrigger} FOR EACH ROW EXECUTE FUNCTION recovery_capture_person_partition('synthetic-unused-argument')`] },
  { name: "replica-only", statements: ['ALTER TABLE "PersonPartitionReceipt" ENABLE REPLICA TRIGGER recovery_change_journal'] },
];

it.each(alteredTriggers)("fails closed for $name separation journal coverage and restores DDL by rollback", async ({ statements }) => {
  const source = await admission();
  const baseline = await inspectAdmissionRecovery(db, source);
  expect(baseline, baseline.blockers.join(" ")).toMatchObject({ coverage: "COMPLETE", websiteEligible: true });
  const originalTrigger = await triggerState();
  expect(originalTrigger).toHaveLength(1);
  const plan = await withRolledBackDDL(async (tx) => {
    for (const statement of statements) await tx.$executeRawUnsafe(statement);
    return inspectAdmissionRecovery(tx, source);
  });
  expect(plan).toMatchObject({ coverage: "UNKNOWN", websiteEligible: false });
  expect(plan.blockers.join(" ")).toContain("Database coverage is incomplete for: PersonPartitionReceipt");
  expect(await triggerState()).toEqual(originalTrigger);
  const restored = await inspectAdmissionRecovery(db, source);
  expect(restored.coverage).toBe("COMPLETE");
  expect(restored.fingerprint).toBe(baseline.fingerprint);
  expect(await db.personPartitionReceipt.count()).toBe(0);
});
