import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { EmailMessage } from "./email/sender";
const mail = vi.hoisted(() => ({
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
}));
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("./email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "./db";
import { createCaller } from "./api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  notificationLockCategories,
  type NotificationCategory,
  type NotificationLockValue,
} from "~/lib/notification-categories";
import {
  getUnsubscribeStatus,
  unsubscribeFromEmail,
} from "./email/unsubscribe";
import { createUnsubscribeToken } from "./email/unsubscribe-token";
import { deliverNotifications } from "./email/notification-delivery";
import { notificationLocksInput } from "./program/notification-locks";

const userId = "required-notifications-synthetic";
const email = "required-notifications@example.test";
function caller(role: Session["role"] = "ADMIN") {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: userId, name: "Synthetic Admin", email },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });
}
function locks(
  category: NotificationCategory,
  channels: Partial<Omit<NotificationLockValue, "category">> = {
    emailLocked: true,
  },
) {
  return notificationLockCategories({ [category]: channels });
}
async function setLocks(categories: NotificationLockValue[]) {
  return caller().program.setNotificationLocks({
    categories,
    expectedCategories: (await caller().program.notificationLockSettings())
      .categories,
  });
}
async function notice(
  category: "messages" | "announcements" | "program" = "messages",
  legacy = false,
) {
  if (legacy)
    return db.emailDelivery.create({
      data: {
        userId,
        recipient: email,
        category: category === "messages" ? "messages" : "info",
        event:
          category === "messages"
            ? "message_received"
            : category === "announcements"
              ? "announcement_published"
              : "program_update",
      },
    });
  await db.notification.create({
    data: {
      userId,
      title: "Synthetic notice",
      event:
        category === "messages"
          ? "message_received"
          : category === "announcements"
            ? "announcement_published"
            : "program_update",
    },
  });
  return db.emailDelivery.findFirstOrThrow({
    where: { userId, preferenceTopic: category, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
}
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  await db.emailDelivery.deleteMany();
  await db.user.deleteMany({ where: { id: userId } });
  await db.programSettings.upsert({
    where: { id: "program" },
    create: { id: "program", emailNotificationsEnabled: true },
    update: { emailNotificationsEnabled: true, notificationLocks: {} },
  });
  await db.user.create({
    data: {
      id: userId,
      email,
      role: "ADMIN",
      emailVerifiedAt: new Date(),
      emailMessages: false,
      emailInfo: true,
    },
  });
  mail.send.mockReset().mockResolvedValue(undefined);
});
afterAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.programSettings.update({
    where: { id: "program" },
    data: { notificationLocks: {} },
  });
  await db.$disconnect();
});

