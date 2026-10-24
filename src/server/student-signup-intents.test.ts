import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EmailMessage } from "~/server/email/sender";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
const fixtures = vi.hoisted(() => ({
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
  verifyCaptcha: vi.fn<(proof: string, scene: string) => Promise<"accepted">>(),
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: fixtures.send },
  isEmailDeliveryAvailable: () => true,
  isEmailConfigured: () => true,
}));
// Keep the real durable CAPTCHA grants/admission path; replace only its paid provider.
vi.mock("~/server/captcha/aliyun", () => ({
  aliyunProvider: () => ({
    publicConfig: {
      provider: "aliyun-v2", region: "cn", prefix: "synthetic",
      scenes: { tutee: "tutee-scene", viewer: "viewer-scene" },
    },
    verify: fixtures.verifyCaptcha,
  }),
}));

import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { createCaller } from "./api/root";
import { currentPolicy, requirePolicy } from "./policy-acceptance";
import {
  surveyInput,
  surveyEmailCode,
  verifySurveyEmail,
} from "./student-survey";
import {
  stageStudentSignupIntent,
  recoverStudentSignupIntent,
  resendStudentSignupIntent,
  validStudentSignupIntent,
  studentSignupAdmissionLane,
  verifyStudentSignupIntent,
} from "./student-signup-intents";
import { consumeInvitationLogin, redeemAccountInvitation } from "./auth/account-invitations";
import { hashPassword, verifyPassword } from "./auth/password";
import { studentSignupLocalAnswers } from "./student-signup-answers";
import { verifySignupCaptcha } from "./captcha";
import { withSignupLease } from "./signup-admission";

const email = "owner@example.test";
const password = "Existing-password-268!";
const credential = hashPassword(password);
const termId = "signup-intents-term";
const profile = { firstName: "Posted", lastName: "Identity", reviewed: true as const };
let requestNumber = 0;
const headers = () => new Headers({ "x-signup-client-ip": `192.0.2.${++requestNumber}` });
const anonymous = () => createCaller({ db, headers: headers(), session: null });

beforeEach(async () => {
  // This suite owns synthetic data only in the serial shipping-test database.
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) =>
    '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  fixtures.send.mockReset().mockResolvedValue(undefined);
  fixtures.verifyCaptcha.mockReset().mockResolvedValue("accepted");
  vi.stubEnv("SIGNUP_TRUST_PROXY", "true");
  await db.term.create({ data: {
    id: termId, name: "Synthetic intake", schoolYear: "26-27", quarter: "Q1", active: true,
  } });
  await db.subject.createMany({ data: [
    { id: "math", name: "Mathematics" },
    { id: "science", name: "Science" },
    { id: "writing", name: "Writing" },
  ] });
  await db.timeSlot.createMany({ data: [
    { id: "monday", label: "Monday", dayOfWeek: 1, startMin: 960, endMin: 1020 },
    { id: "tuesday", label: "Tuesday", dayOfWeek: 2, startMin: 960, endMin: 1020 },
  ] });
  await db.policyDocument.create({ data: {
    slug: "tutee-policy", locale: "en", title: "Synthetic policy", body: "Original policy evidence.",
  } });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.$disconnect());

async function answers(overrides: Record<string, unknown> = {}) {
  const policy = await currentPolicy(db, "tutee-policy");
  return surveyInput.parse({
    englishName: "Original Request Name", email, preferredContact: "Original contact",
    firstChoiceId: "math", secondChoiceId: "science", slotIds: ["monday"],
    signatureName: "Original Signature", agreed: true, policyRevision: policy.revision,
    ...overrides,
  });
}

async function owner(options: { unfinished?: boolean; mfa?: boolean } = {}) {
  const tutor = await db.tutor.create({ data: {
    id: "existing-tutor", englishName: "Canonical Owner", username: "canonicalowner", status: "ACTIVE",
  } });
  const user = await db.user.create({ data: {
    id: "owner", email, name: "Canonical Owner", username: "canonicalowner",
    role: "TUTOR", tutorId: tutor.id, twoFactorEnabled: options.mfa ?? false,
    emailVerifiedAt: options.unfinished ? null : new Date(),
    passwordHash: options.unfinished ? null : credential,
    mustChangePassword: true,
  } });
  return { user, tutor };
}

async function existing(options: { confirmed?: boolean; mfa?: boolean } = {}) {
  const { user: initial, tutor } = await owner({ mfa: options.mfa });
  const payload = await answers();
  const tutee = await db.tutee.create({ data: {
    id: "existing-tutee", englishName: "Canonical Owner", email,
    preferredContact: payload.preferredContact, firstChoiceId: "math", secondChoiceId: "science",
    intakeTermId: termId, signupSource: "SELF_SERVICE",
    availabilities: { create: { slotId: "monday" } },
  } });
  const user = await db.user.update({ where: { id: initial.id }, data: {
    studentId: tutee.id, tuteeMember: true,
  } });
  await db.studentProfileOwnership.create({ data: { tuteeId: tutee.id, userId: user.id } });
  const policy = await currentPolicy(db, "tutee-policy");
  const acceptance = await db.policyAcceptance.create({ data: {
    userId: user.id, slug: "tutee-policy", revision: policy.revision,
    snapshot: policy.documents, signature: "Original Signature",
  } });
  const row = await db.studentSurvey.create({ data: {
    id: "original-request", email, intakeTermId: termId, payload,
    policyRevision: policy.revision, policySnapshot: policy.documents,
    tuteeId: tutee.id, confirmedAt: options.confirmed === false ? null : new Date(),
    tokenHash: "a".repeat(64), expiresAt: new Date(Date.now() + 86400000),
    submittedAt: new Date("2026-10-01T00:00:00Z"),
    verificationDueAt: new Date(Date.now() + 3 * 86400000),
  } });
  return { user, tutor, tutee, row, payload, acceptance };
}

