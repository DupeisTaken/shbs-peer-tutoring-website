import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { PrismaClient } from "../../generated/prisma";
import type { ControlledOrder } from "./controlled-contention";

export type ContentionRole = "bulk" | "acceptance";
export type FenceOperation = {
  role: ContentionRole; invocation: number; startedAt: string;
  terminal: "running" | "succeeded" | "failed"; terminalAt?: string;
  acquisitions: { sequence: number; startedAt: string; acquiredAt: string; elapsedMs: number }[];
  failedAcquisitions: number;
};
export type FenceSnapshot = { schemaVersion: 1; operations: FenceOperation[] };
export type AuditWitnessRow = { id: string; operation: string | null; createdAt: Date | string };
const prefix = "SELECT pg_advisory_xact_lock(hashtextextended(";
const suffix = ", 0))";

/** Match only lockEntity's exact bound template, never raw unsafe SQL, another
 * key, whitespace-rewritten SQL, additional statements or interpolated text. */
export function isContentionPeriodFence(args: unknown): boolean {
  const match = (strings: unknown, values: unknown) => Array.isArray(strings) &&
    strings.length === 2 && strings[0] === prefix && strings[1] === suffix &&
    Array.isArray(values) && values.length === 1 && values[0] === "program:period";
  const sqlObject = (value: unknown) => value !== null && typeof value === "object" &&
    "strings" in value && "values" in value && match(value.strings, value.values);
  if (sqlObject(args)) return true;
  if (!Array.isArray(args)) return false;
  // Prisma raw query extensions can receive the Sql object directly or the
  // original tagged-template argument list. No other representation is guessed.
  return args.length === 1 ? sqlObject(args[0]) : args.length === 2 && match(args[0], [args[1]]);
}

export function createContentionFenceWitness() {
  const context = new AsyncLocalStorage<FenceOperation | undefined>();
  const operations: FenceOperation[] = [];
  let sequence = 0;
  return {
    async run<T>(role: ContentionRole, work: () => Promise<T>): Promise<T> {
      assert.ok(role === "bulk" || role === "acceptance");
      assert.ok(operations.length < 2, "Only the final contention pair belongs in one witness");
      assert.ok(!operations.some((operation) => operation.role === role), "Duplicate contention operation role");
      const operation: FenceOperation = { role, invocation: operations.length, startedAt: new Date().toISOString(), terminal: "running", acquisitions: [], failedAcquisitions: 0 };
      operations.push(operation);
      return context.run(operation, async () => {
        try { const value = await work(); operation.terminal = "succeeded"; return value; }
        catch (error) { operation.terminal = "failed"; throw error; }
        finally { operation.terminalAt = new Date().toISOString(); }
      });
    },
    bindCurrentContext<Args extends unknown[], Result>(callback: (...args: Args) => Result): (...args: Args) => Result {
      const operation = context.getStore();
      return (...args) => context.run(operation, callback, ...args);
    },
    async observeExecuteRaw<T>(args: unknown, query: () => Promise<T>): Promise<T> {
      const operation = context.getStore();
      if (!operation || !isContentionPeriodFence(args)) return query();
      assert.equal(operation.terminal, "running", "Period query outlived its request witness");
      const startedAt = new Date().toISOString(), started = performance.now();
      try {
        const result = await query();
        assert.equal(operation.terminal, "running", "Period acquisition outlived its request witness");
        assert.ok(operation.acquisitions.length < 4, "Unexpected repeated period-acquisition volume");
        // Record synchronously before returning the real query result to its
        // handler. That handler cannot commit before this completion ordinal;
        // the other transaction cannot acquire the mutex before that commit.
        operation.acquisitions.push({ sequence: ++sequence, startedAt, acquiredAt: new Date().toISOString(), elapsedMs: performance.now() - started });
        return result;
      } catch (error) { operation.failedAcquisitions++; throw error; }
    },
    snapshot(): FenceSnapshot { return { schemaVersion: 1, operations: structuredClone(operations) }; },
    order(): ControlledOrder { return contentionFenceOrder({ schemaVersion: 1, operations }); },
  };
}

