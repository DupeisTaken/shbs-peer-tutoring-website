import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { TransactionDb } from "~/server/transactions";

const available = vi.hoisted(() => vi.fn());
vi.mock("./sender", () => ({ isEmailDeliveryAvailable: available }));
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { resendStuckEmails } from "./resend-stuck";

const uid = "email-resend-synthetic";
const actor = { id: uid, name: "Synthetic operator" };
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  await db.emailDelivery.deleteMany();
  await db.auditLog.deleteMany({ where: { userId: uid } });
  await db.user.deleteMany({ where: { id: uid } });
  await db.user.create({
    data: { id: uid, role: "ADMIN", email: "retry@example.test" },
  });
  await db.programSettings.upsert({
    where: { id: "program" },
    create: { id: "program", emailNotificationsEnabled: true },
    update: { emailNotificationsEnabled: true },
  });
  available.mockReset().mockReturnValue(true);
});
afterAll(async () => {
  await db.user.deleteMany({ where: { id: uid } });
  await db.auditLog.deleteMany({ where: { userId: uid } });
  await db.$disconnect();
});

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: uid,
    category: "information",
    event: "program_update",
    recipient: "private-recipient@example.test",
    destination: "/messages?private-sentinel",
    previousPrimary: true,
    status: "FAILED",
    attempts: 5,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    availableAt: new Date(0),
    completedAt: new Date(1),
    lastError: "Private provider sentinel",
    ...overrides,
  };
}

it("requeues only stuck unleased records without altering recipients, IDs or payloads", async () => {
  const rows = [
    row("failed"),
    row("retrying", { status: "PENDING", attempts: 1 }),
    row("expired-lease", { leaseUntil: new Date(0) }),
    row("sending", {
      status: "PENDING",
      leaseUntil: new Date(Date.now() + 60_000),
    }),
    row("failed-leased", { leaseUntil: new Date(Date.now() + 60_000) }),
    row("fresh", { status: "PENDING", attempts: 0 }),
    row("sent", { status: "SENT" }),
    row("skipped", { status: "SKIPPED" }),
  ];
  await db.emailDelivery.createMany({ data: rows });
  const before = await db.emailDelivery.findMany({ orderBy: { id: "asc" } });
  expect(await resendStuckEmails(db, actor)).toEqual({ queued: 3 });
  const after = await db.emailDelivery.findMany({ orderBy: { id: "asc" } });
  for (const original of before) {
    const actual = after.find((item) => item.id === original.id)!;
    if (["failed", "retrying", "expired-lease"].includes(original.id)) {
      expect(actual).toEqual({
        ...original,
        status: "PENDING",
        attempts: 0,
        availableAt: expect.any(Date) as Date,
        leaseUntil: null,
        completedAt: null,
        lastError: null,
      });
      expect(actual.availableAt.getTime()).toBeGreaterThan(Date.now() - 10_000);
    } else expect(actual).toEqual(original);
  }
  expect(await resendStuckEmails(db, actor)).toEqual({ queued: 0 });
  const audits = await db.auditLog.findMany({
    where: { userId: uid },
    orderBy: { createdAt: "asc" },
  });
  expect(audits.map((audit) => audit.details)).toEqual([
    { queued: 3, batchLimit: 100 },
    { queued: 0, batchLimit: 100 },
  ]);
  expect(JSON.stringify(audits)).not.toContain("private-recipient");
  expect(JSON.stringify(audits)).not.toContain("sentinel");
});

it("limits each request to the oldest 100 and gives concurrent requests disjoint batches", async () => {
  await db.emailDelivery.createMany({
    data: Array.from({ length: 103 }, (_, index) =>
      row(`batch-${String(index).padStart(3, "0")}`, {
        createdAt: new Date(index * 1000),
      }),
    ),
  });
  // Exercise the batch order independently, then refill for concurrent claim verification.
  expect(await resendStuckEmails(db, actor)).toEqual({ queued: 100 });
  expect(
    (
      await db.emailDelivery.findMany({
        where: { status: "FAILED" },
        orderBy: { id: "asc" },
      })
    ).map((item) => item.id),
  ).toEqual(["batch-100", "batch-101", "batch-102"]);
  await db.emailDelivery.updateMany({
    data: { status: "FAILED", attempts: 5 },
  });
  const results = await Promise.all([
    resendStuckEmails(db, actor),
    resendStuckEmails(db, actor),
  ]);
  expect(results.map((result) => result.queued).sort((a, b) => a - b)).toEqual([
    3, 100,
  ]);
  expect(
    await db.emailDelivery.count({ where: { status: "PENDING", attempts: 0 } }),
  ).toBe(103);
  expect(await resendStuckEmails(db, actor)).toEqual({ queued: 0 });
});

it("leaves disabled optional mail stuck while allowing mandatory security retries", async () => {
  await db.emailDelivery.createMany({
    data: [row("optional"), row("security", { category: "security" })],
  });
  await db.programSettings.update({
    where: { id: "program" },
    data: { emailNotificationsEnabled: false },
  });
  expect(await resendStuckEmails(db, actor)).toEqual({ queued: 1 });
  expect(
    await db.emailDelivery.findUnique({ where: { id: "optional" } }),
  ).toMatchObject({ status: "FAILED", attempts: 5 });
  expect(
    await db.emailDelivery.findUnique({ where: { id: "security" } }),
  ).toMatchObject({ status: "PENDING", attempts: 0 });
});

it("retains failure evidence for an unconfigured channel", async () => {
  await db.emailDelivery.createMany({
    data: [row("optional"), row("security", { category: "security" })],
  });
  available.mockImplementation((category) => category === "SECURITY");
  expect(await resendStuckEmails(db, actor)).toEqual({ queued: 1 });
  expect(
    await db.emailDelivery.findUnique({ where: { id: "optional" } }),
  ).toMatchObject({ status: "FAILED", attempts: 5 });
});

it("skips a row locked by another worker without waiting for that worker", async () => {
  await db.emailDelivery.createMany({ data: [row("locked"), row("free")] });
  await db.$transaction(async (worker) => {
    await worker.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id = 'locked' FOR UPDATE`;
    // A separate transaction must finish while the worker still owns its row lock.
    expect(await resendStuckEmails(db, actor)).toEqual({ queued: 1 });
  });
  expect(
    await db.emailDelivery.findUnique({ where: { id: "locked" } }),
  ).toMatchObject({ status: "FAILED", attempts: 5 });
});

it("rolls back requeue when the aggregate audit cannot be saved", async () => {
  await db.emailDelivery.create({ data: row("rollback") });
  await expect(
    db.$transaction(async (tx) => {
      // Keep real transactional reads/writes but inject the final audit failure.
      const failing = {
        $queryRaw: tx.$queryRaw.bind(tx),
        $executeRaw: tx.$executeRaw.bind(tx),
        programSettings: tx.programSettings,
        auditLog: {
          create: vi.fn().mockRejectedValue(new Error("Audit unavailable")),
        },
      } as unknown as TransactionDb;
      await resendStuckEmails(failing, actor);
    }),
  ).rejects.toThrow("Audit unavailable");
  expect(
    await db.emailDelivery.findUnique({ where: { id: "rollback" } }),
  ).toMatchObject({ status: "FAILED", attempts: 5 });
  expect(await db.auditLog.count({ where: { userId: uid } })).toBe(0);
});
