import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createClockAdmission } from "../scheduling-profile/clock-admission.mjs";
import { aggregateConcurrent, CONCURRENT_CASES, currentHarnessHashes, loadConcurrentPairs, nearestRank, ORIGINAL_HARNESS_PATHS } from "./concurrent-aggregate.mjs";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const baseline = "a".repeat(40), candidate = "b".repeat(40), regressionBaseline = "c".repeat(40);
const anchor = "2026-11-02T23:00:00.000Z";
const harness = Object.fromEntries([...ORIGINAL_HARNESS_PATHS, ...["concurrent-scenarios.ts", "concurrent-scenarios.test.ts", "run.ts", "wave.ts", "concurrent-aggregate.mjs", "concurrent-aggregate.test.ts", "run-worker.sh", "manifest.mjs"].map((path) => `scripts/scheduling-concurrency/${path}`)].map((path) => [path, hash(path)]));
const options = { baseline, candidate, regressionBaseline, expectedHarnessHashes: harness };
const frozenOptions = { ...options, candidate: regressionBaseline, caseSet: "original-five", candidateArm: "frozen" };
const migrationPath = "prisma/migrations/20261103031000_shared/migration.sql";

function diagnosticCounters(multiplier: number) {
  return { driverQueries: { count: 2, elapsedMs: multiplier * 2, errors: 0 }, queryShapes: { "SELECT:synthetic-hash": { count: 2, elapsedMs: multiplier * 2, errors: 0 } },
    prismaEvents: { count: 2, durationMs: multiplier }, connectionAcquisitionMs: [0.2], acquisitionStatementMs: [0.5], lockHeldTransactionMs: [3],
    uncertainLockIntervals: [], implicitTransactionLockAcquisitions: 0, processCpuMs: { user: multiplier, system: 0.5 },
    eventLoopUtilization: 0.5, eventLoopDelayMs: null, overlappedAnotherRequest: true };
}

function tryLockCounters() {
  return { attemptMs: [0.25, 0.5, 0.75], outcomes: ["granted", "denied", "unrecognized"], granted: 1, denied: 1, errors: 0, unrecognized: 1,
    implicitTransactionAcquisitions: 0, lockHeldTransactionMs: [2], uncertainLockIntervals: [] };
}

