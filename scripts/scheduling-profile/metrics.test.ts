import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { Pool, PoolClient } from "pg";
import { createProfiler, percentile, queryShape } from "./metrics";

void test("nearest-rank percentiles retain tail observations without interpolating", () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([30, 10, 20], 0.5), 20);
  assert.equal(percentile(Array.from({ length: 100 }, (_, index) => index + 1), 0.95), 95);
  assert.throws(() => percentile([1], 0));
});

void test("latency summary includes rejected operations and omits diagnostic instrumentation", async () => {
  const profiler = createProfiler("latency");
  assert.equal(await profiler.measure("request", () => Promise.resolve(42)), 42);
  const failure = new Error("fixture rejection");
  await assert.rejects(profiler.measure("request", () => Promise.reject(failure)), (error) => error === failure);
  const result = profiler.summary();
  assert.equal(result.operations.request?.samples, 2);
  assert.equal(result.operations.request?.errors, 1);
  assert.ok(result.samples.every((sample) => sample.elapsedMs >= 0 && sample.diagnostics === undefined));
  profiler.close();
  await assert.rejects(profiler.measure("closed", () => Promise.resolve()));
});

for (const mode of ["latency", "diagnostic"] as const) {
  for (const outcome of ["resolve", "reject"] as const) {
    void test(`${mode} summary retains censored elapsed bounds until a pending operation ${outcome}s`, { timeout: 5_000 }, async () => {
      const profiler = createProfiler(mode);
      let resolvePending!: () => void;
      let rejectPending!: (error: Error) => void;
      const gate = new Promise<void>((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
      const pending = profiler.measure("request", () => gate);
      // Attach rejection handling immediately so this test also verifies the
      // final failed observation without creating an unhandled rejection.
      const observed = pending.then(
        () => ({ status: "fulfilled" as const }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        const first = profiler.summary();
        const censored = first.samples[0]!;
        assert.equal(censored.status, "unfinished");
        assert.equal(censored.censored, true);
        assert.equal(censored.elapsedIsLowerBound, true);
        assert.equal(censored.error, "OPERATION_UNFINISHED");
        assert.equal(censored.succeeded, false);
        assert.ok(censored.elapsedMs > 0, "Running time must not remain the initial zero");
        assert.equal(first.operations.request?.samples, 1);
        assert.equal(first.operations.request?.completed, 0);
        assert.equal(first.operations.request?.unfinished, 1);
        assert.equal(first.operations.request?.censored, 1);
        assert.equal(first.operations.request?.errors, 0);
        assert.equal(first.operations.request?.p50Ms, null);
        assert.equal(first.operations.request?.p95Ms, null);
        const retainedLowerBound = censored.elapsedMs;

        await profiler.measure("request", () => Promise.resolve("completed control"));
        const mixed = profiler.summary();
        const control = mixed.samples[1]!;
        assert.equal(mixed.operations.request?.samples, 2);
        assert.equal(mixed.operations.request?.completed, 1);
        assert.equal(mixed.operations.request?.unfinished, 1);
        assert.equal(mixed.operations.request?.p50Ms, control.elapsedMs);
        assert.equal(mixed.operations.request?.p95Ms, control.elapsedMs);
        assert.ok(mixed.samples[0]!.elapsedMs >= retainedLowerBound);
        assert.equal(censored.elapsedMs, retainedLowerBound,
          "A later summary cannot mutate an earlier saved timeout snapshot");
        if (mode === "diagnostic") {
          assert.equal(censored.diagnostics?.overlappedAnotherRequest, false);
          assert.equal(mixed.samples[0]!.diagnostics?.overlappedAnotherRequest, true);
        }

        const failure = new Error("synthetic pending operation failure");
        if (outcome === "reject") rejectPending(failure);
        else resolvePending();
        const result = await observed;
        if (outcome === "reject") {
          assert.ok(result.status === "rejected");
          assert.equal(result.error, failure);
        } else assert.equal(result.status, "fulfilled");
        const finished = profiler.summary();
        const finalSample = finished.samples[0]!;
        assert.equal(finalSample.status, outcome === "reject" ? "failed" : "succeeded");
        assert.equal(finalSample.censored, false);
        assert.equal(finalSample.elapsedIsLowerBound, false);
        assert.equal(finalSample.error, outcome === "reject" ? "OPERATION_FAILED" : undefined);
        assert.ok(finalSample.elapsedMs >= mixed.samples[0]!.elapsedMs);
        assert.equal(finished.operations.request?.completed, 2);
        assert.equal(finished.operations.request?.unfinished, 0);
        assert.equal(finished.operations.request?.censored, 0);
        assert.equal(finished.operations.request?.errors, outcome === "reject" ? 1 : 0);
        assert.equal(finished.operations.request?.p95Ms,
          Math.max(...finished.samples.map((sample) => sample.elapsedMs)));
        assert.equal(profiler.summary().samples[0]!.elapsedMs, finalSample.elapsedMs,
          "Completed durations cannot grow when a later summary is saved");
        assert.equal(censored.status, "unfinished");
        assert.equal(censored.elapsedMs, retainedLowerBound);
      } finally {
        resolvePending();
        await observed;
        profiler.close();
      }
    });
  }
}

void test("query shape output contains neither source SQL nor embedded secrets", () => {
  const sql = "SELECT 'synthetic-secret@example.invalid'";
  assert.match(queryShape(sql), /^SELECT:[0-9a-f]{16}$/);
  assert.equal(queryShape(sql), queryShape(sql));
  assert.notEqual(queryShape(sql), queryShape("SELECT $1"));
});

void test("driver diagnostics attribute queries, errors and lock lifetime to the requesting operation", async () => {
  const pool = new EventEmitter() as Pool;
  const failure = new Error("synthetic database failure");
  const original = (sql: string) => sql === "FAIL" ? Promise.reject(failure) : Promise.resolve({ rows: [] });
  const client = { query: original } as unknown as PoolClient;
  const profiler = createProfiler("diagnostic");
  profiler.attachPool(pool);
  pool.emit("connect", client);
  await profiler.measure("transaction", async () => {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [42]);
    await client.query("SELECT pg_advisory_xact_lock($1)", [42]);
    await assert.rejects(client.query("FAIL"), (error) => error === failure);
    await client.query("ROLLBACK");
  });
  const metrics = profiler.summary().samples[0]!.diagnostics!;
  assert.equal(metrics.driverQueries.count, 5);
  assert.equal(metrics.driverQueries.errors, 1);
  assert.equal(metrics.acquisitionStatementMs.length, 2);
  assert.equal(metrics.lockHeldTransactionMs.length, 1);
  assert.equal(metrics.uncertainLockIntervals.length, 0);
  profiler.close();
  assert.ok(client.query === original);
  assert.equal(pool.listenerCount("connect"), 0);
});

void test("callback-style queries preserve return values and callback errors", async () => {
  const pool = new EventEmitter() as Pool;
  const failure = new Error("callback failure");
  const sentinel = {};
  const receiver = { query: "original callback receiver" };
  const client = {
    query: (_sql: string, callback: (this: unknown, error: Error) => void) => {
      queueMicrotask(() => callback.call(receiver, failure));
      return sentinel;
    },
  } as unknown as PoolClient;
  const profiler = createProfiler("diagnostic");
  profiler.attachPool(pool);
  pool.emit("connect", client);
  await profiler.measure("callback", () => new Promise<void>((resolve) => {
    const returned = client.query("SELECT $1", function (this: unknown, error: Error) {
      assert.equal(this, receiver);
      assert.equal(error, failure);
      resolve();
    });
    assert.equal(returned, sentinel);
  }));
  assert.equal(profiler.summary().samples[0]!.diagnostics!.driverQueries.errors, 1);
  profiler.close();
});

void test("autocommit advisory locks never inherit a later transaction's hold interval", async () => {
  const pool = new EventEmitter() as Pool;
  const client = { query: () => Promise.resolve({ rows: [] }) } as unknown as PoolClient;
  const profiler = createProfiler("diagnostic");
  profiler.attachPool(pool);
  pool.emit("connect", client);
  await profiler.measure("implicit", async () => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [42]);
    await client.query("BEGIN");
    await client.query("COMMIT");
  });
  const diagnostics = profiler.summary().samples[0]!.diagnostics!;
  assert.equal(diagnostics.implicitTransactionLockAcquisitions, 1);
  assert.equal(diagnostics.lockHeldTransactionMs.length, 0);
  assert.equal(diagnostics.uncertainLockIntervals.length, 0);
  profiler.close();
});

