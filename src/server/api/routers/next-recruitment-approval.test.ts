import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { databaseScope } from "~/server/db-scope";
import { ApprovalQueued } from "~/server/approvals";
import { lockEntity } from "~/server/transactions";
import { lockUsernameNamespace } from "~/server/auth/username";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import * as audit from "~/server/audit/log";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
  throw new Error("Next recruitment approval tests require local shbs_shipping_test");
const sourceId = "next-approval-source";
const opening = new Date("2030-11-01T00:00:00Z");
const caller = (role: "HEAD" | "ADMIN" = "HEAD") => createCaller({
  db,
  headers: new Headers(),
  session: {
    user: { id: `next-approval-${role}`, name: role },
    role, tutorId: null, expires: "2099-01-01",
  },
});

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) =>
    '"' + tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  await db.user.createMany({ data: (["HEAD", "ADMIN"] as const).map((role) => ({
    id: `next-approval-${role}`, role, name: role, email: `${role}@example.test`,
  })) });
  await db.term.create({ data: { id: sourceId, schoolYear: "26-27", quarter: "Q1",
    name: "26-27 Q1", active: true } });
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$disconnect());

async function prepareInput() {
  const snapshot = await caller().program.nextRecruitment();
  return { audience: "tutor" as const, opensAt: opening,
    expectedTarget: snapshot.target, expectedVersion: snapshot.preparations.tutor?.version ?? 0,
    expectedTimeZone: snapshot.timeZone };
}

async function queued(operation: "prepare" | "refresh") {
  const snapshot = await caller().program.nextRecruitment();
  const pending = operation === "prepare"
    ? caller("ADMIN").program.prepareNextRecruitment(await prepareInput())
    : caller("ADMIN").admin.refresh({ confirm: "REFRESH", expectedTermId: sourceId,
      expectedPreparation: snapshot.refreshEvidence });
  const error: unknown = await pending.catch((error: unknown) => error);
  expect((error as { cause?: unknown }).cause).toBeInstanceOf(ApprovalQueued);
  return db.approvalRequest.findUniqueOrThrow({
    where: { id: (error as { cause: ApprovalQueued }).cause.approvalId },
  });
}

it("rolls a failed refresh approval back without changing its evidence, then applies the exact reviewed retry", async () => {
  await caller().program.prepareNextRecruitment(await prepareInput());
  const learner = await db.tutee.create({ data: { englishName: "Synthetic Learner", status: "ACTIVE" } });
  const request = await queued("refresh");
  const preparations = await db.nextRecruitmentPreparation.findMany();
  const failure = vi.spyOn(audit, "recordAudit")
    .mockRejectedValueOnce(new Error("Synthetic refresh audit failure"));
  await expect(caller().approval.decide({ id: request.id, approve: true, note: "Reviewed destination and opening" }))
    .rejects.toThrow("Synthetic refresh audit failure");
  failure.mockRestore();

  const pending = await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
  expect(pending).toMatchObject({ state: "PENDING", reviewedAt: null,
    payload: request.payload, targets: request.targets, fingerprint: request.fingerprint });
  expect(await db.nextRecruitmentPreparation.findMany()).toEqual(preparations);
  expect(await db.term.count()).toBe(1);
  expect((await db.term.findFirstOrThrow({ where: { active: true } })).id).toBe(sourceId);
  expect((await db.tutee.findUniqueOrThrow({ where: { id: learner.id } })).status).toBe("ACTIVE");

  await caller().approval.decide({ id: request.id, approve: true, note: "Retry unchanged reviewed refresh" });
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }))
    .toMatchObject({ state: "APPROVED", payload: request.payload, targets: request.targets,
      fingerprint: request.fingerprint });
  expect((await db.term.findFirstOrThrow({ where: { active: true } })).tutorSignupOpensAt).toEqual(opening);
  expect((await db.tutee.findUniqueOrThrow({ where: { id: learner.id } })).status).toBe("INACTIVE");
  expect(await db.nextRecruitmentPreparation.findMany()).toEqual(preparations);
});

