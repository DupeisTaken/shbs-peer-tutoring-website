import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn().mockResolvedValue(undefined) },
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { createCaller } from "./api/root";
import { ApprovalQueued } from "./approvals";
import { currentPolicy } from "./policy-acceptance";
import { surveyInput } from "./student-survey";
import { studentSignupAnswersInput, editOwnedStudentSignup } from "./student-signup-editor";
import { unassignStudentSignup } from "./student-signup-management";
import { assignStudentRequest, prepareStudentAction } from "./student-workflow";
import * as transactions from "./transactions";

const termId = "head-guards-term";
const actor = (id: string, role: Session["role"]) => createCaller({
  db, headers: new Headers(), session: {
    user: { id, name: id, email: `${id}@example.test` }, role, tutorId: null,
    expires: "2099-01-01T00:00:00Z",
  },
});
const head = () => actor("head", "HEAD");
const admin = () => actor("admin", "ADMIN");
const coordinator = () => actor("coordinator", "COORDINATOR");

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) =>
    '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.createMany({ data: [
    { id: "head", email: "head@example.test", name: "Head", role: "HEAD" },
    { id: "admin", email: "admin@example.test", name: "Admin", role: "ADMIN" },
    { id: "coordinator", email: "coordinator@example.test", name: "Coordinator", role: "COORDINATOR" },
  ] });
  await db.term.createMany({ data: [
    { id: termId, name: "Current", schoolYear: "26-27", quarter: "Q1", active: true, signupClosesAt: new Date(0) },
    { id: "historical-term", name: "History", schoolYear: "25-26", quarter: "Q4", active: false },
  ] });
  await db.subject.createMany({ data: [
    { id: "math", name: "Mathematics" }, { id: "science", name: "Science" }, { id: "writing", name: "Writing" },
  ] });
  await db.timeSlot.create({ data: { id: "monday", label: "Monday", dayOfWeek: 1, startMin: 960, endMin: 1020 } });
  await db.policyDocument.create({ data: { slug: "tutee-policy", locale: "en", title: "Policy", body: "Original signed policy" } });
});
afterAll(() => db.$disconnect());

async function fixture(options: { attendance?: boolean; secondAssignment?: boolean } = {}) {
  const policy = await currentPolicy(db, "tutee-policy");
  const payload = surveyInput.parse({
    englishName: "Request Name", email: "owner@example.test", preferredContact: "Original contact",
    firstChoiceId: "math", secondChoiceId: "science", slotIds: ["monday"],
    signatureName: "Original Signature", agreed: true, policyRevision: policy.revision,
  });
  const tutor = await db.tutor.create({ data: { id: "tutor", englishName: "Synthetic Tutor", status: "ACTIVE" } });
  for (const subjectId of ["math", "science", "writing"])
    await db.tutorQualification.create({ data: {
      tutorId: tutor.id, subjectId, status: "APPROVED", approvedById: "head",
      grants: { create: { subjectId } },
    } });
  const tutee = await db.tutee.create({ data: {
    id: "tutee", englishName: "Canonical Owner", email: payload.email,
    preferredContact: payload.preferredContact, firstChoiceId: "math", secondChoiceId: "science",
    intakeTermId: termId, signupSource: "SELF_SERVICE", status: "ACTIVE",
    availabilities: { create: { slotId: "monday" } },
  } });
  const user = await db.user.create({ data: {
    id: "owner", email: payload.email, name: "Canonical Owner", username: "canonicalowner",
    role: "STUDENT", studentId: tutee.id, tuteeMember: true, emailVerifiedAt: new Date(),
    passwordHash: "Unchanged synthetic credential", twoFactorEnabled: true,
  } });
  await db.studentProfileOwnership.create({ data: { tuteeId: tutee.id, userId: user.id } });
  await db.policyAcceptance.create({ data: { userId: user.id, slug: "tutee-policy", revision: policy.revision, snapshot: policy.documents, signature: "Original Signature" } });
  const survey = await db.studentSurvey.create({ data: {
    id: "request", email: payload.email, intakeTermId: termId, payload,
    policyRevision: policy.revision, policySnapshot: policy.documents,
    tuteeId: tutee.id, confirmedAt: new Date(), tokenHash: "b".repeat(64),
    expiresAt: new Date(Date.now() + 86400000), submittedAt: new Date("2026-10-01T00:00:00Z"),
  } });
  const pairing = await db.pairing.create({ data: {
    id: "current-math", tutorId: tutor.id, termId, subject: "Mathematics", timeSlotId: "monday",
    dayOfWeek: 1, startMin: 960, endMin: 1020,
    tutees: { create: { tuteeId: tutee.id } },
  } });
  const history = await db.pairing.create({ data: {
    id: "historical-math", tutorId: tutor.id, termId: "historical-term", subject: "Mathematics",
    dayOfWeek: 1, startMin: 960, endMin: 1020,
    tutees: { create: { tuteeId: tutee.id } },
  } });
  const second = options.secondAssignment ? await db.pairing.create({ data: {
    id: "current-science", tutorId: tutor.id, termId, subject: "Science",
    dayOfWeek: 1, startMin: 960, endMin: 1020,
    tutees: { create: { tuteeId: tutee.id } },
  } }) : null;
  const session = options.attendance === false ? null : await db.session.create({ data: {
    id: "recorded-session", pairingId: pairing.id, tutorId: tutor.id,
    date: new Date("2026-10-02T00:00:00Z"), startMin: 960, endMin: 1020,
    month: "2026-10", schoolYear: "26-27", quarter: "Q1", durationMin: 60, shFactor: 1, shCount: 1,
    tutees: { create: { tuteeId: tutee.id } },
  } });
  return { user, tutor, tutee, survey, payload, pairing, history, second, session };
}