function fixture() {
  const entries = [];
  for (const [name, spec] of Object.entries(CONCURRENT_CASES)) {
    const control = name === "two-readers" ? regressionBaseline : baseline;
    const originalSources = { "src/server/session-planning/index.ts": hash(control) };
    const manifest = { version: 1, note: "synthetic reviewed shared schema" };
    const comparison = {
      baselineRevision: control, mode: name === "two-readers" ? "identical" : "reviewed", requiresNativeSchemaControl: name !== "two-readers",
      originalSchemaSha256: hash(name === "two-readers" ? "shared-schema" : "old-schema"), candidateSchemaSha256: hash("shared-schema"),
      originalLockfileSha256: hash("lock"), candidateLockfileSha256: hash("lock"),
      historicalMigrations: { [migrationPath]: hash("migration") }, candidateMigrationHashes: { [migrationPath]: hash("migration") }, originalSourceHashes: originalSources,
      reviewedManifest: manifest, reviewedManifestSha256: hash(JSON.stringify(manifest)), reviewedManifestFileSha256: hash("reviewed file"),
    };
    for (const mode of ["latency", "diagnostic"]) {
      const diagnostic = mode === "diagnostic";
      for (let index = 0; index < (diagnostic ? 1 : 5); index++) {
        const start = diagnostic ? 0 : index * 4, end = diagnostic ? 3 : start + 4;
        const makeReport = (head: boolean) => {
          const rounds = [];
          for (let round = start; round < end; round++) {
            const multiplier = head ? 0.5 : 1;
            const duration = (round + 1) * 10 * multiplier;
            const policy = name === "deadline" ? "due-candidates" : name === "two-readers" ? "simultaneous" : "first-period";
            const output = { scenario: name, prelude: [{ operation: "prepare", result: "preserved" }], results: [name === "deadline" ? 1 : { done: true }, name === "deadline" ? 1 : { done: true }], expected: { durable: true } };
            const parity = { normalization: { version: 2 }, semanticAliases: { "@alias:synthetic": "full semantic identity" },
              tables: { Business: [{ state: "complete" }], RecoveryChange: [{ operation: "update", changedFields: ["state"] }], RecoveryFence: [{ value: 3 }], ProcedureResult: [...spec.map((row) => ({ id: row.operation, result: name === "deadline" ? 1 : { done: true } })), { id: `scenario:${name}`, result: output }] },
              continuationProvenance: [], clockEvidence: [{ complete: "preserved" }] };
            const calls = spec.map((row, callIndex) => ({ ...row, callId: row.operation, startedOffsetMs: callIndex,
              finishedOffsetMs: callIndex + duration, coordinationWaitMs: name === "deadline" ? 1 : 0,
              sample: { label: row.operation, elapsedMs: duration, succeeded: true, status: "succeeded", censored: false, elapsedIsLowerBound: false,
                ...(diagnostic ? { diagnostics: diagnosticCounters(multiplier) } : {}) } }));
            const selected = calls.map((row) => ({ callId: row.callId, ids: ["same-real-request"], observedOffsetMs: row.startedOffsetMs + 2, releasedOffsetMs: row.startedOffsetMs + 3 }));
            // Both callbacks release after the later SELECT completed (offset3).
            rounds.push({ round, calls, launchPolicy: policy, witness: policy === "due-candidates" ? { policy, selected } : policy === "first-period" ? { policy, firstAcquiredOffsetMs: 0.5 } : { policy }, output,
              after: { parity, digest: hash(JSON.stringify(parity)) } });
          }
          return { schemaVersion: 1, kind: "scheduling-concurrency-supplement", status: "PASS", case: name, mode, revision: head ? candidate : control,
            partition: { index, count: diagnostic ? 1 : 5, start, end, totalSamples: diagnostic ? 3 : 20, warmupRounds: 1 },
            fixture: { anchor, clockAdmission: createClockAdmission(anchor, anchor), syntheticRoster: 100 },
            startedAt: "2026-11-03T00:00:00.000Z", finishedAt: "2026-11-03T00:01:00.000Z",
            databaseClock: { startedAt: "2026-11-03T00:00:00.000Z", finishedAt: "2026-11-03T00:01:00.000Z" },
            runtime: { node: "v22.20.0", platform: "linux", arch: "x64", cpu: index % 2 ? "CPU A" : "CPU B", logicalCpus: 4 },
            profileRunner: { id: `${name}/${mode}/${index}`, name: "hosted", os: "Linux", arch: "X64" }, nodeImage: hash("immutable Node image"),
            harnessHashes: structuredClone(harness), sourceHashes: { "prisma/schema.prisma": hash("shared-schema"), "package-lock.json": hash("lock"), "src/server/session-planning/index.ts": hash(head ? candidate : control) },
            comparison: structuredClone(comparison), migrationFiles: [{ name: "20261103031000_shared", sha256: hash("migration") }], migrations: [{ name: "20261103031000_shared", sha256: hash("migration") }],
            postgresVersion: [{ server_version: "16.6" }], rounds };
        };
        entries.push({ reference: `${name}-${mode}-${index}`, baseline: makeReport(false), candidate: makeReport(true) });
      }
    }
  }
  return entries;
}
type Entries = ReturnType<typeof fixture>;
function frozenFixture(rows = fixture()) {
  return rows.filter((row) => row.baseline.case !== "two-readers").map((row) => {
    const frozen = structuredClone(row.candidate);
    frozen.revision = regressionBaseline;
    frozen.sourceHashes["src/server/session-planning/index.ts"] = hash(regressionBaseline);
    return { reference: row.reference, baseline: row.baseline, candidate: frozen };
  });
}
function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

