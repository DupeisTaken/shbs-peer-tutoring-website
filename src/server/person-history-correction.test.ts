import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { db } from "./db";
import { hashPassword } from "./auth/password";
import { accountHistoryIds, accountHistoryReaderId, accountRetirementFamilyIds } from "./account-history";
import { historyCorrectionInventory, correctPersonHistory, historyCorrectionReceipt } from "./person-history-correction";
import { notificationOwnershipWhere, quarterBlockAccountWhere } from "./history-row-ownership";
import { assertHistoryAccessGeneration } from "./history-access-generation";
import { syncAccountPerson, syncParticipantPerson, personGraph } from "./person-identity";
import { initializePersonSource } from "./person-source-initialization";
import { readPersonReconciliationSnapshot, reconcilePersonSources } from "./person-reconciliation";
import { ownedTutorHistory } from "./personal-tutor-history";
import { ownedStudentIds } from "./student-ownership";
import { accountPolicyIds } from "./policy-acceptance";
import { beginAdmissionRecoveryCapture, finishAdmissionRecoveryCapture } from "./recovery/capture";
import { reconcileApplication } from "./tutors/application-status";
import { admitIdentityNotice, finishIdentityNotice } from "./email/identity-notice-admission";
import { personSourceEvidence } from "./person-source-evidence";
import { readSessionAgendaHistory } from "./session-planning";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const password = "Synthetic-history-review-460!";
const passwordHash = hashPassword(password);
const reason = "Reviewed original synthetic evidence and corrected exact private ownership";
type CorrectionInput = Parameters<typeof correctPersonHistory>[2];
type Row = Awaited<ReturnType<typeof historyCorrectionInventory>>["rows"][number];
type Action = CorrectionInput["decisions"][number]["action"];

async function clearFixture() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
}
beforeEach(async () => {
  (globalThis as { rateLimitStore?: Map<string, unknown> }).rateLimitStore?.clear();
  await clearFixture();
  await db.user.createMany({ data: ([
    ["admin", "ADMIN"], ["head", "HEAD"], ["A", "STUDENT"], ["B", "STUDENT"], ["D", "STUDENT"], ["C", "VIEWER"],
  ] as const).map(([id, role]) => ({ id, role, name: `Synthetic ${id}`, email: `${id.toLowerCase()}@example.test`, username: `synthetic-${id.toLowerCase()}`, passwordHash, emailVerifiedAt: new Date("2026-10-01T00:00:00Z") })) });
  await db.person.createMany({ data: [{ id: "pD", primaryUserId: "D" }, { id: "pC", primaryUserId: "C" }] });
  await db.user.updateMany({ where: { id: { in: ["A", "B", "D"] } }, data: { personId: "pD" } });
  await db.user.update({ where: { id: "C" }, data: { personId: "pC" } });
  // Construct the actual temporal chain; every new retirement has a live target.
  await db.user.update({ where: { id: "B" }, data: { mergedIntoId: "A", passwordHash: null } });
  await db.user.update({ where: { id: "A" }, data: { mergedIntoId: "D", passwordHash: null } });
  await db.term.createMany({ data: [
    { id: "past", name: "Synthetic old term", schoolYear: "24-25", quarter: "Q1" },
    { id: "current", name: "Synthetic current term", schoolYear: "26-27", quarter: "Q1", active: true },
  ] });
  await db.tutor.createMany({ data: [
    { id: "tB", personId: "pD", englishName: "Original synthetic B tutor", status: "ARCHIVED", gradeLevel: 9, gradeSchoolYear: "24-25" },
    { id: "tA", personId: "pD", englishName: "Independent synthetic A tutor", status: "ARCHIVED" },
  ] });
  await db.tutorProfileOwnership.createMany({ data: [{ tutorId: "tB", userId: "D" }, { tutorId: "tA", userId: "D" }] });
  await db.tutee.create({ data: { id: "sB", personId: "pD", englishName: "Original synthetic B learner", status: "INACTIVE", intakeTermId: "past", gradeLevel: "9", signatureName: "Original synthetic signature", signedAt: new Date("2024-09-01T00:00:00Z"), signedRulebook: true } });
  await db.studentProfileOwnership.create({ data: { tuteeId: "sB", userId: "D" } });
  await db.pairing.create({ data: { id: "past-pairing", tutorId: "tB", termId: "past", subject: "Mathematics", dayOfWeek: 2, startMin: 600, endMin: 630 } });
  await db.session.create({ data: { id: "completed", pairingId: "past-pairing", tutorId: "tB", date: new Date("2024-10-01T00:00:00Z"), startMin: 600, endMin: 630, durationMin: 30, shCount: 2, shFactor: 2, month: "2024-10", schoolYear: "24-25", quarter: "Q1" } });
  await db.sessionTutee.create({ data: { sessionId: "completed", tuteeId: "sB", status: "PRESENT" } });
  await db.serviceHourAdjustment.create({ data: { id: "original-adjustment", tutorId: "tB", month: "2024-10", schoolYear: "24-25", quarter: "Q1", type: "EXTRA", amount: 0.5, reason: "Original synthetic amendment" } });
  await db.patrol.create({ data: { id: "original-patrol", crewUserId: "B", termId: "past", hours: 0.5, creditAwardedAt: new Date("2024-10-01T08:00:00Z") } });
  await db.patrolCreditWindow.create({ data: { crewUserId: "B", patrolId: "original-patrol", windowStart: new Date("2024-10-01T08:00:00Z") } });
  await db.policyAcceptance.create({ data: { id: "signature", userId: "B", slug: "tutee-policy", revision: "original-revision", snapshot: { text: "Original synthetic policy" }, signature: "Original synthetic B signature" } });
  await db.directMessage.create({ data: { id: "original-message", senderId: "B", recipientId: "head", clientKey: randomUUID(), body: "Original synthetic message", supervisable: true } });
  await db.auditLog.create({ data: { id: "original-audit", userId: "B", action: "Original synthetic action", entity: "Tutor", entityId: "tB", operation: "synthetic.original" } });
  await db.notification.createMany({ data: [
    { id: "nB", userId: "D", title: "Synthetic ambiguous notice", body: "Original B notice evidence" },
    { id: "nA", userId: "D", title: "Synthetic independent notice", body: "Independent A notice evidence" },
  ] });
  await db.studentQuarterBlock.create({ data: { id: "blockB", userId: "D", email: "b@example.test", intakeTermId: "current", legacyTuteeId: "sB" } });
});
afterAll(async () => { await clearFixture(); await db.$disconnect(); });

