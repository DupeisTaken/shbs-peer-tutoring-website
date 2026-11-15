import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn().mockResolvedValue(undefined) },
  isEmailDeliveryAvailable: () => false,
}));
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { hashPassword } from "~/server/auth/password";
import { currentPolicy } from "~/server/policy-acceptance";
import { surveyInput } from "~/lib/student-signup";
import { studentSignupAnswersInput } from "~/server/student-signup-editor";
import { recordStudentRequestExecution } from "~/server/student-request-execution";
import { createCaller } from "../root";

const password = "Synthetic-transfer-review-738!";
const passwordHash = hashPassword(password);
const submittedAt = new Date("2026-09-01T00:00:00Z");
const termId = "signup-transfer-term";

async function caller(id = "head") {
  const user = await db.user.findUniqueOrThrow({ where: { id } });
  return createCaller({
    db, headers: new Headers(), session: {
      user: { id: user.id, name: user.name, email: user.email },
      role: user.role, tutorId: user.tutorId,
      historyAccessRevision: user.historyAccessRevision,
      expires: "2099-01-01T00:00:00Z",
    },
  });
}
type Caller = Awaited<ReturnType<typeof caller>>;

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) =>
    '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  // Only Date is controlled: real database I/O and transaction timers keep running.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T08:00:00Z"));
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

async function ready(actor: Caller, action: "ASSIGN" | "SIGNUP_EDIT" | "SIGNUP_UNASSIGN", target: string) {
  const ticket = await actor.studentWorkflow.prepareAction({ action, target });
  // Advance the test clock past the genuine actor/purpose/target-bound countdown.
  // No fabricated ticket or direct confirmation-row update bypasses admission.
  vi.setSystemTime(new Date(ticket.readyAt.getTime() + 1));
  return ticket.id;
}

async function assign(actor: Caller, surveyId: string, subjectId: string) {
  await actor.studentWorkflow.assign({
    id: surveyId, subjectId, tutorId: "tutor",
    ticket: await ready(actor, "ASSIGN", surveyId),
  });
  return currentAssignment(surveyId, subjectId === "math" ? "Mathematics" : subjectId === "science" ? "Science" : "English");
}

async function currentAssignment(surveyId: string, subject: string) {
  const mappings = await db.studentRequestExecutionAssignment.findMany({ where: { surveyId, releasedAt: null } });
  const pairing = await db.pairing.findFirstOrThrow({ where: { id: { in: mappings.map(({ pairingId }) => pairingId) }, subject } });
  return db.studentRequestExecutionAssignment.findUniqueOrThrow({ where: { surveyId_pairingId: { surveyId, pairingId: pairing.id } } });
}

