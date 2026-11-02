import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import {
  beginAdmissionRecoveryCapture,
  finishAdmissionRecoveryCapture,
} from "~/server/recovery/capture";
import { reconcileApplication } from "~/server/tutors/application-status";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

// Deliberately forged cookie roles prove that every endpoint uses current authority.
const caller = (id: string) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: "Synthetic reviewer", email: `${id}@example.test` },
      role: "HEAD",
      tutorId: null,
      expires: "2099-01-01",
    },
  });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use the isolated shipping test database.");
  const tables = await db.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.term.create({
    data: {
      name: "Recovery test",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  for (const [id, role] of [
    ["admin", "ADMIN"],
    ["head", "HEAD"],
    ["coordinator", "COORDINATOR"],
    ["tutor", "TUTOR"],
    ["viewer", "VIEWER"],
  ] as const)
    await db.user.create({ data: { id, role, email: `${id}@example.test` } });
});
afterAll(() => db.$disconnect());

async function admission() {
  const application = await db.tutorApplication.create({
    data: {
      name: "Synthetic Candidate",
      firstName: "Synthetic",
      lastName: "Candidate",
      email: "candidate@example.test",
      status: "INTERVIEW",
    },
  });
  return db.$transaction(async (tx) => {
    const actionId = await beginAdmissionRecoveryCapture(tx, application.id);
    await tx.tutorApplication.update({
      where: { id: application.id },
      data: { status: "ACCEPTED" },
    });
    await reconcileApplication(tx, application.id);
    await finishAdmissionRecoveryCapture(tx, actionId);
    return actionId!;
  });
}

it("allows an Admin to preview and recover with durable, safe receipt evidence", async () => {
  const actionId = await admission();
  const api = caller("admin");
  expect((await api.recovery.list({})).items.map((row) => row.id)).toEqual([
    actionId,
  ]);
  const plan = await api.recovery.inspect({ actionId });
  expect(plan.websiteEligible).toBe(true);
  const input = {
    actionId,
    expectedFingerprint: plan.fingerprint,
    clientKey: randomUUID(),
    reason: "Reverse synthetic mistaken admission",
  };
  const result = await api.recovery.voidAdmission(input);
  expect(await api.recovery.voidAdmission(input)).toMatchObject({
    receiptId: result.receiptId,
    replayed: true,
  });
  const receipt = await api.recovery.receipt({ id: result.receiptId });
  expect(receipt).toMatchObject({
    actorId: "admin",
    actionId,
    channel: "WEBSITE",
  });
  expect(receipt).not.toHaveProperty("evidence");
  expect(receipt).not.toHaveProperty("clientKey");
});

it("queues eligible Coordinator recovery for Admin review without applying it", async () => {
  const actionId = await admission();
  const plan = await caller("coordinator").recovery.inspect({ actionId });
  await expect(
    caller("coordinator").recovery.voidAdmission({
      actionId,
      expectedFingerprint: plan.fingerprint,
      clientKey: randomUUID(),
      reason: "Review synthetic mistaken admission",
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.recoveryReceipt.count()).toBe(0);
  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "recovery.voidAdmission" },
  });
  expect(proposal.requesterId).toBe("coordinator");
  expect(proposal.targets).toMatchObject({
    actionId,
    fingerprint: plan.fingerprint,
  });
  await caller("admin").approval.decide({
    id: proposal.id,
    approve: true,
    note: "Reviewed complete synthetic recovery evidence",
  });
  expect(
    await db.recoveryReceipt.findUnique({ where: { actionId } }),
  ).toMatchObject({ actorId: "admin" });
});

it("rejects a queued recovery after later work changes its reviewed graph", async () => {
  const actionId = await admission();
  const plan = await caller("coordinator").recovery.inspect({ actionId });
  await expect(
    caller("coordinator").recovery.voidAdmission({
      actionId,
      expectedFingerprint: plan.fingerprint,
      clientKey: randomUUID(),
      reason: "Review synthetic mistaken admission",
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "recovery.voidAdmission" },
  });
  await db.tutorApplication.update({
    where: { id: plan.applicationId },
    data: { decisionComment: "Independent later review" },
  });
  await expect(
    caller("admin").approval.decide({
      id: proposal.id,
      approve: true,
      note: "Review must detect intervening work",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.recoveryReceipt.count()).toBe(0);
  expect(
    await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } }),
  ).toMatchObject({ state: "PENDING" });
  expect(
    await db.tutorApplication.findUniqueOrThrow({
      where: { id: plan.applicationId },
    }),
  ).toMatchObject({
    status: "ACCEPTED",
    decisionComment: "Independent later review",
  });
});

it("hides recovery reads from non-management and rereads revoked current access", async () => {
  for (const id of ["tutor", "viewer"])
    await expect(caller(id).recovery.list({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  await db.user.update({
    where: { id: "admin" },
    data: { suspendedAt: new Date() },
  });
  await expect(caller("admin").recovery.list({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it("never accepts an operator-channel override from a website caller", async () => {
  const actionId = await admission();
  const plan = await caller("head").recovery.inspect({ actionId });
  const input = {
    actionId,
    expectedFingerprint: plan.fingerprint,
    clientKey: randomUUID(),
    reason: "Review synthetic admission",
    channel: "OPERATOR",
  };
  await expect(
    caller("head").recovery.voidAdmission(input),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.recoveryReceipt.count()).toBe(0);
});

it("blocks legacy undo before queuing and preserves all original evidence", async () => {
  const entry = await db.auditLog.create({
    data: {
      entity: "TutorApplication",
      entityId: "legacy",
      action: "Synthetic legacy decision",
      undoData: { kind: "application.status", id: "legacy", status: "PENDING" },
    },
  });
  for (const id of ["head", "admin", "coordinator"])
    await expect(
      caller(id).admin.undoAudit({ id: entry.id }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(
    await db.auditLog.findUnique({ where: { id: entry.id } }),
  ).toMatchObject({ undone: false });
  expect(
    await db.approvalRequest.count({ where: { operation: "admin.undoAudit" } }),
  ).toBe(0);
});
