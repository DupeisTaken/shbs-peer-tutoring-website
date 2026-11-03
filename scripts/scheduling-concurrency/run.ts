import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import os from "node:os";
import { isDeepStrictEqual } from "node:util";
import type { HttpHarness } from "../scheduling-profile/http";
import type { Session } from "next-auth";
import {
  resetFixture,
  seedFixture,
  fixtureId,
  addLateRootWitness,
  assertRecoveryWitnesses,
} from "../scheduling-profile/fixtures";
import { captureParity } from "../scheduling-profile/parity";
import { createProfiler } from "../scheduling-profile/metrics";
import {
  validateClockAdmissionBudget,
  validateReportClocks,
} from "../scheduling-profile/clock-admission.mjs";
import { harnessHashes } from "./manifest.mjs";
import { createWave } from "./wave";
import {
  CONCURRENT_CASES,
  runConcurrentScenario,
  type ConcurrentCase,
} from "./concurrent-scenarios";
import type { ReceiptInput } from "../scheduling-profile/scenarios";

const env = process.env;
// Recovery stores UTC database timestamps without an offset in some JSON rows.
// Keep their interpretation identical in Node across both application revisions.
assert.equal(
  new Date("2026-01-01T00:00:00").getTime(),
  Date.parse("2026-01-01T00:00:00Z"),
  "Run the evidence process in UTC",
);

const local = process.argv.length === 3 && process.argv[2] === "--local-smoke";
assert.ok(
  local ||
    (process.argv.length === 2 &&
      process.platform === "linux" &&
      process.version.startsWith("v22.")),
  "Require supported Node 22 Linux for evidence",
);
const url = new URL(env.DATABASE_URL!);
assert.ok(
  ["postgres:", "postgresql:"].includes(url.protocol) &&
    url.hostname === "127.0.0.1" &&
    url.port === "55439" &&
    url.pathname === "/shbs_performance_test" &&
    !url.search &&
    !url.hash,
);
assert.equal(env.SUPPLEMENT_OWNED_DB, "disposable-synthetic-only");
Object.assign(env, {
  NODE_ENV: "test",
  TRPC_DEV_DELAY: "false",
  AUTH_SECRET: "synthetic-concurrency-profile-only",
});
for (const key of Object.keys(env))
  if (/^(SMTP_|EMAIL_FROM|EMAIL_SECURITY_FROM)/.test(key)) delete env[key];