async function readyTicket(userId: string, action: "SIGNUP_EDIT" | "SIGNUP_UNASSIGN" | "ASSIGN", target: string) {
  const prepared = await prepareStudentAction(db, userId, action, target);
  // Model elapsed countdown on the actual purpose-bound ticket without waiting or fake clocks.
  await db.studentActionConfirmation.update({ where: { id: prepared.id }, data: { readyAt: new Date(0) } });
  return prepared.id;
}
async function queued(work: () => Promise<unknown>) {
  try { await work(); } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(ApprovalQueued);
    return db.approvalRequest.findUniqueOrThrow({ where: { id: (cause as ApprovalQueued).approvalId } });
  }
  throw new Error("Expected a reviewed proposal, never a live non-Head removal");
}

const operations = ["updatePairing", "deletePairing", "setTuteeStatus", "updateTutee"] as const;
type Operation = (typeof operations)[number];
function genericChange(caller: ReturnType<typeof head>, operation: Operation, data: Awaited<ReturnType<typeof fixture>>) {
  if (operation === "updatePairing") return caller.admin.updatePairing({
    id: data.pairing.id, tutorId: data.tutor.id, timeSlotId: "monday", subject: "Mathematics", tuteeIds: [],
  });
  if (operation === "deletePairing") return caller.admin.deletePairing({ id: data.pairing.id });
  if (operation === "setTuteeStatus") return caller.admin.setTuteeStatus({
    id: data.tutee.id, status: "INACTIVE", expectedUpdatedAt: data.tutee.updatedAt,
  });
  return caller.admin.updateTutee({
    id: data.tutee.id, englishName: data.tutee.englishName, status: "ACTIVE",
    firstChoiceId: "writing", secondChoiceId: "math", expectedUpdatedAt: data.tutee.updatedAt,
  });
}

it.each(operations)("fences generic %s: Admin/Coordinator proposals do not remove assigned demand and only Head can apply", async (operation) => {
  const data = await fixture({ attendance: false });
  const beforeLinks = await db.pairingTutee.findMany({ orderBy: { pairingId: "asc" } });
  const administratorProposal = await queued(() => genericChange(admin(), operation, data));
  const proposal = await queued(() => genericChange(coordinator(), operation, data));
  expect(proposal.operation).toBe(`admin.${operation}`);
  expect(await db.pairingTutee.findMany({ orderBy: { pairingId: "asc" } })).toEqual(beforeLinks);
  expect(await db.tutee.findUniqueOrThrow({ where: { id: data.tutee.id } })).toEqual(data.tutee);
  await expect(admin().approval.decide({ id: proposal.id, approve: true, note: "Attempted non-Head review" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } })).state).toBe("PENDING");
  await head().approval.decide({ id: proposal.id, approve: true, note: "Head explicitly reviewed affected assignment" });
  expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } })).state).toBe("APPROVED");
  expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: administratorProposal.id } })).state).toBe("PENDING");
  expect(await db.pairingTutee.findUnique({ where: { pairingId_tuteeId: { pairingId: data.history.id, tuteeId: data.tutee.id } } })).not.toBeNull();
  if (operation === "updateTutee") {
    expect(await db.tutee.findUniqueOrThrow({ where: { id: data.tutee.id } })).toMatchObject({ firstChoiceId: "writing", secondChoiceId: "math" });
    expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: data.survey.id } })).toMatchObject({
      currentVersion: 1, currentPayload: { firstChoiceId: "writing", secondChoiceId: "math" },
      payload: data.survey.payload, submittedAt: data.survey.submittedAt,
    });
  }
  else expect(await db.pairingTutee.findUnique({ where: { pairingId_tuteeId: { pairingId: data.pairing.id, tuteeId: data.tutee.id } } })).toBeNull();
  expect(await db.auditLog.findFirst({ where: { approvalId: proposal.id, kind: "DECISION" } })).toMatchObject({ userId: "head" });
});

