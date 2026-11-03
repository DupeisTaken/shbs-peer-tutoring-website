import { validateReportClocks } from "./clock-admission.mjs";
import assert from "node:assert/strict";
import { constants as bufferConstants } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { performance } from "node:perf_hooks";
import { CONTENTION_ORDERS, CONTENTION_SCENARIOS, assertContentionReferenceCompatibility, loadContentionReferences, validateFreeContentionReceipt } from "./contention-references.mjs";

/** Parsed receipt fields are checked at runtime before use. The public result
 * types below deliberately expose no unchecked JSON values to TypeScript callers.
 * @typedef {Record<string, any>} Evidence
 * @typedef {{label:string,elapsedMs:number,succeeded:boolean,status:string,round:number,sampleIndex:number}} Observation
 * @typedef {{samples:number,completed:number,errors:number,unfinished:number,censored:number,p50Ms:number|null,p95Ms:number|null}} Summary
 * @typedef {{round:number,occurrence:number,partition:number,runnerId:string,reference:string,baselineMs:number,candidateMs:number,candidateOverBaseline:number|null,baselineSucceeded:boolean,candidateSucceeded:boolean,baselineContentionOrder?:string,candidateContentionOrder?:string,baselineHistoryOrder?:string,candidateHistoryOrder?:string,sameContentionOrder?:boolean,sameHistoryOrder?:boolean}} PairedObservation
 * @typedef {{baseline:Summary,candidate:Summary,pairedRatios:{count:number,zeroBaselineCount:number,p50:number|null,p95:number|null,unmatchedOrderCount?:number,unmatchedHistoryCount?:number},paired:PairedObservation[]}} Operation
 * @typedef {{reference:string,baseline:unknown,candidate:unknown,comparison:unknown,nodeImage:string,native?:unknown,files?:unknown}} PartitionInput
 * @typedef {import("./contention-references.mjs").ContentionReferences} ContentionReferences
 * @typedef {{report:Evidence,rows:Observation[],parity:Evidence,digest:string,contentionOutcomes:Map<number,Evidence>}} Validated
 * @typedef {{entry:PartitionInput,before:Validated,after:Validated,native?:Validated,index:number}} Part
 * @typedef {{required:boolean,reported:boolean,semanticComparisonToSharedSchema:boolean,scenario?:string,rounds?:number,schemaSha256?:string,operations?:Record<string,Summary>,evidence?:unknown[]}} NativeControl
 * @typedef {{schemaVersion:number,partitionProtocolVersion:number,status:string,samplingComplete:boolean,latencyComparisonEligible:boolean,baselineRevision:string,catalogBaselineRevision:string|null,baselineComparisons:Record<string,unknown>,candidateRevision:string,anchor:string,sharedInputs:unknown,scenarios:{scenario:string,baselineRevision:string,rounds:number,partitions:number,semanticDigest:string|null,contention?:unknown,operations:Record<string,Operation>,evidence:unknown[]}[],controlledDiagnostics:unknown,nativeControl:NativeControl,interpretation:Record<string,string>}} AggregateReport
 */

export const latencyScenarios = Object.freeze(["cold", "warm", "sunday", "negotiation", "allocation", "catalog", "contention"]);
const harnessPaths = ["scripts/profile-scheduling-requests.ts", "scripts/scheduling-profile/fixtures.ts", "scripts/scheduling-profile/scenarios.ts", "scripts/scheduling-profile/clock-admission.mjs", "scripts/scheduling-profile/metrics.ts", "scripts/scheduling-profile/parity.ts", "scripts/scheduling-profile/http.ts", "scripts/scheduling-profile/register-server-runtime.mjs", "scripts/scheduling-profile/server-runtime-hooks.mjs", "scripts/scheduling-profile/controlled-contention.ts", "scripts/scheduling-profile/contention-references.mjs", "scripts/scheduling-profile/contention-fence-witness.ts"];
/** @param {string} scenario */
const totalSamples = (scenario) => scenario === "cold" || scenario === "sunday" ? 20 : 40;
/** @param {string | Buffer} value */
const hash = (value) => createHash("sha256").update(value).digest("hex");
/** @param {unknown} value @param {string} name @returns {Evidence} */
const record = (value, name) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  return /** @type {Evidence} */ (value);
};
/** @param {unknown} value @param {string} name @returns {string} */
const text = (value, name) => {
  assert.ok(typeof value === "string" && value.length > 0, `${name} must be a nonempty string`);
  return value;
};
/** @param {unknown} value @param {number} length @param {string} name @returns {string} */
const sha = (value, length, name) => {
  assert.ok(typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value), `${name} must be an immutable lowercase hash`);
  return value;
};
/** Full semantic graphs are compared without constructing unbounded assertion
 * diffs on failure. Raw paired receipts retain the inspectable evidence.
 * @param {unknown} actual @param {unknown} expected @param {string} name */
const same = (actual, expected, name) => assert.ok(isDeepStrictEqual(actual, expected), `Incomparable ${name}`);
/** @param {number[]} values @param {number} fraction @returns {number|null} */
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
};

/** One source of truth for the hosted matrix; samples are TOTAL rounds, never four.
 * @param {string} phase */
export function profileMatrix(phase = "all") {
  assert.ok(["all", "preflight", "remaining"].includes(phase), "Unknown matrix phase; use all, preflight or remaining");
  const include = [
    ...latencyScenarios.flatMap((scenario) => Array.from({ length: totalSamples(scenario) / 4 }, (_, partition) => ({
      scenario, mode: "latency", partition, partitionCount: totalSamples(scenario) / 4, samples: totalSamples(scenario),
    }))),
    ...[...latencyScenarios, "backlog", "contention-bulk-first", "contention-acceptance-first"].map((scenario) => ({
      scenario, mode: "diagnostic", partition: 0, partitionCount: 1, samples: scenario === "backlog" ? 1 : 3,
    })),
  ];
  if (phase === "all") return { include };
  return { include: include.filter((row) => {
    const preflight = row.mode === "diagnostic" && ["negotiation", "allocation", "catalog", "contention-bulk-first", "contention-acceptance-first"].includes(row.scenario);
    return phase === "preflight" ? preflight : !preflight;
  }) };
}

/** Version-one scenario population, checked independently of reported summaries.
 * Setup and discarded warmups never enter this population.
 * @param {string} scenario @returns {Record<string,number>} */
