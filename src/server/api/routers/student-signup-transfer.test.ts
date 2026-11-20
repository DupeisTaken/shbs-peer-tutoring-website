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
import { applyQuarterWithdrawal, lockQuarterWithdrawalScope, readQuarterWithdrawalEvidence } from "~/server/student-quarter-withdrawal";
import { assertStudentRequestAssignable } from "~/server/student-request-state";
import { assertIntakeEligibility } from "~/server/student-survey";
import { sessionAttendanceContext } from "~/server/session-planning";
import { createCaller } from "../root";

const password = "Synthetic-transfer-review-738!";
const passwordHash = hashPassword(password);
const submittedAt = new Date("2026-09-01T00:00:00Z");
const termId = "signup-transfer-term";
let fixtureClock = new Date("2026-11-16T08:00:00Z").getTime();

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
  // The real in-process password limiter survives fixture truncation. Move the
  // synthetic clock forward beyond its window without bypassing authentication.
  fixtureClock += 16 * 60_000;
  vi.setSystemTime(new Date(fixtureClock));
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

async function ready(actor: Caller, action: "ASSIGN" | "SIGNUP_EDIT" | "SIGNUP_UNASSIGN" | "ABORT" | "APPROVE" | "DENY", target: string) {
  const ticket = await actor.studentWorkflow.prepareAction({ action, target });
  // Advance the test clock past the genuine actor/purpose/target-bound countdown.
  // No fabricated ticket or direct confirmation-row update bypasses admission.
  vi.setSystemTime(new Date(ticket.readyAt.getTime() + 1));
  return ticket.id;
}

async function withdrawal(f: Awaited<ReturnType<typeof fixture>>, surveyId = "request-c") {
  await f.owner.studentWorkflow.applyAbort({ id: surveyId, reason: "Synthetic quarter withdrawal", ticket: await ready(f.owner, "ABORT", surveyId) });
  return db.studentRequestReview.findFirstOrThrow({ where: { surveyId, kind: "STUDENT_ABORT", state: "PENDING" } });
}

