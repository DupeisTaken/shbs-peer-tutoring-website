import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { EmailMessage } from "./sender";
const mail = vi.hoisted(() => ({
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
}));
vi.mock("./sender", () => ({
  emailSender: { send: mail.send },
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { deliverNotifications } from "./notification-delivery";

const reviewer = "notification-category-reviewer";
const student = "notification-category-student";
const ids = [reviewer, student];
const detail = {
  en: "Morgan requested a quarter withdrawal.",
  zh: "Morgan 申请退出本季度辅导。",
};
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  await db.emailDelivery.deleteMany();
  mail.send.mockReset().mockResolvedValue(undefined);
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.programSettings.upsert({
    where: { id: "program" },
    create: { id: "program", emailNotificationsEnabled: true },
    update: { emailNotificationsEnabled: true },
  });
  await db.user.createMany({
    data: [
      {
        id: reviewer,
        email: "category-reviewer@example.test",
        emailVerifiedAt: new Date(),
        role: "ADMIN",
        emailInfo: true,
      },
      {
        id: student,
        email: "category-student@example.test",
        emailVerifiedAt: new Date(),
        role: "STUDENT",
        emailInfo: true,
      },
    ],
  });
});
afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

async function pending(userId: string) {
  return db.notification.create({
    data: {
      userId,
      title: "Quarter withdrawal",
      event: "student_withdrawal_pending",
      body: "Private reason sentinel",
      context: {
        inAppDetail: detail,
        reason: "Private reason sentinel",
        email: "private@example.test",
      },
      link: userId === reviewer ? "/admin/requests" : "/student",
    },
  });
}

it("keeps participant updates on info while reviewers independently opt into review emails", async () => {
  await pending(reviewer);
  await pending(student);
  expect(await db.emailDelivery.count({ where: { userId: reviewer } })).toBe(0);
  const studentMail = await db.emailDelivery.findFirstOrThrow({
    where: { userId: student },
  });
  expect(studentMail.category).toBe("info");
  expect(studentMail.context).toEqual({ emailDetail: detail });
  await db.user.update({
    where: { id: reviewer },
    data: { emailInfo: false, emailReviewRequests: true },
  });
  await pending(reviewer);
  const reviewMail = await db.emailDelivery.findFirstOrThrow({
    where: { userId: reviewer },
  });
  expect(reviewMail.category).toBe("review");
  expect(reviewMail.context).toEqual({ emailDetail: detail });
  expect(JSON.stringify(reviewMail.context)).not.toMatch(
    /sentinel|private@example/,
  );
});

it("does not move outcomes into review mail or bypass the global/in-app-only gates", async () => {
  await db.user.update({
    where: { id: reviewer },
    data: { emailInfo: false, emailReviewRequests: true },
  });
  await db.notification.create({
    data: { userId: reviewer, title: "Approved", event: "management_approved" },
  });
  await db.notification.create({
    data: {
      userId: reviewer,
      title: "Review",
      event: "management_review_pending",
      inAppOnly: true,
    },
  });
  await db.programSettings.update({
    where: { id: "program" },
    data: { emailNotificationsEnabled: false },
  });
  await pending(reviewer);
  expect(await db.emailDelivery.count({ where: { userId: reviewer } })).toBe(0);
});

it("rejects malformed detail at the database boundary, and never promotes security or message text", async () => {
  await db.notification.create({
    data: {
      userId: student,
      title: "Update",
      event: "student_assignment_updated",
      context: {
        inAppDetail: { en: "x".repeat(1001), zh: "private sentinel" },
      },
    },
  });
  const row = await db.emailDelivery.findFirstOrThrow({
    where: { userId: student },
  });
  expect(row.context).toBeNull();
  const filtered = await db.$queryRaw<
    { context: unknown }[]
  >`SELECT notification_email_context('security_changed', ${JSON.stringify({ inAppDetail: detail })}::jsonb) AS context`;
  expect(filtered[0]?.context).toBeNull();
});

it("delivers only sanitized facts from the real notification trigger and rechecks revoked reviewer authority", async () => {
  await db.user.update({
    where: { id: reviewer },
    data: { emailInfo: false, emailReviewRequests: true },
  });
  await pending(reviewer);
  await deliverNotifications();
  expect(mail.send).toHaveBeenCalledTimes(1);
  const message = mail.send.mock.calls[0]![0];
  expect(message.text).toContain(detail.en);
  expect(message.text).toContain(detail.zh);
  expect(message.text).not.toMatch(/sentinel|private@example/);
  expect(message.presentation?.eyebrow).toBe("REVIEW REQUEST");
  expect(message.presentation?.unsubscribeUrl).toBeTruthy();
  await pending(reviewer);
  await db.user.update({ where: { id: reviewer }, data: { role: "STUDENT" } });
  await deliverNotifications();
  expect(mail.send).toHaveBeenCalledTimes(1);
  expect(
    await db.emailDelivery.count({
      where: { userId: reviewer, category: "review", status: "SKIPPED" },
    }),
  ).toBe(1);
});