it("refuses generic Head roster edits which would omit an assigned choice and directs its explicit assignment-release editor", async () => {
  const data = await fixture();
  const input = {
    id: data.tutee.id, englishName: data.tutee.englishName, status: "ACTIVE" as const,
    firstChoiceId: "writing", secondChoiceId: "science", expectedUpdatedAt: data.tutee.updatedAt,
  };
  await expect(head().admin.updateTutee(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const proposal = await queued(() => coordinator().admin.updateTutee(input));
  await expect(head().approval.decide({ id: proposal.id, approve: true, note: "Must use explicit release editor" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } })).state).toBe("PENDING");
  expect(await db.tutee.findUniqueOrThrow({ where: { id: data.tutee.id } })).toEqual(data.tutee);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: data.survey.id } })).toEqual(data.survey);
  expect(await db.pairingTutee.count({ where: { pairingId: data.pairing.id } })).toBe(1);
  expect(await db.studentSignupRevision.count()).toBe(0);
});

it("rejects generic pairing courses outside the current request, keeps owner contact editing usable, and permits a requested course", async () => {
  const data = await fixture({ attendance: false });
  const input = {
    id: data.pairing.id, tutorId: data.tutor.id, timeSlotId: "monday",
    subject: "Writing", tuteeIds: [data.tutee.id],
  };
  await expect(head().admin.updatePairing(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.pairing.findUniqueOrThrow({ where: { id: data.pairing.id } })).toEqual(data.pairing);
  await expect(actor("owner", "STUDENT").studentWorkflow.editSignup({
    id: data.survey.id, expectedVersion: 0, clientKey: randomUUID(),
    answers: studentSignupAnswersInput.parse({ ...data.payload, preferredContact: "Owner still can correct contact" }),
  })).resolves.toEqual({ ok: true, version: 1 });
  await head().admin.updatePairing({ ...input, subject: "Science" });
  expect(await db.pairing.findUniqueOrThrow({ where: { id: data.pairing.id } })).toMatchObject({ subject: "Science" });
  expect(await db.pairing.findUniqueOrThrow({ where: { id: data.history.id } })).toEqual(data.history);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: data.survey.id } })).toMatchObject({
    payload: data.survey.payload, submittedAt: data.survey.submittedAt,
    currentPayload: { preferredContact: "Owner still can correct contact", firstChoiceId: "math", secondChoiceId: "science" },
  });
});

