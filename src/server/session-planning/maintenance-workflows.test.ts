import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/server/db";
import { utcDatabaseUrl } from "~/server/database-url";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { plannedWindow, planningWeeks } from "~/lib/session-planning";
import { lockEntity, type TransactionDb } from "~/server/transactions";
import { ensureSessionPlanningWindow, lockSessionPlanning, readSessionAgenda, sweepSessionPlanning } from ".";
import {
  acknowledgeSchedulingPublication,
  readSchedulingMaintenance,
  prepareSchedulingInvalidationBatch,
  retrySchedulingInvalidation,
  inSchedulingMaintenanceTransaction,
  SCHEDULING_MAINTENANCE_VERSION,
} from "./maintenance";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const now = new Date("2026-10-26T00:00:00Z");
const tutorId = "maintenance-tutor";
const tutorUserId = "maintenance-tutor-user";
const tuteeId = "maintenance-one";
const tuteeUserId = "maintenance-one-user";
const window = { ...planningWeeks(now, "Asia/Shanghai"), timeZone: "Asia/Shanghai" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function bounded<T>(work: Promise<T>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** The hook runs after the real publication COMMIT, never inside its decision.
 * Candidate observation records the original SELECT result without changing it.
 */
function agendaAfterPublication(
  after: () => Promise<void>,
  observeCandidates?: (ids: string[]) => void,
) {
  let first = true;
  return new Proxy(db, {
    get(target, key) {
      if (key === "$transaction")
        return async (work: (tx: TransactionDb) => Promise<unknown>, options?: { timeout?: number; maxWait?: number }) => {
          const result = await target.$transaction(work, options);
          if (first) { first = false; await after(); }
          return result;
        };
      if (key === "$queryRaw" && observeCandidates)
        return async (parts: TemplateStringsArray, ...values: unknown[]) => {
          if (parts.join("").includes('SELECT r.id FROM "SessionPlanningRequest" r')) {
            const rows = await target.$queryRaw<{ id: string }[]>(parts, ...values);
            observeCandidates(rows.map((row) => row.id));
            return rows;
          }
          return target.$queryRaw(parts, ...values);
        };
      const value: unknown = Reflect.get(target, key, target);
      return value;
    },
  });
}

async function publicationReady<T>(ready: Promise<void>, reader: Promise<T>) {
  await bounded(Promise.race([ready, reader.then(() => {
    throw new Error("Agenda finished before its publication barrier.");
  })]), "publication committed");
}

function maintenanceClient() {
  return new Client({ connectionString: utcDatabaseUrl(process.env.DATABASE_URL!), connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 });
}

/** Pause only after the first real metadata SELECT completed. On the former
 * split implementation this is exactly the state-read/event-read race window.
 */
function afterFirstMaintenanceSnapshot(
  tx: TransactionDb,
  after: () => Promise<void>,
) {
  let paused = false;
  return new Proxy(tx, {
    get(target, key) {
      if (key !== "$queryRaw") {
        const value: unknown = Reflect.get(target, key, target);
        return value;
      }
      return async (parts: TemplateStringsArray, ...values: unknown[]) => {
        const result = await target.$queryRaw(parts, ...values);
        if (!paused && parts.join("").includes("scheduling_verify_maintenance_triggers")) {
          paused = true;
          await after();
        }
        return result;
      };
    },
  });
}

function afterFirstMaintenanceStateWrite(
  tx: TransactionDb,
  marker: string,
  after: () => Promise<void>,
) {
  let paused = false;
  return new Proxy(tx, {
    get(target, key) {
      if (key !== "$executeRaw") {
        const value: unknown = Reflect.get(target, key, target);
        return value;
      }
      return async (parts: TemplateStringsArray, ...values: unknown[]) => {
        const result = await target.$executeRaw(parts, ...values);
        const sql = parts.join("");
        if (!paused && sql.includes('UPDATE public."SchedulingMaintenanceState" SET') && sql.includes(marker)) {
          paused = true;
          await after();
        }
        return result;
      };
    },
  });
}

async function waitForDatabaseBlock(tx: TransactionDb, blockedPid: number, blockerPid: number) {
  await vi.waitFor(async () => {
    const [row] = await tx.$queryRaw<{ blocked: boolean }[]>`
      SELECT ${blockerPid}=ANY(pg_blocking_pids(${blockedPid}::int)) AS blocked`;
    expect(row?.blocked).toBe(true);
  }, { timeout: 3000, interval: 25 });
}

async function planningTransaction<T>(work: (tx: TransactionDb) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await lockEntity(tx, "program:period");
    await lockSessionPlanning(tx);
    return work(tx);
  }, { timeout: 10_000, maxWait: 3000 });
}
async function source() {
  return db.sessionPlanCohort.findFirstOrThrow({
    where: { date: "2026-11-02", plan: { tutorId } },
  });
}
async function request(index = 0, cutoffAt = new Date("2026-11-02T07:00:00Z")) {
  const cohort = await source();
  const id = `maintenance-request-${String(index).padStart(4, "0")}`;
  const offerId = `${id}-offer`;
  const target = plannedWindow({ date: "2026-11-03", startMin: 900, online: false }, window.timeZone);
  await db.sessionPlanningRequest.create({
    data: {
      id,
      planId: cohort.planId,
      cohortId: cohort.id,
      scope: "ONE",
      kind: "RESCHEDULE",
      participantIds: [tuteeId],
      currentOfferId: offerId,
      updatedAt: new Date(now.getTime() - 60_000 + index),
      offers: {
        create: {
          id: offerId,
          sequence: 1,
          authorKey: `tutor:${tutorId}`,
          ...target,
          cutoffAt,
          responses: {
            create: [
              { actorKey: `tutor:${tutorId}`, actorUserId: tutorUserId, state: "ACCEPTED", acceptedBy: "EXPLICIT" },
              { actorKey: `tutee:${tuteeId}`, actorUserId: tuteeUserId },
            ],
          },
        },
      },
    },
  });
  return { id, offerId, cohort };
}
async function cleanPublication(at = now) {
  // The first pass may generate dated-source events. A second no-change pass
  // consumes only those exact visible IDs before the next read becomes warm.
  for (let attempt = 0; attempt < 4; attempt++) {
    await ensureSessionPlanningWindow(db, at);
    const currentWindow = { ...planningWeeks(at, window.timeZone), timeZone: window.timeZone };
    if ((await planningTransaction((tx) => readSchedulingMaintenance(tx, currentWindow))).current) return;
  }
  throw new Error("Publication did not converge to a clean watermark.");
}
async function drainSweep(at = now) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await sweepSessionPlanning(db, at);
    const [state] = await db.$queryRaw<{ complete: boolean }[]>`
      SELECT s."settlementVersion"=${SCHEDULING_MAINTENANCE_VERSION}
        AND NOT s."settlementBatchActive"
        AND NOT EXISTS (SELECT 1 FROM public."SchedulingDirtyEvent" e
          WHERE e."settlementPending") AS complete
      FROM public."SchedulingMaintenanceState" s WHERE s.id='program'`;
    if (state?.complete) return;
  }
  throw new Error("The bounded synthetic sweep did not finish.");
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  // This fixture follows the repository's guarded, serial integration contract.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
      AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) => 'public."' + tablename.replaceAll('"', '""') + '"').join(","));
  await db.programSettings.create({ data: { timeZone: window.timeZone } });
  await db.term.create({ data: {
    id: "maintenance-term", schoolYear: "26-27", quarter: "Q1", name: "Synthetic maintenance",
    active: true, startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-12-01T00:00:00Z"),
  } });
  await db.tutor.create({ data: { id: tutorId, englishName: "Synthetic Tutor", status: "ACTIVE" } });
  await db.tutee.create({ data: { id: tuteeId, englishName: "Synthetic Learner", status: "ACTIVE" } });
  await db.user.createMany({ data: [
    { id: tutorUserId, tutorId, email: "maintenance-tutor@example.test", role: "TUTOR", emailVerifiedAt: now },
    { id: tuteeUserId, studentId: tuteeId, tuteeMember: true, email: "maintenance-one@example.test", role: "TUTOR", emailVerifiedAt: now },
    { id: "maintenance-other-user", tuteeMember: true, email: "maintenance-other@example.test", role: "TUTOR", emailVerifiedAt: now },
  ] });
  await db.pairing.create({ data: {
    id: "maintenance-pairing", tutorId, termId: "maintenance-term", subject: "Synthetic Math",
    dayOfWeek: 1, startMin: 900, endMin: 945, scheduleConfirmed: true, roomMode: "NONE",
    tutees: { create: { tuteeId } },
  } });
  await ensureSessionPlanningWindow(db, now);
});
afterEach(() => vi.useRealTimers());
afterAll(async () => { await db.$disconnect(); });