async function sibling(input: { id: string; ownerId?: string; term?: string; manual?: boolean; state?: "OPEN" | "RECALLED" }) {
  const source = await db.studentSurvey.findUniqueOrThrow({ where: { id: "request-c" } });
  const id = input.id;
  await db.tutee.create({ data: { id: `tutee-${id}`, englishName: `Synthetic ${id}`, status: input.manual ? "ACTIVE" : "PENDING", intakeTermId: input.term ?? termId, signupSource: input.manual ? "STAFF" : "SELF_SERVICE" } });
  await db.studentProfileOwnership.create({ data: { tuteeId: `tutee-${id}`, userId: input.ownerId ?? "owner-c" } });
  if (!input.manual) await db.studentSurvey.create({ data: { id: `request-${id}`, tuteeId: `tutee-${id}`, intakeTermId: input.term ?? termId, email: `${id}@example.test`, payload: source.payload!, policyRevision: source.policyRevision, policySnapshot: source.policySnapshot!, tokenHash: `${id}-${randomUUID()}`, expiresAt: new Date("2099-01-01"), confirmedAt: submittedAt, state: input.state ?? "OPEN" } });
  return `tutee-${id}`;
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

async function fixture(options: { manualA?: boolean; pendingOriginalWithdrawal?: boolean } = {}) {
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
      intakeTermId: termId, signupSource: options.manualA && suffix === "a" ? "STAFF" : "SELF_SERVICE", status: options.manualA && suffix === "a" ? "ACTIVE" : "PENDING", gradeLevel: "10",
      availabilities: { create: { slotId: "monday" } },
    } });
    await db.user.create({ data: {
      id: `owner-${suffix}`, personId: "person", name: payload.englishName,
      firstName: payload.firstName, lastName: payload.lastName, email: payload.email, username: `synthetic${suffix}`,
      role: "STUDENT", studentId: `tutee-${suffix}`, tuteeMember: true, emailVerifiedAt: submittedAt, passwordHash,
    } });
    await db.studentProfileOwnership.create({ data: { tuteeId: `tutee-${suffix}`, userId: `owner-${suffix}` } });
    await db.policyAcceptance.create({ data: { userId: `owner-${suffix}`, slug: "tutee-policy", revision: policy.revision, snapshot: policy.documents, signature: payload.signatureName, acceptedAt: submittedAt } });
    if (!(options.manualA && suffix === "a")) await db.studentSurvey.create({ data: {
      id: `request-${suffix}`, tuteeId: `tutee-${suffix}`, email: payload.email, intakeTermId: termId,
      payload, policyRevision: policy.revision, policySnapshot: policy.documents,
      tokenHash: suffix.repeat(64), confirmedAt: submittedAt,
      submittedAt: new Date(submittedAt.getTime() + (suffix === "c" ? 60_000 : 0)), expiresAt: new Date("2099-01-01T00:00:00Z"),
      // At version zero currentPayload is SQL NULL, supplied by its database default.
    } });
  }
  const head = await caller();
  // A manual source's exact recurring membership is a legitimate prerequisite;
  // the subsequent mixed transfer and withdrawal still use actual procedures.
  const manualPairing = options.manualA ? await db.pairing.create({ data: { tutorId: "tutor", termId, subject: "Mathematics", dayOfWeek: 1, startMin: 930, endMin: 990, tutees: { create: { tuteeId: "tutee-a" } } } }) : null;
  const originalMath = manualPairing
    ? { surveyId: "manual-a", pairingId: manualPairing.id, tuteeId: "tutee-a", sourceTuteeId: "tutee-a", revision: 0, receiptId: null, createdAt: submittedAt, releasedAt: null }
    : await assign(head, "request-a", "math");
  await assign(head, "request-c", "english");
  expect(await db.tutee.count({ where: { id: { in: ["tutee-a", "tutee-c"] }, status: "ACTIVE" } })).toBe(2);
  let originalWithdrawal: { id: string } | null = null;
  if (options.pendingOriginalWithdrawal) {
    const originalOwner = await caller("owner-a");
    await originalOwner.studentWorkflow.applyAbort({ id: "request-a", reason: "Synthetic request before reviewed ownership transfer", ticket: await ready(originalOwner, "ABORT", "request-a") });
    originalWithdrawal = await db.studentRequestReview.findFirstOrThrow({ where: { surveyId: "request-a", kind: "STUDENT_ABORT", state: "PENDING" } });
  }
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
  const successor = manualPairing ? await db.pairingExecutionSuccessor.findUniqueOrThrow({ where: { sourcePairingId: manualPairing.id } }) : null;
  const math = successor ? { ...originalMath, pairingId: successor.targetPairingId, tuteeId: "tutee-c" } : await currentAssignment("request-a", "Mathematics");
  const science = options.manualA ? math : await assign(head, "request-a", "science");
  expect(science).toMatchObject({ sourceTuteeId: "tutee-a", tuteeId: "tutee-c", releasedAt: null });
  expect(await db.pairingTutee.findUnique({ where: { pairingId_tuteeId: { pairingId: science.pairingId, tuteeId: "tutee-c" } } })).not.toBeNull();
  // Transfer invalidates prior history-access sessions. Use the persisted revision.
  return { head, owner: await caller("owner-c"), science, math, originalMath, attendance, originalWithdrawal };
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