export function expectedOperationPopulation(scenario) {
  /** @param {string[]} names */
  const http = (names) => Object.fromEntries(names.map((name) => [`http:${name}`, 1]));
  switch (scenario) {
    case "cold": return http(["cold-tutor-agenda", "after-cold-tutee-agenda"]);
    case "warm": return { ...http(["steady-clean-tutor-agenda", "steady-clean-tutee-agenda", "warm-pending-offer", "post-proposal-first-agenda", "post-proposal-second-agenda"]), "domain:post-proposal-publication-recheck": 1 };
    case "sunday": return { "domain:sunday-cold-agenda": 1, "domain:sunday-second-agenda": 1, "domain:sunday-steady-clean-agenda": 1 };
    case "negotiation": return { ...http(["propose-one", "accept-one", "accept-receipt-retry", "stale-response", "propose-all", "reject-with-alternative", "request-split", "formalize-split", "propose-extra", "propose-deadline"]), "domain:deadline-before": 1, "domain:deadline-at": 1 };
    case "allocation": return http(["retry-room-still-short", "retry-unchanged-shortage", "retry-room-available", "tutor-schedule-save", "stale-schedule-save", "bulk-stale-rejection", "bulk-ten-units", "pairing-create", "pairing-create-retry", "permission-refresh-after-demotion"]);
    case "catalog": return http(["catalog-label-only", "catalog-weekday", "catalog-clock-and-attendance"]);
    case "contention": return { ...http(["competing-schedule-a", "competing-schedule-b", "contention-pending-room", "contended-bulk", "contended-acceptance"]), "http:concurrent-2-agenda": 2, "http:concurrent-4-agenda": 4 };
    default: assert.fail(`Unsupported latency scenario ${scenario}`);
  }
}

/** @param {string} scenario @param {string} label */
function failureAllowed(scenario, label) {
  return (scenario === "negotiation" && label === "http:stale-response") ||
    (scenario === "allocation" && ["http:stale-schedule-save", "http:bulk-stale-rejection", "http:permission-refresh-after-demotion"].includes(label));
}

