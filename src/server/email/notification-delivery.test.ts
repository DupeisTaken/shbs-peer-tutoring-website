import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { EmailMessage } from "./sender";
const mail = vi.hoisted(() => ({
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
}));
vi.mock("./sender", () => ({
  emailSender: { send: mail.send },
  isEmailDeliveryAvailable: () => true,
  isEmailConfigured: () => false,
  verifyEmailTransport: vi.fn(),
}));
import { db } from "~/server/db";
import { afterCommitScope, flushCommittedEffects } from "~/server/db-scope";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { deliverNotifications } from "./notification-delivery";
import { getEmailDeliveryStatus } from "./delivery-status";
import { resendStuckEmails } from "./resend-stuck";
import { renderEmail } from "./template";
import { verifyUnsubscribeToken } from "./unsubscribe-token";
import { unsubscribeFromEmail } from "./unsubscribe";
import { withRecoveryDeliverySource } from "~/server/recovery/delivery-effects";
import { finishIdentityNotice } from "./identity-notice-admission";

const uid = "email192-synthetic";
async function causalNotice() {
  await db.user.update({ where: { id: uid }, data: { emailSecondaryRecipients: false } });
  await db.$transaction(async (tx) => {
    const action = await tx.recoveryAction.create({ data: { kind: "INITIAL_ADMISSION", applicationId: `synthetic-${randomUUID()}`, before: {}, after: {} } });
    await tx.recoveryTrackedEntity.create({ data: { actionId: action.id, entity: "User", recordId: uid } });
    const [clock] = await tx.$queryRaw<Array<{ transactionId: string }>>`SELECT txid_current()::text AS "transactionId"`;
    await tx.recoveryEvent.create({ data: { id: createHash("md5").update(`${action.id}:${clock!.transactionId}`).digest("hex"), actionId: action.id, transactionId: clock!.transactionId, kind: "ADMISSION" } });
    await tx.user.update({ where: { id: uid }, data: { name: "Synthetic causal dispatcher source" } });
    await withRecoveryDeliverySource(tx, { entity: "User", recordId: uid, actionId: action.id }, () =>
      tx.notification.create({ data: { userId: uid, title: "Synthetic causal notice", link: "/messages" } }));
  });
  const rows = await db.emailDelivery.findMany({ where: { userId: uid } });
  expect(rows).toHaveLength(1);
  return rows[0]!;
}
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  // The worker leases the entire queue, so isolate it from other integration suites.
  await db.emailDelivery.deleteMany();
  await db.user.deleteMany({ where: { id: uid } });
  await db.programSettings.upsert({
    where: { id: "program" },
    create: { id: "program", emailNotificationsEnabled: true },
    update: { emailNotificationsEnabled: true, timeZone: "Asia/Shanghai" },
  });
  await db.user.create({
    data: {
      id: uid,
      email: "email192@example.test",
      role: "ADMIN",
      emailVerifiedAt: new Date(),
      emailInfo: true,
      emailMessages: true,
      emailSecondaryRecipients: true,
    },
  });
  await db.accountEmail.create({
    data: {
      userId: uid,
      email: "email192-secondary@example.test",
      verifiedAt: new Date(),
    },
  });
  mail.send.mockReset().mockResolvedValue(undefined);
});
afterAll(async () => {
  await db.user.deleteMany({ where: { id: uid } });
  await db.$disconnect();
});

it("does not replay a failed admitted causal SMTP attempt", async () => {
  const delivery = await causalNotice();
  mail.send.mockRejectedValue(new Error("Synthetic admitted SMTP failure"));
  await deliverNotifications();
  const uncertain = await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  expect(uncertain).toMatchObject({ status: "UNCERTAIN", attempts: 1 });
  expect(uncertain.attemptStartedAt).not.toBeNull();
  expect(uncertain.attemptId).not.toBeNull();
  await db.emailDelivery.update({ where: { id: delivery.id }, data: { availableAt: new Date(0), leaseUntil: new Date(0) } });
  await deliverNotifications();
  expect(mail.send).toHaveBeenCalledTimes(1);
});

it.each(["PENDING", "SENDING"])("freezes legacy admitted %s rows without another SMTP call", async (status) => {
  const delivery = await causalNotice();
  await db.emailDelivery.update({ where: { id: delivery.id }, data: { status, attempts: 1,
    attemptId: "legacy-admitted-attempt", attemptStartedAt: new Date(Date.now() - 600_000), leaseUntil: new Date(0) } });
  await deliverNotifications();
  const retained = await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  expect(retained).toMatchObject({ status: "UNCERTAIN", attempts: 1, attemptId: "legacy-admitted-attempt", leaseUntil: null });
  expect(retained.attemptStartedAt).not.toBeNull();
  expect(mail.send).not.toHaveBeenCalled();
});

