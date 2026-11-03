/**
 * Synthetic destructive profiling, explicitly owned disposable PostgreSQL ONLY.
 * No dotenv, migrations, dependency generation, workers, SMTP or browser.
 * Run the exact same harness bytes in baseline/candidate checkouts on Node 22 Linux:
 * node --import tsx --import ./scripts/scheduling-profile/register-server-runtime.mjs \
 *   scripts/profile-scheduling-requests.ts \
 *   --scenario negotiation --mode latency --anchor <shared ISO instant> \
 *   --samples 40 --output outputs/scheduling-profile/after.json --compare <before.json>
 * Diagnostic runs have separate artifacts; never compare their timings to latency runs.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { Session } from "next-auth";
import type { PoolClient } from "pg";
import { createProfiler, type ProfileMode } from "./scheduling-profile/metrics";
import { addLateRootWitness, assertRecoveryWitnesses, fixtureId, resetFixture, seedFixture } from "./scheduling-profile/fixtures";
import { runScenario, scenarioNames, type ReceiptInput, type ScenarioName } from "./scheduling-profile/scenarios";
import { captureParity, compareParity, type ParityOptions, type ParitySnapshot } from "./scheduling-profile/parity";
import type { HttpHarness } from "./scheduling-profile/http";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.equal(realpathSync(process.cwd()), realpathSync(root), "Run inside this harness's checkout.");
const flags = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]!;
  const value = process.argv[index + 1];
  assert.ok(["--scenario", "--mode", "--transport", "--timeout-ms", "--anchor", "--samples", "--output", "--compare"].includes(key), `Unknown option ${key}`);
  assert.ok(value && !value.startsWith("--") && !flags.has(key), `Missing/repeated option ${key}`);
  flags.set(key, value);
}
assert.ok(flags.has("--output") && flags.has("--anchor") && flags.has("--scenario"), "Required: --scenario, --anchor, --output.");
const mode = flags.get("--mode") ?? "latency";
assert.ok(mode === "latency" || mode === "diagnostic");
const transport = flags.get("--transport") ?? "procedure";
assert.ok(transport === "http" || transport === "procedure" || transport === "domain");
const timeoutMs = Number(flags.get("--timeout-ms") ?? "150000");
assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 30_000 && timeoutMs <= 300_000, "Command timeout must be 30000–300000 ms.");
if (mode === "latency") assert.ok(![...process.execArgv, process.env.NODE_OPTIONS ?? ""].some((value) => /--(?:cpu-prof|heap-prof|inspect|prof(?:\s|$|=))/.test(value)), "Latency comparisons cannot run under a profiler/inspector.");
assert.ok(process.platform === "linux" && process.versions.node.split(".")[0] === "22", "Representative receipts require Node 22 on Linux.");
assert.ok(!/--conditions(?:=|\s+)(?:[^\s]*,)?react-server\b/.test([...process.execArgv, process.env.NODE_OPTIONS ?? ""].join(" ")), "The API harness requires normal React; remove the global react-server condition.");
assert.equal((globalThis as unknown as Record<symbol, unknown>)[Symbol.for("shbs.scheduling-profile.server-runtime")], 1, "Preload scripts/scheduling-profile/register-server-runtime.mjs after tsx.");
const requested = flags.get("--scenario")!;
assert.ok(requested === "all" || scenarioNames.includes(requested as ScenarioName));
if (transport === "domain") assert.ok(requested === "cold" || requested === "sunday" || requested === "backlog", "Domain-only transport supports cold/Sunday agendas and explicit backlog diagnostics.");
// The diagnostic-only stress case is an explicit separate command, preserving
// the existing ordinary all-scenarios workload and its latency sample contract.
const scenarios = requested === "all" ? scenarioNames.filter((name) => name !== "backlog") : [requested as ScenarioName];
if (requested === "backlog") assert.equal(mode, "diagnostic", "Backlog is diagnostic-only; it cannot establish latency percentiles.");
const anchor = new Date(flags.get("--anchor")!);
assert.ok(Number.isFinite(anchor.getTime()), "Invalid anchor.");
// No fake clock: the shared anchor must remain close to actual handlers' clock.
assert.ok(anchor.getTime() <= Date.now() && Date.now() - anchor.getTime() < 12 * 3_600_000, "Use the same fresh past anchor for both revisions (within 12 hours).");
const samples = flags.has("--samples") ? Number(flags.get("--samples")) : requested === "backlog" ? 1 : requested === "cold" || requested === "sunday" ? 20 : 40;
assert.ok(Number.isInteger(samples) && (requested === "backlog" ? samples >= 1 && samples <= 3 : mode === "diagnostic" ? samples >= 1 && samples <= 10 : samples >= 20 && samples <= 100), "Latency uses 20–100 samples, ordinary diagnostics 1–10, and explicit backlog diagnostics 1–3.");
assert.ok(process.env.DATABASE_URL, "Provide DATABASE_URL explicitly; no .env is loaded.");
const target = new URL(process.env.DATABASE_URL);
assert.ok(["postgres:", "postgresql:"].includes(target.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.port === "55439" && target.pathname === "/shbs_performance_test" && !target.search && !target.hash, "Refusing reset: require explicit loopback:55439/shbs_performance_test without query overrides.");
Object.assign(process.env, { NODE_ENV: "test", AUTH_SECRET: "synthetic-profile-secret-for-owned-disposable-database", TRPC_DEV_DELAY: "false" });
for (const name of Object.keys(process.env)) if (/^(?:SMTP_|EMAIL_FROM(?:_|$)|EMAIL_SECURITY_FROM$|EMAIL_PROGRAM_FROM$)/.test(name)) delete process.env[name];

const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const harnessPaths = ["scripts/profile-scheduling-requests.ts", "scripts/scheduling-profile/fixtures.ts", "scripts/scheduling-profile/scenarios.ts", "scripts/scheduling-profile/metrics.ts", "scripts/scheduling-profile/parity.ts", "scripts/scheduling-profile/http.ts", "scripts/scheduling-profile/register-server-runtime.mjs", "scripts/scheduling-profile/server-runtime-hooks.mjs"];
const harnessHashes = Object.fromEntries(harnessPaths.map((path) => [path, hash(readFileSync(resolve(root, path)))]));
const sourcePaths = git("ls-files", "src", "prisma", "package.json", "package-lock.json", "Dockerfile").trim().split(/\r?\n/).filter(Boolean);
const sourceHashes = Object.fromEntries(sourcePaths.map((path) => [path, hash(readFileSync(resolve(root, path)))]));
const migrations = readdirSync(resolve(root, "prisma/migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
  const bytes = readFileSync(resolve(root, "prisma/migrations", entry.name, "migration.sql"));
  const lf = bytes.toString("utf8").replaceAll("\r\n", "\n");
  return { name: entry.name, sha256: hash(bytes), lfSha256: hash(lf), crlfSha256: hash(lf.replaceAll("\n", "\r\n")) };
}).sort((a, b) => a.name.localeCompare(b.name));
type ScenarioReceipt = { scenario: ScenarioName; round: number; digest: string; parity?: ParitySnapshot; output: unknown; receiptInputs: ReceiptInput[]; pairingCreations: NonNullable<ParityOptions["pairingCreations"]>; operationWindows: NonNullable<ParityOptions["operationWindows"]>; parityWindow: NonNullable<ParityOptions["operationWindows"]> };
type Report = {
  status: "RUNNING" | "PASS" | "FAIL" | "TIMEOUT";
  schemaVersion: number;
  mode: ProfileMode;
  fixture: unknown;
  harnessHashes: typeof harnessHashes;
  runtime: unknown;
  migrations: unknown;
  receipts: ScenarioReceipt[];
  [key: string]: unknown;
};
const report: Report = {
  schemaVersion: 2, status: "RUNNING", mode, transport, timeoutMs, startedAt: new Date().toISOString(),
  revision: git("rev-parse", "HEAD").trim(), workingTree: git("status", "--short"), trackedDiffSha256: hash(git("diff", "--binary", "HEAD")),
  harnessHashes, sourceHashes, migrationFiles: migrations,
  runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
  fixture: { anchor: anchor.toISOString(), scenarios, transport, samples, currentPairings: 100, rooms: 100, explicitSubjectGroups: 1, calendarOverrides: 2, continuationAssignments: 2, continuationReceipts: 2, ordinaryRecoveryRoots: 5, lateRootWitness: true, ...(requested === "backlog" ? { backlogRequests: 205, failingNotices: 60, hotSourceUpdates: 1200, warmupRounds: 0 } : {}) },
  database: { host: target.hostname, port: 55439, name: "shbs_performance_test", poolMax: 6 },
  methodology: {
    procedure: "Real authenticated synthetic createCaller context and real middleware/Prisma/transactions; excludes HTTP transport and authentication session exchange.",
    http: "When selected: actual loopback HTTP requests via @trpc/client httpLink + superjson and @trpc/server standalone adapter around the unchanged production appRouter. Task-local opaque session cookies stand in for authentication exchange. No Next ingress/proxy, Auth.js exchange, TLS or production network is measured. SQL diagnostics are bound to the incoming request's measured client context.",
    runtimeConditions: "Normal React/Next/Auth.js resolution. A harness-only Node module hook adds react-server solely when resolving the exact server-only marker package, selecting its own published empty.js entry. No authentication/application module is mocked or redirected.",
    domain: "Sunday and exact deadline cases pass an explicit domain clock; production Date is never replaced. Labelled independently from procedure timings.",
    cold: "Empty planning tables and normal process/database caches, not a cold OS/PostgreSQL restart.",
    samples: "Ordinary scenarios use one discarded warmup; explicit backlog diagnostics use none. Fresh fixture each measured round. Seed/reset/snapshots/assertions excluded from timed operations. Ordinary nearest-rank empirical p50/p95 are not a production percentile guarantee; backlog request latency percentiles are not reported.",
    diagnostic: "Separate run only. Driver query and lock-statement elapsed includes client/transport overhead. Acquisition-to-commit interval is a transaction-held interval. No exact PostgreSQL wait accounting is claimed.",
    witness: "Populated continuation is persisted synthetic pre-existing enrollment. Late-root sequential Prisma witness runs outside timing, never the rejected combined-write SQL.",
    cleanWarm: "Ordinary/Sunday steady-clean labels require four fixed common empty-request agenda preparations, unchanged complete domain/audit/recovery snapshots, and passively verified current candidate metadata before/after timing. Setup outputs remain in semantic parity; setup elapsed and readiness counts are separate evidence. Uncertified preparation fails the run without an adaptive drain or timeout extension. Post-proposal and second-read labels do not claim steady state.",
    backlog: "Explicit diagnostic-only command, 1–3 rounds without warmup, excluded from ordinary all. 205 retained split negotiations exercise original 200-row ordered selection and rotation; 60 scoped notice failures exercise more than 50 retries, then recover. 1200 real room name A→B→A updates exercise bounded invalidation acknowledgement. Actual ordered updatedAt writes and fixed-clock/persistence-clock relations are witnessed before normalization; raw rows/windows remain in separate evidence. No request latency percentiles or production-load claims. Native old-schema control remains cold-only; backlog requires the disclosed shared metadata schema.",
    absent: [...(transport === "http" ? [] : ["Actual HTTP timings"]), "Authentication exchange", "Next ingress/proxy", "SMTP/network delivery", "Production host evidence"],
  },
  migrations: [], receipts: [],
};
const destination = resolve(root, flags.get("--output")!);
mkdirSync(dirname(destination), { recursive: true });
const profiler = createProfiler(mode);
const started = performance.now();
const preparationEvidence: { scenario: ScenarioName; round: number; stage: string; evidence: unknown }[] = [];
const setupMeasurements: { scenario: ScenarioName; round: number; label: string; elapsedMs: number }[] = [];
report.preparationEvidence = preparationEvidence;
report.setupMeasurements = setupMeasurements;
function save() {
  const metrics = profiler.summary();
  report.metrics = requested === "backlog" ? {
    ...metrics,
    interpretation: { ...metrics.interpretation, latency: "Backlog is diagnostic-only. Request latency percentiles are intentionally not reported; raw completed and censored elapsed samples remain available. These instrumented stress results do not establish latency gains or production percentiles." },
    operations: Object.fromEntries(Object.entries(metrics.operations).map(([label, value]) => [label, {
      samples: value.samples, completed: value.completed, errors: value.errors,
      unfinished: value.unfinished, censored: value.censored, latencyPercentilesReported: false,
    }])),
  } : metrics;
  report.elapsedMs = performance.now() - started;
  report.finishedAt = new Date().toISOString();
  report.steadyWarmEvidenceEligible = report.status === "PASS" && preparationEvidence.some((row) => row.stage.endsWith(":certified"));
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
}
function sanitizedFailure(error: unknown) {
  const clean = (value: string, limit: number) => {
    let text = value;
    const secrets = [process.env.DATABASE_URL, target.toString(), target.password, target.username];
    for (const value of [target.password, target.username]) {
      try { secrets.push(decodeURIComponent(value)); } catch { /* malformed URL escapes remain covered by the full URI */ }
    }
    for (const secret of secrets.filter((value): value is string => !!value).sort((a, b) => b.length - a.length)) text = text.replaceAll(secret, "[redacted]");
    return text.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted-database-url]")
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
      .slice(0, limit);
  };
  return error instanceof Error
    ? { name: clean(error.name, 150), message: clean(error.message, 3000), stack: clean(error.stack ?? "", 12000) }
    : { name: "NonErrorFailure", message: "A non-Error value was thrown; its opaque contents were not serialized." };
}
function timeout(reason: string): never {
  report.status = "TIMEOUT";
  report.failure = reason;
  save();
  // Terminating only this harness closes its owned sockets; PostgreSQL rolls
  // back in-flight transactions. Never advance the fixture after a timeout.
  process.exit(124);
}
const watchdog = setTimeout(() => timeout(`${timeoutMs}-millisecond whole-command watchdog; partial receipt is not passing evidence.`), timeoutMs);
watchdog.unref();

