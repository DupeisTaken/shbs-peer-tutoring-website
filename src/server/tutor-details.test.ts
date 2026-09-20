import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { currentPolicy } from "~/server/policy-acceptance";

// Deliberately stale session rank exercises the live-account authorization boundary.
const caller = () => createCaller({ db, headers: new Headers(), session: {
  user: { id: "detail-reviewer", name: "Synthetic reviewer", email: "reviewer@example.test" },
  role: "HEAD" as Session["role"], tutorId: null, expires: "2099-01-01",
} });

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/shbs_shipping_test")
    throw new Error("Tutor detail tests require isolated local shbs_shipping_test");
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map((row) => '"' + row.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.tutor.createMany({ data: [
    { id: "detail-tutor", englishName: "Synthetic Tutor" },
    { id: "detail-unlinked", englishName: "Synthetic Unlinked" },
  ] });
  await db.user.createMany({ data: [
    { id: "detail-reviewer", email: "reviewer@example.test", role: "HEAD" },
    { id: "detail-user", email: "participant@example.test", role: "STUDENT", tutorId: "detail-tutor", tuteeMember: true },
  ] });
  await db.courseGroup.create({ data: { id: "detail-group", name: "Computer Science", rank: 1 } });
  await db.subjectLevel.createMany({ data: [
    { id: "detail-standard", name: "Standard", prefix: "", rank: 0 },
    { id: "detail-ap", name: "AP", prefix: "AP", rank: 2 },
  ] });
  await db.subject.createMany({ data: [
    { id: "detail-intro", name: "Intro to Computer Science", baseName: "Intro to Computer Science", groupId: "detail-group", levelId: "detail-standard" },
    { id: "detail-advanced", name: "AP Computer Science A", baseName: "Computer Science A", groupId: "detail-group", levelId: "detail-ap" },
  ] });
  await db.tutorQualification.create({ data: { tutorId: "detail-tutor", subjectId: "detail-advanced", status: "APPROVED", approvedById: "detail-reviewer" } });
  await db.qualificationGrant.createMany({ data: ["detail-intro", "detail-advanced"].map((subjectId) => ({ tutorId: "detail-tutor", sourceSubjectId: "detail-advanced", subjectId })) });
  await db.tutorSubjectWillingness.create({ data: { tutorId: "detail-tutor", subjectId: "detail-intro", willing: false } });
  await db.policyDocument.createMany({ data: ["tutee-policy", "tutor-policy"].map((slug) => ({ slug, locale: "en", title: "Synthetic policy", body: "Original synthetic consent", version: "1" })) });
});
afterAll(() => db.$disconnect());

it.each(["HEAD", "ADMIN", "COORDINATOR"] as const)("%s can inspect without changing roles, grants or policy evidence", async (role) => {
  await db.user.update({ where: { id: "detail-reviewer" }, data: { role } });
  const before = await db.user.findUniqueOrThrow({ where: { id: "detail-user" } });
  const result = await caller().tutorDetails.get({ tutorId: "detail-tutor" });
  expect(result.badges).toEqual(["TUTOR"]);
  expect(result.groups[0]?.subjects).toMatchObject([
    { id: "detail-intro", qualified: true, willing: false, inheritedFrom: [{ id: "detail-advanced" }] },
    { id: "detail-advanced", qualified: true, willing: null },
  ]);
  expect(result).not.toHaveProperty("passwordHash");
  expect(await db.user.findUniqueOrThrow({ where: { id: "detail-user" } })).toEqual(before);
  expect(await db.policyAcceptance.count()).toBe(0);
});

it.each(["VIEWER", "TUTOR", "STUDENT", "CREW"] as const)("%s cannot inspect another tutor even with a stale management session", async (role) => {
  await db.user.update({ where: { id: "detail-reviewer" }, data: { role } });
  await expect(caller().tutorDetails.get({ tutorId: "detail-tutor" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller().student.acceptanceRecords({ userId: "detail-user" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("preserves inherited approval after reorder but ignores grants from rejected sources", async () => {
  await db.subjectLevel.update({ where: { id: "detail-ap" }, data: { rank: -1 } });
  const result = await caller().tutorDetails.get({ tutorId: "detail-tutor" });
  expect(result.groups[0]?.subjects.map((subject) => subject.id)).toEqual(["detail-advanced", "detail-intro"]);
  expect(result.groups[0]?.subjects.every((subject) => subject.qualified)).toBe(true);
  await db.tutorQualification.update({ where: { tutorId_subjectId: { tutorId: "detail-tutor", subjectId: "detail-advanced" } }, data: { status: "REJECTED" } });
  expect((await caller().tutorDetails.get({ tutorId: "detail-tutor" })).groups[0]?.subjects.every((subject) => !subject.qualified)).toBe(true);
});

it("returns unlinked and revoked records truthfully and rejects unknown tutors", async () => {
  expect(await caller().tutorDetails.get({ tutorId: "detail-unlinked" })).toMatchObject({ userId: null, badges: [] });
  await db.user.update({ where: { id: "detail-user" }, data: { tutorAccessRevoked: true } });
  expect(await caller().tutorDetails.get({ tutorId: "detail-tutor" })).toMatchObject({ userId: "detail-user", tutorAccessRevoked: true, badges: ["STUDENT"] });
  await expect(caller().tutorDetails.get({ tutorId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("uses linked account identity for accepted/unaccepted tutee policy and preserves historical words", async () => {
  const detail = await caller().tutorDetails.get({ tutorId: "detail-tutor" });
  const unaccepted = await caller().student.acceptanceRecords({ userId: detail.userId! });
  expect(unaccepted.current.find((policy) => policy.slug === "tutee-policy")?.acceptedAt).toBeNull();
  const policy = await currentPolicy(db, "tutee-policy");
  await db.policyAcceptance.create({ data: { userId: detail.userId!, slug: "tutee-policy", revision: policy.revision, snapshot: policy.documents, signature: "Synthetic Tutor" } });
  expect((await caller().student.acceptanceRecords({ userId: detail.userId! })).current.find((item) => item.slug === "tutee-policy")?.acceptedAt).toBeInstanceOf(Date);
  await db.policyDocument.updateMany({ where: { slug: "tutee-policy" }, data: { body: "Revised synthetic consent", version: "2" } });
  const changed = await caller().student.acceptanceRecords({ userId: detail.userId! });
  expect(changed.current.find((item) => item.slug === "tutee-policy")?.acceptedAt).toBeNull();
  expect(changed.rows[0]?.documents[0]).toMatchObject({ version: "1", body: "Original synthetic consent" });
});
