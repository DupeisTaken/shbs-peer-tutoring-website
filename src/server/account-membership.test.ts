import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { hashPassword } from "~/server/auth/password";
import { currentPolicy } from "~/server/policy-acceptance";
import { acceptStudentPolicy, prepareStudentAction, studentPolicyStatus } from "~/server/student-workflow";
import { accountMembership, type AccountMembership } from "~/lib/account-membership";

const head = "c000000000000000000000001";
const admin = "c000000000000000000000002";
const person = "c000000000000000000000003";
const viewer = "c000000000000000000000004";
const password = "SyntheticPassword123!";
const base: AccountMembership = { rank: "NONE", viewer: false, tutor: false, tutee: false, translator: false, crew: false };
const caller = (id = head) => createCaller({ db, headers: new Headers(), session: {
  user: { id, name: "Synthetic reviewer", email: `${id}@example.test` },
  role: "HEAD" as Session["role"], tutorId: null, expires: "2099-01-01",
} });

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/shbs_shipping_test")
    throw new Error("Membership tests require isolated local shbs_shipping_test");
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(row => '"' + row.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.createMany({ data: [
    { id: head, email: "head@example.test", role: "HEAD", passwordHash: hashPassword(password) },
    { id: admin, email: "admin@example.test", role: "ADMIN", passwordHash: hashPassword(password) },
    { id: person, email: "participant@example.test", name: "Synthetic Participant", role: "STUDENT", username: "participant" },
    { id: viewer, email: "viewer@example.test", role: "VIEWER" },
  ] });
  await db.policyDocument.createMany({ data: ["tutee-policy", "tutor-policy"].map(slug => ({ slug, locale: "en", title: "Synthetic policy", body: "Synthetic consent text", version: "1" })) });
});
afterAll(() => db.$disconnect());