async function staged(input: Awaited<ReturnType<typeof answers>>, clientKey = randomUUID(), userId?: string) {
  const receipt = await stageStudentSignupIntent(db, input, clientKey, userId);
  const intent = await db.studentSignupIntent.findUniqueOrThrow({ where: { id: receipt.intentId } });
  return { receipt, intent, clientKey, input };
}

async function invitation(intentId: string) {
  const intent = await db.studentSignupIntent.findUniqueOrThrow({ where: { id: intentId } });
  // This is the real public exact-submission proof path, not a fixture verifiedAt write.
  const issued = await anonymous().accountInvitation.verifySurvey({
    email: intent.email,
    intentId,
    code: surveyEmailCode(intent.tokenHash, intent.emailCodeVersion),
  });
  if (!issued.proof) throw new Error("Expected verified displayed invitation proof");
  return { invitationId: issued.invitationId, proof: issued.proof };
}

async function complete(intentId: string, userId?: string, setupPassword?: string) {
  const invite = await invitation(intentId);
  const receipt = await redeemAccountInvitation(db, {
    ...profile, ...invite, ...(setupPassword ? { password: setupPassword } : {}),
  }, userId);
  return { invite, receipt };
}

async function unchangedSource(id: string, before: unknown) {
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id } })).toEqual(before);
  expect(await db.studentSignupRevision.count()).toBe(0);
}

it("preserves legacy intent codes and their remaining attempt until a delivered resend upgrades them", async () => {
  const accepted = await staged(await answers());
  expect(accepted.intent.emailCodeVersion).toBe(1);
  expect(surveyEmailCode(accepted.intent.tokenHash, 1)).toMatch(/^[0-9]{4}$/);
  await db.studentSignupIntent.update({
    where: { id: accepted.intent.id },
    data: { emailCodeVersion: 0, attempts: 5 },
  });
  const legacy = surveyEmailCode(accepted.intent.tokenHash, 0);
  expect(
    (await verifyStudentSignupIntent(db, accepted.intent.id, email, legacy))
      .intent.id,
  ).toBe(accepted.intent.id);
  fixtures.send.mockRejectedValueOnce(new Error("Synthetic resend failure"));
  expect(
    await resendStudentSignupIntent(db, accepted.intent.id, email),
  ).toEqual({ emailSent: false });
  expect(
    (await verifyStudentSignupIntent(db, accepted.intent.id, email, legacy))
      .intent.id,
  ).toBe(accepted.intent.id);
  expect(
    await resendStudentSignupIntent(db, accepted.intent.id, email),
  ).toEqual({ emailSent: true });
  const updated = await db.studentSignupIntent.findUniqueOrThrow({
    where: { id: accepted.intent.id },
  });
  expect(updated.emailCodeVersion).toBe(1);
  await expect(
    verifyStudentSignupIntent(db, updated.id, email, legacy),
  ).rejects.toThrow();
  expect(
    (
      await verifyStudentSignupIntent(
        db,
        updated.id,
        email,
        surveyEmailCode(updated.tokenHash, 1),
      )
    ).intent.id,
  ).toBe(updated.id);
});

it("rejects public submissions without an explicit retry key before reserving demand or sending mail", async () => {
  const payload = await answers();
  // Deliberately malformed wire data reaches the real Zod boundary despite static API types.
  type Submission = Parameters<ReturnType<typeof anonymous>["tutee"]["submitSurvey"]>[0];
  await expect(anonymous().tutee.submitSurvey(payload as Submission)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(anonymous().tutee.requestSignup(payload as Submission)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.studentSurvey.count()).toBe(0);
  expect(await db.studentSignupIntent.count()).toBe(0);
  expect(fixtures.send).not.toHaveBeenCalled();
});

it("refuses a definitive missing receipt while that key's real pre-stage admission is in flight", async () => {
  const input = await answers();
  const key = randomUUID();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const enteredSignal = new Promise<void>((resolve) => { entered = resolve; });
  const holding = withSignupLease(db, studentSignupAdmissionLane(key), async () => {
    entered();
    await gate;
  }, 1);
  await Promise.race([enteredSignal, holding]);
  try {
    await expect(recoverStudentSignupIntent(db, input, key)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS", message: "SIGNUP_RETRY",
    });
    expect(await db.studentSignupIntent.count()).toBe(0);
    expect(fixtures.send).not.toHaveBeenCalled();
  } finally {
    release();
    await holding;
  }
  expect(await recoverStudentSignupIntent(db, input, key)).toBeNull();
});

