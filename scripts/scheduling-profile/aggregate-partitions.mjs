import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Parsed receipt fields are checked at runtime before use. The public result
 * types below deliberately expose no unchecked JSON values to TypeScript callers.
 * @typedef {Record<string, any>} Evidence
 * @typedef {{label:string,elapsedMs:number,succeeded:boolean,status:string,round:number,sampleIndex:number}} Observation
 * @typedef {{samples:number,completed:number,errors:number,unfinished:number,censored:number,p50Ms:number|null,p95Ms:number|null}} Summary
 * @typedef {{round:number,occurrence:number,partition:number,runnerId:string,reference:string,baselineMs:number,candidateMs:number,candidateOverBaseline:number|null,baselineSucceeded:boolean,candidateSucceeded:boolean}} PairedObservation
 * @typedef {{baseline:Summary,candidate:Summary,pairedRatios:{count:number,zeroBaselineCount:number,p50:number|null,p95:number|null},paired:PairedObservation[]}} Operation
 * @typedef {{reference:string,baseline:unknown,candidate:unknown,comparison:unknown,nodeImage:string,native?:unknown,files?:unknown}} PartitionInput
 * @typedef {{report:Evidence,rows:Observation[],parity:Evidence,digest:string}} Validated
 * @typedef {{entry:PartitionInput,before:Validated,after:Validated,native?:Validated,index:number}} Part
 * @typedef {{required:boolean,reported:boolean,semanticComparisonToSharedSchema:boolean,scenario?:string,rounds?:number,schemaSha256?:string,operations?:Record<string,Summary>,evidence?:unknown[]}} NativeControl
 * @typedef {{schemaVersion:number,partitionProtocolVersion:number,status:string,samplingComplete:boolean,latencyComparisonEligible:boolean,baselineRevision:string,candidateRevision:string,anchor:string,sharedInputs:unknown,scenarios:{scenario:string,rounds:number,partitions:number,semanticDigest:string,operations:Record<string,Operation>,evidence:unknown[]}[],nativeControl:NativeControl,interpretation:Record<string,string>}} AggregateReport
 */

export const latencyScenarios = Object.freeze(["cold", "warm", "sunday", "negotiation", "allocation", "catalog", "contention"]);
const harnessPaths = ["scripts/profile-scheduling-requests.ts", "scripts/scheduling-profile/fixtures.ts", "scripts/scheduling-profile/scenarios.ts", "scripts/scheduling-profile/metrics.ts", "scripts/scheduling-profile/parity.ts", "scripts/scheduling-profile/http.ts", "scripts/scheduling-profile/register-server-runtime.mjs", "scripts/scheduling-profile/server-runtime-hooks.mjs"];
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
/** @param {unknown} actual @param {unknown} expected @param {string} name */
const same = (actual, expected, name) => assert.deepStrictEqual(actual, expected, `Incomparable ${name}`);
/** @param {number[]} values @param {number} fraction @returns {number|null} */
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
};

