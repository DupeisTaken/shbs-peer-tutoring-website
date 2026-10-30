import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn().mockResolvedValue(undefined) },
  isEmailDeliveryAvailable: () => true,
  isEmailConfigured: () => true,
}));
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  continuationStatus,
  joinContinuation,
  continuationReceipt,
} from "./student-continuation";
import { currentPolicy } from "./policy-acceptance";
import { inTransaction } from "./transactions";
import { lockStudentRequestReview } from "./request-invalidity";
import {
  surveyInput,
  surveyEmailCode,
  verifySurveyEmail,
} from "./student-survey";
import {
  stageStudentSignupIntent,
  verifyStudentSignupIntent,
  resendStudentSignupIntent,
} from "./student-signup-intents";
import {
  deliverAccountInvitation,
  verifyAccountInvitation,
} from "./auth/account-invitations";

const now = new Date("2026-10-30T08:20:00Z");
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((x) => '"' + x.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  await db.term.create({
    data: { id: "old", schoolYear: "26-27", quarter: "Q1", name: "Old" },
  });
  await db.term.create({
    data: {
      id: "new",
      schoolYear: "26-27",
      quarter: "Q2",
      name: "New",
      active: true,
      signupOpeningStateSince: new Date("2026-10-30T08:00:00Z"),
      signupFirstOpenedAt: new Date("2026-10-30T08:00:00Z"),
      continuationSourceTermId: "old",
      continuationQuarterTransition: true,
    },
  });
  await db.subject.createMany({
    data: [
      { id: "math", name: "Mathematics" },
      { id: "science", name: "Science" },
    ],
  });
  await db.timeSlot.createMany({
    data: [
      {
        id: "slot",
        label: "Monday",
        dayOfWeek: 1,
        startMin: 960,
        endMin: 1005,
      },
      {
        id: "slot2",
        label: "Tuesday",
        dayOfWeek: 2,
        startMin: 960,
        endMin: 1005,
      },
    ],
  });
  await db.room.create({ data: { id: "room", name: "Synthetic room" } });
  await db.policyDocument.create({
    data: {
      slug: "tutee-policy",
      locale: "en",
      title: "Policy",
      body: "Synthetic current policy",
    },
  });
  await db.tutee.create({
    data: {
      id: "prior",
      englishName: "Test Learner",
      firstName: "Test",
      lastName: "Learner",
      email: "learner@example.test",
      firstChoiceId: "math",
      secondChoiceId: "science",
      preferredContact: "In-app messages",
      intakeTermId: "old",
      status: "INACTIVE",
      availabilities: { create: [{ slotId: "slot" }, { slotId: "slot2" }] },
    },
  });
  await db.user.create({
    data: {
      id: "owner",
      email: "learner@example.test",
      firstName: "Test",
      lastName: "Learner",
      name: "Test Learner",
      username: "testlearner",
      passwordHash: "synthetic-not-an-authentication-test",
      emailVerifiedAt: now,
      role: "STUDENT",
      studentId: "prior",
      tuteeMember: true,
      academicProfile: {
        create: {
          status: "REPORTED",
          gradeLevel: 10,
          rawGrade: "10",
          schoolYear: "26-27",
          confirmedAt: now,
        },
      },
    },
  });
  await db.studentProfileOwnership.create({
    data: { userId: "owner", tuteeId: "prior" },
  });
  await db.tutor.create({
    data: {
      id: "tutor",
      englishName: "Test Tutor",
      username: "testtutor",
      status: "ACTIVE",
    },
  });
  await db.user.create({
    data: {
      id: "tutor-user",
      email: "tutor@example.test",
      name: "Test Tutor",
      role: "TUTOR",
      tutorId: "tutor",
      emailVerifiedAt: now,
    },
  });
  await db.tutorAvailability.createMany({
    data: [
      { tutorId: "tutor", slotId: "slot" },
      { tutorId: "tutor", slotId: "slot2" },
    ],
  });
  await db.tutorSubjectWillingness.createMany({
    data: [
      { tutorId: "tutor", subjectId: "math", willing: true },
      { tutorId: "tutor", subjectId: "science", willing: true },
    ],
  });
  await db.tutorQualification.createMany({
    data: [
      { tutorId: "tutor", subjectId: "math", approvedById: "staff" },
      { tutorId: "tutor", subjectId: "science", approvedById: "staff" },
    ],
  });
  await db.qualificationGrant.createMany({
    data: [
      { tutorId: "tutor", subjectId: "math", sourceSubjectId: "math" },
      { tutorId: "tutor", subjectId: "science", sourceSubjectId: "science" },
    ],
  });
  await db.pairing.createMany({
    data: [
      {
        id: "old-math",
        tutorId: "tutor",
        termId: "old",
        subject: "Mathematics",
        dayOfWeek: 1,
        startMin: 960,
        endMin: 1005,
        scheduleConfirmed: true,
        timeSlotId: "slot",
        roomId: "room",
      },
      {
        id: "old-science",
        tutorId: "tutor",
        termId: "old",
        subject: "Science",
        dayOfWeek: 2,
        startMin: 960,
        endMin: 1005,
        scheduleConfirmed: true,
        timeSlotId: "slot2",
        roomId: "room",
      },
    ],
  });
  await db.pairingTutee.createMany({
    data: [
      { pairingId: "old-math", tuteeId: "prior" },
      { pairingId: "old-science", tuteeId: "prior" },
    ],
  });
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

async function input(pairings = ["old-math"]) {
  const status = await continuationStatus(db, "owner");
  return {
    clientKey: randomUUID(),
    revision: status.revision,
    sourcePairingIds: pairings,
    policyRevision: (await currentPolicy(db, "tutee-policy")).revision,
    agreed: true as const,
    signatureName: "Test Learner",
  };
}

async function publicAnswers(email = "learner@example.test") {
  return surveyInput.parse({
    firstName: "Test",
    lastName: "Learner",
    englishName: "Test Learner",
    email,
    preferredContact: "In-app messages",
    gradeLevel: "10",
    firstChoiceId: "math",
    secondChoiceId: "science",
    slotIds: ["slot", "slot2"],
    signatureName: "Test Learner",
    agreed: true,
    policyRevision: (await currentPolicy(db, "tutee-policy")).revision,
  });
}

async function ordinaryRequest(email = "learner@example.test") {
  const policy = await currentPolicy(db, "tutee-policy");
  return db.studentSurvey.create({
    data: {
      email,
      intakeTermId: "new",
      payload: await publicAnswers(email),
      tokenHash: "a".repeat(64),
      emailCodeVersion: 1,
      expiresAt: new Date(+now + 86400000),
      policyRevision: policy.revision,
      policySnapshot: policy.documents,
    },
  });
}

it("keeps an unconfirmed ordinary request visible and permits recorded continuation additions after adoption", async () => {
  const row = await ordinaryRequest();
  expect(await continuationStatus(db, "owner")).toMatchObject({
    status: "eligible",
    hasFreshRequest: false,
  });
  const first = await joinContinuation(db, "owner", await input());
  expect(first.requestId).toBe(row.id);
  expect(await continuationStatus(db, "owner")).toMatchObject({
    status: "eligible",
    hasFreshRequest: false,
  });
  const addition = await joinContinuation(
    db,
    "owner",
    await input(["old-science"]),
  );
  expect(addition.requestId).toBe(row.id);
  expect(addition.version).toBe(2);
});

it("suppresses on legacy mailbox proof before account review, preserves that event through recall, and refuses stale joins", async () => {
  const row = await ordinaryRequest();
  const posted = await input();
  await expect(verifySurveyEmail(db, row.email, "WRONG")).rejects.toMatchObject(
    { code: "BAD_REQUEST" },
  );
  expect((await continuationStatus(db, "owner")).hasFreshRequest).toBe(false);
  await verifySurveyEmail(db, row.email, surveyEmailCode(row.tokenHash));
  const verified = await db.studentSurvey.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(verified.confirmedAt).toBeNull();
  expect(verified.publicSignupEmailConfirmedAt).toEqual(now);
  await expect(
    db.studentSurvey.update({
      where: { id: row.id },
      data: { publicSignupEmailConfirmedAt: null },
    }),
  ).rejects.toThrow("Public signup email confirmation cannot be reset");
  expect(await continuationStatus(db, "owner")).toMatchObject({
    status: "unavailable",
    hasFreshRequest: true,
  });
  await expect(joinContinuation(db, "owner", posted)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  await db.studentSurvey.update({
    where: { id: row.id },
    data: { state: "RECALLED", resolvedAt: now },
  });
  expect((await continuationStatus(db, "owner")).hasFreshRequest).toBe(true);
  expect(await db.studentContinuationReceipt.count()).toBe(0);
});

it("suppresses a verified public replacement of a continuation request while retaining exact receipt recovery", async () => {
  const posted = await input();
  const first = await joinContinuation(db, "owner", posted);
  const staged = await stageStudentSignupIntent(
    db,
    await publicAnswers(),
    randomUUID(),
  );
  const intent = await db.studentSignupIntent.findUniqueOrThrow({
    where: { id: staged.intentId },
  });
  expect(intent.surveyId).toBe(first.requestId);
  expect((await continuationStatus(db, "owner")).hasFreshRequest).toBe(false);
  await verifyStudentSignupIntent(
    db,
    intent.id,
    intent.email,
    surveyEmailCode(intent.tokenHash),
  );
  const status = await continuationStatus(db, "owner");
  expect(status).toMatchObject({
    status: "unavailable",
    hasFreshRequest: true,
  });
  expect(status.currentRequest?.id).toBe(first.requestId);
  expect(
    status.candidates.find((row) => row.sourcePairingId === "old-math")
      ?.requested,
  ).toBe(true);
  await expect(
    joinContinuation(db, "owner", await input(["old-science"])),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await joinContinuation(db, "owner", posted)).toEqual(first);
  expect(await continuationReceipt(db, "owner", posted.clientKey)).toEqual(
    first,
  );
  vi.setSystemTime(new Date(+now + 10000));
  await resendStudentSignupIntent(db, intent.id, intent.email);
  expect(
    (
      await db.studentSignupIntent.findUniqueOrThrow({
        where: { id: intent.id },
      })
    ).verifiedAt,
  ).toBeNull();
  expect((await continuationStatus(db, "owner")).hasFreshRequest).toBe(true);
  expect(
    (
      await db.studentSurvey.findUniqueOrThrow({
        where: { id: first.requestId },
      })
    ).publicSignupEmailConfirmedAt,
  ).toEqual(now);
});

it("serializes a fresh join behind an in-flight public mailbox confirmation", async () => {
  const row = await ordinaryRequest();
  const posted = await input();
  let verified!: () => void;
  const proofRecorded = new Promise<void>((resolve) => {
    verified = resolve;
  });
  let commit!: () => void;
  const allowCommit = new Promise<void>((resolve) => {
    commit = resolve;
  });
  const confirmation = db.$transaction(async (tx) => {
    await verifySurveyEmail(tx, row.email, surveyEmailCode(row.tokenHash));
    verified();
    await allowCommit;
  });
  await proofRecorded;
  const joined = expect(
    joinContinuation(db, "owner", posted),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  commit();
  await Promise.all([confirmation, joined]);
  expect(await db.studentContinuationReceipt.count()).toBe(0);
  expect(await db.studentContinuationAssignment.count()).toBe(0);
});

it("does not treat an emailed invitation issuance as confirmation but suppresses after its exact mailbox code", async () => {
  const row = await ordinaryRequest();
  const issued = await deliverAccountInvitation(db, {
    kind: "TUTEE",
    email: row.email,
    sourceKey: `tutee:${row.id}:${row.tokenHash}`,
    source: { type: "tutee", tokenHash: row.tokenHash },
    code: "1234",
  });
  expect((await continuationStatus(db, "owner")).hasFreshRequest).toBe(false);
  await verifyAccountInvitation(db, {
    invitationId: issued.invitationId,
    email: row.email,
    code: "1234",
  });
  expect((await continuationStatus(db, "owner")).hasFreshRequest).toBe(true);
  expect(
    (await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }))
      .confirmedAt,
  ).toBeNull();
});

it("suppresses after the legacy link's explicit displayed-receipt POST and recovers that proof without extending it", async () => {
  const row = await ordinaryRequest();
  const delivery = {
    display: true,
    kind: "TUTEE",
    email: row.email,
    sourceKey: `tutee:${row.id}:${row.tokenHash}`,
    source: { type: "tutee" as const, tokenHash: row.tokenHash },
  };
  expect((await continuationStatus(db, "owner")).hasFreshRequest).toBe(false);
  const receipt = await deliverAccountInvitation(db, delivery);
  expect((await continuationStatus(db, "owner")).hasFreshRequest).toBe(true);
  vi.setSystemTime(new Date(+now + 10000));
  expect(await deliverAccountInvitation(db, delivery)).toEqual(receipt);
  expect(
    (await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }))
      .publicSignupEmailConfirmedAt,
  ).toEqual(now);
  expect(
    (await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }))
      .confirmedAt,
  ).toBeNull();
});