void test("all six complete supplementary populations preserve exact outcomes, raw pairs and diagnostic attribution", () => {
  const result = aggregateConcurrent(fixture(), options);
  assert.equal(result.status, "PASS"); assert.equal(result.supplementaryOnly, true); assert.equal(result.exactAfterOutcomeParity, true);
  assert.equal(result.regressionBaselineRevision, regressionBaseline);
  assert.equal(result.cases.length, 6);
  let latencyRounds = 0, diagnosticRounds = 0;
  for (const row of result.cases) {
    latencyRounds += row.rawRounds.latency.length; diagnosticRounds += row.rawRounds.diagnostic.length;
    assert.equal(row.baselineRevision, row.case === "two-readers" ? regressionBaseline : baseline);
    assert.match(row.canonicalDigest, /^[a-f0-9]{64}$/);
    for (const raw of row.rawRounds.latency) assert.ok(raw.baseline.overlapMs > 0 && raw.candidate.overlapMs > 0);
    for (const operation of Object.values(row.operations)) {
      const before = operation.latency.baseline, after = operation.latency.candidate;
      const diagnosticBefore = operation.diagnostic.baseline, diagnosticAfter = operation.diagnostic.candidate;
      assert.ok(before && after && diagnosticBefore && diagnosticAfter);
      assert.equal(before.samples, 20);
      assert.equal(before.p50Ms, 100); assert.equal(before.p95Ms, 190);
      assert.equal(after.p50Ms, 50); assert.equal(after.p95Ms, 95);
      assert.equal(operation.rawPairs.length, 20);
      assert.equal(diagnosticBefore.samples, 3);
      assert.equal(diagnosticBefore.medianDriverCalls, 2);
      assert.equal(diagnosticAfter.medianProcessCpuUserMs, 0.5);
      assert.equal(diagnosticBefore.medianOfSampleEventLoopP95Ms, null);
      assert.equal(diagnosticBefore.raw.length, 3);
    }
  }
  assert.equal(latencyRounds, 120); assert.equal(diagnosticRounds, 18);
});

void test("nearest rank keeps all raw observations and does not interpolate p95", () => {
  assert.equal(nearestRank([10, 1, 7, 2], 0.5), 2); assert.equal(nearestRank([10, 1, 7, 2], 0.95), 10);
  assert.equal(nearestRank([], 0.95), null); assert.throws(() => nearestRank([1], 0));
});

void test("matching arms cannot drift together in one round, partition or diagnostic mode", () => {
  for (const target of ["one round", "another partition", "diagnostic mode"]) {
    const rows = fixture();
    const pair = target === "diagnostic mode"
      ? rows.find((row) => row.baseline.case === "cold" && row.baseline.mode === "diagnostic")!
      : target === "another partition"
        ? rows.find((row) => row.baseline.case === "cold" && row.baseline.mode === "latency" && row.baseline.partition.index === 1)!
        : rows[0]!;
    const index = target === "one round" ? 2 : 0;
    for (const report of [pair.baseline, pair.candidate]) {
      const after = report.rounds[index]!.after;
      after.parity.tables.Business[0]!.state = "both arms changed together";
      after.digest = hash(JSON.stringify(after.parity));
    }
    assert.deepEqual(pair.baseline.rounds[index]!.after, pair.candidate.rounds[index]!.after);
    assert.throws(() => aggregateConcurrent(rows, options), /canonical case outcome digest/);
  }
});

