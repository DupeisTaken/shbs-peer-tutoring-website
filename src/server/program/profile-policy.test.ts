import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/rate-limit", () => ({ rateLimit: () => ({ ok: true }) }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { ALL_GRADES } from "~/lib/profile-policy";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { confirmAccountAcademics } from "~/server/academics";
import { issueRegistrationCode, setEmailVerification, confirmEmailCode, completeRegistration } from "~/server/auth/registration";

const defaults = { requireLatinNames: false, offeredGrades: ALL_GRADES };
const caller = (role: Session["role"] = "STUDENT") => createCaller({ db, headers: new Headers(),
  session: { user: { id: `policy-${role}`, name: role }, role, tutorId: null, expires: "2099-01-01" } });
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test") throw Error("Use isolated shbs_shipping_test");
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  for (const role of ["HEAD", "ADMIN", "COORDINATOR", "STUDENT", "VIEWER"] as const)
    await db.user.create({ data: { id: `policy-${role}`, role, name: role, email: `${role}@example.test`, username: role.toLowerCase() } });
  await db.term.create({ data: { id: "policy-term", active: true, schoolYear: "26-27", quarter: "Q1", name: "2026 Q1" } });
});
afterAll(() => db.$disconnect());

it("publishes safe defaults and permits audited, immediate, reversible administrator settings", async () => {
  expect(await createCaller({ db, headers: new Headers(), session: null }).program.profilePolicy()).toEqual({ ...defaults, currentSchoolYear: "26-27" });
  expect((await caller("COORDINATOR").program.profilePolicySettings()).canEdit).toBe(false);
  const beforeUser = await db.user.findUniqueOrThrow({ where: { id: "policy-STUDENT" } });
  const changed = await caller("ADMIN").program.setProfilePolicy({ requireLatinNames: true, offeredGrades: [12, 10, 11], expectedPolicy: defaults });
  expect(changed).toEqual({ requireLatinNames: true, offeredGrades: [10, 11, 12] });
  expect(await db.auditLog.findFirst({ where: { operation: "program.setProfilePolicy" } })).toMatchObject({ details: { before: defaults, after: changed, existingRecordsPreserved: true } });
  expect(await db.user.findUniqueOrThrow({ where: { id: beforeUser.id } })).toEqual(beforeUser);
  await caller("HEAD").program.setProfilePolicy({ ...defaults, expectedPolicy: changed });
  expect((await caller().program.profilePolicy()).offeredGrades).toEqual(ALL_GRADES);
});