const { Pool } = await import("pg");
const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../generated/prisma/index.js");
const { utcDatabaseUrl } = await import("../src/server/database-url");
const schedulingPgOptions = existsSync(resolve(root, "src/server/database-options.ts"))
  ? (await import("../src/server/database-options")).schedulingPgOptions
  : undefined;
const pool = new Pool({ connectionString: utcDatabaseUrl(target.toString()), max: 6, idleTimeoutMillis: 0, connectionTimeoutMillis: 5000 });
if (mode === "diagnostic") profiler.attachPool(pool);
// External Pool disposal remains ours (adapter-pg defaults disposeExternalPool
// to false). Latency mode does not enable Prisma's diagnostic query event path.
const client = new PrismaClient({ adapter: new PrismaPg(pool, { ...schedulingPgOptions, disposeExternalPool: false }), log: mode === "diagnostic" ? [{ level: "query", emit: "event" }, { level: "warn", emit: "stdout" }] : [{ level: "warn", emit: "stdout" }, { level: "error", emit: "stdout" }] });
if (mode === "diagnostic") client.$on("query", (event) => profiler.observeQuery(event));
(globalThis as typeof globalThis & { prisma?: typeof client }).prisma = client;
// Pool.connect has callback and promise overloads; ReturnType selects the final
// callback overload (void), so name its actual promised client type explicitly.
let runLock: PoolClient | undefined;
let previous: Report | undefined;
let http: HttpHarness | undefined;

