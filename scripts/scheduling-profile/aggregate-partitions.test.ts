import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { aggregatePartitions, expectedOperationPopulation, loadPartitionInputs, profileMatrix } from "./aggregate-partitions.mjs";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const baseline = "a".repeat(40), candidate = "b".repeat(40);
const options = { baseline, candidate };
const harnessPaths = ["scripts/profile-scheduling-requests.ts", "scripts/scheduling-profile/fixtures.ts", "scripts/scheduling-profile/scenarios.ts", "scripts/scheduling-profile/metrics.ts", "scripts/scheduling-profile/parity.ts", "scripts/scheduling-profile/http.ts", "scripts/scheduling-profile/register-server-runtime.mjs", "scripts/scheduling-profile/server-runtime-hooks.mjs"];
type Sample = { label: string; elapsedMs: number; succeeded: boolean; status: string; censored: boolean; elapsedIsLowerBound: boolean; error?: string };

function fixture(native = false) {
  const originalSchemaSha256 = sha("original schema");
  const candidateSchemaSha256 = native ? sha("candidate metadata schema") : originalSchemaSha256;
  const historicalMigrations = { "prisma/migrations/20260101000000_original/migration.sql": sha("original SQL") };
  const candidateMigrationHashes = native ? { ...historicalMigrations, "prisma/migrations/20261103030000_scheduling_maintenance/migration.sql": sha("metadata SQL") } : historicalMigrations;
  const originalSourceHashes = { "src/server/session-planning/index.ts": sha("original application") };
  const comparison = {
    baselineRevision: baseline, mode: native ? "additive" : "identical", requiresNativeSchemaControl: native,
    originalSchemaSha256, candidateSchemaSha256,
    originalLockfileSha256: sha("dependencies"), candidateLockfileSha256: sha("dependencies"),
    historicalMigrations, candidateMigrationHashes, originalSourceHashes,
    baselineSelectionPath: null as string | null, baselineSelectionFileSha256: null as string | null,
    baselineSelectionSource: "explicit-cli", reviewedManifestPath: null as string | null,
    reviewedManifest: null as Record<string, unknown> | null,
    reviewedManifestFileSha256: null as string | null, reviewedManifestSha256: null as string | null,
  };
  return profileMatrix().include.filter((row) => row.mode === "latency").map((matrix) => {
    const report = (head = false, original = false) => {
      const population = expectedOperationPopulation(matrix.scenario);
      const samples: Sample[] = [];
      const sampleRounds: { sampleIndex: number; scenario: string; round: number; label: string }[] = [];
      for (let round = matrix.partition * 4; round < matrix.partition * 4 + 4; round++) {
        for (const [label, count] of Object.entries(population)) {
          for (let occurrence = 0; occurrence < count; occurrence++) {
            const failed = label === "http:stale-response" || ["http:stale-schedule-save", "http:bulk-stale-rejection", "http:permission-refresh-after-demotion"].includes(label) ||
              (matrix.scenario === "contention" && label === `http:competing-schedule-${head ? "b" : "a"}`);
            sampleRounds.push({ sampleIndex: samples.length, scenario: matrix.scenario, round, label });
            samples.push({ label, elapsedMs: (round + occurrence + 1) * (original ? 2 : head ? 0.5 : 1), succeeded: !failed, status: failed ? "failed" : "succeeded", censored: false, elapsedIsLowerBound: false, ...(failed ? { error: "OPERATION_FAILED" } : {}) });
          }
        }
      }
      const captureSchema = original ? "native-original" : "shared";
      const parity = { captureSchema, normalization: { version: 2 }, tables: { Lesson: [{ scenario: matrix.scenario, originalSchemaOnly: original }] }, continuationProvenance: [], clockEvidence: [], semanticAliases: { lesson: "complete synthetic identity" } };
      const digest = sha(JSON.stringify(parity));
      const migrationMap = original ? historicalMigrations : candidateMigrationHashes;
      const migrationFiles = Object.entries(migrationMap).map(([path, digest]) => ({ name: path.split("/")[2]!, sha256: digest, lfSha256: digest, crlfSha256: digest }));
      return {
        status: "PASS", schemaVersion: 3, partitionProtocolVersion: 1, mode: "latency", transport: "http", captureSchema,
        revision: head ? candidate : baseline,
        partition: { index: matrix.partition, count: matrix.partitionCount, start: matrix.partition * 4, end: matrix.partition * 4 + 4, totalSamples: matrix.samples, warmupRounds: 1 },
        samplingComplete: false, partitionComplete: true, latencyComparisonEligible: false,
        beforeAfterSemanticEquality: head ? true : null,
        startedAt: "2026-11-03T00:00:00.000Z", finishedAt: "2026-11-03T00:00:10.000Z", elapsedMs: 10_000, timeoutMs: original ? 90_000 : 150_000,
        fixture: { anchor: "2026-11-02T23:00:00.000Z", scenarios: [matrix.scenario], samples: matrix.samples, transport: "http", currentPairings: 100 },
        profileRunner: { id: `${matrix.scenario}-${matrix.partition}`, name: `runner-${matrix.partition}`, os: "Linux", arch: "X64" },
        runtime: { node: "v22.20.0", platform: "linux", arch: "x64", cpu: matrix.partition % 2 ? "Hosted CPU A" : "Hosted CPU B", logicalCpus: 4 },
        postgresVersion: [{ server_version: "16.6" }], database: { host: "127.0.0.1", port: 55439, name: "shbs_performance_test", poolMax: 6 },
        sourceHashes: { "prisma/schema.prisma": original ? originalSchemaSha256 : candidateSchemaSha256, "package-lock.json": sha("dependencies"), "src/server/session-planning/index.ts": head ? sha("candidate application") : originalSourceHashes["src/server/session-planning/index.ts"] },
        harnessHashes: Object.fromEntries(harnessPaths.map((path) => [path, sha(path)])),
        migrations: migrationFiles.map((file) => ({ name: file.name, checksum: file.sha256 })), migrationFiles,
        receipts: Array.from({ length: 4 }, (_, index) => ({ scenario: matrix.scenario, round: matrix.partition * 4 + index, digest, ...(index === 0 ? { parity } : {}), output: { scenario: matrix.scenario, results: [] }, receiptInputs: [], pairingCreations: [], operationWindows: [], parityWindow: [] })),
        sampleRounds,
        phaseTimings: [{ phase: "scenario", status: "completed", elapsedMs: 1000, elapsedIsLowerBound: false }],
        httpUnauthorized: [{ case: "missing", status: 401, code: "UNAUTHORIZED" }, { case: "wrong", status: 401, code: "UNAUTHORIZED" }],
        http: { loopback: true, requests: 100 },
        metrics: { mode: "latency", samples, operations: Object.fromEntries(Object.keys(population).map((label) => {
          const rows = samples.filter((sample) => sample.label === label);
          return [label, { samples: rows.length, completed: rows.length, errors: rows.filter((row) => !row.succeeded).length, unfinished: 0, censored: 0 }];
        })) },
      };
    };
    return {
      reference: `${matrix.scenario}-${matrix.partition}`, baseline: report(), candidate: report(true),
      comparison, nodeImage: `sha256:${sha("immutable Node image")}`,
      native: native && matrix.scenario === "cold" ? report(false, true) : undefined,
    };
  });
}
type Entries = ReturnType<typeof fixture>;