it("retains known SMTP acceptance when database completion fails, without sending again", async () => {
  const delivery = await causalNotice();
  await db.$executeRawUnsafe(`CREATE FUNCTION test_recovery_finish_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic completion database failure'; END $$`);
  try {
    await db.$executeRawUnsafe(`CREATE TRIGGER test_recovery_finish_failure BEFORE UPDATE ON "EmailDelivery" FOR EACH ROW WHEN (NEW.status='SENT' AND OLD."userId"='email192-synthetic') EXECUTE FUNCTION test_recovery_finish_failure()`);
    await expect(deliverNotifications()).rejects.toThrow("Email completion failed");
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_recovery_finish_failure ON "EmailDelivery"');
    await db.$executeRawUnsafe('DROP FUNCTION test_recovery_finish_failure()');
  }
  const admitted = await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  expect(admitted).toMatchObject({ status: "SENDING", attempts: 1 });
  expect(admitted.attemptId).not.toBeNull();
  expect(mail.send).toHaveBeenCalledTimes(1);
  await db.emailDelivery.update({ where: { id: delivery.id }, data: { leaseUntil: new Date(0) } });
  await deliverNotifications();
  expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("UNCERTAIN");
  expect(mail.send).toHaveBeenCalledTimes(1);
  await finishIdentityNotice(db, delivery.id, admitted.attemptId!, true);
  expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("SENT");
});

it.each([false, true])(
  "defers leasing, SMTP and delivery status until audit commit (SMTP failure=%s)",
  async (fails) => {
    await db.notification.create({
      data: { userId: uid, title: "Synthetic update", link: "/messages" },
    });
    if (fails) mail.send.mockRejectedValue(new Error("Synthetic SMTP failure"));
    const queue = {
      effects: [] as Array<() => Promise<void>>,
      committed: false,
      onFailure: vi.fn(async () => undefined),
    };
    await afterCommitScope.run(queue, async () => {
      await deliverNotifications();
      expect(mail.send).not.toHaveBeenCalled();
      const pending = await db.emailDelivery.findMany({
        where: { userId: uid },
      });
      expect(pending).toHaveLength(2);
      expect(
        pending.every(
          (row) =>
            row.status === "PENDING" &&
            row.leaseUntil === null &&
            row.attempts === 0,
        ),
      ).toBe(true);
      await flushCommittedEffects();
    });
    expect(mail.send).toHaveBeenCalledTimes(2);
    const delivered = await db.emailDelivery.findMany({
      where: { userId: uid },
    });
    expect(
      delivered.every(
        (row) =>
          row.status === (fails ? "UNCERTAIN" : "SENT") &&
          row.leaseUntil === null &&
          row.attempts === 1,
      ),
    ).toBe(true);
    for (const [message] of mail.send.mock.calls) {
      expect(message.presentation?.unsubscribeUrl).toBeDefined();
      expect(message.text).toContain("Unsubscribe / 取消订阅:");
    }
    // Admitted SMTP failure is durable uncertainty, not an audit write failure.
    expect(queue.onFailure).not.toHaveBeenCalled();
  },
);

it("persists distinct notification destinations for all verified recipients and delivers identical HTML/text actions", async () => {
  const paths = [
    "/admin/approvals?request=synthetic#details",
    "/admin/applications#application-synthetic",
  ];
  for (const link of paths)
    await db.notification.create({
      data: {
        userId: uid,
        title: "PRIVATE SENTINEL",
        body: "PRIVATE BODY",
        link,
      },
    });
  const rows = await db.emailDelivery.findMany({ where: { userId: uid } });
  expect(rows).toHaveLength(4);
  for (const path of paths)
    expect(rows.filter((row) => row.destination === path)).toHaveLength(2);
  await deliverNotifications();
  expect(mail.send).toHaveBeenCalledTimes(4);
  for (const [message] of mail.send.mock.calls) {
    expect(message.category).toBe("PROGRAM");
    const url = new URL(message.presentation!.action!.url);
    expect(paths).toContain(url.searchParams.get("callbackUrl"));
    expect(message.text).toContain(url.href);
    const unsubscribe = new URL(message.presentation!.unsubscribeUrl!);
    expect(unsubscribe.pathname).toBe("/unsubscribe");
    expect(
      rows.some(
        (row) =>
          row.id ===
          verifyUnsubscribeToken(unsubscribe.searchParams.get("token")!),
      ),
    ).toBe(true);
    expect(message.text).toContain(
      `Unsubscribe / 取消订阅: ${unsubscribe.href}`,
    );
    expect(message.text).toContain("Asia/Shanghai");
    expect(message.text).not.toContain("do not recognize");
    const html = renderEmail({ brand: "School", ...message });
    expect(html).not.toContain("PRIVATE SENTINEL");
    expect(html).not.toContain("PRIVATE BODY");
    expect(html).toContain("View program update / 查看项目通知");
  }
  expect(
    await db.emailDelivery.count({ where: { userId: uid, status: "SENT" } }),
  ).toBe(4);
});

