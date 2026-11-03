import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { validateReportClocks } from "../scheduling-profile/clock-admission.mjs";

/** Standalone supplementary protocol; original campaign inputs are never read.
 * @typedef {Record<string, any>} Evidence
 * @typedef {{samples:number,p50Ms:number|null,p95Ms:number|null}} LatencySummary
 * @typedef {{intervals:number,samplesWithIntervals:number,pooledIntervalMedianMs:number|null,pooledIntervalP95Ms:number|null,perSampleSumMedianMs:number|null,rawIntervals:{sampleIndex:number,intervalIndex:number,elapsedMs:number}[]}} IntervalSummary
 * @typedef {{samples:number,observedSamples:number,unobservedSamples:number,attempts:number,granted:number,denied:number,errors:number,unknown:number,implicitTransactionAcquisitions:number,statement:IntervalSummary,heldTransaction:IntervalSummary,uncertainLockIntervals:unknown[],rawAttempts:{sampleIndex:number,attemptIndex:number,outcome:string,elapsedMs:number}[],availability:string}} TryLockSummary
 * @typedef {{samples:number,medianDriverCalls:number|null,medianDriverElapsedMs:number|null,medianPrismaEvents:number|null,medianPrismaDurationMs:number|null,medianProcessCpuUserMs:number|null,medianProcessCpuSystemMs:number|null,medianEventLoopUtilization:number|null,eventLoopHistogramSamples:number,medianOfSampleEventLoopP95Ms:number|null,connectionAcquisition:unknown,advisoryStatement:unknown,lockHeldTransaction:unknown,advisoryTryLock:TryLockSummary,uncertainLockIntervals:unknown[],raw:unknown[]}} DiagnosticSummary
 * @typedef {{round:number,reference:string,partition:number,baseline:{overlapMs:number},candidate:{overlapMs:number}}} RoundEvidence
 * @typedef {{case:string,baselineRevision:string,canonicalDigest:string,latencyRoundsPerArm:number,diagnosticRoundsPerArm:number,operations:Record<string,{role:string,transport:string,latency:Record<string,LatencySummary>,rawPairs:unknown[],diagnostic:Record<string,DiagnosticSummary>}>,rawRounds:{latency:RoundEvidence[],diagnostic:RoundEvidence[]},evidence:unknown[]}} CaseSummary
 * @typedef {{schemaVersion:number,kind:string,status:string,supplementaryOnly:boolean,samplingComplete:boolean,exactAfterOutcomeParity:boolean,caseSet:string,candidateArm:string,baselineObservationPolicy:string,baselineRevision:string,regressionBaselineRevision:string,candidateRevision:string,sharedInputs:unknown,comparisonByControl:unknown,harnessHashes:unknown,sourceHashes:unknown,cases:CaseSummary[],interpretation:Record<string,string>}} ConcurrentAggregate
 */
const call = (/** @type {string} */ operation, /** @type {string} */ role, /** @type {string} */ transport) => Object.freeze({ operation, role, transport });
export const CONCURRENT_CASES = Object.freeze({
  cold: Object.freeze([call("cold:first", "tutor", "http"), call("cold:second", "tutee", "http")]),
  sunday: Object.freeze([call("sunday:first", "tutor", "domain"), call("sunday:second", "tutee", "domain")]),
  "proposal-split": Object.freeze([call("proposal-split:proposal", "tutor", "http"), call("proposal-split:split", "tutor", "http")]),
  acceptance: Object.freeze([call("acceptance:accept", "tutee", "http"), call("acceptance:read", "tutor", "http")]),
  deadline: Object.freeze([call("deadline:first", "maintenance", "domain"), call("deadline:second", "maintenance", "domain")]),
  "two-readers": Object.freeze([call("two-readers:first", "tutor", "http"), call("two-readers:second", "tutor", "http")]),
});
export const ORIGINAL_FIVE_CASES = Object.freeze(Object.keys(CONCURRENT_CASES).filter((name) => name !== "two-readers"));

/** Only the explicitly named frozen comparison may omit the regression case.
 * @param {string|undefined} caseSet @param {string|undefined} candidateArm */
function comparisonScope(caseSet, candidateArm) {
  const set = caseSet ?? "six", arm = candidateArm ?? "head";
  assert.ok((set === "six" && arm === "head") || (set === "original-five" && arm === "frozen"), "Invalid explicit case-set/candidate-arm combination");
  return { caseSet: set, candidateArm: arm, names: set === "six" ? Object.keys(CONCURRENT_CASES) : [...ORIGINAL_FIVE_CASES] };
}
export const ORIGINAL_HARNESS_PATHS = Object.freeze(["scripts/profile-scheduling-requests.ts", "scripts/scheduling-profile/fixtures.ts", "scripts/scheduling-profile/scenarios.ts", "scripts/scheduling-profile/metrics.ts", "scripts/scheduling-profile/parity.ts", "scripts/scheduling-profile/http.ts", "scripts/scheduling-profile/register-server-runtime.mjs", "scripts/scheduling-profile/server-runtime-hooks.mjs", "scripts/scheduling-profile/controlled-contention.ts", "scripts/scheduling-profile/contention-references.mjs", "scripts/scheduling-profile/contention-fence-witness.ts", "scripts/scheduling-profile/clock-admission.mjs"]);
const SUPPLEMENT_REQUIRED = ["concurrent-scenarios.ts", "run.ts", "wave.ts", "concurrent-aggregate.mjs", "concurrent-aggregate.test.ts", "run-worker.sh", "manifest.mjs"];
const hash = (/** @type {string|Buffer} */ value) => createHash("sha256").update(value).digest("hex");
const same = (/** @type {unknown} */ actual, /** @type {unknown} */ expected, /** @type {string} */ label) => assert.ok(isDeepStrictEqual(actual, expected), `Supplement differs: ${label}`);
/** @param {unknown} value @param {string} label @returns {Evidence} */
const record = (value, label) => { assert.ok(value && typeof value === "object" && !Array.isArray(value), `Missing ${label}`); return /** @type {Evidence} */ (value); };
/** @param {unknown} value @param {number} size @param {string} label */
const sha = (value, size, label) => { assert.ok(typeof value === "string" && new RegExp(`^[a-f0-9]{${size}}$`).test(value), `Invalid ${label}`); return value; };
/** @param {unknown} value @param {string} label */
const number = (value, label) => { assert.ok(typeof value === "number" && Number.isFinite(value) && value >= 0, `Invalid ${label}`); return value; };
/** Same completed-observation nearest-rank definition as metrics.ts.
 * @param {number[]} values @param {number} quantile */