void test("failed transaction endings and savepoint rollbacks are uncertain intervals", async () => {
  const pool = new EventEmitter() as Pool;
  const client = {
    query: (sql: string) => sql === "COMMIT" ? Promise.reject(new Error("fixture commit failure")) : Promise.resolve({ rows: [] }),
  } as unknown as PoolClient;
  const profiler = createProfiler("diagnostic");
  profiler.attachPool(pool);
  pool.emit("connect", client);
  await profiler.measure("failed-end", async () => {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [42]);
    await assert.rejects(client.query("COMMIT"));
    await client.query("ROLLBACK");
  });
  await profiler.measure("savepoint", async () => {
    await client.query("BEGIN");
    await client.query("SAVEPOINT fixture");
    await client.query("SELECT pg_advisory_xact_lock($1)", [42]);
    await client.query("ROLLBACK TO SAVEPOINT fixture");
    await client.query("SELECT pg_advisory_xact_lock($1)", [42]);
    await client.query("ROLLBACK");
  });
  const diagnostics = profiler.summary().samples.map((sample) => sample.diagnostics!);
  assert.deepEqual(diagnostics.map((sample) => sample.lockHeldTransactionMs), [[], []]);
  assert.deepEqual(diagnostics.map((sample) => sample.uncertainLockIntervals.map((row) => row.reason)), [
    ["failed-transaction-end"], ["savepoint-rollback"],
  ]);
  profiler.close();
});