it("stages anonymously without exposing or changing the live answers, priority, deadline or original mailbox challenge", async () => {
  const { row, payload } = await existing({ confirmed: false });
  const originalCode = surveyEmailCode(row.tokenHash, row.emailCodeVersion);
  const first = await staged({
    ...payload,
    preferredContact: "Untrusted replacement",
  });
  const second = await staged({
    ...payload,
    preferredContact: "Independent replacement",
  });
  expect(first.intent.id).not.toBe(second.intent.id);
  expect(first.intent.tokenHash).not.toBe(second.intent.tokenHash);
  expect(first.receipt).toEqual({ ok: true, emailSent: true, intentId: first.intent.id });
  await unchangedSource(row.id, row);
  await expect(verifySurveyEmail(db, email, originalCode)).resolves.toMatchObject({ id: row.id });
  expect(await db.studentSurvey.count()).toBe(1);
  expect(await db.user.count()).toBe(1);
  expect(fixtures.send).toHaveBeenCalledTimes(2);
});

it("reuses a normalized existing tutor mailbox only after existing sign-in/MFA and preserves credentials and tutor membership", async () => {
  const { user, tutor } = await owner({ mfa: true });
  // Account creation has already advanced the tutor's current-owner fence.
  const tutorBeforeConfirmation = await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } });
  const input = await answers({ email: "  OWNER@EXAMPLE.TEST  ", englishName: "Posted different name" });
  const accepted = await anonymous().tutee.submitSurvey({ ...input, clientKey: randomUUID() });
  const invite = await invitation(accepted.intentId);
  expect(await anonymous().accountInvitation.review(invite)).toMatchObject({
    existing: true, requiresSignIn: true, mfaRequired: true,
  });
  expect(await consumeInvitationLogin(invite.invitationId, invite.proof)).toBeNull();
  await expect(redeemAccountInvitation(db, { ...profile, ...invite })).rejects.toMatchObject({
    code: "UNAUTHORIZED", message: "INVITATION_SIGN_IN_REQUIRED",
  });
  expect(await db.tutee.count()).toBe(0);
  await redeemAccountInvitation(db, { ...profile, ...invite, password: "Posted-password-999!" }, user.id);
  expect(await db.user.count()).toBe(1);
  const confirmedUser = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(confirmedUser).toMatchObject({
    email, name: user.name, username: user.username, passwordHash: user.passwordHash,
    mustChangePassword: true, twoFactorEnabled: true, role: user.role,
    sessionVersion: user.sessionVersion,
    tutorId: tutor.id, tuteeMember: true,
  });
  const person = await db.person.findUniqueOrThrow({ where: { primaryUserId: user.id } });
  const tutee = await db.tutee.findFirstOrThrow({ where: { user: { id: user.id } } });
  expect(person).toMatchObject({ primaryUserId: user.id, resolutionState: "GROUPED", mergedIntoId: null });
  expect(confirmedUser).toMatchObject({ personId: person.id, studentId: tutee.id });
  expect(tutee.personId).toBe(person.id);
  expect(await db.person.findMany({ where: { mergedIntoId: null } })).toEqual([person]);
  // Materialization first creates an accountless source. Ownership then retains
  // that directory row as an empty redirect to the account's canonical group.
  expect(await db.person.findMany({
    where: { mergedIntoId: { not: null } },
    include: { _count: { select: { users: true, tutors: true, tutees: true } } },
  })).toEqual([expect.objectContaining({
    primaryUserId: null, mergedIntoId: person.id, resolutionState: "GROUPED",
    _count: { users: 0, tutors: 0, tutees: 0 },
  })]);
  expect(await db.studentProfileOwnership.findUniqueOrThrow({ where: { tuteeId: tutee.id } }))
    .toMatchObject({ userId: user.id, revision: 1 });
  // First tutee confirmation creates canonical directory metadata and runs the
  // profile mirror. Assert both separately so no original tutor business field
  // is excluded from the unchanged-record comparison.
  const { updatedAt: originalTimestamp, personId: originalPersonId, historyIdentityRevision: originalIdentityRevision, ...originalTutor } = tutorBeforeConfirmation;
  const { updatedAt: mirroredTimestamp, personId: mirroredPersonId, historyIdentityRevision: mirroredIdentityRevision, ...mirroredTutor } = await db.tutor.findUniqueOrThrow({ where: { id: tutor.id } });
  expect(originalPersonId).toBeNull();
  expect(mirroredPersonId).toBe(person.id);
  expect(mirroredIdentityRevision).toBe(originalIdentityRevision + 1);
  expect(mirroredTutor).toEqual(originalTutor);
  expect(mirroredTimestamp.getTime()).toBeGreaterThanOrEqual(originalTimestamp.getTime());
});