async function review(recipientUserId: string | null = "C", choose: (row: Row) => Action = () => "RETAIN", sourceUserIds = ["B"]): Promise<CorrectionInput> {
  const source = await db.user.findUniqueOrThrow({ where: { id: sourceUserIds[0]! } });
  if (!source.personId) throw new Error("Synthetic source lacks a directory identity");
  const selection = { personId: source.personId, sourceUserIds, recipientUserId };
  const preview = await historyCorrectionInventory(db, selection);
  return { ...selection, fingerprint: preview.fingerprint, decisions: preview.rows.map((row) => ({ entity: row.entity, recordId: row.recordId, action: choose(row) })), reason, acknowledged: true, operationId: randomUUID(), confirmPassword: password };
}
const assignB = (row: Row): Action => ["tB", "sB", "nB"].includes(row.recordId) ? "ASSIGN" : row.recordId === "blockB" ? "QUARANTINE" : "RETAIN";
const quarantineB = (row: Row): Action => ["tB", "sB", "nB", "blockB"].includes(row.recordId) ? "QUARANTINE" : "RETAIN";

async function evidence() {
  return {
    retired: (await db.user.findMany({ where: { id: { in: ["A", "B"] } }, orderBy: { id: "asc" } })).map(({ personId, ...row }) => { void personId; return row; }),
    tutors: (await db.tutor.findMany({ orderBy: { id: "asc" } })).map(({ personId, historyIdentityRevision, ...row }) => { void personId; void historyIdentityRevision; return row; }),
    tutees: (await db.tutee.findMany({ orderBy: { id: "asc" } })).map(({ personId, historyIdentityRevision, ...row }) => { void personId; void historyIdentityRevision; return row; }),
    sessions: await db.session.findMany(), attendance: await db.sessionTutee.findMany(), pairings: await db.pairing.findMany(),
    adjustments: await db.serviceHourAdjustment.findMany(), patrols: await db.patrol.findMany(), windows: await db.patrolCreditWindow.findMany(),
    policies: await db.policyAcceptance.findMany(), messages: await db.directMessage.findMany(), originalAudit: await db.auditLog.findUnique({ where: { id: "original-audit" } }),
    notifications: await db.notification.findMany({ orderBy: { id: "asc" } }), blocks: await db.studentQuarterBlock.findMany(),
  };
}
async function state() {
  return { evidence: await evidence(), users: await db.user.findMany({ orderBy: { id: "asc" } }), persons: await db.person.findMany({ orderBy: { id: "asc" } }),
    mappings: await db.retiredHistoryOwnership.findMany({ orderBy: { sourceUserId: "asc" } }), overrides: await db.historyRowOwnership.findMany({ orderBy: [{ entity: "asc" }, { recordId: "asc" }] }),
    tutorOwners: await db.tutorProfileOwnership.findMany({ orderBy: { tutorId: "asc" } }), studentOwners: await db.studentProfileOwnership.findMany({ orderBy: { tuteeId: "asc" } }), receipts: await db.personHistoryCorrectionReceipt.findMany() };
}
const notificationIds = async (userId: string) => (await db.notification.findMany({ where: await notificationOwnershipWhere(db, userId), orderBy: { id: "asc" } })).map((row) => row.id);
const blocked = async (userId: string) => db.studentQuarterBlock.count({ where: await quarterBlockAccountWhere(db, userId) });
const receiptRows = z.object({ rows: z.array(z.object({
  entity: z.string(), recordId: z.string(), readerUserId: z.string().nullable(),
  personId: z.string().nullable(), quarantineUserIds: z.array(z.string()), action: z.string().optional(),
})) });

it("inventories all ambiguous rows without private credential values or writes", async () => {
  const before = await state();
  const preview = await historyCorrectionInventory(db, { personId: "pD", sourceUserIds: ["B"], recipientUserId: "C" });
  expect(preview.sourceUsers).toEqual([{ id: "B", name: "Synthetic B", readerUserId: "D" }]);
  expect(preview.rows.map((row) => `${row.entity}:${row.recordId}`).sort()).toEqual(["Notification:nA", "Notification:nB", "StudentQuarterBlock:blockB", "Tutee:sB", "Tutor:tA", "Tutor:tB"].sort());
  expect(JSON.stringify(preview)).not.toContain(passwordHash);
  expect(await state()).toEqual(before);
});

