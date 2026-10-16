import { randomUUID } from "node:crypto";
import type { EmailMessage } from "./email/sender";
import { beforeEach, afterAll, expect, it, vi } from "vitest";
const send = vi.hoisted(() =>
  vi
    .fn<(message: EmailMessage) => Promise<void>>()
    .mockResolvedValue(undefined),
);
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("./email/sender", () => ({
  emailSender: { send },
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "./db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  setStudentRequestInvalidity,
  assertRequestProcessable,
} from "./request-invalidity";
import {
  appealStudentSignup,
  inspectSignupAppeal,
  resolveStudentSignupAppeal,
  deliverSignupNotice,
  deliverSignupNotices,
  modernSignupAppealUrl,
} from "./student-signup-appeals";
import { requestAppealToken } from "./email/request-appeal-token";
import {
  requestAppealStatus,
  submitRequestAppeal,
  declineRequestAppeal,
} from "./email/request-appeal";
import { databaseScope, afterCommitScope } from "./db-scope";
import { currentPolicy } from "./policy-acceptance";
import { surveyInput } from "~/lib/student-signup";
import { studentRequestRows } from "./student-workflow";
import { unassignStudentSignup } from "./student-signup-management";
import { createCaller } from "./api/root";
import {
  editOwnedStudentSignup,
  studentSignupAnswersInput,
} from "./student-signup-editor";

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  send.mockReset().mockResolvedValue(undefined);
  await db.term.create({
    data: {
      id: "term",
      name: "Synthetic",
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
    ],
  });
  await db.timeSlot.create({
    data: {
      id: "slot",
      label: "Monday",
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
    },
  });
  await db.policyDocument.create({
    data: {
      slug: "tutee-policy",
      locale: "en",
      title: "Policy",
      body: "Exact original policy",
    },
  });
  for (const role of ["HEAD", "ADMIN", "COORDINATOR"] as const)
    await db.user.create({
      data: {
        id: role,
        role,
        email: role.toLowerCase() + "@example.test",
        username: role.toLowerCase(),
        name: role,
      },
    });
});
afterAll(() => db.$disconnect());
async function fixture(confirmed = true) {
  const policy = await currentPolicy(db, "tutee-policy");
  const payload = surveyInput.parse({
    englishName: "Original Request",
    email: "owner@example.test",
    preferredContact: "Original contact",
    firstChoiceId: "math",
    slotIds: ["slot"],
    signatureName: "Original Signature",
    agreed: true,
    policyRevision: policy.revision,
  });
  const tutee = confirmed
    ? await db.tutee.create({
        data: {
          id: "tutee",
          englishName: "Canonical Name",
          email: payload.email,
          signupSource: "SELF_SERVICE",
          intakeTermId: "term",
          firstChoiceId: "math",
          availabilities: { create: { slotId: "slot" } },
        },
      })
    : null;
  if (tutee) {
    await db.user.create({
      data: {
        id: "owner",
        email: payload.email,
        username: "owner",
        studentId: tutee.id,
        emailVerifiedAt: new Date(),
        tuteeMember: true,
      },
    });
    await db.studentProfileOwnership.create({
      data: { userId: "owner", tuteeId: tutee.id },
    });
    await db.policyAcceptance.create({
      data: {
        userId: "owner",
        slug: "tutee-policy",
        revision: policy.revision,
        snapshot: policy.documents,
        signature: payload.signatureName,
      },
    });
  }
  const row = await db.studentSurvey.create({
    data: {
      id: "source",
      email: payload.email,
      intakeTermId: "term",
      payload,
      policyRevision: policy.revision,
      policySnapshot: policy.documents,
      tuteeId: tutee?.id,
      confirmedAt: confirmed ? new Date() : null,
      tokenHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 86400000),
      submittedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });
  return { row, payload, tutee };
}
const flag = (version = 0) =>
  setStudentRequestInvalidity(
    db,
    {
      id: "source",
      invalid: true,
      reason: "SECRET STAFF NOTE",
      expectedInvalidityVersion: version,
    },
    { id: "HEAD" },
  );
