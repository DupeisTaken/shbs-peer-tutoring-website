import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "~/server/db";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { syncPunishmentRemoval } from "./removal";

beforeAll(() => assertIsolatedTestDatabase(process.env.DATABASE_URL));
afterAll(() => db.$disconnect());

type Fixture = Awaited<ReturnType<typeof seed>>;

async function seed(
  tx: TransactionDb,
  role: "ADMIN" | "HEAD",
  overlap: boolean,
) {
  const prefix = `removal-notices-${randomUUID()}`;
  await tx.programSettings.upsert({
    where: { id: "program" },
    create: { id: "program", emailNotificationsEnabled: true },
    update: { emailNotificationsEnabled: true, notificationLocks: {} },
  });
  await tx.term.updateMany({
    where: { active: true },
    data: { active: false },
  });
  const term = await tx.term.create({
    data: {
      schoolYear: prefix,
      quarter: "Q1",
      name: "Synthetic removal term",
      active: true,
    },
  });
  const student = await tx.tutee.create({
    data: {
      englishName: "Synthetic Learner",
      status: "ACTIVE",
      intakeTermId: term.id,
    },
  });
  const userIds: Record<string, string> = {};
  const tutorIds: Record<string, string> = {};
  for (const entry of [
    {
      key: "manager",
      role: role === "ADMIN" ? ("HEAD" as const) : ("ADMIN" as const),
      linked: false,
    },
    { key: "dual", role: overlap ? role : ("TUTOR" as const), linked: true },
    { key: "tutor", role: "TUTOR" as const, linked: true },
    { key: "muted", role: "TUTOR" as const, linked: true },
    { key: "unverified", role: "TUTOR" as const, linked: true },
    { key: "suspended", role: "ADMIN" as const, linked: false },
    { key: "merged", role: "ADMIN" as const, linked: false },
  ]) {
    const tutor = entry.linked
      ? await tx.tutor.create({
          data: { englishName: `Synthetic ${entry.key}`, status: "ACTIVE" },
        })
      : null;
    const user = await tx.user.create({
      data: {
        id: `${prefix}-${entry.key}`,
        email: `${prefix}-${entry.key}@example.test`,
        name: `Synthetic ${entry.key}`,
        role: entry.role,
        tutorId: tutor?.id,
        emailInfo: entry.key !== "muted",
        emailVerifiedAt: entry.key === "unverified" ? null : new Date(),
        suspendedAt: entry.key === "suspended" ? new Date() : null,
        mergedIntoId: entry.key === "merged" ? userIds.manager : null,
      },
    });
    userIds[entry.key] = user.id;
    if (tutor) tutorIds[entry.key] = tutor.id;
  }
  for (const [index, key] of [
    "tutor",
    "tutor",
    "dual",
    "muted",
    "unverified",
  ].entries())
    await tx.pairing.create({
      data: {
        tutorId: tutorIds[key]!,
        termId: term.id,
        subject: `Synthetic subject ${index}`,
        dayOfWeek: 1,
        startMin: 540 + index * 60,
        endMin: 585 + index * 60,
        tutees: { create: { tuteeId: student.id } },
      },
    });
  await tx.disciplinaryCard.createMany({
    data: [0, 1].map(() => ({
      tuteeId: student.id,
      color: "RED" as const,
      reviewStatus: "VALID" as const,
    })),
  });
  return { prefix, tuteeId: student.id, userIds };
}

/** Keep all settings, fixtures, real recovery metadata and outbox writes inside
 * one rolled-back transaction. This suite never dispatches mail or resets data. */
async function fixture(
  role: "ADMIN" | "HEAD",
  overlap: boolean,
  work: (tx: TransactionDb, data: Fixture) => Promise<void>,
) {
  const rollback = new Error("Rollback synthetic removal notification fixture");
  let data!: Fixture;
  await expect(
    db.$transaction(
      async (tx) => {
        data = await seed(tx, role, overlap);
        await work(tx, data);
        throw rollback;
      },
      { timeout: 20000 },
    ),
  ).rejects.toBe(rollback);
  // Domain state, bell notices and trigger-created mail all obey the same rollback.
  expect(await db.tutee.count({ where: { id: data.tuteeId } })).toBe(0);
  expect(
    await db.notification.count({
      where: { userId: { in: Object.values(data.userIds) } },
    }),
  ).toBe(0);
  expect(
    await db.emailDelivery.count({
      where: { userId: { in: Object.values(data.userIds) } },
    }),
  ).toBe(0);
}