it.each([
  ["prepare", "ADMIN"], ["prepare", "HEAD"],
  ["refresh", "ADMIN"], ["refresh", "HEAD"],
] as const)("rejects a %s approval when %s authority changes during the period wait", async (operation, changedRole) => {
  const request = await queued(operation);
  let releaseWriter!: () => void;
  let announceWriter!: () => void;
  const release = new Promise<void>((resolve) => { releaseWriter = resolve; });
  const ready = new Promise<void>((resolve) => { announceWriter = resolve; });
  const writing = db.$transaction(async (tx) => {
    await lockEntity(tx, "program:period");
    announceWriter();
    await release;
    await tx.user.update({ where: { id: `next-approval-${changedRole}` }, data: { role: "COORDINATOR" } });
  }, { timeout: 10_000 }).then(
    () => ({ status: "fulfilled" as const }),
    (reason: unknown) => { announceWriter(); return { status: "rejected" as const, reason }; },
  );
  await ready;
  let pid = 0;
  // The real approval callback uses this enclosing Serializable transaction.
  // Its admission reads precede the advisory wait; the live actor row lock must
  // reject that old snapshot after the demotion commits.
  const reviewing = db.$transaction(async (tx) => {
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    return databaseScope.run(tx, () => caller().approval.decide({
      id: request.id, approve: true, note: "Waiting review must retain live authority",
    }));
  }, { isolationLevel: "Serializable", timeout: 10_000 }).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
  let observed = false;
  let observationError: unknown;
  try {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid = ${pid}
          AND wait_event_type = 'Lock' AND wait_event = 'advisory') AS waiting`;
      if (rows[0]?.waiting) { observed = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } catch (error) {
    observationError = error;
  } finally {
    releaseWriter();
  }
  const [writerResult, reviewResult] = await Promise.all([writing, reviewing]);
  expect(observationError).toBeUndefined();
  expect(observed).toBe(true);
  expect(writerResult).toMatchObject({ status: "fulfilled" });
  expect(reviewResult).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
  expect(await db.nextRecruitmentPreparation.count()).toBe(0);
  expect(await db.term.count()).toBe(1);
  expect((await db.term.findFirstOrThrow({ where: { active: true } })).id).toBe(sourceId);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } }))
    .toMatchObject({ state: "PENDING", payload: request.payload, targets: request.targets });
});

it("orders preparation review actor locks behind an in-flight Head transfer", async () => {
  const request = await queued("prepare");
  let releaseTransfer!: () => void;
  let announceTransfer!: () => void;
  const release = new Promise<void>((resolve) => { releaseTransfer = resolve; });
  const ready = new Promise<void>((resolve) => { announceTransfer = resolve; });
  const transferring = db.$transaction(async (tx) => {
    // Reproduce transferHead's namespace -> Head UPDATE -> successor UPDATE
    // order. The requester's Admin ID sorts before the reviewer's Head ID.
    await lockUsernameNamespace(tx);
    await tx.user.update({ where: { id: "next-approval-HEAD" }, data: { role: "ADMIN" } });
    announceTransfer();
    await release;
    await tx.user.update({ where: { id: "next-approval-ADMIN" }, data: { role: "HEAD" } });
  }, { timeout: 10_000 }).then(
    () => ({ status: "fulfilled" as const }),
    (reason: unknown) => { announceTransfer(); return { status: "rejected" as const, reason }; },
  );
  await ready;
  let pid = 0;
  const reviewing = db.$transaction(async (tx) => {
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    return databaseScope.run(tx, () => caller().approval.decide({
      id: request.id, approve: true, note: "Head review started during leadership transfer",
    }));
  }, { isolationLevel: "Serializable", timeout: 10_000 }).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
  let observedNamespaceWait = false;
  let observationError: unknown;
  try {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid = ${pid}
          AND wait_event_type = 'Lock' AND wait_event = 'advisory') AS waiting`;
      if (rows[0]?.waiting) { observedNamespaceWait = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } catch (error) {
    observationError = error;
  } finally {
    releaseTransfer();
  }
  const [transferResult, reviewResult] = await Promise.all([transferring, reviewing]);
  expect(observationError).toBeUndefined();
  expect(observedNamespaceWait).toBe(true);
  expect(transferResult).toMatchObject({ status: "fulfilled" });
  expect(reviewResult).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
  expect((await db.user.findUniqueOrThrow({ where: { id: "next-approval-ADMIN" } })).role).toBe("HEAD");
  expect(await db.nextRecruitmentPreparation.count()).toBe(0);
  expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).state).toBe("PENDING");
});

it.each(["prepare", "refresh"] as const)("refuses %s proposal capture after its Admin is demoted during the period wait", async (operation) => {
  const input = await prepareInput();
  const snapshot = await caller().program.nextRecruitment();
  let releaseWriter!: () => void;
  let announceWriter!: () => void;
  const release = new Promise<void>((resolve) => { releaseWriter = resolve; });
  const ready = new Promise<void>((resolve) => { announceWriter = resolve; });
  const writing = db.$transaction(async (tx) => {
    await lockEntity(tx, "program:period");
    announceWriter();
    await release;
    await tx.user.update({ where: { id: "next-approval-ADMIN" }, data: { role: "COORDINATOR" } });
  }, { timeout: 10_000 }).then(
    () => ({ status: "fulfilled" as const }),
    (reason: unknown) => { announceWriter(); return { status: "rejected" as const, reason }; },
  );
  await ready;
  let pid = 0;
  // Middleware admits the original Admin before capture waits. The queue must
  // reread authority under its actor lock before persisting immutable evidence.
  const capturing = db.$transaction(async (tx) => {
    pid = (await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
    return databaseScope.run(tx, () => operation === "prepare"
      ? caller("ADMIN").program.prepareNextRecruitment(input)
      : caller("ADMIN").admin.refresh({ confirm: "REFRESH", expectedTermId: sourceId,
        expectedPreparation: snapshot.refreshEvidence }));
  }, { timeout: 10_000 }).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
  let observed = false;
  let observationError: unknown;
  try {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid = ${pid}
          AND wait_event_type = 'Lock' AND wait_event = 'advisory') AS waiting`;
      if (rows[0]?.waiting) { observed = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } catch (error) {
    observationError = error;
  } finally {
    releaseWriter();
  }
  const [writerResult, captureResult] = await Promise.all([writing, capturing]);
  expect(observationError).toBeUndefined();
  expect(observed).toBe(true);
  expect(writerResult).toMatchObject({ status: "fulfilled" });
  expect(captureResult).toMatchObject({ status: "rejected", reason: { code: "FORBIDDEN" } });
  expect(await db.approvalRequest.count()).toBe(0);
  expect(await db.nextRecruitmentPreparation.count()).toBe(0);
  expect((await db.term.findFirstOrThrow({ where: { active: true } })).id).toBe(sourceId);
});
