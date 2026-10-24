import { afterAll, beforeEach, expect, it } from "vitest";
import { db } from "./db";
import { initializePersonSource } from "./person-source-initialization";
import {
  readPersonReconciliationSnapshot,
  reconcilePersonSources,
} from "./person-reconciliation";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) =>
    '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
});
afterAll(() => db.$disconnect());

it("initializes standalone sources without name/email matching or changing original evidence", async () => {
  const date = new Date("2024-10-01T12:00:00Z");
  const tutor = await db.tutor.create({ data: {
    id: "t", englishName: "Original tutor", email: "same@example.test", status: "ARCHIVED",
    updatedAt: date, gradeLevel: 10, workloadPreferenceVersion: 4,
  } });
  const student = await db.tutee.create({ data: {
    id: "s", englishName: "Original tutor", email: "same@example.test", status: "INACTIVE",
    updatedAt: date, signupSubmittedAt: date, signatureName: "Original signature", signedRulebook: true,
  } });
  const [tutorPerson, studentPerson] = await db.$transaction(async (tx) => [
    await initializePersonSource(tx, { kind: "TUTOR", id: tutor.id }),
    await initializePersonSource(tx, { kind: "TUTEE", id: student.id }),
  ]);
  expect(tutorPerson).not.toBe(studentPerson);
  const tutorEvidence = await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } });
  const studentEvidence = await db.tutee.findUniqueOrThrow({ where: { id: student.id } });
  expect(tutorEvidence).toEqual({ ...tutor, personId: tutorPerson, historyIdentityRevision: tutorEvidence.historyIdentityRevision });
  expect(studentEvidence).toEqual({ ...student, personId: studentPerson, historyIdentityRevision: studentEvidence.historyIdentityRevision });
  expect(await db.user.count()).toBe(0);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(await db.tutorProfileOwnership.count()).toBe(0);
});

it("uses explicit retained ownership through a retired account without granting participation", async () => {
  await db.user.create({ data: { id: "owner", email: "owner@example.test", role: "STUDENT", tuteeMember: false, tutorAccessRevoked: true } });
  await db.user.create({ data: { id: "retired", email: "retired@example.test", mergedIntoId: "owner" } });
  await db.tutor.create({ data: { id: "t", englishName: "Original", status: "ARCHIVED" } });
  await db.tutorProfileOwnership.create({ data: { tutorId: "t", userId: "retired" } });
  const personId = await db.$transaction((tx) => initializePersonSource(tx, { kind: "TUTOR", id: "t" }));
  expect(await db.user.findUniqueOrThrow({ where: { id: "owner" } })).toMatchObject({
    personId, tutorId: null, studentId: null, tuteeMember: false, tutorAccessRevoked: true, role: "STUDENT", passwordHash: null,
  });
  expect(await db.tutorProfileOwnership.findUniqueOrThrow({ where: { tutorId: "t" } })).toMatchObject({ userId: "retired", revision: 1 });
  expect(await db.tutor.findUniqueOrThrow({ where: { id: "t" } })).toMatchObject({ personId, status: "ARCHIVED" });
});

it("rejects conflicting explicit current and retained owners and rolls initialization back", async () => {
  await db.tutee.create({ data: { id: "s", englishName: "Original" } });
  await db.user.create({ data: { id: "owner", email: "owner@example.test", studentId: "s" } });
  await db.user.create({ data: { id: "other", email: "other@example.test" } });
  await db.studentProfileOwnership.create({ data: { tuteeId: "s", userId: "other" } });
  await expect(db.$transaction((tx) => initializePersonSource(tx, { kind: "TUTEE", id: "s" }))).rejects.toThrow(/conflicting current and retained owners/);
  await expect(db.$transaction((tx) => initializePersonSource(tx, { kind: "USER", id: "owner" }))).rejects.toThrow(/conflicting current and retained owners/);
  expect(await db.person.count()).toBe(0);
  expect((await db.tutee.findUniqueOrThrow({ where: { id: "s" } })).personId).toBeNull();
});