it.each(["ADMIN", "COORDINATOR"] as const)("blocks %s from applying dedicated Head edits/unassignment even with a valid personal countdown", async (role) => {
  const data = await fixture();
  const userId = role === "ADMIN" ? "admin" : "coordinator";
  const edit = { id: data.survey.id, expectedVersion: 0, clientKey: randomUUID(), answers: studentSignupAnswersInput.parse({ ...data.payload, firstChoiceId: "writing" }) };
  await expect(editOwnedStudentSignup(db, userId, edit, {
    signedTicket: await readyTicket(userId, "SIGNUP_EDIT", data.survey.id), releaseChangedAssignments: true,
  })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(unassignStudentSignup(db, userId, {
    id: data.survey.id, pairingId: data.pairing.id, expectedVersion: 0, clientKey: randomUUID(),
    signedTicket: await readyTicket(userId, "SIGNUP_UNASSIGN", `${data.survey.id}:${data.pairing.id}`),
  })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.studentSignupRevision.count()).toBe(0);
  expect(await db.pairingTutee.count({ where: { pairingId: data.pairing.id } })).toBe(1);
});

it("Head assigned-choice edit releases only affected current links and preserves unrelated/historical assignments, sessions and credentials", async () => {
  const data = await fixture({ secondAssignment: true });
  const attendance = await db.sessionTutee.findMany();
  const ticket = await readyTicket("head", "SIGNUP_EDIT", data.survey.id);
  const input = {
    id: data.survey.id, expectedVersion: 0, clientKey: randomUUID(), signedTicket: ticket,
    releaseChangedAssignments: true as const,
    answers: studentSignupAnswersInput.parse({ ...data.payload, firstChoiceId: "writing", preferredContact: "Corrected by Head" }),
  };
  await expect(head().studentWorkflow.headEditSignup(input)).resolves.toEqual({ ok: true, version: 1 });
  expect(await db.pairingTutee.findUnique({ where: { pairingId_tuteeId: { pairingId: data.pairing.id, tuteeId: data.tutee.id } } })).toBeNull();
  for (const pairingId of [data.history.id, data.second!.id]) expect(await db.pairingTutee.count({ where: { pairingId, tuteeId: data.tutee.id } })).toBe(1);
  // Removing the one affected roster link deliberately invalidates its room
  // editor snapshot. Every other pairing column and unrelated record stays exact.
  const releasedPairing = { ...data.pairing, roomVersion: data.pairing.roomVersion + 1 };
  expect(await db.pairing.findUniqueOrThrow({ where: { id: data.pairing.id } })).toEqual(releasedPairing);
  for (const unrelated of [data.history, data.second!])
    expect(await db.pairing.findUniqueOrThrow({ where: { id: unrelated.id } })).toEqual(unrelated);
  expect(await db.session.findUniqueOrThrow({ where: { id: data.session!.id } })).toEqual(data.session);
  expect(await db.sessionTutee.findMany()).toEqual(attendance);
  expect(await db.user.findUniqueOrThrow({ where: { id: data.user.id } })).toEqual(data.user);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: data.survey.id } })).toMatchObject({
    payload: data.survey.payload, policyRevision: data.survey.policyRevision, policySnapshot: data.survey.policySnapshot,
    submittedAt: data.survey.submittedAt, currentVersion: 1,
    currentPayload: { firstChoiceId: "writing", secondChoiceId: "science" },
  });
  await expect(head().studentWorkflow.headEditSignup(input)).resolves.toEqual({ ok: true, version: 1 });
  expect(await db.studentSignupRevision.count()).toBe(1);
  expect(await db.pairing.findUniqueOrThrow({ where: { id: data.pairing.id } })).toEqual(releasedPairing);
  const freshTicket = await readyTicket("head", "SIGNUP_EDIT", data.survey.id);
  await expect(head().studentWorkflow.headEditSignup({ ...input, signedTicket: freshTicket })).resolves.toEqual({ ok: true, version: 1 });
  expect((await db.studentActionConfirmation.findUniqueOrThrow({ where: { id: freshTicket } })).usedAt).toBeNull();
  expect(await db.studentSignupRevision.count()).toBe(1);
  expect(await db.pairing.findUniqueOrThrow({ where: { id: data.pairing.id } })).toEqual(releasedPairing);
});