function proof() {
  const mail = [...send.mock.calls]
    .reverse()
    .find(([message]) => /#token=[a-f0-9]{64}/.test(message.text));
  return /#token=([a-f0-9]{64})/.exec(mail![0].text)![1]!;
}
async function ticket(action: string, target: string, userId = "HEAD") {
  return (
    await db.studentActionConfirmation.create({
      data: {
        userId,
        action,
        target,
        readyAt: new Date(0),
        expiresAt: new Date(Date.now() + 60000),
      },
    })
  ).id;
}
const staff = (role: "HEAD" | "ADMIN" | "COORDINATOR") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: role,
        name: role,
        email: role.toLowerCase() + "@example.test",
      },
      role,
      tutorId: null,
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
  });

it("delivers participant-facing reason only to the verified request owner and keeps its appeal processing-blocked", async () => {
  await fixture();
  await flag();
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0].text).toContain("SECRET STAFF NOTE");
  const token = proof();
  const inspected = await inspectSignupAppeal(db, token);
  expect(inspected).toMatchObject({ canAppeal: true, invalidityVersion: 1 });
  expect(JSON.stringify(inspected)).not.toContain("SECRET");
  const input = {
    token,
    reason: "Please verify with my school adviser.",
    clientKey: randomUUID(),
  };
  const receipt = await appealStudentSignup(db, input);
  expect(await appealStudentSignup(db, input)).toEqual(receipt);
  const row = await db.studentSurvey.findUniqueOrThrow({
    where: { id: "source" },
  });
  expect(() => assertRequestProcessable(row)).toThrow();
  expect(
    (await studentRequestRows(db, undefined, undefined, true))[0],
  ).toMatchObject({
    appeal: { id: receipt.appealId, state: "PENDING", reason: input.reason },
  });
});
it("unverified flag mail supports source-specific appeal without creating an account", async () => {
  await fixture(false);
  await flag();
  expect(send.mock.calls[0]![0].text).not.toContain("SECRET STAFF NOTE");
  await appealStudentSignup(db, {
    token: proof(),
    reason: "This is my genuine request",
    clientKey: randomUUID(),
  });
  expect(await db.user.count()).toBe(3);
  expect(await db.tutee.count()).toBe(0);
});

