import { describe, expect, it, vi } from "vitest";
import type { DomainDb, TransactionDb } from "~/server/transactions";
import { databaseScope } from "~/server/db-scope";
import { planningWeeks } from "~/lib/session-planning";
import { ensureSessionPlanningWindow, sweepSessionPlanning } from ".";
import {
  acknowledgeSchedulingPublication,
  readSchedulingMaintenance,
  SCHEDULING_MAINTENANCE_VERSION,
  inSchedulingMaintenanceTransaction,
} from "./maintenance";

const now = new Date("2026-10-26T00:00:00Z");
const window = { ...planningWeeks(now, "Asia/Shanghai"), timeZone: "Asia/Shanghai" };
function state(changes: Record<string, unknown> = {}) {
  return {
    valid: true,
    id: "program",
    publicationVersion: SCHEDULING_MAINTENANCE_VERSION,
    settlementVersion: SCHEDULING_MAINTENANCE_VERSION,
    settlementBatchActive: false,
    windowStart: window.start,
    prepareEnd: window.prepareEnd,
    timeZone: window.timeZone,
    unavailable: 2,
    normalized: 3,
    stateRevision: "100",
    retryPending: false,
    ...changes,
  };
}
function fixture(current = state(), eventIds: bigint[] = []) {
  const events = new Map(eventIds.map((id) => [id, true]));
  const query = vi.fn(async (parts: TemplateStringsArray) => {
    const sql = parts.join("?");
    if (sql.includes("scheduling_verify_maintenance_triggers"))
      return [{
        ...current,
        stateRevision: current.id === null ? null : current.stateRevision,
        eventIds: [...events].filter(([, pending]) => pending).map(([id]) => id),
      }];
    if (sql.includes('SELECT r.id FROM "SessionPlanningRequest" r')) return [];
    return [...events]
      .filter(([, pending]) => pending)
      .map(([id]) => ({ id }));
  });
  const execute = vi.fn(
    async (parts: TemplateStringsArray, ...values: unknown[]) => {
      if (parts.join("?").includes('SET "publicationPending"=false'))
        for (const id of values[0] as bigint[]) events.set(id, false);
      return 0;
    },
  );
  const programSettings = {
    findUnique: vi.fn(async () => ({ timeZone: window.timeZone })),
  };
  return {
    tx: {
      $queryRaw: query,
      $executeRaw: execute,
      programSettings,
    } as unknown as TransactionDb,
    query,
    execute,
    programSettings,
    events,
  };
}

describe("durable scheduling watermark", () => {
  it("makes unchanged warm publication six bounded operations without source enumeration", async () => {
    // No Pairing/Plan delegates are supplied: falling through to a global
    // publication pass would fail this test, independently of query text.
    const mock = fixture();
    await expect(ensureSessionPlanningWindow(mock.tx, now)).resolves.toEqual({
      ...window,
      unavailable: 2,
      normalized: 3,
    });
    expect(mock.query).toHaveBeenCalledTimes(1);
    expect(mock.execute).toHaveBeenCalledTimes(4);
    expect(mock.programSettings.findUnique).toHaveBeenCalledTimes(1);
    expect(mock.execute.mock.calls.filter(([sql]) => sql.join("").includes("pg_advisory_xact_lock"))).toHaveLength(3);
    expect(mock.execute.mock.calls.filter(([sql]) => sql.join("").includes("IN ACCESS SHARE MODE"))).toHaveLength(1);
  });

  it("keeps an empty unchanged sweep to six bounded operations", async () => {
    const mock = fixture();
    await expect(sweepSessionPlanning(mock.tx, now)).resolves.toBe(0);
    expect(mock.query).toHaveBeenCalledTimes(2);
    expect(mock.execute).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["missing state", { id: null }],
    ["old implementation", { publicationVersion: 0 }],
    ["new implementation", { publicationVersion: 2 }],
    ["different timezone", { timeZone: "UTC" }],
    ["Sunday preparation", { prepareEnd: "2026-11-15" }],
    ["Monday window", { windowStart: "2026-11-02" }],
  ])("requires catch-up for %s", async (_label, change) => {
    const mock = fixture(state(change));
    expect((await readSchedulingMaintenance(mock.tx, window)).current).toBe(false);
  });

  it("fails closed when source-trigger coverage cannot establish invalidation", async () => {
    const mock = fixture(state({ valid: false }));
    await expect(readSchedulingMaintenance(mock.tx, window)).rejects.toThrow("source triggers");
    expect(mock.query).toHaveBeenCalledTimes(1);
  });

  it("acknowledges exact visible IDs and preserves a smaller sequence that commits late", async () => {
    const mock = fixture(state(), [12n, 20n]);
    const before = await readSchedulingMaintenance(mock.tx, window);
    mock.events.set(9n, true);
    mock.events.set(21n, true);
    await acknowledgeSchedulingPublication(mock.tx, {
      ...window,
      eventIds: before.eventIds,
      stateRevision: before.stateRevision,
      unavailable: 0,
      normalized: 0,
    });
    expect(mock.events.get(12n)).toBe(false);
    expect(mock.events.get(20n)).toBe(false);
    expect(mock.events.get(9n)).toBe(true);
    expect(mock.events.get(21n)).toBe(true);
    expect((await readSchedulingMaintenance(mock.tx, window)).current).toBe(false);
  });
});

