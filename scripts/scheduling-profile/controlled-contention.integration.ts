import { Prisma } from "../../generated/prisma/index.js";
import assert from "node:assert/strict";
import { AsyncResource } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import test from "node:test";
import { runControlledContention, type ControlEvidence, type ControlledOrder } from "./controlled-contention";
import { createContentionFenceWitness } from "./contention-fence-witness";
import { assertIsolatedTestDatabase } from "../../src/test/database-guard";

const databaseUrl = process.env.DATABASE_URL;
assertIsolatedTestDatabase(databaseUrl);
const periodKey = "program:period";
const periodArgs = Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${periodKey}, 0))`;

/** Small real PG transactions exercise the same fences and a detached server
 * context; full app/HTTP/authority calls remain in the measured scenarios. No
 * tables or fixtures are created, truncated or modified by these lock tests. */
async function realPair(order: ControlledOrder, failure?: "first" | "second" | "timeout") {
  assert.ok(databaseUrl);
  const applicationName = `ctrl-test-${randomUUID().slice(0, 20)}`;
  const evidence: ControlEvidence = { order, applicationName, phase: "not-started", snapshots: [] };
  const witness = createContentionFenceWitness();
  const server = new AsyncResource("controlled-pg-detached-server");
  const finished: string[] = [];
  const firstRole = order === "bulk-before-acceptance" ? "bulk" : "acceptance";
  const operation = (role: "bulk" | "acceptance") => () => witness.run(role, () => {
    const handler = witness.bindCurrentContext(async () => {
      const client = new Client({ connectionString: databaseUrl, application_name: applicationName, connectionTimeoutMillis: 3000, query_timeout: 3000 });
      let open = false;
      try {
        await client.connect(); await client.query("BEGIN"); open = true;
        if (failure === "timeout") {
          await client.query("SELECT pg_sleep(0.4)");
        } else {
          await witness.observeExecuteRaw(periodArgs, () => client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["program:period"]));
          if (failure === "first" && role === firstRole) throw new Error("Synthetic first request failure");
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["planned-room-schedule"]);
          if (failure === "second" && role !== firstRole) throw new Error("Synthetic second request failure");
        }
        await client.query("COMMIT"); open = false;
        return role;
      } finally {
        try { if (open) await client.query("ROLLBACK"); }
        finally { await client.end(); finished.push(role); }
      }
    });
    return server.runInAsyncScope(handler);
  });
  let failed = false;
  let error: unknown;
  try {
    const result = await runControlledContention({ connectionString: databaseUrl, applicationName, order,
      bulk: operation("bulk"), acceptance: operation("acceptance"), evidence,
      ...(failure === "timeout" ? { proofTimeoutMs: 150 } : {}),
    });
    assert.deepEqual(result, { bulk: "bulk", acceptance: "acceptance" });
  } catch (cause) { failed = true; error = cause; }
  finally {
    server.emitDestroy();
    const checker = new Client({ connectionString: databaseUrl, application_name: `${applicationName}-check`, connectionTimeoutMillis: 3000, query_timeout: 3000 });
    try {
      await checker.connect(); await checker.query("BEGIN");
      const locks = await checker.query<{ period: boolean; room: boolean }>(`SELECT
        pg_try_advisory_xact_lock(hashtextextended('program:period',0)) AS period,
        pg_try_advisory_xact_lock(hashtextextended('planned-room-schedule',0)) AS room`);
      assert.deepEqual(locks.rows[0], { period: true, room: true }, "A controller/request lock survived draining");
      const sessions = await checker.query<{ count: number }>(`SELECT count(*)::int FROM pg_stat_activity
        WHERE datname=current_database() AND application_name=ANY($1::text[])`, [[applicationName, `${applicationName}-hold`, `${applicationName}-observe`]]);
      assert.equal(sessions.rows[0]?.count, 0, "A task-owned connection survived draining");
      await checker.query("ROLLBACK");
    } finally { await checker.end(); }
  }
  return { evidence, witness: witness.snapshot(), finished, failed, error };
}

for (const order of ["bulk-before-acceptance", "acceptance-before-bulk"] as const) {
  void test(`real PG ${order} proves blocking and attributes actual fence completion across detached contexts`, { timeout: 20000 }, async () => {
    const result = await realPair(order);
    assert.equal(result.failed, false, result.error instanceof Error ? result.error.message : "Unexpected controller failure");
    assert.equal(result.evidence.completed, true); assert.equal(result.evidence.phase, "completed");
    assert.equal(result.finished.length, 2);
    const { contentionFenceOrder } = await import("./contention-fence-witness");
    assert.equal(contentionFenceOrder(result.witness), order);
    const last = result.evidence.snapshots.at(-1)!;
    assert.equal(last.rows.length, 4);
    assert.equal(last.phase, "second-request");
    for (const value of last.rows) {
      assert.deepEqual({ classid: value.classid, objid: value.objid, objsubid: value.objsubid }, result.evidence.lockKeys![value.key]);
      assert.equal(value.applicationName, value.pid === result.evidence.holderPid ? `${result.evidence.applicationName}-hold` : result.evidence.applicationName);
    }
  });
}
void test("real PG first-request failure releases the holder before draining", { timeout: 20000 }, async () => {
  const result = await realPair("bulk-before-acceptance", "first");
  assert.equal(result.failed, true); assert.equal(result.evidence.completed, false);
  assert.deepEqual(result.finished, ["bulk"]);
  assert.equal(result.evidence.requestErrors?.length, 1);
});
void test("real PG second-request failure drains both after a genuine successful chain proof", { timeout: 20000 }, async () => {
  const result = await realPair("acceptance-before-bulk", "second");
  assert.equal(result.failed, true); assert.equal(result.evidence.completed, false);
  assert.equal(result.finished.length, 2); assert.equal(result.evidence.snapshots.at(-1)?.rows.length, 4);
  assert.equal(result.evidence.requestErrors?.length, 1);
});
void test("real PG observation timeout drains the unfinished first request and leaves no owned session", { timeout: 20000 }, async () => {
  const result = await realPair("bulk-before-acceptance", "timeout");
  assert.equal(result.failed, true); assert.equal(result.evidence.completed, false);
  assert.equal(result.evidence.phase, "failed"); assert.deepEqual(result.finished, ["bulk"]);
  assert.ok(result.error instanceof Error && result.error.message.includes("proof deadline"));
});