it("permits immediate Admin/Head changes, rejects Coordinator proposals and stale policy snapshots", async () => {
  const initial = (await caller().program.notificationLockSettings())
    .categories;
  await setLocks(locks("messages"));
  await expect(
    caller().program.setNotificationLocks({
      categories: locks("announcements"),
      expectedCategories: initial,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await db.user.update({
    where: { id: userId },
    data: { role: "COORDINATOR" },
  });
  expect(
    (await caller("COORDINATOR").program.notificationLockSettings()).canEdit,
  ).toBe(false);
  await expect(
    caller("COORDINATOR").program.setNotificationLocks({
      categories: initial,
      expectedCategories: locks("messages"),
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await db.approvalRequest.count({
      where: { requesterId: userId, operation: "program.setNotificationLocks" },
    }),
  ).toBe(0);
  await db.user.update({ where: { id: userId }, data: { role: "HEAD" } });
  await caller("HEAD").program.setNotificationLocks({
    categories: initial,
    expectedCategories: locks("messages"),
  });
  expect(
    await db.auditLog.count({
      where: { userId, operation: "program.setNotificationLocks" },
    }),
  ).toBeGreaterThanOrEqual(2);
});

it("validates complete unique category snapshots and unavailable reminder badges", () => {
  const categories = notificationLockCategories({});
  expect(
    notificationLocksInput.safeParse({
      categories: categories.slice(1),
      expectedCategories: categories,
    }).success,
  ).toBe(false);
  expect(
    notificationLocksInput.safeParse({
      categories: [...categories.slice(1), categories[1]],
      expectedCategories: categories,
    }).success,
  ).toBe(false);
  expect(
    notificationLocksInput.safeParse({
      categories: categories.map((row) =>
        row.category === "reminders" ? { ...row, badgeLocked: true } : row,
      ),
      expectedCategories: categories,
    }).success,
  ).toBe(false);
});

it("overlays ON while preserving personal choices across saves and unlocks, including stale form recovery", async () => {
  await caller().account.setNotificationPreferences({
    categories: [
      { category: "messages", badgeEnabled: false, emailEnabled: false },
    ],
  });
  await setLocks(locks("messages", { badgeLocked: true, emailLocked: true }));
  const locked = await caller().account.notificationPreferences();
  expect(
    locked.categories.find((row) => row.category === "messages"),
  ).toMatchObject({
    badgeEnabled: true,
    emailEnabled: true,
    badgeLocked: true,
    emailLocked: true,
    emailEditable: false,
  });
  await caller().account.setNotificationPreferences({
    categories: [
      { category: "messages", badgeEnabled: true, emailEnabled: true },
    ],
    expectedLocks: locked.categories,
  });
  expect(
    await db.notificationPreference.findUniqueOrThrow({
      where: { userId_category: { userId, category: "messages" } },
    }),
  ).toMatchObject({ badgeEnabled: false, emailEnabled: false });
  await expect(
    caller().account.setNotificationPreferences({
      categories: [
        { category: "messages", badgeEnabled: true, emailEnabled: false },
      ],
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await setLocks(notificationLockCategories({}));
  await expect(
    caller().account.setNotificationPreferences({
      categories: [
        { category: "messages", badgeEnabled: true, emailEnabled: true },
      ],
      expectedLocks: locked.categories,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (await caller().account.notificationPreferences()).categories.find(
      (row) => row.category === "messages",
    ),
  ).toMatchObject({ badgeEnabled: false, emailEnabled: false });
});

it("enforces badge and trigger requirements while retaining global email and essential-security boundaries", async () => {
  await caller().account.setNotificationPreferences({
    categories: [
      { category: "messages", badgeEnabled: false, emailEnabled: false },
    ],
  });
  await setLocks(locks("messages", { badgeLocked: true, emailLocked: true }));
  await notice();
  expect(await caller().notification.unreadCount()).toBe(1);
  expect(
    await db.emailDelivery.count({ where: { userId, category: "messages" } }),
  ).toBe(1);
  await db.programSettings.update({
    where: { id: "program" },
    data: { emailNotificationsEnabled: false },
  });
  await db.notification.create({
    data: {
      userId,
      title: "Synthetic second message",
      event: "message_received",
    },
  });
  expect(
    await db.emailDelivery.count({ where: { userId, category: "messages" } }),
  ).toBe(1);
  await db.$executeRaw`SELECT queue_account_email(${userId},'security','security_changed',NULL,NULL,NULL)`;
  expect(
    await db.emailDelivery.count({ where: { userId, category: "security" } }),
  ).toBe(1);
  await setLocks(notificationLockCategories({}));
  expect(await caller().notification.unreadCount()).toBe(0);
});

it("dispatches required mail over a saved opt-out, rechecks unlocks and never broadens reviewer authority", async () => {
  await setLocks(locks("messages"));
  await notice();
  await deliverNotifications();
  expect(mail.send).toHaveBeenCalledTimes(1);
  expect(mail.send.mock.calls[0]![0].text).toContain("administrator requires");
  const queued = await notice();
  await setLocks(notificationLockCategories({}));
  await deliverNotifications();
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: queued.id } }))
      .status,
  ).toBe("SKIPPED");
  await setLocks(locks("reviews"));
  await db.notification.create({
    data: {
      userId,
      title: "Synthetic review",
      event: "management_review_pending",
      link: "/admin/requests",
    },
  });
  const review = await db.emailDelivery.findFirstOrThrow({
    where: { userId, preferenceTopic: "reviews", status: "PENDING" },
  });
  await db.user.update({ where: { id: userId }, data: { role: "STUDENT" } });
  await deliverNotifications();
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: review.id } }))
      .status,
  ).toBe("SKIPPED");
  // The role edit legitimately queues account mail; it must not deliver the old review.
  expect(
    mail.send.mock.calls.filter(
      ([message]) => message.presentation?.eyebrow === "REVIEW REQUEST",
    ),
  ).toHaveLength(0);
});

it("blocks category unsubscribe and lets all scope stop only unlocked categories without discarding required choices", async () => {
  await setLocks(locks("messages"));
  const required = await notice();
  const token = createUnsubscribeToken(required.id);
  expect(await getUnsubscribeStatus(token)).toEqual({
    status: "locked",
    category: "messages",
  });
  expect(await unsubscribeFromEmail(token, "category")).toEqual({
    status: "locked",
    category: "messages",
  });
  await notice("program");
  expect(await unsubscribeFromEmail(token, "all")).toEqual({
    status: "unsubscribed",
    category: "messages",
    requiredRemaining: true,
  });
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: required.id } }))
      .status,
  ).toBe("PENDING");
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).emailMessages,
  ).toBe(false);
  await deliverNotifications();
  expect(mail.send).toHaveBeenCalledTimes(1);
});

it("handles mixed legacy information unsubscribe without cancelling required copies or sending optional copies", async () => {
  await setLocks(locks("announcements"));
  const required = await notice("announcements", true);
  const optional = await notice("program", true);
  expect(
    await unsubscribeFromEmail(createUnsubscribeToken(optional.id), "all"),
  ).toMatchObject({ status: "unsubscribed", requiredRemaining: true });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).emailInfo,
  ).toBe(false);
  expect(
    (
      await db.notificationPreference.findUniqueOrThrow({
        where: { userId_category: { userId, category: "announcements" } },
      })
    ).emailEnabled,
  ).toBe(true);
  await deliverNotifications();
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: required.id } }))
      .status,
  ).toBe("SENT");
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: optional.id } }))
      .status,
  ).toBe("SKIPPED");
  expect(mail.send).toHaveBeenCalledTimes(1);
});

it("prevents legacy broad-switch saves from overwriting a requirement's stored choice", async () => {
  await setLocks(locks("messages"));
  await caller().account.setEmailPreferences({
    emailMessages: true,
    emailInfo: true,
    emailSecondaryRecipients: false,
  });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).emailMessages,
  ).toBe(false);
  expect(
    (
      await db.notificationPreference.findUniqueOrThrow({
        where: { userId_category: { userId, category: "messages" } },
      })
    ).emailEnabled,
  ).toBe(false);
  await expect(
    caller().account.setEmailPreferences({
      emailMessages: false,
      emailInfo: true,
      emailSecondaryRecipients: false,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