it("uses verified aliases and destination-quarter history for suppression without trusting unrelated addresses", async () => {
  const row = await ordinaryRequest("alias@example.test");
  await db.studentSurvey.update({
    where: { id: row.id },
    data: { confirmedAt: now, state: "RECALLED" },
  });
  await db.accountEmail.create({ data: { userId: "owner", email: row.email } });
  expect((await continuationStatus(db, "owner")).hasFreshRequest).toBe(false);
  await db.accountEmail.update({
    where: { email: row.email },
    data: { verifiedAt: now },
  });
  expect((await continuationStatus(db, "owner")).hasFreshRequest).toBe(true);
  const policy = await currentPolicy(db, "tutee-policy");
  await db.studentSurvey.create({
    data: {
      intakeTermId: "old",
      email: "learner@example.test",
      tokenHash: "b".repeat(64),
      payload: await publicAnswers(),
      policyRevision: policy.revision,
      policySnapshot: policy.documents,
      expiresAt: new Date(+now + 86400000),
      confirmedAt: now,
    },
  });
  await db.accountEmail.delete({ where: { email: row.email } });
  expect((await continuationStatus(db, "owner")).hasFreshRequest).toBe(false);
});

it("takes an existing request lock before settling the term, alongside legacy request actions", async () => {
  const first = await joinContinuation(db, "owner", await input());
  const posted = await input(["old-science"]);
  const row = await db.studentSurvey.findUniqueOrThrow({
    where: { id: first.requestId },
  });
  let locked!: () => void;
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const legacy = inTransaction(db, async (tx) => {
    await lockStudentRequestReview(tx, row);
    locked();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await tx.$queryRaw`SELECT id FROM "Term" WHERE id = ${row.intakeTermId} FOR SHARE`;
    await tx.notification.create({
      data: { userId: "owner", title: "Synthetic request notice" },
    });
  });
  await acquired;
  const [next] = await Promise.all([
    joinContinuation(db, "owner", posted),
    legacy,
  ]);
  expect(next.requestId).toBe(first.requestId);
  expect(next.version).toBe(2);
});

