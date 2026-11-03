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
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { Session } from "next-auth";
import type { PoolClient } from "pg";
import { validateClockAdmissionBudget, validateClockAdmission, validateReportClocks } from "./scheduling-profile/clock-admission.mjs";
import { createProfiler, type ProfileMode } from "./scheduling-profile/metrics";
import { addLateRootWitness, assertRecoveryWitnesses, fixtureId, resetFixture, seedFixture } from "./scheduling-profile/fixtures";
import { runScenario, scenarioNames, type ReceiptInput, type ScenarioName } from "./scheduling-profile/scenarios";
import { boundedParityDifference, captureParity, compareParity, type ParityOptions, type ParitySnapshot } from "./scheduling-profile/parity";
import { createContentionFenceWitness, captureContentionFenceEvidence } from "./scheduling-profile/contention-fence-witness";
import { loadContentionReferences, assertContentionReferenceCompatibility, validateContentionReceipt, validateFreeContentionReceipt } from "./scheduling-profile/contention-references.mjs";
import type { HttpHarness } from "./scheduling-profile/http";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.equal(realpathSync(process.cwd()), realpathSync(root), "Run inside this harness's checkout.");
const flags = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]!;
  const value = process.argv[index + 1];
  assert.ok(["--scenario", "--mode", "--transport", "--timeout-ms", "--anchor", "--samples", "--partition-index", "--partition-count", "--output", "--compare", "--contention-references"].includes(key), `Unknown option ${key}`);
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
const isControlled = (name: string) => name === "contention-bulk-first" || name === "contention-acceptance-first";
if (isControlled(requested)) {
  assert.equal(mode, "diagnostic", "Controlled interleavings are separately timed diagnostics.");
  assert.equal(transport, "http", "Controlled interleavings require real HTTP requests.");
}
const scenarios = requested === "all"
  ? scenarioNames.filter((name) => name !== "backlog" && !isControlled(name))
  : [requested as ScenarioName];
assert.equal(flags.has("--contention-references"), scenarios.includes("contention"),
  "Free-running contention requires the two frozen reference artifact pairs.");