export function nearestRank(values, quantile) {
  assert.ok(quantile > 0 && quantile <= 1);
  if (!values.length) return null;
  const value = [...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1];
  assert.ok(value !== undefined); return value;
}
/** @param {number[]} values */
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle]; assert.ok(upper !== undefined);
  if (sorted.length % 2) return upper;
  const lower = sorted[middle - 1]; assert.ok(lower !== undefined);
  return (lower + upper) / 2;
};

/** @param {unknown} value @param {string} label */
function hashMap(value, label) {
  const result = record(value, label);
  assert.ok(Object.keys(result).length > 0, `Empty ${label}`);
  for (const digest of Object.values(result)) sha(digest, 64, label);
  return result;
}

/** @param {Evidence} report @param {string} baseline */
function comparisonContract(report, baseline) {
  const manifest = record(report.comparison, "original comparison receipt");
  same(manifest.baselineRevision, baseline, "pinned comparison baseline");
  assert.ok(["identical", "schema-identical", "additive", "reviewed"].includes(manifest.mode), "Invalid schema protocol");
  const identical = ["identical", "schema-identical"].includes(manifest.mode);
  same(manifest.requiresNativeSchemaControl, !identical, "schema control protocol");
  for (const key of ["originalSchemaSha256", "candidateSchemaSha256", "originalLockfileSha256", "candidateLockfileSha256"]) sha(manifest[key], 64, key);
  same(manifest.originalLockfileSha256, manifest.candidateLockfileSha256, "unchanged dependencies");
  const migrations = hashMap(manifest.candidateMigrationHashes, "candidate migration inventory");
  const historical = hashMap(manifest.historicalMigrations, "historical migration inventory");
  for (const [path, digest] of Object.entries(historical)) same(migrations[path], digest, "unchanged historical migration");
  if (identical) {
    same(manifest.originalSchemaSha256, manifest.candidateSchemaSha256, "identical schema");
    same(historical, migrations, "identical migrations");
  }
  if (manifest.mode === "reviewed") {
    record(manifest.reviewedManifest, "reviewed manifest content");
    same(hash(JSON.stringify(manifest.reviewedManifest)), manifest.reviewedManifestSha256, "reviewed manifest content digest");
    sha(manifest.reviewedManifestFileSha256, 64, "reviewed manifest file digest");
  }
  const sources = hashMap(report.sourceHashes, "application source hashes");
  same(sources["prisma/schema.prisma"], manifest.candidateSchemaSha256, "actual shared schema");
  same(sources["package-lock.json"], manifest.candidateLockfileSha256, "actual dependency lock");
  if (report.revision === baseline) for (const [path, digest] of Object.entries(hashMap(manifest.originalSourceHashes, "original baseline sources")))
    same(sources[path], digest, "preserved baseline source");
  const expectedFiles = Object.entries(migrations).map(([path, digest]) => {
    assert.match(path, /^prisma\/migrations\/[^/]+\/migration\.sql$/);
    return { name: path.split("/")[2], sha256: digest };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  for (const key of ["migrationFiles", "migrations"]) {
    assert.ok(Array.isArray(report[key]), `Missing actual ${key}`);
    const actual = report[key].map((/** @type {Evidence} */ row) => ({ name: row.name, sha256: sha(row.sha256, 64, key) }))
      .sort((/** @type {Evidence} */ a, /** @type {Evidence} */ b) => String(a.name).localeCompare(String(b.name)));
    same(actual, expectedFiles, `complete actual ${key}`);
  }
  assert.ok(Array.isArray(report.postgresVersion) && report.postgresVersion.length === 1 && typeof report.postgresVersion[0]?.server_version === "string", "Missing PostgreSQL SHOW server_version");
  return manifest;
}

/** Exact parameterized planning try-lock statements have their own outcomes and
 * intervals. They can coexist with blocking locks in a transaction; never add
 * those held intervals together or reinterpret an unrecognized result as true.
 * @param {unknown} value */
function validateTryLock(value) {
  const t = record(value, "advisoryTryLock counters");
  same(Object.keys(t).sort(), ["attemptMs", "outcomes", "granted", "denied", "errors", "unrecognized", "implicitTransactionAcquisitions", "lockHeldTransactionMs", "uncertainLockIntervals"].sort(), "complete advisoryTryLock schema");
  assert.ok(Array.isArray(t.attemptMs) && Array.isArray(t.outcomes) && t.attemptMs.length === t.outcomes.length,
    "Try-lock attempt durations/outcomes must correspond");
  for (const duration of t.attemptMs) number(duration, "try-lock statement duration");
  for (const outcome of t.outcomes) assert.ok(["granted", "denied", "error", "unrecognized"].includes(outcome), "Invalid try-lock outcome status");
  for (const [key, outcome] of /** @type {const} */ ([["granted", "granted"], ["denied", "denied"], ["errors", "error"], ["unrecognized", "unrecognized"]])) {
    assert.ok(Number.isSafeInteger(t[key]) && t[key] >= 0, "Invalid try-lock outcome count");
    same(t[key], t.outcomes.filter((/** @type {unknown} */ status) => status === outcome).length, "try-lock outcome count/status sum");
  }
  same(t.granted + t.denied + t.errors + t.unrecognized, t.attemptMs.length, "complete try-lock attempt population");
  assert.ok(Number.isSafeInteger(t.implicitTransactionAcquisitions) && t.implicitTransactionAcquisitions >= 0,
    "Invalid try-lock implicit acquisition count");
  assert.ok(Array.isArray(t.lockHeldTransactionMs) && Array.isArray(t.uncertainLockIntervals), "Missing try-lock held/uncertain intervals");
  for (const duration of t.lockHeldTransactionMs) number(duration, "try-lock held interval");
  for (const interval of t.uncertainLockIntervals) {
    number(interval.observedMs, "uncertain try-lock interval");
    assert.ok(typeof interval.reason === "string" && interval.reason.length > 0, "Invalid uncertain try-lock reason");
  }
  assert.ok(t.implicitTransactionAcquisitions + t.lockHeldTransactionMs.length + t.uncertainLockIntervals.length <= t.granted,
    "Try-lock held/implicit intervals require proven grants");
  return t;
}

/** @param {unknown} value */
function diagnostics(value) {
  const d = record(value, "diagnostic counters");
  for (const key of ["count", "elapsedMs", "errors"]) number(d.driverQueries?.[key], `driver ${key}`);
  assert.ok(Number.isInteger(d.driverQueries.count) && d.driverQueries.errors === 0, "Diagnostic query errors are not passing evidence");
  number(d.prismaEvents?.count, "Prisma count"); number(d.prismaEvents?.durationMs, "Prisma duration");
  const shapes = record(d.queryShapes, "hashed query shapes");
  let count = 0, elapsed = 0, errors = 0;
  for (const row of Object.values(shapes)) {
    count += number(row.count, "shape count"); elapsed += number(row.elapsedMs, "shape elapsed"); errors += number(row.errors, "shape errors");
  }
  same(count, d.driverQueries.count, "complete driver query counts"); same(errors, 0, "query shape errors");
  assert.ok(Math.abs(elapsed - d.driverQueries.elapsedMs) <= Math.max(1e-6, elapsed * 1e-9), "Query shape elapsed mismatch");
  for (const key of ["connectionAcquisitionMs", "acquisitionStatementMs", "lockHeldTransactionMs"]) {
    assert.ok(Array.isArray(d[key]), `Missing ${key}`);
    for (const value of d[key]) number(value, key);
  }
  if (Object.hasOwn(d, "advisoryTryLock")) {
    const t = validateTryLock(d.advisoryTryLock);
    same(t.errors, 0, "Try-lock errors are not passing diagnostic evidence");
    assert.ok(t.attemptMs.length + d.acquisitionStatementMs.length <= d.driverQueries.count,
      "Try-lock and blocking statement populations exceed driver calls");
  }
  assert.ok(Array.isArray(d.uncertainLockIntervals), "Missing uncertain lock intervals");
  for (const row of d.uncertainLockIntervals) { number(row.observedMs, "uncertain interval"); assert.ok(typeof row.reason === "string"); }
  number(d.implicitTransactionLockAcquisitions, "implicit lock acquisitions");
  number(d.processCpuMs?.user, "user CPU"); number(d.processCpuMs?.system, "system CPU");
  assert.ok(number(d.eventLoopUtilization, "ELU") <= 1, "Invalid utilization fraction");
  if (d.eventLoopDelayMs !== null) for (const key of ["mean", "max", "p95"]) number(d.eventLoopDelayMs?.[key], "event loop delay");
  same(d.overlappedAnotherRequest, true, "profiler observed concurrent requests");
  return d;
}

/** @param {Evidence} round @param {Evidence[]} calls @param {string} name */
function validateWave(round, calls, name) {
  const policy = name === "deadline" ? "due-candidates" : name === "two-readers" ? "simultaneous" : "first-period";
  same(round.launchPolicy, policy, "declared launch policy");
  const witness = record(round.witness, "real coordination witness"); same(witness.policy, policy, "observed launch policy");
  const first = calls[0], second = calls[1]; assert.ok(first && second);
  const overlap = Math.min(first.finishedOffsetMs, second.finishedOffsetMs) - Math.max(first.startedOffsetMs, second.startedOffsetMs);
  assert.ok(overlap > 0, "Two real call intervals must positively overlap");
  if (policy === "first-period") {
    const acquired = number(witness.firstAcquiredOffsetMs, "first period acquisition offset");
    assert.ok(first.startedOffsetMs <= acquired && acquired < first.finishedOffsetMs && acquired <= second.startedOffsetMs, "Second launch preceded first actual period acquisition");
    for (const row of calls) same(row.coordinationWaitMs, 0, "no deliberate wait in ordinary launch");
  } else if (policy === "simultaneous") {
    for (const row of calls) same(row.coordinationWaitMs, 0, "no deliberate wait in simultaneous readers");
  } else {
    assert.ok(Array.isArray(witness.selected) && witness.selected.length === 2, "Two completed candidate SELECT observations required");
    const selected = calls.map((row) => {
      const matches = witness.selected.filter((/** @type {Evidence} */ entry) => entry.callId === row.callId);
      same(matches.length, 1, "unique selected-candidate call");
      const entry = record(matches[0], "selected candidate");
      assert.ok(Array.isArray(entry.ids) && entry.ids.length === 1 && typeof entry.ids[0] === "string" && entry.ids[0].length > 0, "Each SELECT must return exactly one real request");
      const observed = number(entry.observedOffsetMs, "SELECT observation"), released = number(entry.releasedOffsetMs, "SELECT release");
      assert.ok(row.startedOffsetMs <= observed && observed <= released && released <= row.finishedOffsetMs, "SELECT rendezvous lies outside real call");
      assert.ok(Math.abs(row.coordinationWaitMs - (released - observed)) <= 1, "Measured rendezvous wait differs from witness");
      return entry;
    });
    const firstSelection = selected[0], secondSelection = selected[1]; assert.ok(firstSelection && secondSelection);
    same(firstSelection.ids, secondSelection.ids, "both SELECTs observed the same single request");
    const bothObserved = Math.max(...selected.map((row) => row.observedOffsetMs));
    assert.ok(selected.every((row) => row.releasedOffsetMs >= bothObserved), "Rendezvous released before both SELECTs completed");
  }
  return overlap;
}

/** @param {unknown} value @param {string} revision @param {string} baseline @param {Evidence} harness */
function validateReport(value, revision, baseline, harness) {
  const report = record(value, "supplement report");
  same(report.kind, "scheduling-concurrency-supplement", "standalone kind"); same(report.schemaVersion, 1, "schema version");
  same(report.status, "PASS", "completed report status"); same(report.revision, revision, "pinned revision");
  for (const key of ["failure", "error", "parityFailure"]) assert.ok(!Object.hasOwn(report, key), "Failed report is not passing evidence");
  const spec = CONCURRENT_CASES[/** @type {keyof typeof CONCURRENT_CASES} */ (report.case)]; assert.ok(spec, "Unknown supplementary case");
  assert.ok(["latency", "diagnostic"].includes(report.mode), "Unknown measurement mode");
  const diagnostic = report.mode === "diagnostic", partition = record(report.partition, "partition");
  assert.ok(Number.isInteger(partition.index) && partition.index >= 0 && partition.index < (diagnostic ? 1 : 5), "Invalid partition index");
  same(partition, { index: partition.index, count: diagnostic ? 1 : 5, start: diagnostic ? 0 : partition.index * 4,
    end: diagnostic ? 3 : partition.index * 4 + 4, totalSamples: diagnostic ? 3 : 20, warmupRounds: 1 }, "fixed complete round population");
  validateReportClocks(report);
  same(hashMap(report.harnessHashes, "harness hashes"), harness, "exact reviewed harness bytes");
  sha(report.nodeImage, 64, "immutable Node image");
  const runtime = record(report.runtime, "runtime"); assert.match(runtime.node, /^v22\./); same(runtime.platform, "linux", "Linux runtime");
  assert.ok(typeof runtime.arch === "string" && typeof runtime.cpu === "string" && Number.isInteger(runtime.logicalCpus) && runtime.logicalCpus > 0, "Incomplete hardware evidence");
  const runner = record(report.profileRunner, "runner identity");
  for (const key of ["id", "name", "os", "arch"]) assert.ok(typeof runner[key] === "string" && runner[key].length > 0, "Missing runner identity");
  const manifest = comparisonContract(report, baseline);
  assert.ok(Array.isArray(report.rounds) && report.rounds.length === partition.end - partition.start, "Missing measured round receipts");
  same(report.rounds.map((/** @type {Evidence} */ row) => row.round), Array.from({ length: partition.end - partition.start }, (_, i) => partition.start + i), "ordered exact global rounds");
  const elapsed = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
  const rounds = report.rounds.map((/** @type {Evidence} */ round) => {
    assert.ok(Object.hasOwn(round, "output"), "Missing raw scenario output/postcondition receipt");
    assert.ok(Array.isArray(round.calls) && round.calls.length === 2, "Exactly two real calls required");
    const calls = round.calls.map((/** @type {Evidence} */ row, /** @type {number} */ index) => {
      const expected = spec[index]; assert.ok(expected);
      same({ operation: row.operation, role: row.role, transport: row.transport }, expected, "exact participant call inventory");
      same(row.callId, expected.operation, "semantic call ID");
      const start = number(row.startedOffsetMs, "call start"), end = number(row.finishedOffsetMs, "call finish");
      assert.ok(end > start && end <= elapsed, "Invalid actual call interval");
      const wait = number(row.coordinationWaitMs, "inclusive coordination wait");
      const sample = record(row.sample, "raw profiler sample"); same(sample.label, row.operation, "profiler label");
      same(sample.succeeded, true, "successful real operation"); same(sample.status, "succeeded", "completed real operation");
      same(sample.censored, false, "uncensored sample"); same(sample.elapsedIsLowerBound, false, "final elapsed observation");
      assert.ok(!Object.hasOwn(sample, "error"), "Operation failures are not passing evidence");
      const duration = number(sample.elapsedMs, "operation duration");
      assert.ok(duration > 0 && duration <= end - start + 1 && wait <= duration + 1, "Call/profiler/wait timing mismatch");
      if (diagnostic) diagnostics(sample.diagnostics); else assert.ok(!Object.hasOwn(sample, "diagnostics"), "Instrumented observations cannot enter latency population");
      return row;
    });
    const overlapMs = validateWave(round, calls, report.case);
    const after = record(round.after, "complete normalized after outcome"), parity = record(after.parity, "full parity snapshot");
    same(parity.normalization?.version, 2, "reviewed normalization version");
    for (const key of ["tables", "semanticAliases"]) record(parity[key], key);
    for (const key of ["clockEvidence", "continuationProvenance"]) assert.ok(Array.isArray(parity[key]), `Missing ${key}`);
    same(hash(JSON.stringify(parity)), sha(after.digest, 64, "after digest"), "complete graph digest");
    const results = parity.tables.ProcedureResult;
    assert.ok(Array.isArray(results) && results.length === 3, "Both calls and complete scenario/prelude results must be captured");
    same(results.map((/** @type {Evidence} */ row) => row.id).sort(), [...spec.map((row) => row.operation), `scenario:${report.case}`].sort(), "exact normalized procedure-result labels");
    if (report.case === "deadline") for (const row of results.filter((/** @type {Evidence} */ value) => value.id !== "scenario:deadline")) same(row.result, 1, "each real due-candidate sweep returns one");
    return { round, calls, overlapMs, after };
  });
  return { report, rounds, manifest };
}

/** Missing historic instrumentation is unobserved, not evidence of zero tries.
 * Counts below describe only observed attempts; null medians retain empty data.
 * @param {Evidence[]} ds @returns {TryLockSummary} */
function tryLockAttribution(ds) {
  const perSample = ds.map((d) => Object.hasOwn(d, "advisoryTryLock") ? d.advisoryTryLock : null);
  const observed = perSample.filter((value) => value !== null);
  const interval = (/** @type {string} */ key) => {
    const values = observed.flatMap((value) => value[key]);
    return { intervals: values.length, samplesWithIntervals: observed.filter((value) => value[key].length).length,
      pooledIntervalMedianMs: median(values), pooledIntervalP95Ms: nearestRank(values, 0.95),
      perSampleSumMedianMs: values.length ? median(observed.map((value) => value[key].reduce((/** @type {number} */ sum, /** @type {number} */ duration) => sum + duration, 0))) : null,
      rawIntervals: perSample.flatMap((value, sampleIndex) => value === null ? []
        : value[key].map((/** @type {number} */ elapsedMs, /** @type {number} */ intervalIndex) => ({ sampleIndex, intervalIndex, elapsedMs }))) };
  };
  const sum = (/** @type {string} */ key) => observed.reduce((total, value) => total + value[key], 0);
  return { samples: ds.length, observedSamples: observed.length, unobservedSamples: ds.length - observed.length,
    attempts: observed.reduce((total, value) => total + value.attemptMs.length, 0),
    granted: sum("granted"), denied: sum("denied"), errors: sum("errors"), unknown: sum("unrecognized"),
    implicitTransactionAcquisitions: sum("implicitTransactionAcquisitions"),
    statement: interval("attemptMs"), heldTransaction: interval("lockHeldTransactionMs"),
    uncertainLockIntervals: perSample.flatMap((value, sampleIndex) => value === null ? []
      : value.uncertainLockIntervals.map((/** @type {Evidence} */ row) => ({ sampleIndex, ...row }))),
    rawAttempts: perSample.flatMap((value, sampleIndex) => value === null ? []
      : value.attemptMs.map((/** @type {number} */ elapsedMs, /** @type {number} */ attemptIndex) => ({ sampleIndex, attemptIndex, outcome: value.outcomes[attemptIndex], elapsedMs }))),
    availability: "Only present instrumentation is observed. Unknown means raw unrecognized; absent historic fields do not prove zero attempts. Try-lock and blocking held intervals may overlap and must never be summed." };
}

/** @param {Evidence[]} rows @returns {DiagnosticSummary} */
function attribution(rows) {
  const ds = rows.map((row) => row.sample.diagnostics);
  const delays = ds.map((d) => d.eventLoopDelayMs).filter((value) => value !== null);
  const interval = (/** @type {string} */ key) => {
    const values = ds.flatMap((d) => d[key]);
    return { intervals: values.length, samplesWithIntervals: ds.filter((d) => d[key].length).length,
      pooledIntervalMedianMs: median(values), perSampleSumMedianMs: values.length ? median(ds.map((d) => d[key].reduce((/** @type {number} */ sum, /** @type {number} */ value) => sum + value, 0))) : null };
  };
  return { samples: rows.length, medianDriverCalls: median(ds.map((d) => d.driverQueries.count)), medianDriverElapsedMs: median(ds.map((d) => d.driverQueries.elapsedMs)),
    medianPrismaEvents: median(ds.map((d) => d.prismaEvents.count)), medianPrismaDurationMs: median(ds.map((d) => d.prismaEvents.durationMs)),
    medianProcessCpuUserMs: median(ds.map((d) => d.processCpuMs.user)), medianProcessCpuSystemMs: median(ds.map((d) => d.processCpuMs.system)),
    medianEventLoopUtilization: median(ds.map((d) => d.eventLoopUtilization)), eventLoopHistogramSamples: delays.length,
    medianOfSampleEventLoopP95Ms: median(delays.map((d) => d.p95)),
    connectionAcquisition: interval("connectionAcquisitionMs"), advisoryStatement: interval("acquisitionStatementMs"), lockHeldTransaction: interval("lockHeldTransactionMs"),
    advisoryTryLock: tryLockAttribution(ds),
    uncertainLockIntervals: ds.flatMap((d) => d.uncertainLockIntervals), raw: rows };
}

/** One partition pair at a time, plus one full canonical graph per fixed case.
 * This bounds retained graphs independently of partition/round count while
 * preventing both arms from drifting together in a single passing pair.
 * @param {Iterable<{reference:string,baseline:unknown,candidate:unknown,files?:unknown}>} inputs
 * @param {{baseline:string,regressionBaseline:string,candidate:string,expectedHarnessHashes:Evidence,caseSet?:string,candidateArm?:string}} options
 * @returns {ConcurrentAggregate} */
export function aggregateConcurrent(inputs, options) {
  const baseline = sha(options.baseline, 40, "baseline pin"), candidate = sha(options.candidate, 40, "candidate pin"); assert.notEqual(baseline, candidate);
  const regressionBaseline = sha(options.regressionBaseline, 40, "regression baseline pin");
  const scope = comparisonScope(options.caseSet, options.candidateArm);
  assert.ok(regressionBaseline !== baseline, "Regression control must be separately pinned");
  if (scope.candidateArm === "frozen") same(candidate, regressionBaseline, "exact frozen candidate/regression pin");
  else assert.ok(regressionBaseline !== candidate, "Repaired candidate must differ from the regression control");
  const harness = hashMap(options.expectedHarnessHashes, "expected harness inventory");
  for (const path of ORIGINAL_HARNESS_PATHS) assert.ok(Object.hasOwn(harness, path), `Missing original harness ${path}`);
  for (const path of SUPPLEMENT_REQUIRED) assert.ok(Object.hasOwn(harness, `scripts/scheduling-concurrency/${path}`), `Missing supplementary harness ${path}`);
  /** @type {Map<string, Evidence>} */ const groups = new Map();
  const identities = new Set(), runners = new Set(), references = new Set();
  /** @type {Evidence|undefined} */ let common;
  /** @type {Record<string, Evidence>} */ const sources = {};
  /** @type {Record<string, Evidence>} */ const comparisons = {};
  /** @type {Map<string,{digest:string,parity:unknown}>} */ const canonicalOutcomes = new Map();
  let count = 0;
  for (const input of inputs) {
    assert.ok(typeof input.reference === "string" && input.reference.length && !references.has(input.reference), "Duplicate/missing artifact reference"); references.add(input.reference);
    const inputCase = record(input.baseline, "baseline report").case;
    assert.ok(scope.names.includes(inputCase), "Case is outside the explicitly selected comparison population");
    const control = inputCase === "two-readers" ? regressionBaseline : baseline;
    const before = validateReport(input.baseline, control, control, harness), after = validateReport(input.candidate, candidate, control, harness);
    if (inputCase === "two-readers") assert.ok(["identical", "schema-identical"].includes(before.manifest.mode), "Two-readers requires identical-schema prior-candidate control");
    for (const key of ["case", "mode", "partition", "fixture", "runtime", "profileRunner", "nodeImage", "comparison", "migrationFiles", "migrations", "postgresVersion"])
      same(before.report[key], after.report[key], `paired ${key}`);
    const key = `${before.report.case}/${before.report.mode}/${before.report.partition.index}`;
    assert.ok(!identities.has(key), "Duplicate case/mode/partition"); identities.add(key);
    assert.ok(!runners.has(before.report.profileRunner.id), "Runner pair identity reused"); runners.add(before.report.profileRunner.id);
    const shared = { anchor: before.report.fixture.anchor, clockAdmission: before.report.fixture.clockAdmission, nodeImage: before.report.nodeImage,
      candidateSchemaSha256: before.manifest.candidateSchemaSha256, candidateLockfileSha256: before.manifest.candidateLockfileSha256,
      candidateMigrationHashes: before.manifest.candidateMigrationHashes,
      migrationFiles: before.report.migrationFiles, migrations: before.report.migrations, postgresVersion: before.report.postgresVersion,
      runtime: { node: before.report.runtime.node, platform: before.report.runtime.platform, arch: before.report.runtime.arch } };
    if (common) same(shared, common, "shared campaign inputs"); else common = shared;
    if (comparisons[control]) same(before.manifest, comparisons[control], "fixed comparison within control group");
    else comparisons[control] = before.manifest;
    for (const validated of [before, after]) {
      if (sources[validated.report.revision]) same(validated.report.sourceHashes, sources[validated.report.revision], "immutable revision source inventory");
      else sources[validated.report.revision] = validated.report.sourceHashes;
    }
    const name = before.report.case;
    let group = groups.get(name);
    if (!group) { group = { baselineRevision: control, fixture: before.report.fixture, latency: [], diagnostic: [], evidence: [] }; groups.set(name, group); }
    same(before.report.fixture, group.fixture, "fixed per-case fixture");
    const roundPairs = before.rounds.map((left, index) => {
      const right = after.rounds[index]; assert.ok(right);
      same(right.round.round, left.round.round, "paired global round");
      same(right.after.parity, left.after.parity, `complete after outcome ${name}/${before.report.mode}/${left.round.round}`);
      same(right.after.digest, left.after.digest, "paired exact outcome digest");
      const canonical = canonicalOutcomes.get(name);
      if (canonical) {
        same(left.after.digest, canonical.digest, `canonical case outcome digest ${name} across rounds/partitions/modes`);
        same(left.after.parity, canonical.parity, `complete canonical case outcome ${name}`);
      } else canonicalOutcomes.set(name, { digest: left.after.digest, parity: left.after.parity });
      return { round: left.round.round, reference: input.reference, partition: before.report.partition.index,
        baseline: { calls: left.calls, overlapMs: left.overlapMs, launchPolicy: left.round.launchPolicy, witness: left.round.witness, output: left.round.output, digest: left.after.digest },
        candidate: { calls: right.calls, overlapMs: right.overlapMs, launchPolicy: right.round.launchPolicy, witness: right.round.witness, output: right.round.output, digest: right.after.digest } };
    });
    group[before.report.mode].push(...roundPairs);
    group.evidence.push({ reference: input.reference, files: input.files ?? null, mode: before.report.mode, partition: before.report.partition,
      profileRunner: before.report.profileRunner, runtime: before.report.runtime, baselineRevision: control, candidateRevision: candidate });
    count++;
  }
  same(count, scope.names.length * 6, scope.caseSet === "six" ? "all 30 latency and six diagnostic pairs" : "all 25 latency and five diagnostic frozen pairs");
  /** @type {CaseSummary[]} */
  const cases = Object.entries(CONCURRENT_CASES).filter(([name]) => scope.names.includes(name)).map(([name, spec]) => {
    const group = groups.get(name); assert.ok(group, "Missing supplementary case");
    const canonical = canonicalOutcomes.get(name); assert.ok(canonical, "Missing canonical case outcome");
    for (const [mode, total] of /** @type {const} */ ([["latency", 20], ["diagnostic", 3]])) {
      group[mode].sort((/** @type {Evidence} */ a, /** @type {Evidence} */ b) => a.round - b.round);
      same(group[mode].map((/** @type {Evidence} */ row) => row.round), Array.from({ length: Number(total) }, (_, i) => i), `complete ${name}/${mode} rounds`);
    }
    return { case: name, baselineRevision: group.baselineRevision, canonicalDigest: canonical.digest, latencyRoundsPerArm: 20, diagnosticRoundsPerArm: 3, operations: Object.fromEntries(spec.map(({ operation, role, transport }) => {
      const paired = group.latency.map((/** @type {Evidence} */ row) => ({ round: row.round, reference: row.reference, baseline: row.baseline.calls.find((/** @type {Evidence} */ c) => c.operation === operation), candidate: row.candidate.calls.find((/** @type {Evidence} */ c) => c.operation === operation) }));
      return [operation, { role, transport, latency: Object.fromEntries(["baseline", "candidate"].map((arm) => {
        const values = paired.map((/** @type {Evidence} */ row) => row[arm].sample.elapsedMs);
        return [arm, { samples: values.length, p50Ms: nearestRank(values, 0.5), p95Ms: nearestRank(values, 0.95) }];
      })), rawPairs: paired, diagnostic: Object.fromEntries(["baseline", "candidate"].map((arm) => [arm, attribution(group.diagnostic.map((/** @type {Evidence} */ row) => row[arm].calls.find((/** @type {Evidence} */ c) => c.operation === operation)))])) }];
    })), rawRounds: { latency: group.latency, diagnostic: group.diagnostic }, evidence: group.evidence };
  });
  return { schemaVersion: 1, kind: "scheduling-concurrency-supplement-aggregate", status: "PASS", supplementaryOnly: true,
    samplingComplete: true, exactAfterOutcomeParity: true, baselineRevision: baseline, regressionBaselineRevision: regressionBaseline, candidateRevision: candidate,
    caseSet: scope.caseSet, candidateArm: scope.candidateArm,
    baselineObservationPolicy: "The same original-five base-file SHA/runner observations can be paired separately with head and frozen revisions. Reuse does not create additional original trials; do not pool baseline counts across these independent results.",
    sharedInputs: common, comparisonByControl: comparisons, harnessHashes: harness, sourceHashes: sources, cases,
    interpretation: { latency: "Raw completed per-operation nearest-rank p50/p95; 20 samples per case/operation/arm. Original campaign is separate.",
      coordination: "All calls overlap. Primary launches are first-period ordered; deadline uses real two-SELECT rendezvous with measured coordination wait INCLUDED in raw latency. Two-readers launches simultaneously against its separate prior-candidate control. No service-time subtraction or uncensored-latency claim.",
      diagnostics: "Three separate instrumented observations per operation/arm. Driver time is cumulative client duration; blocking advisory and try-lock statements are separate, neither is exact server wait. Separate held intervals may overlap and must not be added. Optional historic try-lock absence is unobserved, not proof of zero attempts. CPU/ELU are process-wide overlapping observations and must not be summed. Median of sample loop p95 is not pooled p95.",
      parity: "Every paired round compared by complete normalized graph equality and digest, including procedure results, clocks and journals. Each fixed case also retains one identical full canonical outcome across all rounds, partitions and modes. No order sorting, missing rows, failed calls or admin substitutes accepted." } };
}

/** @param {string} directory @param {{caseSet?:string,candidateArm?:string}} [options] */
export function* loadConcurrentPairs(directory, options = {}) {
  const root = resolve(directory);
  const scope = comparisonScope(options.caseSet, options.candidateArm);
  /** @type {{path:string,mode:string,names:Set<string>}[]} */ const pairs = [];
  const visit = (/** @type {string} */ path) => {
    const children = readdirSync(path, { withFileTypes: true }), names = new Set(children.filter((e) => e.isFile()).map((e) => e.name));
    for (const mode of ["latency", "diagnostic"]) if (["base", "head", "frozen"].some((arm) => names.has(`${arm}-${mode}.json`))) {
      pairs.push({ path, mode, names });
    }
    // Orphan failure evidence must also be seen, even without a report file.
    if (!["latency", "diagnostic"].some((mode) => ["base", "head", "frozen"].some((arm) => names.has(`${arm}-${mode}.json`))))
      for (const name of names) assert.ok(!new RegExp(`^(?:base|${scope.candidateArm}).*(?:parity-failure|command-exit|budget)\\.json$`).test(name), "Failure/timeout sidecar retained");
    for (const entry of children) if (entry.isDirectory()) visit(join(path, entry.name));
  };
  visit(root);
  if (scope.caseSet === "six") same(pairs.length, 36, "exact supplementary artifact count");
  let selectedCount = 0;
  for (const pair of pairs) {
    /** @type {Evidence} */ const files = {};
    const read = (/** @type {string} */ arm) => {
      const path = join(pair.path, `${arm}-${pair.mode}.json`), stat = statSync(path);
      assert.ok(stat.size > 0 && stat.size <= 64 * 1024 * 1024, "Report outside bounded 64 MiB supplementary input size");
      const bytes = readFileSync(path); files[arm] = { path: relative(root, path).replaceAll("\\", "/"), sha256: hash(bytes), bytes: bytes.length };
      return /** @type {unknown} */ (JSON.parse(bytes.toString("utf8")));
    };
    assert.ok(pair.names.has(`base-${pair.mode}.json`), "Missing baseline report in supplementary pair");
    const baseline = read("base"), name = record(baseline, "baseline report").case;
    if (scope.caseSet === "original-five" && name === "two-readers") continue;
    assert.ok(scope.names.includes(name), "Case is outside the explicitly selected comparison population");
    for (const file of pair.names) assert.ok(!new RegExp(`^(?:base|${scope.candidateArm}).*(?:parity-failure|command-exit|budget)\\.json$`).test(file), "Failure/timeout sidecar retained");
    assert.ok(pair.names.has(`${scope.candidateArm}-${pair.mode}.json`), `Missing ${scope.candidateArm} candidate report in supplementary pair`);
    const candidate = read(scope.candidateArm);
    selectedCount++;
    yield { reference: relative(root, pair.path).replaceAll("\\", "/"), baseline, candidate, files };
  }
  same(selectedCount, scope.names.length * 6, "exact selected supplementary artifact count");
}

/** CLI checks the exact bytes of every supplement file plus the frozen twelve.
 * @param {string} root @returns {Record<string,string>} */
export function currentHarnessHashes(root) {
  /** @type {Record<string,string>} */ const result = {};
  for (const path of ORIGINAL_HARNESS_PATHS) result[path] = hash(readFileSync(join(root, path)));
  const visit = (/** @type {string} */ directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result[relative(root, path).replaceAll("\\", "/")] = hash(readFileSync(path));
    }
  };
  visit(join(root, "scripts/scheduling-concurrency")); return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  /** @type {Map<string,string>} */ const flags = new Map();
  /** @type {string|undefined} */ let output, frozenOutput;
  const failed = (/** @type {unknown} */ error, /** @type {string} */ caseSet, /** @type {string} */ candidateArm) => ({ status: "FAIL", supplementaryOnly: true, samplingComplete: false, exactAfterOutcomeParity: false,
    caseSet, candidateArm, error: error instanceof Error ? error.message.slice(0, 1000) : "Invalid supplementary evidence" });
  const write = (/** @type {string} */ path, /** @type {unknown} */ report) => {
    mkdirSync(dirname(resolve(path)), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  };
  try {
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i], value = process.argv[i + 1];
      assert.ok(key && ["--input", "--baseline", "--regression-baseline", "--candidate", "--output", "--frozen-candidate", "--frozen-output"].includes(key) && value && !flags.has(key), "Expected --input DIR --baseline SHA --regression-baseline SHA --candidate SHA --output FILE [--frozen-candidate SHA --frozen-output FILE]"); flags.set(key, value);
    }
    output = flags.get("--output"); assert.ok(output, "Missing output path");
    frozenOutput = flags.get("--frozen-output");
    same(flags.has("--frozen-candidate"), flags.has("--frozen-output"), "both explicit frozen comparison arguments");
    const input = flags.get("--input"); assert.ok(input, "Missing input directory");
    const baseline = sha(flags.get("--baseline"), 40, "baseline pin"), candidate = sha(flags.get("--candidate"), 40, "candidate pin");
    const regressionBaseline = sha(flags.get("--regression-baseline"), 40, "regression baseline pin");
    const frozenCandidate = flags.has("--frozen-candidate") ? sha(flags.get("--frozen-candidate"), 40, "frozen candidate pin") : undefined;
    if (frozenCandidate) {
      same(frozenCandidate, regressionBaseline, "exact frozen candidate/regression pin");
      assert.ok(frozenCandidate !== candidate && frozenOutput && resolve(frozenOutput) !== resolve(output), "Frozen and repaired comparisons require distinct revisions and output files");
    }
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const expectedHarnessHashes = currentHarnessHashes(root);
    const tasks = [{ output, candidate, caseSet: "six", candidateArm: "head" },
      ...(frozenCandidate && frozenOutput ? [{ output: frozenOutput, candidate: frozenCandidate, caseSet: "original-five", candidateArm: "frozen" }] : [])];
    // Independent outcomes: one failed repaired comparison cannot prevent the
    // frozen result from being validated/written, or vice versa. Shared physical
    // base-file hashes identify reused trials; these outputs must not be pooled.
    for (const task of tasks) {
      try {
        const report = aggregateConcurrent(loadConcurrentPairs(input, task), {
          baseline, regressionBaseline, candidate: task.candidate, expectedHarnessHashes,
          caseSet: task.caseSet, candidateArm: task.candidateArm,
        });
        write(task.output, report);
      } catch (error) {
        process.exitCode = 1; write(task.output, failed(error, task.caseSet, task.candidateArm));
      }
    }
  } catch (error) {
    process.exitCode = 1;
    if (output) write(output, failed(error, "six", "head"));
    else process.stderr.write("Invalid supplementary aggregate arguments\n");
    if (frozenOutput && frozenOutput !== output) write(frozenOutput, failed(error, "original-five", "frozen"));
  }
}