void test("one matrix spec retains all68 jobs and unchanged20/40/3/1 populations", () => {
  const matrix = profileMatrix().include;
  assert.equal(matrix.length, 68);
  assert.equal(matrix.filter((row) => row.mode === "latency").length, 60);
  assert.equal(matrix.filter((row) => row.mode === "diagnostic").length, 8);
  for (const scenario of ["cold", "sunday", "warm", "negotiation", "allocation", "catalog", "contention"]) {
    const rows = matrix.filter((row) => row.scenario === scenario && row.mode === "latency");
    const total = scenario === "cold" || scenario === "sunday" ? 20 : 40;
    assert.deepEqual(rows.map((row) => row.partition), Array.from({ length: total / 4 }, (_, index) => index));
    assert.ok(rows.every((row) => row.samples === total && row.partitionCount === total / 4));
  }
  assert.equal(matrix.find((row) => row.scenario === "backlog")?.samples, 1);
  assert.ok(matrix.filter((row) => row.mode === "diagnostic" && row.scenario !== "backlog").every((row) => row.samples === 3));
});

void test("two diagnostic preflights and66 remaining jobs form the exact unchanged68-job population", () => {
  const all = profileMatrix().include;
  assert.deepEqual(profileMatrix("all").include, all);
  const preflight = profileMatrix("preflight").include;
  const remaining = profileMatrix("remaining").include;
  assert.deepEqual(preflight, ["negotiation", "allocation"].map((scenario) => ({
    scenario, mode: "diagnostic", partition: 0, partitionCount: 1, samples: 3,
  })));
  assert.equal(remaining.length, 66);
  assert.equal(remaining.filter((row) => row.mode === "latency").length, 60);
  assert.equal(remaining.filter((row) => row.mode === "diagnostic").length, 6);
  const before = all.map((row) => JSON.stringify(row)).sort();
  const after = [...preflight, ...remaining].map((row) => JSON.stringify(row)).sort();
  assert.equal(new Set(after).size, 68, "Phases overlap or duplicate a job");
  assert.deepEqual(after, before, "Phasing changed a job's scenario, sample count or partition contract");
  assert.throws(() => profileMatrix("unknown"), /Unknown matrix phase/);
});