it("supports management-only and management with both kinds of participation without fabricating consent", async () => {
  await caller().admin.setMemberships({ userId: person, membership: { ...base, rank: "ADMIN" }, confirmPassword: password });
  expect(accountMembership(await db.user.findUniqueOrThrow({ where: { id: person } }))).toEqual({ ...base, rank: "ADMIN" });
  await caller().admin.setMemberships({ userId: person, membership: { ...base, rank: "ADMIN", tutor: true, tutee: true, translator: true, crew: true }, confirmPassword: password });
  const user = await db.user.findUniqueOrThrow({ where: { id: person }, include: { tutor: true } });
  expect(accountMembership(user)).toEqual({ ...base, rank: "ADMIN", tutor: true, tutee: true, translator: true, crew: true });
  expect(await db.policyAcceptance.count()).toBe(0);
  await expect(caller(person).student.me()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

it("queues self requests without access and permits only Head to decide", async () => {
  const requested = await caller(person).account.requestMemberships({ ...base, translator: true, crew: true });
  expect((await db.user.findUniqueOrThrow({ where: { id: person } })).canTranslate).toBe(false);
  await expect(caller(admin).approval.decide({ id: requested.id, approve: true, note: "Review" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller().approval.decide({ id: requested.id, approve: true, note: "Reviewed membership" });
  expect(await db.user.findUniqueOrThrow({ where: { id: person } })).toMatchObject({ canTranslate: true, crewStatus: "ACTIVE" });
  await expect(caller().approval.decide({ id: requested.id, approve: true, note: "Repeat" })).rejects.toMatchObject({ code: "CONFLICT" });
});

it("queues administrator badge changes and never persists identity challenges", async () => {
  await expect(caller(admin).admin.setMemberships({ userId: person, membership: { ...base, translator: true }, confirmPassword: "NeverStoreThisSecret" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const request = await db.approvalRequest.findFirstOrThrow();
  expect(JSON.stringify(request)).not.toContain("NeverStoreThisSecret");
  expect((await db.user.findUniqueOrThrow({ where: { id: person } })).canTranslate).toBe(false);
  await caller().approval.decide({ id: request.id, approve: true, note: "Reviewed" });
  expect((await db.user.findUniqueOrThrow({ where: { id: person } })).canTranslate).toBe(true);
});

it("rejects every Viewer combination through schema and database constraints", async () => {
  for (const field of ["tutor", "tutee", "translator", "crew"] as const)
    await expect(caller().admin.setMemberships({ userId: viewer, membership: { ...base, viewer: true, [field]: true }, confirmPassword: password })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  for (const data of [{ canTranslate: true }, { crewStatus: "ACTIVE" as const }, { tuteeMember: true }])
    await expect(db.user.update({ where: { id: viewer }, data })).rejects.toThrow();
  await expect(caller().admin.setUserCanTranslate({ userId: viewer, canTranslate: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(caller(admin).admin.setUserRole({ userId: viewer, role: "STUDENT", confirmPassword: password })).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("requires explicit Translator even for management, before coordinator queueing", async () => {
  for (const id of [head, admin])
    await expect(caller(id).localization.setString({ locale: "es", key: "common.save", value: "Guardar" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: admin }, data: { role: "COORDINATOR" } });
  await expect(caller(admin).localization.setString({ locale: "es", key: "common.save", value: "Guardar" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.approvalRequest.count()).toBe(0);
  await caller().admin.setUserCanTranslate({ userId: person, canTranslate: true });
  await caller(person).localization.setString({ locale: "es", key: "common.save", value: "Guardar" });
  const draft = await db.translationDraft.findFirstOrThrow();
  await caller().translationReview.decide({ id: draft.id, approve: true, expectedUpdatedAt: draft.updatedAt });
  expect((await db.user.findUniqueOrThrow({ where: { id: head } })).canTranslate).toBe(false);
  await expect(caller().localization.setString({ locale: "es", key: "common.save", value: "Again" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("gates the first tutor tutee visit, grants membership atomically, and preserves repeated acceptance evidence", async () => {
  await caller().admin.setMemberships({ userId: person, membership: { ...base, tutor: true }, confirmPassword: password });
  expect((await studentPolicyStatus(db, person))?.slug).toBe("tutor-policy");
  const policy = await studentPolicyStatus(db, person, true);
  expect(policy?.slug).toBe("tutee-policy");
  await expect(caller(person).student.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
  const accept = async (revision: string) => {
    const ticket = await prepareStudentAction(db, person, "POLICY", revision);
    await db.studentActionConfirmation.update({ where: { id: ticket.id }, data: { readyAt: new Date(0) } });
    return acceptStudentPolicy(db, person, revision, ticket.id);
  };
  await accept(policy!.revision);
  const evidence = await db.policyAcceptance.findFirstOrThrow({ where: { userId: person, slug: "tutee-policy" } });
  expect((await db.user.findUniqueOrThrow({ where: { id: person } })).tuteeMember).toBe(true);
  expect(await studentPolicyStatus(db, person, true)).toBeNull();
  await accept(policy!.revision);
  expect(await db.policyAcceptance.findFirstOrThrow({ where: { id: evidence.id } })).toEqual(evidence);
  await db.policyDocument.updateMany({ where: { slug: "tutee-policy" }, data: { version: "2", body: "New consent" } });
  await expect(caller(person).student.me()).resolves.toBeDefined();
  expect((await studentPolicyStatus(db, person, true))?.documents[0]?.version).toBe("2");
  const history = await caller(admin).student.acceptanceRecords({ userId: person });
  expect(history.rows[0]).toMatchObject({ revision: evidence.revision, documents: [{ version: "1", body: "Synthetic consent text" }] });
  expect((await currentPolicy(db, "tutee-policy")).revision).not.toBe(evidence.revision);
});

it("retains singleton leadership and rejects stale Head sessions after transfer", async () => {
  await caller().admin.transferHead({ userId: admin, confirmPassword: password });
  expect(await db.user.count({ where: { role: "HEAD" } })).toBe(1);
  await expect(caller().admin.transferHead({ userId: person, confirmPassword: password })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller(admin).admin.setMemberships({ userId: admin, membership: { ...base, rank: "ADMIN" }, confirmPassword: password })).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("converts historical participants to sole Viewer without deleting identity or history", async () => {
  await caller().admin.setMemberships({ userId: person, membership: { ...base, tutor: true, tutee: true }, confirmPassword: password });
  const before = await db.user.findUniqueOrThrow({ where: { id: person } });
  const student = await db.tutee.create({ data: { englishName: "Historical Student" } });
  await db.user.update({ where: { id: person }, data: { studentId: student.id } });
  await caller().admin.setMemberships({ userId: person, membership: { ...base, viewer: true }, confirmPassword: password });
  const after = await db.user.findUniqueOrThrow({ where: { id: person }, include: { tutor: true } });
  expect(after).toMatchObject({ role: "VIEWER", tutorId: before.tutorId, studentId: student.id, tutorAccessRevoked: true, tuteeMember: false });
  expect(accountMembership(after)).toEqual({ ...base, viewer: true });
  await expect(caller(person).tutor.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller(person).student.me()).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("rejects a concurrent Admin status restore after Head removes participation", async () => {
  await caller().admin.setMemberships({ userId: person, membership: { ...base, tutor: true }, confirmPassword: password });
  const user = await db.user.findUniqueOrThrow({ where: { id: person } });
  const original = db.tutor.findUnique.bind(db.tutor);
  let first = true;
  const spy = vi.spyOn(db.tutor, "findUnique").mockImplementation((...args) => (async () => {
    const result = await original(...args);
    if (first) {
      first = false;
      await db.tutor.update({ where: { id: user.tutorId! }, data: { status: "ARCHIVED" } });
    }
    return result;
  })() as unknown as ReturnType<typeof original>);
  try {
    await expect(caller(admin).admin.updateTutor({ id: user.tutorId!, firstName: "Synthetic", lastName: "Participant", status: "ACTIVE" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.tutor.findUniqueOrThrow({ where: { id: user.tutorId! } })).status).toBe("ARCHIVED");
  } finally { spy.mockRestore(); }
});