if (requested === "backlog") assert.equal(mode, "diagnostic", "Backlog is diagnostic-only; it cannot establish latency percentiles.");
const anchorInput = flags.get("--anchor")!;
const commandClock = new Date();
const anchor = new Date(anchorInput);
// Reserve the full command budget before opening a database or timing a request.
const clockAdmission = validateClockAdmissionBudget({ anchor: anchorInput, startedAt: commandClock, timeoutMs });
const samples = flags.has("--samples") ? Number(flags.get("--samples")) : requested === "backlog" ? 1 : requested === "cold" || requested === "sunday" ? 20 : 40;
assert.ok(Number.isInteger(samples) && (requested === "backlog" ? samples >= 1 && samples <= 3 : mode === "diagnostic" ? samples >= 1 && samples <= 10 : samples >= 20 && samples <= 100), "Latency uses 20–100 samples, ordinary diagnostics 1–10, and explicit backlog diagnostics 1–3.");
type Partition = { index: number; count: number; start: number; end: number; totalSamples: number; warmupRounds: 1 };
let partition: Partition | null = null;
assert.equal(flags.has("--partition-index"), flags.has("--partition-count"), "Partition index/count must be supplied together.");
if (flags.has("--partition-index")) {
  assert.equal(mode, "latency", "Only ordinary latency populations use the partition protocol.");
  assert.ok(samples === 20 || samples === 40, "Partitioned --samples remains the full total: 20 or 40.");
  const index = Number(flags.get("--partition-index"));
  const count = Number(flags.get("--partition-count"));
  assert.ok(Number.isInteger(count) && count === samples / 4, "Each partition contains exactly four measured rounds.");
  assert.ok(Number.isInteger(index) && index >= 0 && index < count, "Partition index is outside the complete population.");
  partition = { index, count, start: index * 4, end: (index + 1) * 4, totalSamples: samples, warmupRounds: 1 };
}
const profileRunner = {
  id: process.env.PROFILE_PARTITION_RUNNER_ID ?? null,
  name: process.env.PROFILE_RUNNER_NAME ?? null,
  os: process.env.PROFILE_RUNNER_OS ?? null,
  arch: process.env.PROFILE_RUNNER_ARCH ?? null,
};
if (partition) assert.ok(profileRunner.id?.trim(), "Partition measurements require PROFILE_PARTITION_RUNNER_ID.");
const rangeStart = partition?.start ?? 0;
const rangeEnd = partition?.end ?? samples;
assert.ok(process.env.DATABASE_URL, "Provide DATABASE_URL explicitly; no .env is loaded.");
const target = new URL(process.env.DATABASE_URL);
assert.ok(["postgres:", "postgresql:"].includes(target.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.port === "55439" && target.pathname === "/shbs_performance_test" && !target.search && !target.hash, "Refusing reset: require explicit loopback:55439/shbs_performance_test without query overrides.");
Object.assign(process.env, { NODE_ENV: "test", AUTH_SECRET: "synthetic-profile-secret-for-owned-disposable-database", TRPC_DEV_DELAY: "false" });
for (const name of Object.keys(process.env)) if (/^(?:SMTP_|EMAIL_FROM(?:_|$)|EMAIL_SECURITY_FROM$|EMAIL_PROGRAM_FROM$)/.test(name)) delete process.env[name];

const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const harnessPaths = ["scripts/profile-scheduling-requests.ts", "scripts/scheduling-profile/fixtures.ts", "scripts/scheduling-profile/scenarios.ts", "scripts/scheduling-profile/clock-admission.mjs", "scripts/scheduling-profile/metrics.ts", "scripts/scheduling-profile/parity.ts", "scripts/scheduling-profile/controlled-contention.ts", "scripts/scheduling-profile/contention-fence-witness.ts", "scripts/scheduling-profile/contention-references.mjs", "scripts/scheduling-profile/http.ts", "scripts/scheduling-profile/register-server-runtime.mjs", "scripts/scheduling-profile/server-runtime-hooks.mjs"];
const harnessHashes = Object.fromEntries(harnessPaths.map((path) => [path, hash(readFileSync(resolve(root, path)))]));
const sourcePaths = git("ls-files", "src", "prisma", "package.json", "package-lock.json", "Dockerfile").trim().split(/\r?\n/).filter(Boolean);
const sourceHashes = Object.fromEntries(sourcePaths.map((path) => [path, hash(readFileSync(resolve(root, path)))]));
const migrations = readdirSync(resolve(root, "prisma/migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
  const bytes = readFileSync(resolve(root, "prisma/migrations", entry.name, "migration.sql"));
  const lf = bytes.toString("utf8").replaceAll("\r\n", "\n");
  return { name: entry.name, sha256: hash(bytes), lfSha256: hash(lf), crlfSha256: hash(lf.replaceAll("\n", "\r\n")) };
}).sort((a, b) => a.name.localeCompare(b.name));
type FenceEvidence = Awaited<ReturnType<typeof captureContentionFenceEvidence>>;
type ScenarioReceipt = { contentionOrder?: "bulk-before-acceptance" | "acceptance-before-bulk"; contentionHistoryOrder?: "bulk-before-acceptance" | "acceptance-before-bulk"; contentionFenceEvidence?: FenceEvidence; scenario: ScenarioName; round: number; digest: string; parity?: ParitySnapshot; output: unknown; receiptInputs: ReceiptInput[]; pairingCreations: NonNullable<ParityOptions["pairingCreations"]>; operationWindows: NonNullable<ParityOptions["operationWindows"]>; parityWindow: NonNullable<ParityOptions["operationWindows"]> };
function assertOwnReceiptRange(receipts: ScenarioReceipt[]) {
  const expected = scenarios.flatMap((scenario) => Array.from({ length: rangeEnd - rangeStart }, (_, offset) => `${scenario}:${rangeStart + offset}`)).sort();
  const actual = receipts.map((receipt) => `${receipt.scenario}:${receipt.round}`).sort();
  assert.deepEqual(actual, expected, "Receipt population is incomplete, duplicated or outside this command's declared range.");
}
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
  schemaVersion: 3, partitionProtocolVersion: 1, partition, profileRunner,
  ...(isControlled(requested) || scenarios.includes("contention") ? { contentionProtocolVersion: 1 } : {}),
  samplingComplete: false, partitionComplete: false, latencyComparisonEligible: false,
  status: "RUNNING", mode, transport, timeoutMs, startedAt: new Date().toISOString(),
  revision: git("rev-parse", "HEAD").trim(), workingTree: git("status", "--short"), trackedDiffSha256: hash(git("diff", "--binary", "HEAD")),
  harnessHashes, sourceHashes, migrationFiles: migrations,
  runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
  fixture: { anchor: anchor.toISOString(), clockAdmission, scenarios, transport, samples, currentPairings: 100, rooms: 100, explicitSubjectGroups: 1, calendarOverrides: 2, continuationAssignments: 2, continuationReceipts: 2, ordinaryRecoveryRoots: 5, lateRootWitness: true, ...(requested === "backlog" ? { backlogRequests: 205, failingNotices: 60, hotSourceUpdates: 1200, warmupRounds: 0 } : {}) },
  database: { host: target.hostname, port: 55439, name: "shbs_performance_test", poolMax: 6 },
  methodology: {
    procedure: "Real authenticated synthetic createCaller context and real middleware/Prisma/transactions; excludes HTTP transport and authentication session exchange.",
    http: "When selected: actual loopback HTTP requests via @trpc/client httpLink + superjson and @trpc/server standalone adapter around the unchanged production appRouter. Task-local opaque session cookies stand in for authentication exchange. No Next ingress/proxy, Auth.js exchange, TLS or production network is measured. SQL diagnostics are bound to the incoming request's measured client context.",
    runtimeConditions: "Normal React/Next/Auth.js resolution. A harness-only Node module hook adds react-server solely when resolving the exact server-only marker package, selecting its own published empty.js entry. No authentication/application module is mocked or redirected.",
    domain: "Sunday and exact deadline cases pass an explicit domain clock; production Date is never replaced. Labelled independently from procedure timings.",
    cold: "Empty planning tables and normal process/database caches, not a cold OS/PostgreSQL restart.",
    samples: "Ordinary scenarios use one discarded warmup; explicit backlog diagnostics use none. Fresh fixture each measured round. Seed/reset/snapshots/assertions excluded from timed operations. Ordinary nearest-rank empirical p50/p95 are not a production percentile guarantee; backlog request latency percentiles are not reported.",
    partitions: "Optional protocol v1 uses four contiguous globally numbered measured rounds plus one process warmup per partition. --samples remains the complete 20/40-round population. A partition PASS covers only its own range; population coverage, pooled hosted-runner observations and hardware variance require separate aggregation. Partition receipts do not report latency percentiles or establish latency gains.",
    phaseTimings: "Untimed harness phases record reset, seed, witness assertions, late-root writes, capture/canonicalization, digest and saves. A completed save duration appears in the next write; the final save duration is returned in the console completion record, avoiding recursive report writes.",
    diagnostic: "Separate run only. Driver query and lock-statement elapsed includes client/transport overhead. Acquisition-to-commit interval is a transaction-held interval. No exact PostgreSQL wait accounting is claimed.",
    witness: "Populated continuation is persisted synthetic pre-existing enrollment. Late-root sequential Prisma witness runs outside timing, never the rejected combined-write SQL.",
    cleanWarm: "Ordinary/Sunday steady-clean labels require four fixed common empty-request agenda preparations, unchanged complete domain/audit/recovery snapshots, and passively verified current candidate metadata before/after timing. Setup outputs remain in semantic parity; setup elapsed and readiness counts are separate evidence. Uncertified preparation fails the run without an adaptive drain or timeout extension. Post-proposal and second-read labels do not claim steady state.",
    contention: "The two controlled diagnostics include deliberate wait and observation overhead. Free-running operation timing includes a narrow witness on the real period-lock statement. Actual acquisition order comes from successful statement completion inside the transaction. Audit chronology uses the persisted creation timestamp and row ID. Every observed full graph is compared with the two verified references.",
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
type PhaseTiming = { scenario: ScenarioName | null; round: number | null; phase: string; elapsedMs: number; status: "completed" | "failed" | "unfinished"; elapsedIsLowerBound: boolean };
const phaseTimings: PhaseTiming[] = [];
const activePhases = new Map<PhaseTiming, number>();
let phaseContext: { scenario: ScenarioName | null; round: number | null } = { scenario: null, round: null };
const sampleRounds: { sampleIndex: number; scenario: ScenarioName; round: number; label: string }[] = [];
report.preparationEvidence = preparationEvidence;
report.setupMeasurements = setupMeasurements;
report.sampleRounds = sampleRounds;
async function timedPhase<T>(phase: string, operation: () => Promise<T> | T): Promise<T> {
  const row: PhaseTiming = { ...phaseContext, phase, elapsedMs: 0, status: "unfinished", elapsedIsLowerBound: true };
  const before = performance.now();
  phaseTimings.push(row);
  activePhases.set(row, before);
  let completed = false;
  try {
    const value = await operation();
    completed = true;
    return value;
  } finally {
    row.elapsedMs = performance.now() - before;
    row.status = completed ? "completed" : "failed";
    row.elapsedIsLowerBound = false;
    activePhases.delete(row);
  }
}
function save() {
  const saveStarted = performance.now();
  const metrics = profiler.summary();
  report.metrics = requested === "backlog" || partition ? {
    ...metrics,
    interpretation: { ...metrics.interpretation, latency: partition
      ? "This receipt contains only one four-round partition. Per-partition latency percentiles and latency-gain eligibility are intentionally withheld. Raw completed/censored observations retain global round/runner identity for complete-population aggregation and hardware-variance disclosure."
      : "Backlog is diagnostic-only. Request latency percentiles are intentionally not reported; raw completed and censored elapsed samples remain available. These instrumented stress results do not establish latency gains or production percentiles." },
    operations: Object.fromEntries(Object.entries(metrics.operations).map(([label, value]) => [label, {
      samples: value.samples, completed: value.completed, errors: value.errors,
      unfinished: value.unfinished, censored: value.censored, latencyPercentilesReported: false,
    }])),
  } : metrics;
  report.elapsedMs = performance.now() - started;
  report.finishedAt = new Date().toISOString();
  if (report.status === "PASS") {
    try {
      validateReportClocks(report);
    } catch (error) {
      report.status = "FAIL";
      report.failure = "Command left the admitted clock interval; partial observations are ineligible.";
      report.error = sanitizedFailure(error);
      process.exitCode = 1;
    }
  }
  report.steadyWarmEvidenceEligible = report.status === "PASS" && preparationEvidence.some((row) => row.stage.endsWith(":certified"));
  report.samplingComplete = report.status === "PASS" && partition === null;
  report.partitionComplete = report.status === "PASS" && partition !== null;
  if (report.status !== "PASS" || partition) report.latencyComparisonEligible = false;
  report.phaseTimings = phaseTimings.map((row) => ({ ...row,
    elapsedMs: activePhases.has(row) ? performance.now() - activePhases.get(row)! : row.elapsedMs,
  }));
  let saved = false;
  try {
    writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
    saved = true;
  } finally {
    phaseTimings.push({ ...phaseContext, phase: "save", elapsedMs: performance.now() - saveStarted,
      status: saved ? "completed" : "failed", elapsedIsLowerBound: false });
  }
  return performance.now() - saveStarted;
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
const requestApp = `shbs-profile-${randomUUID()}`;
const pool = new Pool({ ...(isControlled(requested) ? { application_name: requestApp } : {}), connectionString: utcDatabaseUrl(target.toString()), max: 6, idleTimeoutMillis: 0, connectionTimeoutMillis: 5000 });
if (mode === "diagnostic") profiler.attachPool(pool);
// External Pool disposal remains ours (adapter-pg defaults disposeExternalPool
// to false). Latency mode does not enable Prisma's diagnostic query event path.
const baseClient = new PrismaClient({ adapter: new PrismaPg(pool, { ...schedulingPgOptions, disposeExternalPool: false }), log: mode === "diagnostic" ? [{ level: "query", emit: "event" }, { level: "warn", emit: "stdout" }] : [{ level: "warn", emit: "stdout" }, { level: "error", emit: "stdout" }] });
if (mode === "diagnostic") baseClient.$on("query", (event) => profiler.observeQuery(event));
let roundWitness: ReturnType<typeof createContentionFenceWitness> | undefined;
// The extension observes successful resolution of the real transaction-lock
// statement. The resolver must receive it before it can continue to commit.
const client = (scenarios.some((scenario) => scenario === "contention" || isControlled(scenario))
  ? baseClient.$extends({ query: { $executeRaw({ args, query }) {
    return roundWitness ? roundWitness.observeExecuteRaw(args, () => query(args)) : query(args);
  } } }) : baseClient) as typeof baseClient;
(globalThis as typeof globalThis & { prisma?: typeof client }).prisma = client;
// Pool.connect has callback and promise overloads; ReturnType selects the final
// callback overload (void), so name its actual promised client type explicitly.
let runLock: PoolClient | undefined;
async function postgresClock(connection: PoolClient) {
  const { rows } = await connection.query<{ now: Date }>("SELECT clock_timestamp() AS now");
  return rows[0]!.now.toISOString();
}
let previous: Report | undefined;
let contentionReferences: ReturnType<typeof loadContentionReferences> | undefined;
let pairedHistoriesIdentical = true;
let http: HttpHarness | undefined;

try {
  runLock = await pool.connect();
  const admission = await runLock.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('shbs-scheduling-performance-benchmark',0)) AS acquired");
  assert.equal(admission.rows[0]?.acquired, true, "Another benchmark owns this database.");
  const databaseStartedAt = await postgresClock(runLock);
  validateClockAdmission({ anchor: anchorInput, startedAt: databaseStartedAt, finishedAt: databaseStartedAt }, clockAdmission);
  report.databaseClock = { startedAt: databaseStartedAt };
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
  const referenceDirectory = flags.get("--contention-references");
  if (referenceDirectory || isControlled(requested)) {
    const artifactDir = dirname(destination);
    const nodeImage = readFileSync(resolve(artifactDir, "node-image.txt"), "utf8").trim().replace(/^sha256:/, "");
    const comparison: unknown = JSON.parse(readFileSync(resolve(artifactDir, "comparison-inputs.json"), "utf8"));
    report.contentionInputs = { nodeImage, comparison };
  }
  if (referenceDirectory) {
    const paths = (order: string) => ({
      baselinePath: resolve(referenceDirectory, order, "base-diagnostic.json"),
      candidatePath: resolve(referenceDirectory, order, "head-diagnostic.json"),
      nodeImagePath: resolve(referenceDirectory, order, "node-image.txt"),
      comparisonPath: resolve(referenceDirectory, order, "comparison-inputs.json"),
    });
    contentionReferences = loadContentionReferences({
      "bulk-before-acceptance": paths("bulk-before-acceptance"),
      "acceptance-before-bulk": paths("acceptance-before-bulk"),
    }, { expectedBaseline: process.env.BASELINE_SHA ?? "", expectedCandidate: process.env.CANDIDATE_SHA ?? "" });
    assertContentionReferenceCompatibility(report, contentionReferences);
    report.contentionReferenceDigests = {
      "bulk-before-acceptance": contentionReferences.byOrder["bulk-before-acceptance"].digest,
      "acceptance-before-bulk": contentionReferences.byOrder["acceptance-before-bulk"].digest,
    };
  }
  if (flags.has("--compare")) {
    // Diagnostic receipts may compare semantics against diagnostic receipts;
    // their instrumented elapsed times never establish a latency improvement.
    previous = JSON.parse(readFileSync(resolve(root, flags.get("--compare")!), "utf8")) as Report;
    assert.equal(previous.status, "PASS");
    validateReportClocks(previous);
    for (const key of ["schemaVersion", "partitionProtocolVersion", "partition", "profileRunner", "mode", "fixture", "harnessHashes", "runtime", "migrations", "postgresVersion"] as const) assert.deepEqual(report[key], previous[key], `Incomparable ${key}`);
    assertOwnReceiptRange(previous.receipts);
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
    http = await startHttpHarness({ db: client, bindCurrentContext: <Args extends unknown[], Result>(operation: (...args: Args) => Result) => {
      const bound = profiler.bindCurrentContext(operation);
      return roundWitness ? roundWitness.bindCurrentContext(bound) : bound;
    } });
    report.httpUnauthorized = await http.verifyUnauthorized();
  }
  for (const scenario of scenarios) {
    const measuredRounds = Array.from({ length: rangeEnd - rangeStart }, (_, offset) => rangeStart + offset);
    const rounds = scenario === "backlog" ? measuredRounds : [-1, ...measuredRounds];
    for (const round of rounds) {
      phaseContext = { scenario, round };
      roundWitness = scenario === "contention" || isControlled(scenario) ? createContentionFenceWitness() : undefined;
      await timedPhase("reset", () => resetFixture(client));
      const fixture = await timedPhase("seed", () => seedFixture(client, anchor));
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
        const role = label === "procedure:contended-bulk" ? "bulk" : label === "procedure:contended-acceptance" ? "acceptance" : null;
        if (label.startsWith("procedure:")) label = `${transport}:${label.slice("procedure:".length)}`;
        const count = occurrence.get(label) ?? 0;
        occurrence.set(label, count + 1);
        const before = new Date().toISOString();
        const beforeElapsed = performance.now();
        const timer = setTimeout(() => timeout(`35-second operation watchdog (${label}); no later fixture was started.`), 35_000);
        timer.unref();
        try {
          const witness = roundWitness;
          const instrumented = role && witness ? () => witness.run(role, operation) : operation;
          if (round < 0 || label.startsWith("setup:")) return await instrumented();
          sampleRounds.push({ sampleIndex: sampleRounds.length, scenario, round, label });
          return await profiler.measure(label, instrumented);
        }
        finally {
          clearTimeout(timer);
          operationWindows.push({ label: `${label}:${count}`, before, after: new Date().toISOString() });
          if (label.startsWith("setup:")) setupMeasurements.push({ scenario, round, label, elapsedMs: performance.now() - beforeElapsed });
        }
      };
      const scenarioBefore = new Date().toISOString();
      const captureDomain = () => timedPhase("capture-domain", () => captureParity(client, { receiptInputs, pairingCreations, seededPairingIds: [...fixture.pairs.map((pair) => pair.id), fixtureId("prior-pairing")] }));
      const recordPreparationEvidence = (stage: string, evidence: unknown) => {
        preparationEvidence.push({ scenario, round, stage, evidence });
        save();
      };
      let output: Awaited<ReturnType<typeof runScenario>>;
      try {
        output = await runScenario(scenario, { db: client, fixture, caller, measure, receiptInputs, pairingCreations, transport, maintenance, captureDomain, recordPreparationEvidence,
        ...(isControlled(scenario) ? { controlledConnection: { connectionString: target.toString(), applicationName: requestApp } } : {}) });
      } catch (failure) {
        if (roundWitness) recordPreparationEvidence("contention-fence-failure", roundWitness.snapshot());
        throw failure;
      }
      let fenceEvidence: FenceEvidence | undefined;
      let fenceFailure: { cause: unknown } | undefined;
      if (roundWitness) {
        const snapshot = roundWitness.snapshot();
        try { fenceEvidence = await captureContentionFenceEvidence(client, snapshot); }
        catch (failure) {
          recordPreparationEvidence("contention-fence-failure", { snapshot, error: sanitizedFailure(failure) });
          fenceFailure = { cause: failure };
        }
      }
      if (fenceEvidence) recordPreparationEvidence("contention-fence", fenceEvidence);
      await timedPhase("recovery-witness-assertions", () => assertRecoveryWitnesses(client, fixture));
      await timedPhase("late-root-witness", () => addLateRootWitness(client, fixture));
      // Use a stable explicitly bounded scenario phase rather than merging by
      // millisecond adjacency (which can vary between runs). Raw handler windows
      // remain inspectable. The normalizer retains event order and every fixed
      // domain-boundary relation; it rejects a phase exceeding 120 seconds.
      // All three launch policies exercise one logical contention workload. The
      // scenario name in the report identifies the separate measurement population.
      const domainScenario = isControlled(scenario) ? "contention" : scenario;
      const parityWindow = [{ label: `scenario:${domainScenario}`, before: scenarioBefore, after: new Date().toISOString() }];
      const parity = await timedPhase("capture-final-parity", () => captureParity(client, { operationWindows: parityWindow, receiptInputs, pairingCreations, seededPairingIds: [...fixture.pairs.map((pair) => pair.id), fixtureId("prior-pairing")], procedureResults: [{ label: domainScenario, result: output }] }));
      if (round < 0 && scenario !== "contention" && !fenceFailure) continue;
      const digest = await timedPhase("parity-digest", () => hash(JSON.stringify(parity)));
      // Retain one complete canonical snapshot per scenario and each round's
      // digest/raw response receipts; never substitute counts for journal parity.
      const first = report.receipts.find((row) => row.scenario === scenario);
      const receipt: ScenarioReceipt = { scenario, round, digest, ...(fenceEvidence ? { contentionFenceEvidence: fenceEvidence, contentionOrder: fenceEvidence.order } : {}), ...(!first || scenario === "contention" || isControlled(scenario) ? { parity } : {}), output, receiptInputs, pairingCreations, operationWindows, parityWindow };
      const retainMismatch = (kind: string, expected: ScenarioReceipt | undefined, expectedParity = expected?.parity) => {
        // Keep the failing snapshot separately: it is not a completed round.
        // A digest alone cannot diagnose clock, ordering or domain-state drift.
        const path = `${destination}.parity-failure.json`;
        const evidence = { status: "FAIL", eligible: false, kind, scenario, round, actualDigest: digest,
          expectedDigest: expected?.digest ?? null, expectedRound: expected?.round ?? null,
          firstDifference: expectedParity ? boundedParityDifference(parity, expectedParity) : null,
          ...(scenario === "contention" ? { legalReferenceDigests: report.contentionReferenceDigests, contentionFenceEvidence: fenceEvidence } : {}),
          actualParity: parity, output, receiptInputs, pairingCreations, operationWindows, parityWindow };
        // Persist before throwing; finally's report keeps only a bounded index.
        writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
        report.parityFailure = { path, kind, scenario, round, actualDigest: digest,
          expectedDigest: evidence.expectedDigest, expectedRound: evidence.expectedRound,
          firstDifference: evidence.firstDifference };
      };
      if (fenceFailure) {
        retainMismatch("invalid-period-lock-witness", undefined);
        throw fenceFailure.cause;
      }
      if (scenario === "contention") {
        assert.ok(contentionReferences);
        try {
          assert.ok(fenceEvidence);
          receipt.contentionHistoryOrder = validateContentionReceipt(receipt, contentionReferences);
          validateFreeContentionReceipt(report, receipt, contentionReferences);
          if (round < 0) {
            report.contentionWarmup = { digest, order: receipt.contentionOrder, historyOrder: receipt.contentionHistoryOrder };
            continue;
          }
          if (previous) {
            const baseline = previous.receipts.find((row) => row.scenario === scenario && row.round === round);
            assert.ok(baseline?.parity, "Missing complete free-running baseline observation.");
            validateFreeContentionReceipt(previous, baseline, contentionReferences);
            if (baseline.digest !== digest) pairedHistoriesIdentical = false;
          }
        } catch (error) {
          retainMismatch("free-contention-reference", undefined);
          throw error;
        }
      } else {
        if (first && digest !== first.digest) retainMismatch("repeated-fixture", first);
        if (first) assert.equal(digest, first.digest, "Repeated fixture semantic parity changed.");
        if (previous) {
          const baseline = previous.receipts.find((row) => row.scenario === scenario && row.round === round);
          if (digest !== baseline?.digest) retainMismatch("before-after", baseline,
            baseline?.parity ?? previous.receipts.find((row) => row.scenario === scenario && row.parity)?.parity);
          assert.ok(baseline, "Missing baseline round.");
          assert.equal(digest, baseline.digest, "Before/after complete semantic digest differs.");
          if (!first) { assert.ok(baseline.parity); compareParity(parity, baseline.parity); }
        }
      }
      report.receipts.push(receipt);
      save();
    }
  }
  assertOwnReceiptRange(report.receipts);
  assert.equal(profiler.summary().samples.length, sampleRounds.length, "Raw samples lost their global round identities.");
  for (const [path, digest] of Object.entries({ ...sourceHashes, ...harnessHashes })) assert.equal(hash(readFileSync(resolve(root, path))), digest, `Source changed during run: ${path}`);
  const finalMigrations = await client.$queryRaw<{ migration_name: string; checksum: string }[]>`
    SELECT migration_name, checksum FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name
  `;
  assert.deepEqual(finalMigrations.map((row) => ({ name: row.migration_name, checksum: row.checksum })), report.migrations, "Applied migrations changed during profiling.");
  report.databaseClock = { startedAt: databaseStartedAt, finishedAt: await postgresClock(runLock) };
  report.beforeAfterSemanticEquality = previous ? pairedHistoriesIdentical : null;
  if (scenarios.includes("contention")) report.contentionOutcomeParity = true;
  report.latencyComparisonEligible = !!previous && mode === "latency" && partition === null && !scenarios.includes("contention");
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
  // A synchronous capture/serialization can delay the event-loop watchdog.
  // Check the same deadline explicitly before certifying completed cleanup.
  if (performance.now() - started >= timeoutMs) {
    report.status = "TIMEOUT";
    report.failure = "Whole-command deadline expired before final completion; partial evidence is not eligible.";
    process.exitCode = 124;
  }
  const finalSaveMs = save();
  clearTimeout(watchdog);
  console.log(JSON.stringify({ status: report.status, mode, output: destination, rounds: report.receipts.length, partition, samplingComplete: report.samplingComplete, finalSaveMs }));
}
