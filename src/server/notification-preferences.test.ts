import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "./db";
import { createCaller } from "./api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { notificationEvents } from "~/lib/notification-events";
import { notificationCategory } from "~/lib/notification-categories";
import { createUnsubscribeToken } from "./email/unsubscribe-token";
import { unsubscribeFromEmail } from "./email/unsubscribe";
import { notificationEmailCopy } from "./email/notification-copy";

const userId = "category-preferences-owner";
const address = "category-preferences@example.test";
const caller = (role: Session["role"] = "ADMIN") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: userId, name: "Synthetic Owner", email: address },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  await db.user.deleteMany({ where: { id: userId } });
  await db.programSettings.upsert({
    where: { id: "program" },
    create: { id: "program", emailNotificationsEnabled: true },
    update: { emailNotificationsEnabled: true },
  });
  await db.user.create({
    data: {
      id: userId,
      email: address,
      emailVerifiedAt: new Date(),
      role: "ADMIN",
      emailInfo: true,
    },
  });
});
afterAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

it("mutes the unread badge without hiding rows or changing their read state", async () => {
  const one = await db.notification.create({
    data: { userId, title: "Assignment", event: "student_assignment_updated" },
  });
  const two = await db.notification.create({
    data: { userId, title: "Announcement", event: "announcement_published" },
  });
  await caller().account.setNotificationPreferences({
    categories: [
      { category: "tutoring", badgeEnabled: false, emailEnabled: true },
    ],
  });
  expect(await caller().notification.unreadCount()).toBe(1);
  const list = await caller().notification.list();
  expect(list.map((row) => row.id)).toEqual(
    expect.arrayContaining([one.id, two.id]),
  );
  expect(list.every((row) => row.readAt === null)).toBe(true);
  await caller().account.setNotificationPreferences({
    categories: [
      { category: "tutoring", badgeEnabled: true, emailEnabled: true },
    ],
  });
  expect(await caller().notification.unreadCount()).toBe(2);
});

it("counts older muted unread notices separately and marks them read beyond the latest thirty", async () => {
  await db.notification.create({ data: { userId, title: "Older muted assignment", event: "student_assignment_updated", createdAt: new Date("2020-01-01") } });
  await db.notification.createMany({ data: Array.from({ length: 30 }, (_, index) => ({ userId, title: `Read ${index}`, event: "student_assignment_updated", readAt: new Date() })) });
  await caller().account.setNotificationPreferences({ categories: [{ category: "tutoring", badgeEnabled: false, emailEnabled: false }] });
  const visible = await caller().notification.list();
  expect(visible).toHaveLength(30);
  expect(visible.every((row) => row.readAt !== null)).toBe(true);
  expect(await caller().notification.unreadCount()).toBe(0);
  expect(await caller().notification.unreadCount({ includeMuted: true })).toBe(1);
  await caller().notification.markAllRead();
  expect(await caller().notification.unreadCount()).toBe(0);
  expect(await caller().notification.unreadCount({ includeMuted: true })).toBe(0);
});