describe("agenda metadata contention", () => {
  it.each(["program:period", "planned-room-schedule", "session-planning"])(
    "returns an empty-request agenda behind %s and releases its acquired lock prefix",
    async (blockedKey) => {
      const holder = maintenanceClient();
      await holder.connect();
      const published = deferred<void>(), resume = deferred<void>();
      const reader = readSessionAgenda(agendaAfterPublication(async () => {
        published.resolve(); await resume.promise;
      }), { id: tutorUserId, tutorId }, "tutor", now);
      const drained = Promise.allSettled([reader]);
      try {
        await publicationReady(published.promise, reader);
        await holder.query("BEGIN");
        await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [blockedKey]);
        // A supported direct write can commit while a different publisher owns
        // its advisory fence. Its exact invalidation must survive deferral.
        await db.room.create({ data: { id: "maintenance-deferred-room", name: "Synthetic deferred room" } });
        const before = await db.schedulingMaintenanceState.findUniqueOrThrow({ where: { id: "program" } });
        const dirty = await db.schedulingDirtyEvent.findMany({ where: { sourceTable: "Room", publicationPending: true }, select: { id: true } });
        expect(dirty.length).toBeGreaterThan(0);
        resume.resolve();
        expect((await bounded(reader, "unblocked agenda projection")).cohorts.length).toBeGreaterThan(0);
        expect(await db.schedulingMaintenanceState.findUniqueOrThrow({ where: { id: "program" } })).toEqual(before);
        expect(await db.schedulingDirtyEvent.count({ where: { id: { in: dirty.map((row) => row.id) }, publicationPending: true, settlementPending: true } })).toBe(dirty.length);
        const keys = ["program:period", "planned-room-schedule", "session-planning"];
        await db.$transaction(async (tx) => {
          for (const key of keys.slice(0, keys.indexOf(blockedKey))) {
            const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key},0)) AS locked`;
            expect(lock?.locked).toBe(true);
          }
        });
      } finally {
        resume.resolve();
        await holder.query("ROLLBACK");
        await holder.end();
        await drained;
      }
      await cleanPublication();
      await drainSweep();
    }, 15_000,
  );

  it("runs a fresh due-first scan and retains a failed request retry when bookkeeping defers", async () => {
    const future = await request(0);
    const due = await request(1, now);
    await planningTransaction((tx) => prepareSchedulingInvalidationBatch(tx));
    await planningTransaction((tx) => retrySchedulingInvalidation(tx, future.id));
    const holder = maintenanceClient();
    await holder.connect();
    const holderPid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const published = deferred<void>(), resume = deferred<void>(), selected = deferred<string[]>();
    await db.$executeRawUnsafe('CREATE FUNCTION scheduling_test_deferred_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'Synthetic deferred notice failure\'; END; $$');
    await db.$executeRawUnsafe('CREATE TRIGGER scheduling_test_deferred_failure BEFORE INSERT ON "SessionNotice" FOR EACH ROW WHEN (NEW."requestId"=\'maintenance-request-0001\') EXECUTE FUNCTION scheduling_test_deferred_failure()');
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reader = readSessionAgenda(agendaAfterPublication(async () => {
      published.resolve(); await resume.promise;
    }, (ids) => selected.resolve(ids)), { id: tutorUserId, tutorId }, "tutor", now);
    const drained = Promise.allSettled([reader]);
    try {
      await publicationReady(published.promise, reader);
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('program:period',0))");
      const before = await db.schedulingMaintenanceState.findUniqueOrThrow({ where: { id: "program" } });
      expect(before.settlementBatchActive).toBe(true);
      resume.resolve();
      expect(await bounded(selected.promise, "fresh candidates despite metadata contention")).toEqual([due.id, future.id]);
      // A selected decision still waits on the authoritative blocking fence.
      await vi.waitFor(async () => {
        const [row] = await db.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity a WHERE ${holderPid}=ANY(pg_blocking_pids(a.pid))) AS blocked`;
        expect(row?.blocked).toBe(true);
      }, { timeout: 3000, interval: 25 });
      await holder.query("COMMIT");
      await bounded(reader, "independent failed and subsequent request decisions");
      expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: due.id } })).status).toBe("PENDING");
      expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: future.id } })).updatedAt).toEqual(now);
      expect(await db.schedulingDirtyEvent.count({ where: { requestId: due.id, settlementPending: true } })).toBe(1);
      expect(await db.schedulingDirtyEvent.count({ where: { requestId: future.id, settlementPending: true } })).toBe(1);
      const after = await db.schedulingMaintenanceState.findUniqueOrThrow({ where: { id: "program" } });
      expect(after.settlementBatchActive).toBe(true);
      expect(after.settlementEventIds).toEqual(before.settlementEventIds);
      expect(await db.schedulingDirtyEvent.count({ where: { id: { in: before.settlementEventIds }, settlementPending: true } })).toBe(before.settlementEventIds.length);
    } finally {
      resume.resolve();
      await holder.query("ROLLBACK");
      await holder.end();
      await drained;
      await db.$executeRawUnsafe('DROP TRIGGER scheduling_test_deferred_failure ON "SessionNotice"');
      await db.$executeRawUnsafe('DROP FUNCTION scheduling_test_deferred_failure()');
      errors.mockRestore();
    }
    expect(await sweepSessionPlanning(db, now)).toBe(2);
    expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: due.id } })).status).toBe("EXPIRED");
    expect(await db.sessionNotice.count({ where: { requestId: due.id, event: "expired" } })).toBe(2);
    await drainSweep();
  }, 20_000);

  it("rereads recipient authority after a deferred scan waits on its request fence", async () => {
    const pending = await request();
    await drainSweep();
    const holder = maintenanceClient();
    await holder.connect();
    const published = deferred<void>(), resume = deferred<void>(), selected = deferred<string[]>();
    const reader = readSessionAgenda(agendaAfterPublication(async () => {
      published.resolve(); await resume.promise;
    }, (ids) => selected.resolve(ids)), { id: tutorUserId, tutorId }, "tutor", now);
    const drained = Promise.allSettled([reader]);
    try {
      await publicationReady(published.promise, reader);
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('program:period',0))");
      resume.resolve();
      expect(await bounded(selected.promise, "fresh authority candidate")).toEqual([pending.id]);
      // This direct supported write occurs after candidate discovery and cannot
      // be answered by the earlier clean metadata or publication snapshot.
      await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
      await holder.query("COMMIT");
      await bounded(reader, "fresh source settlement");
      expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("STALE");
      expect(await db.sessionNotice.count({ where: { requestId: pending.id, event: "stale" } })).toBe(2);
    } finally {
      resume.resolve();
      await holder.query("ROLLBACK");
      await holder.end();
      await drained;
    }
    await drainSweep();
  }, 15_000);

  it("makes blocking worker progress on dirty work and a due deadline while agenda traffic continues", async () => {
    const future = await request(0);
    const due = await request(1, now);
    await db.room.create({ data: { id: "maintenance-worker-room", name: "Synthetic worker dirty source" } });
    await db.schedulingMaintenanceState.update({ where: { id: "program" }, data: { settlementVersion: 0 } });
    const dirty = await db.schedulingDirtyEvent.findMany({ where: { settlementPending: true }, select: { id: true } });
    expect(dirty.length).toBeGreaterThan(0);
    const holder = maintenanceClient();
    await holder.connect();
    const holderPid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('program:period',0))");
    // The real delivery worker calls this exported blocking entry point. Queue
    // it before sustaining agenda traffic; try-lock readers cannot jump it.
    const worker = sweepSessionPlanning(db, now);
    const drainedWorker = Promise.allSettled([worker]);
    let traffic: Promise<void> | undefined;
    let drainedTraffic: Promise<PromiseSettledResult<void>[]> | undefined;
    try {
      await vi.waitFor(async () => {
        const [row] = await db.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity a WHERE ${holderPid}=ANY(pg_blocking_pids(a.pid))) AS blocked`;
        expect(row?.blocked).toBe(true);
      }, { timeout: 3000, interval: 25 });
      traffic = (async () => {
        for (let visit = 0; visit < 8; visit++)
          await readSessionAgenda(db, { id: tutorUserId, tutorId }, "tutor", now);
      })();
      drainedTraffic = Promise.allSettled([traffic]);
      await holder.query("COMMIT");
      expect(await bounded(worker, "blocking worker deadline progress")).toBe(2);
      await bounded(traffic, "sustained agenda traffic");
      expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: due.id } })).status).toBe("EXPIRED");
      expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: future.id } })).status).toBe("PENDING");
      expect(await db.sessionNotice.count({ where: { requestId: due.id, event: "expired" } })).toBe(2);
      expect(await db.schedulingDirtyEvent.count({ where: { id: { in: dirty.map((row) => row.id) }, settlementPending: true } })).toBe(0);
      const state = await db.schedulingMaintenanceState.findUniqueOrThrow({ where: { id: "program" } });
      expect(state.settlementVersion).toBe(SCHEDULING_MAINTENANCE_VERSION);
      expect(state.settlementBatchActive).toBe(false);
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
      await drainedWorker;
      if (drainedTraffic) await drainedTraffic;
    }
  }, 20_000);

  it("fails closed on admitted trigger-integrity failure after publication without rolling publication back", async () => {
    const actionId = "maintenance-publication-before-prepare-failure";
    await db.recoveryAction.create({ data: { id: actionId, kind: "INITIAL_ADMISSION", applicationId: "synthetic-prepare-failure", before: {} } });
    await db.recoveryTrackedEntity.create({ data: { actionId, entity: "Tutor", recordId: tutorId } });
    const later = new Date("2026-11-01T04:00:00Z");
    const journal = () => db.recoveryChange.findMany({ where: { actionId }, orderBy: { id: "asc" } });
    let committedPlans: string[] | undefined;
    let committedJournal: Awaited<ReturnType<typeof journal>> | undefined;
    let committedFence: number | undefined;
    const database = agendaAfterPublication(async () => {
      committedPlans = (await db.sessionPlan.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((plan) => plan.id);
      committedJournal = await journal();
      committedFence = (await db.recoveryFence.findUniqueOrThrow({ where: { actionId } })).revision;
      await db.$executeRawUnsafe('ALTER TABLE "Pairing" DISABLE TRIGGER scheduling_source_dirty');
    });
    try {
      await expect(readSessionAgenda(database, { id: tutorUserId, tutorId }, "tutor", later)).rejects.toThrow("source triggers");
      expect(committedPlans).toBeDefined();
      expect(await db.sessionPlan.count({ where: { originalDate: "2026-11-09" } })).toBe(1);
      expect((await db.sessionPlan.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((plan) => plan.id)).toEqual(committedPlans);
      expect(committedFence).toBeGreaterThan(0);
      expect(await journal()).toEqual(committedJournal);
      expect((await db.recoveryFence.findUniqueOrThrow({ where: { actionId } })).revision).toBe(committedFence);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "Pairing" ENABLE TRIGGER scheduling_source_dirty');
    }
    await drainSweep(later);
  }, 15_000);
});

describe("durable publication maintenance", () => {
  it("converges, rebuilds missing/obsolete empty metadata, and advances Sunday/Monday windows", async () => {
    await cleanPublication();
    const original = await db.sessionPlan.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    await db.$executeRaw`DELETE FROM "SchedulingDirtyEvent"`;
    await db.$executeRaw`DELETE FROM "SchedulingMaintenanceState"`;
    expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
    await cleanPublication();
    expect(await db.sessionPlan.findMany({ select: { id: true }, orderBy: { id: "asc" } })).toEqual(original);
    await db.$executeRaw`UPDATE "SchedulingMaintenanceState" SET "publicationVersion"=0`;
    expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
    await cleanPublication();
    await cleanPublication(new Date("2026-11-01T04:00:00Z"));
    expect(await db.sessionPlan.count({ where: { originalDate: "2026-11-09" } })).toBe(1);
    await cleanPublication(new Date("2026-11-02T00:00:00Z"));
    const [state] = await db.$queryRaw<{ windowStart: string; prepareEnd: string; publicationVersion: number }[]>`
      SELECT "windowStart","prepareEnd","publicationVersion" FROM "SchedulingMaintenanceState"`;
    expect(state).toEqual({ windowStart: "2026-11-02", prepareEnd: "2026-11-15", publicationVersion: SCHEDULING_MAINTENANCE_VERSION });
    expect(await db.sessionPlan.count({ where: { originalDate: "2026-11-09" } })).toBe(1);
  });

  it("marks direct supported writes and compensation dirty in their own transaction", async () => {
    await cleanPublication();
    const action = await db.recoveryAction.create({ data: { kind: "DOMAIN_CHECKPOINT", before: {}, after: {} } });
    await db.recoveryTrackedEntity.create({ data: { actionId: action.id, entity: "User", recordId: tuteeUserId } });
    const rollback = new Error("Roll back synthetic source write.");
    await expect(db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('shbs.recovery_compensating',${action.id},true)`;
      await tx.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
      const rows = await tx.$queryRaw<{ sourceTable: string }[]>`
        SELECT "sourceTable" FROM "SchedulingDirtyEvent" WHERE "publicationPending"`;
      expect(rows.some((row) => row.sourceTable === "User")).toBe(true);
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(true);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('shbs.recovery_compensating',${action.id},true)`;
      await tx.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
    });
    expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
    expect(await db.recoveryChange.count({ where: { actionId: action.id } })).toBe(0);
  });

  it("rebuilds after pending events are deleted or truncated while the state row remains", async () => {
    await cleanPublication();
    await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
    await db.$executeRaw`DELETE FROM "SchedulingDirtyEvent"`;
    expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
    await cleanPublication();
    await db.$executeRawUnsafe('TRUNCATE "SchedulingDirtyEvent"');
    expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
    await cleanPublication();
  });

  it("captures state and dirty IDs together when a DELETE reset commits after the first read", async () => {
    await cleanPublication();
    await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
    const writer = new Client({ connectionString: utcDatabaseUrl(process.env.DATABASE_URL!), connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 });
    await writer.connect();
    try {
      const observed = await planningTransaction((tx) =>
        readSchedulingMaintenance(afterFirstMaintenanceSnapshot(tx, async () => {
          await writer.query('DELETE FROM public."SchedulingDirtyEvent"');
        }), window));
      // The committed dirty IDs belong to the same snapshot as the valid state,
      // even though the reset has now removed them and obsoleted that state.
      expect(observed.eventIds.length).toBeGreaterThan(0);
      expect(observed.current).toBe(false);
      expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
    } finally {
      await writer.end();
    }
  });

  it("does not certify a settlement batch after a concurrent DELETE reset changes its revision", async () => {
    const pending = await request();
    await drainSweep();
    await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
    const writer = new Client({ connectionString: utcDatabaseUrl(process.env.DATABASE_URL!), connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 });
    await writer.connect();
    try {
      await planningTransaction((tx) => prepareSchedulingInvalidationBatch(
        afterFirstMaintenanceSnapshot(tx, async () => {
          await writer.query('DELETE FROM public."SchedulingDirtyEvent"');
        }),
      ));
      const [state] = await db.$queryRaw<{ settlementVersion: number }[]>`
        SELECT "settlementVersion" FROM public."SchedulingMaintenanceState" WHERE id='program'`;
      expect(state?.settlementVersion).toBe(0);
      await sweepSessionPlanning(db, now);
      expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("STALE");
    } finally {
      await writer.end();
    }
  });

  it.each(["obsolete", "delete-recreate"])("does not overwrite a %s state reset committed immediately before publication ACK", async (reset) => {
    await cleanPublication();
    await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
    const writer = new Client({ connectionString: utcDatabaseUrl(process.env.DATABASE_URL!), connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 });
    await writer.connect();
    let open = false;
    try {
      await planningTransaction(async (tx) => {
        const observed = await readSchedulingMaintenance(tx, window);
        expect(observed.current).toBe(false);
        await writer.query("BEGIN");
        open = true;
        // A newly committed source change is deliberately reset after this
        // pass's enumeration. Only the state revision can retain this work now.
        await writer.query('UPDATE public."User" SET "tuteeMember"=true WHERE id=$1', [tuteeUserId]);
        await writer.query('DELETE FROM public."SchedulingDirtyEvent"');
        if (reset === "delete-recreate") {
          await writer.query('DELETE FROM public."SchedulingMaintenanceState"');
          await writer.query('INSERT INTO public."SchedulingMaintenanceState" (id) VALUES ($1)', ["program"]);
        }
        await writer.query("COMMIT");
        open = false;
        await acknowledgeSchedulingPublication(tx, {
          ...window, eventIds: observed.eventIds, stateRevision: observed.stateRevision,
          unavailable: 0, normalized: 0,
        });
      });
      const [state] = await db.$queryRaw<{ publicationVersion: number }[]>`
        SELECT "publicationVersion" FROM public."SchedulingMaintenanceState" WHERE id='program'`;
      expect(state?.publicationVersion).toBe(0);
      expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
      await cleanPublication();
    } finally {
      if (open) await writer.query("ROLLBACK");
      await writer.end();
    }
  });

  it("leaves first publication obsolete when a concurrent reset cannot see a missing state row", async () => {
    await cleanPublication();
    await db.$executeRaw`DELETE FROM public."SchedulingMaintenanceState"`;
    await db.$executeRaw`DELETE FROM public."SchedulingDirtyEvent"`;
    const writer = new Client({ connectionString: utcDatabaseUrl(process.env.DATABASE_URL!), connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 });
    await writer.connect();
    try {
      await planningTransaction(async (tx) => {
        const observed = await readSchedulingMaintenance(tx, window);
        expect(observed.stateRevision).toBeNull();
        await writer.query("BEGIN");
        try {
          await writer.query('UPDATE public."User" SET "tuteeMember"=false WHERE id=$1', [tuteeUserId]);
          await writer.query('DELETE FROM public."SchedulingDirtyEvent"');
          await writer.query("COMMIT");
        } catch (error) {
          await writer.query("ROLLBACK");
          throw error;
        }
        await acknowledgeSchedulingPublication(tx, {
          ...window, eventIds: observed.eventIds, stateRevision: observed.stateRevision,
          unavailable: 0, normalized: 0,
        });
      });
      const [state] = await db.$queryRaw<{ publicationVersion: number }[]>`
        SELECT "publicationVersion" FROM public."SchedulingMaintenanceState" WHERE id='program'`;
      expect(state?.publicationVersion).toBe(0);
      expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
      await cleanPublication();
    } finally {
      await writer.end();
    }
  });

  it("holds both metadata relation locks until publication commits before a concurrent TRUNCATE reset", async () => {
    await cleanPublication();
    const writer = new Client({ connectionString: utcDatabaseUrl(process.env.DATABASE_URL!), connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 });
    await writer.connect();
    const ready = deferred<{ tx: TransactionDb; pid: number }>();
    const release = deferred<void>();
    let reader: Promise<unknown> | undefined;
    let truncating: Promise<unknown> | undefined;
    let readerDrain: Promise<unknown> | undefined;
    let truncateDrain: Promise<unknown> | undefined;
    let readinessTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const backend = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      reader = planningTransaction(async (tx) => {
        const [own] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        const observed = await readSchedulingMaintenance(tx, window);
        expect(observed.current).toBe(true);
        ready.resolve({ tx, pid: own!.pid });
        await release.promise;
      });
      readerDrain = Promise.allSettled([reader]);
      const locked = await Promise.race([
        ready.promise,
        reader.then(() => { throw new Error("Metadata reader completed before its readiness barrier."); }),
        new Promise<never>((_resolve, reject) => {
          readinessTimer = setTimeout(() => reject(new Error("Metadata reader readiness timed out.")), 3000);
        }),
      ]);
      clearTimeout(readinessTimer);
      truncating = writer.query('TRUNCATE public."SchedulingDirtyEvent"');
      truncateDrain = Promise.allSettled([truncating]);
      await vi.waitFor(async () => {
        const [blocking] = await locked.tx.$queryRaw<{ blocked: boolean }[]>`
          SELECT ${locked.pid}=ANY(pg_blocking_pids(${backend.rows[0]!.pid}::int)) AS blocked`;
        expect(blocking?.blocked).toBe(true);
      }, { timeout: 3000, interval: 25 });
      release.resolve();
      await reader;
      await truncating;
      expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
    } finally {
      clearTimeout(readinessTimer);
      release.resolve();
      await readerDrain;
      await truncateDrain;
      await writer.end();
    }
  }, 20_000);

  it("retries the entire publication victim when DELETE reset locks events after its state ACK", async () => {
    await cleanPublication();
    const pending = await request();
    await drainSweep();
    await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
    await planningTransaction((tx) => retrySchedulingInvalidation(tx, pending.id));
    const writer = new Client({ connectionString: utcDatabaseUrl(process.env.DATABASE_URL!), connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 });
    await writer.connect();
    let resetting: Promise<unknown> | undefined;
    let resetDrain: Promise<unknown> | undefined;
    let attempts = 0;
    try {
      const backend = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await inSchedulingMaintenanceTransaction(db, async (tx) => {
        attempts++;
        await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout='25ms'");
        await lockEntity(tx, "program:period");
        await lockSessionPlanning(tx);
        const [own] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        const observed = await readSchedulingMaintenance(tx, window);
        // A retry can insert this unique source exactly once only if the whole
        // first transaction, its dirty event and its metadata ACK rolled back.
        await tx.room.create({ data: { id: "maintenance-deadlock-room", name: "Synthetic deadlock room" } });
        const decision = attempts === 1
          ? afterFirstMaintenanceStateWrite(tx, '"publicationVersion"=', async () => {
              resetting = (async () => {
                await writer.query("BEGIN");
                try {
                  await writer.query('DELETE FROM public."SchedulingDirtyEvent"');
                  await writer.query("COMMIT");
                } catch (error) {
                  await writer.query("ROLLBACK");
                  throw error;
                }
              })();
              resetDrain = Promise.allSettled([resetting]);
              await waitForDatabaseBlock(tx, backend.rows[0]!.pid, own!.pid);
            })
          : tx;
        await acknowledgeSchedulingPublication(decision, {
          ...window, eventIds: observed.eventIds, stateRevision: observed.stateRevision,
          unavailable: 0, normalized: 0,
        });
      });
      await resetting;
      expect(attempts).toBe(2);
      expect(await db.room.count({ where: { id: "maintenance-deadlock-room" } })).toBe(1);
      expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
      await sweepSessionPlanning(db, now);
      expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("STALE");
    } finally {
      await resetDrain;
      await writer.end();
    }
  }, 20_000);

  it("retries settlement preparation without losing an independent request retry after DELETE deadlock", async () => {
    const pending = await request();
    await drainSweep();
    expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");
    await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
    await planningTransaction((tx) => retrySchedulingInvalidation(tx, pending.id));
    const retries = await db.$queryRaw<{ requestId: string; settlementPending: boolean }[]>`
      SELECT "requestId","settlementPending" FROM public."SchedulingDirtyEvent"
      WHERE "requestId"=${pending.id}`;
    expect(retries).toEqual([{ requestId: pending.id, settlementPending: true }]);
    const writer = new Client({ connectionString: utcDatabaseUrl(process.env.DATABASE_URL!), connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 });
    await writer.connect();
    let resetting: Promise<unknown> | undefined;
    let resetDrain: Promise<unknown> | undefined;
    let attempts = 0;
    try {
      const backend = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await inSchedulingMaintenanceTransaction(db, async (tx) => {
        attempts++;
        if (attempts > 1) {
          // This case asserts reconstruction after a committed reset. Without
          // this barrier, a valid retry can read the old xmin before COMMIT,
          // fail CAS after waiting, and leave version 0 for the next sweep.
          expect(resetting).toBeDefined();
          await resetting;
        }
        await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout='25ms'");
        await lockEntity(tx, "program:period");
        await lockSessionPlanning(tx);
        if (attempts > 1) {
          const [committed] = await tx.$queryRaw<{ settlementVersion: number }[]>`
            SELECT "settlementVersion" FROM public."SchedulingMaintenanceState" WHERE id='program'`;
          expect(committed?.settlementVersion).toBe(0);
        }
        const [own] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        const decision = attempts === 1
          ? afterFirstMaintenanceStateWrite(tx, '"settlementBatchActive"=true', async () => {
              resetting = (async () => {
                await writer.query("BEGIN");
                try {
                  await writer.query('DELETE FROM public."SchedulingDirtyEvent"');
                  await writer.query("COMMIT");
                } catch (error) {
                  await writer.query("ROLLBACK");
                  throw error;
                }
              })();
              resetDrain = Promise.allSettled([resetting]);
              await waitForDatabaseBlock(tx, backend.rows[0]!.pid, own!.pid);
            })
          : tx;
        await prepareSchedulingInvalidationBatch(decision);
      });
      await resetting;
      expect(attempts).toBe(2);
      const [state] = await db.$queryRaw<{ settlementRequestIds: string[] }[]>`
        SELECT "settlementRequestIds" FROM public."SchedulingMaintenanceState" WHERE id='program'`;
      expect(state?.settlementRequestIds).toContain(pending.id);
      await sweepSessionPlanning(db, now);
      expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("STALE");
    } finally {
      await resetDrain;
      await writer.end();
    }
  }, 20_000);

  it("retries a metadata snapshot victim of reverse-order multi-table TRUNCATE without certifying a cold row", async () => {
    await cleanPublication();
    const writer = new Client({ connectionString: utcDatabaseUrl(process.env.DATABASE_URL!), connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 });
    await writer.connect();
    const ready = deferred<number>();
    const readerArmed = deferred<void>();
    let reading: Promise<unknown> | undefined;
    let readDrain: Promise<unknown> | undefined;
    let resetDrain: Promise<unknown> | undefined;
    let readinessTimer: ReturnType<typeof setTimeout> | undefined;
    let open = false;
    let attempts = 0;
    try {
      const backend = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await writer.query("BEGIN");
      open = true;
      await writer.query('UPDATE public."User" SET "tuteeMember"=false WHERE id=$1', [tuteeUserId]);
      await writer.query('TRUNCATE public."SchedulingDirtyEvent"');
      reading = inSchedulingMaintenanceTransaction(db, async (tx) => {
        attempts++;
        await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout='25ms'");
        await lockEntity(tx, "program:period");
        await lockSessionPlanning(tx);
        const [own] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (attempts === 1) {
          ready.resolve(own!.pid);
          await readerArmed.promise;
        }
        const observed = await readSchedulingMaintenance(tx, window);
        await acknowledgeSchedulingPublication(tx, {
          ...window, eventIds: observed.eventIds, stateRevision: observed.stateRevision,
          unavailable: 0, normalized: 0,
        });
      });
      readDrain = Promise.allSettled([reading]);
      const pid = await Promise.race([
        ready.promise,
        reading.then(() => { throw new Error("Metadata reader completed before its TRUNCATE barrier."); }),
        new Promise<never>((_resolve, reject) => {
          readinessTimer = setTimeout(() => reject(new Error("Metadata reader readiness timed out.")), 3000);
        }),
      ]);
      clearTimeout(readinessTimer);
      const writerPid = backend.rows[0]!.pid;
      expect(Number.isSafeInteger(pid) && Number.isSafeInteger(writerPid)).toBe(true);
      const resetting = (async () => {
        // Start the server-side observer BEFORE the reader's lock wait (and
        // deadlock timer). Once it sees the actual edge it creates the reverse
        // edge in the same statement, without a client polling/round-trip gap.
        await writer.query(`DO $maintenance_reset$
          DECLARE waiting boolean := false;
          BEGIN
            FOR attempt IN 1..2500 LOOP
              IF ${writerPid}=ANY(pg_blocking_pids(${pid})) THEN waiting := true; EXIT; END IF;
              PERFORM pg_sleep(0.001);
            END LOOP;
            IF NOT waiting THEN RAISE EXCEPTION 'Metadata reader did not reach its lock barrier'; END IF;
            TRUNCATE public."SchedulingMaintenanceState";
          END $maintenance_reset$`);
        await writer.query("COMMIT");
        open = false;
      })();
      resetDrain = Promise.allSettled([resetting]);
      await vi.waitFor(async () => {
        const [row] = await db.$queryRaw<{ active: boolean }[]>`
          SELECT state='active' AND query LIKE 'DO $maintenance_reset$%' AS active
          FROM pg_stat_activity WHERE pid=${writerPid}`;
        expect(row?.active).toBe(true);
      }, { timeout: 3000, interval: 10 });
      readerArmed.resolve();
      await resetting;
      await reading;
      expect(attempts).toBe(2);
      const [state] = await db.$queryRaw<{ publicationVersion: number }[]>`
        SELECT "publicationVersion" FROM public."SchedulingMaintenanceState" WHERE id='program'`;
      expect(state?.publicationVersion).toBe(0);
      expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
      await cleanPublication();
    } finally {
      readerArmed.resolve();
      clearTimeout(readinessTimer);
      await resetDrain;
      if (open) await writer.query("ROLLBACK");
      await readDrain;
      await writer.end();
    }
  }, 20_000);

  it("rejects a warm watermark when replica mode bypasses origin triggers", async () => {
    await cleanPublication();
    const rollback = new Error("Restore origin-mode synthetic sources.");
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role='replica'");
      await tx.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
      await expect(readSchedulingMaintenance(tx, window)).rejects.toThrow("source triggers");
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("keeps trigger certification and event writes on public sources despite temporary shadows", async () => {
    await cleanPublication();
    const rollback = new Error("Drop the temporary metadata shadows.");
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "SchedulingDirtyEvent" (LIKE public."SchedulingDirtyEvent" INCLUDING ALL) ON COMMIT DROP');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "SchedulingMaintenanceState" (LIKE public."SchedulingMaintenanceState" INCLUDING ALL) ON COMMIT DROP');
      await tx.$executeRawUnsafe('SET LOCAL search_path=pg_temp,public');
      expect((await readSchedulingMaintenance(tx, window)).current).toBe(true);
      await tx.$executeRaw`UPDATE public."User" SET "tuteeMember"=false WHERE id=${tuteeUserId}`;
      const [shadow] = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_temp."SchedulingDirtyEvent"`;
      expect(shadow?.count).toBe(0n);
      expect((await readSchedulingMaintenance(tx, window)).current).toBe(false);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("captures only 1000 visible publication event IDs and leaves the rest pending", async () => {
    await cleanPublication();
    await db.$executeRaw`
      INSERT INTO "SchedulingDirtyEvent" ("sourceTable")
      SELECT 'synthetic-bounded-events' FROM generate_series(1,1005)`;
    await planningTransaction(async (tx) => {
      const observed = await readSchedulingMaintenance(tx, window);
      expect(observed.eventIds).toHaveLength(1000);
      await acknowledgeSchedulingPublication(tx, { ...window, eventIds: observed.eventIds, stateRevision: observed.stateRevision, unavailable: 0, normalized: 0 });
    });
    const [remaining] = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM "SchedulingDirtyEvent" WHERE "publicationPending"`;
    expect(remaining?.count).toBe(5n);
  });

  it("does not acknowledge a source event with an earlier ID that commits after capture", async () => {
    await cleanPublication();
    const writer = new Client({ connectionString: utcDatabaseUrl(process.env.DATABASE_URL!), connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 4000 });
    await writer.connect();
    let open = false;
    try {
      await writer.query("BEGIN");
      open = true;
      await writer.query('UPDATE "ProgramSettings" SET "timeZone"=$1 WHERE id=$2', ["UTC", "program"]);
      const low = await writer.query<{ id: string }>('SELECT id::text FROM "SchedulingDirtyEvent" WHERE "sourceTable"=$1 AND "publicationPending" ORDER BY id DESC LIMIT 1', ["ProgramSettings"]);
      await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
      await planningTransaction(async (tx) => {
        const observed = await readSchedulingMaintenance(tx, window);
        expect(observed.eventIds).not.toContain(BigInt(low.rows[0]!.id));
        await acknowledgeSchedulingPublication(tx, { ...window, eventIds: observed.eventIds, stateRevision: observed.stateRevision, unavailable: 0, normalized: 0 });
      });
      await writer.query("COMMIT");
      open = false;
      const [late] = await db.$queryRaw<{ publicationPending: boolean }[]>`
        SELECT "publicationPending" FROM "SchedulingDirtyEvent" WHERE id=${BigInt(low.rows[0]!.id)}`;
      expect(late?.publicationPending).toBe(true);
      expect((await planningTransaction((tx) => readSchedulingMaintenance(tx, window))).current).toBe(false);
    } finally {
      if (open) await writer.query("ROLLBACK");
      await writer.end();
    }
  });

  it.each(["missing", "disabled", "conditional", "column-restricted", "wrong-function"])("fails closed for a %s source trigger", async (mode) => {
    const rollback = new Error("Restore the source trigger fixture.");
    await expect(db.$transaction(async (tx) => {
      if (mode === "disabled") await tx.$executeRawUnsafe('ALTER TABLE "User" DISABLE TRIGGER scheduling_source_dirty');
      else {
        await tx.$executeRawUnsafe('DROP TRIGGER scheduling_source_dirty ON "User"');
        if (mode === "conditional") await tx.$executeRawUnsafe('CREATE TRIGGER scheduling_source_dirty AFTER INSERT OR UPDATE OR DELETE ON "User" FOR EACH ROW WHEN (false) EXECUTE FUNCTION scheduling_mark_dirty()');
        if (mode === "column-restricted") await tx.$executeRawUnsafe('CREATE TRIGGER scheduling_source_dirty AFTER INSERT OR UPDATE OF role OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION scheduling_mark_dirty()');
        if (mode === "wrong-function") {
          await tx.$executeRawUnsafe('CREATE FUNCTION scheduling_test_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$');
          await tx.$executeRawUnsafe('CREATE TRIGGER scheduling_source_dirty AFTER INSERT OR UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION scheduling_test_noop()');
        }
      }
      await expect(readSchedulingMaintenance(tx, window)).rejects.toThrow("source triggers");
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it.each(["delete", "truncate"])("retries a suppressed ordinary lesson after its room block is removed by %s", async (removal) => {
    const room = await db.room.create({ data: { id: "maintenance-room", name: "Synthetic Room" } });
    const block = await db.roomUnavailability.create({ data: { roomId: room.id, dayOfWeek: 1, startMin: 900, endMin: 945 } });
    // The recurring Tuesday booking is legal. Its dated Monday timetable
    // exception collides with the civil-Monday block, so publication suppresses
    // that lesson without bypassing the recurring allocator's database guard.
    await db.pairing.update({ where: { id: "maintenance-pairing" }, data: { dayOfWeek: 2, roomId: room.id, roomMode: "FIXED" } });
    await db.schoolCalendarDay.create({ data: { date: "2026-11-02", isSchoolDay: true, timetableWeekday: 2 } });
    await cleanPublication();
    expect((await source()).status).toBe("CANCELLED");
    if (removal === "delete") await db.roomUnavailability.delete({ where: { id: block.id } });
    else await db.$executeRawUnsafe('TRUNCATE public."RoomUnavailability"');
    await cleanPublication();
    expect((await source()).status).toBe("SCHEDULED");
    expect((await source()).roomId).toBe(room.id);
  });
});

describe("due and authority invalidation settlement", () => {
  it("reruns current checks after A→B→A ownership and authority writes without inventing historical invalidity", async () => {
    const pending = await request();
    await db.studentProfileOwnership.create({ data: { tuteeId, userId: tuteeUserId } });
    await drainSweep();
    const before = await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } });
    await db.studentProfileOwnership.update({ where: { tuteeId }, data: { userId: "maintenance-other-user" } });
    await db.studentProfileOwnership.update({ where: { tuteeId }, data: { userId: tuteeUserId } });
    await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
    await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: true } });
    expect(await sweepSessionPlanning(db, now)).toBe(1);
    const after = await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect(after.status).toBe("PENDING");
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(await sweepSessionPlanning(db, now)).toBe(1);
    expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");
  });

  it("discovers future stale recipients after metadata is missing and does not wait for their deadlines", async () => {
    const pending = await request();
    await drainSweep();
    await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
    await db.$executeRaw`DELETE FROM "SchedulingDirtyEvent"`;
    await db.$executeRaw`DELETE FROM "SchedulingMaintenanceState"`;
    expect(await sweepSessionPlanning(db, now)).toBe(1);
    expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("STALE");
  });

  it("rolls back an individual notice failure, keeps its invalidation queued and retries it", async () => {
    const pending = await request();
    await drainSweep();
    await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
    await db.$executeRawUnsafe('CREATE FUNCTION scheduling_test_notice_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'Synthetic notice failure\'; END; $$');
    await db.$executeRawUnsafe('CREATE TRIGGER scheduling_test_notice_failure BEFORE INSERT ON "SessionNotice" FOR EACH ROW EXECUTE FUNCTION scheduling_test_notice_failure()');
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await sweepSessionPlanning(db, now)).toBe(1);
      expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");
      const retries = await db.$queryRaw<{ requestId: string }[]>`
        SELECT "requestId" FROM "SchedulingDirtyEvent" WHERE "settlementPending" AND "requestId" IS NOT NULL`;
      expect(retries.map((retry) => retry.requestId)).toContain(pending.id);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER scheduling_test_notice_failure ON "SessionNotice"');
      await db.$executeRawUnsafe('DROP FUNCTION scheduling_test_notice_failure()');
      errors.mockRestore();
    }
    expect(await sweepSessionPlanning(db, now)).toBe(1);
    expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("STALE");
    expect(await db.sessionNotice.count({ where: { requestId: pending.id, event: "stale" } })).toBe(2);
  });

  it.each(["deadline", "cutoff"])("honors the exact %s boundary after the dirty batch is clean", async (boundary) => {
    const cutoffAt = new Date("2026-10-28T00:00:00Z");
    const pending = await request(0, cutoffAt);
    const deadline = new Date("2026-10-27T00:00:00Z");
    if (boundary === "deadline")
      await db.sessionPlanningResponse.updateMany({ where: { offerId: pending.offerId, state: "PENDING" }, data: { deliveredAt: now, deadline } });
    await drainSweep();
    const dueAt = boundary === "deadline" ? deadline : cutoffAt;
    expect(await sweepSessionPlanning(db, new Date(dueAt.getTime() - 1))).toBe(1);
    expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("PENDING");
    expect(await sweepSessionPlanning(db, dueAt)).toBe(1);
    expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(boundary === "deadline" ? "ACCEPTED" : "EXPIRED");
  });

  it("pages more than 200 invalidations and keeps the durable event/request queues bounded", async () => {
    // Bulk fixtures deliberately have no current offer; source/recipient authority
    // is still checked for split requests, without constructing 205 mail graphs.
    const cohort = await source();
    await db.sessionPlanningRequest.createMany({ data: Array.from({ length: 205 }, (_, index) => ({
      id: `maintenance-many-${String(index).padStart(4, "0")}`, planId: cohort.planId, cohortId: cohort.id,
      scope: "ONE", kind: "RESCHEDULE", participantIds: [tuteeId], status: "SPLIT_REQUESTED",
      updatedAt: new Date(now.getTime() - 60_000 + index),
    })) });
    expect(await sweepSessionPlanning(db, now)).toBe(200);
    const [batch] = await db.$queryRaw<{ settlementEventIds: bigint[]; settlementRequestIds: string[]; settlementBatchActive: boolean }[]>`
      SELECT "settlementEventIds","settlementRequestIds","settlementBatchActive" FROM "SchedulingMaintenanceState"`;
    expect(batch?.settlementBatchActive).toBe(true);
    expect(batch!.settlementEventIds.length).toBeLessThanOrEqual(1000);
    expect(batch!.settlementRequestIds.length).toBeLessThanOrEqual(200);
    expect(await db.sessionPlanningRequest.count({ where: { status: "SPLIT_REQUESTED", updatedAt: { gte: now } } })).toBe(200);
    const firstVisitors = await db.sessionPlanningRequest.findMany({ select: { id: true, updatedAt: true }, orderBy: { id: "asc" } });
    expect(firstVisitors.slice(0, 200).every((row) => row.updatedAt >= now)).toBe(true);
    expect(firstVisitors.slice(200).every((row) => row.updatedAt < now)).toBe(true);
    // The original sweep still visits/touches 200 rows, including unchanged
    // future work. Fairness brings the remaining five into the next visitor set.
    expect(await sweepSessionPlanning(db, now)).toBe(200);
    expect(await db.sessionPlanningRequest.count({ where: { status: "SPLIT_REQUESTED", updatedAt: { gte: now } } })).toBe(205);
    await drainSweep();
    expect(await sweepSessionPlanning(db, now)).toBe(200);
  }, 30_000);

  it("advances past a permanently failing first request and checks later ownership dirtiness", async () => {
    const cohort = await source();
    const target = plannedWindow({ date: "2026-11-03", startMin: 900, online: false }, window.timeZone);
    const requestIds = Array.from({ length: 205 }, (_, index) => `maintenance-many-${String(index).padStart(4, "0")}`);
    await db.sessionPlanningRequest.createMany({ data: requestIds.map((id) => ({
      id, planId: cohort.planId, cohortId: cohort.id, scope: "ONE", kind: "RESCHEDULE",
      participantIds: [tuteeId], currentOfferId: `${id}-offer`,
    })) });
    await db.sessionPlanningOffer.createMany({ data: requestIds.map((id) => ({
      id: `${id}-offer`, requestId: id, sequence: 1, authorKey: `tutor:${tutorId}`,
      ...target, cutoffAt: cohort.startsAt,
    })) });
    await db.sessionPlanningResponse.createMany({ data: requestIds.flatMap((id) => [
      { offerId: `${id}-offer`, actorKey: `tutor:${tutorId}`, actorUserId: tutorUserId, state: "ACCEPTED" },
      { offerId: `${id}-offer`, actorKey: `tutee:${tuteeId}`, actorUserId: tuteeUserId, state: "PENDING" },
    ]) });
    await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: false } });
    await db.$executeRawUnsafe('CREATE FUNCTION scheduling_test_first_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'Synthetic permanent first failure\'; END; $$');
    await db.$executeRawUnsafe('CREATE TRIGGER scheduling_test_first_failure BEFORE INSERT ON "SessionNotice" FOR EACH ROW WHEN (NEW."requestId"=\'maintenance-many-0000\') EXECUTE FUNCTION scheduling_test_first_failure()');
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await sweepSessionPlanning(db, now)).toBe(200);
      await db.user.update({ where: { id: tuteeUserId }, data: { tuteeMember: true } });
      const later = await request(999);
      await db.studentProfileOwnership.create({ data: { tuteeId, userId: "maintenance-other-user" } });
      expect(await sweepSessionPlanning(db, now)).toBeGreaterThanOrEqual(6);
      expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("STALE");
      expect(await db.sessionPlanningRequest.count({ where: { id: { in: requestIds.slice(1) }, status: "PENDING" } })).toBe(0);
      // New dirty batches can finish even though one independent retry remains.
      await sweepSessionPlanning(db, now);
      const [state] = await db.$queryRaw<{ settlementBatchActive: boolean }[]>`
        SELECT "settlementBatchActive" FROM "SchedulingMaintenanceState"`;
      expect(state?.settlementBatchActive).toBe(false);
      const retries = await db.$queryRaw<{ requestId: string }[]>`
        SELECT "requestId" FROM "SchedulingDirtyEvent" WHERE "requestId" IS NOT NULL AND "settlementPending"`;
      expect(retries.map((row) => row.requestId)).toEqual([requestIds[0]]);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER scheduling_test_first_failure ON "SessionNotice"');
      await db.$executeRawUnsafe('DROP FUNCTION scheduling_test_first_failure()');
      errors.mockRestore();
    }
    await sweepSessionPlanning(db, now);
    expect((await db.sessionPlanningRequest.findUniqueOrThrow({ where: { id: requestIds[0] } })).status).toBe("STALE");
  }, 40_000);
});
