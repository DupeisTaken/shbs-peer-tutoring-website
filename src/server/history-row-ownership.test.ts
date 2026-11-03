import { afterAll, beforeEach, expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { db } from "./db";
import { notificationOwnershipWhere, quarterBlockAccountWhere, assertHistoryProfileOwner } from "./history-row-ownership";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

async function clearFixture() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
}
beforeEach(async () => {
  await clearFixture();
  await db.user.createMany({ data: ["B", "D", "C", "other"].map((id) => ({ id, email: `${id.toLowerCase()}@example.test`, role: "VIEWER" as const })) });
  await db.user.update({ where: { id: "B" }, data: { mergedIntoId: "D" } });
  await db.notification.createMany({ data: [
    { id: "original-b", userId: "B", title: "Original B notice", body: "Synthetic immutable original recipient" },
    { id: "legacy", userId: "D", title: "Legacy notice", body: "Synthetic recipient rewritten before provenance" },
    { id: "independent-d", userId: "D", title: "Independent D notice" },
    { id: "independent-c", userId: "C", title: "Independent C notice" },
  ] });
  await db.studentQuarterBlock.createMany({ data: [
    { id: "original-block", userId: "B", email: "b@example.test", intakeTermId: "term", legacyTuteeId: "tutee" },
    { id: "legacy-block", userId: "D", email: "legacy@example.test", intakeTermId: "term", legacyTuteeId: "tutee" },
  ] });
  await db.tutor.create({ data: { id: "tutor", englishName: "Original synthetic archive", status: "ARCHIVED" } });
  await db.tutee.create({ data: { id: "tutee", englishName: "Original synthetic learner", status: "INACTIVE" } });
});
afterAll(async () => { await clearFixture(); await db.$disconnect(); });

const notifications = async (userId: string) => (await db.notification.findMany({ where: await notificationOwnershipWhere(db, userId), orderBy: { id: "asc" } })).map((row) => row.id);
const restrictions = async (userId: string) => (await db.studentQuarterBlock.findMany({ where: await quarterBlockAccountWhere(db, userId), orderBy: { id: "asc" } })).map((row) => row.id);

it("resolves unoverridden original notifications through exact history mappings", async () => {
  expect(await notifications("D")).toEqual(["independent-d", "legacy", "original-b"]);
  await db.retiredHistoryOwnership.update({ where: { sourceUserId: "B" }, data: { readerUserId: "C" } });
  expect(await notifications("D")).toEqual(["independent-d", "legacy"]);
  expect(await notifications("C")).toEqual(["independent-c", "original-b"]);
  expect(await notifications("other")).toEqual([]);
});

it("assigns only one explicit legacy notification without rewriting its original evidence", async () => {
  const before = await db.notification.findMany({ orderBy: { id: "asc" } });
  await db.historyRowOwnership.create({ data: { entity: "Notification", recordId: "legacy", readerUserId: "C", receiptId: "synthetic-exact-decision" } });
  expect(await notifications("C")).toEqual(["independent-c", "legacy"]);
  expect(await notifications("D")).toEqual(["independent-d", "original-b"]);
  expect(await db.notification.findMany({ orderBy: { id: "asc" } })).toEqual(before);
});

it("quarantines an exact legacy notification from every private reader with no original-recipient fallback", async () => {
  await db.historyRowOwnership.create({ data: { entity: "Notification", recordId: "legacy", readerUserId: null, receiptId: "synthetic-quarantine" } });
  for (const reader of ["B", "D", "C", "other"]) expect(await notifications(reader)).not.toContain("legacy");
  expect(await db.notification.findUniqueOrThrow({ where: { id: "legacy" } })).toMatchObject({ userId: "D", body: "Synthetic recipient rewritten before provenance", readAt: null });
  expect(await notifications("D")).toContain("independent-d");
});

it("keeps exact row quarantine authoritative after the original actor's reader changes", async () => {
  await db.historyRowOwnership.create({ data: { entity: "Notification", recordId: "original-b", readerUserId: null, receiptId: "synthetic-quarantine" } });
  await db.retiredHistoryOwnership.update({ where: { sourceUserId: "B" }, data: { readerUserId: "C" } });
  expect(await notifications("C")).not.toContain("original-b");
  expect(await notifications("D")).not.toContain("original-b");
  await db.historyRowOwnership.update({ where: { entity_recordId: { entity: "Notification", recordId: "original-b" } }, data: { readerUserId: "D", revision: { increment: 1 } } });
  expect(await notifications("D")).toContain("original-b");
  expect(await notifications("C")).not.toContain("original-b");
});

it("prevents moving an original account's authority primary key to another retired source", async () => {
  await db.user.create({ data: { id: "X", email: "x@example.test", role: "VIEWER", mergedIntoId: "D" } });
  const before = await db.retiredHistoryOwnership.findMany({ orderBy: { sourceUserId: "asc" } });
  await expect(db.retiredHistoryOwnership.update({ where: { sourceUserId: "B" }, data: { sourceUserId: "X" } })).rejects.toThrow("Original history source is immutable");
  expect(await db.retiredHistoryOwnership.findMany({ orderBy: { sourceUserId: "asc" } })).toEqual(before);
});