/** One source of truth for the hosted matrix; samples are TOTAL rounds, never four. */
export function profileMatrix() {
  return { include: [
    ...latencyScenarios.flatMap((scenario) => Array.from({ length: totalSamples(scenario) / 4 }, (_, partition) => ({
      scenario, mode: "latency", partition, partitionCount: totalSamples(scenario) / 4, samples: totalSamples(scenario),
    }))),
    ...[...latencyScenarios, "backlog"].map((scenario) => ({
      scenario, mode: "diagnostic", partition: 0, partitionCount: 1, samples: scenario === "backlog" ? 1 : 3,
    })),
  ] };
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

/** @param {unknown} value @param {string} scenario @param {string} revision @param {number} index @param {Evidence} manifest @param {boolean} native @returns {Validated} */
function validateReport(value, scenario, revision, index, manifest, native = false) {
  const report = record(value, "Report");
  same(report.status, "PASS", "report status (partial/failing runs are not evidence)");
  assert.ok(!Object.hasOwn(report, "failure") && !Object.hasOwn(report, "error") &&
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
  assert.ok(Number.isFinite(Date.parse(fixture.anchor)), "Invalid shared anchor");
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
    const file = report.migrationFiles.find((entry) => entry.name === row.name);
    assert.ok(file && [file.sha256, file.lfSha256, file.crlfSha256].includes(row.checksum), "Applied migration checksum differs");
  }
  same(applied.size, report.migrationFiles.length, "complete applied migrations");
  const receipts = report.receipts;
  assert.ok(Array.isArray(receipts) && receipts.length === 4, "Partition needs all four completed receipts");
  same(receipts.map((receipt) => receipt.round).sort((a, b) => a - b), [index * 4, index * 4 + 1, index * 4 + 2, index * 4 + 3], "global receipt rounds");
  const first = receipts.find((receipt) => receipt.round === index * 4);
  record(first.parity, "First LOCAL full parity");
  sha(first.digest, 64, "Semantic digest");
  same(hash(JSON.stringify(first.parity)), first.digest, "full parity digest");
  for (const receipt of receipts) {
    same(receipt.scenario, scenario, "receipt scenario");
    same(receipt.digest, first.digest, "all local round semantic digests");
    for (const key of ["receiptInputs", "pairingCreations", "operationWindows", "parityWindow"]) assert.ok(Array.isArray(receipt[key]), `Missing completed receipt ${key}`);
    assert.ok("output" in receipt, "Missing raw operation output receipt");
    if (receipt.parity) same(receipt.parity, first.parity, "retained full parity");
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
  same(Object.keys(record(metrics.operations, "Operation summaries")).sort(), Object.keys(population).sort(), "operation summary label coverage");
  for (const [label, summary] of Object.entries(metrics.operations)) {
    const selected = rows.filter((sample) => sample.label === label);
    same({ samples: summary.samples, completed: summary.completed, errors: summary.errors, unfinished: summary.unfinished, censored: summary.censored }, {
      samples: selected.length, completed: selected.length, errors: selected.filter((sample) => !sample.succeeded).length, unfinished: 0, censored: 0,
    }, "summary agrees with completed raw samples");
    assert.ok(!("p50Ms" in summary) && !("p95Ms" in summary), "Partition must not advertise final quantiles");
  }
  return { report, rows, parity: first.parity, digest: first.digest };
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

/** Pure validation and aggregation. Each entry is one downloaded runner artifact:
 * {reference,baseline,candidate,comparison,nodeImage,native?,files?}. No timing is
 * accepted without its complete paired runner, protocol and semantic evidence.
 * @param {PartitionInput[]} inputs @param {{baseline:string,candidate:string}} options
 * @returns {AggregateReport}
 */
export function aggregatePartitions(inputs, options) {
  const baseline = sha(options.baseline, 40, "Expected baseline");
  const candidate = sha(options.candidate, 40, "Expected candidate");
  assert.ok(Array.isArray(inputs) && inputs.length === 60, "Require all 60 latency partitions across all seven scenarios");
  /** @type {Map<string,Part[]>} */
  const groups = new Map(latencyScenarios.map((scenario) => [scenario, []]));
  const runners = new Set();
  const references = new Set();
  /** @type {Evidence | undefined} */
  let common;
  /** @type {Evidence | undefined} */
  let baseSources;
  /** @type {Evidence | undefined} */
  let headSources;
  for (const entry of inputs) {
    record(entry, "Partition input");
    text(entry.reference, "Raw partition reference");
    assert.ok(!references.has(entry.reference), "Duplicate partition artifact reference");
    references.add(entry.reference);
    const manifest = record(entry.comparison, "Comparison manifest");
    same(manifest.baselineRevision, baseline, "comparison baseline revision");
    const selection = manifest.baselineSelectionPath;
    if (selection !== null) {
      same(selection, ".github/scheduling-profile-manifests/baseline.txt", "reviewed baseline selection path");
      same(manifest.baselineSelectionSource, "reviewed-baseline-file", "reviewed baseline selection source");
      assert.ok([hash(baseline), hash(`${baseline}\n`)].includes(sha(manifest.baselineSelectionFileSha256, 64, "Reviewed baseline file hash")), "Reviewed baseline file does not pin the expected immutable SHA");
      assert.ok(typeof manifest.reviewedManifestPath === "string" && /^\.github\/scheduling-profile-manifests\/[A-Za-z0-9_-]+\.json$/.test(manifest.reviewedManifestPath), "Reviewed baseline requires an explicit reviewed schema manifest");
      record(manifest.reviewedManifest, "Reviewed schema manifest");
      sha(manifest.reviewedManifestFileSha256, 64, "Reviewed manifest file hash");
      same(hash(JSON.stringify(manifest.reviewedManifest)), manifest.reviewedManifestSha256, "reviewed schema manifest digest");
    } else {
      same(manifest.baselineSelectionFileSha256, null, "absent reviewed baseline file hash");
      assert.ok(["default-baseline", "manual-baseline", "explicit-cli"].includes(manifest.baselineSelectionSource), "Unknown baseline selection source");
    }
    assert.ok(["identical", "additive", "reviewed"].includes(manifest.mode), "Unknown schema comparison protocol");
    same(manifest.requiresNativeSchemaControl, manifest.mode !== "identical", "native-control requirement");
    for (const key of ["originalSchemaSha256", "candidateSchemaSha256", "originalLockfileSha256", "candidateLockfileSha256"]) sha(manifest[key], 64, key);
    if (manifest.mode === "identical") {
      same(manifest.originalSchemaSha256, manifest.candidateSchemaSha256, "identical schema manifest");
      same(manifest.historicalMigrations, manifest.candidateMigrationHashes, "identical migration manifest");
    }
    const image = sha(text(entry.nodeImage, "Node image").replace(/^sha256:/, ""), 64, "Immutable Node image");
    const rawBase = record(entry.baseline, "Baseline report");
    const scenario = rawBase.fixture?.scenarios?.[0];
    assert.ok(groups.has(scenario), "Unexpected/missing latency scenario");
    const index = rawBase.partition?.index;
    assert.ok(Number.isInteger(index) && index >= 0 && index < totalSamples(scenario) / 4, "Partition index out of range");
    const before = validateReport(rawBase, scenario, baseline, index, manifest);
    const after = validateReport(entry.candidate, scenario, candidate, index, manifest);
    same(before.report.beforeAfterSemanticEquality, null, "unpaired baseline semantic flag");
    same(after.report.beforeAfterSemanticEquality, true, "head before/after semantic equality");
    for (const key of ["fixture", "harnessHashes", "runtime", "profileRunner", "migrations", "migrationFiles", "postgresVersion", "database"])
      same(after.report[key], before.report[key], `paired ${key}`);
    same(after.parity, before.parity, "paired complete first-local parity");
    same(after.digest, before.digest, "paired round digests");
    assert.ok(!runners.has(before.report.profileRunner.id), "Repeated runner-partition identity");
    runners.add(before.report.profileRunner.id);
    const shared = {
      anchor: before.report.fixture.anchor, protocol: before.report.partitionProtocolVersion,
      schemaVersion: before.report.schemaVersion, mode: before.report.mode, transport: before.report.transport,
      harnessHashes: before.report.harnessHashes, migrations: before.report.migrations,
      migrationFiles: before.report.migrationFiles, postgresVersion: before.report.postgresVersion,
      database: before.report.database, nodeImage: image, comparison: manifest,
      runtime: { node: before.report.runtime.node, platform: before.report.runtime.platform, arch: before.report.runtime.arch },
    };
    record(shared.harnessHashes, "Harness hashes");
    same(Object.keys(shared.harnessHashes).sort(), [...harnessPaths].sort(), "complete identical harness byte inventory");
    for (const digest of Object.values(shared.harnessHashes)) sha(digest, 64, "Harness bytes");
    if (common) same(shared, common, "cross-partition schema/harness/anchor/protocol inputs");
    else common = shared;
    if (baseSources) same(before.report.sourceHashes, baseSources, "immutable baseline source bytes across runners");
    else baseSources = before.report.sourceHashes;
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
      same(part.before.parity, template.parity, "cross-runner full semantic parity");
      same(part.before.digest, template.digest, "cross-runner semantic digests");
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
            pairs.push({
              round, occurrence, partition: part.index, runnerId: part.before.report.profileRunner.id,
              reference: part.entry.reference, baselineMs: old.elapsedMs,
              candidateMs: current.elapsedMs,
              candidateOverBaseline: old.elapsedMs > 0 ? current.elapsedMs / old.elapsedMs : null,
              baselineSucceeded: old.succeeded, candidateSucceeded: current.succeeded,
            });
          }
        }
        return pairs;
      });
      const ratios = paired.map((pair) => pair.candidateOverBaseline).filter((ratio) => ratio !== null);
      operations[label] = {
        baseline: summary(beforeRows), candidate: summary(afterRows),
        pairedRatios: { count: ratios.length, zeroBaselineCount: paired.length - ratios.length, p50: percentile(ratios, 0.5), p95: percentile(ratios, 0.95) },
        paired,
      };
    }
    scenarios.push({ scenario, rounds: totalSamples(scenario), partitions: parts.length,
      semanticDigest: template.digest, operations,
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
    latencyComparisonEligible: true, baselineRevision: baseline, candidateRevision: candidate,
    anchor: common.anchor, sharedInputs: common, scenarios, nativeControl,
    interpretation: {
      percentiles: "Pooled nearest-rank empirical p50/p95 of all completed hosted observations, including completed expected operation errors. These are not production latency percentiles.",
      pairing: "Each candidate/baseline ratio pairs the same global round, operation label and occurrence on the same runner. Runners and hardware can vary between partitions; raw runner/runtime references are retained. Contention winners may differ; both operation outcomes are retained.",
      population: "All seven scenarios, unchanged 20/40-round populations, exact four-round partitions and one discarded warmup per partition are required. No failures, unfinished/censored samples, missing or duplicate partitions are omitted.",
      native: "Original-schema cold observations form an independent 20-round baseline when required. No native-versus-shared-schema semantic parity or paired gain is claimed.",
      diagnostic: "Diagnostic observations never enter latency pooling. The workflow separately requires every diagnostic/backlog matrix job to succeed.",
    },
  };
}