it.each(["head", "admin"])("lets %s approve one whole-period withdrawal after transfer, including unassigned demand and pending sibling reviews", async (actorId) => {
  const f = await fixture();
  await sibling({ id: "waiting" });
  const otherReview = await withdrawal(f, "request-a");
  const review = await withdrawal(f);
  const manager = await caller(actorId);
  const beforeAttendance = await db.sessionTutee.findMany();
  const ticket = await ready(manager, "APPROVE", review.id);
  const evidence = await readQuarterWithdrawalEvidence(db, { reviewId: review.id });
  expect(evidence.sources.map((row) => row.id).sort()).toEqual(["request-a", "request-c", "request-waiting"]);
  expect(JSON.stringify(evidence)).not.toMatch(/Original .* signature|Original consent evidence|@example\.test|Synthetic quarter withdrawal/);
  await expect(manager.studentWorkflow.resolveReview({ id: review.id, approve: true, ticket })).resolves.toEqual({ ok: true });
  expect(await db.studentSurvey.findMany({ where: { id: { in: ["request-a", "request-c", "request-waiting"] } }, select: { state: true } })).toEqual([{ state: "ABORTED" }, { state: "ABORTED" }, { state: "ABORTED" }]);
  expect(await db.studentRequestExecutionAssignment.count({ where: { releasedAt: null } })).toBe(0);
  expect(await db.pairingTutee.count({ where: { pairingId: { in: [f.math.pairingId, f.science.pairingId, (await currentAssignmentHistory("request-c")).pairingId] } } })).toBe(0);
  expect(await db.tutee.findUnique({ where: { id: "tutee-c" } })).toMatchObject({ status: "INACTIVE" });
  expect(await db.studentRequestReview.findUnique({ where: { id: review.id } })).toMatchObject({ state: "APPROVED", resolvedByUserId: actorId });
  expect(await db.studentRequestReview.findUnique({ where: { id: otherReview.id } })).toMatchObject({ state: "DENIED" });
  expect(await db.studentQuarterBlock.findMany()).toEqual([expect.objectContaining({ userId: "owner-c", intakeTermId: termId, surveyId: "request-c" })]);
  expect(await db.session.findUniqueOrThrow({ where: { id: f.attendance.id } })).toEqual(f.attendance);
  expect(await db.sessionTutee.findMany()).toEqual(beforeAttendance);
  expect(await db.pairingTutee.count({ where: { pairingId: f.originalMath.pairingId, tuteeId: "tutee-a" } })).toBe(1);
  expect(await readQuarterWithdrawalEvidence(db, { reviewId: review.id })).toMatchObject({ review: { state: "APPROVED" } });
  const after = await domainSnapshot();
  await expect(manager.studentWorkflow.resolveReview({ id: review.id, approve: true, ticket })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await domainSnapshot()).toEqual(after);
  await db.user.update({ where: { id: "owner-c" }, data: { email: "changed@example.test" } });
  await expect(db.$transaction((tx) => assertIntakeEligibility(tx, termId, "new-alias@example.test", { id: "owner-c", email: "changed@example.test" }))).rejects.toThrow("cannot submit another request");
});

async function currentAssignmentHistory(surveyId: string) {
  return db.studentRequestExecutionAssignment.findFirstOrThrow({ where: { surveyId } });
}

it("declines a withdrawal without closing owned siblings, assignments or intake", async () => {
  const f = await fixture();
  const review = await withdrawal(f);
  const surveys = await db.studentSurvey.findMany({ orderBy: { id: "asc" } });
  const maps = await db.studentRequestExecutionAssignment.findMany();
  const members = await db.pairingTutee.findMany();
  await f.head.studentWorkflow.resolveReview({ id: review.id, approve: false, ticket: await ready(f.head, "DENY", review.id) });
  expect(await db.studentSurvey.findMany({ orderBy: { id: "asc" } })).toEqual(surveys);
  expect(await db.studentRequestExecutionAssignment.findMany()).toEqual(maps);
  expect(await db.pairingTutee.findMany()).toEqual(members);
  expect(await db.studentQuarterBlock.count()).toBe(0);
  expect(await db.studentRequestReview.findUnique({ where: { id: review.id } })).toMatchObject({ state: "DENIED" });
});