/** @param {unknown} value @param {string} scenario @param {string} revision @param {number} index @param {Evidence} manifest @param {boolean} native @param {ContentionReferences} [contentionReferences] @returns {Validated} */
function validateReport(value, scenario, revision, index, manifest, native = false, contentionReferences) {
  const report = record(value, "Report");
  same(report.status, "PASS", "report status (partial/failing runs are not evidence)");
  assert.ok(!Object.hasOwn(report, "failure") && !Object.hasOwn(report, "error") && !Object.hasOwn(report, "parityFailure") &&
    (!Object.hasOwn(report, "cleanupErrors") || (Array.isArray(report.cleanupErrors) && report.cleanupErrors.length === 0)), "Report retains a failure/cleanup error");
  same(report.revision, revision, "immutable revision");
  same(report.schemaVersion, 3, "report schema version");
  same(report.partitionProtocolVersion, 1, "partition protocol");
  same(report.mode, "latency", "measurement mode; diagnostics cannot enter latency pooling");
  same(report.transport, "http", "HTTP transport");
  same(report.samplingComplete, false, "partition samplingComplete");
  same(report.partitionComplete, true, "partition completion");
  same(report.latencyComparisonEligible, false, "partition latency eligibility");
  const count = totalSamples(scenario) / 4;
  same(report.partition, { index, count, start: index * 4, end: index * 4 + 4, totalSamples: totalSamples(scenario), warmupRounds: 1 }, "exact four-round partition");
  const fixture = record(report.fixture, "Fixture");
  same(fixture.scenarios, [scenario], "scenario population");
  same(fixture.samples, totalSamples(scenario), "total sample count (cannot lower caps/population)");
  same(fixture.transport, "http", "fixture transport");
  validateReportClocks(report);
  const runner = record(report.profileRunner, "Runner evidence");
  for (const key of ["id", "name", "os", "arch"]) text(runner[key], `Runner ${key}`);
  const runtime = record(report.runtime, "Runtime");
  assert.match(runtime.node, /^v22\./, "Representative runtime requires Node 22");
  same(runtime.platform, "linux", "runtime platform");
  text(runtime.arch, "Runtime architecture");
  text(runtime.cpu, "Runtime CPU evidence");
  assert.ok(Number.isInteger(runtime.logicalCpus) && runtime.logicalCpus > 0, "Missing runtime CPU population");
  const database = record(report.database, "Owned database evidence");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.host) && database.port === 55439 && database.name === "shbs_performance_test" && database.poolMax === 6, "Wrong/missing owned database evidence");
  assert.ok(Array.isArray(report.postgresVersion) && report.postgresVersion.length === 1 && typeof report.postgresVersion[0]?.server_version === "string", "Missing PostgreSQL runtime version");
  assert.ok(Number.isFinite(report.elapsedMs) && report.elapsedMs >= 0, "Missing completed elapsed time");
  assert.ok(Number.isInteger(report.timeoutMs) && report.timeoutMs >= 30_000 && report.timeoutMs <= (native ? 90_000 : 150_000) && report.elapsedMs <= report.timeoutMs, "Censored/over-budget command cannot establish latency");
  assert.ok(Number.isFinite(Date.parse(report.startedAt)) && Number.isFinite(Date.parse(report.finishedAt)) && Date.parse(report.finishedAt) >= Date.parse(report.startedAt), "Missing completed report timestamps");
  assert.ok(Array.isArray(report.phaseTimings) && report.phaseTimings.length > 0 && report.phaseTimings.every((phase) => phase.status === "completed" && phase.elapsedIsLowerBound === false && Number.isFinite(phase.elapsedMs) && phase.elapsedMs >= 0), "Incomplete/failed/censored harness phase");
  same(report.httpUnauthorized, [{ case: "missing", status: 401, code: "UNAUTHORIZED" }, { case: "wrong", status: 401, code: "UNAUTHORIZED" }], "real HTTP denial evidence");
  assert.ok(report.http?.loopback === true && Number.isInteger(report.http.requests) && report.http.requests >= 2, "Missing actual HTTP transport evidence");
  const sources = record(report.sourceHashes, "Source hashes");
  for (const digest of Object.values(sources)) sha(digest, 64, "Source hash");
  same(sources["prisma/schema.prisma"], native ? manifest.originalSchemaSha256 : manifest.candidateSchemaSha256, "source schema hash");
  same(sources["package-lock.json"], native ? manifest.originalLockfileSha256 : manifest.candidateLockfileSha256, "dependency lock hash");
  const migrationHashes = native ? manifest.historicalMigrations : manifest.candidateMigrationHashes;
  record(migrationHashes, "Expected migration hashes");
  assert.ok(Array.isArray(report.migrationFiles) && Array.isArray(report.migrations), "Missing migration evidence");
  const files = Object.fromEntries(report.migrationFiles.map((entry) => {
    record(entry, "Migration file");
    sha(entry.sha256, 64, "Migration bytes");
    return [`prisma/migrations/${text(entry.name, "Migration name")}/migration.sql`, entry.sha256];
  }));
  same(Object.keys(files).length, report.migrationFiles.length, "unique migration files");
  same(files, migrationHashes, "exact migration file inventory");
  const applied = new Set();
  for (const row of report.migrations) {
    record(row, "Applied migration");
    assert.ok(!applied.has(row.name), "Duplicate applied migration");
    applied.add(row.name);
    /** @type {Evidence | undefined} */
    const file = report.migrationFiles.find((entry) => entry.name === row.name);
    assert.ok(file && [file.sha256, file.lfSha256, file.crlfSha256].includes(row.checksum), "Applied migration checksum differs");
  }
  same(applied.size, report.migrationFiles.length, "complete applied migrations");
  const receipts = report.receipts;
  assert.ok(Array.isArray(receipts) && receipts.length === 4, "Partition needs all four completed receipts");
  same(receipts.map((receipt) => receipt.round).sort((a, b) => a - b), [index * 4, index * 4 + 1, index * 4 + 2, index * 4 + 3], "global receipt rounds");
  const contentionOutcomes = new Map();
  if (scenario === "contention") {
    assert.ok(contentionReferences, "Validated contention references are required");
    assertContentionReferenceCompatibility(report, contentionReferences);
    same(report.contentionReferenceDigests, Object.fromEntries(CONTENTION_ORDERS.map((order) => [order, contentionReferences.byOrder[order].digest])), "exact frozen contention reference digests");
    same(report.contentionOutcomeParity, true, "validated contention outcome parity");
  }
  const first = receipts.find((receipt) => receipt.round === index * 4);
  record(first.parity, "First LOCAL full parity");
  sha(first.digest, 64, "Semantic digest");
  same(hash(JSON.stringify(first.parity)), first.digest, "full parity digest");
  for (const receipt of receipts) {
    same(receipt.scenario, scenario, "receipt scenario");
    if (scenario === "contention") {
      record(receipt.parity, "Every free contention round requires its full actual graph");
      assert.ok(CONTENTION_ORDERS.includes(receipt.contentionOrder), "Missing/invalid actual contention lock order");
      assert.ok(CONTENTION_ORDERS.includes(receipt.contentionHistoryOrder), "Missing/invalid contention history order");
      assert.ok(contentionReferences, "Validated contention references are required");
      const outcome = validateFreeContentionReceipt(report, receipt, contentionReferences);
      same(outcome.actualOrder, receipt.contentionOrder, "validated actual contention lock order");
      same(outcome.historyOrder, receipt.contentionHistoryOrder, "validated exact contention history order");
      contentionOutcomes.set(receipt.round, outcome);
    } else same(receipt.digest, first.digest, "all local round semantic digests");
    for (const key of ["receiptInputs", "pairingCreations", "operationWindows", "parityWindow"]) assert.ok(Array.isArray(receipt[key]), `Missing completed receipt ${key}`);
    assert.ok("output" in receipt, "Missing raw operation output receipt");
    if (scenario !== "contention" && receipt.parity) same(receipt.parity, first.parity, "retained full parity");
  }
  const metrics = record(report.metrics, "Metrics");
  same(metrics.mode, "latency", "raw metric mode");
  assert.ok(Array.isArray(metrics.samples) && Array.isArray(report.sampleRounds), "Missing raw samples/round index");
  same(report.sampleRounds.length, metrics.samples.length, "sample-round index coverage");
  const population = expectedOperationPopulation(scenario);
  /** @type {Observation[]} */
  const rows = [];
  const seen = new Set();
  for (const link of report.sampleRounds) {
    record(link, "Sample-round index");
    assert.ok(Number.isInteger(link.sampleIndex) && link.sampleIndex >= 0 && link.sampleIndex < metrics.samples.length && !seen.has(link.sampleIndex), "Duplicate/out-of-range sample index");
    seen.add(link.sampleIndex);
    const sample = record(metrics.samples[link.sampleIndex], "Raw completed sample");
    same(link.scenario, scenario, "sample scenario");
    assert.ok(Number.isInteger(link.round) && link.round >= index * 4 && link.round < index * 4 + 4, "Warmup/foreign round entered measured population");
    same(link.label, sample.label, "sample label index");
    assert.ok(Object.hasOwn(population, sample.label), "Unexpected operation label");
    assert.ok(Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= 0, "Invalid elapsed sample");
    same(sample.censored, false, "uncensored sample");
    same(sample.elapsedIsLowerBound, false, "completed elapsed sample");
    assert.ok(sample.status === "succeeded" || sample.status === "failed", "Unfinished sample");
    same(sample.succeeded, sample.status === "succeeded", "operation completion status");
    if (sample.succeeded) assert.ok(!sample.error, "Successful sample retains an error");
    else same(sample.error, "OPERATION_FAILED", "completed operation failure");
    assert.ok(!sample.diagnostics, "Instrumented diagnostic sample cannot enter latency pool");
    rows.push({ label: text(sample.label, "Sample label"), elapsedMs: Number(sample.elapsedMs),
      succeeded: sample.succeeded === true, status: text(sample.status, "Completed status"),
      round: link.round, sampleIndex: link.sampleIndex });
  }
  for (let round = index * 4; round < index * 4 + 4; round++) {
    const current = rows.filter((sample) => sample.round === round);
    const counts = Object.fromEntries(Object.keys(population).map((label) => [label, current.filter((sample) => sample.label === label).length]));
    same(counts, population, "complete expected per-round operation population");
    for (const sample of current) {
      if (scenario === "contention" && sample.label.startsWith("http:competing-schedule-")) continue;
      same(sample.succeeded, !failureAllowed(scenario, sample.label), "intentional operation-error contract");
    }
    if (scenario === "contention") same(current.filter((sample) => sample.label.startsWith("http:competing-schedule-") && !sample.succeeded).length, 1, "one intentional competing request conflict");
  }
  const operationSummaries = record(metrics.operations, "Operation summaries");
  same(Object.keys(operationSummaries).sort(), Object.keys(population).sort(), "operation summary label coverage");
  for (const [label, value] of Object.entries(operationSummaries)) {
    const summary = record(value, "Completed operation summary");
    const selected = rows.filter((sample) => sample.label === label);
    same({ samples: summary.samples, completed: summary.completed, errors: summary.errors, unfinished: summary.unfinished, censored: summary.censored }, {
      samples: selected.length, completed: selected.length, errors: selected.filter((sample) => !sample.succeeded).length, unfinished: 0, censored: 0,
    }, "summary agrees with completed raw samples");
    assert.ok(!("p50Ms" in summary) && !("p95Ms" in summary), "Partition must not advertise final quantiles");
  }
  return { report, rows, parity: first.parity, digest: first.digest, contentionOutcomes };
}

/** @param {Observation[]} rows @returns {Summary} */
function summary(rows) {
  return {
    samples: rows.length, completed: rows.length,
    errors: rows.filter((row) => !row.succeeded).length, unfinished: 0, censored: 0,
    p50Ms: percentile(rows.map((row) => row.elapsedMs), 0.5),
    p95Ms: percentile(rows.map((row) => row.elapsedMs), 0.95),
  };
}

