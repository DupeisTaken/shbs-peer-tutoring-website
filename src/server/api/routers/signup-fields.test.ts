import type { Session } from "next-auth";
import { beforeEach, afterAll, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({ emailSender: { send: vi.fn() }, isEmailDeliveryAvailable: () => true }));
vi.mock("~/server/notifications/create", () => ({ notifyAdmins: vi.fn() }));
vi.mock("~/server/rate-limit", () => ({ rateLimit: () => ({ ok: true }) }));
import { db } from "~/server/db";
import { createCaller } from "../root";
import { currentPolicy } from "~/server/policy-acceptance";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { SIGNUP_FIELDS, type SignupFormKind, type FieldState } from "~/lib/signup-fields";

const caller = (role: Session["role"] | null = null) => createCaller({ db, headers: new Headers(), session: role ? {
  user: { id: `fields-${role}`, name: role, email: `${role}@example.test` }, role, tutorId: null, expires: "2099-01-01T00:00:00Z",
} : null });
const change = async (form: SignupFormKind, field: string, state: FieldState) => {
  const current = await caller("HEAD").program.signupFieldSettings();
  return caller("HEAD").program.setSignupField({ form, field, state, expectedState: current.fields[form][field]! });
};
const tutorInput = async () => ({ name: "Applicant", email: "applicant@example.test", preferredContact: "Email", agreed: true as const,
  policyRevision: (await currentPolicy(db, "tutor-policy")).revision, subjects: [{ subjectId: "fields-math" }],
});
const tuteeInput = async () => ({ englishName: "Student", email: "student@example.test", preferredContact: "Email", agreed: true as const,
  policyRevision: (await currentPolicy(db, "tutee-policy")).revision, firstChoiceId: "fields-math", signatureName: "Student", slotIds: ["fields-slot"],
});

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test") throw new Error("Use shbs_shipping_test");
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(t => '"' + t.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  for (const role of ["HEAD", "ADMIN", "COORDINATOR", "STUDENT", "TUTOR", "VIEWER", "CREW"] as const)
    await db.user.create({ data: { id: `fields-${role}`, name: role, email: `${role}@example.test`, role } });
  for (const slug of ["tutor-policy", "tutee-policy"]) await db.policyDocument.create({ data: { slug, locale: "en", title: "Policy", body: "Synthetic policy" } });
  await db.term.create({ data: { name: "Q1", schoolYear: "26-27", quarter: "Q1", active: true } });
  await db.subject.createMany({ data: [{ id: "fields-math", name: "Math" }, { id: "fields-science", name: "Science" }] });
  await db.timeSlot.create({ data: { id: "fields-slot", label: "Afternoon", dayOfWeek: 1, startMin: 900, endMin: 960 } });
  process.env.AUTH_URL = "http://localhost:3000";
});
afterAll(() => db.$disconnect());