export function contentionFenceOrder(snapshot: FenceSnapshot): ControlledOrder {
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.operations.length, 2, "Missing final contention pair");
  assert.deepEqual(snapshot.operations.map((row) => row.invocation).sort((left, right) => left - right), [0, 1], "Contention invocation identities are incomplete/duplicated");
  const bulk = snapshot.operations.find((row) => row.role === "bulk"), acceptance = snapshot.operations.find((row) => row.role === "acceptance");
  assert.ok(bulk && acceptance, "Missing/distinct contention roles");
  for (const operation of snapshot.operations) {
    assert.equal(operation.terminal, "succeeded", "Contention operation did not succeed");
    assert.equal(operation.failedAcquisitions, 0, "A contention period acquisition failed");
    assert.equal(operation.acquisitions.length, 1, "Missing or duplicate real period acquisition");
    const acquisition = operation.acquisitions[0]!;
    assert.ok(Number.isFinite(acquisition.elapsedMs) && acquisition.elapsedMs >= 0);
    assert.ok(Number.isFinite(Date.parse(operation.startedAt)) && operation.terminalAt && Number.isFinite(Date.parse(operation.terminalAt)));
    assert.ok(Date.parse(operation.startedAt) <= Date.parse(acquisition.startedAt) && Date.parse(acquisition.startedAt) <= Date.parse(acquisition.acquiredAt) && Date.parse(acquisition.acquiredAt) <= Date.parse(operation.terminalAt));
  }
  assert.deepEqual(snapshot.operations.map((row) => row.acquisitions[0]!.sequence).sort((left, right) => left - right), [1, 2], "Period acquisition ordinals are incomplete/duplicated");
  return bulk.acquisitions[0]!.sequence < acceptance.acquisitions[0]!.sequence ? "bulk-before-acceptance" : "acceptance-before-bulk";
}

const auditOperations = ["admin.autoAssignUnassignedRooms", "sessionPlanning.accepted", "sessionPlanning.responded", "sessionPlanning.respond"];
export function buildContentionFenceEvidence(snapshot: FenceSnapshot, rows: readonly AuditWitnessRow[]) {
  const order = contentionFenceOrder(snapshot);
  assert.equal(rows.length, 4, "Missing or extra successful contention audit rows");
  assert.equal(new Set(rows.map((row) => row.id)).size, 4, "Duplicate contention audit identity");
  for (const operation of auditOperations) assert.equal(rows.filter((row) => row.operation === operation).length, 1, `Missing/duplicate audit ${operation}`);
  const audits = rows.map((row) => {
    const at = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
    assert.ok(Number.isFinite(at.getTime()));
    return { auditId: row.id, operation: row.operation!, createdAt: at.toISOString() };
  });
  for (let index = 1; index < audits.length; index++) {
    const prior = audits[index - 1]!, current = audits[index]!;
    assert.ok(prior.createdAt < current.createdAt || prior.createdAt === current.createdAt && prior.auditId <= current.auditId, "Audits were not captured in createdAt/id order");
  }
  const bulk = audits.find((row) => row.operation === auditOperations[0])!;
  const responseRows = audits.filter((row) => row.operation !== auditOperations[0]);
  const bulkIndex = audits.indexOf(bulk);
  const auditHistoryOrder: ControlledOrder | "interleaved" = bulkIndex === 0 ? "bulk-before-acceptance" : bulkIndex === 3 ? "acceptance-before-bulk" : "interleaved";
  // Prisma may supply persistence clocks, so audit.createdAt is neither a
  // transaction-start timestamp nor proof that a scheduling mutex was held.
  const crossGroupTimestampTie = responseRows.some((row) => row.createdAt === bulk.createdAt);
  const auditTimestampOrder: ControlledOrder | "tied" | "interleaved" =
    responseRows.every((row) => bulk.createdAt < row.createdAt) ? "bulk-before-acceptance"
      : responseRows.every((row) => bulk.createdAt > row.createdAt) ? "acceptance-before-bulk"
        : crossGroupTimestampTie ? "tied" : "interleaved";
  return { schemaVersion: 1 as const, order, operations: structuredClone(snapshot.operations), audits,
    auditHistoryOrder, auditTimestampOrder,
    auditTimestampOrderBasis: "Persisted AuditLog.createdAt values; chronology is not a lock or transaction-start witness",
    responseTimestampUniform: new Set(responseRows.map((row) => row.createdAt)).size === 1,
    hasTimestampTies: new Set(audits.map((row) => row.createdAt)).size !== audits.length,
    crossGroupTimestampTie,
    historyContradictsFence: auditHistoryOrder !== order,
    auditTimestampContradictsFence: auditTimestampOrder !== "tied" && auditTimestampOrder !== order,
  };
}

/** Runner calls after both requests settle, outside either measured operation.
 * No participant data, audit body, private details or auth capability is read. */
export async function captureContentionFenceEvidence(db: Pick<PrismaClient, "auditLog">, snapshot: FenceSnapshot) {
  contentionFenceOrder(snapshot);
  const rows = await db.auditLog.findMany({ where: { operation: { in: auditOperations } },
    select: { id: true, operation: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return buildContentionFenceEvidence(snapshot, rows);
}