/** @param {Part[]} parts @param {ContentionReferences} references */
function contentionPopulationEvidence(parts, references) {
  /** @type {Record<string, unknown>} */
  const arms = {};
  for (const arm of ["baseline", "candidate"]) {
    const reports = parts.map((part) => arm === "baseline" ? part.before : part.after);
    arms[arm] = Object.fromEntries(CONTENTION_ORDERS.map((order) => {
      const rounds = reports.flatMap((value) => [...value.contentionOutcomes].filter(([, outcome]) => outcome.actualOrder === order).map(([round, outcome]) => ({ round, outcome })));
      const rows = reports.flatMap((value) => value.rows.filter((row) => value.contentionOutcomes.get(row.round)?.actualOrder === order));
      return [order, { rounds: rounds.length, certifiedDisagreements: rounds.filter(({ outcome }) => outcome.certifiedDisagreement).length,
        historyOrderCounts: Object.fromEntries(CONTENTION_ORDERS.map((history) => [history, rounds.filter(({ outcome }) => outcome.historyOrder === history).length])),
        operations: Object.fromEntries(Object.keys(expectedOperationPopulation("contention")).map((label) => [label, summary(rows.filter((row) => row.label === label))])) }];
    }));
  }
  const pairedRounds = parts.flatMap((part) => part.before.report.receipts.map((/** @type {Evidence} */ receipt) => {
    const before = part.before.contentionOutcomes.get(receipt.round), after = part.after.contentionOutcomes.get(receipt.round);
    assert.ok(before && after);
    return { partition: part.index, round: receipt.round, baseline: before, candidate: after,
      sameActualOrder: before.actualOrder === after.actualOrder, sameHistoryOrder: before.historyOrder === after.historyOrder };
  }));
  return { referenceDigests: Object.fromEntries(CONTENTION_ORDERS.map((order) => [order, references.byOrder[order].digest])),
    strataBasis: "Positively validated actual period-lock acquisition order", arms, pairedRounds,
    certifiedDisagreementCounts: { baseline: pairedRounds.filter((row) => row.baseline.certifiedDisagreement).length,
      candidate: pairedRounds.filter((row) => row.candidate.certifiedDisagreement).length } };
}

/** Deliberate hold/poll/checkpoint time remains in these raw diagnostic samples.
 * @param {ContentionReferences} references */
function controlledDiagnosticEvidence(references) {
  return references.controlledEvidence.map((entry) => ({ order: entry.order, scenario: entry.scenario,
    reference: entry.reference, mode: "diagnostic", latencyComparisonEligible: false,
    arms: Object.fromEntries(["baseline", "candidate"].map((arm) => {
      const report = record(arm === "baseline" ? entry.baseline : entry.candidate, "Controlled diagnostic report");
      return [arm, { revision: report.revision, measuredRounds: 3, rawSamples: report.sampleRounds.map((/** @type {Evidence} */ link) => ({ ...link, sample: report.metrics.samples[link.sampleIndex] })),
        controllerEvidence: report.preparationEvidence, elapsedMs: report.elapsedMs, profileRunner: report.profileRunner, runtime: report.runtime }];
    })),
  }));
}

/** Pure validation and aggregation. Each entry is one downloaded runner artifact:
 * {reference,baseline,candidate,comparison,nodeImage,native?,files?}. No timing is
 * accepted without its complete paired runner, protocol and semantic evidence.
 * @param {PartitionInput[]} inputs @param {{baseline:string,candidate:string,catalogBaseline?:string,contentionReferences?:ContentionReferences}} options
 * @returns {AggregateReport}
 */