it("corrects only B in B-to-A-to-D while preserving original completed evidence and credential tombstones", async () => {
  const original = await evidence();
  const input = await review("C", assignB);
  const receipt = await correctPersonHistory(db, "admin", input);
  expect(receipt).toMatchObject({ ok: true, receiptId: input.operationId, personId: "pD", destinationPersonId: "pC", sourceUserIds: ["B"] });
  expect(await accountHistoryIds(db, "D")).toEqual(["D", "A"]);
  expect(await accountHistoryIds(db, "C")).toEqual(["C", "B"]);
  expect(await accountRetirementFamilyIds(db, "D")).toEqual(["D", "A", "B"]);
  expect((await ownedTutorHistory(db, "C")).map((row) => row.id)).toEqual(["tB"]);
  expect((await ownedTutorHistory(db, "D")).map((row) => row.id)).toEqual(["tA"]);
  expect(await ownedStudentIds(db, "C")).toEqual(["sB"]);
  expect(await accountPolicyIds(db, "C")).toEqual(["C"]);
  expect(await notificationIds("C")).toEqual(["nB"]);
  expect(await notificationIds("D")).toEqual(["nA"]);
  expect(await blocked("C")).toBe(1);
  expect(await blocked("D")).toBe(1);
  expect(await evidence()).toEqual(original);
  expect(await db.user.findUniqueOrThrow({ where: { id: "B" } })).toMatchObject({ mergedIntoId: "A", passwordHash: null, tutorId: null, studentId: null });
  expect(await db.user.findUniqueOrThrow({ where: { id: "C" } })).toMatchObject({ role: "VIEWER", tuteeMember: false, tutorId: null, studentId: null });
});

it.each(["missing", "duplicate", "unknown", "restriction-omitted"] as const)("requires every exact row decision with %s input", async (mode) => {
  const input = await review();
  if (mode === "missing") input.decisions.pop();
  if (mode === "duplicate") input.decisions.push(input.decisions[0]!);
  if (mode === "unknown") input.decisions.push({ entity: "Notification", recordId: "not-reviewed", action: "RETAIN" });
  if (mode === "restriction-omitted") input.decisions = input.decisions.filter((row) => row.entity !== "StudentQuarterBlock");
  const before = await state();
  await expect(correctPersonHistory(db, "admin", input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await state()).toEqual(before);
});

it("freezes RETAIN to the prior effective reader even when a raw original owner is the corrected B", async () => {
  await db.tutorProfileOwnership.update({ where: { tutorId: "tB" }, data: { userId: "B" } });
  await db.notification.update({ where: { id: "nB" }, data: { userId: "B" } });
  const preview = await historyCorrectionInventory(db, { personId: "pD", sourceUserIds: ["B"], recipientUserId: "C" });
  expect(preview.rows.find((row) => row.recordId === "tB")?.readerUserId).toBe("D");
  expect(preview.rows.find((row) => row.recordId === "nB")?.readerUserId).toBe("D");
  const receipt = await correctPersonHistory(db, "admin", await review());
  expect((await ownedTutorHistory(db, "D")).map((row) => row.id)).toContain("tB");
  expect((await ownedTutorHistory(db, "C")).map((row) => row.id)).not.toContain("tB");
  expect(await notificationIds("D")).toContain("nB");
  expect(await notificationIds("C")).not.toContain("nB");
  expect((await db.notification.findUniqueOrThrow({ where: { id: "nB" } })).userId).toBe("B");
  const stored = await db.personHistoryCorrectionReceipt.findUniqueOrThrow({ where: { id: receipt.receiptId } });
  expect(stored.subjects).toContainEqual({ entity: "Tutor", recordId: "tB" });
  expect(stored.subjects).toContainEqual({ entity: "Notification", recordId: "nB" });
});

it.each(["ASSIGN", "QUARANTINE"] as const)("refuses %s of a source with current operational assignments", async (action) => {
  await db.pairing.create({ data: { id: "current-assignment", tutorId: "tB", termId: "current", subject: "Mathematics", dayOfWeek: 3, startMin: 600, endMin: 630 } });
  const input = await review("C", (row) => row.recordId === "tB" ? action : "RETAIN");
  const before = await state();
  await expect(correctPersonHistory(db, "admin", input)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await state()).toEqual(before);
});

it("requires quarantine rather than assigning a private row to a null recipient", async () => {
  const input = await review(null, (row) => row.recordId === "nB" ? "ASSIGN" : "RETAIN");
  await expect(correctPersonHistory(db, "admin", input)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.personHistoryCorrectionReceipt.count()).toBe(0);
});

it("quarantines every selected private source then reassigns to a fresh verified neutral account", async () => {
  const first = await correctPersonHistory(db, "admin", await review(null, quarantineB));
  expect(first.destinationPersonId).not.toBe("pD");
  expect(await accountHistoryReaderId(db, "B")).toBeNull();
  for (const reader of ["B", "A", "D", "C", "admin", "head"]) expect(await notificationIds(reader)).not.toContain("nB");
  expect(await db.tutorProfileOwnership.findUnique({ where: { tutorId: "tB" } })).toBeNull();
  const stored = await db.personHistoryCorrectionReceipt.findUniqueOrThrow({ where: { id: first.receiptId } });
  const beforeRows = receiptRows.parse(stored.before).rows;
  const afterRows = receiptRows.parse(stored.after).rows;
  const quarantinedTutor = await db.tutor.findUniqueOrThrow({ where: { id: "tB" } });
  const quarantinedTutee = await db.tutee.findUniqueOrThrow({ where: { id: "sB" } });
  for (const [recordId, personId] of [["tB", quarantinedTutor.personId], ["sB", quarantinedTutee.personId]] as const) {
    expect(personId).not.toBeNull();
    expect(personId).not.toBe(first.destinationPersonId);
    expect(beforeRows.find((row) => row.recordId === recordId)?.personId).toBe("pD");
    expect(afterRows.find((row) => row.recordId === recordId)).toMatchObject({ personId, readerUserId: null, action: "QUARANTINE" });
    expect(stored.subjects).toContainEqual({ entity: "Person", recordId: personId });
  }
  expect(quarantinedTutor.personId).not.toBe(quarantinedTutee.personId);
  await db.user.create({ data: { id: "fresh", name: "Fresh synthetic reader", email: "fresh@example.test", role: "VIEWER", passwordHash, emailVerifiedAt: new Date() } });
  const next = await review("fresh", (row) => ["tB", "sB", "nB"].includes(row.recordId) ? "ASSIGN" : "RETAIN");
  expect(next.decisions.map((row) => row.recordId)).toEqual(expect.arrayContaining(["tB", "sB", "nB", "blockB"]));
  await correctPersonHistory(db, "admin", next);
  expect(await accountHistoryReaderId(db, "B")).toBe("fresh");
  expect(await notificationIds("fresh")).toContain("nB");
  expect(await db.user.findUniqueOrThrow({ where: { id: "fresh" } })).toMatchObject({ role: "VIEWER", tutorId: null, studentId: null, tuteeMember: false, canTranslate: false, crewStatus: null });
  expect(await db.user.findUniqueOrThrow({ where: { id: "B" } })).toMatchObject({ mergedIntoId: "A", passwordHash: null });
});

it("retains all unresolved restriction recipients through repeated quarantine review", async () => {
  const first = await correctPersonHistory(db, "admin", await review("C", (row) => row.entity === "StudentQuarterBlock" ? "QUARANTINE" : "RETAIN"));
  expect(await blocked("C")).toBe(1);
  await db.user.create({ data: { id: "fresh", email: "fresh@example.test", role: "VIEWER", passwordHash, emailVerifiedAt: new Date() } });
  const second = await correctPersonHistory(db, "admin", await review("fresh", (row) => row.entity === "StudentQuarterBlock" ? "QUARANTINE" : "RETAIN"));
  for (const reader of ["D", "C", "fresh"]) expect(await blocked(reader)).toBe(1);
  const override = await db.historyRowOwnership.findUniqueOrThrow({ where: { entity_recordId: { entity: "StudentQuarterBlock", recordId: "blockB" } } });
  expect(override.quarantineUserIds.sort()).toEqual(["C", "D", "fresh"].sort());
  const firstReceipt = await db.personHistoryCorrectionReceipt.findUniqueOrThrow({ where: { id: first.receiptId } });
  const secondReceipt = await db.personHistoryCorrectionReceipt.findUniqueOrThrow({ where: { id: second.receiptId } });
  expect(receiptRows.parse(firstReceipt.before).rows.find((row) => row.recordId === "blockB")?.quarantineUserIds).toEqual([]);
  expect(receiptRows.parse(firstReceipt.after).rows.find((row) => row.recordId === "blockB")?.quarantineUserIds.sort()).toEqual(["C", "D"]);
  expect(receiptRows.parse(secondReceipt.before).rows.find((row) => row.recordId === "blockB")?.quarantineUserIds.sort()).toEqual(["C", "D"]);
  expect(receiptRows.parse(secondReceipt.after).rows.find((row) => row.recordId === "blockB")?.quarantineUserIds.sort()).toEqual(["C", "D", "fresh"]);
});

it.each(["source", "recipient", "both"] as const)("permits restricted %s history ownership without restoring access or membership", async (which) => {
  const ids = which === "source" ? ["B"] : which === "recipient" ? ["C"] : ["B", "C"];
  await db.user.updateMany({ where: { id: { in: ids } }, data: { suspendedAt: new Date("2026-10-01T00:00:00Z"), suspendedReason: "Synthetic restriction" } });
  for (const userId of ids) await db.schoolDeparture.create({ data: { userId, reason: "TRANSFERRED", source: "SYNTHETIC_REVIEW", effectiveAt: new Date("2026-10-01T00:00:00Z") } });
  const before = await db.schoolDeparture.findMany({ orderBy: { userId: "asc" } });
  await correctPersonHistory(db, "admin", await review("C", assignB));
  expect(await accountHistoryReaderId(db, "B")).toBe("C");
  for (const userId of ids) expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ suspendedReason: "Synthetic restriction", tuteeMember: false, tutorId: null });
  expect(await db.schoolDeparture.findMany({ orderBy: { userId: "asc" } })).toEqual(before);
});