it("files a new owned request, restores the weekly time, and keeps the previous enrollment unchanged", async () => {
  const result = await joinContinuation(db, "owner", await input());
  expect(result.results[0]?.state).toBe("assigned");
  const row = await db.studentSurvey.findUniqueOrThrow({
    where: { id: result.requestId },
  });
  expect(row.intakeTermId).toBe("new");
  expect(row.submittedAt).toEqual(now);
  expect(row.confirmedAt).toEqual(now);
  expect(row.tuteeId).not.toBe("prior");
  expect(
    await db.studentProfileOwnership.count({ where: { userId: "owner" } }),
  ).toBe(2);
  expect(await db.pairingTutee.count({ where: { tuteeId: "prior" } })).toBe(2);
  const pairing = await db.pairing.findFirstOrThrow({
    where: { termId: "new" },
  });
  expect([
    pairing.dayOfWeek,
    pairing.startMin,
    pairing.endMin,
    pairing.scheduleConfirmed,
  ]).toEqual([1, 960, 1005, true]);
});

it("keeps valid demand and partial assignments when one selected tutor slot is unavailable", async () => {
  await db.tutorAvailability.delete({
    where: { tutorId_slotId: { tutorId: "tutor", slotId: "slot2" } },
  });
  const result = await joinContinuation(
    db,
    "owner",
    await input(["old-math", "old-science"]),
  );
  expect(result.results.map((x) => x.state)).toEqual(["assigned", "queued"]);
  expect(await db.studentSurvey.count()).toBe(1);
  expect(await db.studentContinuationAssignment.count()).toBe(2);
  expect(
    (await continuationStatus(db, "owner")).candidates.every(
      (x) => x.requested,
    ),
  ).toBe(true);
});

