import { createClockAdmission } from "./clock-admission.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { aggregatePartitions as aggregateWithReferences, expectedOperationPopulation, loadControlledReferencePaths, loadPartitionInputs, profileMatrix, validateDiagnosticFile } from "./aggregate-partitions.mjs";
import { CONTENTION_ORDERS, CONTENTION_SCENARIOS, buildContentionReferences } from "./contention-references.mjs";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const baseline = "a".repeat(40), candidate = "b".repeat(40);
const options = { baseline, candidate };
const catalogBaseline = "c".repeat(40);
const mixedOptions = { ...options, catalogBaseline };
const harnessPaths = ["scripts/profile-scheduling-requests.ts", "scripts/scheduling-profile/fixtures.ts", "scripts/scheduling-profile/scenarios.ts", "scripts/scheduling-profile/clock-admission.mjs", "scripts/scheduling-profile/metrics.ts", "scripts/scheduling-profile/parity.ts", "scripts/scheduling-profile/http.ts", "scripts/scheduling-profile/register-server-runtime.mjs", "scripts/scheduling-profile/server-runtime-hooks.mjs", "scripts/scheduling-profile/controlled-contention.ts", "scripts/scheduling-profile/contention-references.mjs", "scripts/scheduling-profile/contention-fence-witness.ts"];
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
      const parity = matrix.scenario === "contention" ? contentionGraph(CONTENTION_ORDERS[0])
        : { captureSchema, normalization: { version: 3 }, tables: { Lesson: [{ scenario: matrix.scenario, originalSchemaOnly: original }] }, continuationProvenance: [], clockEvidence: [], semanticAliases: { lesson: "complete synthetic identity" } };
      const digest = sha(JSON.stringify(parity));
      const migrationMap = original ? historicalMigrations : candidateMigrationHashes;
      const migrationFiles = Object.entries(migrationMap).map(([path, digest]) => ({ name: path.split("/")[2]!, sha256: digest, lfSha256: digest, crlfSha256: digest }));
      return {
        status: "PASS", schemaVersion: 3, partitionProtocolVersion: 1, mode: "latency", transport: "http", captureSchema,
        revision: head ? candidate : baseline,
        partition: { index: matrix.partition, count: matrix.partitionCount, start: matrix.partition * 4, end: matrix.partition * 4 + 4, totalSamples: matrix.samples, warmupRounds: 1 },
        samplingComplete: false, partitionComplete: true, latencyComparisonEligible: false,
        beforeAfterSemanticEquality: head ? true : null,
        databaseClock: { startedAt: "2026-11-03T00:00:00.000Z", finishedAt: "2026-11-03T00:00:03.000Z" }, startedAt: "2026-11-03T00:00:00.000Z", finishedAt: "2026-11-03T00:00:10.000Z", elapsedMs: 10_000, timeoutMs: original ? 90_000 : 150_000,
        fixture: { anchor: "2026-11-02T23:00:00.000Z", clockAdmission: createClockAdmission("2026-11-02T23:00:00.000Z", "2026-11-02T23:00:00.000Z"), scenarios: [matrix.scenario], samples: matrix.samples, transport: "http", currentPairings: 100 },
        profileRunner: { id: `${matrix.scenario}-${matrix.partition}`, name: `runner-${matrix.partition}`, os: "Linux", arch: "X64" },
        runtime: { node: "v22.20.0", platform: "linux", arch: "x64", cpu: matrix.partition % 2 ? "Hosted CPU A" : "Hosted CPU B", logicalCpus: 4 },
        postgresVersion: [{ server_version: "16.6" }], database: { host: "127.0.0.1", port: 55439, name: "shbs_performance_test", poolMax: 6 },
        sourceHashes: { "prisma/schema.prisma": original ? originalSchemaSha256 : candidateSchemaSha256, "package-lock.json": sha("dependencies"), "src/server/session-planning/index.ts": head ? sha("candidate application") : originalSourceHashes["src/server/session-planning/index.ts"] },
        harnessHashes: Object.fromEntries(harnessPaths.map((path) => [path, sha(path)])),
        contentionInputs: { nodeImage: sha("immutable Node image"), comparison },
        migrations: migrationFiles.map((file) => ({ name: file.name, checksum: file.sha256 })), migrationFiles,
        receipts: Array.from({ length: 4 }, (_, index) => ({ scenario: matrix.scenario, round: matrix.partition * 4 + index, digest, ...(index === 0 || matrix.scenario === "contention" ? { parity } : {}), output: { scenario: matrix.scenario, results: [] }, receiptInputs: [], pairingCreations: [], operationWindows: [], parityWindow: [],
          ...(matrix.scenario === "contention" ? contentionTags(CONTENTION_ORDERS[0]) : {}) })),
        preparationEvidence: matrix.scenario === "contention" ? Array.from({ length: 4 }, (_, index) => ({ scenario: "contention", round: matrix.partition * 4 + index, stage: "contention-fence", evidence: fenceEvidence(CONTENTION_ORDERS[0]) })) : [],
        ...(matrix.scenario === "contention" ? { contentionReferenceDigests: referenceDigests(), contentionOutcomeParity: true } : {}),
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
type Order = typeof CONTENTION_ORDERS[number];
function contentionTags(order: Order) {
  return { contentionOrder: order, contentionHistoryOrder: order, contentionFenceEvidence: fenceEvidence(order) };
}

const auditOperations = ["admin.autoAssignUnassignedRooms", "sessionPlanning.accepted", "sessionPlanning.responded", "sessionPlanning.respond"];
const auditActions = ["Auto Assign Unassigned Rooms", "Session planning: accepted", "Session planning: responded", "Respond"];
function contentionGraph(order: Order) {
  const rows = auditOperations.map((operation, index) => ({ id: `audit-${index}`, operation, action: auditActions[index]!, details: { outcome: "APPLIED", changes: [{ preserved: index }] } }));
  return { captureSchema: "shared", normalization: { version: 3 }, tables: { Lesson: [{ scenario: "contention", originalSchemaOnly: false }], AuditLog: order === CONTENTION_ORDERS[0] ? rows : [...rows.slice(1), rows[0]!] },
    continuationProvenance: [], clockEvidence: [], semanticAliases: { lesson: "complete synthetic identity" } };
}
function referenceDigests() { return Object.fromEntries(CONTENTION_ORDERS.map((order) => [order, sha(JSON.stringify(contentionGraph(order)))])); }
function fenceEvidence(actual: Order, history: Order = actual) {
  const firstRole = actual === CONTENTION_ORDERS[0] ? "bulk" : "acceptance";
  const operations = [firstRole, firstRole === "bulk" ? "acceptance" : "bulk"].map((role, invocation) => ({ role, invocation,
    startedAt: "2026-11-03T00:00:00.000Z", terminal: "succeeded", terminalAt: "2026-11-03T00:00:00.030Z", failedAcquisitions: 0,
    acquisitions: [{ sequence: invocation + 1, startedAt: "2026-11-03T00:00:00.000Z", acquiredAt: `2026-11-03T00:00:00.0${invocation + 1}0Z`, elapsedMs: (invocation + 1) * 10 }] }));
  const audits = auditOperations.map((operation, index) => ({ auditId: `raw-${index}`, operation,
    createdAt: `2026-11-03T00:00:00.${(history === CONTENTION_ORDERS[0]) === (index === 0) ? "001" : "005"}Z` }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.auditId.localeCompare(b.auditId));
  return { schemaVersion: 1, order: actual, operations, audits, auditHistoryOrder: history, auditTimestampOrder: history,
    auditTimestampOrderBasis: "Persisted AuditLog.createdAt values; chronology is not a lock or transaction-start witness",
    responseTimestampUniform: true, hasTimestampTies: true, crossGroupTimestampTie: false,
    historyContradictsFence: actual !== history, auditTimestampContradictsFence: actual !== history };
}
function controlledProof(order: Order) {
  const period = { classid: "10", objid: "20", objsubid: 1 }, room = { classid: "30", objid: "40", objsubid: 1 };
  const row = (pid: number, key: "period" | "room", granted: boolean, blockers: number[]) => ({ pid, key, granted, blockers,
    mode: "ExclusiveLock", ...(key === "period" ? period : room), applicationName: pid === 101 ? "fixture-hold" : "fixture",
    xactStart: `2026-11-03T00:00:00.${pid === 103 ? "005" : "001"}Z`, observedAt: "2026-11-03T00:00:00.010Z" });
  const first = [row(101, "room", true, []), row(102, "period", true, [101]), row(102, "room", false, [101])];
  return { order, applicationName: "fixture", phase: "completed", completed: true, holderPid: 101, firstPid: 102, secondPid: 103,
    holdMs: 10, lockKeys: { period, room }, snapshots: [{ phase: "first-request", elapsedMs: 3, rows: first },
      { phase: "second-request", elapsedMs: 8, rows: [...first, row(103, "period", false, [102])] }] };
}

type Entries = ReturnType<typeof fixture>;
function controlledPairs(native = false) {
  const source = fixture(native).find((entry) => entry.baseline.fixture.scenarios[0] === "contention")!;
  const make = (order: Order, head: boolean) => {
    const template = structuredClone(head ? source.candidate : source.baseline);
    const scenario = CONTENTION_SCENARIOS[order], graph = contentionGraph(order), digest = sha(JSON.stringify(graph));
    const links = template.sampleRounds.filter((link) => link.round < 3).map((link, sampleIndex) => ({ ...link, sampleIndex, scenario }));
    const samples = links.map((link) => ({ ...template.metrics.samples[link.sampleIndex]!, diagnostics: { acquisitionStatementMs: [3] } }));
    const receipts = [0, 1, 2].map((round) => ({ scenario, round, digest, parity: graph, output: { scenario: "contention", results: [] },
      receiptInputs: [], pairingCreations: [], operationWindows: [], parityWindow: [], contentionOrder: order, contentionHistoryOrder: order, contentionFenceEvidence: fenceEvidence(order) }));
    return { ...template, partition: null, mode: "diagnostic", samplingComplete: true, partitionComplete: false,
      fixture: { ...template.fixture, scenarios: [scenario], samples: 3 },
      profileRunner: { ...template.profileRunner, id: `controlled-${order}`, name: `controlled-${order}` },
      receipts, preparationEvidence: receipts.flatMap((receipt) => [
        { scenario, round: receipt.round, stage: "contention-fence", evidence: receipt.contentionFenceEvidence },
        { scenario, round: receipt.round, stage: "controlled-contention-chain", evidence: controlledProof(order) },
      ]), sampleRounds: links, metrics: { mode: "diagnostic", samples, operations: Object.fromEntries(Object.keys(expectedOperationPopulation("contention")).map((label) => {
        const rows = samples.filter((sample) => sample.label === label);
        return [label, { samples: rows.length, completed: rows.length, errors: rows.filter((sample) => !sample.succeeded).length, unfinished: 0, censored: 0 }];
      })) } };
  };
  return { "bulk-before-acceptance": { baseline: make(CONTENTION_ORDERS[0], false), candidate: make(CONTENTION_ORDERS[0], true), reference: "controlled-bulk", nodeImage: source.nodeImage, comparison: source.comparison },
    "acceptance-before-bulk": { baseline: make(CONTENTION_ORDERS[1], false), candidate: make(CONTENTION_ORDERS[1], true), reference: "controlled-acceptance", nodeImage: source.nodeImage, comparison: source.comparison } };
}
function referencesFixture(native = false, comparison?: Entries[number]["comparison"]) {
  const pairs = controlledPairs(native);
  if (comparison) for (const order of CONTENTION_ORDERS) {
    pairs[order].comparison = structuredClone(comparison);
    for (const report of [pairs[order].baseline, pairs[order].candidate]) report.contentionInputs.comparison = structuredClone(comparison);
  }
  return buildContentionReferences(pairs, { expectedBaseline: baseline, expectedCandidate: candidate });
}
// Freeze independent references once; later test mutations cannot move the oracle.
const referenceCache = new WeakMap<Entries, ReturnType<typeof buildContentionReferences>>();
function aggregatePartitions(rows: Entries, selected: { baseline: string; candidate: string; catalogBaseline?: string }) {
  const primary = rows.find((row) => row.baseline.fixture.scenarios[0] === "contention")?.comparison;
  let references = referenceCache.get(rows);
  if (!references) {
    references = referencesFixture(rows.some((row) => row.native !== undefined), primary);
    referenceCache.set(rows, references);
  }
  return aggregateWithReferences(rows, { ...selected, contentionReferences: references });
}


function setFreeRound(report: Entries[number]["baseline"], receipt: Entries[number]["baseline"]["receipts"][number], actual: Order, history: Order = actual) {
  const graph = contentionGraph(history), evidence = fenceEvidence(actual, history);
  receipt.parity = graph; receipt.digest = sha(JSON.stringify(graph));
  receipt.contentionOrder = actual; receipt.contentionHistoryOrder = history; receipt.contentionFenceEvidence = evidence;
  const saved = report.preparationEvidence.find((item) => item.round === receipt.round && item.stage === "contention-fence");
  assert.ok(saved); saved.evidence = evidence;
}
function freeEntries(rows: Entries) { return rows.filter((row) => row.baseline.fixture.scenarios[0] === "contention"); }
function refreshPairedFlags(rows: Entries) {
  for (const row of freeEntries(rows)) row.candidate.beforeAfterSemanticEquality = row.baseline.receipts.every((receipt, index) => row.candidate.receipts[index]!.digest === receipt.digest);
}
function writeControlledFiles(root: string, native: boolean, comparison: Entries[number]["comparison"], bulkAttempt = 1, acceptanceAttempt = bulkAttempt) {
  const pairs = controlledPairs(native);
  for (const order of CONTENTION_ORDERS) {
    const pair = pairs[order]; pair.comparison = structuredClone(comparison);
    for (const report of [pair.baseline, pair.candidate]) report.contentionInputs.comparison = structuredClone(comparison);
    const directory = join(root, `scheduling-profile-${CONTENTION_SCENARIOS[order]}-diagnostic-part-0-${order === CONTENTION_ORDERS[0] ? bulkAttempt : acceptanceAttempt}`);
    mkdirSync(directory, { recursive: true });
    for (const [name, value] of Object.entries({ "base-diagnostic.json": pair.baseline, "head-diagnostic.json": pair.candidate, "comparison-inputs.json": pair.comparison })) writeFileSync(join(directory, name), JSON.stringify(value));
    writeFileSync(join(directory, "node-image.txt"), pair.nodeImage);
  }
}
function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

/** Same exact reviewed schema/harness for all jobs; source provenance alone
 * differs for the externally pinned catalog control. Every row owns its input
 * object so a single-runner mutation cannot silently alter the whole fixture. */
function mixedFixture(pr = 569) {
  const reviewedManifest = { version: 1, complete: "shared exact reviewed manifest" };
  return fixture(true).map((entry) => {
    const row = structuredClone(entry);
    const catalog = row.baseline.fixture.scenarios[0] === "catalog";
    const revision = catalog ? catalogBaseline : baseline;
    const originalApplication = sha(catalog ? "catalog correctness control application" : "original application");
    row.baseline.revision = revision;
    row.baseline.sourceHashes["src/server/session-planning/index.ts"] = originalApplication;
    row.comparison = {
      ...row.comparison, mode: "reviewed", baselineRevision: revision,
      baselineSelectionPath: `.github/scheduling-profile-manifests/pr-${pr}-${catalog ? "catalog-" : ""}baseline.txt`,
      baselineSelectionFileSha256: sha(`${revision}\n`),
      baselineSelectionSource: catalog ? "reviewed-pr-catalog-baseline-file" : "reviewed-pr-baseline-file",
      reviewedManifestPath: `.github/scheduling-profile-manifests/pr-${pr}.json`,
      reviewedManifest, reviewedManifestSha256: sha(JSON.stringify(reviewedManifest)),
      reviewedManifestFileSha256: sha("one exact shared manifest file"),
      originalSourceHashes: { "src/server/session-planning/index.ts": originalApplication },
    };
    for (const report of [row.baseline, row.candidate]) report.contentionInputs.comparison = row.comparison;
    return row;
  });
}

void test("one matrix spec retains all original68 jobs plus2controlled diagnostics with unchanged20/40/3/1 populations", () => {
  const matrix = profileMatrix().include;
  assert.equal(matrix.length, 70);
  assert.equal(matrix.filter((row) => row.mode === "latency").length, 60);
  assert.equal(matrix.filter((row) => row.mode === "diagnostic").length, 10);
  for (const scenario of ["cold", "sunday", "warm", "negotiation", "allocation", "catalog", "contention"]) {
    const rows = matrix.filter((row) => row.scenario === scenario && row.mode === "latency");
    const total = scenario === "cold" || scenario === "sunday" ? 20 : 40;
    assert.deepEqual(rows.map((row) => row.partition), Array.from({ length: total / 4 }, (_, index) => index));
    assert.ok(rows.every((row) => row.samples === total && row.partitionCount === total / 4));
  }
  assert.equal(matrix.find((row) => row.scenario === "backlog")?.samples, 1);
  assert.ok(matrix.filter((row) => row.mode === "diagnostic" && row.scenario !== "backlog").every((row) => row.samples === 3));
});

void test("five diagnostic preflights and65 remaining jobs retain the original68 plus2controlled rows", () => {
  const all = profileMatrix().include;
  assert.deepEqual(profileMatrix("all").include, all);
  const preflight = profileMatrix("preflight").include;
  const remaining = profileMatrix("remaining").include;
  assert.deepEqual(preflight, ["negotiation", "allocation", "catalog", "contention-bulk-first", "contention-acceptance-first"].map((scenario) => ({
    scenario, mode: "diagnostic", partition: 0, partitionCount: 1, samples: 3,
  })));
  assert.equal(remaining.length, 65);
  assert.equal(remaining.filter((row) => row.mode === "latency").length, 60);
  assert.equal(remaining.filter((row) => row.mode === "diagnostic").length, 5);
  const before = all.map((row) => JSON.stringify(row)).sort();
  const after = [...preflight, ...remaining].map((row) => JSON.stringify(row)).sort();
  assert.equal(new Set(after).size, 70, "Phases overlap or duplicate a job");
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

void test("mixed controls retain exact shared inputs and label the catalog baseline separately", () => {
  const rows = mixedFixture();
  const result = aggregatePartitions(rows, mixedOptions);
  assert.equal(result.status, "PASS");
  assert.equal(result.baselineRevision, baseline);
  assert.equal(result.catalogBaselineRevision, catalogBaseline);
  for (const scenario of result.scenarios)
    assert.equal(scenario.baselineRevision, scenario.scenario === "catalog" ? catalogBaseline : baseline);
  assert.deepEqual(result.baselineComparisons.primary, rows[0]!.comparison);
  assert.deepEqual(result.baselineComparisons.catalog, rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison);
  assert.equal(result.nativeControl.rounds, 20);
  const catalog = result.scenarios.find((row) => row.scenario === "catalog")!;
  assert.equal(catalog.operations["http:catalog-label-only"]!.paired.length, 40);
  assert.equal(catalog.operations["http:catalog-label-only"]!.pairedRatios.p50, 0.5);
  const single = aggregatePartitions(fixture(), options);
  assert.equal(single.catalogBaselineRevision, null);
  assert.ok(single.scenarios.every((scenario) => scenario.baselineRevision === baseline));
  assert.throws(() => aggregatePartitions(rows, options), /comparison baseline revision/);
  assert.throws(() => aggregatePartitions(rows, { ...mixedOptions, baseline: catalogBaseline, catalogBaseline: baseline }), /contention reference baseline revision/);
  assert.throws(() => aggregatePartitions(rows, { ...mixedOptions, catalogBaseline: "catalog-branch" }), /Expected catalog baseline/);
});

void test("mixed controls support another positive PR scope without a PR569 special case", () => {
  const rows = mixedFixture(42);
  const result = aggregatePartitions(rows, mixedOptions);
  assert.equal(result.status, "PASS");
  const primary = rows[0]!.comparison;
  const catalog = rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison;
  assert.equal(primary.baselineSelectionPath, ".github/scheduling-profile-manifests/pr-42-baseline.txt");
  assert.equal(catalog.baselineSelectionPath, ".github/scheduling-profile-manifests/pr-42-catalog-baseline.txt");
  assert.equal(primary.reviewedManifestPath, ".github/scheduling-profile-manifests/pr-42.json");
  assert.equal(catalog.reviewedManifestPath, primary.reviewedManifestPath);
  assert.equal(result.catalogBaselineRevision, catalogBaseline);
});

type MixedEntries = ReturnType<typeof mixedFixture>;
const invalidMixed: { name: string; change: (rows: MixedEntries) => void; pattern: RegExp }[] = [
  { name: "catalog report uses primary SHA", change: (rows) => { rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.baseline.revision = baseline; }, pattern: /immutable revision/ },
  { name: "catalog receipt selects primary SHA", change: (rows) => { rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison.baselineRevision = baseline; }, pattern: /comparison baseline revision/ },
  { name: "catalog pin uses ordinary file", change: (rows) => { rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison.baselineSelectionPath = ".github/scheduling-profile-manifests/pr-569-baseline.txt"; }, pattern: /catalog baseline selection path/ },
  { name: "catalog source claims ordinary selector", change: (rows) => { rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison.baselineSelectionSource = "reviewed-pr-baseline-file"; }, pattern: /catalog baseline selection source/ },
  { name: "catalog pin hashes primary SHA", change: (rows) => { rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison.baselineSelectionFileSha256 = sha(`${baseline}\n`); }, pattern: /does not pin/ },
  { name: "catalog pin omits the required trailing LF", change: (rows) => { rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison.baselineSelectionFileSha256 = sha(catalogBaseline); }, pattern: /does not pin/ },
  { name: "catalog pin omits reviewed file", change: (rows) => { rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison.baselineSelectionPath = null; }, pattern: /Catalog control requires/ },
  { name: "catalog manifest belongs to another PR", change: (rows) => { rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison.reviewedManifestPath = ".github/scheduling-profile-manifests/pr-570.json"; }, pattern: /catalog matching reviewed manifest path/ },
  { name: "catalog schema claims additive fallback", change: (rows) => { rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison.mode = "additive"; }, pattern: /catalog reviewed schema comparison mode/ },
  { name: "primary scenario uses catalog pin", change: (rows) => { rows[0]!.comparison.baselineSelectionPath = ".github/scheduling-profile-manifests/pr-569-catalog-baseline.txt"; }, pattern: /PR-scoped primary baseline file/ },
  { name: "primary report uses catalog SHA", change: (rows) => { rows[0]!.baseline.revision = catalogBaseline; }, pattern: /immutable revision/ },
  { name: "catalog and primary pins belong to different PRs", change: (rows) => {
    for (const row of rows.filter((row) => row.baseline.fixture.scenarios[0] === "catalog")) {
      row.comparison.baselineSelectionPath = ".github/scheduling-profile-manifests/pr-570-catalog-baseline.txt";
      row.comparison.reviewedManifestPath = ".github/scheduling-profile-manifests/pr-570.json";
    }
  }, pattern: /mixed-control primary\/catalog PR scope/ },
  { name: "primary pins change to another valid PR scope", change: (rows) => {
    for (const row of rows.filter((row) => row.baseline.fixture.scenarios[0] !== "catalog")) {
      row.comparison.baselineSelectionPath = ".github/scheduling-profile-manifests/pr-570-baseline.txt";
      row.comparison.reviewedManifestPath = ".github/scheduling-profile-manifests/pr-570.json";
    }
  }, pattern: /mixed-control primary\/catalog PR scope/ },
  { name: "primary pin falls back to a global baseline file", change: (rows) => {
    rows[0]!.comparison.baselineSelectionPath = ".github/scheduling-profile-manifests/baseline.txt";
    rows[0]!.comparison.baselineSelectionSource = "reviewed-baseline-file";
  }, pattern: /PR-scoped primary baseline file/ },
  { name: "primary pin is absent in mixed mode", change: (rows) => { rows[0]!.comparison.baselineSelectionPath = null; }, pattern: /PR-scoped primary baseline file/ },
  { name: "catalog PR number has a leading zero", change: (rows) => { rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison.baselineSelectionPath = ".github/scheduling-profile-manifests/pr-0569-catalog-baseline.txt"; }, pattern: /catalog baseline selection path/ },
  { name: "catalog PR number is unsafe", change: (rows) => { rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!.comparison.baselineSelectionPath = ".github/scheduling-profile-manifests/pr-9007199254740992-catalog-baseline.txt"; }, pattern: /Invalid catalog PR-scoped baseline number/ },
  { name: "catalog original source changes across runners", change: (rows) => {
    const row = rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!;
    row.baseline.sourceHashes["src/server/session-planning/index.ts"] = sha("other catalog application");
    row.comparison.originalSourceHashes["src/server/session-planning/index.ts"] = sha("other catalog application");
  }, pattern: /cross-partition baseline provenance|immutable baseline source/ },
  { name: "reviewed manifest file differs across control groups", change: (rows) => {
    for (const row of rows.filter((row) => row.baseline.fixture.scenarios[0] === "catalog"))
      row.comparison.reviewedManifestFileSha256 = sha("different manifest file");
  }, pattern: /cross-partition schema/ },
  { name: "candidate source differs across control groups", change: (rows) => {
    for (const row of rows.filter((row) => row.baseline.fixture.scenarios[0] === "catalog"))
      row.candidate.sourceHashes["src/server/session-planning/index.ts"] = sha("different candidate");
  }, pattern: /immutable candidate source/ },
  { name: "catalog paired semantic state changes", change: (rows) => {
    const row = rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!;
    const parity = row.candidate.receipts[0]!.parity!;
    parity.semanticAliases.lesson = "different candidate semantic identity";
    for (const receipt of row.candidate.receipts) receipt.digest = sha(JSON.stringify(parity));
  }, pattern: /paired complete first-local parity/ },
  { name: "catalog history differs on one paired runner", change: (rows) => {
    const row = rows.find((row) => row.baseline.fixture.scenarios[0] === "catalog")!;
    for (const report of [row.baseline, row.candidate]) {
      const parity = report.receipts[0]!.parity!;
      parity.semanticAliases.lesson = "different complete catalog history";
      for (const receipt of report.receipts) receipt.digest = sha(JSON.stringify(parity));
    }
  }, pattern: /cross-runner full semantic parity/ },
];
for (const item of invalidMixed) void test(`mixed controls reject ${item.name}`, () => {
  const rows = mixedFixture(); item.change(rows);
  assert.throws(() => aggregatePartitions(rows, mixedOptions), item.pattern);
});

void test("free contention admits both verified legal orders without mixing controlled waits or unmatched ratios", () => {
  const rows = fixture();
  for (const row of freeEntries(rows)) for (const receipt of row.candidate.receipts)
    setFreeRound(row.candidate, receipt, CONTENTION_ORDERS[1]);
  refreshPairedFlags(rows);
  const result = aggregatePartitions(rows, options);
  const scenario = result.scenarios.find((entry) => entry.scenario === "contention")!;
  assert.equal(scenario.semanticDigest, null);
  const operation = scenario.operations["http:contended-bulk"]!;
  assert.equal(operation.baseline.samples, 40); assert.equal(operation.candidate.samples, 40);
  assert.equal(operation.baseline.p95Ms, 38);
  assert.equal(operation.paired.length, 40); assert.equal(operation.pairedRatios.count, 0);
  assert.equal(operation.pairedRatios.unmatchedOrderCount, 40); assert.equal(operation.pairedRatios.p95, null);
  assert.ok(operation.paired.every((pair) => pair.candidateOverBaseline === null && pair.sameContentionOrder === false));
  const evidence = object(scenario.contention), arms = object(evidence.arms);
  const baselineStrata = object(arms.baseline), candidateStrata = object(arms.candidate);
  assert.equal(object(baselineStrata[CONTENTION_ORDERS[0]]).rounds, 40);
  assert.equal(object(candidateStrata[CONTENTION_ORDERS[1]]).rounds, 40);
  const zero = object(object(baselineStrata[CONTENTION_ORDERS[1]]).operations);
  assert.deepEqual(zero["http:contended-bulk"], { samples: 0, completed: 0, errors: 0, unfinished: 0, censored: 0, p50Ms: null, p95Ms: null });
  assert.ok(Array.isArray(result.controlledDiagnostics)); assert.equal(result.controlledDiagnostics.length, 2);
  const diagnosticCount = result.controlledDiagnostics.reduce((count: number, entry: unknown) => {
    const diagnostic = object(entry); assert.equal(diagnostic.latencyComparisonEligible, false);
    return count + Object.values(object(diagnostic.arms)).reduce((n: number, arm: unknown) => {
      const observations = object(arm).rawSamples; assert.ok(Array.isArray(observations)); return n + observations.length;
    }, 0);
  }, 0);
  assert.equal(diagnosticCount, 132);
});

void test("certified persisted audit-clock disagreement is flagged and stratified by actual lock order", () => {
  const rows = fixture();
  for (const row of freeEntries(rows)) for (const receipt of row.candidate.receipts)
    setFreeRound(row.candidate, receipt, CONTENTION_ORDERS[1], CONTENTION_ORDERS[0]);
  refreshPairedFlags(rows);
  assert.ok(freeEntries(rows).every((row) => row.candidate.beforeAfterSemanticEquality));
  const result = aggregatePartitions(rows, options);
  const evidence = object(result.scenarios.find((entry) => entry.scenario === "contention")!.contention);
  assert.deepEqual(evidence.certifiedDisagreementCounts, { baseline: 0, candidate: 40 });
  const candidateStrata = object(object(evidence.arms).candidate);
  assert.equal(object(candidateStrata[CONTENTION_ORDERS[1]]).certifiedDisagreements, 40);
});

void test("nonuniform raw response audit timestamps remain valid evidence rather than transaction-start claims", () => {
  const rows = fixture(), report = freeEntries(rows)[0]!.candidate, receipt = report.receipts[0]!;
  const evidence = receipt.contentionFenceEvidence!;
  evidence.audits.slice(1).forEach((row, index) => { row.createdAt = `2026-11-03T00:00:00.00${index + 5}Z`; });
  evidence.responseTimestampUniform = false; evidence.hasTimestampTies = false;
  const saved = report.preparationEvidence.find((entry) => entry.stage === "contention-fence" && entry.round === receipt.round);
  assert.ok(saved); saved.evidence = structuredClone(evidence);
  assert.equal(aggregatePartitions(rows, options).status, "PASS");
});

const invalidFree: { name: string; change: (rows: Entries) => void; pattern: RegExp }[] = [
  { name: "native capture on a free contention report", change: (rows) => { freeEntries(rows)[0]!.candidate.captureSchema = "native-original"; }, pattern: /declared capture schema|shared.*capture|capture.*schema/ },
  { name: "native capture on a later free contention graph", change: (rows) => { freeEntries(rows)[0]!.candidate.receipts[1]!.parity!.captureSchema = "native-original"; }, pattern: /snapshot capture schema|shared.*capture|capture.*schema/ },
  { name: "missing later-round full graph", change: (rows) => { delete freeEntries(rows)[0]!.candidate.receipts[1]!.parity; }, pattern: /Every free contention round/ },
  { name: "missing actual order", change: (rows) => { delete freeEntries(rows)[0]!.candidate.receipts[1]!.contentionOrder; }, pattern: /actual contention lock order/ },
  { name: "missing history class", change: (rows) => { delete freeEntries(rows)[0]!.candidate.receipts[1]!.contentionHistoryOrder; }, pattern: /contention history order/ },
  { name: "third complete graph", change: (rows) => {
    const receipt = freeEntries(rows)[0]!.candidate.receipts[1]!, graph = contentionGraph(CONTENTION_ORDERS[0]);
    graph.semanticAliases.lesson = "unrecognized third full graph"; receipt.parity = graph; receipt.digest = sha(JSON.stringify(graph));
  }, pattern: /outside both controlled references/ },
  { name: "lost ordered audit row", change: (rows) => {
    const receipt = freeEntries(rows)[0]!.candidate.receipts[1]!, graph = contentionGraph(CONTENTION_ORDERS[0]);
    graph.tables.AuditLog.pop(); receipt.parity = graph; receipt.digest = sha(JSON.stringify(graph));
  }, pattern: /outside both controlled references/ },
  { name: "changed reference digest", change: (rows) => { freeEntries(rows)[0]!.candidate.contentionReferenceDigests![CONTENTION_ORDERS[0]] = sha("foreign reference"); }, pattern: /frozen contention reference digests/ },
  { name: "missing outcome validation flag", change: (rows) => { freeEntries(rows)[0]!.candidate.contentionOutcomeParity = false; }, pattern: /contention outcome parity/ },
  { name: "missing actual fence capture", change: (rows) => { delete freeEntries(rows)[0]!.candidate.receipts[1]!.contentionFenceEvidence; }, pattern: /fence evidence/ },
  { name: "missing saved round witness", change: (rows) => { freeEntries(rows)[0]!.candidate.preparationEvidence.splice(1, 1); }, pattern: /saved fence witness/ },
  { name: "duplicate real lock ordinals", change: (rows) => { freeEntries(rows)[0]!.candidate.receipts[1]!.contentionFenceEvidence!.operations[1]!.acquisitions[0]!.sequence = 1; }, pattern: /acquisition ordinals/ },
  { name: "wrong exact graph history declaration", change: (rows) => { freeEntries(rows)[0]!.candidate.receipts[1]!.contentionHistoryOrder = CONTENTION_ORDERS[1]; }, pattern: /history ordering/ },
  { name: "same-digest flag conceals real different graph", change: (rows) => { const row = freeEntries(rows)[0]!; setFreeRound(row.candidate, row.candidate.receipts[0]!, CONTENTION_ORDERS[1]); }, pattern: /head before\/after semantic equality/ },
  { name: "own-sidecar metadata differs", change: (rows) => { freeEntries(rows)[0]!.candidate.contentionInputs.nodeImage = sha("other image"); }, pattern: /image\/comparison inputs|own immutable sidecars/ },
];
for (const item of invalidFree) void test(`free contention rejects ${item.name}`, () => {
  const rows = fixture(); item.change(rows);
  assert.throws(() => aggregatePartitions(rows, options), item.pattern);
});

void test("free population requires genuinely validated immutable references", () => {
  const rows = fixture();
  assert.throws(() => aggregateWithReferences(rows, options), /Validated contention references/);
  const valid = referencesFixture();
  assert.throws(() => aggregateWithReferences(rows, { ...options, contentionReferences: structuredClone(valid) }), /validated builder\/loader/);
  const pairs = controlledPairs(); pairs[CONTENTION_ORDERS[0]].candidate.receipts.pop();
  assert.throws(() => buildContentionReferences(pairs, { expectedBaseline: baseline, expectedCandidate: candidate }), /three controlled receipts/);
});

for (const arm of ["baseline", "candidate"] as const) {
  void test(`controlled ${arm} report cannot claim native-original capture`, () => {
    const pairs = controlledPairs();
    pairs[CONTENTION_ORDERS[0]][arm].captureSchema = "native-original";
    assert.throws(() => buildContentionReferences(pairs, { expectedBaseline: baseline, expectedCandidate: candidate }), /capture.*schema|shared.*capture/);
  });
  void test(`controlled ${arm} graph cannot silently use native-original capture`, () => {
    const pairs = controlledPairs(), report = pairs[CONTENTION_ORDERS[0]][arm];
    for (const receipt of report.receipts) {
      receipt.parity.captureSchema = "native-original";
      receipt.digest = sha(JSON.stringify(receipt.parity));
    }
    assert.throws(() => buildContentionReferences(pairs, { expectedBaseline: baseline, expectedCandidate: candidate }), /capture.*schema|shared.*capture/);
  });
  void test(`controlled ${arm} graph cannot use the obsolete normalization contract`, () => {
    const pairs = controlledPairs(), report = pairs[CONTENTION_ORDERS[0]][arm];
    for (const receipt of report.receipts) {
      receipt.parity.normalization.version = 2;
      receipt.digest = sha(JSON.stringify(receipt.parity));
    }
    assert.throws(() => buildContentionReferences(pairs, { expectedBaseline: baseline, expectedCandidate: candidate }), /normalization version/);
  });
}

void test("controlled artifact discovery requires two complete unique same-attempt paths", () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-reference-discovery-"));
  try {
    writeControlledFiles(root, false, fixture()[0]!.comparison);
    assert.deepEqual(Object.keys(loadControlledReferencePaths(root)).sort(), [...CONTENTION_ORDERS].sort());
    const other = join(root, "duplicate"); mkdirSync(other);
    writeControlledFiles(other, false, fixture()[0]!.comparison);
    assert.throws(() => loadControlledReferencePaths(root), /Duplicate controlled contention reference/);
  } finally { rmSync(root, { recursive: true, force: true }); }
  const mismatch = mkdtempSync(join(tmpdir(), "controlled-reference-attempt-"));
  try {
    writeControlledFiles(mismatch, false, fixture()[0]!.comparison, 1, 2);
    assert.throws(() => loadControlledReferencePaths(mismatch), /one controlled reference run attempt/);
    const bulk = "scheduling-profile-contention-bulk-first-diagnostic-part-0-1";
    const acceptance = "scheduling-profile-contention-acceptance-first-diagnostic-part-0-2";
    assert.throws(() => loadControlledReferencePaths(mismatch, new Set([bulk])), /Unselected controlled reference/);
    const authenticated = loadControlledReferencePaths(mismatch, new Set([bulk, acceptance]));
    assert.equal(authenticated["bulk-before-acceptance"].reference, bulk);
    assert.equal(authenticated["acceptance-before-bulk"].reference, acceptance);
  } finally { rmSync(mismatch, { recursive: true, force: true }); }
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
  { name: "obsolete normalization contract", change: (rows) => { rows[0]!.baseline.receipts[0]!.parity!.normalization.version = 2; }, pattern: /normalization version/ },
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
  { name: "different valid campaign anchor", change: (rows) => {
    const anchor = "2026-11-02T22:00:00.000Z";
    for (const arm of [rows[1]!.baseline, rows[1]!.candidate]) {
      arm.fixture.anchor = anchor;
      arm.fixture.clockAdmission = createClockAdmission(anchor, anchor);
    }
  }, pattern: /cross-partition/ },
  { name: "PostgreSQL crossing the lesson window", change: (rows) => {
    rows[0]!.baseline.databaseClock.finishedAt = "2026-11-03T07:00:00.000Z";
  }, pattern: /campaign deadline/ },
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

void test("PR-scoped receipt binds baseline pin and reviewed manifest to the same PR", () => {
  const rows = fixture(true);
  const manifest = rows[0]!.comparison;
  manifest.mode = "reviewed";
  manifest.baselineSelectionPath = ".github/scheduling-profile-manifests/pr-569-baseline.txt";
  manifest.baselineSelectionFileSha256 = sha(`${baseline}\n`);
  manifest.baselineSelectionSource = "reviewed-pr-baseline-file";
  manifest.reviewedManifestPath = ".github/scheduling-profile-manifests/pr-569.json";
  manifest.reviewedManifest = { version: 1, complete: "synthetic exact reviewed scoped manifest" };
  manifest.reviewedManifestSha256 = sha(JSON.stringify(manifest.reviewedManifest));
  manifest.reviewedManifestFileSha256 = sha("synthetic scoped manifest file bytes");
  assert.equal(aggregatePartitions(rows, options).status, "PASS");
  manifest.reviewedManifestPath = ".github/scheduling-profile-manifests/pr-570.json";
  assert.throws(() => aggregatePartitions(rows, options), /PR-scoped matching reviewed manifest path/);
  manifest.reviewedManifestPath = ".github/scheduling-profile-manifests/current.json";
  assert.throws(() => aggregatePartitions(rows, options), /PR-scoped matching reviewed manifest path/);
  manifest.reviewedManifestPath = ".github/scheduling-profile-manifests/pr-569.json";
  manifest.baselineSelectionSource = "reviewed-baseline-file";
  assert.throws(() => aggregatePartitions(rows, options), /PR-scoped baseline selection source/);
  manifest.baselineSelectionSource = "reviewed-pr-baseline-file";
  manifest.baselineSelectionFileSha256 = sha("other immutable baseline");
  assert.throws(() => aggregatePartitions(rows, options), /does not pin/);
  manifest.baselineSelectionFileSha256 = sha(`${baseline}\n`);
  manifest.reviewedManifestSha256 = sha("different reviewed contents");
  assert.throws(() => aggregatePartitions(rows, options), /reviewed schema manifest digest/);
  manifest.reviewedManifestSha256 = sha(JSON.stringify(manifest.reviewedManifest));
  manifest.reviewedManifestFileSha256 = null;
  assert.throws(() => aggregatePartitions(rows, options), /Reviewed manifest file hash/);
  manifest.reviewedManifestFileSha256 = sha("synthetic scoped manifest file bytes");
  rows[1]!.comparison = { ...manifest, reviewedManifestFileSha256: sha("different file on another runner") };
  assert.throws(() => aggregatePartitions(rows, options), /cross-partition/);
});

void test("PR-scoped receipt rejects malformed scope numbers and non-reviewed schema claims", () => {
  const rows = fixture(true);
  const manifest = rows[0]!.comparison;
  // Malformed free-run provenance must be checked against an independently
  // valid frozen oracle, rather than used to build that oracle in the wrapper.
  const references = referencesFixture(true);
  const validate = () => aggregateWithReferences(rows, { ...options, contentionReferences: references });
  manifest.baselineSelectionPath = ".github/scheduling-profile-manifests/pr-0569-baseline.txt";
  assert.throws(validate, /reviewed baseline selection path/);
  manifest.baselineSelectionPath = ".github/scheduling-profile-manifests/pr-9007199254740992-baseline.txt";
  assert.throws(validate, /Invalid PR-scoped baseline number/);
  manifest.baselineSelectionPath = ".github/scheduling-profile-manifests/pr-569-baseline.txt";
  manifest.baselineSelectionSource = "reviewed-pr-baseline-file";
  manifest.reviewedManifestPath = ".github/scheduling-profile-manifests/pr-569.json";
  assert.throws(validate, /PR-scoped reviewed schema comparison mode/);
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
    const diagnosticClock = { databaseClock: entry.baseline.databaseClock, fixture: entry.baseline.fixture, startedAt: entry.baseline.startedAt, finishedAt: entry.baseline.finishedAt };
    writeFileSync(join(diagnostic, "base-diagnostic.json"), JSON.stringify({ ...diagnosticClock, status: "PASS", mode: "diagnostic", metrics: { samples: [{ elapsedMs: 999999 }] } }));
    const loaded = loadPartitionInputs(root);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.reference, "cold-partition-0");
    assert.ok(loaded[0]!.files);
    // A locally valid diagnostic from another campaign must not ride along
    // with the accepted latency population.
    const otherAnchor = "2026-11-02T22:00:00.000Z";
    const otherClock = { ...diagnosticClock, fixture: { ...entry.baseline.fixture, anchor: otherAnchor,
      clockAdmission: createClockAdmission(otherAnchor, otherAnchor) } };
    writeFileSync(join(diagnostic, "base-diagnostic.json"), JSON.stringify({ ...otherClock, status: "PASS", mode: "diagnostic" }));
    assert.throws(() => loadPartitionInputs(root), /shared diagnostic and latency anchor/);
    writeFileSync(join(diagnostic, "base-diagnostic.json"), JSON.stringify({ ...diagnosticClock, status: "PASS", mode: "diagnostic" }));
    writeFileSync(join(path, "head-budget.json"), JSON.stringify({ status: "TIMEOUT" }));
    assert.throws(() => loadPartitionInputs(root), /Failure\/timeout receipt/);
    rmSync(join(path, "head-budget.json"));
    const failedParity = join(path, "head-latency.json.parity-failure.json");
    writeFileSync(failedParity, JSON.stringify({ status: "FAIL", eligible: false, actualParity: {} }));
    assert.throws(() => loadPartitionInputs(root), /Failed parity evidence retained/);
    rmSync(failedParity);
    writeFileSync(join(diagnostic, "base-diagnostic.json"), JSON.stringify({ status: "PASS", mode: "diagnostic", parityFailure: { path: "missing-sidecar.json" } }));
    assert.throws(() => loadPartitionInputs(root), /Diagnostic retains failed parity evidence/);
    writeFileSync(join(diagnostic, "base-diagnostic.json"), JSON.stringify({ ...diagnosticClock, status: "PASS", mode: "diagnostic" }));
    rmSync(join(path, "head-latency.json"));
    assert.throws(() => loadPartitionInputs(root), /Missing head-latency/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

void test("isolated diagnostic reader fully decodes tiny data with the same proof and bounded output", () => {
  const root = mkdtempSync(join(tmpdir(), "scheduling-isolated-diagnostic-"));
  const path = join(root, "data with spaces.json");
  const anchor = "2026-11-02T23:00:00.000Z";
  const diagnostic = {
    status: "PASS", mode: "diagnostic",
    fixture: { anchor, clockAdmission: createClockAdmission(anchor, anchor) },
    startedAt: "2026-11-03T00:00:00.000Z", finishedAt: "2026-11-03T00:00:10.000Z",
    databaseClock: { startedAt: "2026-11-03T00:00:00.000Z", finishedAt: "2026-11-03T00:00:03.000Z" },
    graph: { preserved: ["synthetic", { deeply: [1, 2, 3] }] },
  };
  try {
    writeFileSync(path, JSON.stringify(diagnostic));
    assert.equal(validateDiagnosticFile(path), anchor);
    // This invokes the actual trusted Node child without constructing 32 MB.
    assert.equal(validateDiagnosticFile(path, { forceIsolated: true }), anchor);
    const script = fileURLToPath(new URL("./aggregate-partitions.mjs", import.meta.url));
    const child = spawnSync(process.execPath, [script, "--validate-diagnostic", path], {
      encoding: "utf8", timeout: 10_000, maxBuffer: 4096,
    });
    assert.equal(child.status, 0, child.stderr);
    const result: unknown = JSON.parse(child.stdout);
    assert.deepEqual(result, { anchor });
    assert.ok(Buffer.byteLength(child.stdout) < 128);
    for (const [change, pattern] of [
      [{ status: "FAIL" }, /retained diagnostic report status/],
      [{ mode: "latency" }, /separate diagnostic evidence mode/],
      [{ parityFailure: { actualParity: { sensitive: "unprinted" } } }, /Diagnostic retains failed parity evidence/],
      [{ databaseClock: { ...diagnostic.databaseClock, finishedAt: "2026-11-03T07:00:00.000Z" } }, /campaign deadline/],
      [{ databaseClock: null }, /missing PostgreSQL/],
      [{ fixture: { ...diagnostic.fixture, clockAdmission: { ...diagnostic.fixture.clockAdmission, window: "tampered" } } }, /certificate differs/],
    ] as const) {
      writeFileSync(path, JSON.stringify({ ...diagnostic, ...change }));
      assert.throws(() => validateDiagnosticFile(path), pattern);
      assert.throws(() => validateDiagnosticFile(path, { forceIsolated: true }), pattern);
    }
    // A valid prefix followed by garbage must fail full JSON decoding, not pass
    // a status/anchor regex or leak raw input through JSON.parse's diagnostics.
    writeFileSync(path, JSON.stringify(diagnostic) + " PRIVATE_SENTINEL".repeat(1000));
    assert.throws(() => validateDiagnosticFile(path), /Invalid diagnostic JSON/);
    assert.throws(() => validateDiagnosticFile(path, { forceIsolated: true }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Invalid diagnostic JSON/);
      assert.ok(error.message.length < 1024);
      assert.doesNotMatch(error.message, /PRIVATE_SENTINEL/);
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

void test("diagnostic proofs and retained failure sidecars precede all latency JSON parsing", () => {
  const root = mkdtempSync(join(tmpdir(), "scheduling-diagnostic-first-"));
  try {
    const latency = join(root, "a-latency"); mkdirSync(latency);
    for (const name of ["base-latency.json", "head-latency.json", "comparison-inputs.json"])
      writeFileSync(join(latency, name), "not JSON; should not be read yet");
    writeFileSync(join(latency, "node-image.txt"), "synthetic");
    const diagnostic = join(root, "z-diagnostic"); mkdirSync(diagnostic);
    writeFileSync(join(diagnostic, "base-diagnostic.json"), JSON.stringify({ status: "FAIL", mode: "diagnostic" }));
    assert.throws(() => loadPartitionInputs(root), /retained diagnostic report status/);
    writeFileSync(join(diagnostic, "base-diagnostic.json"), "malformed diagnostic");
    writeFileSync(join(latency, "head-budget.json"), "not JSON either");
    assert.throws(() => loadPartitionInputs(root), /Failure\/timeout receipt retained/);
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

void test("CLI accepts only an explicit immutable catalog pin and retains per-scenario provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "scheduling-mixed-controls-cli-"));
  const input = join(root, "parts"); mkdirSync(input);
  const output = join(root, "aggregate.json");
  const script = fileURLToPath(new URL("./aggregate-partitions.mjs", import.meta.url));
  try {
    const rows = mixedFixture();
    writeControlledFiles(input, true, rows[0]!.comparison);
    for (const row of rows) {
      const directory = join(input, row.reference); mkdirSync(directory);
      for (const [name, value] of Object.entries({
        "base-latency.json": row.baseline, "head-latency.json": row.candidate,
        "comparison-inputs.json": row.comparison, ...(row.native ? { "base-native-latency.json": row.native } : {}),
      })) writeFileSync(join(directory, name), JSON.stringify(value));
      writeFileSync(join(directory, "node-image.txt"), row.nodeImage);
    }
    const args = [script, "--input", input, "--baseline", baseline, "--candidate", candidate, "--output", output];
    const command = spawnSync(process.execPath, [...args, "--catalog-baseline", catalogBaseline], { encoding: "utf8" });
    assert.equal(command.status, 0, command.stderr);
    const result: unknown = JSON.parse(readFileSync(output, "utf8"));
    assert.ok(result && typeof result === "object" && "catalogBaselineRevision" in result);
    assert.equal(result.catalogBaselineRevision, catalogBaseline);
    const malformed = spawnSync(process.execPath, [...args, "--catalog-baseline", "catalog-branch"], { encoding: "utf8" });
    assert.equal(malformed.status, 1);
    const failed: unknown = JSON.parse(readFileSync(output, "utf8"));
    assert.ok(failed && typeof failed === "object" && "error" in failed && typeof failed.error === "string");
    assert.match(failed.error, /Expected catalog baseline/);
    const duplicate = spawnSync(process.execPath, [...args, "--catalog-baseline", catalogBaseline, "--catalog-baseline", baseline], { encoding: "utf8" });
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /Usage:/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