it("requires the exact source mailbox code and explicit owner authentication before overwriting a known request", async () => {
  const { row, payload } = await existing();
  const { intent } = await staged({
    ...payload,
    preferredContact: "Replacement",
  });
  await expect(
    anonymous().accountInvitation.verifySurvey({
      intentId: intent.id,
      email,
      code: surveyEmailCode(row.tokenHash, row.emailCodeVersion),
    }),
  ).rejects.toMatchObject({ message: "INVITATION_INVALID" });
  const invite = await invitation(intent.id);
  await db.user.create({ data: { id: "other", email: "other@example.test", name: "Other" } });
  await expect(redeemAccountInvitation(db, { ...profile, ...invite }, "other")).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
  await unchangedSource(row.id, row);
});

it("rejects a mailbox proof in the read-query input and accepts verified review through the POST mutation", async () => {
  const { payload } = await existing();
  const accepted = await staged(payload);
  const invite = await invitation(accepted.intent.id);
  // A malformed legacy GET payload must not put the browser's private proof in a URL.
  await expect(anonymous().accountInvitation.inspect(invite)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(anonymous().accountInvitation.review(invite)).resolves.toMatchObject({ existing: true, email });
});

it("records deliberate identical submissions as new consent revisions while exact completion retry is one write", async () => {
  const { user, row, payload, acceptance } = await existing();
  const first = await staged({ ...payload, preferredContact: "New contact", signatureName: "First New Signature" });
  const completed = await complete(first.intent.id, user.id);
  const beforeRetry = await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } });
  const notificationCount = await db.notification.count();
  await expect(redeemAccountInvitation(db, { ...profile, ...completed.invite }, user.id)).resolves.toEqual(completed.receipt);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } })).toEqual(beforeRetry);
  expect(await db.studentSignupRevision.count()).toBe(1);
  const second = await staged(first.input);
  await complete(second.intent.id, user.id);
  const revisions = await db.studentSignupRevision.findMany({ where: { surveyId: row.id }, orderBy: { version: "asc" } });
  expect(revisions.map(({ version, expectedVersion }) => ({ version, expectedVersion }))).toEqual([
    { version: 1, expectedVersion: 0 }, { version: 2, expectedVersion: 1 },
  ]);
  expect(revisions.map(({ answers: snapshot }) => snapshot)).toEqual([
    studentSignupLocalAnswers(first.input), studentSignupLocalAnswers(first.input),
  ]);
  expect(revisions[0]).toMatchObject({
    signatureName: "First New Signature",
    policyAcceptedAt: first.intent.receivedAt,
  });
  expect(revisions[1]).toMatchObject({
    signatureName: "First New Signature",
    policyAcceptedAt: second.intent.receivedAt,
  });
  expect(
    await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({
    payload: row.payload,
    submittedAt: row.submittedAt,
    tokenHash: row.tokenHash,
    policyRevision: row.policyRevision,
    policySnapshot: row.policySnapshot,
    verificationDueAt: row.verificationDueAt,
    currentVersion: 2,
  });
  expect(
    await db.policyAcceptance.findUniqueOrThrow({
      where: { id: acceptance.id },
    }),
  ).toEqual(acceptance);
  expect(await db.notification.count()).toBe(notificationCount);
});

it("archives each changed answer snapshot exactly and retains assignment and session evidence", async () => {
  const { user, tutor, tutee, row, payload } = await existing();
  const pairing = await db.pairing.create({ data: {
    id: "existing-pairing", tutorId: tutor.id, termId, subject: "Mathematics",
    dayOfWeek: 1, startMin: 960, endMin: 1020,
    tutees: { create: { tuteeId: tutee.id } },
  } });
  const session = await db.session.create({ data: {
    id: "existing-session", pairingId: pairing.id, tutorId: tutor.id, date: new Date("2026-10-02T00:00:00Z"),
    startMin: 960, endMin: 1020, month: "2026-10", schoolYear: "26-27", quarter: "Q1",
    durationMin: 60, shFactor: 1, shCount: 1, tutees: { create: { tuteeId: tutee.id } },
  } });
  const join = await db.pairingTutee.findMany();
  const attendance = await db.sessionTutee.findMany();
  const first = await staged({ ...payload, phone: "first", preferredContact: "First", slotIds: ["tuesday"] });
  await complete(first.intent.id, user.id);
  const second = await staged({ ...payload, phone: "second", preferredContact: "Second", secondChoiceId: "writing" });
  await complete(second.intent.id, user.id);
  const revisions = await db.studentSignupRevision.findMany({ where: { surveyId: row.id }, orderBy: { version: "asc" } });
  expect(revisions.map((revision) => revision.answers)).toEqual([
    studentSignupLocalAnswers(first.input), studentSignupLocalAnswers(second.input),
  ]);
  expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
  expect(await db.pairing.findUniqueOrThrow({ where: { id: pairing.id } })).toEqual(pairing);
  expect(await db.session.findUniqueOrThrow({ where: { id: session.id } })).toEqual(session);
  expect(await db.pairingTutee.findMany()).toEqual(join);
  expect(await db.sessionTutee.findMany()).toEqual(attendance);
});