export function aggregatePartitions(inputs, options) {
  const baseline = sha(options.baseline, 40, "Expected baseline");
  const candidate = sha(options.candidate, 40, "Expected candidate");
  const contentionReferences = options.contentionReferences;
  assert.ok(contentionReferences, "Validated contention references are required for the complete aggregate");
  same(contentionReferences.expectedBaseline, baseline, "contention reference baseline revision");
  same(contentionReferences.expectedCandidate, candidate, "contention reference candidate revision");
  const catalogBaseline = options.catalogBaseline === undefined ? undefined
    : sha(options.catalogBaseline, 40, "Expected catalog baseline");
  assert.ok(Array.isArray(inputs) && inputs.length === 60, "Require all 60 latency partitions across all seven scenarios");
  /** @type {Map<string,Part[]>} */
  const groups = new Map(latencyScenarios.map((scenario) => [scenario, []]));
  const runners = new Set();
  const references = new Set();
  /** @type {Evidence | undefined} */
  let common;
  /** @type {Map<string, Evidence>} */
  const baseSources = new Map();
  /** @type {Map<string, Evidence>} */
  const baselineComparisons = new Map();
  /** @type {Evidence | undefined} */
  let headSources;
  /** @type {string | undefined} */
  let controlScope;
  for (const entry of inputs) {
    record(entry, "Partition input");
    text(entry.reference, "Raw partition reference");
    assert.ok(!references.has(entry.reference), "Duplicate partition artifact reference");
    references.add(entry.reference);
    const rawBase = record(entry.baseline, "Baseline report");
    const scenario = rawBase.fixture?.scenarios?.[0];
    assert.ok(groups.has(scenario), "Unexpected/missing latency scenario");
    const catalogControl = catalogBaseline !== undefined && scenario === "catalog";
    const expectedBaseline = scenario === "catalog" ? catalogBaseline ?? baseline : baseline;
    const controlGroup = catalogControl ? "catalog" : "primary";
    const manifest = record(entry.comparison, "Comparison manifest");
    same(manifest.baselineRevision, expectedBaseline, "comparison baseline revision");
    const selection = manifest.baselineSelectionPath;
    /** @type {string | undefined} */
    let entryScope;
    if (selection !== null) {
      const scoped = typeof selection === "string"
        ? /^\.github\/scheduling-profile-manifests\/pr-([1-9][0-9]*)-baseline\.txt$/.exec(selection) : null;
      if (catalogControl) {
        const catalogScoped = typeof selection === "string"
          ? /^\.github\/scheduling-profile-manifests\/pr-([1-9][0-9]*)-catalog-baseline\.txt$/.exec(selection) : null;
        assert.ok(catalogScoped, "Invalid catalog baseline selection path");
        entryScope = text(catalogScoped[1], "Catalog PR scope");
        assert.ok(Number.isSafeInteger(Number(entryScope)), "Invalid catalog PR-scoped baseline number");
        same(manifest.baselineSelectionSource, "reviewed-pr-catalog-baseline-file", "catalog baseline selection source");
        same(manifest.reviewedManifestPath, `.github/scheduling-profile-manifests/pr-${entryScope}.json`, "catalog matching reviewed manifest path");
        same(manifest.mode, "reviewed", "catalog reviewed schema comparison mode");
      } else if (scoped) {
        entryScope = text(scoped[1], "Primary PR scope");
        assert.ok(Number.isSafeInteger(Number(entryScope)), "Invalid PR-scoped baseline number");
        same(manifest.baselineSelectionSource, "reviewed-pr-baseline-file", "PR-scoped baseline selection source");
        same(manifest.reviewedManifestPath, `.github/scheduling-profile-manifests/pr-${scoped[1]}.json`, "PR-scoped matching reviewed manifest path");
        same(manifest.mode, "reviewed", "PR-scoped reviewed schema comparison mode");
      } else {
        assert.ok(catalogBaseline === undefined, "Mixed controls require a PR-scoped primary baseline file");
        same(selection, ".github/scheduling-profile-manifests/baseline.txt", "reviewed baseline selection path");
        same(manifest.baselineSelectionSource, "reviewed-baseline-file", "reviewed baseline selection source");
      }
      const lfPinHash = hash(`${expectedBaseline}\n`);
      const pinHashes = catalogControl ? [lfPinHash] : [hash(expectedBaseline), lfPinHash];
      assert.ok(pinHashes.includes(sha(manifest.baselineSelectionFileSha256, 64, "Reviewed baseline file hash")), "Reviewed baseline file does not pin the expected immutable SHA");
      assert.ok(typeof manifest.reviewedManifestPath === "string" && /^\.github\/scheduling-profile-manifests\/[A-Za-z0-9_-]+\.json$/.test(manifest.reviewedManifestPath), "Reviewed baseline requires an explicit reviewed schema manifest");
      record(manifest.reviewedManifest, "Reviewed schema manifest");
      sha(manifest.reviewedManifestFileSha256, 64, "Reviewed manifest file hash");
      same(hash(JSON.stringify(manifest.reviewedManifest)), manifest.reviewedManifestSha256, "reviewed schema manifest digest");
    } else {
      assert.ok(!catalogControl, "Catalog control requires its exact reviewed PR baseline file");
      assert.ok(catalogBaseline === undefined, "Mixed controls require a PR-scoped primary baseline file");
      same(manifest.baselineSelectionFileSha256, null, "absent reviewed baseline file hash");
      assert.ok(["default-baseline", "manual-baseline", "explicit-cli"].includes(manifest.baselineSelectionSource), "Unknown baseline selection source");
    }
    if (catalogBaseline !== undefined) {
      assert.ok(entryScope, "Mixed controls require explicit PR-scoped baseline files");
      if (controlScope !== undefined) same(entryScope, controlScope, "mixed-control primary/catalog PR scope");
      else controlScope = entryScope;
    }
    assert.ok(["identical", "additive", "reviewed"].includes(manifest.mode), "Unknown schema comparison protocol");
    same(manifest.requiresNativeSchemaControl, manifest.mode !== "identical", "native-control requirement");
    for (const key of ["originalSchemaSha256", "candidateSchemaSha256", "originalLockfileSha256", "candidateLockfileSha256"]) sha(manifest[key], 64, key);
    if (manifest.mode === "identical") {
      same(manifest.originalSchemaSha256, manifest.candidateSchemaSha256, "identical schema manifest");
      same(manifest.historicalMigrations, manifest.candidateMigrationHashes, "identical migration manifest");
    }
    const image = sha(text(entry.nodeImage, "Node image").replace(/^sha256:/, ""), 64, "Immutable Node image");
    if (scenario === "contention") {
      same(sha(text(contentionReferences.compatibility.nodeImage, "Controlled Node image").replace(/^sha256:/, ""), 64, "Controlled immutable Node image"), image, "free/reference Node image");
      same(contentionReferences.compatibility.comparison, manifest, "free/reference exact primary comparison manifest");
    }
    const index = rawBase.partition?.index;
    assert.ok(Number.isInteger(index) && index >= 0 && index < totalSamples(scenario) / 4, "Partition index out of range");
    const before = validateReport(rawBase, scenario, expectedBaseline, index, manifest, false, contentionReferences);
    const after = validateReport(entry.candidate, scenario, candidate, index, manifest, false, contentionReferences);
    if (scenario === "contention") for (const report of [before.report, after.report])
      same(report.contentionInputs, { nodeImage: image, comparison: manifest }, "free contention inputs match own immutable sidecars");
    same(before.report.beforeAfterSemanticEquality, null, "unpaired baseline semantic flag");
    const actualPairedEquality = before.report.receipts.every((/** @type {Evidence} */ receipt) => after.report.receipts.find((/** @type {Evidence} */ other) => other.round === receipt.round)?.digest === receipt.digest);
    same(after.report.beforeAfterSemanticEquality, scenario === "contention" ? actualPairedEquality : true, "head before/after semantic equality");
    for (const key of ["fixture", "harnessHashes", "runtime", "profileRunner", "migrations", "migrationFiles", "postgresVersion", "database"])
      same(after.report[key], before.report[key], `paired ${key}`);
    if (scenario !== "contention") {
      same(after.parity, before.parity, "paired complete first-local parity");
      same(after.digest, before.digest, "paired round digests");
    }
    assert.ok(!runners.has(before.report.profileRunner.id), "Repeated runner-partition identity");
    runners.add(before.report.profileRunner.id);
    // Only source/control provenance may differ between the two externally
    // pinned groups. Schema, dependencies, migrations, manifest bytes and every
    // other input remain one exact global contract. Each full manifest is also
    // fixed within its group and retained in the output.
    const provenanceKeys = new Set(["baselineRevision", "baselineSelectionPath",
      "baselineSelectionFileSha256", "baselineSelectionSource", "originalSourceHashes"]);
    const sharedComparison = catalogBaseline === undefined ? manifest
      : Object.fromEntries(Object.entries(manifest).filter(([key]) => !provenanceKeys.has(key)));
    const groupComparison = baselineComparisons.get(controlGroup);
    if (catalogBaseline !== undefined && groupComparison)
      same(manifest, groupComparison, "cross-partition baseline provenance within control group");
    else if (!groupComparison) baselineComparisons.set(controlGroup, manifest);
    const shared = {
      anchor: before.report.fixture.anchor, protocol: before.report.partitionProtocolVersion,
      schemaVersion: before.report.schemaVersion, mode: before.report.mode, transport: before.report.transport,
      harnessHashes: before.report.harnessHashes, migrations: before.report.migrations,
      migrationFiles: before.report.migrationFiles, postgresVersion: before.report.postgresVersion,
      database: before.report.database, nodeImage: image, comparison: sharedComparison,
      runtime: { node: before.report.runtime.node, platform: before.report.runtime.platform, arch: before.report.runtime.arch },
    };
    record(shared.harnessHashes, "Harness hashes");
    same(Object.keys(shared.harnessHashes).sort(), [...harnessPaths].sort(), "complete identical harness byte inventory");
    for (const digest of Object.values(shared.harnessHashes)) sha(digest, 64, "Harness bytes");
    if (common) same(shared, common, "cross-partition schema/harness/anchor/protocol inputs");
    else common = shared;
    const groupSources = baseSources.get(controlGroup);
    if (groupSources) same(before.report.sourceHashes, groupSources, "immutable baseline source bytes across runners within control group");
    else baseSources.set(controlGroup, before.report.sourceHashes);
    if (headSources) same(after.report.sourceHashes, headSources, "immutable candidate source bytes across runners");
    else headSources = after.report.sourceHashes;
    const originalSources = record(manifest.originalSourceHashes, "Original baseline source witnesses");
    assert.ok(Object.keys(originalSources).length > 0, "Missing original baseline application source inventory");
    for (const [path, digest] of Object.entries(originalSources)) same(before.report.sourceHashes[path], sha(digest, 64, "Original source hash"), "baseline application source preservation");
    let native;
    if (scenario === "cold" && manifest.requiresNativeSchemaControl) {
      native = validateReport(entry.native, "cold", baseline, index, manifest, true);
      same(native.report.beforeAfterSemanticEquality, null, "native unpaired semantic flag");
      for (const key of ["fixture", "harnessHashes", "runtime", "profileRunner", "postgresVersion", "database"])
        same(native.report[key], before.report[key], `native same-runner ${key}`);
      for (const [path, digest] of Object.entries(originalSources)) same(native.report.sourceHashes[path], digest, "native original application source preservation");
    } else assert.ok(!entry.native, "Unexpected native control outside required original-schema cold population");
    const group = groups.get(scenario);
    assert.ok(group);
    group.push({ entry, before, after, native, index });
  }
  assert.ok(common);
  const scenarios = [];
  /** @type {(Part & {native:Validated})[]} */
  const nativeParts = [];
  for (const scenario of latencyScenarios) {
    const parts = (groups.get(scenario) ?? []).sort((a, b) => a.index - b.index);
    same(parts.map((part) => part.index), Array.from({ length: totalSamples(scenario) / 4 }, (_, index) => index), "exact disjoint partition coverage");
    const template = parts[0]?.before;
    assert.ok(template);
    for (const part of parts) {
      same(part.before.report.fixture, template.report.fixture, "fixed scenario fixture population");
      if (scenario !== "contention") {
        same(part.before.parity, template.parity, "cross-runner full semantic parity");
        same(part.before.digest, template.digest, "cross-runner semantic digests");
      }
      if (part.native) nativeParts.push({ ...part, native: part.native });
    }
    /** @type {Record<string,Operation>} */
    const operations = {};
    for (const label of Object.keys(expectedOperationPopulation(scenario))) {
      const beforeRows = parts.flatMap((part) => part.before.rows.filter((row) => row.label === label));
      const afterRows = parts.flatMap((part) => part.after.rows.filter((row) => row.label === label));
      const paired = parts.flatMap((part) => {
        /** @type {PairedObservation[]} */
        const pairs = [];
        for (let round = part.index * 4; round < part.index * 4 + 4; round++) {
          const left = part.before.rows.filter((row) => row.round === round && row.label === label).sort((a, b) => a.sampleIndex - b.sampleIndex);
          const right = part.after.rows.filter((row) => row.round === round && row.label === label).sort((a, b) => a.sampleIndex - b.sampleIndex);
          same(left.length, right.length, "paired operation population");
          for (let occurrence = 0; occurrence < left.length; occurrence++) {
            const old = left[occurrence], current = right[occurrence];
            assert.ok(old && current);
            const beforeOutcome = part.before.contentionOutcomes.get(round);
            const afterOutcome = part.after.contentionOutcomes.get(round);
            const sameOrder = scenario !== "contention" || beforeOutcome?.actualOrder === afterOutcome?.actualOrder;
            const sameHistory = scenario !== "contention" || beforeOutcome?.historyOrder === afterOutcome?.historyOrder;
            pairs.push({
              round, occurrence, partition: part.index, runnerId: part.before.report.profileRunner.id,
              reference: part.entry.reference, baselineMs: old.elapsedMs,
              candidateMs: current.elapsedMs,
              candidateOverBaseline: old.elapsedMs > 0 && sameOrder && sameHistory ? current.elapsedMs / old.elapsedMs : null,
              baselineSucceeded: old.succeeded, candidateSucceeded: current.succeeded,
              ...(scenario === "contention" ? { baselineContentionOrder: beforeOutcome?.actualOrder,
                candidateContentionOrder: afterOutcome?.actualOrder, baselineHistoryOrder: beforeOutcome?.historyOrder,
                candidateHistoryOrder: afterOutcome?.historyOrder, sameContentionOrder: sameOrder, sameHistoryOrder: sameHistory } : {}),
            });
          }
        }
        return pairs;
      });
      const ratios = paired.map((pair) => pair.candidateOverBaseline).filter((ratio) => ratio !== null);
      operations[label] = {
        baseline: summary(beforeRows), candidate: summary(afterRows),
        pairedRatios: { count: ratios.length, zeroBaselineCount: paired.filter((pair) => pair.baselineMs === 0 && pair.sameContentionOrder !== false && pair.sameHistoryOrder !== false).length, p50: percentile(ratios, 0.5), p95: percentile(ratios, 0.95),
          ...(scenario === "contention" ? { unmatchedOrderCount: paired.filter((pair) => !pair.sameContentionOrder).length, unmatchedHistoryCount: paired.filter((pair) => pair.sameContentionOrder && !pair.sameHistoryOrder).length } : {}) },
        paired,
      };
    }
    scenarios.push({ scenario, baselineRevision: scenario === "catalog" && catalogBaseline !== undefined ? catalogBaseline : baseline,
      rounds: totalSamples(scenario), partitions: parts.length,
      semanticDigest: scenario === "contention" ? null : template.digest,
      ...(scenario === "contention" ? { contention: contentionPopulationEvidence(parts, contentionReferences) } : {}), operations,
      evidence: parts.map((part) => ({ partition: part.index, range: part.before.report.partition,
        profileRunner: part.before.report.profileRunner, runtime: part.before.report.runtime,
        reference: part.entry.reference, files: part.entry.files ?? null,
        baselineElapsedMs: part.before.report.elapsedMs, candidateElapsedMs: part.after.report.elapsedMs,
        baselineTimeoutMs: part.before.report.timeoutMs, candidateTimeoutMs: part.after.report.timeoutMs,
      })),
    });
  }
  const nativeRequired = common.comparison.requiresNativeSchemaControl;
  /** @type {NativeControl} */
  let nativeControl = { required: nativeRequired, reported: false, semanticComparisonToSharedSchema: false };
  if (nativeRequired) {
    same(nativeParts.map((part) => part.index), [0, 1, 2, 3, 4], "complete independent native cold population");
    const template = nativeParts[0]?.native;
    assert.ok(template);
    for (const part of nativeParts) {
      same(part.native.parity, template.parity, "within-native full semantic parity");
      same(part.native.digest, template.digest, "within-native semantic digests");
      same(part.native.report.sourceHashes, template.report.sourceHashes, "immutable native baseline source bytes across runners");
    }
    nativeControl = { ...nativeControl, reported: true, scenario: "cold", rounds: 20,
      schemaSha256: common.comparison.originalSchemaSha256,
      operations: Object.fromEntries(Object.keys(expectedOperationPopulation("cold")).map((label) => [label, summary(nativeParts.flatMap((part) => part.native.rows.filter((row) => row.label === label)))])),
      evidence: nativeParts.map((part) => ({ partition: part.index, reference: part.entry.reference, files: part.entry.files ?? null, profileRunner: part.native.report.profileRunner, runtime: part.native.report.runtime })),
    };
  }
  return {
    schemaVersion: 1, partitionProtocolVersion: 1, status: "PASS", samplingComplete: true,
    latencyComparisonEligible: true, baselineRevision: baseline, catalogBaselineRevision: catalogBaseline ?? null,
    baselineComparisons: Object.fromEntries(baselineComparisons), candidateRevision: candidate,
    anchor: common.anchor, sharedInputs: common, scenarios, controlledDiagnostics: controlledDiagnosticEvidence(contentionReferences), nativeControl,
    interpretation: {
      percentiles: "Pooled nearest-rank empirical p50/p95 of all completed hosted observations, including completed expected operation errors. These are not production latency percentiles.",
      controls: catalogBaseline === undefined
        ? "One externally pinned baseline applies to every scenario."
        : "Catalog alone uses the separately pinned catalog correctness control. The other six scenarios and native cold control retain the primary baseline. Both baseline pin files belong to the same PR scope. Each control group keeps exact source provenance; schema, dependency, harness and reviewed-manifest inputs remain shared. No comparison across the two baseline source histories is implied.",
      pairing: "Each candidate/baseline ratio pairs the same global round, operation label and occurrence on the same runner. Runners and hardware can vary between partitions; raw runner/runtime references are retained. Contention pairs enumerate verified actual lock and exact history orders. Ratios require both orders to match; unmatched pairs stay raw with null ratios. Order strata use actual lock acquisition only, never transaction/audit timestamp order. Certified disagreements are flagged and counted.",
      population: "All seven free latency scenarios, unchanged 20/40-round populations, exact four-round partitions and one discarded warmup per partition are required. No failures, unfinished/censored samples, missing or duplicate partitions are omitted.",
      native: "Original-schema cold observations form an independent 20-round baseline when required. No native-versus-shared-schema semantic parity or paired gain is claimed.",
      contention: "Every free round retains its full actual graph and must match one of the two validated exact controlled references. Actual period-lock evidence and raw audit chronology are independently validated; only a strict shared certificate can permit a lock/history disagreement. No journals, aliases, arrays, clocks or raw observations are sorted or filtered. Controlled timings include deliberate waits and remain separate from free latency.",
      diagnostic: "Diagnostic observations never enter latency pooling. The workflow separately requires negotiation/allocation/catalog plus both three-round controlled-contention preflights, and every remaining diagnostic/backlog matrix job. Controlled waits never enter free latency pooling.",
    },
  };
}