it.each(["unverified", "no-password", "unfinished-setup"] as const)("rejects an unproved %s recipient", async (condition) => {
  await db.user.update({ where: { id: "C" }, data: condition === "unverified" ? { emailVerifiedAt: null } : condition === "no-password" ? { passwordHash: null } : { mustChangePassword: true } });
  await expect(review()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.personHistoryCorrectionReceipt.count()).toBe(0);
});

it("can review a missing mapping without treating the permanent retirement family as current access", async () => {
  await expect(db.retiredHistoryOwnership.delete({ where: { sourceUserId: "B" } })).rejects.toThrow();
  const before = await state();
  const rollback = new Error("Roll back deliberately incomplete synthetic legacy mapping");
  await expect(db.$transaction(async (tx) => {
    // Manufacture legacy corruption only inside rollback-restored transactional DDL.
    await tx.$executeRawUnsafe('ALTER TABLE "RetiredHistoryOwnership" DISABLE TRIGGER enforce_history_assignment');
    await tx.retiredHistoryOwnership.delete({ where: { sourceUserId: "B" } });
    await tx.$executeRawUnsafe('ALTER TABLE "RetiredHistoryOwnership" ENABLE TRIGGER enforce_history_assignment');
    expect(await accountHistoryReaderId(tx, "B")).toBeNull();
    const selection = { personId: "pD", sourceUserIds: ["B"], recipientUserId: "C" };
    const preview = await historyCorrectionInventory(tx, selection);
    expect(preview.sourceUsers[0]?.readerUserId).toBeNull();
    await correctPersonHistory(tx, "admin", { ...selection, fingerprint: preview.fingerprint,
      decisions: preview.rows.map((row) => ({ entity: row.entity, recordId: row.recordId, action: "RETAIN" as const })),
      reason, acknowledged: true, operationId: randomUUID(), confirmPassword: password });
    expect(await accountHistoryReaderId(tx, "B")).toBe("C");
    throw rollback;
  }, { timeout: 20000 })).rejects.toBe(rollback);
  expect(await state()).toEqual(before);
});