it("records newly explicit policy consent separately from the original request and its original signature", async () => {
  const { user, row, acceptance } = await existing();
  await db.policyDocument.update({
    where: { slug_locale: { slug: "tutee-policy", locale: "en" } },
    data: { body: "A newly published policy, explicitly read for this submission.", version: "2" },
  });
  const input = await answers({ signatureName: "New Policy Signature", preferredContact: "New policy submission" });
  const accepted = await staged(input);
  await complete(accepted.intent.id, user.id);
  const policy = await currentPolicy(db, "tutee-policy");
  expect(input.policyRevision).not.toBe(row.policyRevision);
  expect(await db.policyAcceptance.findUniqueOrThrow({ where: {
    userId_slug_revision: { userId: user.id, slug: "tutee-policy", revision: input.policyRevision },
  } })).toMatchObject({
    snapshot: policy.documents, signature: input.signatureName, acceptedAt: accepted.intent.receivedAt,
  });
  expect(await db.policyAcceptance.findUniqueOrThrow({ where: { id: acceptance.id } })).toEqual(acceptance);
  expect(await db.studentSignupRevision.findFirstOrThrow()).toMatchObject({
    policyRevision: policy.revision, policySnapshot: policy.documents,
    signatureName: input.signatureName, policyAcceptedAt: accepted.intent.receivedAt,
  });
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
    payload: row.payload, policyRevision: row.policyRevision, policySnapshot: row.policySnapshot,
    submittedAt: row.submittedAt,
  });
});

it("recovers only the exact bound key/answers before fresh CAPTCHA/mail admission, even after completion", async () => {
  const { user, payload } = await existing();
  await db.programSettings.create({ data: { id: "program", captchaEnabled: true } });
  const network = headers();
  const grant = await verifySignupCaptcha(db, network, {
    action: "tutee.submit", email,
    proof: JSON.stringify({ sceneId: "tutee-scene", certifyId: randomUUID(), deviceToken: "fixture", data: "fixture" }),
  });
  const caller = createCaller({ db, headers: network, session: null });
  const input = { ...payload, clientKey: randomUUID(), captchaGrant: grant.grant! };
  const receipt = await caller.tutee.submitSurvey(input);
  expect(await db.captchaGrant.count()).toBe(0);
  expect(await caller.tutee.submitSurvey({ ...input, captchaGrant: undefined })).toEqual(receipt);
  await expect(caller.tutee.submitSurvey({ ...input, preferredContact: "Changed retry", captchaGrant: undefined })).rejects.toMatchObject({
    code: "CONFLICT", message: "SIGNUP_RETRY_CHANGED",
  });
  await expect(caller.tutee.submitSurvey({ ...input, clientKey: randomUUID(), captchaGrant: undefined })).rejects.toMatchObject({
    message: "CAPTCHA_REQUIRED",
  });
  await complete(receipt.intentId, user.id);
  expect(await caller.tutee.signupReceipt({ clientKey: input.clientKey, answers: payload })).toEqual(receipt);
  expect(await caller.tutee.submitSurvey({ ...input, captchaGrant: undefined })).toEqual(receipt);
  expect(await db.studentSignupIntent.count()).toBe(1);
  expect(await db.studentSignupRevision.count()).toBe(1);
  expect(fixtures.verifyCaptcha).toHaveBeenCalledTimes(1);
  expect(fixtures.send).toHaveBeenCalledTimes(1);
});

it("binds a signed-in acknowledgement to its submitting account without granting record access", async () => {
  const { payload } = await existing();
  const accepted = await staged(payload, randomUUID(), "owner");
  await expect(recoverStudentSignupIntent(db, payload, accepted.clientKey)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(recoverStudentSignupIntent(db, payload, accepted.clientKey, "other")).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await recoverStudentSignupIntent(db, payload, accepted.clientKey, "owner")).toEqual(accepted.receipt);
});

it("serializes concurrent independent submissions to one source and rejects the losing stale completion", async () => {
  const { user, payload } = await existing();
  const [first, second] = await Promise.all([
    staged({ ...payload, preferredContact: "Concurrent first" }),
    staged({ ...payload, preferredContact: "Concurrent second" }),
  ]);
  expect(first.intent.surveyId).toBe(second.intent.surveyId);
  expect(first.intent.expectedVersion).toBe(second.intent.expectedVersion);
  const invitations = await Promise.all([invitation(first.intent.id), invitation(second.intent.id)]);
  const result = await Promise.allSettled(invitations.map((invite) => redeemAccountInvitation(db, { ...profile, ...invite }, user.id)));
  expect(result.filter((value) => value.status === "fulfilled")).toHaveLength(1);
  const failure = result.find((value) => value.status === "rejected");
  expect(failure?.status === "rejected" ? failure.reason : null).toMatchObject({ code: "CONFLICT", message: "SIGNUP_INTENT_STALE" });
  expect(await db.studentSurvey.count()).toBe(1);
  expect(await db.studentSignupRevision.count()).toBe(1);
  expect(await db.studentSignupIntent.count({ where: { completedAt: { not: null } } })).toBe(1);
});

it("deduplicates concurrent exact transport retries to one intent and one challenge delivery", async () => {
  const payload = await answers();
  const key = randomUUID();
  const receipts = await Promise.all([
    stageStudentSignupIntent(db, payload, key), stageStudentSignupIntent(db, payload, key),
  ]);
  expect(receipts[0]?.intentId).toBe(receipts[1]?.intentId);
  expect(await db.studentSurvey.count()).toBe(1);
  expect(await db.studentSignupIntent.count()).toBe(1);
  expect(fixtures.send).toHaveBeenCalledTimes(1);
});

