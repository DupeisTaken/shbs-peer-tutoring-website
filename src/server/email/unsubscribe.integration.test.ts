import { afterAll, beforeEach, expect, it } from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { createUnsubscribeToken } from "./unsubscribe-token";
import { getUnsubscribeStatus, unsubscribeFromEmail } from "./unsubscribe";

const userId = "unsubscribe-synthetic-owner";
const primary = "unsubscribe-primary@example.test";
const secondary = "unsubscribe-secondary@example.test";
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  await db.user.deleteMany({ where: { id: userId } });
  await db.user.create({
    data: {
      id: userId,
      email: primary,
      emailVerifiedAt: new Date(),
      emailMessages: true,
      emailInfo: true,
      emailSecondaryRecipients: true,
    },
  });
  await db.accountEmail.create({
    data: { userId, email: secondary, verifiedAt: new Date() },
  });
});
afterAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});
async function delivery(category = "messages", recipient = primary) {
  const row = await db.emailDelivery.create({
    data: {
      userId,
      category,
      recipient,
      event: category === "messages" ? "message_received" : "program_update",
    },
  });
  return { row, token: createUnsubscribeToken(row.id) };
}

it("status checks cannot change preferences or pending deliveries", async () => {
  const { row, token } = await delivery();
  expect(await getUnsubscribeStatus(token)).toEqual({
    status: "ready",
    category: "messages",
  });
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).emailMessages,
  ).toBe(true);
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } }))
      .status,
  ).toBe("PENDING");
});

it("category unsubscribe applies to all recipient copies, preserves other preferences and is idempotent", async () => {
  const { token } = await delivery("messages", secondary);
  await delivery("messages");
  const { row: info } = await delivery("info");
  const { row: security } = await delivery("security");
  const original = await db.user.findUniqueOrThrow({ where: { id: userId } });
  expect(await unsubscribeFromEmail(token, "category")).toEqual({
    status: "unsubscribed",
    category: "messages",
  });
  expect(await unsubscribeFromEmail(token, "category")).toEqual({
    status: "unsubscribed",
    category: "messages",
  });
  expect(await getUnsubscribeStatus(token)).toEqual({
    status: "already-unsubscribed",
    category: "messages",
  });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  expect(user).toMatchObject({
    emailMessages: false,
    emailInfo: true,
    emailSecurity: original.emailSecurity,
    emailSecondaryRecipients: true,
  });
  expect(
    await db.emailDelivery.count({
      where: { userId, category: "messages", status: "SKIPPED" },
    }),
  ).toBe(2);
  expect(
    await db.emailDelivery.count({
      where: { id: { in: [info.id, security.id] }, status: "PENDING" },
    }),
  ).toBe(2);
});

it("all optional scope disables messages and information but preserves essential mail", async () => {
  const { token } = await delivery("info");
  await delivery("messages");
  await delivery("information");
  const { row: security } = await delivery("security");
  expect(await unsubscribeFromEmail(token, "all")).toEqual({
    status: "unsubscribed",
    category: "info",
  });
  expect(
    await db.user.findUniqueOrThrow({ where: { id: userId } }),
  ).toMatchObject({ emailMessages: false, emailInfo: false });
  expect(
    await db.emailDelivery.count({ where: { userId, status: "SKIPPED" } }),
  ).toBe(3);
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: security.id } }))
      .status,
  ).toBe("PENDING");
});

it.each(["security", "unknown"])(
  "rejects %s even with a valid signature",
  async (category) => {
    const { token } = await delivery(category);
    expect(await getUnsubscribeStatus(token)).toEqual({ status: "invalid" });
    expect(await unsubscribeFromEmail(token, "all")).toEqual({
      status: "invalid",
    });
    expect(
      await db.user.findUniqueOrThrow({ where: { id: userId } }),
    ).toMatchObject({ emailMessages: true, emailInfo: true });
  },
);

it.each(["removed", "unverified", "previous-primary", "deleted-delivery"])(
  "invalidates %s ownership without changing preferences",
  async (scenario) => {
    const { row, token } = await delivery("messages", secondary);
    if (scenario === "removed")
      await db.accountEmail.delete({ where: { email: secondary } });
    if (scenario === "unverified")
      await db.accountEmail.update({
        where: { email: secondary },
        data: { verifiedAt: null },
      });
    if (scenario === "previous-primary")
      await db.emailDelivery.update({
        where: { id: row.id },
        data: { previousPrimary: true },
      });
    if (scenario === "deleted-delivery")
      await db.emailDelivery.delete({ where: { id: row.id } });
    expect(await getUnsubscribeStatus(token)).toEqual({ status: "invalid" });
    expect(await unsubscribeFromEmail(token, "all")).toEqual({
      status: "invalid",
    });
    expect(
      await db.user.findUniqueOrThrow({ where: { id: userId } }),
    ).toMatchObject({ emailMessages: true, emailInfo: true });
  },
);

it("rolls back both preferences and skipped queue rows with the containing transaction", async () => {
  const { row, token } = await delivery();
  await expect(
    db.$transaction(async (tx) => {
      expect(await unsubscribeFromEmail(token, "all", tx)).toEqual({
        status: "unsubscribed",
        category: "messages",
      });
      throw new Error("rollback synthetic unsubscribe");
    }),
  ).rejects.toThrow("rollback synthetic unsubscribe");
  expect(
    await db.user.findUniqueOrThrow({ where: { id: userId } }),
  ).toMatchObject({ emailMessages: true, emailInfo: true });
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } }))
      .status,
  ).toBe("PENDING");
});

it("rejects retired history owners while preserving the permanent merge guard", async () => {
  const { token } = await delivery();
  // Roll back this fixture: real retired identities are deliberately undeletable.
  await expect(
    db.$transaction(async (tx) => {
      const survivor = await tx.user.create({
        data: { email: "unsubscribe-survivor@example.test" },
      });
      await tx.user.update({
        where: { id: userId },
        data: { mergedIntoId: survivor.id },
      });
      expect(await getUnsubscribeStatus(token, tx)).toEqual({
        status: "invalid",
      });
      expect(await unsubscribeFromEmail(token, "all", tx)).toEqual({
        status: "invalid",
      });
      throw new Error("rollback retired fixture");
    }),
  ).rejects.toThrow("rollback retired fixture");
});