it("uses one shared flag receipt and retires generic survey tokens without modifying historical appeal evidence", async () => {
  await fixture();
  await flag();
  const receipt = await db.emailDelivery.findFirstOrThrow({
    where: { requestKind: "survey" },
  });
  expect(receipt.status).toBe("SENT");
  expect(
    await db.emailDelivery.count({ where: { requestKind: "survey" } }),
  ).toBe(1);
  expect(send).toHaveBeenCalledOnce();
  await deliverSignupNotices(db);
  await deliverSignupNotice(
    db,
    (await db.studentSignupNotice.findFirstOrThrow()).id,
  );
  expect(send).toHaveBeenCalledOnce();
  const oldToken = requestAppealToken(receipt.id, receipt.createdAt);
  expect(await requestAppealStatus(oldToken, db)).toEqual({
    status: "invalid",
  });
  expect(
    await submitRequestAppeal(
      oldToken,
      "Do not create a second appeal pipeline",
      db,
    ),
  ).toEqual({ status: "invalid" });
  const historical = await db.requestInvalidityAppeal.create({
    data: {
      noticeId: receipt.id,
      body: "Immutable earlier generic survey appeal",
    },
  });
  await expect(
    declineRequestAppeal(
      db,
      {
        kind: "survey",
        id: "source",
        appealId: historical.id,
        expectedReviewVersion: 0,
        reason: "Must use modern review",
      },
      { id: "HEAD" },
    ),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(
    await db.requestInvalidityAppeal.findUniqueOrThrow({
      where: { id: historical.id },
    }),
  ).toEqual(historical);
  expect(await db.studentSignupAppeal.count()).toBe(0);
});

it("never resolves a shared receipt to a later flag, transferred mailbox or ended signup period", async () => {
  await fixture();
  await flag();
  expect(
    await modernSignupAppealUrl(db, "source", 1, "owner@example.test"),
  ).toContain("/tutee-signup/appeal#token=");
  await db.user.update({
    where: { id: "owner" },
    data: { email: "replacement@example.test", emailVerifiedAt: new Date() },
  });
  expect(
    await modernSignupAppealUrl(db, "source", 1, "owner@example.test"),
  ).toBeNull();
  await db.user.update({
    where: { id: "owner" },
    data: { email: "owner@example.test", emailVerifiedAt: new Date() },
  });
  await setStudentRequestInvalidity(
    db,
    {
      id: "source",
      invalid: false,
      reason: "Corrected before reflag",
      expectedInvalidityVersion: 1,
    },
    { id: "HEAD" },
  );
  await flag(2);
  expect(
    await modernSignupAppealUrl(db, "source", 1, "owner@example.test"),
  ).toBeNull();
  expect(
    await modernSignupAppealUrl(db, "source", 3, "owner@example.test"),
  ).toContain("#token=");
  await db.term.update({ where: { id: "term" }, data: { active: false } });
  expect(
    await modernSignupAppealUrl(db, "source", 3, "owner@example.test"),
  ).toBeNull();
});
it("unverified assigned source and a newly created mailbox account can appeal without gaining ownership", async () => {
  const { payload } = await fixture(false);
  const tutee = await db.tutee.create({
    data: {
      englishName: payload.englishName,
      email: payload.email,
      signupSource: "SELF_SERVICE",
      intakeTermId: "term",
      firstChoiceId: "math",
    },
  });
  await db.studentSurvey.update({
    where: { id: "source" },
    data: { tuteeId: tutee.id },
  });
  const tutor = await db.tutor.create({
    data: { englishName: "Tutor", status: "ACTIVE" },
  });
  await db.pairing.create({
    data: {
      tutorId: tutor.id,
      termId: "term",
      subject: "Mathematics",
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
      tutees: { create: { tuteeId: tutee.id } },
    },
  });
  await db.user.create({
    data: {
      id: "new-viewer",
      email: payload.email,
      username: "newviewer",
      emailVerifiedAt: new Date(),
    },
  });
  await flag();
  await appealStudentSignup(db, {
    token: proof(),
    reason: "Please verify my pending request",
    clientKey: randomUUID(),
  });
  expect(await db.studentProfileOwnership.count()).toBe(0);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: "new-viewer" } }))
      .studentId,
  ).toBeNull();
});
it("rejects mailbox transfer, new flag generation and historical appeals", async () => {
  await fixture();
  await flag();
  const token = proof();
  await db.user.update({
    where: { id: "owner" },
    data: { email: "safe-new@example.test", emailVerifiedAt: new Date() },
  });
  await expect(inspectSignupAppeal(db, token)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await db.user.update({
    where: { id: "owner" },
    data: { email: "owner@example.test", emailVerifiedAt: new Date() },
  });
  await setStudentRequestInvalidity(
    db,
    {
      id: "source",
      invalid: false,
      reason: "Corrected before reflag",
      expectedInvalidityVersion: 1,
    },
    { id: "HEAD" },
  );
  await flag(2);
  const nextToken = proof();
  await expect(inspectSignupAppeal(db, token)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await db.term.update({ where: { id: "term" }, data: { active: false } });
  expect((await inspectSignupAppeal(db, nextToken)).canAppeal).toBe(false);
  await expect(
    appealStudentSignup(db, {
      token: nextToken,
      reason: "Historical",
      clientKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});
it("failed mail leaves flag durable and send-only retry does not duplicate decisions", async () => {
  await fixture();
  send.mockRejectedValueOnce(new Error("Synthetic delivery outage"));
  await flag();
  const notice = await db.studentSignupNotice.findFirstOrThrow();
  expect(notice.state).toBe("FAILED");
  expect(
    (
      await db.emailDelivery.findFirstOrThrow({
        where: { requestKind: "survey" },
      })
    ).status,
  ).toBe("PENDING");
  await db.emailDelivery.updateMany({
    where: { requestKind: "survey" },
    data: { availableAt: new Date(0), leaseUntil: null },
  });
  expect(await deliverSignupNotice(db, notice.id)).toBe(true);
  expect(await deliverSignupNotice(db, notice.id)).toBe(false);
  expect(
    (await db.studentSurvey.findUniqueOrThrow({ where: { id: "source" } }))
      .invalidityVersion,
  ).toBe(1);
});
it("actual staff retry resolver queues delivery after audit commit without reflagging", async () => {
  await fixture();
  send.mockRejectedValueOnce(new Error("Synthetic outage"));
  await flag();
  await db.emailDelivery.updateMany({
    where: { requestKind: "survey" },
    data: { availableAt: new Date(0), leaseUntil: null },
  });
  await staff("HEAD").studentWorkflow.resendSignupNotice({ id: "source" });
  expect(send).toHaveBeenCalledTimes(2);
  expect((await db.studentSignupNotice.findFirstOrThrow()).state).toBe("SENT");
  expect(
    (
      await db.emailDelivery.findFirstOrThrow({
        where: { requestKind: "survey" },
      })
    ).status,
  ).toBe("SENT");
  expect(
    (await db.studentSurvey.findUniqueOrThrow({ where: { id: "source" } }))
      .invalidityVersion,
  ).toBe(1);
});
it("staff resend upgrades an existing invalid source without reflagging or rewriting its priority/evidence", async () => {
  const { row, payload } = await fixture();
  const marked = await db.studentSurvey.update({
    where: { id: row.id },
    data: {
      invalidityVersion: 1,
      invalidatedAt: new Date(),
      invalidatedById: "HEAD",
      invalidReason: "Old private review note",
    },
  });
  expect(await db.studentSignupNotice.count()).toBe(0);
  await staff("HEAD").studentWorkflow.resendSignupNotice({ id: row.id });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0].text).toContain("Old private review note");
  expect((await inspectSignupAppeal(db, proof())).canAppeal).toBe(true);
  expect(
    await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({
    submittedAt: row.submittedAt,
    payload,
    invalidityVersion: 1,
    invalidatedAt: marked.invalidatedAt,
    invalidatedById: marked.invalidatedById,
    invalidReason: marked.invalidReason,
  });
  expect(await db.studentSignupRevision.count()).toBe(0);
});

it("reviewed resend rotates obsolete credential-bound proof without transferring source ownership", async () => {
  await fixture();
  await flag();
  const oldToken = proof();
  await db.user.update({
    where: { id: "owner" },
    data: { passwordHash: "Synthetic changed credential" },
  });
  await expect(inspectSignupAppeal(db, oldToken)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await staff("HEAD").studentWorkflow.resendSignupNotice({ id: "source" });
  const newToken = proof();
  expect(newToken).not.toBe(oldToken);
  expect((await inspectSignupAppeal(db, newToken)).canAppeal).toBe(true);
  expect((await db.studentProfileOwnership.findFirstOrThrow()).userId).toBe(
    "owner",
  );
});

it("does not rotate an in-flight capability until its shared receipt can queue credential recovery", async () => {
  await fixture();
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const admitted = new Promise<void>((resolve) => {
    started = resolve;
  });
  send.mockImplementationOnce(async () => {
    started();
    await gate;
  });
  const applying = flag();
  try {
    await admitted;
    const original = await db.studentSignupNotice.findFirstOrThrow();
    const receipt = await db.emailDelivery.findFirstOrThrow({
      where: { requestKind: "survey" },
    });
    expect(receipt.status).toBe("SENDING");
    await db.user.update({
      where: { id: "owner" },
      data: { passwordHash: "Synthetic changed while SMTP waits" },
    });
    expect(
      await staff("HEAD").studentWorkflow.resendSignupNotice({ id: "source" }),
    ).toMatchObject({ queued: false });
    const held = await db.studentSignupNotice.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(held.tokenHash).toBe(original.tokenHash);
    expect(held.sessionVersion).toBe(original.sessionVersion);
    expect(
      (await db.emailDelivery.findUniqueOrThrow({ where: { id: receipt.id } }))
        .attemptId,
    ).toBe(receipt.attemptId);
  } finally {
    release();
    await applying;
  }
  const before = await db.studentSignupNotice.findFirstOrThrow();
  expect(
    await staff("HEAD").studentWorkflow.resendSignupNotice({ id: "source" }),
  ).toMatchObject({ queued: true });
  const recovered = await db.studentSignupNotice.findFirstOrThrow();
  expect(recovered.id).toBe(before.id);
  expect(recovered.tokenHash).not.toBe(before.tokenHash);
  expect(recovered.accountId).toBe(before.accountId);
  expect(recovered.invalidityVersion).toBe(1);
  expect((await inspectSignupAppeal(db, proof())).canAppeal).toBe(true);
  expect(
    await db.emailDelivery.count({ where: { requestKind: "survey" } }),
  ).toBe(1);
});
it("Coordinator proposal sends no notice until Head approval commits the actual flag", async () => {
  await fixture();
  await expect(
    staff("COORDINATOR").studentWorkflow.setRequestInvalidity({
      id: "source",
      invalid: true,
      reason: "Private staff note",
      expectedInvalidityVersion: 0,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(send).not.toHaveBeenCalled();
  expect(await db.studentSignupNotice.count()).toBe(0);
  const request = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "studentWorkflow.setRequestInvalidity" },
  });
  await staff("HEAD").approval.decide({
    id: request.id,
    approve: true,
    note: "Reviewed evidence",
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect((await db.studentSignupNotice.findFirstOrThrow()).state).toBe("SENT");
  expect(
    (
      await db.emailDelivery.findFirstOrThrow({
        where: { requestKind: "survey" },
      })
    ).status,
  ).toBe("SENT");
});
it("approval-scoped flags queue external delivery until commit and rollback retains no notice", async () => {
  await fixture();
  const effects: Array<() => Promise<void>> = [];
  await afterCommitScope.run(
    { effects, committed: false, onFailure: async () => undefined },
    () =>
      db.$transaction((tx) =>
        databaseScope.run(tx, async () => {
          await flag();
          expect(send).not.toHaveBeenCalled();
          expect((await tx.studentSignupNotice.findFirstOrThrow()).state).toBe(
            "PENDING",
          );
          expect(
            (
              await tx.emailDelivery.findFirstOrThrow({
                where: { requestKind: "survey" },
              })
            ).status,
          ).toBe("PENDING");
        }),
      ),
  );
  expect(effects).toHaveLength(1);
  await effects[0]!();
  expect(send).toHaveBeenCalledTimes(1);
  const rollbackEffects: Array<() => Promise<void>> = [];
  await expect(
    afterCommitScope.run(
      {
        effects: rollbackEffects,
        committed: false,
        onFailure: async () => undefined,
      },
      () =>
        db.$transaction((tx) =>
          databaseScope.run(tx, async () => {
            await setStudentRequestInvalidity(
              db,
              {
                id: "source",
                invalid: false,
                reason: "Corrected before reflag",
                expectedInvalidityVersion: 1,
              },
              { id: "HEAD" },
            );
            await flag(2);
            throw new Error("Rollback");
          }),
        ),
    ),
  ).rejects.toThrow("Rollback");
  expect(await db.studentSignupNotice.count()).toBe(1);
});
it("accepts with retained priority; final rejection closes current queue and preserves session facts", async () => {
  const { row, payload, tutee } = await fixture();
  await flag();
  const a = await appealStudentSignup(db, {
    token: proof(),
    reason: "Please check",
    clientKey: randomUUID(),
  });
  const accepted = {
    id: a.appealId,
    approve: true,
    expectedInvalidityVersion: 1,
    clientKey: randomUUID(),
    signedTicket: await ticket("SIGNUP_APPEAL", a.appealId + ":true"),
  };
  await resolveStudentSignupAppeal(db, "ADMIN", {
    ...accepted,
    signedTicket: await ticket("SIGNUP_APPEAL", a.appealId + ":true", "ADMIN"),
  });
  expect(
    await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({
    state: "OPEN",
    submittedAt: row.submittedAt,
    invalidatedAt: null,
  });
  expect(
    (await studentRequestRows(db, undefined, "owner"))[0]?.appeal,
  ).toMatchObject({ id: a.appealId, state: "ACCEPTED" });
  await flag(2);
  const b = await appealStudentSignup(db, {
    token: proof(),
    reason: "Again",
    clientKey: randomUUID(),
  });
  const tutor = await db.tutor.create({
    data: { englishName: "Synthetic Tutor", status: "ACTIVE" },
  });
  const pairing = await db.pairing.create({
    data: {
      tutorId: tutor.id,
      termId: "term",
      subject: "Mathematics",
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
      tutees: { create: { tuteeId: tutee!.id } },
    },
  });
  const session = await db.session.create({
    data: {
      pairingId: pairing.id,
      tutorId: tutor.id,
      month: "2026-10",
      schoolYear: "26-27",
      quarter: "Q1",
      durationMin: 60,
      shFactor: 1,
      shCount: 1,
      date: new Date("2026-10-05"),
      startMin: 960,
      endMin: 1020,
      tutees: { create: { tuteeId: tutee!.id, status: "PRESENT" } },
    },
  });
  const rejected = {
    id: b.appealId,
    approve: false,
    expectedInvalidityVersion: 3,
    clientKey: randomUUID(),
    signedTicket: await ticket("SIGNUP_APPEAL", b.appealId + ":false"),
  };
  await resolveStudentSignupAppeal(db, "HEAD", rejected);
  await resolveStudentSignupAppeal(db, "HEAD", rejected);
  expect(await db.pairingTutee.count()).toBe(0);
  expect(
    await db.session.findUnique({ where: { id: session.id } }),
  ).not.toBeNull();
  expect(await db.sessionTutee.count()).toBe(1);
  expect(
    await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({
    state: "INVALID_REJECTED",
    payload,
    submittedAt: row.submittedAt,
  });
});
it("Head alone releases a current assignment with an idempotent version fence", async () => {
  const { tutee } = await fixture();
  const tutor = await db.tutor.create({
    data: { englishName: "Tutor", status: "ACTIVE" },
  });
  const pair = await db.pairing.create({
    data: {
      id: "pair",
      tutorId: tutor.id,
      termId: "term",
      subject: "Mathematics",
      dayOfWeek: 1,
      startMin: 960,
      endMin: 1020,
      tutees: { create: { tuteeId: tutee!.id } },
    },
  });
  const input = {
    id: "source",
    pairingId: pair.id,
    expectedVersion: 0,
    clientKey: randomUUID(),
    signedTicket: await ticket("SIGNUP_UNASSIGN", "source:pair"),
  };
  await expect(unassignStudentSignup(db, "ADMIN", input)).rejects.toMatchObject(
    { code: "FORBIDDEN" },
  );
  expect(await unassignStudentSignup(db, "HEAD", input)).toMatchObject({
    version: 1,
  });
  expect(await unassignStudentSignup(db, "HEAD", input)).toMatchObject({
    version: 1,
  });
  expect(
    await db.pairing.findUnique({ where: { id: pair.id } }),
  ).not.toBeNull();
  expect(await db.studentSignupRevision.count()).toBe(1);
});
it("actual staff overlapping edits fence a stale participant draft and reject missing mandatory choice", async () => {
  const { payload, tutee } = await fixture();
  const before = await db.tutee.findUniqueOrThrow({ where: { id: tutee!.id } });
  await staff("HEAD").admin.updateTutee({
    id: tutee!.id,
    englishName: before.englishName,
    status: before.status,
    preferredContact: "Staff changed contact",
    expectedUpdatedAt: before.updatedAt,
  });
  const source = await db.studentSurvey.findUniqueOrThrow({
    where: { id: "source" },
  });
  expect(source.currentVersion).toBe(1);
  await expect(
    editOwnedStudentSignup(db, "owner", {
      id: "source",
      expectedVersion: 0,
      clientKey: randomUUID(),
      answers: studentSignupAnswersInput.parse(payload),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const latest = await db.tutee.findUniqueOrThrow({ where: { id: tutee!.id } });
  await expect(
    staff("HEAD").admin.updateTutee({
      id: tutee!.id,
      englishName: latest.englishName,
      status: latest.status,
      firstChoiceId: null,
      expectedUpdatedAt: latest.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