async function assertDeliveries(
  tx: TransactionDb,
  data: Fixture,
  overlap: boolean,
) {
  const accountIds = Object.values(data.userIds);
  const notices = await tx.notification.findMany({
    where: { userId: { in: accountIds }, event: "tutee_removed" },
  });
  const expectedKeys = ["dual", "tutor", "muted", "unverified", "manager"];
  expect(notices.map((notice) => notice.userId).sort()).toEqual(
    expectedKeys.map((key) => data.userIds[key]!).sort(),
  );
  for (const key of expectedKeys) {
    const notice = notices.find((row) => row.userId === data.userIds[key]);
    expect(notice).toMatchObject({
      category: "tutoring",
      link:
        key === "manager" || (key === "dual" && overlap)
          ? "/admin/tutee-requests"
          : "/dashboard",
      context: {
        inAppDetail: {
          en: "Tutee Synthetic Learner was removed from the current roster.",
          zh: "学习伙伴 Synthetic Learner 已从本期名单移除。",
        },
      },
    });
  }
  const deliveries = await tx.emailDelivery.findMany({
    where: { userId: { in: accountIds }, event: "tutee_removed" },
  });
  expect(deliveries.map((row) => row.userId).sort()).toEqual(
    ["dual", "tutor", "manager"].map((key) => data.userIds[key]!).sort(),
  );
  for (const delivery of deliveries) {
    const notice = notices.find((row) => row.userId === delivery.userId)!;
    expect(delivery).toMatchObject({
      sourceNotificationId: notice.id,
      destination: notice.link,
      category: "info",
      preferenceTopic: "tutoring",
      status: "PENDING",
      attempts: 0,
      context: {
        emailDetail: (notice.context as { inAppDetail: unknown }).inAppDetail,
      },
    });
  }
  // The single bulk insert retains exact per-row causal attribution, including
  // queued mail, rather than manufacturing separate roots for recipient roles.
  const effects = await tx.recoveryDeliveryEffect.findMany({
    where: { notificationId: { in: notices.map((row) => row.id) } },
  });
  expect(effects).toHaveLength(notices.length + deliveries.length);
  expect(new Set(effects.map((effect) => effect.actionId)).size).toBe(1);
  expect(new Set(effects.map((effect) => effect.eventId)).size).toBe(1);
  for (const notice of notices)
    expect(
      effects.filter(
        (effect) => effect.notificationId === notice.id && !effect.deliveryId,
      ),
    ).toHaveLength(1);
  for (const delivery of deliveries)
    expect(
      effects.filter(
        (effect) =>
          effect.deliveryId === delivery.id &&
          effect.notificationId === delivery.sourceNotificationId,
      ),
    ).toHaveLength(1);
  return { notices, deliveries };
}

it.each(["ADMIN", "HEAD"] as const)(
  "queues one copy per account and chooses management for a dual-role %s",
  async (role) => {
    await fixture(role, true, async (tx, data) => {
      expect(await syncPunishmentRemoval(tx, data.tuteeId)).toEqual({
        removed: true,
      });
      const original = await assertDeliveries(tx, data, true);
      expect(await syncPunishmentRemoval(tx, data.tuteeId)).toEqual({
        removed: false,
      });
      expect(await assertDeliveries(tx, data, true)).toEqual(original);
      expect(
        await tx.pairingTutee.count({ where: { tuteeId: data.tuteeId } }),
      ).toBe(0);
      expect(
        await tx.tuteeRemovalRequest.count({
          where: { tuteeId: data.tuteeId, state: "APPROVED" },
        }),
      ).toBe(1);
    });
  },
);

it("keeps disjoint tutors and managers on their existing destinations with one eligible outbox row each", async () => {
  await fixture("ADMIN", false, async (tx, data) => {
    expect(await syncPunishmentRemoval(tx, data.tuteeId)).toEqual({
      removed: true,
    });
    await assertDeliveries(tx, data, false);
  });
});