it("retains safe before/after quarantine sets in the real admission-root journal", async () => {
  const application = await db.tutorApplication.create({ data: { name: "Synthetic D", firstName: "Synthetic", lastName: "D", email: "d@example.test", status: "INTERVIEW", interviewCompletedAt: new Date("2026-09-18T03:00:00Z"), interviewDurationMin: 45 } });
  const actionId = await db.$transaction(async (tx) => {
    const action = await beginAdmissionRecoveryCapture(tx, application.id);
    if (!action) throw new Error("Synthetic initial admission was not captured");
    await tx.tutorApplication.update({ where: { id: application.id }, data: { status: "ACCEPTED", decidedAt: new Date(), decisionComment: "Synthetic approval" } });
    await reconcileApplication(tx, application.id);
    await finishAdmissionRecoveryCapture(tx, action);
    return action;
  });
  await correctPersonHistory(db, "admin", await review("C", (row) => row.entity === "StudentQuarterBlock" ? "QUARANTINE" : "RETAIN"));
  await db.user.create({ data: { id: "fresh", email: "fresh@example.test", role: "VIEWER", passwordHash, emailVerifiedAt: new Date() } });
  await correctPersonHistory(db, "admin", await review("fresh", (row) => row.entity === "StudentQuarterBlock" ? "QUARANTINE" : "RETAIN"));
  const changes = await db.recoveryChange.findMany({ where: { actionId, entity: "HistoryRowOwnership", recordKey: { path: ["recordId"], equals: "blockB" } }, orderBy: { id: "asc" } });
  const insertion = changes.find((row) => row.operation === "INSERT");
  const update = changes.find((row) => row.operation === "UPDATE");
  expect(insertion).toBeDefined();
  expect(update).toBeDefined();
  const projection = z.object({ entity: z.literal("StudentQuarterBlock"), recordId: z.literal("blockB"), quarantineUserIds: z.array(z.string()) });
  expect(projection.parse(insertion!.after).quarantineUserIds.sort()).toEqual(["C", "D"]);
  expect(projection.parse(update!.before).quarantineUserIds.sort()).toEqual(["C", "D"]);
  expect(projection.parse(update!.after).quarantineUserIds.sort()).toEqual(["C", "D", "fresh"]);
  expect(JSON.stringify(changes, (_key, value: unknown) => typeof value === "bigint" ? String(value) : value)).not.toContain(passwordHash);
});

it("rejects stale mapping review after D-to-C-to-D even though the final reader matches", async () => {
  const input = await review();
  const before = await db.retiredHistoryOwnership.findUniqueOrThrow({ where: { sourceUserId: "B" } });
  await db.retiredHistoryOwnership.update({ where: { sourceUserId: "B" }, data: { readerUserId: "C" } });
  await db.retiredHistoryOwnership.update({ where: { sourceUserId: "B" }, data: { readerUserId: "D" } });
  expect((await db.retiredHistoryOwnership.findUniqueOrThrow({ where: { sourceUserId: "B" } })).revision).toBe(before.revision + 2);
  await expect(correctPersonHistory(db, "admin", input)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.personHistoryCorrectionReceipt.count()).toBe(0);
});

it.each([false, true])("binds non-selected retained-owner access changes into review, including ABA=%s", async (aba) => {
  await db.user.createMany({ data: [
    { id: "X", personId: "pD", email: "x@example.test", role: "VIEWER", mergedIntoId: "D" },
    { id: "E", email: "e@example.test", role: "VIEWER", passwordHash, emailVerifiedAt: new Date() },
  ] });
  await db.tutorProfileOwnership.update({ where: { tutorId: "tB" }, data: { userId: "X" } });
  const input = await review();
  await db.retiredHistoryOwnership.update({ where: { sourceUserId: "X" }, data: { readerUserId: "E" } });
  if (aba) await db.retiredHistoryOwnership.update({ where: { sourceUserId: "X" }, data: { readerUserId: "D" } });
  const before = await state();
  await expect(correctPersonHistory(db, "admin", input)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await state()).toEqual(before);
});