it("requires elapsed, actor/purpose/target-bound Head confirmation before assigned-choice release", async () => {
  const data = await fixture();
  const prepared = await prepareStudentAction(db, "head", "SIGNUP_EDIT", data.survey.id);
  const input = { id: data.survey.id, expectedVersion: 0, clientKey: randomUUID(), answers: studentSignupAnswersInput.parse({ ...data.payload, firstChoiceId: "writing" }) };
  await expect(editOwnedStudentSignup(db, "head", input, { signedTicket: prepared.id, releaseChangedAssignments: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const wrong = await readyTicket("head", "SIGNUP_UNASSIGN", `${data.survey.id}:${data.pairing.id}`);
  await expect(editOwnedStudentSignup(db, "head", input, { signedTicket: wrong, releaseChangedAssignments: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.studentSignupRevision.count()).toBe(0);
  expect(await db.pairingTutee.count({ where: { pairingId: data.pairing.id } })).toBe(1);
});

it("Head unassign returns an exact receipt, rejects changed-key reuse/stale drafts and preserves attendance/history", async () => {
  const data = await fixture();
  const attendance = await db.sessionTutee.findMany();
  const input = {
    id: data.survey.id, pairingId: data.pairing.id, expectedVersion: 0, clientKey: randomUUID(),
    signedTicket: await readyTicket("head", "SIGNUP_UNASSIGN", `${data.survey.id}:${data.pairing.id}`),
  };
  await expect(head().studentWorkflow.headUnassign(input)).resolves.toEqual({ ok: true, version: 1 });
  await expect(head().studentWorkflow.headUnassign(input)).resolves.toEqual({ ok: true, version: 1 });
  await expect(head().studentWorkflow.headUnassign({ ...input, pairingId: data.history.id })).rejects.toMatchObject({ code: "CONFLICT", message: "SIGNUP_RETRY_CHANGED" });
  await expect(head().studentWorkflow.headUnassign({ ...input, clientKey: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.studentSignupRevision.count()).toBe(1);
  expect(await db.tutee.findUniqueOrThrow({ where: { id: data.tutee.id } })).toMatchObject({ status: "PENDING" });
  expect(await db.pairingTutee.count({ where: { pairingId: data.history.id, tuteeId: data.tutee.id } })).toBe(1);
  expect(await db.session.findUniqueOrThrow({ where: { id: data.session!.id } })).toEqual(data.session);
  expect(await db.sessionTutee.findMany()).toEqual(attendance);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: data.survey.id } })).toMatchObject({ submittedAt: data.survey.submittedAt, payload: data.survey.payload });
});

it("rechecks Head's current authority rather than trusting an old session or an unused ticket", async () => {
  const data = await fixture();
  const signedTicket = await readyTicket("head", "SIGNUP_UNASSIGN", `${data.survey.id}:${data.pairing.id}`);
  await db.user.update({ where: { id: "head" }, data: { role: "ADMIN" } });
  await expect(unassignStudentSignup(db, "head", { id: data.survey.id, pairingId: data.pairing.id, expectedVersion: 0, clientKey: randomUUID(), signedTicket })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.pairingTutee.count({ where: { pairingId: data.pairing.id } })).toBe(1);
  expect(await db.studentSignupRevision.count()).toBe(0);
});

it("allows ordinary owner edits of unassigned choices while retaining assigned choices and current priority after signup closes", async () => {
  const data = await fixture();
  const input = { id: data.survey.id, expectedVersion: 0, clientKey: randomUUID(), answers: studentSignupAnswersInput.parse({ ...data.payload, secondChoiceId: "writing", phone: "New contact phone" }) };
  await expect(actor("owner", "STUDENT").studentWorkflow.editSignup(input)).resolves.toEqual({ ok: true, version: 1 });
  expect(await db.pairingTutee.count({ where: { pairingId: data.pairing.id } })).toBe(1);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: data.survey.id } })).toMatchObject({ submittedAt: data.survey.submittedAt, currentPayload: { firstChoiceId: "math", secondChoiceId: "writing" } });
});

it("rechecks an assignment committed while an owner's captured draft waits for the program/catalogue/source fence", async () => {
  const data = await fixture();
  const ticket = await readyTicket("head", "ASSIGN", data.survey.id);
  let release!: () => void;
  let staged!: () => void;
  const stagedSignal = new Promise<void>((resolve) => { staged = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const assigning = db.$transaction(async (tx) => {
    await assignStudentRequest(tx, data.survey.id, "head", ticket, "science", data.tutor.id);
    staged();
    await gate;
  }, { timeout: 15000 });
  await Promise.race([stagedSignal, assigning]);
  let attempted!: () => void;
  const attemptedSignal = new Promise<void>((resolve) => { attempted = resolve; });
  const originalLock = transactions.lockEntity;
  const spy = vi.spyOn(transactions, "lockEntity").mockImplementation(async (tx, key) => {
    if (key === "program:period") attempted();
    await originalLock(tx, key);
  });
  const editing = editOwnedStudentSignup(db, data.user.id, {
    id: data.survey.id, expectedVersion: 0, clientKey: randomUUID(),
    answers: studentSignupAnswersInput.parse({ ...data.payload, secondChoiceId: "writing" }),
  });
  try {
    await attemptedSignal;
    release();
    await assigning;
    await expect(editing).rejects.toMatchObject({ code: "FORBIDDEN", message: "SIGNUP_ASSIGNED_SUBJECT_LOCKED" });
    expect(await db.pairingTutee.count({ where: { tuteeId: data.tutee.id, pairing: { termId } } })).toBe(2);
    expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: data.survey.id } })).toMatchObject({ currentVersion: 0, payload: data.survey.payload });
    expect(await db.studentSignupRevision.count()).toBe(0);
  } finally {
    release();
    spy.mockRestore();
  }
});
