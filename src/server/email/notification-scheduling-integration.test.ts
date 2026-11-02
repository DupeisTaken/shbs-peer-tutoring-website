import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { notificationEvents } from "~/lib/notification-events";
import { notificationCategory } from "~/lib/notification-categories";
import { db } from "~/server/db";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

beforeAll(() => assertIsolatedTestDatabase(process.env.DATABASE_URL));
afterAll(() => db.$disconnect());

// Exercise the final installed migration chain, without retaining fixture data.
async function fixture(
  check: (tx: TransactionDb, userId: string) => Promise<void>,
) {
  const rollback = new Error("rollback notification scheduling fixture");
  await expect(
    db.$transaction(async (tx) => {
      await tx.programSettings.upsert({
        where: { id: "program" },
        create: { id: "program", emailNotificationsEnabled: true },
        update: { emailNotificationsEnabled: true },
      });
      const userId = randomUUID();
      await tx.user.create({
        data: {
          id: userId,
          email: `${userId}@example.test`,
          emailVerifiedAt: new Date(),
          role: "ADMIN",
          emailInfo: false,
          emailReviewRequests: false,
        },
      });
      await check(tx, userId);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

it("keeps every calendar and continuation event on the same topic in SQL and the bell", async () => {
  for (const event of notificationEvents) {
    for (const role of ["ADMIN", "HEAD", "STUDENT"]) {
      const rows = await db.$queryRaw<{ topic: string }[]>`
        SELECT notification_topic(${event}, ${role}, NULL) AS topic
      `;
      expect(rows[0]?.topic, `${event}/${role}`).toBe(
        notificationCategory(event, { role }),
      );
    }
  }
});

it("preserves review opt-in and specific facts after the calendar migration", async () => {
  await fixture(async (tx, userId) => {
    await tx.notificationPreference.create({
      data: {
        userId,
        category: "reviews",
        badgeEnabled: false,
        emailEnabled: true,
      },
    });
    const detail = {
      en: "Morgan requested assignment to Taylor.",
      zh: "Morgan 申请分配给 Taylor。",
    };
    const notice = await tx.notification.create({
      data: {
        userId,
        title: "Awaiting review",
        event: "management_review_pending",
        link: "/admin/approvals",
        context: { inAppDetail: detail, reason: "PRIVATE SENTINEL" },
      },
    });
    expect(notice.category).toBe("reviews");
    const rows = await tx.emailDelivery.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: "review",
      preferenceTopic: "reviews",
      context: { emailDetail: detail },
    });
    expect(JSON.stringify(rows[0]?.context)).not.toContain("PRIVATE SENTINEL");
  });
});

it("retains safe calendar context and respects the program-category override", async () => {
  await fixture(async (tx, userId) => {
    await tx.notificationPreference.create({
      data: {
        userId,
        category: "program",
        emailEnabled: true,
      },
    });
    const context = {
      schoolDate: "2096-10-29",
      isSchoolDay: true,
      timetableWeekday: 3,
      calendarRevision: 2,
      timeZone: "Asia/Shanghai",
    };
    for (const event of [
      "school_calendar_changed",
      "school_calendar_reset",
      "school_calendar_upcoming",
    ]) {
      await tx.notification.create({
        data: {
          userId,
          title: "School calendar",
          event,
          context: {
            ...context,
            staffNote: "PRIVATE SENTINEL",
            inAppDetail: { en: "PRIVATE", zh: "PRIVATE" },
          },
        },
      });
    }
    const rows = await tx.emailDelivery.findMany({ where: { userId } });
    expect(rows).toHaveLength(3);
    for (const row of rows)
      expect(row).toMatchObject({
        category: "info",
        preferenceTopic: "program",
        context,
      });
    expect(rows.map((row) => row.context)).toEqual([context, context, context]);
    await tx.notificationPreference.update({
      where: { userId_category: { userId, category: "program" } },
      data: { emailEnabled: false },
    });
    await tx.notification.create({
      data: {
        userId,
        title: "Calendar changed",
        event: "school_calendar_changed",
        context,
      },
    });
    expect(await tx.emailDelivery.count({ where: { userId } })).toBe(3);
  });
});