it("uses safe home fallback for legacy rows, external links and staff role loss", async () => {
  await db.notification.create({
    data: { userId: uid, title: "Program", link: "/admin/applications" },
  });
  await db.user.update({ where: { id: uid }, data: { role: "VIEWER" } });
  // Account-change notices from the role update remain valid; inspect program notices only.
  await db.emailDelivery.updateMany({
    where: { userId: uid, event: "program_update" },
    data: { destination: null },
  });
  await db.notification.create({
    data: { userId: uid, title: "Program", link: "https://evil.example" },
  });
  await db.notification.create({
    data: { userId: uid, title: "Program", link: "/admin/applications" },
  });
  await deliverNotifications(20);
  const messages = mail.send.mock.calls
    .map(([message]) => message)
    .filter((message) => message.subject === "Program Update / 项目通知");
  expect(messages).toHaveLength(6);
  for (const message of messages)
    expect(
      new URL(message.presentation!.action!.url).searchParams.get(
        "callbackUrl",
      ),
    ).toBe("/");
});

it("rolls back notification destinations with the originating transaction", async () => {
  await expect(
    db.$transaction(async (tx) => {
      await tx.notification.create({
        data: { userId: uid, title: "Program", link: "/admin/applications" },
      });
      throw Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(await db.emailDelivery.count({ where: { userId: uid } })).toBe(0);
});

it.each(["head-to-admin", "admin-to-student", "admin-suspended"] as const)(
  "rechecks queued crew and tutor review authority without changing their topic (%s)",
  async (scenario) => {
    await db.user.update({
      where: { id: uid },
      data: { role: scenario === "head-to-admin" ? "HEAD" : "ADMIN", emailInfo: false },
    });
    // Exercise the explicit topic opt-in while the legacy review switch stays off.
    await db.notificationPreference.create({
      data: { userId: uid, category: "reviews", emailEnabled: true },
    });
    for (const event of ["crew_application_pending", "tutor_optout_requested"] as const)
      await db.notification.create({
        data: {
          userId: uid, event, title: "Synthetic review request",
          link: event === "crew_application_pending" ? "/admin/crew#application-synthetic" : "/admin/tutor-requests#request-synthetic",
          context: { inAppDetail: { en: "Morgan's request awaits review.", zh: "Morgan 的申请待审核。" } },
        },
      });
    const queued = await db.emailDelivery.findMany({ where: { userId: uid } });
    expect(queued).toHaveLength(4);
    expect(queued.every((row) => row.category === "review" && row.preferenceTopic === "reviews" && row.status === "PENDING")).toBe(true);

    await db.user.update({
      where: { id: uid },
      data: scenario === "admin-suspended"
        ? { suspendedAt: new Date() }
        : { role: scenario === "head-to-admin" ? "ADMIN" : "STUDENT" },
    });
    await deliverNotifications(20);
    const allowed = scenario === "head-to-admin";
    expect(mail.send).toHaveBeenCalledTimes(allowed ? 4 : 0);
    const completed = await db.emailDelivery.findMany({ where: { id: { in: queued.map((row) => row.id) } } });
    expect(completed).toHaveLength(4);
    for (const row of completed)
      expect(row).toMatchObject({ category: "review", preferenceTopic: "reviews", status: allowed ? "SENT" : "SKIPPED", leaseUntil: null });
    if (allowed) {
      expect(new Set(mail.send.mock.calls.map(([message]) => message.messageId)))
        .toEqual(new Set(queued.map((row) => `<account-notice-${row.id}@shbs-notifications>`)));
      expect(mail.send.mock.calls.every(([message]) => message.text.includes("Morgan's request awaits review."))).toBe(true);
    }
  },
);

it("releases the lease and retries safely when the public origin is invalid", async () => {
  await db.notification.create({
    data: { userId: uid, title: "Program", link: "/messages" },
  });
  vi.stubEnv("AUTH_URL", "not-a-url");
  try {
    await deliverNotifications();
  } finally {
    vi.unstubAllEnvs();
  }
  expect(mail.send).not.toHaveBeenCalled();
  const rows = await db.emailDelivery.findMany({ where: { userId: uid } });
  expect(rows).toHaveLength(2);
  for (const row of rows)
    expect(row).toMatchObject({
      status: "PENDING",
      leaseUntil: null,
      attempts: 1,
    });
});

it("reports admitted SMTP uncertainty without presenting it as a retryable transport failure", async () => {
  await db.notification.create({
    data: { userId: uid, title: "Synthetic program update", link: "/messages" },
  });
  mail.send.mockRejectedValue(new Error("Private provider diagnostic"));
  await deliverNotifications();
  const failedAttempt = await getEmailDeliveryStatus(db);
  expect(failedAttempt).toMatchObject({ retrying: 0, failed: 0, uncertain: 2 });
  expect(mail.send).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(failedAttempt)).not.toContain(
    "Private provider diagnostic",
  );

  // Changing the due date does not authorize a second admitted send.
  await db.emailDelivery.updateMany({
    where: { userId: uid },
    data: { availableAt: new Date(0) },
  });
  mail.send.mockResolvedValue(undefined);
  await deliverNotifications();
  expect(await getEmailDeliveryStatus(db)).toMatchObject({
    retrying: 0,
    failed: 0,
    uncertain: 2,
  });
  expect(mail.send).toHaveBeenCalledTimes(2);
});

it.each(["unchanged", "opted-out", "secondary-removed"])(
  "requeued mail retains Message-ID and respects current recipient eligibility (%s)",
  async (scenario) => {
    await db.notification.create({
      data: {
        userId: uid,
        title: "Synthetic program update",
        link: "/messages",
      },
    });
    // Copy preparation can fail before transport admission and remains safe to
    // retry. An already-admitted SMTP failure is covered by the no-replay cases.
    vi.stubEnv("AUTH_URL", "not-a-url");
    try { await deliverNotifications(); } finally { vi.unstubAllEnvs(); }
    expect(mail.send).not.toHaveBeenCalled();
    const attemptedIds = (await db.emailDelivery.findMany({ where: { userId: uid } }))
      .map((row) => `<account-notice-${row.id}@shbs-notifications>`).sort();
    expect(attemptedIds).toHaveLength(2);
    await db.emailDelivery.updateMany({
      where: { userId: uid },
      data: { status: "FAILED", attempts: 5 },
    });
    mail.send.mockClear().mockResolvedValue(undefined);
    expect(await resendStuckEmails(db, { id: uid })).toEqual({ queued: 2 });
    // The operator only queues; SMTP remains exclusively the worker's responsibility.
    expect(mail.send).not.toHaveBeenCalled();
    if (scenario === "opted-out") {
      // The notification trigger classifies /messages destinations as private-message mail.
      await db.user.update({
        where: { id: uid },
        data: { emailMessages: false },
      });
    }
    if (scenario === "secondary-removed")
      await db.accountEmail.deleteMany({
        where: { userId: uid, email: "email192-secondary@example.test" },
      });
    await deliverNotifications();
    if (scenario === "opted-out") {
      expect(mail.send).not.toHaveBeenCalled();
      expect(
        await db.emailDelivery.count({
          where: { userId: uid, status: "SKIPPED" },
        }),
      ).toBe(2);
    } else if (scenario === "secondary-removed") {
      expect(mail.send).toHaveBeenCalledTimes(1);
      const message = mail.send.mock.calls[0]![0];
      expect(message.to).toBe("email192@example.test");
      expect(attemptedIds).toContain(message.messageId);
      expect(
        await db.emailDelivery.count({
          where: { userId: uid, status: "SENT" },
        }),
      ).toBe(1);
      expect(
        await db.emailDelivery.count({
          where: { userId: uid, status: "SKIPPED" },
        }),
      ).toBe(1);
    } else {
      expect(
        mail.send.mock.calls.map(([message]) => message.messageId).sort(),
      ).toEqual(attemptedIds);
      expect(
        await db.emailDelivery.count({
          where: { userId: uid, status: "SENT" },
        }),
      ).toBe(2);
    }
  },
);

it.each([false, true])(
  "preserves cancellation when an in-flight SMTP attempt settles (failure=%s)",
  async (fails) => {
    await db.notification.create({
      data: { userId: uid, title: "Program", link: "/messages" },
    });
    mail.send.mockImplementation(async (message) => {
      const token = new URL(
        message.presentation!.unsubscribeUrl!,
      ).searchParams.get("token")!;
      expect(await unsubscribeFromEmail(token, "all")).toMatchObject({
        status: "unsubscribed",
      });
      if (fails) throw new Error("synthetic SMTP failure after opt-out");
    });
    await deliverNotifications();
    expect(mail.send).toHaveBeenCalledTimes(1);
    const rows = await db.emailDelivery.findMany({ where: { userId: uid } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => !row.attemptStartedAt).every((row) => row.status === "SKIPPED")).toBe(true);
    expect(rows.filter((row) => !!row.attemptStartedAt)).toHaveLength(1);
    expect(rows.find((row) => !!row.attemptStartedAt)?.status).toBe(fails ? "UNCERTAIN" : "SENT");
    expect(rows.every((row) => row.leaseUntil === null)).toBe(true);
  },
);
