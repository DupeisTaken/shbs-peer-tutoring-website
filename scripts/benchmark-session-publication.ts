/**
 * Actual PostgreSQL workflow benchmark. SYNTHETIC/DISPOSABLE DATABASE ONLY.
 * Run a separate process in each checkout, with that checkout's matching generated
 * Prisma client, dependencies and committed migrations already installed/applied.
 * Copy this same script into scripts/ in each
 * checkout. Run from its repository root so tsx resolves the checkout's ~/ alias.
 *
 * Explicit DATABASE_URL must target loopback:55439/shbs_performance_test with no
 * query options. The script TRUNCATES its public tables except _prisma_migrations.
 * It creates no databases, installs nothing, applies no migrations and starts no
 * server, SMTP dispatcher, worker, fake clock, or browser.
 *
 * node --conditions=react-server --import tsx scripts/benchmark-session-publication.ts --output outputs/scheduling-performance/workflow-after.json --compare outputs/scheduling-performance/workflow-before.json
 * Fixed workload: 100 pairings, one warmup and five measured rounds. Do not run
 * with CPU/heap profiling or inspector flags; use the existing separate profiler.
 * --scenario basic (default) uses no rooms; --scenario rooms assigns one distinct
 * real room to each pairing. Compare each scenario only against its counterpart.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.equal(realpathSync(process.cwd()), realpathSync(root), "Run from the checkout containing this script; tsx must use its tsconfig.");
assert.ok(![...process.execArgv, process.env.NODE_OPTIONS ?? ""].some((argument) => /--(?:cpu-prof|heap-prof|inspect|prof(?:\s|$|=))/.test(argument)), "Run this comparison without CPU/heap profiling or inspector instrumentation.");
const args = process.argv.slice(2);
const flags = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index]!;
  const value = args[index + 1];
  assert.ok(["--output", "--compare", "--groups", "--scenario"].includes(flag), `Unknown option: ${flag}`);
  assert.ok(value && !value.startsWith("--"), `Missing value for ${flag}`);
  assert.ok(!flags.has(flag), `Repeated flag: ${flag}`);
  flags.set(flag, value);
}
assert.ok(flags.has("--output"), "Required: --output <JSON path>");
const groupCounts = flags.has("--groups") ? [Number(flags.get("--groups"))] : [100];
assert.deepEqual(groupCounts, [100], "This subsecond comparison uses exactly 100 pairings.");
const MEASURED_ROUNDS = 5;
const scenario = flags.get("--scenario") ?? "basic";
assert.ok(scenario === "basic" || scenario === "rooms", "Use --scenario basic or --scenario rooms.");
const withRooms = scenario === "rooms";

// Do this before importing any application module or constructing a client. In
// particular, never let an ignored .env silently select a different database.
assert.ok(process.env.DATABASE_URL, "Provide DATABASE_URL explicitly; this benchmark does not load .env.");
const target = new URL(process.env.DATABASE_URL);
assert.ok(
  ["postgres:", "postgresql:"].includes(target.protocol) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
    target.port === "55439" && target.pathname === "/shbs_performance_test" &&
    [...target.searchParams].length === 0 && target.hash === "",
  "Refusing reset: require explicit PostgreSQL loopback:55439/shbs_performance_test, without URL query overrides.",
);
Object.assign(process.env, {
  NODE_ENV: "test",
  AUTH_SECRET: "synthetic-local-workflow-benchmark-secret-only",
  TRPC_DEV_DELAY: "false",
});
// Environment changes affect only this disposable benchmark process. Clear real
// delivery configuration before imports; no delivery function/worker is invoked.
for (const name of [
  "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM", "EMAIL_SECURITY_FROM", "EMAIL_PROGRAM_FROM",
  "SMTP_SECURITY_USER", "SMTP_SECURITY_PASSWORD", "SMTP_PROGRAM_USER", "SMTP_PROGRAM_PASSWORD",
]) delete process.env[name];

const git = (...gitArgs: string[]) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function readMigrationFiles() {
  const directory = resolve(root, "prisma/migrations");
  return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const bytes = readFileSync(resolve(directory, entry.name, "migration.sql"));
    const lf = bytes.toString("utf8").replaceAll("\r\n", "\n");
    return { migration_name: entry.name, raw: hash(bytes), lf: hash(lf), crlf: hash(lf.replaceAll("\n", "\r\n")) };
  }).sort((left, right) => left.migration_name.localeCompare(right.migration_name));
}
const migrationFiles = readMigrationFiles();
assert.ok(migrationFiles.length > 0, "This comparison requires the complete committed migration chain.");

const sourcePaths = [
  "src/server/db.ts", "src/server/database-options.ts",
  "prisma/schema.prisma", "src/server/session-planning/index.ts", "src/server/session-planning/participants.ts",
  "src/server/session-planning/room-occupancy.ts", "src/server/session-planning-notice-copy.ts",
  "src/lib/program-time.ts", "src/lib/session-planning.ts", "src/lib/school-calendar.ts",
  "src/lib/pairing-groups.ts", "src/server/transactions.ts",
  "src/server/session-planning/notification-recipients.ts", "src/server/session-planning/notice-inserts.ts",
  "src/server/session-planning/source-locks.ts", "src/server/session-planning/conflict-reads.ts",
  "src/server/session-planning/publication-validation.ts", "src/server/session-planning/publication-notices.ts",
  "src/server/session-planning/publication-continuations.ts",
  "src/server/policy-acceptance.ts", "src/server/account-history.ts", "src/server/student-ownership.ts",
  "src/server/student-continuation.ts", "src/server/student-continuation-assignment.ts",
].filter((path) => existsSync(resolve(root, path)));
const sourceHashes = Object.fromEntries(sourcePaths.map((path) => [path, hash(readFileSync(resolve(root, path)))]));
const harnessPath = fileURLToPath(import.meta.url);
const harnessSha256 = hash(readFileSync(harnessPath));
const previous = flags.has("--compare")
  ? JSON.parse(readFileSync(resolve(root, flags.get("--compare")!), "utf8")) as { schemaVersion: number; status: string; harnessSha256: string; migrations: unknown; semanticCases: unknown; fixture: unknown; runtime: unknown; postgresVersion: unknown }
  : null;
if (previous) {
  assert.equal(previous.schemaVersion, 2, "Comparison report format differs; use this same unprofiled harness for both runs.");
  assert.equal(previous.status, "PASS", "A failed or incomplete baseline cannot establish before/after parity.");
  assert.equal(previous.harnessSha256, harnessSha256, "Use the exact same benchmark and normalizer in both checkouts.");
}

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../generated/prisma/index.js");
const { utcDatabaseUrl } = await import("../src/server/database-url");
// Use this checkout's actual production adapter policy. Older baseline revisions
// have no options helper; their ordinary unnamed-query behavior remains intact.
const adapterOptions = existsSync(resolve(root, "src/server/database-options.ts"))
  ? (await import("../src/server/database-options")).schedulingPgOptions
  : undefined;
const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: utcDatabaseUrl(target.toString()), max: 1, idleTimeoutMillis: 0, connectionTimeoutMillis: 5000 }, adapterOptions),
  log: [{ level: "query", emit: "event" }],
});
// Domain modules that import the application's singleton reuse this same process-
// local client. That keeps incidental helper SQL on the guarded target and counted.
(globalThis as typeof globalThis & { prisma?: typeof client }).prisma = client;
type Metrics = { queryEventCount: number; queryEventDurationMs: number; sqlStatementCounts: Record<string, number> };
let activeMetrics: Metrics | null = null;
client.$on("query", (event) => {
  if (!activeMetrics) return;
  activeMetrics.queryEventCount++;
  activeMetrics.queryEventDurationMs += event.duration;
  const statement = event.query.trim().match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "OTHER";
  activeMetrics.sqlStatementCounts[statement] = (activeMetrics.sqlStatementCounts[statement] ?? 0) + 1;
});

const NOW = new Date("2026-10-26T00:00:00.000Z");
const TERM = "perf-term";
const id = (kind: string, index: number) => `perf-${kind}-${String(index).padStart(3, "0")}`;
const report: Record<string, unknown> = {
  schemaVersion: 2, startedAt: new Date().toISOString(), status: "RUNNING",
  revision: git("rev-parse", "HEAD").trim(), workingTree: git("status", "--short"),
  trackedDiffSha256: hash(git("diff", "--binary", "HEAD")), sourceHashes, harnessSha256,
  migrationFiles,
  adapterConfiguration: adapterOptions ? "checkout schedulingPgOptions" : "checkout default adapter options",
  runtime: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model },
  database: { host: target.hostname, port: 55439, name: "shbs_performance_test", poolMax: 1 },
  fixture: { scenario, groupCounts, now: NOW.toISOString(), timezone: "Asia/Shanghai", days: 14, startSlots: [900, 960, 1020],
    participantsPerGroup: { activeTutor: 1, activeTutee: 1 }, explicitGroups: false, rooms: withRooms ? 100 : 0, calendarOverrides: 0,
    pendingRequests: 0, distinctAccounts: true, measuredRounds: MEASURED_ROUNDS,
    continuationAssignments: 0, continuationPairings: 0, continuationMembers: 0, continuationReceipts: 0 },
  methodology: {
    measured: "Actual public ensureSessionPlanningWindow and readSessionAgenda against real local PostgreSQL through PrismaPg. Cold means empty plan tables, not a cold OS/database/process cache. Warm publication repeats after cold publication; personal tutor agenda then includes its normal foreground global maintenance and empty request sweep.",
    rounds: "One warmup and five recorded rounds for 100 pairings. Every round starts with a fresh synthetic fixture. Seed/reset, metadata, snapshots, normalization and assertions are excluded from measured wall time and query-event counts. Operations run serially; no concurrent benchmark processes. SQL event counters only: no CPU profile or query-shape aggregation.",
    queryCounts: "Prisma query-event count and summed event duration during each public function. Event logging overhead is present in both revisions. SQL commands/parameters and credentials are not saved; driver/internal transaction statements may not each emit a Prisma query event. This is not pg_stat_statements or server CPU profiling.",
    semantics: "All generated plans, fingerprints, assignment rosters, cohort dates/times/status/versions, participant-to-cohort ownership and queued notice content/status are retained in canonical snapshots. Random generated IDs become semantic keys; created/updated/queue delivery timestamps are omitted. Repeated rounds, warm publication and agenda must preserve those snapshots. Optional --compare requires exact canonical before/after equality.",
    continuation: "All four continuation provenance tables and per-plan continuationMembers are observed, normalized and compared. The ordinary fixture deliberately contains no continuation enrollment or receipts, so empty continuation evidence must remain empty; this is not a populated continuation/negotiation benchmark. assignedAt, joinedAt, releasedAt and nested snapshot/result fields are preserved.",
    limits: "Synthetic 100 independent weekly pairings with unique people and no pending negotiations. Basic uses no rooms; rooms uses 100 distinct assigned rooms. No HTTP transport, authentication session exchange, browser rendering, SMTP/network delivery or contention is measured. Existing domain transaction timeouts remain unchanged; soft whole-run budget is 120 seconds checked only between awaited operations. Five samples do not establish production p95 or a universal subsecond guarantee.",
  },
};
if (previous) {
  assert.deepEqual(report.fixture, previous.fixture, "Before/after fixture or room scenario differs.");
  assert.deepEqual(report.runtime, previous.runtime, "Before/after runtime/hardware differs.");
}
const measurements: { groups: number; operation: string; round: number; wallMs: number; metrics: Metrics }[] = [];
const semanticCases: unknown[] = [];
report.measurements = measurements;
report.semanticCases = semanticCases;
const started = performance.now();
let ownsRunLock = false;
let failure: unknown;
const drainEvents = () => new Promise<void>((done) => setImmediate(done));
const budget = () => assert.ok(performance.now() - started < 120_000, "Soft 120-second workflow benchmark budget reached; no further operation started.");
async function measured<T>(run: () => Promise<T>) {
  budget();
  await drainEvents();
  const metrics: Metrics = { queryEventCount: 0, queryEventDurationMs: 0, sqlStatementCounts: {} };
  activeMetrics = metrics;
  const before = performance.now();
  let value: T;
  try {
    value = await run();
  } catch (error) {
    activeMetrics = null;
    throw error;
  }
  const wallMs = performance.now() - before;
  await drainEvents();
  activeMetrics = null;
  assert.ok(metrics.queryEventCount > 0, "Prisma query events are unavailable; refusing to report zero as a query count.");
  return { value, wallMs, metrics };
}

// No imports below start timers/workers. The public domain module receives the
// same actual client as production; no validation, locks or helper are mocked.
const { ensureSessionPlanningWindow, readSessionAgenda } = await import("../src/server/session-planning");
const { currentPolicy } = await import("../src/server/policy-acceptance");

function normalize(value: unknown, aliases: Map<string, string>, preserveProvenance = false): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    return aliases.get(value) ?? value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (key) => aliases.get(key) ?? key);
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, aliases, preserveProvenance));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => preserveProvenance || !["createdAt", "updatedAt", "availableAt", "acceptedAt", "completedAt", "attemptStartedAt", "leaseUntil"].includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, normalize(item, aliases, preserveProvenance)]));
  return value;
}
const sortRecords = <T>(rows: T[]): T[] => [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
async function snapshot() {
  const plans = await client.sessionPlan.findMany({ include: { assignments: true, cohorts: true, participants: true, continuationMembers: true }, orderBy: { generationKey: "asc" } });
  const notices = await client.sessionNotice.findMany();
  const continuationAssignments = await client.studentContinuationAssignment.findMany();
  const continuationPairings = await client.studentContinuationPairing.findMany();
  const continuationReceipts = await client.studentContinuationReceipt.findMany();
  const aliases = new Map<string, string>();
  for (const assignment of continuationAssignments) aliases.set(assignment.id, `continuation-assignment:${JSON.stringify([assignment.surveyId, assignment.sourcePairingId])}`);
  for (const plan of plans) {
    aliases.set(plan.id, `plan:${plan.generationKey}`);
    for (const cohort of plan.cohorts) aliases.set(cohort.id, `cohort:${JSON.stringify([plan.generationKey, cohort.date, cohort.startMin, cohort.endMin, cohort.roomId, cohort.online, cohort.rescheduled])}`);
    for (const person of plan.participants) aliases.set(person.id, `participant:${plan.generationKey}:${person.tuteeId}`);
  }
  const cohortKeys = plans.flatMap((plan) => plan.cohorts.map((cohort) => aliases.get(cohort.id)));
  assert.equal(new Set(cohortKeys).size, cohortKeys.length, "Duplicate semantic cohort keys would hide duplicate publication.");
  for (const notice of notices) aliases.set(notice.id, `notice:${normalize(notice.dedupeKey, aliases)}`);
  const continuationRow = (row: object) => normalize(Object.fromEntries(Object.entries(row).filter(([key]) => key !== "createdAt" && key !== "updatedAt")), aliases, true);
  const planRows = plans.map((plan) => ({
    generationKey: plan.generationKey, tutorId: plan.tutorId, termId: plan.termId, originalDate: plan.originalDate,
    timeZone: plan.timeZone, kind: plan.kind, sourceFingerprint: plan.sourceFingerprint, sourceScheduleFingerprint: plan.sourceScheduleFingerprint,
    assignments: sortRecords(plan.assignments.map((assignment) => ({ pairingId: assignment.pairingId, subject: assignment.subject, tuteeIds: assignment.tuteeIds, primary: assignment.primary }))),
    cohorts: sortRecords(plan.cohorts.map((cohort) => normalize(cohort, aliases))),
    participants: sortRecords(plan.participants.map((person) => normalize(person, aliases))),
    continuationMembers: sortRecords(plan.continuationMembers.map(continuationRow)),
  }));
  const counts = {
    plans: plans.length, cohorts: cohortKeys.length, participants: plans.reduce((sum, plan) => sum + plan.participants.length, 0), notices: notices.length,
    requests: await client.sessionPlanningRequest.count(), suggestions: await client.sessionPlanningSuggestion.count(),
    sessions: await client.session.count(), emailDeliveries: await client.emailDelivery.count(), auditLogs: await client.auditLog.count(),
    continuationAssignments: continuationAssignments.length, continuationPairings: continuationPairings.length,
    continuationMembers: plans.reduce((sum, plan) => sum + plan.continuationMembers.length, 0), continuationReceipts: continuationReceipts.length,
  };
  assert.equal(counts.requests, 0);
  assert.equal(counts.suggestions, 0);
  assert.equal(counts.sessions, 0);
  assert.equal(counts.emailDeliveries, 0, "Publication should queue SessionNotice rows, not deliver SMTP messages.");
  for (const field of ["continuationAssignments", "continuationPairings", "continuationMembers", "continuationReceipts"] as const)
    assert.equal(counts[field], 0, `The ordinary fixture must not manufacture ${field}.`);
  assert.ok(plans.every((plan) => plan.cohorts.every((cohort) => cohort.status === "SCHEDULED" && !cohort.sourceInvalidated)), "Synthetic independent lessons must publish successfully; cancelled fixtures do not establish useful cold-publication performance.");
  assert.ok(plans.every((plan) => plan.participants.every((person) => person.status === "SCHEDULED")));
  assert.ok(notices.every((notice) =>
    notice.status === "PENDING" && notice.attempts === 0 && notice.acceptedAt === null &&
    notice.leaseUntil === null && notice.attemptStartedAt === null && notice.attemptId === null &&
    notice.completedAt === null && notice.lastError === null &&
    notice.availableAt.getTime() === notice.createdAt.getTime()),
  "Publication notices must remain immediately available with no lease, delivery attempt or failure state.");
  return { aliases, counts, semantic: normalize({ plans: planRows, notices: sortRecords(notices.map((notice) => normalize(notice, aliases))),
    continuationAssignments: sortRecords(continuationAssignments.map(continuationRow)), continuationPairings: sortRecords(continuationPairings.map(continuationRow)),
    continuationReceipts: sortRecords(continuationReceipts.map(continuationRow)), counts }, aliases, true) };
}

async function readMigrationEvidence() {
  const incomplete = await client.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  assert.deepEqual(incomplete, [], "An unfinished migration prevents a fair benchmark.");
  const applied = await client.$queryRaw<{ migration_name: string; checksum: string }[]>`
    SELECT migration_name, checksum FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  assert.deepEqual(applied.map((row) => row.migration_name), migrationFiles.map((row) => row.migration_name), "Database migrations do not exactly cover this checkout.");
  for (let index = 0; index < applied.length; index++) {
    const file = migrationFiles[index]!;
    assert.ok([file.raw, file.lf, file.crlf].includes(applied[index]!.checksum.toLowerCase()), `Migration bytes differ: ${file.migration_name}`);
  }
  return applied;
}

try {
  const actual = await client.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
  assert.equal(actual[0]?.database, "shbs_performance_test", "Connected database differs from the explicitly owned benchmark target.");
  const migrations = await readMigrationEvidence();
  report.migrations = migrations;
  report.postgresVersion = await client.$queryRaw`SHOW server_version`;
  if (previous) assert.deepEqual(report.postgresVersion, previous.postgresVersion, "Before/after PostgreSQL versions differ.");
  if (previous) assert.deepEqual(migrations, previous.migrations, "Before/after database migrations differ.");
  const lock = await client.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(hashtextextended('shbs-scheduling-performance-benchmark',0)) AS acquired`;
  assert.equal(lock[0]?.acquired, true, "Another benchmark owns this database; run baseline/after serially.");
  ownsRunLock = true;
  const tables = await client.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;
  for (const required of ["User", "Tutor", "Tutee", "Pairing", "SessionPlan", "SessionPlanCohort", "SessionNotice", "StudentContinuationAssignment", "StudentContinuationPairing", "SessionPlanContinuationMember", "StudentContinuationReceipt"])
    assert.ok(tables.some((table) => table.tablename === required), `Missing ${required}; apply committed migrations to this disposable database before running.`);
  const quotedTables = tables.map((table) => `"public"."${table.tablename.replaceAll('"', '""')}"`).join(",");
  const resetAndSeed = async (groups: number) => {
    budget();
    await client.$transaction(async (tx) => {
      const identity = await tx.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
      assert.equal(identity[0]?.database, "shbs_performance_test");
      // Every quoted identifier comes from this guarded database's catalog. This
      // is the sole destructive statement; it never targets a configured app DB.
      await tx.$executeRawUnsafe(`TRUNCATE ${quotedTables} RESTART IDENTITY CASCADE`);
      await tx.programSettings.create({ data: { timeZone: "Asia/Shanghai" } });
      await tx.term.create({ data: { id: TERM, name: "Synthetic performance term", schoolYear: "26-27", quarter: "Q1", active: true,
        startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-12-01T00:00:00Z") } });
      await tx.tutor.createMany({ data: Array.from({ length: groups }, (_, index) => ({ id: id("tutor", index), englishName: `Synthetic Tutor ${index}`, status: "ACTIVE" as const })) });
      await tx.tutee.createMany({ data: Array.from({ length: groups }, (_, index) => ({ id: id("tutee", index), englishName: `Synthetic Tutee ${index}`, status: "ACTIVE" as const })) });
      await tx.user.createMany({ data: Array.from({ length: groups }, (_, index) => [
        { id: id("tutor-user", index), name: `Synthetic Tutor ${index}`, email: `tutor-${index}@benchmark.example.test`, tutorId: id("tutor", index), role: "TUTOR" as const, emailVerifiedAt: NOW },
        { id: id("tutee-user", index), name: `Synthetic Tutee ${index}`, email: `tutee-${index}@benchmark.example.test`, studentId: id("tutee", index), role: "STUDENT" as const, tuteeMember: true, emailVerifiedAt: NOW },
      ]).flat() });
      await tx.studentProfileOwnership.createMany({ data: Array.from({ length: groups }, (_, index) => ({ tuteeId: id("tutee", index), userId: id("tutee-user", index) })) });
      if (withRooms) await tx.room.createMany({ data: Array.from({ length: groups }, (_, index) => ({ id: id("room", index), name: `Synthetic Room ${String(index).padStart(3, "0")}` })) });
      for (const slug of ["tutor-policy", "tutee-policy"]) {
        await tx.policyDocument.create({ data: { slug, locale: "en", title: "Synthetic policy", body: "Synthetic performance fixture rules", version: "1" } });
        const policy = await currentPolicy(tx, slug);
        await tx.policyAcceptance.createMany({ data: Array.from({ length: groups }, (_, index) => ({
          userId: id(slug === "tutor-policy" ? "tutor-user" : "tutee-user", index), slug, revision: policy.revision, snapshot: policy.documents, signature: "Synthetic Participant",
        })) });
      }
      await tx.pairing.createMany({ data: Array.from({ length: groups }, (_, index) => ({ id: id("pairing", index), tutorId: id("tutor", index), termId: TERM, subject: "Synthetic Math",
        dayOfWeek: index % 5 + 1, startMin: [900, 960, 1020][index % 3]!, endMin: [900, 960, 1020][index % 3]! + 45,
        scheduleConfirmed: true, roomMode: withRooms ? "FIXED" as const : "NONE" as const, roomId: withRooms ? id("room", index) : null })) });
      await tx.pairingTutee.createMany({ data: Array.from({ length: groups }, (_, index) => ({ pairingId: id("pairing", index), tuteeId: id("tutee", index) })) });
    }, { timeout: 20_000 });
  };

  for (const groups of groupCounts) {
    let expectedSemantic: unknown;
    for (let round = -1; round < MEASURED_ROUNDS; round++) {
      await resetAndSeed(groups);
      const cold = await measured(() => ensureSessionPlanningWindow(client, NOW));
      const coldSnapshot = await snapshot();
      assert.equal(cold.value.unavailable, 0, "The clean fixture must not hide validation failures as unavailable sessions.");
      assert.equal(cold.value.normalized, 0);
      assert.equal(coldSnapshot.counts.plans, groups * 2);
      assert.equal(coldSnapshot.counts.cohorts, groups * 2);
      assert.equal(coldSnapshot.counts.participants, groups * 2);
      assert.equal(coldSnapshot.counts.notices, groups * 4);
      const warm = await measured(() => ensureSessionPlanningWindow(client, NOW));
      const warmSnapshot = await snapshot();
      assert.deepEqual(warmSnapshot.semantic, coldSnapshot.semantic, "Warm publication changed an existing plan, roster, notice or version.");
      assert.deepEqual(warm.value, cold.value, "Warm publication feedback differs for an unchanged clean fixture.");
      const agenda = await measured(() => readSessionAgenda(client, { id: id("tutor-user", 0), tutorId: id("tutor", 0) }, "tutor", NOW));
      const agendaSnapshot = await snapshot();
      assert.deepEqual(agendaSnapshot.semantic, coldSnapshot.semantic, "Agenda maintenance changed the clean published fixture.");
      assert.equal(agenda.value.cohorts.length, 2, "The first tutor must see exactly its two weekly dated sessions.");
      const normalizedAgenda = normalize(agenda.value, agendaSnapshot.aliases) as Record<string, unknown>;
      // Creation timestamps are intentionally excluded; their incidental ordering
      // must not make independently generated queue row IDs look like a change.
      if (Array.isArray(normalizedAgenda.notices)) normalizedAgenda.notices = sortRecords(normalizedAgenda.notices);
      const semantic = { groups, publication: normalize(cold.value, coldSnapshot.aliases), snapshot: coldSnapshot.semantic, agenda: normalizedAgenda };
      if (round === -1) {
        expectedSemantic = semantic;
        semanticCases.push(semantic);
      } else {
        assert.deepEqual(semantic, expectedSemantic, "Fresh deterministic fixture produced a different semantic result.");
        for (const [operation, measuredResult] of [["cold-publication", cold], ["warm-publication", warm], ["personal-tutor-agenda", agenda]] as const)
          measurements.push({ groups, operation, round, wallMs: measuredResult.wallMs, metrics: measuredResult.metrics });
      }
    }
  }
  if (previous) {
    assert.deepEqual(semanticCases, previous.semanticCases, "Before/after canonical publication or agenda semantics differ.");
    report.beforeAfterSemanticEquality = true;
    report.comparedWith = flags.get("--compare");
  } else report.beforeAfterSemanticEquality = "not compared; provide --compare for the second checkout";
  report.summary = groupCounts.flatMap((groups) => ["cold-publication", "warm-publication", "personal-tutor-agenda"].map((operation) => {
    const rows = measurements.filter((row) => row.groups === groups && row.operation === operation);
    const walls = rows.map((row) => row.wallMs).sort((left, right) => left - right);
    assert.equal(rows.length, MEASURED_ROUNDS);
    return { groups, operation, samples: rows.length, minMs: walls[0], p50Ms: walls[Math.floor(walls.length / 2)], maxMs: walls.at(-1), queryEventCounts: rows.map((row) => row.metrics.queryEventCount) };
  }));
  for (const [path, digest] of Object.entries(sourceHashes)) assert.equal(hash(readFileSync(resolve(root, path))), digest, `Source changed during benchmark: ${path}`);
  assert.deepEqual(readMigrationFiles(), migrationFiles, "Migration files changed during benchmark.");
  assert.deepEqual(await readMigrationEvidence(), report.migrations, "Database migration evidence changed during benchmark.");
  assert.equal(hash(readFileSync(harnessPath)), harnessSha256, "Benchmark changed during the run.");
  report.status = "PASS";
} catch (error) {
  failure = error;
  report.status = "FAIL";
  // Driver errors can embed connection metadata. Save only a fixed failure label;
  // the local operator can inspect the thrown error without publishing it.
  report.failure = "Benchmark failed; partial measurements must not be reported as a passing before/after comparison.";
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,100}$/.test(error.name)) report.errorType = error.name;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^(?:P\d{4}|[A-Z0-9]{5})$/.test(error.code)) report.errorCode = error.code;
} finally {
  activeMetrics = null;
  if (ownsRunLock) {
    try { await client.$queryRaw`SELECT pg_advisory_unlock(hashtextextended('shbs-scheduling-performance-benchmark',0))`; }
    catch { report.cleanupWarning = "Could not explicitly release benchmark advisory lock; disconnect closes the owned session."; }
  }
  await client.$disconnect();
  report.elapsedMs = performance.now() - started;
  report.finishedAt = new Date().toISOString();
  const destination = resolve(root, flags.get("--output")!);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, output: destination, recordedMeasurements: measurements.length, elapsedMs: report.elapsedMs }));
}
if (failure) {
  console.error("Workflow benchmark failed. Inspect the local guarded test setup and partial report; no passing latency claim was produced.");
  // Avoid printing an opaque driver error that could include target credentials.
  if (failure instanceof assert.AssertionError) console.error(failure.message.split("\n")[0]);
  process.exitCode = 1;
}
