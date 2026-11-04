import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

const caller = (id: string) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id,
        name: "Synthetic checkpoint reviewer",
        email: `${id}@example.test`,
      },
      role: "HEAD",
      tutorId: null,
      expires: "2099-01-01",
    },
  });
beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use isolated shipping test database.");
  const tables = await db.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  for (const [id, role] of [
    ["admin", "ADMIN"],
    ["head", "HEAD"],
    ["coordinator", "COORDINATOR"],
    ["viewer", "VIEWER"],
  ] as const)
    await db.user.create({ data: { id, role, email: `${id}@example.test` } });
  await db.term.create({
    data: {
      id: "checkpoint-term",
      name: "Synthetic checkpoint term",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.tutor.create({
    data: {
      id: "checkpoint-tutor",
      englishName: "Synthetic checkpoint tutor",
      status: "ARCHIVED",
    },
  });
});
afterAll(() => db.$disconnect());

async function ready() {
  const saved = await caller("admin").recovery.captureCheckpoint({
    adapter: "PARTICIPANT_TUTOR",
    sourceId: "checkpoint-tutor",
  });
  await db.tutor.update({
    where: { id: "checkpoint-tutor" },
    data: { status: "PENDING" },
  });
  return caller("admin").recovery.inspectCheckpoint({
    checkpointId: saved.checkpointId,
  });
}
const intent = (plan: { checkpointId: string; fingerprint: string }) => ({
  checkpointId: plan.checkpointId,
  expectedFingerprint: plan.fingerprint,
  clientKey: randomUUID(),
  reason: "Restore synthetic participant checkpoint",
});

it("allows prospective Coordinator capture and Admin restoration with safe durable receipt recovery", async () => {
  const captured = await caller("coordinator").recovery.captureCheckpoint({
    adapter: "PARTICIPANT_TUTOR",
    sourceId: "checkpoint-tutor",
  });
  expect(
    (await caller("coordinator").recovery.checkpoints({})).items.some(
      (row) => row.id === captured.checkpointId,
    ),
  ).toBe(true);
  await db.tutor.update({
    where: { id: "checkpoint-tutor" },
    data: { status: "PENDING" },
  });
  const plan = await caller("admin").recovery.inspectCheckpoint({
    checkpointId: captured.checkpointId,
  });
  expect(plan.websiteEligible).toBe(true);
  const input = intent(plan);
  const result = await caller("admin").recovery.restoreCheckpoint(input);
  expect(
    (await db.tutor.findUniqueOrThrow({ where: { id: "checkpoint-tutor" } }))
      .status,
  ).toBe("ARCHIVED");
  expect(await caller("admin").recovery.restoreCheckpoint(input)).toMatchObject(
    { receiptId: result.receiptId, replayed: true },
  );
  const receipt = await caller("admin").recovery.receipt({
    id: result.receiptId,
  });
  expect(receipt).toMatchObject({
    version: 1,
    evidenceVersion: 1,
    checkpoint: { id: captured.checkpointId },
    fingerprint: plan.fingerprint,
  });
  expect(receipt).not.toHaveProperty("evidence");
  expect(receipt).not.toHaveProperty("clientKey");
});

it("queues ordinary Coordinator restoration and rechecks changed evidence before Admin approval", async () => {
  const plan = await ready();
  await expect(
    caller("coordinator").recovery.restoreCheckpoint(intent(plan)),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.recoveryReceipt.count()).toBe(0);
  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "recovery.restoreCheckpoint" },
  });
  expect(proposal.targets).toMatchObject({
    checkpointId: plan.checkpointId,
    fingerprint: plan.fingerprint,
  });
  await db.tutor.update({
    where: { id: "checkpoint-tutor" },
    data: { status: "OPTED_OUT" },
  });
  await expect(
    caller("admin").approval.decide({
      id: proposal.id,
      approve: true,
      note: "Must reject stale reviewed checkpoint",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.recoveryReceipt.count()).toBe(0);
});

it("blocks two-event website execution and never accepts a forged operator flag", async () => {
  const plan = await ready();
  await db.tutor.update({
    where: { id: "checkpoint-tutor" },
    data: { status: "OPTED_OUT" },
  });
  const current = await caller("admin").recovery.inspectCheckpoint({
    checkpointId: plan.checkpointId,
  });
  expect(current.dependentEventCount).toBe(2);
  expect(current.websiteEligible).toBe(false);
  await expect(
    caller("admin").recovery.restoreCheckpoint(intent(current)),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(
    caller("admin").recovery.restoreCheckpoint({
      ...intent(current),
      channel: "OPERATOR",
    } as Parameters<
      ReturnType<typeof caller>["recovery"]["restoreCheckpoint"]
    >[0]),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.recoveryReceipt.count()).toBe(0);
});

it("rechecks current authority on reads and writes despite a forged Head cookie", async () => {
  const plan = await ready();
  await expect(
    caller("viewer").recovery.inspectCheckpoint({
      checkpointId: plan.checkpointId,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.user.update({ where: { id: "admin" }, data: { role: "VIEWER" } });
  await expect(caller("admin").recovery.checkpoints({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    caller("admin").recovery.restoreCheckpoint(intent(plan)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