it("preserves established groups and every revision on repeated initialization", async () => {
  const person = await db.person.create({ data: { id: "p", revision: 8, resolutionState: "REVIEW_REQUIRED" } });
  const student = await db.tutee.create({ data: { id: "s", englishName: "Original", personId: person.id } });
  // Inserting a member advances the group fence before initialization begins.
  const establishedPerson = await db.person.findUniqueOrThrow({ where: { id: person.id } });
  expect(establishedPerson.revision).toBe(person.revision + 1);
  await db.$transaction(async (tx) => {
    expect(await initializePersonSource(tx, { kind: "TUTEE", id: "s" })).toBe(person.id);
    expect(await initializePersonSource(tx, { kind: "TUTEE", id: "s" })).toBe(person.id);
  });
  expect(await db.person.findUniqueOrThrow({ where: { id: person.id } })).toEqual(establishedPerson);
  expect(await db.tutee.findUniqueOrThrow({ where: { id: student.id } })).toEqual(student);
});

it("does not merge two established participation groups while initializing a missing login identity", async () => {
  await db.person.createMany({ data: [{ id: "a" }, { id: "b" }] });
  await db.tutor.create({ data: { id: "t", englishName: "Tutor", personId: "a" } });
  await db.tutee.create({ data: { id: "s", englishName: "Student", personId: "b" } });
  await db.user.create({ data: { id: "owner", email: "owner@example.test", tutorId: "t", studentId: "s" } });
  await expect(db.$transaction((tx) => initializePersonSource(tx, { kind: "USER", id: "owner" }))).rejects.toThrow(/different directory groups/);
  expect((await db.user.findUniqueOrThrow({ where: { id: "owner" } })).personId).toBeNull();
  expect(await db.person.count({ where: { mergedIntoId: { not: null } } })).toBe(0);
});

it("adopts one explicitly retained source group without rewriting its source or creating credentials", async () => {
  await db.person.create({ data: { id: "existing-history", resolutionState: "REVIEW_REQUIRED" } });
  const student = await db.tutee.create({ data: { id: "s", personId: "existing-history", englishName: "Original archive", status: "INACTIVE" } });
  const user = await db.user.create({ data: { id: "owner", email: "owner@example.test", role: "STUDENT", tuteeMember: false, tutorAccessRevoked: true } });
  await db.studentProfileOwnership.create({ data: { userId: user.id, tuteeId: student.id } });
  // Capture after the ownership trigger; initialization must not add another
  // source revision when that source already has its directory identity.
  const before = await db.tutee.findUniqueOrThrow({ where: { id: student.id } });
  expect(await db.$transaction((tx) => initializePersonSource(tx, { kind: "USER", id: user.id }))).toBe("existing-history");
  expect(await db.tutee.findUniqueOrThrow({ where: { id: student.id } })).toEqual(before);
  expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual({ ...user, personId: "existing-history" });
  expect(await db.person.findUniqueOrThrow({ where: { id: "existing-history" } })).toMatchObject({ primaryUserId: user.id, resolutionState: "REVIEW_REQUIRED" });
  expect(await db.person.count()).toBe(1);
});

it("serializes simultaneous missing-source initialization into one identity", async () => {
  await db.tutor.create({ data: { id: "t", englishName: "Original" } });
  const results = await Promise.all([
    db.$transaction((tx) => initializePersonSource(tx, { kind: "TUTOR", id: "t" })),
    db.$transaction((tx) => initializePersonSource(tx, { kind: "TUTOR", id: "t" })),
  ]);
  expect(results[0]).toBe(results[1]);
  expect(await db.person.count()).toBe(1);
});

it("rolls source identity and revision writes back with the owning domain transaction", async () => {
  await db.tutee.create({ data: { id: "s", englishName: "Original" } });
  const before = await db.tutee.findUniqueOrThrow({ where: { id: "s" } });
  await expect(db.$transaction(async (tx) => {
    await initializePersonSource(tx, { kind: "TUTEE", id: "s" });
    throw new Error("domain audit failed");
  })).rejects.toThrow("domain audit failed");
  expect(await db.tutee.findUniqueOrThrow({ where: { id: "s" } })).toEqual(before);
  expect(await db.person.count()).toBe(0);
});

it("reads orphan scalar ownership from a database-enforced read-only snapshot", async () => {
  await db.studentProfileOwnership.create({ data: { tuteeId: "gone-source", userId: "gone-user" } });
  const before = await db.studentProfileOwnership.findMany();
  const report = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return reconcilePersonSources(await readPersonReconciliationSnapshot(tx));
  }, { isolationLevel: "RepeatableRead" });
  expect(report.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["DANGLING_OWNER", "DANGLING_SOURCE"]));
  expect(await db.studentProfileOwnership.findMany()).toEqual(before);
  expect(await db.person.count()).toBe(0);
});
