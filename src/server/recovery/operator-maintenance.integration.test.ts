import { Client } from "pg";
import { afterAll, beforeEach, expect, it } from "vitest";
import { planningWeeks } from "~/lib/session-planning";
import { db } from "~/server/db";
import { utcDatabaseUrl } from "~/server/database-url";
import { ensureSessionPlanningWindow } from "~/server/session-planning";
import {
  acknowledgeSchedulingPublication,
  completeSchedulingInvalidation,
  finishSchedulingInvalidationBatch,
  prepareSchedulingInvalidationBatch,
  readSchedulingMaintenance,
} from "~/server/session-planning/maintenance";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import type { OperatorSql } from "./operator-site";
import {
  invalidateReconciledSchedulingMaintenance,
  RECOVERY_SCHEDULING_INVALIDATION_SOURCE,
} from "./operator-maintenance";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
  throw new Error(
    "Operator maintenance fixtures require the serial shbs_shipping_test database",
  );

const now = new Date("2026-10-26T00:00:00Z");
const window = {
  ...planningWeeks(now, "Asia/Shanghai"),
  timeZone: "Asia/Shanghai",
};

/** Keep the production pg query contract while sharing a real Prisma test
 * transaction. Commands return no result rows; every helper decision runs SQL. */
function operatorSql(tx: TransactionDb): Pick<OperatorSql, "query"> {
  return {
    async query(sql, values = []) {
      if (/^\s*(LOCK TABLE|SELECT pg_advisory_xact_lock)/.test(sql)) {
        await tx.$executeRawUnsafe(sql, ...values);
        return { rows: [] };
      }
      return {
        rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(
          sql,
          ...values,
        ),
      };
    },
  };
}

async function planningTransaction<T>(work: (tx: TransactionDb) => Promise<T>) {
  return db.$transaction(
    async (tx) => {
      for (const key of [
        "program:period",
        "planned-room-schedule",
        "session-planning",
      ])
        await lockEntity(tx, key);
      return work(tx);
    },
    { timeout: 10000, maxWait: 3000 },
  );
}
const publication = () =>
  planningTransaction((tx) => readSchedulingMaintenance(tx, window));
const invalidate = () =>
  db.$transaction(
    (tx) => invalidateReconciledSchedulingMaintenance(operatorSql(tx)),
    { isolationLevel: "Serializable", timeout: 10000, maxWait: 3000 },
  );