it.each(["entity", "recordId"] as const)("prevents changing exact row authority %s to bypass quarantine", async (field) => {
  await db.historyRowOwnership.create({ data: { entity: "Notification", recordId: "legacy", readerUserId: null, receiptId: "synthetic-quarantine" } });
  const before = await db.historyRowOwnership.findMany();
  await expect(db.historyRowOwnership.update({ where: { entity_recordId: { entity: "Notification", recordId: "legacy" } }, data: field === "entity" ? { entity: "Tutor" } : { recordId: "independent-d" } })).rejects.toThrow("Original history row identity is immutable");
  await expect(db.historyRowOwnership.delete({ where: { entity_recordId: { entity: "Notification", recordId: "legacy" } } })).rejects.toThrow();
  expect(await db.historyRowOwnership.findMany()).toEqual(before);
  expect(await notifications("D")).not.toContain("legacy");
});

it("assigns the restriction's account projection while retaining the original email prohibition", async () => {
  const before = await db.studentQuarterBlock.findUniqueOrThrow({ where: { id: "legacy-block" } });
  await db.historyRowOwnership.create({ data: { entity: "StudentQuarterBlock", recordId: "legacy-block", readerUserId: "C", receiptId: "synthetic-restriction-assignment" } });
  expect(await restrictions("C")).toEqual(["legacy-block"]);
  expect(await restrictions("D")).toEqual(["original-block"]);
  expect(await db.studentQuarterBlock.findUniqueOrThrow({ where: { email_intakeTermId: { email: "legacy@example.test", intakeTermId: "term" } } })).toEqual(before);
});

it("quarantines restrictions without restoring access to either unresolved recipient", async () => {
  await db.historyRowOwnership.create({ data: { entity: "StudentQuarterBlock", recordId: "legacy-block", readerUserId: null, quarantineUserIds: ["D", "C"], receiptId: "synthetic-restriction-quarantine" } });
  expect(await restrictions("D")).toEqual(["legacy-block", "original-block"]);
  expect(await restrictions("C")).toEqual(["legacy-block"]);
  expect(await restrictions("other")).toEqual([]);
  expect((await db.studentQuarterBlock.findUniqueOrThrow({ where: { id: "legacy-block" } })).email).toBe("legacy@example.test");
});

it.each(["TUTOR", "TUTEE"] as const)("blocks ordinary %s provisioning after exact quarantine, including direct ownership inserts", async (kind) => {
  const recordId = kind === "TUTOR" ? "tutor" : "tutee";
  const entity = kind === "TUTOR" ? "Tutor" : "Tutee";
  await db.historyRowOwnership.create({ data: { entity, recordId, readerUserId: null, receiptId: "synthetic-profile-quarantine" } });
  await expect(assertHistoryProfileOwner(db, kind, recordId, "D")).rejects.toMatchObject({ code: "CONFLICT" });
  if (kind === "TUTOR") await expect(db.tutorProfileOwnership.create({ data: { tutorId: recordId, userId: "D" } })).rejects.toThrow();
  else await expect(db.studentProfileOwnership.create({ data: { tuteeId: recordId, userId: "D" } })).rejects.toThrow();
  await expect(db.user.update({ where: { id: "D" }, data: kind === "TUTOR" ? { tutorId: recordId } : { studentId: recordId } })).rejects.toThrow();
  expect(await db.user.findUniqueOrThrow({ where: { id: "D" } })).toMatchObject({ tutorId: null, studentId: null });
  expect(await db.tutorProfileOwnership.count()).toBe(0);
  expect(await db.studentProfileOwnership.count()).toBe(0);
});

it.each(["TUTOR", "TUTEE"] as const)("permits only the exact reviewed %s owner and refuses another live account", async (kind) => {
  const recordId = kind === "TUTOR" ? "tutor" : "tutee";
  const entity = kind === "TUTOR" ? "Tutor" : "Tutee";
  await db.historyRowOwnership.create({ data: { entity, recordId, readerUserId: "C", receiptId: "synthetic-profile-assignment" } });
  await expect(assertHistoryProfileOwner(db, kind, recordId, "C")).resolves.toBeUndefined();
  await expect(assertHistoryProfileOwner(db, kind, recordId, "D")).rejects.toMatchObject({ code: "CONFLICT" });
  if (kind === "TUTOR") {
    await db.tutorProfileOwnership.create({ data: { tutorId: recordId, userId: "C" } });
    await expect(db.tutorProfileOwnership.update({ where: { tutorId: recordId }, data: { userId: "D" } })).rejects.toThrow();
    expect((await db.tutorProfileOwnership.findUniqueOrThrow({ where: { tutorId: recordId } })).userId).toBe("C");
  } else {
    await db.studentProfileOwnership.create({ data: { tuteeId: recordId, userId: "C" } });
    await expect(db.studentProfileOwnership.update({ where: { tuteeId: recordId }, data: { userId: "D" } })).rejects.toThrow();
    expect((await db.studentProfileOwnership.findUniqueOrThrow({ where: { tuteeId: recordId } })).userId).toBe("C");
  }
});