const DIAGNOSTIC_ISOLATION_BYTES = 32 * 1024 * 1024;
// A UTF-8 byte can contribute at most one decoded UTF-16 code unit. This byte
// bound is conservative even for non-ASCII files, and leaves string headroom.
const MAX_DIAGNOSTIC_BYTES = Math.min(bufferConstants.MAX_STRING_LENGTH, 512 * 1024 * 1024) - 1024;
const DIAGNOSTIC_CHILD_TIMEOUT_MS = 45_000;
const DIAGNOSTIC_STAGE_TIMEOUT_MS = 120_000;

/** Identical proof for small files and isolated large-file readers. Never
 * stringify or include a report graph in assertion/error diagnostics.
 * @param {unknown} value */
function validateDiagnostic(value) {
  const diagnostic = record(value, "Diagnostic receipt");
  same(diagnostic.status, "PASS", "retained diagnostic report status");
  assert.ok(!Object.hasOwn(diagnostic, "parityFailure"), "Diagnostic retains failed parity evidence");
  same(diagnostic.mode, "diagnostic", "separate diagnostic evidence mode");
  const fixture = record(diagnostic.fixture, "Diagnostic fixture");
  validateReportClocks(diagnostic);
  return text(fixture.anchor, "Diagnostic anchor");
}