void test("frozen original-five is an independently pinned full result with reused original observations", () => {
  const rows = fixture(), frozen = frozenFixture(rows);
  const repaired = aggregateConcurrent(rows, options), oldCandidate = aggregateConcurrent(frozen, frozenOptions);
  assert.equal(repaired.caseSet, "six"); assert.equal(repaired.candidateArm, "head");
  assert.equal(oldCandidate.caseSet, "original-five"); assert.equal(oldCandidate.candidateArm, "frozen");
  assert.equal(oldCandidate.candidateRevision, regressionBaseline); assert.equal(oldCandidate.cases.length, 5);
  assert.ok(oldCandidate.cases.every((row) => row.case !== "two-readers" && row.baselineRevision === baseline));
  assert.equal(oldCandidate.cases.reduce((sum, row) => sum + row.rawRounds.latency.length, 0), 100);
  assert.equal(oldCandidate.cases.reduce((sum, row) => sum + row.rawRounds.diagnostic.length, 0), 15);
  assert.match(oldCandidate.baselineObservationPolicy, /does not create additional original trials/);
  assert.strictEqual(frozen[0]!.baseline, rows[0]!.baseline);
  assert.deepEqual(oldCandidate.cases[0]!.operations["cold:first"]!.rawPairs, repaired.cases[0]!.operations["cold:first"]!.rawPairs);
  assert.throws(() => aggregateConcurrent(frozen, { ...frozenOptions, candidate: "d".repeat(40) }), /frozen candidate\/regression pin/);
  assert.throws(() => aggregateConcurrent(frozen, { ...frozenOptions, candidateArm: "head" }), /case-set\/candidate-arm/);
  assert.throws(() => aggregateConcurrent(frozen, { ...options, candidate: regressionBaseline }), /Repaired candidate must differ/);
  const missing = frozenFixture(); missing.pop();
  assert.throws(() => aggregateConcurrent(missing, frozenOptions), /all 25 latency/);
  const wrong = frozenFixture(); wrong[0]!.candidate.revision = candidate;
  assert.throws(() => aggregateConcurrent(wrong, frozenOptions), /pinned revision/);
  const identityPair = fixture().find((row) => row.baseline.case === "two-readers")!;
  assert.throws(() => aggregateConcurrent([...frozenFixture(), identityPair], frozenOptions), /outside the explicitly selected/);
});