/** Read downloaded artifacts without executing the harness or touching a DB.
 * @param {string} directory @returns {PartitionInput[]} */
export function loadPartitionInputs(directory) {
  const root = resolve(directory);
  /** @type {PartitionInput[]} */
  const entries = [];
  /** @param {string} path @returns {unknown} */
  const json = (path) => JSON.parse(readFileSync(path, "utf8"));
  /** @param {string} current */
  function visit(current) {
    const children = readdirSync(current, { withFileTypes: true });
    const names = new Set(children.filter((entry) => entry.isFile()).map((entry) => entry.name));
    for (const name of names) {
      if (/^(?:base|head)-(?:command-exit|budget)\.json$/.test(name)) assert.fail(`Failure/timeout receipt retained at ${relative(root, join(current, name))}`);
      if (/^(?:base|head)-diagnostic\.json$/.test(name)) {
        const diagnostic = record(json(join(current, name)), "Diagnostic receipt");
        same(diagnostic.status, "PASS", "retained diagnostic report status");
        same(diagnostic.mode, "diagnostic", "separate diagnostic evidence mode");
      }
    }
    if (names.has("base-latency.json") || names.has("head-latency.json") || names.has("base-native-latency.json")) {
      for (const required of ["base-latency.json", "head-latency.json", "comparison-inputs.json", "node-image.txt"]) assert.ok(names.has(required), `Missing ${required} in ${relative(root, current)}`);
      const paths = ["base-latency.json", "head-latency.json", "comparison-inputs.json", "node-image.txt", ...(names.has("base-native-latency.json") ? ["base-native-latency.json"] : [])];
      entries.push({
        reference: relative(root, current).replaceAll("\\", "/") || ".",
        baseline: json(join(current, "base-latency.json")), candidate: json(join(current, "head-latency.json")),
        comparison: json(join(current, "comparison-inputs.json")), nodeImage: readFileSync(join(current, "node-image.txt"), "utf8").trim(),
        ...(names.has("base-native-latency.json") ? { native: json(join(current, "base-native-latency.json")) } : {}),
        files: Object.fromEntries(paths.map((name) => [name, { path: relative(root, join(current, name)).replaceAll("\\", "/"), sha256: hash(readFileSync(join(current, name))) }])),
      });
    }
    for (const child of children) if (child.isDirectory()) visit(join(current, child.name));
  }
  visit(root);
  return entries;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === "--matrix") {
    process.stdout.write(`${JSON.stringify(profileMatrix())}\n`);
  } else {
    /** @type {Map<string,string>} */
    const flags = new Map();
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = process.argv[index], value = process.argv[index + 1];
      assert.ok(typeof key === "string" && ["--input", "--baseline", "--candidate", "--output"].includes(key) && value && !value.startsWith("--") && !flags.has(key), "Usage: aggregate-partitions.mjs --input DIRECTORY --baseline IMMUTABLE_SHA --candidate IMMUTABLE_SHA --output FILE (SHA env fallbacks BASELINE_SHA/CANDIDATE_SHA)");
      flags.set(key, value);
    }
    assert.ok(flags.has("--input") && flags.has("--output"), "Require --input and --output, or --matrix alone");
    const output = resolve(text(flags.get("--output"), "Output path"));
    let report;
    try {
      report = aggregatePartitions(loadPartitionInputs(text(flags.get("--input"), "Input directory")), { baseline: text(flags.get("--baseline") ?? process.env.BASELINE_SHA, "Baseline SHA"), candidate: text(flags.get("--candidate") ?? process.env.CANDIDATE_SHA, "Candidate SHA") });
    } catch (error) {
      report = { status: "FAIL", samplingComplete: false, latencyComparisonEligible: false, error: error instanceof Error ? error.message.slice(0, 2000) : "Invalid partition evidence" };
      process.exitCode = 1;
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: report.status, output })}\n`);
  }
}