void test("an unended lock interval is reported at release or profiler shutdown", async () => {
  const pool = new EventEmitter() as Pool;
  const client = { query: () => Promise.resolve({ rows: [] }) } as unknown as PoolClient;
  const profiler = createProfiler("diagnostic");
  profiler.attachPool(pool);
  pool.emit("connect", client);
  for (const label of ["released", "unended"]) {
    await profiler.measure(label, async () => {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [42]);
      if (label === "released") pool.emit("release", undefined, client);
    });
  }
  profiler.close();
  const diagnostics = profiler.summary().samples.map((sample) => sample.diagnostics!);
  assert.deepEqual(diagnostics.map((sample) => sample.lockHeldTransactionMs), [[], []]);
  assert.deepEqual(diagnostics.map((sample) => sample.uncertainLockIntervals.map((row) => row.reason)), [
    ["client-release-without-observed-end"], ["profiler-close-before-observed-end"],
  ]);
});

void test("pool callback binding attributes queued queries to the acquiring request", async () => {
  type ConnectCallback = (this: unknown, error: unknown, client: PoolClient) => void;
  const receiver = { pool: "callback receiver" };
  const sentinel = {};
  const pending: ConnectCallback[] = [];
  const originalConnect = (callback: ConnectCallback) => { pending.push(callback); return sentinel; };
  const pool = Object.assign(new EventEmitter(), {
    connect: originalConnect,
  }) as unknown as Pool;
  const client = {
    query: (sql: string) => Promise.resolve({ rows: [{ sql }] }),
  } as unknown as PoolClient;
  const profiler = createProfiler("diagnostic");
  profiler.attachPool(pool);
  pool.emit("connect", client);
  let requested!: () => void;
  const requestQueued = new Promise<void>((resolve) => { requested = resolve; });
  let release!: () => void;
  const mayRelease = new Promise<void>((resolve) => { release = resolve; });
  const first = profiler.measure("releasing", async () => {
    await mayRelease;
    await client.query("SELECT 'first-request'");
    pending.shift()!.call(receiver, undefined, client);
  });
  const second = profiler.measure("queued", () => new Promise<void>((resolve, reject) => {
    // This reproduces pool.query executing query() inside connect's callback,
    // invoked by the first request's release rather than the second's context.
    const returned = pool.connect(function (this: unknown, error, acquired) {
      try {
        assert.equal(this, receiver);
        assert.equal(error, undefined);
        assert.ok(acquired, "Queued acquisition must provide its client");
        void acquired.query("SELECT 'second-request'").then(() => resolve(), reject);
      } catch (caught) {
        reject(caught instanceof Error ? caught : new Error("Queued acquisition callback failed", { cause: caught }));
      }
    });
    assert.equal(returned, sentinel);
    requested();
  }));
  await requestQueued;
  release();
  await Promise.all([first, second]);
  const diagnostics = profiler.summary().samples.map((sample) => sample.diagnostics!);
  assert.equal(diagnostics[0]!.driverQueries.count, 1);
  assert.equal(diagnostics[1]!.driverQueries.count, 1);
  assert.equal(diagnostics[0]!.queryShapes[queryShape("SELECT 'second-request'")], undefined);
  assert.equal(diagnostics[1]!.queryShapes[queryShape("SELECT 'second-request'")]?.count, 1);
  assert.equal(diagnostics[1]!.connectionAcquisitionMs.length, 1);
  profiler.close();
  assert.ok(pool.connect === originalConnect);
});