void test("triple-arm files retain the same physical base SHA and require every selected frozen report", () => {
  const root = mkdtempSync(join(tmpdir(), "concurrent-triple-arms-"));
  try {
    const rows = fixture(), frozen = frozenFixture(rows);
    for (const row of rows) {
      const directory = join(root, row.reference); mkdirSync(directory);
      for (const [arm, report] of [["base", row.baseline], ["head", row.candidate]] as const)
        writeFileSync(join(directory, `${arm}-${report.mode}.json`), JSON.stringify(report));
    }
    for (const row of frozen) writeFileSync(join(root, row.reference, `frozen-${row.candidate.mode}.json`), JSON.stringify(row.candidate));
    const repaired = aggregateConcurrent(loadConcurrentPairs(root), options);
    const oldCandidate = aggregateConcurrent(loadConcurrentPairs(root, frozenOptions), frozenOptions);
    const physicalBase = (result: ReturnType<typeof aggregateConcurrent>) => {
      const evidence = result.cases.find((row) => row.case === "cold")!.evidence.map(object)
        .find((row) => row.mode === "latency" && object(row.partition).index === 0);
      assert.ok(evidence); return object(evidence.files).base;
    };
    assert.deepEqual(physicalBase(repaired), physicalBase(oldCandidate));
    const first = frozen[0]!;
    rmSync(join(root, first.reference, `frozen-${first.candidate.mode}.json`));
    assert.throws(() => [...loadConcurrentPairs(root, frozenOptions)], /Missing frozen candidate/);
    // The repaired result is still independently validated from base+head.
    assert.equal(aggregateConcurrent(loadConcurrentPairs(root), options).status, "PASS");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

void test("CLI writes independently labelled frozen PASS even when the repaired comparison fails", () => {
  const root = mkdtempSync(join(tmpdir(), "concurrent-independent-cli-"));
  try {
    const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
    const actualHarness = currentHarnessHashes(sourceRoot);
    const rows = fixture();
    for (const row of rows) for (const report of [row.baseline, row.candidate]) report.harnessHashes = actualHarness;
    const frozen = frozenFixture(rows);
    const badAfter = rows[0]!.candidate.rounds[0]!.after;
    badAfter.parity.tables.Business[0]!.state = "repaired comparison must fail";
    badAfter.digest = hash(JSON.stringify(badAfter.parity));
    for (const row of rows) {
      const directory = join(root, row.reference); mkdirSync(directory);
      for (const [arm, report] of [["base", row.baseline], ["head", row.candidate]] as const)
        writeFileSync(join(directory, `${arm}-${report.mode}.json`), JSON.stringify(report));
    }
    for (const row of frozen) writeFileSync(join(root, row.reference, `frozen-${row.candidate.mode}.json`), JSON.stringify(row.candidate));
    const output = join(root, "repair-result.json"), frozenOutput = join(root, "frozen-result.json");
    const script = fileURLToPath(new URL("./concurrent-aggregate.mjs", import.meta.url));
    const command = spawnSync(process.execPath, [script, "--input", root, "--baseline", baseline, "--regression-baseline", regressionBaseline,
      "--candidate", candidate, "--output", output, "--frozen-candidate", regressionBaseline, "--frozen-output", frozenOutput], { encoding: "utf8", timeout: 20_000, maxBuffer: 4096 });
    assert.equal(command.status, 1);
    const repaired: unknown = JSON.parse(readFileSync(output, "utf8")), oldCandidate: unknown = JSON.parse(readFileSync(frozenOutput, "utf8"));
    assert.equal(object(repaired).status, "FAIL"); assert.equal(object(repaired).caseSet, "six");
    assert.equal(object(oldCandidate).status, "PASS"); assert.equal(object(oldCandidate).caseSet, "original-five");
    assert.equal(object(oldCandidate).candidateRevision, regressionBaseline);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const invalid: { name: string; change: (rows: Entries) => void; pattern: RegExp }[] = [
  { name: "missing partition", change: (rows) => { rows.pop(); }, pattern: /all 30 latency/ },
  { name: "duplicate artifact", change: (rows) => { rows[1] = rows[0]!; }, pattern: /Duplicate/ },
  { name: "wrong primary pin", change: (rows) => { rows[0]!.baseline.revision = regressionBaseline; }, pattern: /pinned revision/ },
  { name: "swapped regression control", change: (rows) => { rows.find((row) => row.baseline.case === "two-readers")!.baseline.revision = baseline; }, pattern: /pinned revision/ },
  { name: "missing global round", change: (rows) => { rows[0]!.baseline.rounds.pop(); }, pattern: /Missing measured/ },
  { name: "duplicate global round", change: (rows) => { rows[0]!.baseline.rounds[1]!.round = 0; }, pattern: /global rounds/ },
  { name: "missing call", change: (rows) => { rows[0]!.baseline.rounds[0]!.calls.pop(); }, pattern: /Exactly two real calls/ },
  { name: "admin substitute", change: (rows) => { rows[0]!.baseline.rounds[0]!.calls[0]!.role = "admin"; }, pattern: /participant call inventory/ },
  { name: "wrong role transport", change: (rows) => { rows[0]!.baseline.rounds[0]!.calls[0]!.transport = "domain"; }, pattern: /participant call inventory/ },
  { name: "remote operation failure", change: (rows) => { rows[0]!.baseline.rounds[0]!.calls[0]!.sample.succeeded = false; }, pattern: /successful real operation/ },
  { name: "censored elapsed", change: (rows) => { rows[0]!.baseline.rounds[0]!.calls[0]!.sample.censored = true; }, pattern: /uncensored/ },
  { name: "serial calls", change: (rows) => { const calls = rows[0]!.baseline.rounds[0]!.calls; calls[1]!.startedOffsetMs = 11; calls[1]!.finishedOffsetMs = 21; }, pattern: /positively overlap/ },
  { name: "second launched before actual fence", change: (rows) => { object(rows[0]!.baseline.rounds[0]!.witness).firstAcquiredOffsetMs = 2; }, pattern: /Second launch/ },
  { name: "hidden ordinary coordination wait", change: (rows) => { rows[0]!.baseline.rounds[0]!.calls[0]!.coordinationWaitMs = 1; }, pattern: /no deliberate wait/ },
  { name: "tampered full business graph", change: (rows) => { const after = rows[0]!.candidate.rounds[0]!.after; after.parity.tables.Business[0]!.state = "changed"; after.digest = hash(JSON.stringify(after.parity)); }, pattern: /complete after outcome/ },
  { name: "lost journal row", change: (rows) => { const after = rows[0]!.candidate.rounds[0]!.after; after.parity.tables.RecoveryChange.pop(); after.digest = hash(JSON.stringify(after.parity)); }, pattern: /complete after outcome/ },
  { name: "changed recovery fence", change: (rows) => { const after = rows[0]!.candidate.rounds[0]!.after; after.parity.tables.RecoveryFence[0]!.value++; after.digest = hash(JSON.stringify(after.parity)); }, pattern: /complete after outcome/ },
  { name: "changed complete scenario prelude", change: (rows) => { const round = rows[0]!.candidate.rounds[0]!; round.output.prelude[0]!.result = "changed prelude"; round.after.digest = hash(JSON.stringify(round.after.parity)); }, pattern: /complete after outcome/ },
  { name: "lost result row", change: (rows) => { const after = rows[0]!.candidate.rounds[0]!.after; after.parity.tables.ProcedureResult.pop(); after.digest = hash(JSON.stringify(after.parity)); }, pattern: /complete scenario/ },
  { name: "forged digest", change: (rows) => { rows[0]!.candidate.rounds[0]!.after.digest = hash("wrong"); }, pattern: /complete graph digest/ },
  { name: "missing source file", change: (rows) => { delete object(rows[0]!.baseline.sourceHashes)["src/server/session-planning/index.ts"]; }, pattern: /preserved baseline source/ },
  { name: "different harness", change: (rows) => { rows[0]!.baseline.harnessHashes[ORIGINAL_HARNESS_PATHS[0]!] = hash("different"); }, pattern: /harness bytes/ },
  { name: "missing actual migration", change: (rows) => { rows[0]!.baseline.migrations.pop(); }, pattern: /complete actual migrations/ },
  { name: "PostgreSQL clock crossing", change: (rows) => { rows[0]!.baseline.databaseClock.finishedAt = "2026-11-03T07:00:00.000Z"; }, pattern: /campaign deadline/ },
];
for (const { name, change, pattern } of invalid) void test(`supplement rejects ${name}`, () => {
  const rows = fixture(); change(rows); assert.throws(() => aggregateConcurrent(rows, options), pattern);
});

void test("deadline rendezvous retains waits and rejects different selections or early release", () => {
  for (const kind of ["different request", "empty selection", "early release", "lost numeric result"]) {
    const rows = fixture(), round = rows.find((row) => row.baseline.case === "deadline")!.baseline.rounds[0]!;
    const selected = round.witness.selected; assert.ok(selected);
    if (kind === "different request") selected[1]!.ids = ["other-request"];
    if (kind === "empty selection") selected[1]!.ids = [];
    if (kind === "early release") { selected[0]!.releasedOffsetMs = 2.5; round.calls[0]!.coordinationWaitMs = 0.5; }
    if (kind === "lost numeric result") { round.after.parity.tables.ProcedureResult[0]!.result = 0; round.after.digest = hash(JSON.stringify(round.after.parity)); }
    assert.throws(() => aggregateConcurrent(rows, options), /same single request|exactly one real request|before both SELECTs|returns one/);
  }
});

void test("diagnostics stay separate and counter corruption or instrumentation in latency fails", () => {
  const rows = fixture();
  const diagnostic = rows.find((row) => row.baseline.mode === "diagnostic")!.baseline.rounds[0]!.calls[0]!.sample.diagnostics;
  assert.ok(diagnostic); diagnostic.driverQueries.elapsedMs = 999;
  assert.throws(() => aggregateConcurrent(rows, options), /Query shape elapsed mismatch/);
  const mixed = fixture(); object(mixed[0]!.baseline.rounds[0]!.calls[0]!.sample).diagnostics = diagnosticCounters(1);
  assert.throws(() => aggregateConcurrent(mixed, options), /Instrumented observations/);
});

void test("try-lock attribution retains granted, denied and unknown observations apart from blocking intervals", () => {
  const rows = fixture();
  const pair = rows.find((row) => row.baseline.case === "two-readers" && row.baseline.mode === "diagnostic")!;
  for (const report of [pair.baseline, pair.candidate]) for (const round of report.rounds) {
    const d = round.calls[0]!.sample.diagnostics; assert.ok(d);
    object(d).advisoryTryLock = tryLockCounters();
    // Three exact try statements plus one existing blocking statement are
    // disjoint driver invocations. They already belong to driver elapsed time.
    d.driverQueries.count = d.queryShapes["SELECT:synthetic-hash"].count = 4;
    d.driverQueries.elapsedMs += 1.5; d.queryShapes["SELECT:synthetic-hash"].elapsedMs += 1.5;
  }
  const result = aggregateConcurrent(rows, options);
  const operation = result.cases.find((row) => row.case === "two-readers")!.operations["two-readers:first"]!;
  const before = operation.diagnostic.baseline; assert.ok(before);
  const t = before.advisoryTryLock;
  assert.equal(t.observedSamples, 3); assert.equal(t.unobservedSamples, 0);
  assert.equal(t.attempts, 9); assert.equal(t.granted, 3); assert.equal(t.denied, 3); assert.equal(t.errors, 0); assert.equal(t.unknown, 3);
  assert.equal(t.statement.pooledIntervalMedianMs, 0.5); assert.equal(t.statement.pooledIntervalP95Ms, 0.75);
  assert.equal(t.statement.perSampleSumMedianMs, 1.5);
  assert.equal(t.heldTransaction.pooledIntervalMedianMs, 2);
  assert.deepEqual(t.heldTransaction.rawIntervals.map((row) => row.elapsedMs), [2, 2, 2]);
  assert.equal(object(before.lockHeldTransaction).pooledIntervalMedianMs, 3);
  assert.equal(object(before.advisoryStatement).pooledIntervalMedianMs, 0.5);
  assert.equal(before.medianDriverCalls, 4); assert.equal(before.medianDriverElapsedMs, 3.5);
  assert.equal(t.rawAttempts.length, 9); assert.equal(t.rawAttempts[2]!.outcome, "unrecognized");
  assert.match(t.availability, /must never be summed/);
});

void test("absent historical and present-empty try-lock data retain distinct availability and null timings", () => {
  for (const emptyPresent of [false, true]) {
    const rows = fixture();
    if (emptyPresent) {
      const d = rows.find((row) => row.baseline.case === "two-readers" && row.baseline.mode === "diagnostic")!.baseline.rounds[0]!.calls[0]!.sample.diagnostics;
      assert.ok(d);
      object(d).advisoryTryLock = { attemptMs: [], outcomes: [], granted: 0, denied: 0, errors: 0, unrecognized: 0, implicitTransactionAcquisitions: 0, lockHeldTransactionMs: [], uncertainLockIntervals: [] };
    }
    const operation = aggregateConcurrent(rows, options).cases.find((row) => row.case === "two-readers")!.operations["two-readers:first"]!;
    const d = operation.diagnostic.baseline; assert.ok(d);
    assert.equal(d.advisoryTryLock.observedSamples, emptyPresent ? 1 : 0);
    assert.equal(d.advisoryTryLock.unobservedSamples, emptyPresent ? 2 : 3);
    assert.equal(d.advisoryTryLock.attempts, 0);
    assert.equal(d.advisoryTryLock.statement.pooledIntervalMedianMs, null);
    assert.equal(d.advisoryTryLock.statement.pooledIntervalP95Ms, null);
    assert.equal(d.advisoryTryLock.statement.perSampleSumMedianMs, null);
    assert.equal(d.advisoryTryLock.heldTransaction.pooledIntervalMedianMs, null);
  }
});

void test("try-lock schema, statuses, sums and unproven hold intervals fail closed", () => {
  const changes: { change: (value: ReturnType<typeof tryLockCounters>) => void; pattern: RegExp }[] = [
    { change: (value) => { value.attemptMs.pop(); }, pattern: /durations\/outcomes/ },
    { change: (value) => { value.outcomes[0] = "unknown"; }, pattern: /outcome status/ },
    { change: (value) => { value.denied++; }, pattern: /count\/status sum/ },
    { change: (value) => { value.granted = 0.5; }, pattern: /outcome count/ },
    { change: (value) => { value.attemptMs[0] = Number.NaN; }, pattern: /statement duration/ },
    { change: (value) => { value.lockHeldTransactionMs[0] = -1; }, pattern: /held interval/ },
    { change: (value) => { value.implicitTransactionAcquisitions = 2; }, pattern: /require proven grants/ },
    { change: (value) => { value.granted = 0; value.denied = 2; value.outcomes[0] = "denied"; }, pattern: /require proven grants/ },
    { change: (value) => { value.denied = 0; value.errors = 1; value.outcomes[1] = "error"; }, pattern: /Try-lock errors are not passing/ },
  ];
  for (const { change, pattern } of changes) {
    const rows = fixture();
    const d = rows.find((row) => row.baseline.mode === "diagnostic")!.baseline.rounds[0]!.calls[0]!.sample.diagnostics; assert.ok(d);
    const value = tryLockCounters(); change(value); object(d).advisoryTryLock = value;
    d.driverQueries.count = d.queryShapes["SELECT:synthetic-hash"].count = 4;
    assert.throws(() => aggregateConcurrent(rows, options), pattern);
  }
  const rows = fixture();
  const d = rows.find((row) => row.baseline.mode === "diagnostic")!.baseline.rounds[0]!.calls[0]!.sample.diagnostics; assert.ok(d);
  object(d).advisoryTryLock = tryLockCounters();
  assert.throws(() => aggregateConcurrent(rows, options), /populations exceed driver calls/);
});

void test("bounded file generator loads complete pairs serially and preserves file SHA references", () => {
  const root = mkdtempSync(join(tmpdir(), "concurrent-aggregate-"));
  try {
    for (const row of fixture()) {
      const directory = join(root, row.reference); mkdirSync(directory);
      for (const [arm, report] of [["base", row.baseline], ["head", row.candidate]] as const)
        writeFileSync(join(directory, `${arm}-${report.mode}.json`), JSON.stringify(report));
    }
    const loaded = loadConcurrentPairs(root);
    assert.equal(typeof loaded.next, "function");
    const result = aggregateConcurrent(loaded, options); assert.equal(result.status, "PASS");
    const file = join(root, fixture()[0]!.reference, "base-latency.json");
    const evidence = result.cases[0]!.evidence.map(object).find((row) => row.mode === "latency" && object(row.partition).index === 0);
    assert.ok(evidence);
    assert.equal(object(object(evidence.files).base).sha256, hash(readFileSync(file, "utf8")));
    writeFileSync(join(root, "head-budget.json"), "retained timeout");
    assert.throws(() => [...loadConcurrentPairs(root)], /Failure\/timeout sidecar/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

void test("CLI failure replaces stale PASS without executing application code", () => {
  const root = mkdtempSync(join(tmpdir(), "concurrent-aggregate-cli-")), output = join(root, "out.json");
  try {
    writeFileSync(output, JSON.stringify({ status: "PASS" }));
    const script = fileURLToPath(new URL("./concurrent-aggregate.mjs", import.meta.url));
    const command = spawnSync(process.execPath, [script, "--input", root, "--baseline", baseline, "--regression-baseline", regressionBaseline, "--candidate", candidate, "--output", output], { encoding: "utf8", timeout: 10_000, maxBuffer: 4096 });
    assert.equal(command.status, 1);
    const failed: unknown = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(object(failed).status, "FAIL"); assert.equal(object(failed).samplingComplete, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