it.each(["transferred", "conflicting"])("fails closed when initiating ownership is %s after application", async (mode) => {
  const f = await fixture({ pendingOriginalWithdrawal: mode === "transferred" });
  await db.user.create({ data: { id: "new-owner", email: "new-owner@example.test", role: "STUDENT", personId: "person", emailVerifiedAt: submittedAt, passwordHash, tuteeMember: true } });
  let review;
  if (mode === "transferred") {
    if (!f.originalWithdrawal) throw new Error("Expected original owner's pre-transfer application");
    review = f.originalWithdrawal;
    // The first genuine A→C transfer committed, including exact source ownership
    // and execution, before attempting this now-stale original owner's decision.
    expect(await db.personParticipationTransferReceipt.count()).toBe(1);
    expect(await db.studentProfileOwnership.findUnique({ where: { tuteeId: "tutee-a" } })).toMatchObject({ userId: "owner-c", revision: 2 });
    expect(await db.studentRequestReview.findUnique({ where: { id: review.id } })).toMatchObject({ requestedByUserId: "owner-a", state: "PENDING" });
    expect(await db.user.findUnique({ where: { id: "owner-a" } })).toMatchObject({ studentId: null });
  } else {
    // Deliberately conflicting fresh fixture: unlike a reviewed historical
    // source it has no correction record to bypass. Both ownership claims exist.
    const profile = await sibling({ id: "conflict" });
    await db.user.update({ where: { id: "new-owner" }, data: { studentId: profile } });
    const source = await db.studentSurvey.findUniqueOrThrow({ where: { id: "request-conflict" } });
    await db.$transaction((tx) => recordStudentRequestExecution(tx, source, f.science.pairingId, "tutee-c"));
    review = await withdrawal(f, source.id);
  }
  const ticket = await ready(f.head, "APPROVE", review.id);
  const before = await domainSnapshot();
  await expect(f.head.studentWorkflow.resolveReview({ id: review.id, approve: true, ticket })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await domainSnapshot()).toEqual(before);
});

it("preserves another owner's exact shared member and excludes terminal/other-term/Person-only sources", async () => {
  const f = await fixture();
  await db.user.create({ data: { id: "external", email: "external@example.test", role: "STUDENT", personId: "person" } });
  const external = await sibling({ id: "external", ownerId: "external" });
  const source = await db.studentSurvey.findUniqueOrThrow({ where: { id: "request-external" } });
  await db.$transaction((tx) => recordStudentRequestExecution(tx, source, f.science.pairingId, "tutee-c"));
  await sibling({ id: "terminal", state: "RECALLED" });
  await db.term.create({ data: { id: "ended", name: "Ended", schoolYear: "25-26", quarter: "Q4", active: false } });
  await sibling({ id: "old", term: "ended" });
  const excluded = await db.studentSurvey.findMany({ where: { id: { in: ["request-external", "request-terminal", "request-old"] } }, orderBy: { id: "asc" } });
  const review = await withdrawal(f);
  await f.head.studentWorkflow.resolveReview({ id: review.id, approve: true, ticket: await ready(f.head, "APPROVE", review.id) });
  expect(await db.studentSurvey.findMany({ where: { id: { in: excluded.map((row) => row.id) } }, orderBy: { id: "asc" } })).toEqual(excluded);
  expect(await db.studentRequestExecutionAssignment.findUnique({ where: { surveyId_pairingId: { surveyId: source.id, pairingId: f.science.pairingId } } })).toMatchObject({ tuteeId: "tutee-c", sourceTuteeId: external, releasedAt: null });
  expect(await db.pairingTutee.findUnique({ where: { pairingId_tuteeId: { pairingId: f.science.pairingId, tuteeId: "tutee-c" } } })).not.toBeNull();
  expect(await db.tutee.findUnique({ where: { id: "tutee-c" } })).toMatchObject({ status: "ACTIVE" });
});

it("closes owned manual siblings, blocks same-period reassignment and permits a later period", async () => {
  const f = await fixture();
  const manual = await sibling({ id: "manual", manual: true });
  const pairing = await db.pairing.create({ data: { tutorId: "tutor", termId, subject: "English", dayOfWeek: 2, startMin: 930, endMin: 990, tutees: { create: { tuteeId: manual } } } });
  const review = await withdrawal(f);
  await f.head.studentWorkflow.resolveReview({ id: review.id, approve: true, ticket: await ready(f.head, "APPROVE", review.id) });
  expect(await db.pairingTutee.count({ where: { pairingId: pairing.id, tuteeId: manual } })).toBe(0);
  expect(await db.tutee.findUnique({ where: { id: manual } })).toMatchObject({ status: "INACTIVE" });
  expect(await db.studentRequestReview.count({ where: { legacyTuteeId: manual, state: "APPROVED" } })).toBe(0);
  await expect(db.$transaction((tx) => assertStudentRequestAssignable(tx, manual))).rejects.toThrow("cannot be reassigned");
  await db.term.update({ where: { id: termId }, data: { active: false } });
  await db.term.create({ data: { id: "next", name: "Next", schoolYear: "26-27", quarter: "Q2", active: true } });
  await expect(db.$transaction((tx) => assertStudentRequestAssignable(tx, manual))).resolves.toBeUndefined();
});