it("restricts writes to Head, rejects essential/custom fields, and guards stale changes", async () => {
  const input = { form: "tutee" as const, field: "phone", state: "required" as const, expectedState: "optional" as const };
  for (const role of ["ADMIN", "COORDINATOR", "STUDENT", "TUTOR", "VIEWER", "CREW"] as const)
    await expect(caller(role).program.setSignupField(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(caller().program.setSignupField(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  for (const form of ["tutee", "tutor"] as const) for (const field of [...SIGNUP_FIELDS[form].filter(f => f.locked).map(f => f.key), "custom"])
    await expect(caller("HEAD").program.setSignupField({ ...input, form, field })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect((await caller("ADMIN").program.signupFieldSettings()).canEdit).toBe(false);
  await caller("HEAD").program.setSignupField(input);
  await expect(caller("HEAD").program.setSignupField({ ...input, state: "hidden" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.auditLog.count({ where: { operation: "program.setSignupField" } })).toBe(1);
});

it("enforces current tutee requirements, strips hidden answers, and preserves earlier submissions", async () => {
  const input = await tuteeInput();
  await caller().tutee.submitSurvey(input);
  const original = await db.studentSurvey.findFirstOrThrow();
  await change("tutee", "phone", "required");
  await expect(caller().tutee.submitSurvey({ ...input, email: "new@example.test" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await change("tutee", "phone", "hidden");
  await change("tutee", "preferredContact", "hidden");
  await change("tutee", "availability", "hidden");
  await change("tutee", "signatureName", "optional");
  await change("tutee", "secondSubject", "required");
  await expect(caller().tutee.submitSurvey({ ...input, email: "new@example.test" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await caller().tutee.submitSurvey({ ...input, email: "new@example.test", preferredContact: "discard", slotIds: ["invalid-hidden-slot"], phone: "discard", secondChoiceId: "fields-science", signatureName: "" });
  const saved = await db.studentSurvey.findFirstOrThrow({ where: { email: "new@example.test" } });
  expect(saved.payload).toMatchObject({ preferredContact: "", slotIds: [], signatureName: "", secondChoiceId: "fields-science" });
  expect(saved.payload).not.toHaveProperty("phone");
  expect((await db.studentSurvey.findUniqueOrThrow({ where: { id: original.id } })).payload).toEqual(original.payload);
  for (const invalid of [{ agreed: false }, { englishName: "" }, { email: "" }, { firstChoiceId: "" }])
    // Deliberately simulate forged clients, bypassing compile-time literal checks.
    await expect(caller().tutee.submitSurvey({ ...input, ...invalid } as typeof input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("enforces tutor consent and positional additional subjects while preserving historical evidence", async () => {
  const input = await tutorInput();
  for (const invalid of [{ agreed: false }, { name: "" }, { email: "" }, { subjects: [{ subjectId: "" }] }])
    await expect(caller().application.submit({ ...input, ...invalid } as typeof input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(caller().application.submit({ ...input, policyRevision: "stale" })).rejects.toMatchObject({ code: "CONFLICT" });
  await caller().application.submit(input);
  const original = await db.tutorApplication.findFirstOrThrow();
  expect(original.policySnapshot).toEqual((await currentPolicy(db, "tutor-policy")).documents);
  expect(original.policyAcceptedAt).toBeInstanceOf(Date);
  await change("tutor", "preferredContact", "hidden");
  await change("tutor", "secondSubject", "hidden");
  await change("tutor", "thirdSubject", "required");
  await expect(caller().application.submit(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await caller().application.submit({ ...input, email: "new@example.test", preferredContact: "", subjects: [{ subjectId: "fields-math" }, { subjectId: "invalid-hidden-subject" }, { subjectId: "fields-science" }] });
  const saved = await db.tutorApplication.findFirstOrThrow({ where: { email: "new@example.test" }, include: { subjectIntents: true } });
  expect(saved.preferredContact).toBeNull();
  expect(saved.subjectIntents.map(row => row.subjectId).sort()).toEqual(["fields-math", "fields-science"]);
  expect(await db.tutorApplication.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
  expect(await db.policyAcceptance.count()).toBe(0);
});

it("requires explicit yes/no answers and only applicable qualification details", async () => {
  const input = await tutorInput();
  await change("tutor", "taken", "required");
  await change("tutor", "grade", "required");
  await change("tutor", "apScore", "required");
  await expect(caller().application.submit(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await caller().application.submit({ ...input, subjects: [{ subjectId: "fields-math", taken: false }] });
  await expect(caller().application.submit({ ...input, subjects: [{ subjectId: "fields-math", taken: true }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await change("tutor", "taken", "hidden");
  await caller().application.submit({ ...input, subjects: [{ subjectId: "fields-math", taken: true, grade: "discard" }] });
  expect(await db.applicationSubjectIntent.findMany()).toEqual(expect.arrayContaining([expect.objectContaining({ taken: false, grade: null })]));
});

it("requires AP details only for AP subjects and keeps primary signup independent of secondary-email binding", async () => {
  const input = await tutorInput();
  const level = await db.subjectLevel.create({ data: { name: "AP", apScored: true } });
  await db.subject.update({ where: { id: "fields-science" }, data: { levelId: level.id } });
  await change("tutor", "hasApScore", "required");
  await change("tutor", "apScore", "required");
  await db.programSettings.update({ where: { id: "program" }, data: { secondaryEmailBindingEnabled: false } });
  expect((await caller("HEAD").program.signupFieldSettings()).secondaryEmailBindingEnabled).toBe(false);
  await caller().application.submit(input);
  await expect(caller().application.submit({ ...input, subjects: [{ subjectId: "fields-science" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await caller().application.submit({ ...input, subjects: [{ subjectId: "fields-science", hasApScore: false }] });
  await expect(caller().application.submit({ ...input, subjects: [{ subjectId: "fields-science", hasApScore: true }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await caller().application.submit({ ...input, subjects: [{ subjectId: "fields-science", hasApScore: true, apScore: "5" }] });
  await caller().tutee.submitSurvey(await tuteeInput());
  expect(await db.studentSurvey.count()).toBe(1);
});