async function fixture() {
  // These are explicit seed prerequisites. Assignment, preview, transfer and the
  // post-transfer assignment below all use real appRouter procedures.
  await db.person.create({ data: { id: "person" } });
  await db.user.createMany({ data: ["head", "admin"].map((id) => ({
    id, email: `${id}@example.test`, name: id, role: id === "head" ? "HEAD" as const : "ADMIN" as const, passwordHash,
  })) });
  await db.term.create({ data: { id: termId, name: "Current synthetic period", schoolYear: "26-27", quarter: "Q1", active: true, signupClosesAt: new Date(0) } });
  await db.subject.createMany({ data: [
    { id: "math", name: "Mathematics" }, { id: "science", name: "Science" }, { id: "english", name: "English" },
  ] });
  await db.timeSlot.create({ data: { id: "monday", label: "Monday", dayOfWeek: 1, startMin: 930, endMin: 990 } });
  await db.policyDocument.create({ data: { slug: "tutee-policy", locale: "en", title: "Synthetic policy", body: "Original consent evidence" } });
  const policy = await currentPolicy(db, "tutee-policy");
  await db.tutor.create({ data: { id: "tutor", englishName: "Synthetic Tutor", status: "ACTIVE" } });
  for (const subjectId of ["math", "science", "english"])
    await db.tutorQualification.create({ data: {
      tutorId: "tutor", subjectId, status: "APPROVED", approvedById: "head", grants: { create: { subjectId } },
    } });
  for (const suffix of ["a", "c"]) {
    const payload = surveyInput.parse({
      firstName: "Synthetic", lastName: suffix.toUpperCase(), englishName: `Synthetic ${suffix.toUpperCase()}`,
      email: `${suffix}@example.test`, preferredContact: `Original ${suffix} contact`, phone: "Synthetic phone", gradeLevel: "10",
      firstChoiceId: suffix === "a" ? "math" : "english", secondChoiceId: suffix === "a" ? "science" : undefined,
      slotIds: ["monday"], signatureName: `Original ${suffix} signature`, agreed: true, policyRevision: policy.revision,
    });
    await db.tutee.create({ data: {
      id: `tutee-${suffix}`, personId: "person", englishName: payload.englishName,
      firstName: payload.firstName, lastName: payload.lastName, email: payload.email,
      preferredContact: payload.preferredContact, firstChoiceId: payload.firstChoiceId, secondChoiceId: payload.secondChoiceId,
      intakeTermId: termId, signupSource: "SELF_SERVICE", status: "PENDING", gradeLevel: "10",
      availabilities: { create: { slotId: "monday" } },
    } });
    await db.user.create({ data: {
      id: `owner-${suffix}`, personId: "person", name: payload.englishName,
      firstName: payload.firstName, lastName: payload.lastName, email: payload.email, username: `synthetic${suffix}`,
      role: "STUDENT", studentId: `tutee-${suffix}`, tuteeMember: true, emailVerifiedAt: submittedAt, passwordHash,
    } });
    await db.studentProfileOwnership.create({ data: { tuteeId: `tutee-${suffix}`, userId: `owner-${suffix}` } });
    await db.policyAcceptance.create({ data: { userId: `owner-${suffix}`, slug: "tutee-policy", revision: policy.revision, snapshot: policy.documents, signature: payload.signatureName, acceptedAt: submittedAt } });
    await db.studentSurvey.create({ data: {
      id: `request-${suffix}`, tuteeId: `tutee-${suffix}`, email: payload.email, intakeTermId: termId,
      payload, policyRevision: policy.revision, policySnapshot: policy.documents,
      tokenHash: suffix.repeat(64), confirmedAt: submittedAt,
      submittedAt: new Date(submittedAt.getTime() + (suffix === "c" ? 60_000 : 0)), expiresAt: new Date("2099-01-01T00:00:00Z"),
      // At version zero currentPayload is SQL NULL, supplied by its database default.
    } });
  }
  const head = await caller();
  const originalMath = await assign(head, "request-a", "math");
  await assign(head, "request-c", "english");
  expect(await db.tutee.count({ where: { id: { in: ["tutee-a", "tutee-c"] }, status: "ACTIVE" } })).toBe(2);
  const attendance = await db.session.create({ data: {
    id: "completed-math", pairingId: originalMath.pairingId, tutorId: "tutor", date: submittedAt,
    startMin: 930, endMin: 990, durationMin: 60, shFactor: 1, shCount: 1, month: "2026-09", schoolYear: "26-27", quarter: "Q1",
    tutees: { create: { tuteeId: "tutee-a" } },
  } });
  const selection = { personId: "person", retainedUserId: "owner-c", activeTutorId: null, activeTuteeId: "tutee-c", tutorIds: [], tuteeIds: ["tutee-a", "tutee-c"], acknowledgeHistoryAccessCorrection: true };
  const preview = await head.personCombine.participationPreview(selection);
  expect(preview.canTransfer).toBe(true);
  await head.personCombine.participationTransfer({
    ...selection, fingerprint: preview.fingerprint, operationId: randomUUID(),
    reason: "Reviewed exact synthetic request sources and retained execution", acknowledged: true, confirmPassword: password,
  });
  const science = await assign(head, "request-a", "science");
  expect(science).toMatchObject({ sourceTuteeId: "tutee-a", tuteeId: "tutee-c", releasedAt: null });
  expect(await db.pairingTutee.findUnique({ where: { pairingId_tuteeId: { pairingId: science.pairingId, tuteeId: "tutee-c" } } })).not.toBeNull();
  const math = await currentAssignment("request-a", "Mathematics");
  // Transfer invalidates prior history-access sessions. Use the persisted revision.
  return { head, owner: await caller("owner-c"), science, math, originalMath, attendance };
}