/** @param {string} path */
function diagnosticFileStat(path) {
  const stat = statSync(path);
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= MAX_DIAGNOSTIC_BYTES,
    "Diagnostic report is empty, not a file, or exceeds the safe JSON string byte bound");
  return stat;
}

/** @param {string} path */
function readDiagnosticInProcess(path) {
  diagnosticFileStat(path);
  /** @type {unknown} */ let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // JSON.parse can quote raw input near a syntax error. Keep private content
    // and enormous malformed values out of both parent and child diagnostics.
    if (error instanceof SyntaxError) throw new Error("Invalid diagnostic JSON");
    throw error;
  }
  return validateDiagnostic(value);
}

/** Large diagnostic graphs are decoded completely in a serial disposable Node
 * reader. Only its validated anchor reaches the aggregate parent's heap.
 * forceIsolated exercises this exact path with tiny fixtures in pure tests;
 * callers cannot disable automatic isolation for an oversized file.
 * @param {string} path
 * @param {{forceIsolated?:boolean,timeoutMs?:number}} [options] */
export function validateDiagnosticFile(path, options = {}) {
  const absolute = resolve(path);
  const stat = diagnosticFileStat(absolute);
  if (!options.forceIsolated && stat.size <= DIAGNOSTIC_ISOLATION_BYTES)
    return readDiagnosticInProcess(absolute);
  const timeout = options.timeoutMs ?? DIAGNOSTIC_CHILD_TIMEOUT_MS;
  assert.ok(Number.isInteger(timeout) && timeout > 0 && timeout <= DIAGNOSTIC_CHILD_TIMEOUT_MS,
    "Invalid isolated diagnostic timeout");
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_V8_COVERAGE;
  const result = spawnSync(process.execPath, ["--max-old-space-size=3072", fileURLToPath(import.meta.url),
    "--validate-diagnostic", absolute], {
    shell: false, windowsHide: true, encoding: "utf8", env,
    timeout, killSignal: "SIGKILL", maxBuffer: 4096,
  });
  assert.ok(!result.error, "Isolated diagnostic reader failed, exceeded output bounds, or timed out");
  assert.ok(result.status === 0 && result.signal === null,
    `Isolated diagnostic validation failed: ${result.stderr.slice(0, 512)}`);
  const receipt = record(JSON.parse(result.stdout), "Isolated diagnostic receipt");
  same(Object.keys(receipt), ["anchor"], "bounded isolated diagnostic response");
  const anchor = text(receipt.anchor, "Isolated diagnostic anchor");
  assert.ok(Number.isFinite(Date.parse(anchor)) && new Date(anchor).toISOString() === anchor,
    "Invalid isolated diagnostic anchor");
  return anchor;
}

/** Read downloaded artifacts without executing the harness or touching a DB.
 * @param {string} directory @returns {PartitionInput[]} */