try {
  runLock = await pool.connect();
  const admission = await runLock.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('shbs-scheduling-performance-benchmark',0)) AS acquired");
  assert.equal(admission.rows[0]?.acquired, true, "Another benchmark owns this database.");
  report.postgresVersion = (await runLock.query<{ server_version: string }>("SHOW server_version")).rows;
  const applied = await client.$queryRaw<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
    SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name
  `;
  for (const migration of migrations) {
    const rows = applied.filter((row) => row.migration_name === migration.name && row.finished_at && !row.rolled_back_at);
    assert.equal(rows.length, 1, "Incomplete/duplicate committed migration chain.");
    assert.ok([migration.sha256, migration.lfSha256, migration.crlfSha256].includes(rows[0]!.checksum), "Migration checksum differs from this checkout.");
  }
  assert.equal(applied.filter((row) => row.finished_at && !row.rolled_back_at).length, migrations.length);
  assert.ok(applied.every((row) => row.finished_at !== null || row.rolled_back_at !== null), "Unfinished migration requires operator review.");
  report.migrations = applied.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => ({ name: row.migration_name, checksum: row.checksum }));
  if (flags.has("--compare")) {
    // Diagnostic receipts may compare semantics against diagnostic receipts;
    // their instrumented elapsed times never establish a latency improvement.
    previous = JSON.parse(readFileSync(resolve(root, flags.get("--compare")!), "utf8")) as Report;
    assert.equal(previous.status, "PASS");
    for (const key of ["schemaVersion", "mode", "fixture", "harnessHashes", "runtime", "migrations", "postgresVersion"] as const) assert.deepEqual(report[key], previous[key], `Incomparable ${key}`);
  }
  const { createCaller } = await import("../src/server/api/root");
  const metadataAware = existsSync(resolve(root, "src/server/session-planning/maintenance.ts"));
  const maintenance = {
    metadataAware,
    version: metadataAware ? (await import("../src/server/session-planning/maintenance")).SCHEDULING_MAINTENANCE_VERSION : null,
  };
  if (maintenance.metadataAware) assert.ok(typeof maintenance.version === "number" && Number.isInteger(maintenance.version) && maintenance.version > 0);
  report.maintenanceCapability = maintenance;
  if (transport === "http") {
    const { startHttpHarness } = await import("./scheduling-profile/http");
    http = await startHttpHarness({ db: client, bindCurrentContext: <Args extends unknown[], Result>(operation: (...args: Args) => Result) => profiler.bindCurrentContext(operation) });
    report.httpUnauthorized = await http.verifyUnauthorized();
  }
  for (const scenario of scenarios) {
    for (let round = scenario === "backlog" ? 0 : -1; round < samples; round++) {
      await resetFixture(client);
      const fixture = await seedFixture(client, anchor);
      const receiptInputs: ReceiptInput[] = [];
      const pairingCreations: NonNullable<ParityOptions["pairingCreations"]>[number][] = [];
      const operationWindows: { label: string; before: string; after: string }[] = [];
      const occurrence = new Map<string, number>();
      const caller = (userId: string) => {
        const pair = fixture.pairs.find((pair) => pair.tutorUserId === userId);
        const session: Session = { user: { id: userId }, role: userId === fixture.adminId ? "ADMIN" : pair ? "TUTOR" : "STUDENT", tutorId: pair?.tutorId ?? null, expires: "2099-01-01T00:00:00Z" };
        return http ? http.caller(userId, session) : createCaller({ db: client, headers: new Headers(), session });
      };
      const measure = async <T>(label: string, operation: () => Promise<T>) => {
        if (label.startsWith("procedure:")) label = `${transport}:${label.slice("procedure:".length)}`;
        const count = occurrence.get(label) ?? 0;
        occurrence.set(label, count + 1);
        const before = new Date().toISOString();
        const beforeElapsed = performance.now();
        const timer = setTimeout(() => timeout(`35-second operation watchdog (${label}); no later fixture was started.`), 35_000);
        timer.unref();
        try { return await (round < 0 || label.startsWith("setup:") ? operation() : profiler.measure(label, operation)); }
        finally {
          clearTimeout(timer);
          operationWindows.push({ label: `${label}:${count}`, before, after: new Date().toISOString() });
          if (label.startsWith("setup:")) setupMeasurements.push({ scenario, round, label, elapsedMs: performance.now() - beforeElapsed });
        }
      };
      const scenarioBefore = new Date().toISOString();
      const captureDomain = () => captureParity(client, { receiptInputs, pairingCreations, seededPairingIds: [...fixture.pairs.map((pair) => pair.id), fixtureId("prior-pairing")] });
      const recordPreparationEvidence = (stage: string, evidence: unknown) => {
        preparationEvidence.push({ scenario, round, stage, evidence });
        save();
      };
      const output = await runScenario(scenario, { db: client, fixture, caller, measure, receiptInputs, pairingCreations, transport, maintenance, captureDomain, recordPreparationEvidence });
      await assertRecoveryWitnesses(client, fixture);
      await addLateRootWitness(client, fixture);
      // Use a stable explicitly bounded scenario phase rather than merging by
      // millisecond adjacency (which can vary between runs). Raw handler windows
      // remain inspectable. The normalizer retains event order and every fixed
      // domain-boundary relation; it rejects a phase exceeding 120 seconds.
      const parityWindow = [{ label: `scenario:${scenario}`, before: scenarioBefore, after: new Date().toISOString() }];
      const parity = await captureParity(client, { operationWindows: parityWindow, receiptInputs, pairingCreations, seededPairingIds: [...fixture.pairs.map((pair) => pair.id), fixtureId("prior-pairing")], procedureResults: [{ label: scenario, result: output }] });
      if (round < 0) continue;
      const digest = hash(JSON.stringify(parity));
      const receipt: ScenarioReceipt = { scenario, round, digest, ...(round === 0 ? { parity } : {}), output, receiptInputs, pairingCreations, operationWindows, parityWindow };
      // Retain one complete canonical snapshot per scenario and each round's
      // digest/raw response receipts; never substitute counts for journal parity.
      const first = report.receipts.find((row) => row.scenario === scenario);
      if (first) assert.equal(digest, first.digest, "Repeated fixture semantic parity changed.");
      if (previous) {
        const baseline = previous.receipts.find((row) => row.scenario === scenario && row.round === round);
        assert.ok(baseline, "Missing baseline round.");
        assert.equal(digest, baseline.digest, "Before/after complete semantic digest differs.");
        if (round === 0) { assert.ok(baseline.parity); compareParity(parity, baseline.parity); }
      }
      report.receipts.push(receipt);
      save();
    }
  }
  for (const [path, digest] of Object.entries({ ...sourceHashes, ...harnessHashes })) assert.equal(hash(readFileSync(resolve(root, path))), digest, `Source changed during run: ${path}`);
  const finalMigrations = await client.$queryRaw<{ migration_name: string; checksum: string }[]>`
    SELECT migration_name, checksum FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name
  `;
  assert.deepEqual(finalMigrations.map((row) => ({ name: row.migration_name, checksum: row.checksum })), report.migrations, "Applied migrations changed during profiling.");
  report.beforeAfterSemanticEquality = previous ? true : null;
  report.latencyComparisonEligible = !!previous && mode === "latency";
  if (http) report.http = http.summary();
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = "Guard, operation, invariant or exact parity failed. Partial samples are not passing evidence.";
  report.error = sanitizedFailure(error);
  console.error(JSON.stringify(report.error));
  process.exitCode = 1;
} finally {
  const cleanupErrors: unknown[] = [];
  if (http) {
    report.http = http.summary();
    try { await http.close(); } catch (error) { cleanupErrors.push(sanitizedFailure(error)); }
  }
  try { profiler.close(); } catch (error) { cleanupErrors.push(sanitizedFailure(error)); }
  if (runLock) {
    try { await runLock.query("SELECT pg_advisory_unlock(hashtextextended('shbs-scheduling-performance-benchmark',0))"); }
    catch (error) { cleanupErrors.push(sanitizedFailure(error)); }
    finally { runLock.release(); }
  }
  try { await client.$disconnect(); } catch (error) { cleanupErrors.push(sanitizedFailure(error)); }
  try { await pool.end(); } catch (error) { cleanupErrors.push(sanitizedFailure(error)); }
  if (cleanupErrors.length) {
    report.cleanupErrors = cleanupErrors;
    report.status = "FAIL";
    process.exitCode = 1;
    console.error(JSON.stringify({ cleanupErrors }));
  }
  save();
  clearTimeout(watchdog);
  console.log(JSON.stringify({ status: report.status, mode, output: destination, rounds: report.receipts.length }));
}