void test("pools all hosted observations and same-runner paired ratios without dropping intentional errors", () => {
  const result = aggregatePartitions(fixture(), options);
  assert.equal(result.status, "PASS");
  assert.equal(result.samplingComplete, true);
  assert.equal(result.scenarios.length, 7);
  const cold = result.scenarios.find((row) => row.scenario === "cold")!;
  const operation = cold.operations["http:cold-tutor-agenda"]!;
  assert.equal(operation.baseline.samples, 20);
  assert.equal(operation.baseline.p50Ms, 10);
  assert.equal(operation.baseline.p95Ms, 19);
  assert.equal(operation.candidate.p95Ms, 9.5);
  assert.equal(operation.pairedRatios.p50, 0.5);
  assert.equal(operation.paired.length, 20);
  assert.equal(cold.evidence.length, 5);
  assert.equal(result.scenarios.find((row) => row.scenario === "negotiation")!.operations["http:stale-response"]!.candidate.errors, 40);
  const contention = result.scenarios.find((row) => row.scenario === "contention")!;
  assert.equal(contention.operations["http:concurrent-4-agenda"]!.baseline.samples, 160);
  assert.equal(contention.operations["http:competing-schedule-a"]!.baseline.errors, 40);
  assert.equal(contention.operations["http:competing-schedule-b"]!.candidate.errors, 40);
});

void test("requires original-schema native20 coverage only for manifests that call for it, with no native/shared parity claim", () => {
  const result = aggregatePartitions(fixture(true), options);
  assert.equal(result.nativeControl.required, true);
  assert.equal(result.nativeControl.reported, true);
  assert.equal(result.nativeControl.rounds, 20);
  assert.equal(result.nativeControl.semanticComparisonToSharedSchema, false);
  assert.equal(result.nativeControl.captureSchema, "native-original");
  assert.equal(result.nativeControl.operations?.["http:cold-tutor-agenda"]?.p95Ms, 38);
  assert.equal(aggregatePartitions(fixture(), options).nativeControl.required, false);
  const missing = fixture(true);
  missing[0]!.native = undefined;
  assert.throws(() => aggregatePartitions(missing, options), /Report must be an object/);
});