beforeEach(async () => {
  // Explicitly guarded, disposable committed fixtures are required for xmin and
  // late-commit tests. Run this suite serially with other database suites.
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
      AND tablename<>'_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(
          ({ tablename }) => 'public."' + tablename.replaceAll('"', '""') + '"',
        )
        .join(",") +
      " CASCADE",
  );
  await db.programSettings.create({ data: { timeZone: window.timeZone } });
  await db.term.create({
    data: {
      id: "operator-maintenance-term",
      name: "Synthetic operator maintenance term",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  // Draining metadata invalidates any existing watermark. Do this before
  // creating the committed warm generation used by the invalidation tests.
  await db.schedulingDirtyEvent.deleteMany();
  await db.schedulingMaintenanceState.create({
    data: {
      id: "program",
      publicationVersion: 1,
      settlementVersion: 1,
      windowStart: window.start,
      prepareEnd: window.prepareEnd,
      timeZone: window.timeZone,
    },
  });
});
afterAll(() => db.$disconnect());

it("rolls back the obsolete watermark and exact marker together when the enclosing reconciliation fails", async () => {
  const source = await db.schedulingDirtyEvent.create({
    data: { sourceTable: "synthetic-preserved-source" },
  });
  const beforeState = await db.schedulingMaintenanceState.findUniqueOrThrow({
    where: { id: "program" },
  });
  expect(beforeState).toMatchObject({
    publicationVersion: 1,
    settlementVersion: 1,
  });
  const beforeEvents = await db.schedulingDirtyEvent.findMany({
    orderBy: { id: "asc" },
  });
  const rollback = "rollback successful synthetic scheduling invalidation";
  let markerId = "";
  await expect(
    db.$transaction(
      async (tx) => {
        const result = await invalidateReconciledSchedulingMaintenance(
          operatorSql(tx),
        );
        markerId = result.eventId;
        expect(result.state).toBe("OBSOLETE");
        expect(
          await tx.schedulingMaintenanceState.findUniqueOrThrow({
            where: { id: "program" },
          }),
        ).toMatchObject({ publicationVersion: 0, settlementVersion: 0 });
        expect(
          await tx.schedulingDirtyEvent.findUniqueOrThrow({
            where: { id: BigInt(markerId) },
          }),
        ).toMatchObject({
          sourceTable: RECOVERY_SCHEDULING_INVALIDATION_SOURCE,
          publicationPending: true,
          settlementPending: true,
        });
        expect(
          await tx.schedulingDirtyEvent.findUniqueOrThrow({
            where: { id: source.id },
          }),
        ).toEqual(beforeEvents.find((event) => event.id === source.id));
        throw new Error(rollback);
      },
      { isolationLevel: "Serializable" },
    ),
  ).rejects.toThrow(rollback);
  expect(markerId).not.toBe("");
  expect(
    await db.schedulingMaintenanceState.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toEqual(beforeState);
  expect(
    await db.schedulingDirtyEvent.findMany({ orderBy: { id: "asc" } }),
  ).toEqual(beforeEvents);
  expect(
    await db.schedulingDirtyEvent.findUnique({
      where: { id: BigInt(markerId) },
    }),
  ).toBeNull();
});

it("invalidates without clearing events or retry evidence, rebuilds publication, then stays clean", async () => {
  const source = await db.schedulingDirtyEvent.create({
    data: { sourceTable: "synthetic-source" },
  });
  const retry = await db.schedulingDirtyEvent.create({
    data: {
      sourceTable: "maintenance-retry",
      requestId: "synthetic-open-retry",
      publicationPending: false,
    },
  });
  const before = await db.schedulingDirtyEvent.findMany({
    orderBy: { id: "asc" },
  });
  const result = await invalidate();
  expect(result).toMatchObject({
    version: 1,
    mode: "INVALIDATION",
    state: "OBSOLETE",
  });
  expect(
    await db.schedulingDirtyEvent.findMany({
      where: { id: { in: [source.id, retry.id] } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(before);
  expect(
    await db.schedulingDirtyEvent.findUniqueOrThrow({
      where: { id: BigInt(result.eventId) },
    }),
  ).toMatchObject({
    sourceTable: RECOVERY_SCHEDULING_INVALIDATION_SOURCE,
    requestId: null,
    publicationPending: true,
    settlementPending: true,
  });
  expect(
    await db.schedulingMaintenanceState.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toMatchObject({ publicationVersion: 0, settlementVersion: 0 });
  expect((await publication()).current).toBe(false);
  await ensureSessionPlanningWindow(db, now);
  expect((await publication()).current).toBe(true);
  const first = await db.schedulingMaintenanceState.findUniqueOrThrow({
    where: { id: "program" },
  });
  await ensureSessionPlanningWindow(db, now);
  expect((await publication()).current).toBe(true);
  expect(
    await db.schedulingMaintenanceState.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toEqual(first);
  expect(
    await db.schedulingDirtyEvent.findUniqueOrThrow({
      where: { id: retry.id },
    }),
  ).toMatchObject({
    publicationPending: false,
    settlementPending: true,
    requestId: retry.requestId,
  });
});

it("leaves missing state missing until an obsolete first publication and a clean second pass", async () => {
  await db.schedulingMaintenanceState.delete({ where: { id: "program" } });
  const result = await invalidate();
  expect(result.state).toBe("MISSING");
  expect(
    await db.schedulingMaintenanceState.findUnique({
      where: { id: "program" },
    }),
  ).toBeNull();
  await ensureSessionPlanningWindow(db, now);
  expect(
    await db.schedulingMaintenanceState.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toMatchObject({ publicationVersion: 0, settlementVersion: 0 });
  expect((await publication()).current).toBe(false);
  await ensureSessionPlanningWindow(db, now);
  expect((await publication()).current).toBe(true);
});

it("rebuilds the settlement queue from open requests while preserving the independent retry queue", async () => {
  const tutor = await db.tutor.create({
    data: { englishName: "Synthetic settlement tutor", status: "ACTIVE" },
  });
  const plan = await db.sessionPlan.create({
    data: {
      generationKey: "synthetic-operator-maintenance-plan",
      tutorId: tutor.id,
      termId: "operator-maintenance-term",
      originalDate: "2026-11-02",
      timeZone: window.timeZone,
      sourceFingerprint: "synthetic-reviewed-source",
    },
  });
  await db.sessionPlanningRequest.createMany({
    data: ["a-rebuild", "b-retry"].map((id) => ({
      id,
      planId: plan.id,
      cohortId: "synthetic-cohort",
      kind: "RESCHEDULE",
      scope: "ONE",
      participantIds: [],
      status: "PENDING",
    })),
  });
  const retry = await db.schedulingDirtyEvent.create({
    data: {
      sourceTable: "maintenance-retry",
      requestId: "b-retry",
      publicationPending: false,
    },
  });
  await db.schedulingMaintenanceState.update({
    where: { id: "program" },
    data: {
      settlementBatchActive: true,
      settlementBatchExhausted: true,
      settlementCursor: "obsolete-cursor",
      settlementRequestIds: ["obsolete-request"],
      settlementEventIds: [retry.id],
    },
  });
  const result = await invalidate();
  expect(
    await db.schedulingMaintenanceState.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toMatchObject({
    settlementVersion: 0,
    settlementRequestIds: ["obsolete-request"],
    settlementCursor: "obsolete-cursor",
    settlementEventIds: [retry.id],
  });
  await planningTransaction(async (tx) => {
    expect(await prepareSchedulingInvalidationBatch(tx)).toBe(true);
    const state = await tx.schedulingMaintenanceState.findUniqueOrThrow({
      where: { id: "program" },
    });
    expect(state.settlementVersion).toBe(1);
    expect(state.settlementRequestIds).toEqual(["a-rebuild"]);
    expect(state.settlementEventIds).toContain(BigInt(result.eventId));
    await completeSchedulingInvalidation(tx, "a-rebuild");
    await finishSchedulingInvalidationBatch(tx);
  });
  expect(
    await db.schedulingDirtyEvent.findUniqueOrThrow({
      where: { id: retry.id },
    }),
  ).toMatchObject({ requestId: "b-retry", settlementPending: true });
  expect(
    await db.sessionPlanningRequest.findMany({
      select: { id: true, status: true },
      orderBy: { id: "asc" },
    }),
  ).toEqual([
    { id: "a-rebuild", status: "PENDING" },
    { id: "b-retry", status: "PENDING" },
  ]);
});

it("rejects a stale publication ACK after invalidation through the committed xmin generation", async () => {
  const source = await db.schedulingDirtyEvent.create({
    data: { sourceTable: "synthetic-observed-source" },
  });
  const before = await publication();
  expect(before.eventIds).toContain(source.id);
  const result = await invalidate();
  await planningTransaction((tx) =>
    acknowledgeSchedulingPublication(tx, {
      ...window,
      eventIds: before.eventIds,
      stateRevision: before.stateRevision,
      unavailable: 0,
      normalized: 0,
    }),
  );
  expect(
    await db.schedulingMaintenanceState.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toMatchObject({ publicationVersion: 0, settlementVersion: 0 });
  expect(
    await db.schedulingDirtyEvent.findUniqueOrThrow({
      where: { id: BigInt(result.eventId) },
    }),
  ).toMatchObject({ publicationPending: true, settlementPending: true });
  expect((await publication()).current).toBe(false);
});

it("preserves a smaller sequence source event that commits after the visible reconciliation marker", async () => {
  const writer = new Client({
    connectionString: utcDatabaseUrl(process.env.DATABASE_URL!),
  });
  await writer.connect();
  try {
    await writer.query("BEGIN");
    const inserted = await writer.query<{
      id: string;
    }>(`INSERT INTO public."SchedulingDirtyEvent"
      ("sourceTable") VALUES ('synthetic-late-source') RETURNING id::text AS id`);
    const lateId = BigInt(inserted.rows[0]!.id);
    // ACCESS SHARE must remain compatible with this uncommitted source append.
    const result = await invalidate();
    expect(lateId < BigInt(result.eventId)).toBe(true);
    const visible = await publication();
    expect(visible.eventIds).toContain(BigInt(result.eventId));
    expect(visible.eventIds).not.toContain(lateId);
    await writer.query("COMMIT");
    await planningTransaction((tx) =>
      acknowledgeSchedulingPublication(tx, {
        ...window,
        eventIds: visible.eventIds,
        stateRevision: visible.stateRevision,
        unavailable: 0,
        normalized: 0,
      }),
    );
    expect(
      await db.schedulingDirtyEvent.findUniqueOrThrow({
        where: { id: lateId },
      }),
    ).toMatchObject({ publicationPending: true, settlementPending: true });
    expect(
      await db.schedulingDirtyEvent.findUniqueOrThrow({
        where: { id: BigInt(result.eventId) },
      }),
    ).toMatchObject({ publicationPending: false, settlementPending: true });
    expect((await publication()).current).toBe(false);
  } finally {
    await writer.query("ROLLBACK");
    await writer.end();
  }
});

it("fails before invalidation when strict source-trigger verification is unavailable", async () => {
  const rollback = "rollback disabled synthetic maintenance trigger";
  await expect(
    db.$transaction(async (tx) => {
      const before = await tx.schedulingDirtyEvent.count();
      await tx.$executeRawUnsafe(
        'ALTER TABLE public."Pairing" DISABLE TRIGGER scheduling_source_dirty',
      );
      await expect(
        invalidateReconciledSchedulingMaintenance(operatorSql(tx)),
      ).rejects.toThrow("INVALID_SCHEDULING_MAINTENANCE_TRIGGERS");
      expect(await tx.schedulingDirtyEvent.count()).toBe(before);
      expect(
        await tx.schedulingMaintenanceState.findUniqueOrThrow({
          where: { id: "program" },
        }),
      ).toMatchObject({ publicationVersion: 1, settlementVersion: 1 });
      throw new Error(rollback);
    }),
  ).rejects.toThrow(rollback);
});