const name = env.PROFILE_SCENARIO as ConcurrentCase;
assert.ok(Object.hasOwn(CONCURRENT_CASES, name));
const mode = env.PROFILE_MODE;
assert.ok(mode === "latency" || mode === "diagnostic");
const idx = Number(env.PROFILE_PARTITION_INDEX);
const n = local ? 1 : mode === "diagnostic" ? 3 : 4;
const partition = {
  index: idx,
  count: local || mode === "diagnostic" ? 1 : 5,
  start: idx * n,
  end: (idx + 1) * n,
  totalSamples: local ? 1 : mode === "diagnostic" ? 3 : 20,
  warmupRounds: 1,
};
assert.ok(Number.isInteger(idx) && idx >= 0 && idx < partition.count);
const root = process.cwd();
const output = resolve(env.PROFILE_OUTPUT!);
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", cwd: root }).trim();
const sha = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");
const startedAt = new Date().toISOString();
const anchor = env.PROFILE_ANCHOR!;
const clockAdmission = validateClockAdmissionBudget({
  anchor,
  startedAt,
  timeoutMs: 150_000,
});
const sourceHashes = Object.fromEntries(
  git(
    "ls-files",
    "src",
    "prisma",
    "package.json",
    "package-lock.json",
    "Dockerfile",
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => [path, sha(readFileSync(path))]),
);
const migrationFiles = readdirSync("prisma/migrations", { withFileTypes: true })
  .filter((v) => v.isDirectory())
  .map((v) => ({
    name: v.name,
    sha256: sha(
      readFileSync(resolve("prisma/migrations", v.name, "migration.sql")),
    ),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
const revision = git("rev-parse", "HEAD");
if (!local) assert.equal(revision, env.PROFILE_APP_SHA);
type SavedRound = {
  round: number;
  after: { parity: Awaited<ReturnType<typeof captureParity>>; digest: string };
};
const comparisonPath = env.PROFILE_BASE_REPORT;
type Previous = {
  status: string;
  case: string;
  mode: string;
  rounds: SavedRound[];
};
const previous = comparisonPath
  ? (JSON.parse(readFileSync(comparisonPath, "utf8")) as Previous)
  : undefined;
if (previous)
  assert.ok(
    previous.status === "PASS" &&
      previous.case === name &&
      previous.mode === mode &&
      previous.rounds.length === n,
  );
const rounds: SavedRound[] = [];
const profiler = createProfiler(mode);
const report: Record<string, unknown> = {
  schemaVersion: 1,
  kind: "scheduling-concurrency-supplement",
  status: "RUNNING",
  case: name,
  mode,
  revision,
  partition,
  startedAt,
  fixture: {
    anchor,
    clockAdmission,
    pairings: 100,
    rooms: 100,
    timeZone: "Asia/Shanghai",
  },
  profileRunner: {
    id: env.PROFILE_PARTITION_RUNNER_ID,
    name: env.RUNNER_NAME,
    os: env.RUNNER_OS,
    arch: env.RUNNER_ARCH,
  },
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
  },
  nodeImage: env.PROFILE_NODE_IMAGE,
  harnessHashes: harnessHashes(root),
  sourceHashes,
  migrationFiles,
  comparison: local
    ? null
    : JSON.parse(readFileSync(env.PROFILE_COMPARISON!, "utf8")),
  rounds,
};
function save() {
  writeFileSync(output, JSON.stringify(report) + "\n");
}
const watchdog = setTimeout(() => {
  report.status = "TIMEOUT";
  save();
  process.exit(124);
}, 150_000);
const { Pool } = await import("pg");
const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../../generated/prisma/index.js");
const { utcDatabaseUrl } = await import("../../src/server/database-url");
const pgOptions = existsSync("src/server/database-options.ts")
  ? (await import("../../src/server/database-options")).schedulingPgOptions
  : undefined;
const pool = new Pool({
  connectionString: utcDatabaseUrl(url.toString()),
  max: 6,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 0,
});
if (mode === "diagnostic") profiler.attachPool(pool);
const raw = new PrismaClient({
  adapter: new PrismaPg(pool, { ...pgOptions, disposeExternalPool: false }),
  log: mode === "diagnostic" ? [{ level: "query", emit: "event" }] : [],
});
if (mode === "diagnostic") raw.$on("query", (e) => profiler.observeQuery(e));
let wave: ReturnType<typeof createWave> | undefined;
const db = raw.$extends({
  query: {
    $executeRaw({ args, query }) {
      return wave
        ? wave.observe("execute", args, () => query(args))
        : query(args);
    },
    $queryRaw({ args, query }) {
      return wave
        ? wave.observe("query", args, () => query(args))
        : query(args);
    },
  },
}) as unknown as typeof raw;
(globalThis as typeof globalThis & { prisma?: typeof db }).prisma = db;
const lock = await pool.connect();
const dbClock = async () =>
  (
    await lock.query<{ now: Date }>("SELECT clock_timestamp() AS now")
  ).rows[0]!.now.toISOString();
let http: HttpHarness | undefined;
try {
  const admission = await lock.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtextextended('shbs-scheduling-performance-benchmark',0)) AS acquired",
  );
  assert.equal(
    admission.rows[0]?.acquired,
    true,
    "Another benchmark owns this database",
  );
  const databaseStartedAt = await dbClock();
  report.postgresVersion = (await lock.query("SHOW server_version")).rows;
  report.migrations = (
    await lock.query(
      'SELECT migration_name AS name, checksum AS sha256 FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
    )
  ).rows;
  if (!local) assert.deepEqual(report.migrations, migrationFiles);
  const { startHttpHarness } = await import("../scheduling-profile/http");
  http = await startHttpHarness({
    db,
    bindCurrentContext: (fn) => {
      const bound = profiler.bindCurrentContext(fn);
      return wave ? wave.bind(bound) : bound;
    },
  });
  report.httpUnauthorized = await http.verifyUnauthorized();
  for (const round of [
    ...(local ? [] : [-1]),
    ...Array.from({ length: n }, (_, i) => partition.start + i),
  ]) {
    await resetFixture(db);
    const fixture = await seedFixture(db, new Date(anchor));
    const receiptInputs: ReceiptInput[] = [];
    const caller = (id: string) => {
      const pair = fixture.pairs.find((p) => p.tutorUserId === id);
      const session: Session = {
        user: { id },
        role: fixture.adminId === id ? "ADMIN" : pair ? "TUTOR" : "STUDENT",
        tutorId: pair?.tutorId ?? null,
        expires: "2099-01-01T00:00:00Z",
      };
      return http!.caller(id, session);
    };
    const before = new Date().toISOString();
    wave = createWave(profiler);
    const result = await runConcurrentScenario(name, {
      db,
      fixture,
      caller,
      receiptInputs,
      runWave: wave.runWave,
    });
    const evidence = wave.receipt();
    wave = undefined;
    await assertRecoveryWitnesses(db, fixture);
    await addLateRootWitness(db, fixture);
    const parity = await captureParity(db, {
      receiptInputs,
      seededPairingIds: [
        ...fixture.pairs.map((x) => x.id),
        fixtureId("prior-pairing"),
      ],
      operationWindows: [
        {
          label: "concurrent:" + name,
          before,
          after: new Date().toISOString(),
        },
      ],
      procedureResults: [
        ...evidence.calls.map((c, i) => ({
          label: c.operation,
          result: result.results[i],
        })),
        { label: "scenario:" + name, result },
      ],
    });
    if (round >= 0) {
      const savedRound = {
        round,
        ...evidence,
        output: result,
        after: { parity, digest: sha(JSON.stringify(parity)) },
      };
      rounds.push(savedRound);
      save();
      // Keep both full artifacts when a real race or business result diverges.
      const first = rounds[0]!;
      assert.equal(
        savedRound.after.digest,
        first.after.digest,
        "Repeated supplementary fixture outcome changed",
      );
      if (previous) {
        const base = previous.rounds.find((row) => row.round === round);
        assert.ok(
          base && isDeepStrictEqual(base.after.parity, parity),
          "Complete concurrent after-state or return differs between revisions",
        );
        assert.equal(savedRound.after.digest, base.after.digest);
      }
    }
  }
  report.databaseClock = {
    startedAt: databaseStartedAt,
    finishedAt: await dbClock(),
  };
  report.http = http.summary();
  report.finishedAt = new Date().toISOString();
  validateReportClocks(report);
  report.status = local ? "LOCAL_SMOKE" : "PASS";
} catch (error) {
  report.status = "FAIL";
  report.error =
    error instanceof Error ? error.message.slice(0, 1400) : "Unknown failure";
  console.error(report.error);
  process.exitCode = 1;
} finally {
  try {
    if (http) await http.close();
    profiler.close();
    lock.release();
    await raw.$disconnect();
    await pool.end();
    report.finishedAt = new Date().toISOString();
    if (report.status === "PASS" || report.status === "LOCAL_SMOKE") {
      validateReportClocks(report);
      assert.ok(
        Date.now() - Date.parse(startedAt) < 150_000,
        "Command exceeded its budget during cleanup",
      );
    }
  } catch (error) {
    report.status = "FAIL";
    report.cleanupError =
      error instanceof Error ? error.message.slice(0, 500) : "Cleanup failed";
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    save();
  }
}
