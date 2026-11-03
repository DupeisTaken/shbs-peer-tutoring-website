import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";

export type ControlledOrder = "bulk-before-acceptance" | "acceptance-before-bulk";
export type LockRow = {
  pid: number; key: "period" | "room"; granted: boolean; mode: string;
  classid: string; objid: string; objsubid: number; blockers: number[];
  xactStart: Date; observedAt: Date; applicationName: string;
};
type LockTag = { classid: string; objid: string; objsubid: 1 };
export type ControlEvidence = {
  order: ControlledOrder; applicationName: string; holderPid?: number;
  firstPid?: number; secondPid?: number; holdMs?: number;
  phase: string; snapshots: { phase: string; elapsedMs: number; rows: LockRow[] }[];
  lockKeys?: Record<"period" | "room", LockTag>; proofTimeoutMs?: number;
  completed?: boolean; requestErrors?: string[]; cleanupErrors?: string[];
};

/** The SQL below has already matched exact server-derived bigint advisory tags.
 * No queue-arrival/FIFO assumption or guessed request connection is accepted. */
export function inspectControlledChain(rows: readonly LockRow[], holder: number, firstPid?: number) {
  const held = (pid: number, key: LockRow["key"]) => rows.some((row) => row.pid === pid && row.key === key && row.granted && row.mode === "ExclusiveLock");
  assert.ok(held(holder, "room"), "Controller no longer owns planned-room");
  const leaders = rows.filter((row) => row.pid !== holder && row.key === "room" && !row.granted &&
    row.mode === "ExclusiveLock" && row.blockers.includes(holder) && held(row.pid, "period"));
  assert.ok(leaders.length <= 1, "Ambiguous first request backend");
  const leader = leaders[0];
  if (!leader) return null;
  if (firstPid !== undefined) assert.equal(leader.pid, firstPid, "First request backend changed");
  const followers = rows.filter((row) => row.pid !== holder && row.pid !== leader.pid && row.key === "period" &&
    !row.granted && row.mode === "ExclusiveLock" && row.blockers.includes(leader.pid));
  assert.ok(followers.length <= 1, "Ambiguous second request backend");
  const follower = followers[0];
  if (follower) assert.ok(follower.xactStart.getTime() - leader.xactStart.getTime() >= 3,
    "Request backend transaction starts do not meet the controlled three-millisecond separation");
  return { leader, follower };
}