it("rejects unauthorized, invalid and stale policy changes", async () => {
  for (const role of ["COORDINATOR", "STUDENT", "VIEWER"] as const)
    await expect(caller(role).program.setProfilePolicy({ ...defaults, expectedPolicy: defaults })).rejects.toMatchObject({ code: "FORBIDDEN" });
  for (const grades of [[], [0], [13], [9, 9]])
    await expect(caller("HEAD").program.setProfilePolicy({ ...defaults, offeredGrades: grades, expectedPolicy: defaults })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await caller("HEAD").program.setProfilePolicy({ ...defaults, offeredGrades: [9, 10], expectedPolicy: defaults });
  await expect(caller("ADMIN").program.setProfilePolicy({ ...defaults, expectedPolicy: defaults })).rejects.toMatchObject({ code: "CONFLICT", message: "PROFILE_POLICY_CHANGED" });
});

it("ignores a forged school year and records the active program year for self-service and staff", async () => {
  await caller().account.updateAcademics({ status: "REPORTED", gradeLevel: 10, schoolYear: "50-51", expectedProfileVersion: 0 });
  expect(await db.academicProfile.findUniqueOrThrow({ where: { userId: "policy-STUDENT" } })).toMatchObject({ gradeLevel: 10, schoolYear: "26-27" });
  expect((await caller().account.me()).academic.expectedGraduationYear).toBe(2029);
  await caller("HEAD").admin.updateAccountAcademics({ userId: "policy-STUDENT", status: "REPORTED", gradeLevel: 11, expectedSchoolYear: "26-27", expectedProfileVersion: 1 });
  expect(await db.academicConfirmation.findMany({ where: { userId: "policy-STUDENT" }, orderBy: { confirmedAt: "asc" } })).toMatchObject([
    { gradeLevel: 10, schoolYear: "26-27", source: "SELF_SERVICE" }, { gradeLevel: 11, schoolYear: "26-27", source: "STAFF" },
  ]);
  expect((await db.user.findUniqueOrThrow({ where: { id: "policy-STUDENT" } })).username).toBe("student");
});

it("keeps historical years intact, rejects stale year displays, and confirms only offered grades", async () => {
  await confirmAccountAcademics(db, "policy-STUDENT", { status: "REPORTED", gradeLevel: 9, schoolYear: "25-26", expectedProfileVersion: 0 }, { actorId: "policy-STUDENT", source: "VERIFIED_SURVEY" });
  await caller("HEAD").program.setProfilePolicy({ ...defaults, offeredGrades: [10, 11, 12], expectedPolicy: defaults });
  await expect(caller().account.updateAcademics({ status: "REPORTED", gradeLevel: 9, expectedProfileVersion: 1 })).rejects.toMatchObject({ message: "PROFILE_GRADE_NOT_OFFERED" });
  await expect(caller().account.updateAcademics({ status: "REPORTED", gradeLevel: 10, expectedProfileVersion: 1, expectedSchoolYear: "25-26" })).rejects.toMatchObject({ code: "CONFLICT", message: "PROFILE_PROGRAM_YEAR_CHANGED" });
  expect((await db.academicProfile.findUniqueOrThrow({ where: { userId: "policy-STUDENT" } })).schoolYear).toBe("25-26");
  await caller().account.updateAcademics({ status: "REPORTED", gradeLevel: 10, expectedProfileVersion: 1, expectedSchoolYear: "26-27" });
  expect((await db.academicConfirmation.findMany({ where: { userId: "policy-STUDENT" }, orderBy: { confirmedAt: "asc" } })).map(row => row.schoolYear)).toEqual(["25-26", "26-27"]);
});

it("requires a current program year for reported grades but still accepts explicit unknown and not applicable", async () => {
  await db.term.updateMany({ data: { active: false } });
  await expect(caller().account.updateAcademics({ status: "REPORTED", gradeLevel: 10, expectedProfileVersion: 0 })).rejects.toMatchObject({ message: "PROFILE_NO_CURRENT_YEAR" });
  await caller().account.updateAcademics({ status: "UNKNOWN", gradeLevel: null, rawGrade: "Different school system", expectedProfileVersion: 0 });
  await caller().account.updateAcademics({ status: "NOT_APPLICABLE", gradeLevel: null, expectedProfileVersion: 1 });
  expect(await db.academicProfile.findUniqueOrThrow({ where: { userId: "policy-STUDENT" } })).toMatchObject({ status: "NOT_APPLICABLE", schoolYear: null });
});

it("verified registration derives graduation from the active year even when an old client submits a different year", async () => {
  const issued = await issueRegistrationCode({ issuedById: "policy-HEAD", kind: "TUTOR", email: "new@example.test" });
  const row = await db.registrationCode.findUniqueOrThrow({ where: { id: issued.id } });
  const verification = await setEmailVerification(row, "new@example.test");
  if (!verification.ok) throw Error("Expected email verification");
  const fresh = await db.registrationCode.findUniqueOrThrow({ where: { id: row.id } });
  const proof = await confirmEmailCode(fresh, verification.emailCode);
  if (!proof.ok) throw Error("Expected verified email");
  const verified = await db.registrationCode.findUniqueOrThrow({ where: { id: row.id } });
  const result = await completeRegistration(verified, { firstName: "Alice", lastName: "River", gradeLevel: 10, gradeSchoolYear: "30-31", password: "Password123!", completionProof: proof.completionProof });
  expect(result).toMatchObject({ ok: true, username: "ariver29" });
  const user = await db.user.findUniqueOrThrow({ where: { email: "new@example.test" }, include: { academicProfile: true } });
  expect(user.academicProfile).toMatchObject({ gradeLevel: 10, schoolYear: "26-27" });
});
