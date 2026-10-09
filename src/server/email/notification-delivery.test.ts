import { afterAll, beforeEach, expect, it, vi } from "vitest";
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
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { deliverNotifications } from "./notification-delivery";
import { getEmailDeliveryStatus } from "./delivery-status";
import { resendStuckEmails } from "./resend-stuck";
import { renderEmail } from "./template";

const uid = "email192-synthetic";
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
    expect(message.text).toContain("Asia/Shanghai");
    expect(message.text).not.toContain("do not recognize");
    const html = renderEmail({ brand: "School", ...message });
    expect(html).not.toContain("PRIVATE SENTINEL");
    expect(html).not.toContain("PRIVATE BODY");
    expect(html).toContain("View program update");
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
    .filter(
      (message) => message.subject === "You have a new program notification",
    );
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

it("reports the first SMTP failure as retrying and clears it after successful delivery", async () => {
  await db.notification.create({
    data: { userId: uid, title: "Synthetic program update", link: "/messages" },
  });
  mail.send.mockRejectedValue(new Error("Private provider diagnostic"));
  await deliverNotifications();
  const failedAttempt = await getEmailDeliveryStatus(db);
  expect(failedAttempt).toMatchObject({ retrying: 2, failed: 0 });
  expect(mail.send).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(failedAttempt)).not.toContain(
    "Private provider diagnostic",
  );

  // Make the durable retry due without waiting or altering the worker's retry policy.
  await db.emailDelivery.updateMany({
    where: { userId: uid },
    data: { availableAt: new Date(0) },
  });
  mail.send.mockResolvedValue(undefined);
  await deliverNotifications();
  expect(await getEmailDeliveryStatus(db)).toMatchObject({
    retrying: 0,
    failed: 0,
  });
  expect(mail.send).toHaveBeenCalledTimes(4);
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
    mail.send.mockRejectedValue(new Error("Synthetic SMTP outage"));
    await deliverNotifications();
    const attemptedIds = mail.send.mock.calls
      .map(([message]) => message.messageId)
      .sort();
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
      await db.user.update({ where: { id: uid }, data: { emailMessages: false } });
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