const invalid: { name: string; change: (rows: Entries) => void; pattern: RegExp }[] = [
  { name: "missing whole scenario", change: (rows) => { rows.splice(0, 5); }, pattern: /all 60/ },
  { name: "duplicate artifact", change: (rows) => { rows[1] = rows[0]!; }, pattern: /Duplicate partition artifact/ },
  { name: "overlapping global partition", change: (rows) => { rows[1]!.baseline.partition.index = 0; }, pattern: /four-round partition/ },
  { name: "lowered total sample count", change: (rows) => { rows[0]!.baseline.fixture.samples = 4; }, pattern: /total sample count/ },
  { name: "foreign immutable baseline", change: (rows) => { rows[0]!.baseline.revision = "c".repeat(40); }, pattern: /immutable revision/ },
  { name: "diagnostic timing", change: (rows) => { rows[0]!.baseline.mode = "diagnostic"; }, pattern: /measurement mode/ },
  { name: "reduced native capture in a paired baseline", change: (rows) => { rows[0]!.baseline.captureSchema = "native-original"; }, pattern: /declared capture schema/ },
  { name: "reduced native capture in a paired candidate", change: (rows) => { rows[0]!.candidate.captureSchema = "native-original"; }, pattern: /declared capture schema/ },
  { name: "snapshot silently reduced under a shared label", change: (rows) => { rows[0]!.baseline.receipts[0]!.parity!.captureSchema = "native-original"; }, pattern: /snapshot capture schema/ },
  { name: "failed report", change: (rows) => { rows[0]!.candidate.status = "FAIL"; }, pattern: /report status/ },
  { name: "timeout receipt", change: (rows) => { rows[0]!.candidate.status = "TIMEOUT"; }, pattern: /report status/ },
  { name: "over-budget PASS", change: (rows) => { rows[0]!.candidate.elapsedMs = 150_001; }, pattern: /over-budget/ },
  { name: "raised watchdog cap", change: (rows) => { rows[0]!.baseline.timeoutMs = 300_000; }, pattern: /over-budget/ },
  { name: "incomplete partition", change: (rows) => { rows[0]!.baseline.partitionComplete = false; }, pattern: /partition completion/ },
  { name: "retained parity failure hidden behind PASS", change: (rows) => { Object.assign(rows[0]!.baseline, { parityFailure: { path: "failed-snapshot.json" } }); }, pattern: /failure\/cleanup error/ },
  { name: "missing completed receipt", change: (rows) => { rows[0]!.baseline.receipts.pop(); }, pattern: /four completed/ },
  { name: "missing local full parity", change: (rows) => { delete rows[0]!.baseline.receipts[0]!.parity; }, pattern: /first LOCAL|First LOCAL/ },
  { name: "missing full parity on a nonzero partition", change: (rows) => { delete rows[1]!.baseline.receipts[0]!.parity; }, pattern: /first LOCAL|First LOCAL/ },
  { name: "changed later digest", change: (rows) => { rows[0]!.baseline.receipts[1]!.digest = sha("different evidence"); }, pattern: /round semantic digests/ },
  { name: "changed full snapshot", change: (rows) => { rows[0]!.baseline.receipts[0]!.parity!.tables.Lesson.push({ scenario: "cold", originalSchemaOnly: true }); }, pattern: /full parity digest/ },
  { name: "changed full semantic alias dictionary across runners", change: (rows) => {
    for (const report of [rows[1]!.baseline, rows[1]!.candidate]) {
      const parity = report.receipts[0]!.parity!;
      parity.semanticAliases.lesson = "different complete identity";
      for (const receipt of report.receipts) receipt.digest = sha(JSON.stringify(parity));
    }
  }, pattern: /cross-runner full semantic parity/ },
  { name: "false head equality flag", change: (rows) => { rows[0]!.candidate.beforeAfterSemanticEquality = false; }, pattern: /head before\/after/ },
  { name: "censored raw sample", change: (rows) => { rows[0]!.baseline.metrics.samples[0]!.censored = true; }, pattern: /uncensored sample/ },
  { name: "lower-bound sample", change: (rows) => { rows[0]!.baseline.metrics.samples[0]!.elapsedIsLowerBound = true; }, pattern: /completed elapsed/ },
  { name: "NaN elapsed", change: (rows) => { rows[0]!.baseline.metrics.samples[0]!.elapsedMs = NaN; }, pattern: /Invalid elapsed/ },
  { name: "removed measured operation", change: (rows) => { rows[0]!.baseline.metrics.samples.pop(); rows[0]!.baseline.sampleRounds.pop(); }, pattern: /operation population/ },
  { name: "duplicate raw index", change: (rows) => { rows[0]!.baseline.sampleRounds[1]!.sampleIndex = 0; }, pattern: /Duplicate\/out-of-range/ },
  { name: "warmup mixed into measured rounds", change: (rows) => { rows[0]!.baseline.sampleRounds[0]!.round = -1; }, pattern: /Warmup\/foreign/ },
  { name: "missing expected operation error", change: (rows) => {
    const sample = rows.find((row) => row.baseline.fixture.scenarios[0] === "negotiation")!.baseline.metrics.samples.find((sample) => sample.label === "http:stale-response")!;
    sample.succeeded = true; sample.status = "succeeded"; delete sample.error;
  }, pattern: /operation-error contract/ },
  { name: "unexpected operation failure", change: (rows) => { const sample = rows[0]!.baseline.metrics.samples[0]!; sample.succeeded = false; sample.status = "failed"; sample.error = "OPERATION_FAILED"; }, pattern: /operation-error contract/ },
  { name: "forged operation summary", change: (rows) => { rows[0]!.baseline.metrics.operations["http:cold-tutor-agenda"]!.samples = 99; }, pattern: /summary agrees/ },
  { name: "paired runtime mismatch", change: (rows) => { rows[0]!.candidate.runtime.cpu = "different paired host"; }, pattern: /paired runtime/ },
  { name: "missing shared anchor", change: (rows) => { rows[1]!.baseline.fixture.anchor = rows[1]!.candidate.fixture.anchor = "2026-11-02T22:00:00Z"; }, pattern: /cross-partition/ },
  { name: "changed shared harness", change: (rows) => { rows[1]!.baseline.harnessHashes[harnessPaths[0]!] = rows[1]!.candidate.harnessHashes[harnessPaths[0]!] = sha("other harness"); }, pattern: /cross-partition/ },
  { name: "changed schema bytes", change: (rows) => { rows[0]!.baseline.sourceHashes["prisma/schema.prisma"] = sha("wrong schema"); }, pattern: /source schema/ },
  { name: "missing migration", change: (rows) => { rows[0]!.baseline.migrationFiles.pop(); rows[0]!.baseline.migrations.pop(); }, pattern: /migration file inventory/ },
  { name: "part quantiles advertised", change: (rows) => { Object.assign(rows[0]!.baseline.metrics.operations["http:cold-tutor-agenda"]!, { p95Ms: 1 }); }, pattern: /final quantiles/ },
];
for (const item of invalid) void test(`rejects ${item.name} without censoring/ignoring it`, () => {
  const rows = fixture();
  item.change(rows);
  assert.throws(() => aggregatePartitions(rows, options), item.pattern);
});