it("records additions on the same request without resetting its submission priority or original consent", async () => {
  const first = await joinContinuation(db, "owner", await input());
  const before = await db.studentSurvey.findUniqueOrThrow({
    where: { id: first.requestId },
  });
  vi.setSystemTime(new Date(+now + 10_000));
  const next = await joinContinuation(
    db,
    "owner",
    await input(["old-science"]),
  );
  expect(next.requestId).toBe(first.requestId);
  expect(next.version).toBe(2);
  const after = await db.studentSurvey.findUniqueOrThrow({
    where: { id: first.requestId },
  });
  expect(after.payload).toEqual(before.payload);
  expect(after.submittedAt).toEqual(before.submittedAt);
  expect(
    await db.studentSignupRevision.count({
      where: { surveyId: first.requestId },
    }),
  ).toBe(2);
});

it("recovers concurrent exact retries and preserves receipt recovery after the hour expires", async () => {
  const posted = await input();
  const [a, b] = await Promise.all([
    joinContinuation(db, "owner", posted),
    joinContinuation(db, "owner", posted),
  ]);
  expect(a).toEqual(b);
  expect(await db.studentSurvey.count()).toBe(1);
  vi.setSystemTime(new Date("2026-10-30T09:00:00Z"));
  expect((await continuationStatus(db, "owner")).status).toBe("expired");
  expect(await continuationReceipt(db, "owner", posted.clientKey)).toEqual(a);
  expect(await joinContinuation(db, "owner", posted)).toEqual(a);
  await expect(
    joinContinuation(db, "owner", { ...posted, signatureName: "Changed" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("rejects stale request versions and unauthorized source selections without writing demand", async () => {
  const posted = await input();
  await expect(
    joinContinuation(db, "owner", {
      ...posted,
      sourcePairingIds: ["not-owned"],
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await joinContinuation(db, "owner", posted);
  await expect(
    joinContinuation(db, "owner", {
      ...posted,
      clientKey: randomUUID(),
      sourcePairingIds: ["old-science"],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.studentSurvey.count()).toBe(1);
});

it("uses the first opening despite a pause and refuses exactly at the exclusive deadline", async () => {
  const posted = await input();
  await db.term.update({
    where: { id: "new" },
    data: { signupEnabled: false },
  });
  expect((await continuationStatus(db, "owner")).status).toBe("paused");
  await expect(joinContinuation(db, "owner", posted)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  await db.term.update({ where: { id: "new" }, data: { signupEnabled: true } });
  vi.setSystemTime(new Date("2026-10-30T09:00:00Z"));
  await expect(joinContinuation(db, "owner", posted)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  expect(await db.studentSurvey.count()).toBe(0);
});

it("rolls back request, ownership, assignment and receipt together on enclosing failure", async () => {
  const posted = await input();
  await expect(
    db.$transaction(async (tx) => {
      await joinContinuation(tx, "owner", posted);
      throw new Error("synthetic rollback");
    }),
  ).rejects.toThrow("synthetic rollback");
  expect(await db.studentSurvey.count()).toBe(0);
  expect(await db.studentContinuationReceipt.count()).toBe(0);
  expect(await db.pairing.count({ where: { termId: "new" } })).toBe(0);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: "owner" } })).studentId,
  ).toBe("prior");
});

it("denies suspended users and current-quarter withdrawal blocks", async () => {
  const posted = await input();
  await db.studentQuarterBlock.create({
    data: {
      email: "learner@example.test",
      userId: "owner",
      intakeTermId: "new",
      surveyId: "historic-block",
    },
  });
  await expect(joinContinuation(db, "owner", posted)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  await db.user.update({ where: { id: "owner" }, data: { suspendedAt: now } });
  await expect(continuationStatus(db, "owner")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it("preserves current local answers and cleared optional names when an addition uses newly hidden controls", async () => {
  const first = await joinContinuation(db, "owner", await input());
  await db.studentSurvey.update({
    where: { id: first.requestId },
    data: {
      currentPayload: {
        firstName: "Request",
        lastName: "Learner",
        englishName: "Request Learner",
        phone: "synthetic-contact",
        preferredContact: "Request contact",
        gradeLevel: "10",
        firstChoiceId: "math",
        slotIds: ["slot"],
      },
    },
  });
  await db.user.update({
    where: { id: "owner" },
    data: { firstName: "Account", preferredName: "Account nickname" },
  });
  await db.programSettings.upsert({
    where: { id: "program" },
    create: {
      id: "program",
      signupFields: {
        tutee: {
          gradeLevel: "hidden",
          phone: "hidden",
          preferredContact: "hidden",
          signatureName: "hidden",
        },
      },
    },
    update: {
      signupFields: {
        tutee: {
          gradeLevel: "hidden",
          phone: "hidden",
          preferredContact: "hidden",
          signatureName: "hidden",
        },
      },
    },
  });
  await joinContinuation(db, "owner", await input(["old-science"]));
  const row = await db.studentSurvey.findUniqueOrThrow({
    where: { id: first.requestId },
  });
  expect(row.currentPayload).toEqual({
    firstName: "Request",
    lastName: "Learner",
    englishName: "Request Learner",
    phone: "synthetic-contact",
    preferredContact: "Request contact",
    gradeLevel: "10",
    firstChoiceId: "math",
    secondChoiceId: "science",
    slotIds: ["slot", "slot2"],
  });
  const revision = await db.studentSignupRevision.findFirstOrThrow({
    where: { surveyId: row.id },
    orderBy: { version: "desc" },
  });
  expect(revision.signatureName).toBe("Test Learner");
});

it("does not revive an expired unconfirmed request before the deadline worker runs", async () => {
  await db.studentSurvey.create({
    data: {
      id: "expired",
      email: "learner@example.test",
      intakeTermId: "new",
      payload: {
        englishName: "Test Learner",
        preferredContact: "In-app messages",
        firstChoiceId: "math",
        slotIds: ["slot"],
      },
      tokenHash: "synthetic-expired-token",
      expiresAt: now,
      verificationDueAt: now,
      policyRevision: "synthetic",
      policySnapshot: {},
    },
  });
  expect(
    (await continuationStatus(db, "owner")).prerequisites.fieldsRequired,
  ).toContain("requestReview");
  await expect(
    joinContinuation(db, "owner", await input()),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(
    await db.studentSurvey.findUniqueOrThrow({ where: { id: "expired" } }),
  ).toMatchObject({
    state: "OPEN",
    confirmedAt: null,
    currentVersion: 0,
  });
  expect(await db.studentContinuationReceipt.count()).toBe(0);
  expect(await db.studentContinuationAssignment.count()).toBe(0);
});

it("reports a missing historical subject mapping separately from the two-subject limit", async () => {
  await db.subject.update({
    where: { id: "science" },
    data: { name: "Renamed science" },
  });
  const status = await continuationStatus(db, "owner");
  expect(
    status.candidates.find((x) => x.sourcePairingId === "old-science"),
  ).toMatchObject({
    subjectId: "",
    reason: "subjectUnavailable",
  });
  await expect(
    joinContinuation(db, "owner", await input(["old-science"])),
  ).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
    message: "CONTINUATION_SUBJECT_UNAVAILABLE",
  });
  expect(await db.studentSurvey.count()).toBe(0);
  expect(
    (await joinContinuation(db, "owner", await input())).results[0]?.state,
  ).toBe("assigned");
});

it("conceals a matched-email current request and its choices when another account owns its profile", async () => {
  await db.tutee.create({
    data: {
      id: "foreign-profile",
      englishName: "Private Other Learner",
      email: "other@example.test",
      preferredContact: "Private contact",
      firstChoiceId: "science",
      intakeTermId: "new",
    },
  });
  await db.user.create({
    data: {
      id: "foreign-owner",
      email: "other@example.test",
      role: "STUDENT",
      studentId: "foreign-profile",
      tuteeMember: true,
    },
  });
  await db.studentProfileOwnership.create({
    data: { userId: "foreign-owner", tuteeId: "foreign-profile" },
  });
  await db.studentSurvey.create({
    data: {
      id: "foreign-request",
      email: "learner@example.test",
      intakeTermId: "new",
      tuteeId: "foreign-profile",
      currentVersion: 0,
      confirmedAt: now,
      payload: {
        englishName: "Private Other Learner",
        preferredContact: "Private contact",
        firstChoiceId: "science",
        slotIds: ["slot2"],
      },
      tokenHash: "synthetic-foreign-token",
      expiresAt: now,
      policyRevision: "synthetic",
      policySnapshot: {},
    },
  });
  await db.studentContinuationAssignment.create({
    data: {
      surveyId: "foreign-request",
      tuteeId: "foreign-profile",
      sourcePairingId: "old-math",
      sourceTuteeId: "prior",
      targetTermId: "new",
      tutorId: "tutor",
      snapshot: {},
      status: "RELEASED",
      reason: "SLOT_UNAVAILABLE",
      releasedAt: now,
    },
  });
  const status = await continuationStatus(db, "owner");
  expect(status.currentRequest).toBeNull();
  expect(status.prerequisites.fieldsRequired).toContain("requestReview");
  expect(status.candidates.every((row) => !row.requested)).toBe(true);
  expect(JSON.stringify(status)).not.toContain("foreign-request");
  expect(JSON.stringify(status)).not.toContain("Private Other Learner");
  await expect(
    joinContinuation(db, "owner", await input()),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.studentSurvey.count()).toBe(1);
  expect(await db.studentContinuationReceipt.count()).toBe(0);
});

it("requires the configured second subject before filing a new continuation request", async () => {
  await db.programSettings.upsert({
    where: { id: "program" },
    create: {
      id: "program",
      signupFields: { tutee: { secondSubject: "required" } },
    },
    update: { signupFields: { tutee: { secondSubject: "required" } } },
  });
  expect((await continuationStatus(db, "owner")).minimumSubjects).toBe(2);
  await expect(
    joinContinuation(db, "owner", await input(["old-math"])),
  ).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
    message: "CONTINUATION_DETAILS_REQUIRED",
  });
  expect(await db.studentSurvey.count()).toBe(0);
  expect(await db.studentContinuationReceipt.count()).toBe(0);
  const result = await joinContinuation(
    db,
    "owner",
    await input(["old-math", "old-science"]),
  );
  expect(result.results.map((row) => row.state)).toEqual([
    "assigned",
    "assigned",
  ]);
  expect(await db.studentSurvey.count()).toBe(1);
  expect(await db.studentContinuationAssignment.count()).toBe(2);
});