it.each(["session", "alias", "ownership"] as const)("refuses completion after %s binding changes", async (change) => {
  const { user, row, payload, tutee } = await existing();
  const alias = "verified-alias@example.test";
  if (change === "alias") await db.accountEmail.create({ data: { email: alias, userId: user.id, verifiedAt: new Date() } });
  const accepted = await staged({ ...payload, email: change === "alias" ? alias : email });
  const invite = await invitation(accepted.intent.id);
  if (change === "session") {
    // PostgreSQL owns credential generations and discards manual version changes.
    // Rotate the actual password so the previously issued mailbox proof is stale.
    const rotated = await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword("Rotated-password-999!") } });
    expect(rotated.sessionVersion).toBe(user.sessionVersion + 1);
  }
  if (change === "alias") await db.accountEmail.delete({ where: { email: alias } });
  if (change === "ownership") {
    await db.user.create({ data: { id: "new-owner", email: "new-owner@example.test", name: "New Owner" } });
    await db.user.update({ where: { id: user.id }, data: { studentId: null } });
    await db.studentProfileOwnership.update({ where: { tuteeId: tutee.id }, data: { userId: "new-owner" } });
  }
  await expect(redeemAccountInvitation(db, { ...profile, ...invite }, user.id)).rejects.toBeDefined();
  await unchangedSource(row.id, row);
  expect((await db.accountInvitation.findUniqueOrThrow({ where: { id: invite.invitationId } })).completedAt).toBeNull();
});

it("uses a verified alias to replace its owner's current request without proving or changing the primary mailbox", async () => {
  const { user, row, payload } = await existing();
  await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
  const alias = "secondary@example.test";
  await db.accountEmail.create({ data: { email: alias, userId: user.id, verifiedAt: new Date() } });
  const accepted = await staged({ ...payload, email: alias, preferredContact: "Alias replacement" });
  expect(accepted.intent.surveyId).toBe(row.id);
  await complete(accepted.intent.id, user.id);
  expect(await db.user.count()).toBe(1);
  expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
    email, emailVerifiedAt: null, passwordHash: user.passwordHash,
  });
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
    email, submittedAt: row.submittedAt, currentPayload: { preferredContact: "Alias replacement" },
  });
});

it("stages pending primary and verified-alias submissions on one account's single source before any tutee ownership exists", async () => {
  const { user } = await owner();
  await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
  const alias = "pending-secondary@example.test";
  await db.accountEmail.create({ data: { email: alias, userId: user.id, verifiedAt: new Date() } });
  const primary = await staged(await answers());
  const firstSource = await db.studentSurvey.findUniqueOrThrow({ where: { id: primary.intent.surveyId } });
  const secondary = await staged(await answers({ email: alias, preferredContact: "Alias request answers" }));
  expect(primary.intent.id).not.toBe(secondary.intent.id);
  expect(secondary.intent.surveyId).toBe(primary.intent.surveyId);
  expect(await db.studentSurvey.count()).toBe(1);
  expect(await db.tutee.count()).toBe(0);
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ studentId: null, emailVerifiedAt: null });
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: firstSource.id } })).toEqual(firstSource);
  await complete(secondary.intent.id, user.id);
  expect(await db.user.count()).toBe(1);
  expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ email, emailVerifiedAt: null, tuteeMember: true });
  expect(await db.studentProfileOwnership.count({ where: { userId: user.id } })).toBe(1);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: firstSource.id } })).toMatchObject({
    email, submittedAt: firstSource.submittedAt, payload: firstSource.payload,
    currentPayload: { preferredContact: "Alias request answers" }, currentVersion: 1,
  });
});

it.each([false, true])("safely completes %s unfinished-account setup without an email-driven duplicate identity", async (unfinished) => {
  const existingOwner = unfinished ? await owner({ unfinished: true }) : null;
  const accepted = await staged(await answers());
  expect(await db.user.count()).toBe(unfinished ? 1 : 0);
  const invite = await invitation(accepted.intent.id);
  await expect(redeemAccountInvitation(db, { ...profile, ...invite })).rejects.toMatchObject({
    code: "BAD_REQUEST", message: "INVITATION_PASSWORD_REQUIRED",
  });
  await redeemAccountInvitation(db, { ...profile, ...invite, password: "New-password-268!" });
  const user = await db.user.findFirstOrThrow({ where: { email } });
  expect(await db.user.count()).toBe(1);
  expect(user.tuteeMember).toBe(true);
  expect(verifyPassword("New-password-268!", user.passwordHash!)).toBe(true);
  if (existingOwner) expect(user).toMatchObject({ id: existingOwner.user.id, tutorId: existingOwner.tutor.id, name: existingOwner.user.name });
  const confirmed = await db.studentSurvey.findUniqueOrThrow({ where: { id: accepted.intent.surveyId } });
  expect(confirmed).toMatchObject({ submittedAt: accepted.intent.receivedAt, currentVersion: 1 });
  expect(confirmed.confirmedAt).toBeInstanceOf(Date);
  expect(await db.studentSignupRevision.count()).toBe(1);
});