function edit(id: string, expectedVersion: number, payload: unknown) {
  return { id, expectedVersion, clientKey: randomUUID(), answers: studentSignupAnswersInput.parse(payload) };
}

async function domainSnapshot() {
  // Include every domain/recovery/ticket table so rejection cannot hide a partial
  // effect. The separately durable failed AuditLog attempt remains expected evidence.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations', 'AuditLog') ORDER BY tablename
  `;
  return db.$queryRawUnsafe(tables.map(({ tablename }) => {
    const identifier = '"' + tablename.replaceAll('"', '""') + '"';
    const label = "'" + tablename.replaceAll("'", "''") + "'";
    return `SELECT ${label} AS "table", COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows FROM ${identifier} t`;
  }).join(" UNION ALL ") + ' ORDER BY "table"');
}

it("locks each original request after public transfer and rejects dropping its later canonical assignment without domain changes", async () => {
  const f = await fixture();
  const a = await f.owner.studentWorkflow.signup({ id: "request-a" });
  const c = await f.owner.studentWorkflow.signup({ id: "request-c" });
  expect(a.assignedSubjectIds.sort()).toEqual(["math", "science"]);
  expect(c.assignedSubjectIds).toEqual(["english"]);
  expect((await f.head.studentWorkflow.managedSignup({ id: a.id })).assignedSubjectIds.sort()).toEqual(["math", "science"]);
  expect((await f.head.studentWorkflow.managedSignup({ id: c.id })).assignedSubjectIds).toEqual(["english"]);
  const before = await domainSnapshot();
  const attempts = await db.auditLog.count({ where: { kind: "ATTEMPT" } });
  await expect(f.owner.studentWorkflow.editSignup(edit(a.id, a.version, { ...a.answers, secondChoiceId: "english" })))
    .rejects.toMatchObject({ code: "FORBIDDEN", message: "SIGNUP_ASSIGNED_SUBJECT_LOCKED" });
  expect(await domainSnapshot()).toEqual(before);
  expect(await db.auditLog.count({ where: { kind: "ATTEMPT" } })).toBe(attempts + 1);
  expect(await db.auditLog.findFirst({ where: { kind: "ATTEMPT", operation: "studentWorkflow.editSignup" } })).toMatchObject({ userId: "owner-c", details: { applied: false, errorCode: "FORBIDDEN" } });

  const sourceA = await db.studentSurvey.findUniqueOrThrow({ where: { id: a.id } });
  const sourceC = await db.studentSurvey.findUniqueOrThrow({ where: { id: c.id } });
  const users = await db.user.findMany({ orderBy: { id: "asc" } });
  await expect(f.owner.studentWorkflow.editSignup(edit(c.id, c.version, { ...c.answers, preferredContact: "Corrected independent C contact" })))
    .resolves.toEqual({ ok: true, version: 1 });
  expect(await db.studentSignupRevision.findMany()).toEqual([expect.objectContaining({ surveyId: c.id, version: 1 })]);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: a.id } })).toEqual(sourceA);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ payload: sourceC.payload, submittedAt: sourceC.submittedAt, policySnapshot: sourceC.policySnapshot, policyRevision: sourceC.policyRevision, firstAssignedAt: sourceC.firstAssignedAt, verificationDueAt: sourceC.verificationDueAt });
  expect(await db.user.findMany({ orderBy: { id: "asc" } })).toEqual(users);
});

it.each(["head", "admin"])("lets %s release only the transferred request's exact assignments and never revives retained physical history", async (actorId) => {
  const f = await fixture();
  const predecessor = await db.pairing.findUniqueOrThrow({ where: { id: f.originalMath.pairingId } });
  const manager = await caller(actorId);
  const a = await manager.studentWorkflow.managedSignup({ id: "request-a" });
  const aBefore = await db.studentSurvey.findUniqueOrThrow({ where: { id: a.id } });
  const cBefore = await db.studentSurvey.findUniqueOrThrow({ where: { id: "request-c" } });
  const attendance = await db.sessionTutee.findMany();
  const input = { ...edit(a.id, a.version, { ...a.answers, secondChoiceId: "english" }), releaseChangedAssignments: true as const, signedTicket: await ready(manager, "SIGNUP_EDIT", a.id) };
  await expect(manager.studentWorkflow.headEditSignup(input)).resolves.toEqual({ ok: true, version: 1 });
  const releasedScience = await db.studentRequestExecutionAssignment.findUniqueOrThrow({ where: { surveyId_pairingId: { surveyId: a.id, pairingId: f.science.pairingId } } });
  expect(releasedScience.releasedAt).toBeInstanceOf(Date);
  expect(await db.pairingTutee.count({ where: { pairingId: f.science.pairingId } })).toBe(0);
  expect((await manager.studentWorkflow.managedSignup({ id: a.id })).assignedSubjectIds).toEqual(["math"]);
  const unassign = { id: a.id, pairingId: f.math.pairingId, expectedVersion: 1, clientKey: randomUUID(), signedTicket: await ready(manager, "SIGNUP_UNASSIGN", `${a.id}:${f.math.pairingId}`) };
  await expect(manager.studentWorkflow.headUnassign(unassign)).resolves.toEqual({ ok: true, version: 2 });
  await expect(manager.studentWorkflow.headUnassign(unassign)).resolves.toEqual({ ok: true, version: 2 });
  expect(await db.pairingTutee.count({ where: { pairingId: f.math.pairingId } })).toBe(0);
  expect(await db.pairingTutee.count({ where: { pairingId: f.originalMath.pairingId, tuteeId: "tutee-a" } })).toBe(1);
  // Retained physical history cannot revive an explicitly released current lock.
  expect(await manager.studentWorkflow.managedSignup({ id: a.id })).toMatchObject({ assignedSubjectIds: [], assignmentsUnresolved: false });
  const releasedMath = await db.studentRequestExecutionAssignment.findUniqueOrThrow({ where: {
    surveyId_pairingId: { surveyId: a.id, pairingId: f.math.pairingId },
  } });
  expect(releasedMath).toMatchObject({ sourceTuteeId: "tutee-a", tuteeId: "tutee-c" });
  expect(releasedMath.releasedAt).toBeInstanceOf(Date);
  // Separate catalogue fixture control: make the retained label obsolete without
  // mutating the immutable predecessor or fabricating any execution authority.
  // This direct metadata seed does not claim public catalogue-rename reachability.
  await db.subject.update({ where: { id: "math" }, data: { name: "Renamed mathematics catalogue" } });
  expect(await db.subject.findUnique({ where: { name: predecessor.subject } })).toBeNull();
  expect(await db.pairing.findUniqueOrThrow({ where: { id: predecessor.id } })).toEqual(predecessor);
  expect(await manager.studentWorkflow.managedSignup({ id: a.id })).toMatchObject({ assignedSubjectIds: [], assignmentsUnresolved: false });
  expect((await f.owner.studentWorkflow.signup({ id: "request-c" })).assignedSubjectIds).toEqual(["english"]);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: "request-c" } })).toEqual(cBefore);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ payload: aBefore.payload, submittedAt: aBefore.submittedAt, policySnapshot: aBefore.policySnapshot, policyRevision: aBefore.policyRevision, firstAssignedAt: aBefore.firstAssignedAt, verificationDueAt: aBefore.verificationDueAt, tuteeId: aBefore.tuteeId });
  expect(await db.tutee.findUniqueOrThrow({ where: { id: "tutee-c" } })).toMatchObject({ status: "ACTIVE" });
  expect(await db.session.findUniqueOrThrow({ where: { id: f.attendance.id } })).toEqual(f.attendance);
  expect(await db.sessionTutee.findMany()).toEqual(attendance);
});

it("retains a canonical member needed by another exact request when Head releases the original request", async () => {
  const f = await fixture();
  const c = await f.owner.studentWorkflow.signup({ id: "request-c" });
  await f.owner.studentWorkflow.editSignup(edit(c.id, c.version, { ...c.answers, secondChoiceId: "science" }));
  // Separate shared-member domain control: admit another request's exact authority
  // through the owning recorder, after the public transfer chain proved reachability.
  const sourceC = await db.studentSurvey.findUniqueOrThrow({ where: { id: c.id } });
  await db.$transaction((tx) => recordStudentRequestExecution(tx, sourceC, f.science.pairingId, "tutee-c"));
  const cMapping = await db.studentRequestExecutionAssignment.findUniqueOrThrow({ where: { surveyId_pairingId: { surveyId: c.id, pairingId: f.science.pairingId } } });
  const a = await f.head.studentWorkflow.managedSignup({ id: "request-a" });
  await f.head.studentWorkflow.headEditSignup({
    ...edit(a.id, a.version, { ...a.answers, secondChoiceId: "english" }), releaseChangedAssignments: true,
    signedTicket: await ready(f.head, "SIGNUP_EDIT", a.id),
  });
  expect(await db.studentRequestExecutionAssignment.findUniqueOrThrow({ where: { surveyId_pairingId: { surveyId: c.id, pairingId: f.science.pairingId } } })).toEqual(cMapping);
  expect(await db.pairingTutee.count({ where: { pairingId: f.science.pairingId, tuteeId: "tutee-c" } })).toBe(1);
  expect((await f.owner.studentWorkflow.signup({ id: "request-a" })).assignedSubjectIds).toEqual(["math"]);
  expect((await f.owner.studentWorkflow.signup({ id: c.id })).assignedSubjectIds.sort()).toEqual(["english", "science"]);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: c.id } })).toEqual(sourceC);
});

it("retains inactive transferred choices and blocks unresolved current labels without blocking unchanged contact corrections", async () => {
  const f = await fixture();
  await db.subject.update({ where: { id: "science" }, data: { active: false } });
  await db.programSettings.upsert({ where: { id: "program" }, create: { id: "program", signupFields: { tutee: { secondSubject: "hidden" } } }, update: { signupFields: { tutee: { secondSubject: "hidden" } } } });
  const a = await f.owner.studentWorkflow.signup({ id: "request-a" });
  expect(a.assignedSubjectIds.sort()).toEqual(["math", "science"]);
  await f.owner.studentWorkflow.editSignup(edit(a.id, a.version, { ...a.answers, preferredContact: "Changed contact with hidden assigned choice" }));
  expect((await f.owner.studentWorkflow.signup({ id: a.id })).answers.secondChoiceId).toBe("science");
  await expect(f.owner.studentWorkflow.editSignup(edit(a.id, 1, { ...a.answers, firstChoiceId: "english", secondChoiceId: "math" })))
    .rejects.toMatchObject({ code: "FORBIDDEN", message: "SIGNUP_ASSIGNED_SUBJECT_LOCKED" });
  await db.programSettings.update({ where: { id: "program" }, data: { signupFields: {} } });
  await db.pairing.update({ where: { id: f.science.pairingId }, data: { subject: "Unresolved current execution label" } });
  expect(await f.owner.studentWorkflow.signup({ id: a.id })).toMatchObject({ assignmentsUnresolved: true, subjectEditingBlocked: true });
  const before = await domainSnapshot();
  await expect(f.owner.studentWorkflow.editSignup(edit(a.id, 1, { ...a.answers, secondChoiceId: "english" })))
    .rejects.toMatchObject({ code: "CONFLICT", message: "SIGNUP_ASSIGNMENT_UNKNOWN" });
  expect(await domainSnapshot()).toEqual(before);
  await expect(f.owner.studentWorkflow.editSignup(edit(a.id, 1, { ...a.answers, preferredContact: "Contact correction with unresolved assignment" })))
    .resolves.toEqual({ ok: true, version: 2 });
  expect((await f.owner.studentWorkflow.signup({ id: "request-c" })).assignmentsUnresolved).toBe(false);
});
