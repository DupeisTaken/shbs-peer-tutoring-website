import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { currentPolicy } from "./policy-acceptance";
import { surveyInput } from "./student-survey";
import {
  studentSignupAnswersInput,
  inspectOwnedStudentSignup,
  editOwnedStudentSignup,
} from "./student-signup-editor";

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use shbs_shipping_test");
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.term.create({
    data: {
      id: "signup-edit-term",
      name: "Synthetic intake",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
      signupClosesAt: new Date(0),
    },
  });
  await db.subject.createMany({
    data: [
      { id: "math", name: "Mathematics" },
      { id: "science", name: "Science" },
      { id: "writing", name: "Writing" },
    ],
  });
  await db.timeSlot.createMany({
    data: [
      {
        id: "monday",
        label: "Monday",
        dayOfWeek: 1,
        startMin: 960,
        endMin: 1020,
      },
      {
        id: "tuesday",
        label: "Tuesday",
        dayOfWeek: 2,
        startMin: 960,
        endMin: 1020,
      },
    ],
  });
  await db.policyDocument.create({
    data: {
      slug: "tutee-policy",
      locale: "en",
      title: "Synthetic policy",
      body: "Original policy evidence.",
    },
  });
});
afterAll(async () => {
  await db.$disconnect();
});

async function fixture() {
  const policy = await currentPolicy(db, "tutee-policy");
  const payload = surveyInput.parse({
    englishName: "Original Request Name",
    email: "owner@example.test",
    preferredContact: "Original contact",
    firstChoiceId: "math",
    secondChoiceId: "science",
    slotIds: ["monday"],
    signatureName: "Original Signature",
    agreed: true,
    policyRevision: policy.revision,
  });
  const tutee = await db.tutee.create({
    data: {
      englishName: "Canonical Owner",
      email: payload.email,
      preferredContact: payload.preferredContact,
      firstChoiceId: "math",
      secondChoiceId: "science",
      intakeTermId: "signup-edit-term",
      signupSource: "SELF_SERVICE",
      availabilities: { create: { slotId: "monday" } },
    },
  });
  const user = await db.user.create({
    data: {
      id: "owner",
      email: payload.email,
      name: "Canonical Owner",
      username: "canonicalowner",
      emailVerifiedAt: new Date(),
      studentId: tutee.id,
      tuteeMember: true,
      gradeLevel: 10,
      passwordHash: "Unchanged synthetic credential",
    },
  });
  await db.studentProfileOwnership.create({
    data: { tuteeId: tutee.id, userId: user.id },
  });
  await db.policyAcceptance.create({
    data: {
      userId: user.id,
      slug: "tutee-policy",
      revision: policy.revision,
      snapshot: policy.documents,
      signature: "Original Signature",
    },
  });
  const row = await db.studentSurvey.create({
    data: {
      id: "request",
      email: payload.email,
      intakeTermId: "signup-edit-term",
      payload,
      policyRevision: policy.revision,
      policySnapshot: policy.documents,
      tuteeId: tutee.id,
      confirmedAt: new Date(),
      tokenHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 86400000),
      submittedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });
  return { user, tutee, row, payload };
}
const draft = (payload: unknown) => ({
  id: "request",
  expectedVersion: 0,
  clientKey: randomUUID(),
  answers: studentSignupAnswersInput.parse(payload),
});

it("saves after intake closes, retains original priority/evidence and leaves canonical identity/credentials untouched", async () => {
  const { user, tutee, row, payload } = await fixture();
  const input = draft({
    ...payload,
    englishName: "Corrected Request Name",
    preferredContact: "New contact",
    phone: "Synthetic phone",
    gradeLevel: "11",
    secondChoiceId: "",
    slotIds: ["tuesday"],
  });
  await expect(editOwnedStudentSignup(db, user.id, input)).resolves.toEqual({
    ok: true,
    version: 1,
  });
  const saved = await db.studentSurvey.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(saved).toMatchObject({
    payload: row.payload,
    policyRevision: row.policyRevision,
    policySnapshot: row.policySnapshot,
    submittedAt: row.submittedAt,
    currentVersion: 1,
  });
  expect(await db.user.findUnique({ where: { id: user.id } })).toEqual(user);
  expect(await db.tutee.findUnique({ where: { id: tutee.id } })).toMatchObject({
    englishName: "Canonical Owner",
    secondChoiceId: null,
    preferredContact: "New contact",
  });
  expect(await inspectOwnedStudentSignup(db, user.id, row.id)).toMatchObject({
    editable: true,
    version: 1,
    answers: { englishName: "Corrected Request Name" },
    originalSignature: "Original Signature",
  });
  expect(
    (await inspectOwnedStudentSignup(db, user.id, row.id)).answers
      .secondChoiceId,
  ).toBeUndefined();
});