export async function runControlledContention<Bulk, Acceptance>(options: {
  connectionString: string; applicationName: string; order: ControlledOrder;
  bulk: () => Promise<Bulk>; acceptance: () => Promise<Acceptance>;
  evidence: ControlEvidence;
  /** Tests may use a smaller deadline; production retains the five-second cap. */
  proofTimeoutMs?: number;
}): Promise<{ bulk: Bulk; acceptance: Acceptance }> {
  const target = new URL(options.connectionString);
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
    /^\/[a-zA-Z0-9_-]+_test$/.test(target.pathname) && !target.hash &&
    [...target.searchParams].every(([name, value]) => name === "options" && value === "-c timezone=UTC"),
  "Controller requires an owned isolated loopback test database; the main harness additionally pins port/database");
  assert.match(options.applicationName, /^[A-Za-z0-9:_-]{1,54}$/, "Use a unique bounded request-pool application name");
  const proofTimeoutMs = options.proofTimeoutMs ?? 5000;
  assert.ok(Number.isInteger(proofTimeoutMs) && proofTimeoutMs >= 50 && proofTimeoutMs <= 5000);
  const describeError = (error: unknown) => {
    let value = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : "Non-Error request failure";
    const secrets = [options.connectionString, target.toString(), target.username, target.password];
    for (const encoded of [target.username, target.password]) {
      try { secrets.push(decodeURIComponent(encoded)); } catch { /* Full URI remains covered. */ }
    }
    for (const secret of secrets.filter(Boolean).sort((left, right) => right.length - left.length)) value = value.replaceAll(secret, "[redacted]");
    return value.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted-database-url]").slice(0, 3000);
  };
  const holder = new Client({ connectionString: options.connectionString, application_name: `${options.applicationName}-hold`, connectionTimeoutMillis: 3000, query_timeout: 3000 });
  const observer = new Client({ connectionString: options.connectionString, application_name: `${options.applicationName}-observe`, connectionTimeoutMillis: 3000, query_timeout: 3000 });
  // pg emits an error if idle_in_transaction_session_timeout disconnects the
  // holder. Keep its bounded diagnostic; never let a pool-independent error
  // become an unhandled process exception before request draining/receipt save.
  const asynchronousErrors: Error[] = [];
  holder.on("error", (error: Error) => asynchronousErrors.push(error));
  observer.on("error", (error: Error) => asynchronousErrors.push(error));
  let holderOpen = false;
  let holdStarted = 0;
  let first: Promise<Bulk | Acceptance> | undefined;
  let second: Promise<Bulk | Acceptance> | undefined;
  let firstFinished = false;
  let secondFinished = false;
  let output: { bulk: Bulk; acceptance: Acceptance } | undefined;
  let failure: unknown;
  let failed = false;
  const evidence = options.evidence;
  assert.equal(evidence.order, options.order);
  assert.equal(evidence.applicationName, options.applicationName);
  evidence.completed = false;
  evidence.proofTimeoutMs = proofTimeoutMs;
  const observe = async () => {
    const result = await observer.query<LockRow>(`
      WITH keys(key,value) AS (VALUES
        ('period',hashtextextended('program:period',0)),
        ('room',hashtextextended('planned-room-schedule',0)))
      SELECT l.pid,k.key,l.granted,l.mode,l.classid::text,l.objid::text,l.objsubid,
        pg_blocking_pids(l.pid) AS blockers,a.xact_start AS "xactStart",clock_timestamp() AS "observedAt",
        a.application_name AS "applicationName"
      FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid JOIN keys k
        ON l.classid::bigint=((k.value >> 32) & 4294967295::bigint)
        AND l.objid::bigint=(k.value & 4294967295::bigint)
      WHERE l.locktype='advisory' AND l.objsubid=1
        AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND (l.pid=$1 OR (a.datname=current_database() AND a.application_name=$2))
      ORDER BY l.pid,k.key,l.granted LIMIT 65`, [evidence.holderPid, options.applicationName]);
    assert.ok(result.rows.length <= 64, "Controller lock observation exceeded its row bound");
    assert.ok(evidence.snapshots.length < 256, "Controller observation history exceeded its bound");
    evidence.snapshots.push({ phase: evidence.phase, elapsedMs: performance.now() - holdStarted, rows: result.rows });
    return inspectControlledChain(result.rows, evidence.holderPid!, evidence.firstPid);
  };
  try {
    await holder.connect();
    await observer.connect();
    const tags = await observer.query<LockTag & { key: "period" | "room" }>(`
      WITH keys(key,value) AS (VALUES ('period',hashtextextended('program:period',0)),
        ('room',hashtextextended('planned-room-schedule',0)))
      SELECT key,((value >> 32) & 4294967295::bigint)::text AS classid,
        (value & 4294967295::bigint)::text AS objid,1::int AS objsubid FROM keys ORDER BY key`);
    assert.equal(tags.rows.length, 2);
    const period = tags.rows.find((row) => row.key === "period"), room = tags.rows.find((row) => row.key === "room");
    assert.ok(period && room);
    evidence.lockKeys = { period: { classid: period.classid, objid: period.objid, objsubid: 1 }, room: { classid: room.classid, objid: room.objid, objsubid: 1 } };
    await holder.query("BEGIN"); holderOpen = true;
    await holder.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('planned-room-schedule',0))");
    evidence.holderPid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    holdStarted = performance.now();
    const deadline = holdStarted + proofTimeoutMs;
    evidence.phase = "first-request";
    first = options.order === "bulk-before-acceptance" ? options.bulk() : options.acceptance();
    // Install rejection handlers immediately, before any observation awaits.
    void first.then(() => { firstFinished = true; }, () => { firstFinished = true; });
    while (true) {
      assert.ok(!asynchronousErrors.length, "Controller connection failed");
      assert.ok(!firstFinished, "First request finished before its real blocking proof");
      assert.ok(performance.now() < deadline, "Controlled-chain proof deadline exceeded");
      const chain = await observe();
      assert.ok(performance.now() < deadline, "Controlled-chain proof deadline exceeded");
      if (chain && chain.leader.observedAt.getTime() - chain.leader.xactStart.getTime() >= 3) {
        evidence.firstPid = chain.leader.pid;
        break;
      }
      await delay(20);
    }
    evidence.phase = "second-request";
    second = options.order === "bulk-before-acceptance" ? options.acceptance() : options.bulk();
    void second.then(() => { secondFinished = true; }, () => { secondFinished = true; });
    while (true) {
      assert.ok(!asynchronousErrors.length, "Controller connection failed");
      assert.ok(!firstFinished && !secondFinished, "Request finished before complete blocking proof");
      assert.ok(performance.now() < deadline, "Controlled-chain proof deadline exceeded");
      const chain = await observe();
      assert.ok(performance.now() < deadline, "Controlled-chain proof deadline exceeded");
      if (chain?.follower) { evidence.secondPid = chain.follower.pid; break; }
      await delay(20);
    }
    evidence.phase = "chain-proved";
    await holder.query("COMMIT"); holderOpen = false;
    evidence.holdMs = performance.now() - holdStarted;
    assert.ok(evidence.holdMs <= 10000, "Controller hold exceeded its ten-second bound");
    evidence.phase = "draining";
    const settled = await Promise.allSettled([first, second]);
    const errors = settled.filter((result) => result.status === "rejected");
    if (errors.length) {
      evidence.requestErrors = errors.map((result) => describeError(result.reason));
      throw new AggregateError(errors.map((result) => result.reason as unknown), "Controlled requests failed");
    }
    const left = settled[0], right = settled[1];
    assert.ok(left.status === "fulfilled" && right.status === "fulfilled");
    output = options.order === "bulk-before-acceptance"
      ? { bulk: left.value as Bulk, acceptance: right.value as Acceptance }
      : { bulk: right.value as Bulk, acceptance: left.value as Acceptance };
  } catch (error) { failed = true; failure = error; }
  finally {
    const cleanup: Error[] = [];
    // Release/close the controller FIRST, even if ROLLBACK fails, then drain.
    if (holderOpen) try { await holder.query("ROLLBACK"); } catch (error) { cleanup.push(error instanceof Error ? error : new Error("Holder rollback failed")); }
    // pg.Client.end is a no-op before connection, and also closes partial or
    // failed connection attempts; invoke it even when connect() rejected.
    try { await holder.end(); } catch (error) { cleanup.push(error instanceof Error ? error : new Error("Holder close failed")); }
    if (holdStarted && evidence.holdMs === undefined) evidence.holdMs = performance.now() - holdStarted;
    try { await observer.end(); } catch (error) { cleanup.push(error instanceof Error ? error : new Error("Observer close failed")); }
    const drained = await Promise.allSettled([first, second].filter((promise): promise is Promise<Bulk | Acceptance> => promise !== undefined));
    evidence.requestErrors ??= drained.filter((result) => result.status === "rejected").map((result) => describeError(result.reason));
    cleanup.push(...asynchronousErrors);
    if (cleanup.length) {
      evidence.cleanupErrors = cleanup.map(describeError).slice(0, 16);
      failure = new AggregateError([...(failed ? [failure] : []), ...cleanup], "Controller cleanup failed");
      failed = true;
    }
  }
  if (failed) { evidence.phase = "failed"; throw failure; }
  assert.ok(output);
  evidence.completed = true;
  evidence.phase = "completed";
  return output;
}