it("refuses an established account that appears after invitation issuance instead of combining or replacing its credentials", async () => {
  const accepted = await staged(await answers());
  const invite = await invitation(accepted.intent.id);
  const { user } = await owner();
  await expect(redeemAccountInvitation(db, { ...profile, ...invite, password: "Posted-password-999!" }, user.id)).rejects.toBeDefined();
  expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
  expect(await db.studentSignupRevision.count()).toBe(0);
  expect(await db.tutee.count()).toBe(0);
});

it("accepts fresh exact-intent proof after the original link expires without extending its assignment verification deadline", async () => {
  const { user, row, payload } = await existing({ confirmed: false });
  await db.studentSurvey.update({ where: { id: row.id }, data: { expiresAt: new Date(0) } });
  const accepted = await staged({ ...payload, preferredContact: "Fresh proven contact" });
  expect(accepted.intent.expiresAt.getTime()).toBeLessThanOrEqual(row.verificationDueAt!.getTime());
  await complete(accepted.intent.id, user.id);
  const confirmed = await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } });
  expect(confirmed).toMatchObject({
    tokenHash: row.tokenHash, expiresAt: new Date(0), submittedAt: row.submittedAt,
    verificationDueAt: row.verificationDueAt,
  });
  expect(confirmed.confirmedAt).toBeInstanceOf(Date);
});

it("preserves accepted demand on delivery failure; exact response recovery never resends and send-only retry creates no revision", async () => {
  const { row, payload } = await existing({ confirmed: false });
  fixtures.send.mockRejectedValueOnce(new Error("Synthetic delivery failure"));
  const accepted = await staged(payload);
  expect(accepted.receipt.emailSent).toBe(false);
  const intentBefore = accepted.intent;
  expect(await recoverStudentSignupIntent(db, payload, accepted.clientKey)).toEqual(accepted.receipt);
  expect(fixtures.send).toHaveBeenCalledTimes(1);
  fixtures.send.mockRejectedValueOnce(new Error("Synthetic resend failure"));
  expect(await resendStudentSignupIntent(db, accepted.intent.id, email)).toEqual({ emailSent: false });
  expect(await db.studentSignupIntent.findUniqueOrThrow({ where: { id: accepted.intent.id } })).toEqual(intentBefore);
  expect(await resendStudentSignupIntent(db, accepted.intent.id, email)).toEqual({ emailSent: true });
  const after = await db.studentSignupIntent.findUniqueOrThrow({ where: { id: accepted.intent.id } });
  expect(after.tokenHash).not.toBe(intentBefore.tokenHash);
  expect(after.expiresAt).toEqual(intentBefore.expiresAt);
  expect(await recoverStudentSignupIntent(db, payload, accepted.clientKey)).toEqual({ ...accepted.receipt, emailSent: true });
  await unchangedSource(row.id, row);
});

it("successful send-only retry invalidates only that intent's older review proof; a failed send keeps it usable", async () => {
  const { user, row, payload } = await existing();
  const accepted = await staged(payload);
  const invite = await invitation(accepted.intent.id);
  fixtures.send.mockRejectedValueOnce(new Error("Synthetic resend failure"));
  await resendStudentSignupIntent(db, accepted.intent.id, email);
  expect(await anonymous().accountInvitation.review(invite)).toMatchObject({ existing: true });
  await resendStudentSignupIntent(db, accepted.intent.id, email);
  await expect(redeemAccountInvitation(db, { ...profile, ...invite }, user.id)).rejects.toMatchObject({
    message: "INVITATION_INVALID",
  });
  await unchangedSource(row.id, row);
  await complete(accepted.intent.id, user.id);
  expect(await db.studentSignupRevision.count()).toBe(1);
});

it("retains already explicit stage-time policy consent and requires separate acceptance of a policy published afterward", async () => {
  const { user, row, payload, acceptance } = await existing();
  const accepted = await staged({ ...payload, signatureName: "Stage-time Signature" });
  const invite = await invitation(accepted.intent.id);
  await db.policyDocument.update({
    where: { slug_locale: { slug: "tutee-policy", locale: "en" } },
    data: { body: "Published after this person's signed submission.", version: "2" },
  });
  const latest = await currentPolicy(db, "tutee-policy");
  await redeemAccountInvitation(db, { ...profile, ...invite }, user.id);
  expect(await db.studentSignupRevision.findFirstOrThrow()).toMatchObject({
    policyRevision: accepted.input.policyRevision, policySnapshot: accepted.intent.policySnapshot,
    signatureName: "Stage-time Signature", policyAcceptedAt: accepted.intent.receivedAt,
  });
  expect(await db.policyAcceptance.count({ where: { userId: user.id, revision: latest.revision } })).toBe(0);
  await expect(requirePolicy(db, user.id, "tutee-policy")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.policyAcceptance.findUniqueOrThrow({ where: { id: acceptance.id } })).toEqual(acceptance);
  expect(await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
    payload: row.payload, policyRevision: row.policyRevision, policySnapshot: row.policySnapshot,
    submittedAt: row.submittedAt, currentVersion: 1,
  });
});

