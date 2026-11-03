import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { errorMonitor, type EventEmitter } from "node:events";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { Pool, PoolClient } from "pg";

export type ProfileMode = "latency" | "diagnostic";
type QueryTotals = { count: number; elapsedMs: number; errors: number };
type Diagnostics = {
  driverQueries: QueryTotals;
  queryShapes: Record<string, QueryTotals>;
  prismaEvents: { count: number; durationMs: number };
  connectionAcquisitionMs: number[];
  acquisitionStatementMs: number[];
  lockHeldTransactionMs: number[];
  uncertainLockIntervals: { observedMs: number; reason: string }[];
  implicitTransactionLockAcquisitions: number;
  processCpuMs: { user: number; system: number };
  eventLoopUtilization: number;
  eventLoopDelayMs: { mean: number; max: number; p95: number } | null;
  overlappedAnotherRequest: boolean;
};
export type ProfileSample = {
  label: string;
  elapsedMs: number;
  succeeded: boolean;
  status: "unfinished" | "succeeded" | "failed";
  censored: boolean;
  elapsedIsLowerBound: boolean;
  error?: "OPERATION_UNFINISHED" | "OPERATION_FAILED";
  diagnostics?: Diagnostics;
};

/** Empirical nearest-rank percentiles of completed observations. Summary retains
 * unfinished observations separately as censored elapsed lower bounds. */
export function percentile(values: readonly number[], quantile: number) {
  if (!values.length) return null;
  if (!(quantile > 0 && quantile <= 1)) throw new Error("Invalid quantile");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(quantile * sorted.length) - 1]!;
}

// Only a digest of SQL structure leaves the process. Never retain query text,
// bound values, connection strings, participant identifiers or error messages.
export function queryShape(sql: string) {
  const verb = /^\s*([a-z]+)/i.exec(sql)?.[1]?.toUpperCase() ?? "OTHER";
  return `${verb}:${createHash("sha256").update(sql).digest("hex").slice(0, 16)}`;
}

type UnknownCall = (...args: unknown[]) => unknown;
type HeldLock = { acquiredAt: number; metrics: Diagnostics };
type TransactionState = { uncertainScope: boolean };

/** Keep the exact method for restoration while exposing only an invocation that
 * supplies its original receiver. Instrumentation never calls an unbound method. */
function captureMethod<Owner extends object, Key extends keyof Owner>(owner: Owner, key: Key) {
  const original = owner[key];
  const invoke: UnknownCall = (...args) => (original as unknown as UnknownCall).apply(owner, args);
  return { original, invoke };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value && typeof value.then === "function";
}