it("rolls back every source, restriction and notice if the aggregate transaction fails after closure", async () => {
  const f = await fixture();
  const review = await withdrawal(f);
  const before = await domainSnapshot();
  await expect(db.$transaction(async (tx) => {
    const scope = await lockQuarterWithdrawalScope(tx, { reviewId: review.id });
    await applyQuarterWithdrawal(tx, scope, { actorId: "head", now: new Date() });
    throw new Error("Synthetic failure after aggregate closure");
  })).rejects.toThrow("Synthetic failure");
  expect(await domainSnapshot()).toEqual(before);
});

it.each([false, true])("withdraws a surveyless source through exact mixed transfer successors (chained: %s)", async (chained) => {
  const f = await fixture({ manualA: true });
  if (chained) {
    const next = await sibling({ id: "next-canonical" });
    await db.tutee.update({ where: { id: next }, data: { personId: "person", status: "ACTIVE" } });
    const selection = { personId: "person", retainedUserId: "owner-c", activeTutorId: null, activeTuteeId: next, tutorIds: [], tuteeIds: ["tutee-c", next], acknowledgeHistoryAccessCorrection: true };
    const preview = await f.head.personCombine.participationPreview(selection);
    expect(preview.canTransfer).toBe(true);
    await f.head.personCombine.participationTransfer({ ...selection, fingerprint: preview.fingerprint, operationId: randomUUID(), reason: "Reviewed next exact manual execution successor", acknowledged: true, confirmPassword: password });
    const edge = await db.pairingExecutionSuccessor.findUniqueOrThrow({ where: { sourcePairingId: f.math.pairingId } });
    f.math = { ...f.math, pairingId: edge.targetPairingId, tuteeId: next };
    f.owner = await caller("owner-c");
  }
  expect(await db.studentSurvey.count({ where: { tuteeId: "tutee-a" } })).toBe(0);
  expect(await db.tutee.findUnique({ where: { id: "tutee-a" } })).toMatchObject({ status: "INACTIVE" });
  expect(await db.studentRequestExecutionAssignment.count({ where: { pairingId: f.math.pairingId } })).toBe(0);
  const review = await withdrawal(f);
  const evidence = await readQuarterWithdrawalEvidence(db, { reviewId: review.id });
  expect(evidence.manualAssignments).toEqual([expect.objectContaining({ sourceTuteeId: "tutee-a", sourcePairingId: f.originalMath.pairingId, pairingId: f.math.pairingId, tuteeId: f.math.tuteeId })]);
  await f.head.studentWorkflow.resolveReview({ id: review.id, approve: true, ticket: await ready(f.head, "APPROVE", review.id) });
  expect(await db.pairingTutee.count({ where: { pairingId: f.math.pairingId, tuteeId: f.math.tuteeId } })).toBe(0);
  expect(await db.pairingTutee.count({ where: { pairingId: f.originalMath.pairingId, tuteeId: "tutee-a" } })).toBe(1);
  expect(await db.tutee.findUnique({ where: { id: f.math.tuteeId } })).toMatchObject({ status: "INACTIVE" });
  expect(await db.session.findUnique({ where: { id: f.attendance.id } })).toEqual(f.attendance);
});

it("ignores retained manual predecessor history after Head removes its current exact successor member", async () => {
  const f = await fixture({ manualA: true });
  await f.head.admin.updatePairing({ id: f.math.pairingId, tutorId: "tutor", timeSlotId: "monday", subject: "Mathematics", tuteeIds: [] });
  const review = await withdrawal(f);
  expect((await readQuarterWithdrawalEvidence(db, { reviewId: review.id })).manualAssignments).toEqual([]);
  await f.head.studentWorkflow.resolveReview({ id: review.id, approve: true, ticket: await ready(f.head, "APPROVE", review.id) });
  expect(await db.studentSurvey.findUnique({ where: { id: "request-c" } })).toMatchObject({ state: "ABORTED" });
  expect(await db.pairingTutee.count({ where: { pairingId: f.originalMath.pairingId, tuteeId: "tutee-a" } })).toBe(1);
  expect(await db.session.findUnique({ where: { id: f.attendance.id } })).toEqual(f.attendance);
});