it("allows badge-only changes with email disabled or after reviewer role loss", async () => {
  await db.user.update({
    where: { id: userId },
    data: { emailReviewRequests: true, role: "STUDENT" },
  });
  await db.programSettings.update({
    where: { id: "program" },
    data: { emailNotificationsEnabled: false },
  });
  await caller("STUDENT").account.setNotificationPreferences({
    categories: [
      { category: "reviews", badgeEnabled: false, emailEnabled: true },
    ],
  });
  expect(
    (await caller("STUDENT").account.notificationPreferences()).categories.find(
      (row) => row.category === "reviews",
    ),
  ).toMatchObject({
    badgeEnabled: false,
    emailEnabled: true,
    emailEditable: false,
  });
  await expect(
    caller("STUDENT").account.setNotificationPreferences({
      categories: [
        { category: "messages", badgeEnabled: true, emailEnabled: true },
      ],
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("routes category email choices independently and unsubscribes only the exact topic", async () => {
  await caller().account.setNotificationPreferences({
    categories: [
      { category: "tutoring", badgeEnabled: false, emailEnabled: false },
      { category: "announcements", badgeEnabled: true, emailEnabled: true },
    ],
  });
  await db.notification.create({
    data: { userId, title: "Assignment", event: "student_assignment_updated" },
  });
  await db.notification.create({
    data: { userId, title: "News", event: "announcement_published" },
  });
  expect(
    await db.emailDelivery.count({
      where: { userId, preferenceTopic: "tutoring" },
    }),
  ).toBe(0);
  const news = await db.emailDelivery.findFirstOrThrow({
    where: { userId, preferenceTopic: "announcements" },
  });
  await unsubscribeFromEmail(createUnsubscribeToken(news.id), "category");
  const prefs = (await caller().account.notificationPreferences()).categories;
  expect(
    prefs.find((row) => row.category === "announcements")?.emailEnabled,
  ).toBe(false);
  expect(prefs.find((row) => row.category === "account")?.emailEnabled).toBe(
    true,
  );
  expect(prefs.find((row) => row.category === "tutoring")?.badgeEnabled).toBe(
    false,
  );
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).emailInfo,
  ).toBe(true);
});

it("old clients preserve overrides on unchanged broad switches and propagate actual broad changes", async () => {
  await caller().account.setNotificationPreferences({
    categories: [
      { category: "tutoring", badgeEnabled: false, emailEnabled: false },
    ],
  });
  await caller().account.setEmailPreferences({
    emailMessages: false,
    emailInfo: true,
    emailSecondaryRecipients: false,
  });
  expect(
    (await caller().account.notificationPreferences()).categories.find(
      (row) => row.category === "tutoring",
    )?.emailEnabled,
  ).toBe(false);
  await caller().account.setEmailPreferences({
    emailMessages: false,
    emailInfo: false,
    emailSecondaryRecipients: false,
  });
  await caller().account.setEmailPreferences({
    emailMessages: false,
    emailInfo: true,
    emailSecondaryRecipients: false,
  });
  expect(
    (await caller().account.notificationPreferences()).categories.find(
      (row) => row.category === "tutoring",
    ),
  ).toMatchObject({ badgeEnabled: false, emailEnabled: true });
});

it("unchanged legacy opt-outs preserve pending legacy rows for enabled topic overrides", async () => {
  await db.user.update({ where: { id: userId }, data: { emailInfo: false } });
  await caller().account.setNotificationPreferences({
    categories: [
      { category: "tutoring", badgeEnabled: true, emailEnabled: true },
    ],
  });
  const delivery = await db.emailDelivery.create({
    data: {
      userId,
      category: "info",
      preferenceTopic: null,
      event: "student_assignment_updated",
      recipient: address,
    },
  });
  await caller().account.setEmailPreferences({
    emailMessages: false,
    emailInfo: false,
    emailSecondaryRecipients: false,
  });
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } }))
      .status,
  ).toBe("PENDING");
  expect(
    (await caller().account.notificationPreferences()).categories.find(
      (row) => row.category === "tutoring",
    )?.emailEnabled,
  ).toBe(true);
  await caller().account.setEmailPreferences({
    emailMessages: false,
    emailInfo: true,
    emailSecondaryRecipients: false,
  });
  await caller().account.setEmailPreferences({
    emailMessages: false,
    emailInfo: false,
    emailSecondaryRecipients: false,
  });
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } }))
      .status,
  ).toBe("SKIPPED");
});

it("keeps SQL and application classification identical for every event and reviewer role", async () => {
  for (const role of ["HEAD", "ADMIN", "STUDENT"]) {
    const rows = await db.$queryRaw<
      { event: string; category: string }[]
    >`SELECT value AS event, notification_topic(value,${role},NULL) AS category FROM jsonb_array_elements_text(${JSON.stringify(notificationEvents)}::jsonb)`;
    for (const row of rows)
      expect(row.category).toBe(notificationCategory(row.event, { role }));
  }
});

it("produces separate primary-email and password/2FA facts without secrets", async () => {
  await db.user.update({
    where: { id: userId },
    data: {
      email: "changed-category@example.test",
      passwordHash: "PRIVATE_PASSWORD_HASH",
      twoFactorEnabled: true,
    },
  });
  const rows = await db.emailDelivery.findMany({
    where: { userId, category: "security" },
  });
  expect(rows.some((row) => row.event === "primary_changed")).toBe(true);
  const security = rows.find((row) => row.event === "security_changed");
  expect(security).toBeDefined();
  const copy = notificationEmailCopy(security!.event, security!.context);
  expect(copy.description).toContain("Your password was changed.");
  expect(copy.description).toContain(
    "Email two-step verification was enabled.",
  );
  expect(JSON.stringify(rows)).not.toContain("PRIVATE_PASSWORD_HASH");
  await db.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false },
  });
  const disabled = await db.emailDelivery.findFirstOrThrow({
    where: {
      userId,
      event: "security_changed",
      context: {
        path: ["changedFields"],
        array_contains: ["twoFactorDisabled"],
      },
    },
  });
  expect(
    notificationEmailCopy(disabled.event, disabled.context).description,
  ).toContain("was disabled");
});

it("builds private-message and announcement mail only from their bounded factual fields", async () => {
  const unsafe = { en: "PRIVATE_BODY_SENTINEL", zh: "PRIVATE_BODY_SENTINEL" };
  const rows = await db.$queryRaw<
    { message: unknown; announcement: unknown; denied: unknown }[]
  >`
    SELECT notification_email_context('message_received',${JSON.stringify({ actorName: "Morgan", inAppDetail: unsafe, emailDetail: unsafe, recipients: ["private@example.test"] })}::jsonb) AS message,
      notification_email_context('announcement_published',${JSON.stringify({ announcementTitle: "Autumn schedule", announcementAction: "updated", emailDetail: unsafe })}::jsonb) AS announcement,
      notification_email_context('message_received',${JSON.stringify({ emailDetail: unsafe })}::jsonb) AS denied`;
  expect(JSON.stringify(rows)).toContain("Morgan sent you a private message");
  expect(JSON.stringify(rows)).toContain("Autumn schedule");
  expect(JSON.stringify(rows)).not.toMatch(/PRIVATE_BODY|private@example/);
  expect(rows[0]?.denied).toBeNull();
});