export function createProfiler(mode: ProfileMode) {
  // An acquisition requested outside a measured operation must clear a releasing
  // request's context too; undefined is an intentional bound context.
  const context = new AsyncLocalStorage<Diagnostics | undefined>();
  const samples: ProfileSample[] = [];
  const runningStarts = new Map<ProfileSample, number>();
  const active = new Set<Diagnostics>();
  const restorers: (() => void)[] = [];
  const heldLocks = new Map<PoolClient, HeldLock>();
  const transactions = new WeakMap<PoolClient, TransactionState>();
  const instrumented = new WeakSet<PoolClient>();
  const pools = new WeakSet<Pool>();
  let pendingMeasures = 0;
  let closed = false;

  function finishSample(sample: ProfileSample, startedAt: number) {
    sample.elapsedMs = performance.now() - startedAt;
    sample.status = sample.succeeded ? "succeeded" : "failed";
    sample.censored = false;
    sample.elapsedIsLowerBound = false;
    if (sample.succeeded) delete sample.error;
    else sample.error = "OPERATION_FAILED";
    runningStarts.delete(sample);
  }

  function uncertainInterval(client: PoolClient, reason: string, endedAt = performance.now()) {
    const held = heldLocks.get(client);
    if (held) {
      held.metrics.uncertainLockIntervals.push({ observedMs: endedAt - held.acquiredAt, reason });
      heldLocks.delete(client);
    }
    const transaction = transactions.get(client);
    if (transaction) transaction.uncertainScope = true;
  }

  function instrumentClient(client: PoolClient) {
    if (instrumented.has(client)) return;
    instrumented.add(client);
    const { original, invoke } = captureMethod(client, "query");
    const wrapped: UnknownCall = function (...args) {
      const metrics = context.getStore();
      const first = args[0];
      const sql = typeof first === "string"
        ? first
        : first && typeof first === "object" && "text" in first && typeof first.text === "string"
          ? first.text
          : "";
      const startedAt = performance.now();
      let completed = false;
      const finish = (failed: boolean) => {
        if (completed) return;
        completed = true;
        const endedAt = performance.now();
        if (metrics) {
          const elapsedMs = endedAt - startedAt;
          metrics.driverQueries.count++;
          metrics.driverQueries.elapsedMs += elapsedMs;
          metrics.driverQueries.errors += Number(failed);
          const shape = queryShape(sql);
          const totals = metrics.queryShapes[shape] ??= { count: 0, elapsedMs: 0, errors: 0 };
          totals.count++;
          totals.elapsedMs += elapsedMs;
          totals.errors += Number(failed);
          if (/\bpg_advisory_xact_lock\s*\(/i.test(sql)) {
            metrics.acquisitionStatementMs.push(elapsedMs);
          }
        }
        if (!failed && /^\s*(?:BEGIN\b|START\s+TRANSACTION\b)/i.test(sql)) {
          uncertainInterval(client, "new-begin-before-observed-end", endedAt);
          transactions.set(client, { uncertainScope: false });
        }
        if (!failed && /\bpg_advisory_xact_lock\s*\(/i.test(sql)) {
          const transaction = transactions.get(client);
          if (!transaction) {
            // In autocommit the transaction ends with this statement, so no
            // later COMMIT can supply its lock-held interval.
            if (metrics) metrics.implicitTransactionLockAcquisitions++;
          } else if (metrics && !transaction.uncertainScope && !heldLocks.has(client)) {
            heldLocks.set(client, { acquiredAt: endedAt, metrics });
          }
        }
        // Savepoint rollback can release locks acquired in the rolled-back
        // scope. Do not guess that scope or claim a complete held interval.
        if (!failed && /^\s*ROLLBACK\s+TO\b/i.test(sql)) {
          uncertainInterval(client, "savepoint-rollback", endedAt);
        } else if (/^\s*(?:COMMIT|END|ROLLBACK|ABORT)\b/i.test(sql)) {
          const held = heldLocks.get(client);
          if (failed) {
            uncertainInterval(client, "failed-transaction-end", endedAt);
          } else if (held) {
            held.metrics.lockHeldTransactionMs.push(endedAt - held.acquiredAt);
            heldLocks.delete(client);
          }
          if (!failed) transactions.delete(client);
        }
      };
      const callbackIndex = args.length - 1;
      const callback = args[callbackIndex];
      if (typeof callback === "function") {
        args[callbackIndex] = function (this: unknown, ...callbackArgs: unknown[]) {
          finish(callbackArgs[0] != null);
          return (callback as UnknownCall).apply(this, callbackArgs);
        };
      }
      try {
        const result = invoke.apply(client, args);
        if (isPromiseLike(result))
          return Promise.resolve(result).then(
            (value: unknown) => { finish(false); return value; },
            (error: unknown) => { finish(true); throw error; },
          );
        return result;
      } catch (error) {
        finish(true);
        throw error;
      }
    };
    client.query = wrapped as typeof client.query;
    restorers.push(() => { if (client.query === wrapped) client.query = original; });
    if (typeof client.on === "function") {
      const events: EventEmitter = client;
      const onError = () => uncertainInterval(client, "client-error");
      const onEnd = () => uncertainInterval(client, "client-end");
      // errorMonitor observes without turning an otherwise unhandled error into
      // a handled one or replacing the pool/adapter's connection error policy.
      events.on(errorMonitor, onError);
      events.on("end", onEnd);
      restorers.push(() => { events.off(errorMonitor, onError); events.off("end", onEnd); });
    }
  }

  return {
    /** Correlate the harness's real loopback HTTP server with its measured
     * client operation without exposing diagnostics or participant identities.
     * The caller owns an opaque one-request token and must reject unknown tokens.
     */
    bindCurrentContext<Args extends unknown[], Result>(
      callback: (...args: Args) => Result,
    ): (...args: Args) => Result {
      const metrics = context.getStore();
      return (...args) => context.run(metrics, callback, ...args);
    },
    attachPool(pool: Pool) {
      if (mode !== "diagnostic") return;
      if (closed) throw new Error("Profiler is closed");
      if (pools.has(pool)) return;
      pools.add(pool);
      // Attach before constructing PrismaPg: every connection is instrumented
      // once; neither the adapter nor the production singleton is modified.
      pool.on("connect", instrumentClient);
      restorers.push(() => { pool.off("connect", instrumentClient); });
      const onRelease = (_error: unknown, client: PoolClient) => {
        uncertainInterval(client, "client-release-without-observed-end");
        transactions.delete(client);
      };
      const onRemove = (client: PoolClient) => {
        uncertainInterval(client, "pool-remove-without-observed-end");
        transactions.delete(client);
      };
      pool.on("release", onRelease);
      pool.on("remove", onRemove);
      restorers.push(() => { pool.off("release", onRelease); pool.off("remove", onRemove); });
      const { original: originalConnect, invoke: connect } = captureMethod(pool, "connect");
      const wrappedConnect: UnknownCall = (...args) => {
        const metrics = context.getStore();
        const startedAt = performance.now();
        let completed = false;
        const finishAcquisition = () => {
          if (completed) return;
          completed = true;
          metrics?.connectionAcquisitionMs.push(performance.now() - startedAt);
        };
        const callback = args[0];
        if (typeof callback === "function") {
          // pg-pool may invoke a queued acquisition from the releasing request's
          // async context. Bind the caller here before pool.query reaches query().
          args[0] = function (this: unknown, ...values: unknown[]) {
            return context.run(metrics, (receiver: unknown) => {
              finishAcquisition();
              return (callback as UnknownCall).apply(receiver, values);
            }, this);
          };
        }
        try {
          const result = connect.apply(pool, args);
          if (isPromiseLike(result))
            return Promise.resolve(result).then(
              (value: unknown) => { finishAcquisition(); return value; },
              (error: unknown) => { finishAcquisition(); throw error; },
            );
          return result;
        } catch (error) {
          finishAcquisition();
          throw error;
        }
      };
      pool.connect = wrappedConnect as typeof pool.connect;
      restorers.push(() => {
        if (pool.connect === wrappedConnect) pool.connect = originalConnect;
      });
    },
    observeQuery(event: { duration: number }) {
      const metrics = context.getStore();
      if (!metrics) return;
      metrics.prismaEvents.count++;
      metrics.prismaEvents.durationMs += event.duration;
    },
    async measure<T>(label: string, operation: () => Promise<T>): Promise<T> {
      if (closed) throw new Error("Profiler is closed");
      const startedAt = performance.now();
      const sample: ProfileSample = {
        label, elapsedMs: 0, succeeded: false, status: "unfinished",
        censored: true, elapsedIsLowerBound: true, error: "OPERATION_UNFINISHED",
      };
      samples.push(sample);
      runningStarts.set(sample, startedAt);
      pendingMeasures++;
      if (mode === "latency") {
        try {
          const value = await operation();
          sample.succeeded = true;
          return value;
        } finally {
          finishSample(sample, startedAt);
          pendingMeasures--;
        }
      }
      const histogram = monitorEventLoopDelay({ resolution: 10 });
      const cpu = process.cpuUsage();
      const loop = performance.eventLoopUtilization();
      const metrics: Diagnostics = {
        driverQueries: { count: 0, elapsedMs: 0, errors: 0 },
        queryShapes: {},
        prismaEvents: { count: 0, durationMs: 0 },
        connectionAcquisitionMs: [],
        acquisitionStatementMs: [],
        lockHeldTransactionMs: [],
        uncertainLockIntervals: [],
        implicitTransactionLockAcquisitions: 0,
        processCpuMs: { user: 0, system: 0 },
        eventLoopUtilization: 0,
        eventLoopDelayMs: null,
        overlappedAnotherRequest: active.size > 0,
      };
      for (const other of active) other.overlappedAnotherRequest = true;
      active.add(metrics);
      sample.diagnostics = metrics;
      histogram.enable();
      try {
        return await context.run(metrics, async () => {
          const value = await operation();
          sample.succeeded = true;
          return value;
        });
      } finally {
        finishSample(sample, startedAt);
        histogram.disable();
        const used = process.cpuUsage(cpu);
        metrics.processCpuMs = { user: used.user / 1000, system: used.system / 1000 };
        metrics.eventLoopUtilization = performance.eventLoopUtilization(loop).utilization;
        if (histogram.count > 0)
          metrics.eventLoopDelayMs = {
            mean: histogram.mean / 1e6,
            max: histogram.max / 1e6,
            p95: histogram.percentile(95) / 1e6,
          };
        active.delete(metrics);
        pendingMeasures--;
      }
    },
    summary() {
      const observedAt = performance.now();
      // Watchdogs save before measure()'s finally can run. Produce a detached
      // snapshot with the running elapsed lower bound, never a completed 0 ms
      // observation. Reporting cannot finalize or mutate an active/finished span.
      const snapshot = samples.map((sample): ProfileSample => {
        const startedAt = runningStarts.get(sample);
        const copy = { ...sample };
        if (startedAt !== undefined) copy.elapsedMs = Math.max(0, observedAt - startedAt);
        if (sample.diagnostics) copy.diagnostics = structuredClone(sample.diagnostics);
        return copy;
      });
      const labels = [...new Set(snapshot.map((sample) => sample.label))];
      return {
        mode,
        interpretation: {
          latency: "Completed procedure/domain elapsed time includes completed failures. Unfinished operations remain raw censored elapsed lower bounds and are excluded from completed p50/p95; errors counts completed failures, while unfinished/censored counts remain explicit. A timeout receipt cannot establish latency gains. Diagnostic runs are separate.",
          lockAcquisition: "Advisory lock statement call-to-completion, including driver/database overhead; not exact server lock wait.",
          lockHold: "First acquired advisory lock in an explicitly observed BEGIN transaction through successful COMMIT/ROLLBACK completion, including commit overhead. Failed ends, savepoint rollbacks and interrupted connections are separate uncertain intervals. Autocommit acquisitions have no reported hold interval.",
          cpuAndEventLoop: "Process-wide during each operation; overlapping samples include other requests and must not be summed. Null delay means no histogram observations.",
          queries: "Driver invocations and Prisma event durations are separate counters, never summed together. Cumulative driver elapsed can exceed request wall time when queries overlap. Query shapes are hashes, without SQL text or values.",
          unfinished: "Running diagnostic counters are partial; CPU/event-loop totals finalize only on completion. Each unfinished sample has OPERATION_UNFINISHED rather than an invented final error or duration.",
        },
        operations: Object.fromEntries(labels.map((label) => {
          const rows = snapshot.filter((sample) => sample.label === label);
          const completed = rows.filter((sample) => !sample.censored);
          const unfinished = rows.length - completed.length;
          return [label, {
            samples: rows.length,
            completed: completed.length,
            errors: completed.filter((sample) => !sample.succeeded).length,
            unfinished,
            censored: unfinished,
            p50Ms: percentile(completed.map((sample) => sample.elapsedMs), 0.5),
            p95Ms: percentile(completed.map((sample) => sample.elapsedMs), 0.95),
          }];
        })),
        samples: snapshot,
      };
    },
    close() {
      if (closed) return;
      if (pendingMeasures) throw new Error("Cannot close profiler with active operations");
      for (const client of heldLocks.keys()) uncertainInterval(client, "profiler-close-before-observed-end");
      for (const restore of restorers.reverse()) restore();
      closed = true;
      context.disable();
    },
  };
}