it("uses actual manual withdrawal admission and preserves shared future publication, peer authority and completed evidence", async () => {
  const f = await fixture();
  const manual = await sibling({ id: "published-manual", manual: true });
  const peer = await sibling({ id: "published-peer", ownerId: "peer-user", manual: true });
  await db.user.createMany({ data: [
    { id: "peer-user", role: "STUDENT", email: "peer@example.test", studentId: peer, emailVerifiedAt: submittedAt, tuteeMember: true },
    { id: "tutor-user", role: "TUTOR", email: "tutor@example.test", tutorId: "tutor", emailVerifiedAt: submittedAt },
  ] });
  await db.policyDocument.create({ data: { slug: "tutor-policy", locale: "en", title: "Synthetic tutor policy", body: "Reviewed synthetic tutoring policy" } });
  const tutorPolicy = await currentPolicy(db, "tutor-policy");
  await db.policyAcceptance.create({ data: { userId: "tutor-user", slug: "tutor-policy", revision: tutorPolicy.revision, snapshot: tutorPolicy.documents, signature: "Synthetic tutor consent" } });
  const pairing = await db.pairing.create({ data: { tutorId: "tutor", termId, subject: "English", dayOfWeek: 2, startMin: 930, endMin: 975, scheduleConfirmed: true, tutees: { create: [{ tuteeId: manual }, { tuteeId: peer }] } } });
  const futureStart = new Date(Date.now() + 2 * 86_400_000);
  const futureEnd = new Date(futureStart.getTime() + 45 * 60_000);
  const futureDate = futureStart.toISOString().slice(0, 10);
  for (const past of [false, true]) {
    const id = past ? "manual-recorded" : "manual-future";
    await db.sessionPlan.create({ data: { id, generationKey: id, tutorId: "tutor", termId, originalDate: futureDate, timeZone: "Asia/Shanghai", sourceFingerprint: "exact synthetic manual source", assignments: { create: { pairingId: pairing.id, subject: "English", tuteeIds: [manual, peer], primary: true } } } });
    await db.sessionPlanCohort.create({ data: { id: `${id}-cohort`, planId: id, date: futureDate, startMin: 930, endMin: 975, startsAt: past ? submittedAt : futureStart, endsAt: past ? new Date(submittedAt.getTime() + 45 * 60_000) : futureEnd, status: past ? "RECORDED" : "SCHEDULED" } });
    await db.sessionPlanParticipant.createMany({ data: [manual, peer].map((tuteeId) => ({ id: `${id}-${tuteeId}`, planId: id, tuteeId, cohortId: `${id}-cohort` })) });
  }
  const pastCohort = await db.sessionPlanCohort.findUniqueOrThrow({ where: { id: "manual-recorded-cohort" } });
  await db.sessionPlanningRequest.create({ data: { id: "manual-pending", planId: "manual-future", cohortId: "manual-future-cohort", kind: "RESCHEDULE", scope: "ALL", participantIds: [manual, peer] } });
  await db.sessionPlanningOffer.create({ data: { id: "manual-offer", requestId: "manual-pending", sequence: 1, authorKey: "tutor:tutor", date: futureDate, startMin: 930, endMin: 975, startsAt: futureStart, endsAt: futureEnd, cutoffAt: futureStart,
    responses: { create: [{ actorKey: `tutee:${manual}`, actorUserId: "owner-c", deliveredAt: new Date(), deadline: new Date(futureStart.getTime() - 60_000) }, { actorKey: `tutee:${peer}`, actorUserId: "peer-user", deliveredAt: new Date(), deadline: new Date(futureStart.getTime() - 60_000) }] },
  } });
  await db.sessionPlanningRequest.update({ where: { id: "manual-pending" }, data: { currentOfferId: "manual-offer" } });
  const responseClocks = await db.sessionPlanningResponse.findMany({ where: { offerId: "manual-offer" }, select: { id: true, deliveredAt: true, deadline: true, respondedAt: true }, orderBy: { id: "asc" } });
  const pastPeople = await db.sessionPlanParticipant.findMany({ where: { planId: "manual-recorded" } });
  const originalAssignments = await db.sessionPlanAssignment.findMany({ where: { planId: { in: ["manual-recorded", "manual-future"] } } });
  const target = `legacy:${manual}`;
  await f.owner.studentWorkflow.applyLegacyWithdrawal({ tuteeId: manual, reason: "Synthetic manual whole-period withdrawal", ticket: await ready(f.owner, "ABORT", target) });
  const review = await db.studentRequestReview.findFirstOrThrow({ where: { legacyTuteeId: manual, state: "PENDING" } });
  await f.head.studentWorkflow.resolveReview({ id: review.id, approve: true, ticket: await ready(f.head, "APPROVE", review.id) });
  expect(await db.studentSurvey.count({ where: { state: "OPEN" } })).toBe(0);
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: `manual-future-${manual}` } })).toMatchObject({ status: "CANCELLED", version: 2 });
  expect(await db.sessionPlanParticipant.findUnique({ where: { id: `manual-future-${peer}` } })).toMatchObject({ status: "SCHEDULED", version: 1 });
  expect(await db.sessionPlanCohort.findUnique({ where: { id: "manual-future-cohort" } })).toMatchObject({ status: "SCHEDULED" });
  expect(await db.sessionPlanningRequest.findUnique({ where: { id: "manual-pending" } })).toMatchObject({ status: "STALE" });
  expect(await db.sessionPlanningResponse.findMany({ where: { offerId: "manual-offer" }, select: { id: true, deliveredAt: true, deadline: true, respondedAt: true }, orderBy: { id: "asc" } })).toEqual(responseClocks);
  const releasedMember = await db.sessionPlanContinuationMember.findUniqueOrThrow({ where: { planId_pairingId_tuteeId: { planId: "manual-future", pairingId: pairing.id, tuteeId: manual } } });
  expect(releasedMember).toMatchObject({ assignmentId: null, sourceSurveyId: null, sourceTuteeId: manual });
  expect(releasedMember.releasedAt).toBeInstanceOf(Date);
  expect(await db.sessionPlanCohort.findUnique({ where: { id: pastCohort.id } })).toEqual(pastCohort);
  expect(await db.sessionPlanParticipant.findMany({ where: { planId: "manual-recorded" } })).toEqual(pastPeople);
  expect(await db.sessionPlanAssignment.findMany({ where: { planId: { in: ["manual-recorded", "manual-future"] } } })).toEqual(originalAssignments);
  // A real source-current/attendance read proves the remaining peer's publication
  // remains usable after release, beyond checking the visible status flags.
  const context = await db.$transaction((tx) => sessionAttendanceContext(tx, { id: "tutor-user", tutorId: "tutor" }, "manual-future-cohort", undefined, new Date(futureEnd.getTime() + 1)));
  expect(context.tuteeIds).toEqual([peer]);
});