void test("native PASS above its original90-second cap is rejected", () => {
  const rows = fixture(true);
  rows[0]!.native!.elapsedMs = 90_001;
  assert.throws(() => aggregatePartitions(rows, options), /over-budget/);
});

void test("original-schema native evidence must declare its reduced capture contract", () => {
  const rows = fixture(true);
  rows[0]!.native!.captureSchema = "shared";
  assert.throws(() => aggregatePartitions(rows, options), /declared capture schema/);
});

void test("a reviewed baseline file must pin the externally expected SHA and retain its explicit manifest", () => {
  const rows = fixture(true);
  const manifest = rows[0]!.comparison;
  manifest.mode = "reviewed";
  manifest.baselineSelectionPath = ".github/scheduling-profile-manifests/baseline.txt";
  manifest.baselineSelectionFileSha256 = sha(`${baseline}\n`);
  manifest.baselineSelectionSource = "reviewed-baseline-file";
  manifest.reviewedManifestPath = ".github/scheduling-profile-manifests/reviewed-delta.json";
  manifest.reviewedManifest = { version: 1, complete: "synthetic reviewed manifest" };
  manifest.reviewedManifestSha256 = sha(JSON.stringify(manifest.reviewedManifest));
  manifest.reviewedManifestFileSha256 = sha("synthetic exact file bytes");
  assert.equal(aggregatePartitions(rows, options).status, "PASS");
  manifest.baselineSelectionFileSha256 = sha("wrong selected SHA");
  assert.throws(() => aggregatePartitions(rows, options), /does not pin/);
  manifest.baselineSelectionFileSha256 = sha(`${baseline}\n`);
  manifest.reviewedManifestPath = null;
  assert.throws(() => aggregatePartitions(rows, options), /explicit reviewed schema manifest/);
});