describe("whole scheduling transaction conflict retry", () => {
  function client() {
    const tx = {} as TransactionDb;
    const transaction = vi.fn(async (work: (tx: TransactionDb) => Promise<unknown>) => work(tx));
    return { db: { $transaction: transaction } as unknown as DomainDb, tx, transaction };
  }

  it.each([
    { code: "40P01" },
    { code: "P2034" },
    { code: "P2010", meta: { code: "40P01" } },
    { meta: { driverAdapterError: { cause: { originalCode: "40P01" } } } },
  ])("restarts the complete owned transaction for a confirmed abort %#", async (error) => {
    const mock = client();
    const work = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("committed");
    expect(await inSchedulingMaintenanceTransaction(mock.db, work)).toBe("committed");
    expect(mock.transaction).toHaveBeenCalledTimes(2);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("bounds repeated deadlocks to three fresh transactions", async () => {
    const mock = client();
    const error = { cause: { originalCode: "40P01" } };
    const work = vi.fn().mockRejectedValue(error);
    await expect(inSchedulingMaintenanceTransaction(mock.db, work)).rejects.toBe(error);
    expect(mock.transaction).toHaveBeenCalledTimes(3);
  });

  it.each([new Error("Notice failed"), { code: "P2002" }, { code: "40001" }])("does not replay an unrelated error %#", async (error) => {
    const mock = client();
    await expect(inSchedulingMaintenanceTransaction(mock.db, vi.fn().mockRejectedValue(error))).rejects.toBe(error);
    expect(mock.transaction).toHaveBeenCalledTimes(1);
  });

  it("bounds cyclic and deeply nested provider errors", async () => {
    const mock = client();
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    await expect(inSchedulingMaintenanceTransaction(mock.db, vi.fn().mockRejectedValue(cyclic))).rejects.toBe(cyclic);
    let deep: unknown = { code: "40P01" };
    for (let index = 0; index < 12; index++) deep = { cause: deep };
    await expect(inSchedulingMaintenanceTransaction(mock.db, vi.fn().mockRejectedValue(deep))).rejects.toBe(deep);
    expect(mock.transaction).toHaveBeenCalledTimes(2);
  });

  it("propagates a caller-owned transaction abort without retrying its callback", async () => {
    const mock = client();
    const error = { code: "40P01" };
    const work = vi.fn().mockRejectedValue(error);
    await expect(inSchedulingMaintenanceTransaction(mock.tx, work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(1);
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it("does not mistake an async-scoped root proxy for a new transaction boundary", async () => {
    const mock = client();
    const error = { code: "40P01" };
    const work = vi.fn().mockRejectedValue(error);
    await expect(databaseScope.run(mock.tx, () => inSchedulingMaintenanceTransaction(mock.db, work))).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(1);
    expect(mock.transaction).not.toHaveBeenCalled();
  });
});