void test("latency mode also refuses to close while an operation is outstanding", async () => {
  const profiler = createProfiler("latency");
  let finish!: () => void;
  const pending = profiler.measure("pending", () => new Promise<void>((resolve) => { finish = resolve; }));
  assert.throws(() => profiler.close(), /active operations/);
  finish();
  await pending;
  profiler.close();
});

void test("opaque HTTP request bindings carry diagnostics across a detached server callback", async () => {
  const pool = new EventEmitter() as Pool;
  const client = { query: () => Promise.resolve({ rows: [] }) } as unknown as PoolClient;
  const profiler = createProfiler("diagnostic");
  profiler.attachPool(pool);
  pool.emit("connect", client);
  let runServer!: (sql: string) => Promise<unknown>;
  let complete!: () => void;
  const response = new Promise<void>((resolve) => { complete = resolve; });
  const request = profiler.measure("http-client", () => {
    runServer = profiler.bindCurrentContext(async (sql: string) => {
      const result = await client.query(sql);
      complete();
      return result;
    });
    return response;
  });
  // This invocation occurs in the outer context, as an incoming socket callback
  // would. The measured request's opaque binding restores only its own metrics.
  await runServer("SELECT 'synthetic-http-server'");
  await request;
  assert.equal(profiler.summary().samples[0]!.diagnostics!.driverQueries.count, 1);
  profiler.close();
});

void test("unmeasured queued acquisition clears the releasing request's metrics context", async () => {
  type Callback = (error: unknown, client: PoolClient) => void;
  let queued!: Callback;
  const pool = Object.assign(new EventEmitter(), {
    connect: (callback: Callback) => { queued = callback; },
  }) as unknown as Pool;
  const client = { query: () => Promise.resolve({ rows: [] }) } as unknown as PoolClient;
  const profiler = createProfiler("diagnostic");
  profiler.attachPool(pool);
  pool.emit("connect", client);
  const outsideQuery = new Promise<void>((resolve, reject) => {
    pool.connect((_error, acquired) => {
      if (!acquired) { reject(new Error("Unmeasured acquisition did not provide its client")); return; }
      void acquired.query("SELECT 'unmeasured'").then(() => resolve(), reject);
    });
  });
  await profiler.measure("releasing", async () => {
    await client.query("SELECT 'measured'");
    queued(undefined, client);
    await outsideQuery;
  });
  const diagnostics = profiler.summary().samples[0]!.diagnostics!;
  assert.equal(diagnostics.driverQueries.count, 1);
  assert.equal(diagnostics.queryShapes[queryShape("SELECT 'unmeasured'")], undefined);
  profiler.close();
});