it("retains an externally owned exact assignment on an owned surveyless canonical profile", async () => {
  const f = await fixture();
  const manual = await sibling({ id: "shared-manual", manual: true });
  await db.user.create({ data: { id: "external", email: "external@example.test", role: "STUDENT" } });
  await sibling({ id: "external-manual", ownerId: "external" });
  const source = await db.studentSurvey.findUniqueOrThrow({ where: { id: "request-external-manual" } });
  const pairing = await db.pairing.create({ data: { tutorId: "tutor", termId, subject: "English", dayOfWeek: 2, startMin: 930, endMin: 975, tutees: { create: { tuteeId: manual } } } });
  await db.$transaction((tx) => recordStudentRequestExecution(tx, source, pairing.id, manual));
  const review = await withdrawal(f);
  await f.head.studentWorkflow.resolveReview({ id: review.id, approve: true, ticket: await ready(f.head, "APPROVE", review.id) });
  expect(await db.studentSurvey.findUnique({ where: { id: source.id } })).toMatchObject({ state: "OPEN" });
  expect(await db.pairingTutee.findUnique({ where: { pairingId_tuteeId: { pairingId: pairing.id, tuteeId: manual } } })).not.toBeNull();
  expect(await db.tutee.findUnique({ where: { id: manual } })).toMatchObject({ status: "ACTIVE" });
});