it.each(["required-field", "subject", "slot", "grade"] as const)("rechecks changed %s requirements at final review and rolls back both receipts", async (change) => {
  const { user, row, payload } = await existing();
  const accepted = await staged(change === "grade" ? { ...payload, gradeLevel: "11" } : payload);
  const invite = await invitation(accepted.intent.id);
  if (change === "required-field") await db.programSettings.create({ data: { id: "program", signupFields: { tutee: { phone: "required" } } } });
  if (change === "subject") await db.subject.update({ where: { id: "science" }, data: { active: false } });
  if (change === "slot") await db.timeSlot.update({ where: { id: "monday" }, data: { active: false } });
  if (change === "grade") {
    await db.programSettings.create({ data: { id: "program", offeredGrades: [10] } });
  }
  await expect(redeemAccountInvitation(db, { ...profile, ...invite }, user.id)).rejects.toBeDefined();
  await unchangedSource(row.id, row);
  expect((await db.studentSignupIntent.findUniqueOrThrow({ where: { id: accepted.intent.id } })).completedAt).toBeNull();
  expect((await db.accountInvitation.findUniqueOrThrow({ where: { id: invite.invitationId } })).completedAt).toBeNull();
});

it.each(["suspension", "departure", "quarter-block", "rollover", "terminal", "deadline"] as const)("rechecks %s at completion rather than relying on staging", async (change) => {
  const { user, row, payload } = await existing({ confirmed: change !== "deadline" });
  const accepted = await staged(payload);
  const invite = await invitation(accepted.intent.id);
  if (change === "suspension") await db.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });
  if (change === "departure") await db.schoolDeparture.create({ data: { userId: user.id, reason: "GRADUATED", source: "HEAD" } });
  if (change === "quarter-block") await db.studentQuarterBlock.create({ data: { email, userId: user.id, surveyId: row.id, intakeTermId: termId } });
  if (change === "rollover") await db.term.update({ where: { id: termId }, data: { active: false } });
  if (change === "terminal") await db.studentSurvey.update({ where: { id: row.id }, data: { state: "ABORTED" } });
  if (change === "deadline") await db.studentSurvey.update({ where: { id: row.id }, data: { verificationDueAt: new Date(0) } });
  const current = await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } });
  await expect(redeemAccountInvitation(db, { ...profile, ...invite }, user.id)).rejects.toBeDefined();
  await unchangedSource(row.id, current);
});

it("preserves a hidden inactive assigned second choice in accepted intent answers and the current projection", async () => {
  const { user, tutor, tutee, payload, row } = await existing();
  await db.pairing.create({ data: {
    tutorId: tutor.id, termId, subject: "Science", tutees: { create: { tuteeId: tutee.id } },
    dayOfWeek: 1, startMin: 960, endMin: 1020,
  } });
  await db.subject.update({ where: { id: "science" }, data: { active: false } });
  await db.programSettings.create({ data: { id: "program", signupFields: { tutee: { secondSubject: "hidden" } } } });
  const accepted = await staged({ ...payload, preferredContact: "Edited other answer" });
  expect(accepted.intent.payload).toMatchObject({ secondChoiceId: "science" });
  await complete(accepted.intent.id, user.id);
  expect((await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } })).currentPayload).toMatchObject({ secondChoiceId: "science" });
  expect(await db.tutee.findUniqueOrThrow({ where: { id: tutee.id } })).toMatchObject({ secondChoiceId: "science" });
  expect((await db.studentSignupRevision.findFirstOrThrow()).answers).toMatchObject({ secondChoiceId: "science" });
});

it("rechecks a newly assigned subject and fails closed on an unresolved legacy assignment", async () => {
  const { user, tutor, tutee, row, payload } = await existing();
  const accepted = await staged({ ...payload, secondChoiceId: "writing" });
  const invite = await invitation(accepted.intent.id);
  const pairing = await db.pairing.create({
    data: {
      tutorId: tutor.id,
      termId,
      subject: "Science",
      tutees: { create: { tuteeId: tutee.id } },
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
    },
  });
  await expect(
    redeemAccountInvitation(db, { ...profile, ...invite }, user.id),
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
    message: "SIGNUP_ASSIGNED_SUBJECT_LOCKED",
  });
  await db.pairing.update({
    where: { id: pairing.id },
    data: { subject: "Unresolved historical label" },
  });
  await expect(
    redeemAccountInvitation(db, { ...profile, ...invite }, user.id),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    message: "SIGNUP_ASSIGNMENT_UNKNOWN",
  });
  await unchangedSource(row.id, row);
});

it("allows issued OPEN-request review after intake closes while refusing new public demand", async () => {
  const { user, row, payload } = await existing();
  const accepted = await staged(payload);
  await db.term.update({ where: { id: termId }, data: { signupClosesAt: new Date(0) } });
  await expect(validStudentSignupIntent(db, accepted.intent.id)).resolves.toMatchObject({ row: { id: row.id } });
  await complete(accepted.intent.id, user.id);
  await expect(stageStudentSignupIntent(db, await answers({ email: "new-demand@example.test" }), randomUUID())).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});