export function loadPartitionInputs(directory) {
  const root = resolve(directory);
  /** @type {PartitionInput[]} */
  const entries = [];
  const diagnosticAnchors = new Set();
  /** @type {string[]} */ const diagnostics = [];
  /** @type {{current:string,names:Set<string>}[]} */ const partitions = [];
  /** @param {string} path @returns {unknown} */
  const json = (path) => JSON.parse(readFileSync(path, "utf8"));
  /** @param {string} current */
  function visit(current) {
    const children = readdirSync(current, { withFileTypes: true });
    const names = new Set(children.filter((entry) => entry.isFile()).map((entry) => entry.name));
    for (const name of names) {
      if (/^(?:base|head)-(?:command-exit|budget)\.json$/.test(name)) assert.fail(`Failure/timeout receipt retained at ${relative(root, join(current, name))}`);
      if (/^(?:base|head)-(?:native-)?(?:latency|diagnostic)\.json\.parity-failure\.json$/.test(name)) assert.fail(`Failed parity evidence retained at ${relative(root, join(current, name))}`);
      if (/^(?:base|head)-diagnostic\.json$/.test(name)) diagnostics.push(join(current, name));
    }
    if (names.has("base-latency.json") || names.has("head-latency.json") || names.has("base-native-latency.json")) {
      for (const required of ["base-latency.json", "head-latency.json", "comparison-inputs.json", "node-image.txt"]) assert.ok(names.has(required), `Missing ${required} in ${relative(root, current)}`);
      partitions.push({ current, names });
    }
    for (const child of children) if (child.isDirectory()) visit(join(current, child.name));
  }
  visit(root);
  // No latency graph has been retained when a 473 MB backlog diagnostic is
  // parsed. The two large arms run serially with bounded child output/lifetime.
  const diagnosticDeadline = performance.now() + DIAGNOSTIC_STAGE_TIMEOUT_MS;
  for (const path of diagnostics) {
    const remaining = Math.floor(diagnosticDeadline - performance.now());
    assert.ok(remaining > 0, "Diagnostic validation stage exceeded its bounded budget");
    diagnosticAnchors.add(validateDiagnosticFile(path, { timeoutMs: Math.min(remaining, DIAGNOSTIC_CHILD_TIMEOUT_MS) }));
    assert.ok(performance.now() <= diagnosticDeadline, "Diagnostic validation stage exceeded its bounded budget");
  }
  for (const { current, names } of partitions) {
      const paths = ["base-latency.json", "head-latency.json", "comparison-inputs.json", "node-image.txt", ...(names.has("base-native-latency.json") ? ["base-native-latency.json"] : [])];
      entries.push({
        reference: relative(root, current).replaceAll("\\", "/") || ".",
        baseline: json(join(current, "base-latency.json")), candidate: json(join(current, "head-latency.json")),
        comparison: json(join(current, "comparison-inputs.json")), nodeImage: readFileSync(join(current, "node-image.txt"), "utf8").trim(),
        ...(names.has("base-native-latency.json") ? { native: json(join(current, "base-native-latency.json")) } : {}),
        files: Object.fromEntries(paths.map((name) => [name, { path: relative(root, join(current, name)).replaceAll("\\", "/"), sha256: hash(readFileSync(join(current, name))) }])),
      });
  }
  for (const entry of entries) {
    const fixture = record(record(entry.baseline, "Baseline report").fixture, "Baseline fixture");
    for (const anchor of diagnosticAnchors) same(anchor, fixture.anchor, "shared diagnostic and latency anchor");
  }
  return entries;
}

/** Discover only the two exact controlled diagnostic artifacts. They remain
 * outside the 60 latency inputs, but their validated graphs gate free outcomes.
 * @param {string} directory */
export function loadControlledReferencePaths(directory) {
  const root = resolve(directory);
  /** @type {Partial<Record<import("./contention-references.mjs").ContentionOrder, import("./contention-references.mjs").PathPair>>} */
  const found = {};
  const attempts = new Set();
  const visit = (/** @type {string} */ current) => {
    const name = current.slice(current.lastIndexOf("/") + 1).split("\\").at(-1);
    const match = /^scheduling-profile-(contention-bulk-first|contention-acceptance-first)-diagnostic-part-0-([1-9][0-9]*)$/.exec(name ?? "");
    if (match) {
      const order = CONTENTION_ORDERS.find((value) => CONTENTION_SCENARIOS[value] === match[1]);
      assert.ok(order && !found[order], "Duplicate controlled contention reference artifact");
      for (const required of ["base-diagnostic.json", "head-diagnostic.json", "comparison-inputs.json", "node-image.txt"])
        assert.ok(statSync(join(current, required)).isFile(), `Missing controlled reference ${required}`);
      attempts.add(match[2]);
      found[order] = { baselinePath: join(current, "base-diagnostic.json"), candidatePath: join(current, "head-diagnostic.json"),
        nodeImagePath: join(current, "node-image.txt"), comparisonPath: join(current, "comparison-inputs.json"), reference: relative(root, current).replaceAll("\\", "/") };
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) if (entry.isDirectory()) visit(join(current, entry.name));
  };
  visit(root);
  same(Object.keys(found).sort(), [...CONTENTION_ORDERS].sort(), "both complete controlled reference artifacts");
  same(attempts.size, 1, "one controlled reference run attempt");
  return /** @type {Record<import("./contention-references.mjs").ContentionOrder, import("./contention-references.mjs").PathPair>} */ (found);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--validate-diagnostic") {
    try {
      assert.ok(process.argv.length === 4 && process.argv[3], "Require one diagnostic data file");
      const anchor = readDiagnosticInProcess(process.argv[3]);
      process.stdout.write(`${JSON.stringify({ anchor })}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message.slice(0, 512) : "Invalid diagnostic evidence"}\n`);
      process.exitCode = 1;
    }
  } else if (process.argv[2] === "--matrix") {
    assert.ok(process.argv.length === 3 || process.argv.length === 4, "Usage: aggregate-partitions.mjs --matrix [all|preflight|remaining]");
    process.stdout.write(`${JSON.stringify(profileMatrix(process.argv[3] ?? "all"))}\n`);
  } else {
    /** @type {Map<string,string>} */
    const flags = new Map();
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = process.argv[index], value = process.argv[index + 1];
      assert.ok(typeof key === "string" && ["--input", "--baseline", "--catalog-baseline", "--candidate", "--output"].includes(key) && value && !value.startsWith("--") && !flags.has(key), "Usage: aggregate-partitions.mjs --input DIRECTORY --baseline IMMUTABLE_SHA --candidate IMMUTABLE_SHA [--catalog-baseline IMMUTABLE_SHA] --output FILE (SHA env fallbacks BASELINE_SHA/CANDIDATE_SHA)");
      flags.set(key, value);
    }
    assert.ok(flags.has("--input") && flags.has("--output"), "Require --input and --output, or --matrix alone");
    const output = resolve(text(flags.get("--output"), "Output path"));
    let report;
    try {
      const inputRoot = text(flags.get("--input"), "Input directory");
      const expectedBaseline = text(flags.get("--baseline") ?? process.env.BASELINE_SHA, "Baseline SHA");
      const expectedCandidate = text(flags.get("--candidate") ?? process.env.CANDIDATE_SHA, "Candidate SHA");
      const contentionReferences = loadContentionReferences(loadControlledReferencePaths(inputRoot), { expectedBaseline, expectedCandidate });
      report = aggregatePartitions(loadPartitionInputs(text(flags.get("--input"), "Input directory")), { baseline: text(flags.get("--baseline") ?? process.env.BASELINE_SHA, "Baseline SHA"), candidate: expectedCandidate, contentionReferences, ...(flags.has("--catalog-baseline") ? { catalogBaseline: text(flags.get("--catalog-baseline"), "Catalog baseline SHA") } : {}) });
    } catch (error) {
      report = { status: "FAIL", samplingComplete: false, latencyComparisonEligible: false, error: error instanceof Error ? error.message.slice(0, 2000) : "Invalid partition evidence" };
      process.exitCode = 1;
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: report.status, output })}\n`);
  }
}
