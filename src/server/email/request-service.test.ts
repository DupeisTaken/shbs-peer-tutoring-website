import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { EmailMessage } from "./sender";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";

const transport = vi.hoisted(() => ({ send: vi.fn(), available: vi.fn() }));
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("./sender", () => ({
  emailSender: { send: transport.send },
  isEmailDeliveryAvailable: transport.available,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { ApprovalQueued } from "~/server/approvals";
import { setApplicationInvalidity } from "~/server/request-invalidity";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { deliverNotifications } from "./notification-delivery";
import {
  admitRequestDelivery,
  currentRequestNotice,
  finishRequestDelivery,
  requestNoticeStatus,
  retryRequestNotice,
  type RequestNoticeSource,
} from "./request-notice";
import { requestNoticeEmailCopy } from "./request-notice-copy";
import {
  requestAppealToken,
  REQUEST_APPEAL_TTL_MS,
} from "./request-appeal-token";
import { requestAppealStatus, submitRequestAppeal } from "./request-appeal";

const mailbox = "submitted-only@example.test";
const privateReason = "Private reason: participant-name and answer-sentinel";
const submittedAt = new Date("2026-09-01T06:17:00Z");
const appealText =
  "Original immutable appeal with private participant evidence.";
const actor = { id: "service-admin", name: "Stored ADMIN" };
const caller = (role: Session["role"] = "ADMIN") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: `service-${role.toLowerCase()}`,
        name: "Cookie name",
        email: `${role.toLowerCase()}@example.test`,
      },
      role,
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
const flag = (id: string, expectedInvalidityVersion = 0, invalid = true) => ({
  id,
  expectedInvalidityVersion,
  invalid,
  reason: invalid ? privateReason : "Corrected source evidence",
});

// Match the existing integration suites: an explicit guard precedes every fixture
// reset. The runtime owner supplies the isolated database and runs files serially.
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.createMany({
    data: (["ADMIN", "HEAD", "COORDINATOR", "VIEWER", "STUDENT"] as const).map(
      (role) => ({
        id: `service-${role.toLowerCase()}`,
        name: `Stored ${role}`,
        email: `${role.toLowerCase()}@example.test`,
        role,
        emailInfo: false,
        emailMessages: false,
        emailSecondaryRecipients: false,
      }),
    ),
  });
  await db.term.create({
    data: {
      id: "service-intake-term",
      name: "Synthetic active period",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.programSettings.create({
    data: {
      id: "program",
      emailNotificationsEnabled: false,
      timeZone: "Asia/Shanghai",
    },
  });
  vi.stubEnv("AUTH_URL", "https://school.example.test");
  vi.stubEnv("AUTH_SECRET", "request-service-test-secret");
  transport.send.mockReset().mockResolvedValue(undefined);
  transport.available.mockReset().mockReturnValue(true);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.$disconnect());

it.each([
  "attendance_cards_pending",
  "interview_scheduled",
  "message_received",
] as const)(
  "keeps %s trigger payloads email-safe even when a direct write supplies malformed context and private body",
  async (event) => {
    await db.programSettings.update({
      where: { id: "program" },
      data: { emailNotificationsEnabled: true },
    });
    await db.user.update({
      where: { id: actor.id },
      // The attendance-card case is reviewer mail; opt into each tested category
      // so this test reaches the transport privacy boundary rather than its gate.
      data: { emailInfo: true, emailMessages: true, emailReviewRequests: true },
    });
    await db.accountEmail.upsert({
      where: { email: "admin@example.test" },
      update: { verifiedAt: new Date() },
      create: {
        userId: actor.id,
        email: "admin@example.test",
        verifiedAt: new Date(),
      },
    });
    // Direct database writes deliberately bypass the application sanitizer. The
    // SQL allowlist and read formatter must still prevent arbitrary body/context
    // fields or non-scalar values from becoming participant email content.
    await db.notification.create({
      data: {
        userId: actor.id,
        event,
        title: "private-title-sentinel",
        body: "private-body-sentinel",
        link:
          event === "message_received" ? "/messages" : "/admin/applications",
        context: {
          count: { answer: "private-count-sentinel" },
          startsAt: { name: "private-time-sentinel" },
          timeZone: ["private-zone-sentinel"],
          body: "private-context-sentinel",
        },
      },
    });
    const outbox = await db.emailDelivery.findFirstOrThrow({
      where: { event },
    });
    expect(JSON.stringify(outbox.context)).not.toContain(
      "private-context-sentinel",
    );
    expect(JSON.stringify(outbox.context)).not.toContain(
      "private-body-sentinel",
    );
    await deliverNotifications();
    expect(transport.send).toHaveBeenCalledTimes(1);
    const mail = transport.send.mock.calls[0]![0] as EmailMessage;
    expect(JSON.stringify(mail)).not.toContain("sentinel");
    expect(mail.subject).toBe(
      `${en.notificationEvents[event].title} / ${zh.notificationEvents[event].title}`,
    );
    expect(
      (await db.emailDelivery.findUniqueOrThrow({ where: { id: outbox.id } }))
        .status,
    ).toBe("SENT");
  },
);

async function source(
  kind: RequestNoticeSource["kind"] = "application",
  email: string | null = mailbox,
): Promise<RequestNoticeSource> {
  if (kind === "application") {
    const row = await db.tutorApplication.create({
      data: {
        name: "Original private applicant",
        email: email ?? "",
        createdAt: submittedAt,
        policySnapshot: { originalAnswer: "answer-sentinel" },
        policyRevision: "original-policy",
        policyAcceptedAt: submittedAt,
      },
    });
    return { kind, id: row.id };
  }
  if (kind === "survey") {
    const row = await db.studentSurvey.create({
      data: {
        email: email ?? "",
        submittedAt,
        intakeTermId: "service-intake-term",
        expiresAt: new Date("2099-01-01"),
        tokenHash: "source-specific-token-hash",
        payload: {
          englishName: "Original private student",
          answer: "answer-sentinel",
        },
        policySnapshot: { original: true },
        policyRevision: "original-policy",
      },
    });
    return { kind, id: row.id };
  }
  const row = await db.tutee.create({
    data: {
      englishName: "Original legacy student",
      email,
      signupSource: "SELF_SERVICE",
      signupSubmittedAt: submittedAt,
      status: "PENDING",
    },
  });
  return { kind, id: row.id };
}
function apply(
  row: RequestNoticeSource,
  version = 0,
  invalid = true,
  role: Session["role"] = "ADMIN",
) {
  const input = flag(row.id, version, invalid);
  if (row.kind === "application")
    return caller(role).admin.setApplicationInvalidity(input);
  if (row.kind === "survey")
    return caller(role).studentWorkflow.setRequestInvalidity(input);
  return caller(role).admin.setSignupInvalidity(input);
}
function latest(row: RequestNoticeSource) {
  return db.emailDelivery.findFirstOrThrow({
    where: { requestKind: row.kind, requestId: row.id },
    orderBy: { requestVersion: "desc" },
  });
}
async function marked(kind: RequestNoticeSource["kind"] = "application") {
  const row = await source(kind);
  await apply(row);
  return { source: row, notice: await latest(row) };
}
async function queueProposal(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    const cause = (error as { cause: unknown }).cause;
    expect(cause).toBeInstanceOf(ApprovalQueued);
    return db.approvalRequest.findUniqueOrThrow({
      where: { id: (cause as ApprovalQueued).approvalId },
    });
  }
  throw Error("Expected a Coordinator proposal");
}
// Simulate only the committed batch lease; admission and completion below use real
// database transactions. Future leases avoid timing-dependent waits or SMTP work.
async function lease(id: string, offsetMs = 60_000) {
  return db.emailDelivery.update({
    where: { id },
    data: { leaseUntil: new Date(Date.now() + offsetMs) },
  });
}
async function admission(id: string) {
  const candidate = await lease(id);
  const result = await admitRequestDelivery(
    db,
    id,
    candidate.leaseUntil,
    candidate.attemptId,
  );
  expect(result?.row.attemptId).toEqual(expect.any(String));
  return result!;
}
async function verifiedAddress(userId: string, email = mailbox) {
  await db.accountEmail.upsert({
    where: { email },
    create: { userId, email, verifiedAt: new Date() },
    update: { userId, verifiedAt: new Date() },
  });
}

it.each(["application", "survey", "signup"] as const)(
  "sends applied %s notices to the exact unverified submission mailbox despite optional/global settings",
  async (kind) => {
    const row = await source(kind);
    const usersBefore = await db.user.count();
    await apply(row);
    const receipt = await latest(row);
    expect(receipt).toMatchObject({
      userId: null,
      category: "request_service",
      requestKind: kind,
      requestId: row.id,
      requestVersion: 1,
      requestInvalid: true,
      requestReason: privateReason,
      recipient: mailbox,
      requestSubmittedAt: submittedAt,
      requestTimeZone: "Asia/Shanghai",
      status: kind === "survey" ? "SENT" : "PENDING",
    });
    await deliverNotifications();
    expect(transport.send).toHaveBeenCalledTimes(1);
    const message = transport.send.mock.calls[0]![0] as EmailMessage;
    expect(message).toMatchObject({ category: "PROGRAM", to: mailbox });
    expect(message.presentation?.action?.label).toContain(
      "Appeal this decision",
    );
    expect(message.presentation?.action?.url).toContain(
      kind === "survey"
        ? "/tutee-signup/appeal#token="
        : "/request-appeal?token=",
    );
    expect(message.text).toContain(
      kind === "application" ? "A tutor application" : "A tutee signup request",
    );
    expect(message.text).toContain("Asia/Shanghai");
    expect(message.text).toContain("Submitted: September 1, 2026");
    expect(message.text).toContain("2:17 PM");
    expect(message.text).not.toContain(privateReason);
    expect(message.text).not.toContain("Original private");
    expect(message.text).not.toContain("answer-sentinel");
    expect(message.presentation).not.toHaveProperty("unsubscribeUrl");
    expect(await latest(row)).toMatchObject({
      id: receipt.id,
      status: "SENT",
      attempts: 1,
    });
    expect(await db.user.count()).toBe(usersBefore);
    expect(await db.registrationCode.count()).toBe(0);
    expect(await db.tutor.count()).toBe(0);
    if (kind === "application")
      expect(
        await db.tutorApplication.findUniqueOrThrow({ where: { id: row.id } }),
      ).toMatchObject({
        name: "Original private applicant",
        status: "PENDING",
        createdAt: submittedAt,
        policySnapshot: { originalAnswer: "answer-sentinel" },
        invalidatedById: actor.id,
        invalidatedByName: actor.name,
      });
    if (kind === "survey")
      expect(
        await db.studentSurvey.findUniqueOrThrow({ where: { id: row.id } }),
      ).toMatchObject({
        state: "OPEN",
        submittedAt,
        payload: {
          englishName: "Original private student",
          answer: "answer-sentinel",
        },
      });
  },
);

it("defers unavailable PROGRAM transport without consuming attempts and later delivers the same receipt", async () => {
  const { source: row, notice } = await marked();
  transport.available.mockImplementation((category) => category === "SECURITY");
  await deliverNotifications();
  expect(transport.send).not.toHaveBeenCalled();
  expect(await latest(row)).toMatchObject({
    id: notice.id,
    attempts: 0,
    status: "PENDING",
    leaseUntil: null,
  });
  await db.emailDelivery.update({
    where: { id: notice.id },
    data: { availableAt: new Date(0) },
  });
  transport.available.mockReturnValue(true);
  await deliverNotifications();
  expect(transport.send).toHaveBeenCalledTimes(1);
  expect(await latest(row)).toMatchObject({ id: notice.id, status: "SENT" });
});

it.each([
  ["application", null],
  ["application", "invalid mailbox"],
  ["survey", null],
  ["survey", "invalid mailbox"],
  ["signup", null],
  ["signup", "invalid mailbox"],
] as const)(
  "blocks missing/malformed %s submission email %s",
  async (kind, email) => {
    const row = await source(kind, email);
    await apply(row);
    expect(await latest(row)).toMatchObject({ status: "BLOCKED", attempts: 0 });
    await deliverNotifications();
    expect(transport.send).not.toHaveBeenCalled();
    expect(await retryRequestNotice(db, row, actor)).toEqual({ queued: false });
  },
);

it("rolls back the applied flag, audit and notice together when the owning transaction fails", async () => {
  const row = await source();
  await expect(
    db.$transaction(async (tx) => {
      await setApplicationInvalidity(tx, flag(row.id), actor);
      throw Error("Synthetic owning transaction rollback");
    }),
  ).rejects.toThrow("Synthetic owning transaction rollback");
  expect(
    await db.tutorApplication.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({
    invalidityVersion: 0,
    invalidReason: null,
    invalidatedAt: null,
  });
  expect(await db.emailDelivery.count({ where: { requestId: row.id } })).toBe(
    0,
  );
  expect(
    await db.auditLog.count({
      where: { operation: "admin.setApplicationInvalidity" },
    }),
  ).toBe(0);
  await apply(row);
  expect(await latest(row)).toMatchObject({ requestVersion: 1 });
});

it("creates one receipt per applied version, leaves same-state/stale writes unchanged and cancels earlier queued versions", async () => {
  const { source: row, notice } = await marked();
  await apply(row, 1);
  expect(await db.emailDelivery.count({ where: { requestId: row.id } })).toBe(
    1,
  );
  await expect(apply(row, 0, false)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await latest(row)).toMatchObject({
    id: notice.id,
    requestReason: privateReason,
  });
  await apply(row, 1, false);
  const clear = await latest(row);
  expect(clear).toMatchObject({
    requestVersion: 2,
    event: "request_cleared",
    requestInvalid: false,
  });
  await apply(row, 2);
  const reflag = await latest(row);
  expect(reflag).toMatchObject({
    requestVersion: 3,
    event: "request_invalid",
    status: "PENDING",
  });
  expect(new Set([notice.id, clear.id, reflag.id]).size).toBe(3);
  expect(
    await db.emailDelivery.count({
      where: { requestId: row.id, status: "SUPERSEDED" },
    }),
  ).toBe(2);
  await deliverNotifications();
  expect(transport.send).toHaveBeenCalledTimes(1);
  expect(
    (transport.send.mock.calls[0]![0] as EmailMessage).messageId,
  ).toContain(reflag.id);
});

it("queues no submitter mail for pending/rejected Coordinator proposals and records applied reviewer ownership", async () => {
  const row = await source();
  const rejected = await queueProposal(() =>
    apply(row, 0, true, "COORDINATOR"),
  );
  expect(await db.emailDelivery.count({ where: { requestId: row.id } })).toBe(
    0,
  );
  await caller().approval.decide({
    id: rejected.id,
    approve: false,
    note: "Evidence incomplete",
  });
  expect(await db.emailDelivery.count({ where: { requestId: row.id } })).toBe(
    0,
  );
  const accepted = await queueProposal(() =>
    apply(row, 0, true, "COORDINATOR"),
  );
  await caller("HEAD").approval.decide({
    id: accepted.id,
    approve: true,
    note: "Confirmed original evidence",
  });
  expect(await db.emailDelivery.count({ where: { requestId: row.id } })).toBe(
    1,
  );
  expect(
    await db.tutorApplication.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({
    invalidatedById: "service-head",
    invalidatedByName: "Stored HEAD",
  });
});

it.each(["FAILED", "BLOCKED"])(
  "clearing cancels an older unadmitted %s receipt and cannot manually retry it",
  async (status) => {
    const { source: row, notice } = await marked();
    await db.emailDelivery.update({
      where: { id: notice.id },
      data: { status },
    });
    await apply(row, 1, false);
    expect(
      await db.emailDelivery.findUniqueOrThrow({ where: { id: notice.id } }),
    ).toMatchObject({ status: "SUPERSEDED", leaseUntil: null });
    expect(await retryRequestNotice(db, row, actor)).toEqual({ queued: false });
    await deliverNotifications();
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect((transport.send.mock.calls[0]![0] as EmailMessage).text).toContain(
      "had its invalid flag cleared",
    );
  },
);

it.each(["application", "survey", "signup"] as const)(
  "matching verified account alone never proves the %s request",
  async (kind) => {
    const { notice } = await marked(kind);
    await verifiedAddress("service-student");
    expect(await currentRequestNotice(db, notice)).toEqual({
      current: true,
      verified: false,
    });
    expect(requestNoticeEmailCopy(notice, false).text).not.toContain(
      privateReason,
    );
  },
);

it("accepts source-bound registration proof, rechecks a redeemed owner's exact address and masks removed proof", async () => {
  const { notice, source: row } = await marked();
  const proof = await db.registrationCode.create({
    data: {
      applicationId: row.id,
      pendingEmail: mailbox,
      expiresAt: new Date("2099-01-01"),
      emailVerifiedAt: new Date(),
    },
  });
  expect(await currentRequestNotice(db, notice)).toEqual({
    current: true,
    verified: true,
  });
  await db.registrationCode.update({
    where: { id: proof.id },
    data: { usedByUserId: "service-student", usedAt: new Date() },
  });
  expect((await currentRequestNotice(db, notice)).verified).toBe(false);
  // A secondary request mailbox is proof even if optional secondary delivery is off.
  await verifiedAddress("service-student");
  expect((await currentRequestNotice(db, notice)).verified).toBe(true);
  await deliverNotifications();
  expect((transport.send.mock.calls[0]![0] as EmailMessage).text).toContain(
    privateReason,
  );
  await db.accountEmail.delete({ where: { email: mailbox } });
  expect((await currentRequestNotice(db, notice)).verified).toBe(false);
  await verifiedAddress("service-viewer");
  expect((await currentRequestNotice(db, notice)).verified).toBe(false);
});

it("requires survey confirmation plus the current linked owner's registry after profile ownership exists", async () => {
  const { notice, source: row } = await marked("survey");
  await db.studentSurvey.update({
    where: { id: row.id },
    data: { confirmedAt: new Date() },
  });
  expect((await currentRequestNotice(db, notice)).verified).toBe(true);
  const profile = await db.tutee.create({
    data: { englishName: "Linked private profile" },
  });
  await db.studentSurvey.update({
    where: { id: row.id },
    data: { tuteeId: profile.id },
  });
  await db.studentProfileOwnership.create({
    data: { tuteeId: profile.id, userId: "service-student" },
  });
  expect((await currentRequestNotice(db, notice)).verified).toBe(false);
  await verifiedAddress("service-student");
  expect((await currentRequestNotice(db, notice)).verified).toBe(true);
  await db.accountEmail.update({
    where: { email: mailbox },
    data: { verifiedAt: null },
  });
  expect((await currentRequestNotice(db, notice)).verified).toBe(false);
  await verifiedAddress("service-viewer");
  expect((await currentRequestNotice(db, notice)).verified).toBe(false);
});

it("never invents a historical submission time and clear copy states that participation is not approved", async () => {
  const row = await source("signup");
  await db.tutee.update({
    where: { id: row.id },
    data: { signupSubmittedAt: null },
  });
  await apply(row);
  expect(requestNoticeEmailCopy(await latest(row), false).text).toContain(
    "Original submission time unavailable",
  );
  await apply(row, 1, false);
  const copy = requestNoticeEmailCopy(await latest(row), false);
  expect(copy.text).toContain(
    "This does not itself approve the request or confirm participation",
  );
  expect(copy.presentation.action.url).toBe(
    "https://school.example.test/privacy",
  );
  expect(copy.text).not.toContain(privateReason);
});

it("clear before admission prevents the leased old candidate from sending", async () => {
  const { source: row, notice } = await marked();
  const candidate = await lease(notice.id);
  await apply(row, 1, false);
  expect(
    await admitRequestDelivery(
      db,
      notice.id,
      candidate.leaseUntil,
      candidate.attemptId,
    ),
  ).toBeNull();
  expect(
    await db.emailDelivery.findUniqueOrThrow({ where: { id: notice.id } }),
  ).toMatchObject({ status: "SUPERSEDED", attempts: 0 });
});

it.each([true, false])(
  "clear after admission retains in-flight evidence and records acceptance=%s correctly",
  async (sent) => {
    const { source: row, notice } = await marked();
    const admitted = await admission(notice.id);
    await apply(row, 1, false);
    expect(
      await db.emailDelivery.findUniqueOrThrow({ where: { id: notice.id } }),
    ).toMatchObject({ status: "SENDING" });
    await finishRequestDelivery(db, notice.id, admitted.row.attemptId!, sent);
    expect(
      await db.emailDelivery.findUniqueOrThrow({ where: { id: notice.id } }),
    ).toMatchObject({ status: sent ? "SENT" : "SUPERSEDED", attempts: 1 });
  },
);

it("fences duplicate admission, expired candidates, old leases and stale completions from a newer attempt", async () => {
  const { notice } = await marked();
  const oldCandidate = await lease(notice.id);
  const admissions = await Promise.all([
    admitRequestDelivery(
      db,
      notice.id,
      oldCandidate.leaseUntil,
      oldCandidate.attemptId,
    ),
    admitRequestDelivery(
      db,
      notice.id,
      oldCandidate.leaseUntil,
      oldCandidate.attemptId,
    ),
  ]);
  expect(admissions.filter(Boolean)).toHaveLength(1);
  const first = admissions.find(Boolean)!;
  expect(first).not.toBeNull();
  expect(
    await admitRequestDelivery(
      db,
      notice.id,
      oldCandidate.leaseUntil,
      oldCandidate.attemptId,
    ),
  ).toBeNull();
  await db.emailDelivery.update({
    where: { id: notice.id },
    data: { leaseUntil: new Date(0) },
  });
  expect(
    await admitRequestDelivery(db, notice.id, new Date(0), first.row.attemptId),
  ).toBeNull();
  const newCandidate = await lease(notice.id, 120_000);
  expect(
    await admitRequestDelivery(
      db,
      notice.id,
      oldCandidate.leaseUntil,
      oldCandidate.attemptId,
    ),
  ).toBeNull();
  const second = await admitRequestDelivery(
    db,
    notice.id,
    newCandidate.leaseUntil,
    newCandidate.attemptId,
  );
  expect(second?.row.attemptId).not.toBe(first.row.attemptId);
  expect(second?.row.attempts).toBe(2);
  await finishRequestDelivery(db, notice.id, first.row.attemptId!, true);
  await finishRequestDelivery(db, notice.id, first.row.attemptId!, false);
  expect(
    await db.emailDelivery.findUniqueOrThrow({ where: { id: notice.id } }),
  ).toMatchObject({
    status: "SENDING",
    attemptId: second!.row.attemptId,
    attempts: 2,
  });
  await finishRequestDelivery(db, notice.id, second!.row.attemptId!, true);
  expect(
    await db.emailDelivery.findUniqueOrThrow({ where: { id: notice.id } }),
  ).toMatchObject({ status: "SENT", attempts: 2 });
});

it("clear retains an earlier decline reviewer/reason instead of relabeling that immutable decision", async () => {
  const { source: row, notice } = await marked();
  await submitRequestAppeal(
    requestAppealToken(notice.id, notice.createdAt),
    appealText,
    db,
  );
  const appeal = await db.requestInvalidityAppeal.findUniqueOrThrow({
    where: { noticeId: notice.id },
  });
  await caller("HEAD").notification.declineRequestAppeal({
    ...row,
    appealId: appeal.id,
    expectedReviewVersion: 0,
    reason: "Earlier declined evidence",
  });
  const declined = await db.requestInvalidityAppeal.findUniqueOrThrow({
    where: { id: appeal.id },
  });
  await apply(row, 1, false);
  expect(
    await db.requestInvalidityAppeal.findUniqueOrThrow({
      where: { id: appeal.id },
    }),
  ).toEqual(declined);
});

it("bounds automatic attempts to five and permits exactly one concurrent manual retry on the immutable receipt", async () => {
  const { source: row, notice } = await marked();
  const first = await admission(notice.id);
  expect(await retryRequestNotice(db, row, actor)).toEqual({ queued: false });
  await finishRequestDelivery(db, notice.id, first.row.attemptId!, false);
  for (let attempt = 2; attempt <= 5; attempt++) {
    const admitted = await admission(notice.id);
    expect(admitted.row.attempts).toBe(attempt);
    await finishRequestDelivery(db, notice.id, admitted.row.attemptId!, false);
  }
  expect(await latest(row)).toMatchObject({ status: "FAILED", attempts: 5 });
  const failedCandidate = await lease(notice.id);
  expect(
    await admitRequestDelivery(
      db,
      notice.id,
      failedCandidate.leaseUntil,
      failedCandidate.attemptId,
    ),
  ).toBeNull();
  // Clear the synthetic lease to model the worker's completed failed attempt.
  await db.emailDelivery.update({
    where: { id: notice.id },
    data: { leaseUntil: null },
  });
  const retries = await Promise.all([
    retryRequestNotice(db, row, actor),
    retryRequestNotice(db, row, actor),
  ]);
  expect(retries.filter((result) => result.queued)).toHaveLength(1);
  expect(await latest(row)).toMatchObject({
    id: notice.id,
    status: "PENDING",
    attempts: 0,
    requestVersion: 1,
    requestReason: privateReason,
    requestSubmittedAt: submittedAt,
  });
  expect(
    await db.tutorApplication.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({
    invalidityVersion: 1,
    invalidReason: privateReason,
    status: "PENDING",
  });
  expect(
    await db.auditLog.count({
      where: { operation: "notification.retryRequestEmail" },
    }),
  ).toBe(1);
});

it("worker failure stores a safe diagnostic and stable Message-ID across a manual retry", async () => {
  const { source: row, notice } = await marked();
  transport.send.mockRejectedValueOnce(
    new Error("provider-secret-address@example.test"),
  );
  await deliverNotifications();
  expect(await latest(row)).toMatchObject({
    status: "PENDING",
    attempts: 1,
    lastError: "Email delivery failed; check the configured transport.",
  });
  expect(await caller().notification.retryRequestEmail(row)).toEqual({
    queued: true,
  });
  await deliverNotifications();
  expect(transport.send).toHaveBeenCalledTimes(2);
  const messages = transport.send.mock.calls.map(
    (call) => call[0] as EmailMessage,
  );
  expect(messages[0]!.messageId).toBe(messages[1]!.messageId);
  expect(messages[1]!.messageId).toContain(notice.id);
  expect(JSON.stringify(await requestNoticeStatus(db, row))).not.toContain(
    "provider-secret",
  );
});

it.each(["service-admin", "service-head"] as const)("GET status never consumes an appeal; concurrent submissions notify %s once and retain immutable private evidence", async (reviewerId) => {
  const { source: row, notice } = await marked();
  // An unavailable Admin transfers review ownership to Head without changing
  // the underlying flag, appeal, retry receipt or public status response.
  if (reviewerId === "service-head")
    await db.user.update({ where: { id: actor.id }, data: { suspendedAt: new Date() } });
  const token = requestAppealToken(notice.id, notice.createdAt);
  for (let read = 0; read < 2; read++)
    expect(await requestAppealStatus(token, db)).toEqual({
      status: "ready",
      kind: "tutor",
      recordedTime: submittedAt.toISOString(),
      timeZone: "Asia/Shanghai",
      appealStatus: null,
    });
  expect(await db.requestInvalidityAppeal.count()).toBe(0);
  const results = await Promise.all([
    submitRequestAppeal(token, appealText, db),
    submitRequestAppeal(token, appealText, db),
  ]);
  expect(results).toEqual([
    { status: "submitted", appealStatus: "PENDING" },
    { status: "submitted", appealStatus: "PENDING" },
  ]);
  const original = await db.requestInvalidityAppeal.findUniqueOrThrow({
    where: { noticeId: notice.id },
  });
  expect(
    await submitRequestAppeal(
      token,
      "A replacement appeal must not overwrite evidence.",
      db,
    ),
  ).toEqual({ status: "already-submitted" });
  expect(
    await db.requestInvalidityAppeal.findUniqueOrThrow({
      where: { noticeId: notice.id },
    }),
  ).toEqual(original);
  const events = await db.notification.findMany({
    where: { event: "request_invalidity_appeal_pending" },
  });
  expect(events.map((event) => event.userId)).toEqual([reviewerId]);
  expect(events.every((event) => event.link?.includes(row.id))).toBe(true);
  expect(JSON.stringify(events)).not.toContain(appealText);
  const safe = await requestAppealStatus(token, db);
  expect(safe).toMatchObject({ appealStatus: "PENDING" });
  expect(JSON.stringify(safe)).not.toContain(privateReason);
  expect(JSON.stringify(safe)).not.toContain(appealText);
  expect(JSON.stringify(safe)).not.toContain(mailbox);
  expect(
    await db.tutorApplication.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({ invalidityVersion: 1, invalidReason: privateReason });
});

it("decline requires Admin/Head, an explicit reason and current review revision while preserving the original request and appeal", async () => {
  const { source: row, notice } = await marked();
  await submitRequestAppeal(
    requestAppealToken(notice.id, notice.createdAt),
    appealText,
    db,
  );
  const appeal = await db.requestInvalidityAppeal.findUniqueOrThrow({
    where: { noticeId: notice.id },
  });
  const input = {
    ...row,
    appealId: appeal.id,
    expectedReviewVersion: 0,
    reason: "Evidence does not resolve the flag",
  };
  for (const role of ["COORDINATOR", "VIEWER", "STUDENT"] as const) {
    await expect(
      caller(role).notification.declineRequestAppeal(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(role).notification.retryRequestEmail(row),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  await expect(
    caller().notification.declineRequestAppeal({ ...input, reason: " " }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller().notification.declineRequestAppeal({
      ...input,
      expectedReviewVersion: 1,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await caller("HEAD").notification.declineRequestAppeal(input);
  expect(
    await db.requestInvalidityAppeal.findUniqueOrThrow({
      where: { id: appeal.id },
    }),
  ).toMatchObject({
    body: appealText,
    status: "DECLINED",
    reviewVersion: 1,
    reviewedById: "service-head",
    decisionReason: input.reason,
  });
  await expect(
    caller().notification.declineRequestAppeal(input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await requestAppealStatus(
      requestAppealToken(notice.id, notice.createdAt),
      db,
    ),
  ).toMatchObject({ appealStatus: "DECLINED" });
  expect(
    await db.tutorApplication.findUniqueOrThrow({ where: { id: row.id } }),
  ).toMatchObject({ invalidityVersion: 1, invalidReason: privateReason });
  const audit = await db.auditLog.findFirstOrThrow({
    where: { operation: "notification.declineRequestAppeal" },
  });
  expect(JSON.stringify(audit)).not.toContain(appealText);
});

it("approved Coordinator clear resolves a pending appeal atomically and reflag grants a fresh receipt without rewriting earlier evidence", async () => {
  const { source: row, notice } = await marked();
  const token = requestAppealToken(notice.id, notice.createdAt);
  await submitRequestAppeal(token, appealText, db);
  const proposal = await queueProposal(() =>
    apply(row, 1, false, "COORDINATOR"),
  );
  expect(
    await db.requestInvalidityAppeal.findUniqueOrThrow({
      where: { noticeId: notice.id },
    }),
  ).toMatchObject({ status: "PENDING", reviewVersion: 0 });
  expect(await db.emailDelivery.count({ where: { requestId: row.id } })).toBe(
    1,
  );
  await caller().approval.decide({
    id: proposal.id,
    approve: true,
    note: "Authorized corrected evidence",
  });
  const resolved = await db.requestInvalidityAppeal.findUniqueOrThrow({
    where: { noticeId: notice.id },
  });
  expect(resolved).toMatchObject({
    body: appealText,
    status: "CLEARED",
    reviewVersion: 1,
    reviewedById: actor.id,
    decisionReason: "Corrected source evidence",
  });
  expect(resolved.resolvedAt).toBeInstanceOf(Date);
  expect(await requestAppealStatus(token, db)).toEqual({ status: "invalid" });
  expect(await submitRequestAppeal(token, appealText, db)).toEqual({
    status: "invalid",
  });
  await apply(row, 2);
  const fresh = await latest(row);
  expect(fresh.id).not.toBe(notice.id);
  expect(await requestAppealStatus(token, db)).toEqual({ status: "invalid" });
  expect(
    await submitRequestAppeal(
      requestAppealToken(fresh.id, fresh.createdAt),
      "Fresh appeal for the new decision only.",
      db,
    ),
  ).toMatchObject({ status: "submitted" });
  expect(
    await db.requestInvalidityAppeal.findUniqueOrThrow({
      where: { noticeId: notice.id },
    }),
  ).toEqual(resolved);
  expect(await db.requestInvalidityAppeal.count()).toBe(2);
});

it("tampered, expired, missing and mailbox-changed capabilities fail without accepting appeal evidence", async () => {
  const { source: row, notice } = await marked();
  const token = requestAppealToken(notice.id, notice.createdAt);
  const expired = requestAppealToken(
    notice.id,
    new Date(Date.now() - REQUEST_APPEAL_TTL_MS - 1000),
  );
  const bad = [
    token.replace("v1.", "v2."),
    expired,
    requestAppealToken("missing-notice", new Date()),
  ];
  for (const candidate of bad) {
    expect(await requestAppealStatus(candidate, db)).toEqual({
      status: "invalid",
    });
    expect(await submitRequestAppeal(candidate, appealText, db)).toEqual({
      status: "invalid",
    });
  }
  await db.tutorApplication.update({
    where: { id: row.id },
    data: { email: "changed@example.test" },
  });
  expect(await requestAppealStatus(token, db)).toEqual({ status: "invalid" });
  expect(await submitRequestAppeal(token, appealText, db)).toEqual({
    status: "invalid",
  });
  expect(await db.requestInvalidityAppeal.count()).toBe(0);
});
