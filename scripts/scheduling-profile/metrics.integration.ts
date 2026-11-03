/** Explicit real-pg check, excluded from the routine *.test.ts pure-test glob.
 * Run serially against the dedicated owned disposable service:
 * node --import tsx --test scripts/scheduling-profile/metrics.integration.ts
 * Only SELECT/BEGIN/COMMIT/ROLLBACK are used; no fixture reset or schema writes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { assertIsolatedTestDatabase } from "../../src/test/database-guard";
import { createProfiler, queryShape } from "./metrics";

void test("real pg max:1 queued pool queries retain the acquiring request context", { timeout: 15_000 }, async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(target.port, "55439", "Use the owned scheduling profile service");
  assert.equal(target.pathname, "/shbs_performance_test");
  assert.equal(target.search, "", "No driver query overrides are allowed");
  assert.equal(target.hash, "");
  const pool = new Pool({
    connectionString: target.toString(), max: 1, connectionTimeoutMillis: 2_000,
    options: "-c statement_timeout=5000 -c lock_timeout=3000",
  });
  const profiler = createProfiler("diagnostic");
  profiler.attachPool(pool);
  let acquired!: () => void;
  const ownerAcquired = new Promise<void>((resolve) => { acquired = resolve; });
  let release!: () => void;
  const ownerMayRelease = new Promise<void>((resolve) => { release = resolve; });
  const ownerSql = "SELECT 11::integer AS owner";
  const waiterSql = "SELECT 22::integer AS waiter";
  const owner = profiler.measure("owner", async () => {
    const client = await pool.connect();
    let ended = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('synthetic-metrics-integration',0))");
      acquired();
      await ownerMayRelease;
      assert.equal((await client.query<{ owner: number }>(ownerSql)).rows[0]?.owner, 11);
      await client.query("COMMIT");
      ended = true;
    } finally {
      if (!ended) {
        try { await client.query("ROLLBACK"); } catch { /* release destroys an unusable connection */ }
      }
      client.release(!ended);
    }
  });
  // If connection setup fails, do not wait for the readiness signal forever.
  void owner.catch(() => acquired());
  let waiter: Promise<unknown> | undefined;
  try {
    await ownerAcquired;
    waiter = profiler.measure("waiter", async () => {
      const result = await pool.query<{ waiter: number }>(waiterSql);
      assert.equal(result.rows[0]?.waiter, 22);
    });
    assert.equal(pool.waitingCount, 1, "Fixture must exercise the queued acquisition path");
    release();
    const completed = await Promise.allSettled([owner, waiter]);
    for (const result of completed) if (result.status === "rejected") throw result.reason;
    const samples = profiler.summary().samples;
    const ownerMetrics = samples.find((sample) => sample.label === "owner")!.diagnostics!;
    const waiterMetrics = samples.find((sample) => sample.label === "waiter")!.diagnostics!;
    assert.equal(ownerMetrics.driverQueries.count, 4);
    assert.equal(waiterMetrics.driverQueries.count, 1);
    assert.equal(ownerMetrics.queryShapes[queryShape(waiterSql)], undefined);
    assert.equal(waiterMetrics.queryShapes[queryShape(waiterSql)]?.count, 1);
    assert.equal(ownerMetrics.lockHeldTransactionMs.length, 1);
    assert.equal(ownerMetrics.uncertainLockIntervals.length, 0);
    assert.equal(ownerMetrics.connectionAcquisitionMs.length, 1);
    assert.equal(waiterMetrics.connectionAcquisitionMs.length, 1);
  } finally {
    release();
    await Promise.allSettled(waiter ? [owner, waiter] : [owner]);
    profiler.close();
    await pool.end();
  }
});