void test("zero-duration baselines retain raw pairs without inventing a ratio", () => {
  const rows = fixture();
  rows[0]!.baseline.metrics.samples[0]!.elapsedMs = 0;
  const result = aggregatePartitions(rows, options);
  const operation = result.scenarios[0]!.operations["http:cold-tutor-agenda"]!;
  assert.equal(operation.pairedRatios.zeroBaselineCount, 1);
  assert.equal(operation.paired[0]!.candidateOverBaseline, null);
});

void test("filesystem discovery retains raw references, excludes diagnostics, and refuses orphan/failure artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "scheduling-partition-test-"));
  const path = join(root, "cold-partition-0");
  mkdirSync(path);
  try {
    const entry = fixture()[0]!;
    for (const [name, value] of Object.entries({ "base-latency.json": entry.baseline, "head-latency.json": entry.candidate, "comparison-inputs.json": entry.comparison })) writeFileSync(join(path, name), JSON.stringify(value));
    writeFileSync(join(path, "node-image.txt"), entry.nodeImage);
    const diagnostic = join(root, "diagnostic"); mkdirSync(diagnostic);
    writeFileSync(join(diagnostic, "base-diagnostic.json"), JSON.stringify({ status: "PASS", mode: "diagnostic", metrics: { samples: [{ elapsedMs: 999999 }] } }));
    const loaded = loadPartitionInputs(root);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.reference, "cold-partition-0");
    assert.ok(loaded[0]!.files);
    writeFileSync(join(path, "head-budget.json"), JSON.stringify({ status: "TIMEOUT" }));
    assert.throws(() => loadPartitionInputs(root), /Failure\/timeout receipt/);
    rmSync(join(path, "head-budget.json"));
    const failedParity = join(path, "head-latency.json.parity-failure.json");
    writeFileSync(failedParity, JSON.stringify({ status: "FAIL", eligible: false, actualParity: {} }));
    assert.throws(() => loadPartitionInputs(root), /Failed parity evidence retained/);
    rmSync(failedParity);
    writeFileSync(join(diagnostic, "base-diagnostic.json"), JSON.stringify({ status: "PASS", mode: "diagnostic", parityFailure: { path: "missing-sidecar.json" } }));
    assert.throws(() => loadPartitionInputs(root), /Diagnostic retains failed parity evidence/);
    writeFileSync(join(diagnostic, "base-diagnostic.json"), JSON.stringify({ status: "PASS", mode: "diagnostic" }));
    rmSync(join(path, "head-latency.json"));
    assert.throws(() => loadPartitionInputs(root), /Missing head-latency/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

void test("CLI matrix shares the spec and failed aggregation writes FAIL rather than stale PASS", () => {
  const script = fileURLToPath(new URL("./aggregate-partitions.mjs", import.meta.url));
  const matrix = spawnSync(process.execPath, [script, "--matrix"], { encoding: "utf8" });
  assert.equal(matrix.status, 0, matrix.stderr);
  const parsed: unknown = JSON.parse(matrix.stdout);
  assert.deepEqual(parsed, profileMatrix());
  for (const phase of ["all", "preflight", "remaining"]) {
    const phased = spawnSync(process.execPath, [script, "--matrix", phase], { encoding: "utf8" });
    assert.equal(phased.status, 0, phased.stderr);
    const included: unknown = JSON.parse(phased.stdout);
    assert.deepEqual(included, profileMatrix(phase));
  }
  const unknown = spawnSync(process.execPath, [script, "--matrix", "unknown"], { encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown matrix phase/);
  const root = mkdtempSync(join(tmpdir(), "scheduling-aggregate-cli-test-"));
  const output = join(root, "aggregate.json");
  try {
    writeFileSync(output, JSON.stringify({ status: "PASS" }));
    const command = spawnSync(process.execPath, [script, "--input", root, "--baseline", baseline, "--candidate", candidate, "--output", output], { encoding: "utf8" });
    assert.equal(command.status, 1);
    const failed: unknown = JSON.parse(readFileSync(output, "utf8"));
    assert.ok(failed && typeof failed === "object" && "status" in failed && failed.status === "FAIL");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