it("rejects another account even when it knows the exact request id or shares submitted contact text", async () => {
  const { payload } = await fixture();
  await db.user.create({
    data: { id: "other", email: "other@example.test", name: "Other Owner" },
  });
  await expect(
    inspectOwnedStudentSignup(db, "other", "request"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    editOwnedStudentSignup(db, "other", draft(payload)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.studentSignupRevision.count()).toBe(0);
});

it("returns the exact lost-response receipt once and rejects changed-key reuse and a stale independent draft", async () => {
  const { payload } = await fixture();
  const input = draft({ ...payload, preferredContact: "First change" });
  await editOwnedStudentSignup(db, "owner", input);
  await expect(editOwnedStudentSignup(db, "owner", input)).resolves.toEqual({
    ok: true,
    version: 1,
  });
  await expect(
    editOwnedStudentSignup(db, "owner", {
      ...input,
      answers: { ...input.answers, preferredContact: "Changed retry" },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    editOwnedStudentSignup(db, "owner", draft(payload)),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.studentSignupRevision.count()).toBe(1);
});

it("keeps an invalid flag and its review version during an ordinary edit", async () => {
  const { payload } = await fixture();
  await db.studentSurvey.update({
    where: { id: "request" },
    data: {
      invalidatedAt: new Date(),
      invalidReason: "Staff-only note",
      invalidityVersion: 3,
    },
  });
  await editOwnedStudentSignup(
    db,
    "owner",
    draft({ ...payload, preferredContact: "Corrected contact" }),
  );
  expect(
    await db.studentSurvey.findUnique({ where: { id: "request" } }),
  ).toMatchObject({ invalidReason: "Staff-only note", invalidityVersion: 3 });
});

it("rejects terminal/historical and exactly overdue unverified edits under the request lock", async () => {
  const { payload } = await fixture();
  await db.studentSurvey.update({
    where: { id: "request" },
    data: { confirmedAt: null, verificationDueAt: new Date(0) },
  });
  expect(
    (await inspectOwnedStudentSignup(db, "owner", "request")).editable,
  ).toBe(false);
  await expect(
    editOwnedStudentSignup(db, "owner", draft(payload)),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await db.studentSurvey.update({
    where: { id: "request" },
    data: { confirmedAt: new Date(), verificationDueAt: null },
  });
  await db.term.update({
    where: { id: "signup-edit-term" },
    data: { active: false },
  });
  await expect(
    editOwnedStudentSignup(db, "owner", draft(payload)),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});

it("retains inactive assigned choices, permits other edits, rejects dropping them and fails closed on legacy unresolved labels", async () => {
  const { payload, tutee } = await fixture();
  const tutor = await db.tutor.create({
    data: { englishName: "Synthetic Tutor", status: "ACTIVE" },
  });
  await db.pairing.create({
    data: {
      id: "pair",
      tutorId: tutor.id,
      termId: "signup-edit-term",
      subject: "Mathematics",
      tutees: { create: { tuteeId: tutee.id } },
    },
  });
  await db.subject.update({ where: { id: "math" }, data: { active: false } });
  const input = draft({
    ...payload,
    preferredContact: "Changed contact",
    secondChoiceId: "writing",
  });
  await editOwnedStudentSignup(db, "owner", input);
  await expect(
    editOwnedStudentSignup(db, "owner", {
      ...draft(payload),
      expectedVersion: 1,
      answers: { ...input.answers, firstChoiceId: "science" },
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.pairing.update({
    where: { id: "pair" },
    data: { subject: "Unresolved legacy subject" },
  });
  expect(
    (await inspectOwnedStudentSignup(db, "owner", "request"))
      .assignmentsUnresolved,
  ).toBe(true);
  await expect(
    editOwnedStudentSignup(db, "owner", {
      ...input,
      clientKey: randomUUID(),
      expectedVersion: 1,
    }),
  ).resolves.toMatchObject({ version: 2 });
  expect(await db.pairingTutee.count()).toBe(1);
});