it.each(["wrong-password", "demoted", "suspended", "missing"] as const)("revalidates reviewer authority for %s", async (condition) => {
  const input = await review();
  if (condition === "wrong-password") input.confirmPassword = "Incorrect synthetic password";
  if (condition === "demoted") await db.user.update({ where: { id: "admin" }, data: { role: "COORDINATOR" } });
  if (condition === "suspended") await db.user.update({ where: { id: "admin" }, data: { suspendedAt: new Date() } });
  const before = await state();
  await expect(correctPersonHistory(db, condition === "missing" ? "absent" : "admin", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await state()).toEqual(before);
});

it("accepts the same reviewed correction under fresh Head authority", async () => {
  const input = await review();
  expect(await correctPersonHistory(db, "head", input)).toMatchObject({ ok: true, receiptId: input.operationId });
  expect((await db.personHistoryCorrectionReceipt.findUniqueOrThrow({ where: { id: input.operationId } })).actorId).toBe("head");
});

it("returns actor-bound immutable receipts after a lost response without repeating writes", async () => {
  const input = await review("C", assignB);
  const receipt = await correctPersonHistory(db, "admin", input);
  const accepted = await state();
  expect(await historyCorrectionReceipt(db, "admin", input.operationId)).toEqual(receipt);
  expect(await historyCorrectionReceipt(db, "head", input.operationId)).toBeNull();
  expect(await correctPersonHistory(db, "admin", input)).toEqual(receipt);
  expect(await state()).toEqual(accepted);
  await expect(correctPersonHistory(db, "admin", { ...input, reason: "Different synthetic review intent" })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(correctPersonHistory(db, "head", input)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(db.personHistoryCorrectionReceipt.update({ where: { id: receipt.receiptId }, data: { inputHash: "modified" } })).rejects.toThrow();
  await expect(db.personHistoryCorrectionReceipt.delete({ where: { id: receipt.receiptId } })).rejects.toThrow();
});

it("serializes concurrent retries to one correction, receipt and audit", async () => {
  const input = await review("C", assignB);
  const results = await Promise.all([correctPersonHistory(db, "admin", input), correctPersonHistory(db, "admin", input)]);
  expect(results[0]).toEqual(results[1]);
  expect(await db.personHistoryCorrectionReceipt.count()).toBe(1);
  expect(await db.auditLog.count({ where: { operation: "personCombine.historyCorrection" } })).toBe(1);
});

it("rolls every access and directory effect back when durable audit fails", async () => {
  const input = await review("C", assignB);
  const before = await state();
  await db.$executeRawUnsafe(`CREATE FUNCTION fail_history_correction_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='personCombine.historyCorrection' THEN RAISE EXCEPTION 'synthetic correction audit failure'; END IF; RETURN NEW; END $$`);
  try {
    await db.$executeRawUnsafe('CREATE TRIGGER fail_history_correction_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_history_correction_audit()');
    await expect(correctPersonHistory(db, "admin", input)).rejects.toThrow();
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_history_correction_audit ON "AuditLog"');
    await db.$executeRawUnsafe('DROP FUNCTION fail_history_correction_audit()');
  }
  expect(await state()).toEqual(before);
  expect(await correctPersonHistory(db, "admin", input)).toMatchObject({ ok: true });
});

it("lets only server-owned history generation advance sessions, rejecting delayed pre-correction reads", async () => {
  const before = await db.user.findUniqueOrThrow({ where: { id: "D" } });
  const ignored = await db.user.update({ where: { id: "D" }, data: { sessionVersion: { increment: 5 } } });
  expect(ignored.sessionVersion).toBe(before.sessionVersion);
  const changed = await db.user.update({ where: { id: "D" }, data: { historyAccessRevision: { increment: 1 } } });
  expect(changed.sessionVersion).toBe(before.sessionVersion + 1);
  await assertHistoryAccessGeneration(db, { userId: "D", historyAccessRevision: changed.historyAccessRevision });
  await correctPersonHistory(db, "admin", await review("C", assignB));
  await expect(assertHistoryAccessGeneration(db, { userId: "D", historyAccessRevision: changed.historyAccessRevision })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  const latest = await db.user.findUniqueOrThrow({ where: { id: "D" } });
  expect(latest.sessionVersion - changed.sessionVersion).toBe(latest.historyAccessRevision - changed.historyAccessRevision);
});

it("retargets later retirement atomically while preserving independently corrected B", async () => {
  await correctPersonHistory(db, "admin", await review("C", assignB));
  await db.user.create({ data: { id: "E", email: "e@example.test", role: "VIEWER", passwordHash, emailVerifiedAt: new Date() } });
  await db.user.update({ where: { id: "D" }, data: { mergedIntoId: "E", passwordHash: null } });
  expect(await accountHistoryReaderId(db, "A")).toBe("E");
  expect(await accountHistoryReaderId(db, "D")).toBe("E");
  expect(await accountHistoryReaderId(db, "B")).toBe("C");
  expect(await db.retiredHistoryOwnership.findUniqueOrThrow({ where: { sourceUserId: "A" } })).toMatchObject({ readerUserId: "E", state: "ASSIGNED" });
  expect(await blocked("E")).toBe(1);
  expect(await blocked("C")).toBe(1);
});

it("keeps future initialization, sync and reconciliation on the corrected exact sources", async () => {
  await correctPersonHistory(db, "admin", await review("C", assignB));
  expect(await syncAccountPerson(db, "B")).toBe("pC");
  expect(await db.$transaction((tx) => initializePersonSource(tx, { kind: "USER", id: "B" }))).toBe("pC");
  await db.tutor.create({ data: { id: "future-source", englishName: "Future synthetic archive", status: "ARCHIVED" } });
  await db.tutorProfileOwnership.create({ data: { tutorId: "future-source", userId: "B" } });
  expect(await db.$transaction((tx) => initializePersonSource(tx, { kind: "TUTOR", id: "future-source" }))).toBe("pC");
  await expect(syncParticipantPerson(db, "TUTOR", "tB", "D")).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await personGraph(db, [{ kind: "USER", id: "B" }])).users.map((row) => row.id).sort()).toEqual(["B", "C"]);
  const reconciliation = await db.$transaction(async (tx) => reconcilePersonSources(await readPersonReconciliationSnapshot(tx)));
  expect(reconciliation.findings.filter((row) => ["B", "tB", "future-source"].includes(row.source.id))).toEqual([]);
});

it("keeps retired credentials immutable after history correction", async () => {
  await correctPersonHistory(db, "admin", await review());
  await expect(db.user.update({ where: { id: "B" }, data: { mergedIntoId: null } })).rejects.toThrow();
  await expect(db.user.update({ where: { id: "B" }, data: { passwordHash } })).rejects.toThrow();
  expect(await db.user.findUniqueOrThrow({ where: { id: "B" } })).toMatchObject({ mergedIntoId: "A", passwordHash: null, email: "b@example.test", username: "synthetic-b" });
});


it("reviews exact unadmitted copies, rejects forwarding and requires quarantine with lost notice access", async () => {
  const leaseUntil = new Date(Date.now() + 60_000);
  await db.emailDelivery.create({ data: { id: "pending-copy", sourceNotificationId: "nB", userId: "D", category: "info", event: "program_update", recipient: "d@example.test", leaseUntil } });
  const forwarding = await review("C", (row) => row.recordId === "pending-copy" ? "ASSIGN" : "RETAIN");
  await expect(correctPersonHistory(db, "admin", forwarding)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const inconsistent = await review("C", assignB);
  await expect(correctPersonHistory(db, "admin", inconsistent)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const intent = await review("C", (row) => row.recordId === "pending-copy" ? "QUARANTINE" : assignB(row));
  await correctPersonHistory(db, "admin", intent);
  expect(await db.emailDelivery.findUnique({ where: { id: "pending-copy" } })).toMatchObject({ status: "CANCELLED", sourceNotificationId: "nB", recipient: "d@example.test", userId: "D", attemptStartedAt: null });
  expect(await admitIdentityNotice(db, "pending-copy", leaseUntil, null)).toBeNull();
  const receipt = await db.personHistoryCorrectionReceipt.findUniqueOrThrow({ where: { id: intent.operationId } });
  expect(JSON.stringify(receipt.before)).toContain('"deliveryStatus":"PENDING"');
  expect(JSON.stringify(receipt.after)).toContain('"deliveryStatus":"CANCELLED"');
});

it("preserves admitted and uncertain delivery evidence after correction and rejects a stale lease", async () => {
  const leaseUntil = new Date(Date.now() + 60_000);
  await db.emailDelivery.create({ data: { id: "admitted-copy", sourceNotificationId: "nB", userId: "D", category: "info", event: "program_update", recipient: "d@example.test", leaseUntil } });
  expect(await admitIdentityNotice(db, "admitted-copy", new Date(leaseUntil.getTime() - 1), null)).toBeNull();
  const attempt = await admitIdentityNotice(db, "admitted-copy", leaseUntil, null);
  expect(attempt).toBeTruthy();
  const preview = await historyCorrectionInventory(db, { personId: "pD", sourceUserIds: ["B"], recipientUserId: "C" });
  expect(preview.rows.find((row) => row.recordId === "admitted-copy")).toMatchObject({ assignable: false, deliveryStatus: "SENDING" });
  await correctPersonHistory(db, "admin", await review("C", assignB));
  expect(await db.emailDelivery.findUnique({ where: { id: "admitted-copy" } })).toMatchObject({ status: "SENDING", attemptId: attempt, userId: "D", recipient: "d@example.test" });
  await finishIdentityNotice(db, "admitted-copy", "stale-attempt", true);
  await finishIdentityNotice(db, "admitted-copy", attempt!, false);
  expect(await db.emailDelivery.findUnique({ where: { id: "admitted-copy" } })).toMatchObject({ status: "UNCERTAIN", attemptId: attempt });
  expect(await admitIdentityNotice(db, "admitted-copy", leaseUntil, attempt)).toBeNull();
});

it("keeps legacy unknown origins independent and rolls back cancellation with the correction", async () => {
  await db.emailDelivery.create({ data: { id: "legacy-copy", userId: "D", category: "info", event: "program_update", recipient: "d@example.test" } });
  const intent = await review("C", (row) => row.recordId === "legacy-copy" ? "QUARANTINE" : "RETAIN");
  await expect(db.$transaction(async (tx) => {
    await correctPersonHistory(tx, "admin", intent);
    expect(await tx.emailDelivery.findUnique({ where: { id: "legacy-copy" } })).toMatchObject({ status: "CANCELLED", sourceNotificationId: null });
    throw new Error("synthetic rollback");
  })).rejects.toThrow("synthetic rollback");
  expect(await db.emailDelivery.findUnique({ where: { id: "legacy-copy" } })).toMatchObject({ status: "PENDING", sourceNotificationId: null });
  expect(await db.personHistoryCorrectionReceipt.findUnique({ where: { id: intent.operationId } })).toBeNull();
});


it("keeps per-source evidence in its original periods after a reader correction", async () => {
  const sources = [{ kind: "TUTOR", id: "tB" }, { kind: "TUTOR", id: "tA" }, { kind: "TUTEE", id: "sB" }, { kind: "USER", id: "B" }, { kind: "USER", id: "D" }] as const;
  const before = await personSourceEvidence(db, [...sources]);
  expect(before.get("TUTOR:tB")).toMatchObject({ periods: ["24-25", "24-25 Q1"], lessons: 1, amendments: 1 });
  expect(before.get("TUTOR:tA")).toMatchObject({ periods: [], lessons: 0 });
  expect(before.get("TUTEE:sB")).toMatchObject({ periods: ["24-25 Q1"], lessons: 1 });
  expect(before.get("USER:B")).toMatchObject({ policyAcceptances: 1, patrols: 1 });
  expect(before.get("USER:D")).toMatchObject({ policyAcceptances: 0, patrols: 0 });
  await correctPersonHistory(db, "admin", await review("C", assignB));
  expect(await personSourceEvidence(db, [...sources])).toEqual(before);
});

it("captures exact notification origins in a multirow insert and refuses origin rewriting", async () => {
  await db.programSettings.upsert({ where: { id: "program" }, create: { id: "program", emailNotificationsEnabled: true }, update: { emailNotificationsEnabled: true } });
  await db.user.update({ where: { id: "D" }, data: { emailInfo: true } });
  await db.accountEmail.upsert({ where: { email: "d@example.test" }, create: { userId: "D", email: "d@example.test", verifiedAt: new Date() }, update: { verifiedAt: new Date() } });
  await db.notification.createMany({ data: [
    { id: "origin-one", userId: "D", title: "Synthetic first", body: "Private body must stay out of mail", event: "program_update" },
    { id: "origin-two", userId: "D", title: "Synthetic second", body: "Another private body", event: "program_update" },
  ] });
  const copies = await db.emailDelivery.findMany({ where: { sourceNotificationId: { in: ["origin-one", "origin-two"] } }, orderBy: { sourceNotificationId: "asc" } });
  expect(copies.map((row) => row.sourceNotificationId)).toEqual(["origin-one", "origin-two"]);
  expect(JSON.stringify(copies)).not.toContain("Private body");
  await expect(db.emailDelivery.update({ where: { id: copies[0]!.id }, data: { sourceNotificationId: "origin-two" } })).rejects.toThrow();
});


it("allows historical evidence review after its current recurrence transfers", async () => {
  await db.pairing.createMany({ data: [
    { id: "superseded-current", tutorId: "tB", termId: "current", subject: "Mathematics", dayOfWeek: 2, startMin: 600, endMin: 630 },
    { id: "current-successor", tutorId: "tA", termId: "current", subject: "Mathematics", dayOfWeek: 2, startMin: 600, endMin: 630 },
  ] });
  const selection = { personId: "pD", sourceUserIds: ["B"], recipientUserId: "C" };
  expect((await historyCorrectionInventory(db, selection)).rows.find((row) => row.recordId === "tB")?.assignable).toBe(false);
  await db.pairingExecutionSuccessor.create({ data: { sourcePairingId: "superseded-current", targetPairingId: "current-successor", receiptId: "synthetic-transfer", effectiveAt: new Date() } });
  expect((await historyCorrectionInventory(db, selection)).rows.find((row) => row.recordId === "tB")?.assignable).toBe(true);
  await correctPersonHistory(db, "admin", await review("C", (row) => row.recordId === "tB" ? "ASSIGN" : "RETAIN"));
  expect(await db.pairing.findUnique({ where: { id: "superseded-current" } })).toMatchObject({ tutorId: "tB" });
});


it("serializes a leased notice admission behind committed ownership quarantine", async () => {
  const leaseUntil = new Date(Date.now() + 60_000);
  await db.emailDelivery.create({ data: { id: "racing-copy", sourceNotificationId: "nB", userId: "D", category: "info", event: "program_update", recipient: "d@example.test", leaseUntil } });
  const intent = await review("C", (row) => row.recordId === "racing-copy" ? "QUARANTINE" : assignB(row));
  let entered!: () => void, release!: () => void;
  const fenced = new Promise<void>((resolve) => { entered = resolve; });
  const mayCommit = new Promise<void>((resolve) => { release = resolve; });
  const correction = db.$transaction(async (tx) => {
    const receipt = await correctPersonHistory(tx, "admin", intent);
    entered();
    await mayCommit;
    return receipt;
  }, { timeout: 20_000 });
  await fenced;
  const admission = admitIdentityNotice(db, "racing-copy", leaseUntil, null);
  release();
  const [receipt, attempt] = await Promise.all([correction, admission]);
  expect(receipt.receiptId).toBe(intent.operationId);
  expect(attempt).toBeNull();
  expect(await db.emailDelivery.findUnique({ where: { id: "racing-copy" } })).toMatchObject({ status: "CANCELLED", attemptId: null, attemptStartedAt: null });
});


it("moves original planning history to the exact retained reader without granting live capability", async () => {
  await db.sessionPlan.create({ data: { id: "original-plan", generationKey: "original-plan", tutorId: "tB", termId: "past", originalDate: "2024-10-01", timeZone: "Asia/Shanghai", sourceFingerprint: "original", assignments: { create: { pairingId: "past-pairing", subject: "Mathematics", tuteeIds: ["sB"], primary: true } }, cohorts: { create: { id: "original-cohort", date: "2024-10-01", startMin: 600, endMin: 645, startsAt: new Date("2024-10-01T02:00:00Z"), endsAt: new Date("2024-10-01T02:45:00Z") } }, participants: { create: { tuteeId: "sB", cohortId: "original-cohort" } } } });
  for (const role of ["tutor", "tutee"] as const) {
    expect((await readSessionAgendaHistory(db, { id: "D" }, { role })).cohorts.map((row) => row.id)).toEqual(["original-cohort"]);
    expect((await readSessionAgendaHistory(db, { id: "C" }, { role })).cohorts).toEqual([]);
  }
  await correctPersonHistory(db, "admin", await review("C", assignB));
  for (const role of ["tutor", "tutee"] as const) {
    expect((await readSessionAgendaHistory(db, { id: "D" }, { role })).cohorts).toEqual([]);
    expect((await readSessionAgendaHistory(db, { id: "C" }, { role })).cohorts).toMatchObject([{ id: "original-cohort", tutorId: "tB", canRecordAttendance: false }]);
  }
  expect(await db.user.findUnique({ where: { id: "C" } })).toMatchObject({ role: "VIEWER", tutorId: null, studentId: null, tuteeMember: false });
  expect(await db.sessionPlan.findUnique({ where: { id: "original-plan" } })).toMatchObject({ tutorId: "tB", termId: "past" });
});
