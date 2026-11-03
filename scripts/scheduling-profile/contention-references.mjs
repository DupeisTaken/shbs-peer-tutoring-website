import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

/** JSON is validated before it becomes a reference. No graph is normalized here:
 * recovery journals, array ordering and the complete alias dictionary stay exact.
 * @typedef {Record<string, any>} Evidence
 * @typedef {'bulk-before-acceptance'|'acceptance-before-bulk'} ContentionOrder
 * @typedef {{expectedBaseline:string,expectedCandidate:string}} ReferenceOptions
 * @typedef {{baseline:unknown,candidate:unknown,nodeImage:string,comparison:unknown,reference?:string}} ReportPair
 * @typedef {{baselinePath:string,candidatePath:string,nodeImagePath:string,comparisonPath:string,reference?:string}} PathPair
 * @typedef {{scenario:string,parity:unknown,digest:string}} OrderReference
 * @typedef {{order:ContentionOrder,scenario:string,reference:string|null,baseline:unknown,candidate:unknown}} ControlledEvidence
 * @typedef {{actualOrder:ContentionOrder,auditHistoryOrder:ContentionOrder|'interleaved',auditTimestampOrder:ContentionOrder|'tied'|'interleaved',auditTimestampOrderBasis:string,responseTimestampUniform:boolean,hasTimestampTies:boolean,crossGroupTimestampTie:boolean,historyContradictsFence:boolean,auditTimestampContradictsFence:boolean,operations:unknown[],audits:unknown[]}} FenceChronology
 * @typedef {{version:1,expectedBaseline:string,expectedCandidate:string,byOrder:Record<ContentionOrder,OrderReference>,controlledEvidence:ControlledEvidence[],auditBlockSwapCertificate:boolean,compatibility:{common:unknown,byRevision:Record<string,unknown>,nodeImage:string,comparison:unknown}}} ContentionReferences
 */

export const CONTENTION_ORDERS = Object.freeze(/** @type {const} */ (["bulk-before-acceptance", "acceptance-before-bulk"]));
export const CONTENTION_SCENARIOS = Object.freeze({
  "bulk-before-acceptance": "contention-bulk-first",
  "acceptance-before-bulk": "contention-acceptance-first",
});
const harnessPaths = ["scripts/profile-scheduling-requests.ts", "scripts/scheduling-profile/fixtures.ts", "scripts/scheduling-profile/scenarios.ts", "scripts/scheduling-profile/metrics.ts", "scripts/scheduling-profile/parity.ts", "scripts/scheduling-profile/http.ts", "scripts/scheduling-profile/register-server-runtime.mjs", "scripts/scheduling-profile/server-runtime-hooks.mjs", "scripts/scheduling-profile/controlled-contention.ts", "scripts/scheduling-profile/contention-references.mjs", "scripts/scheduling-profile/contention-fence-witness.ts"];
const auditOperations = ["admin.autoAssignUnassignedRooms", "sessionPlanning.accepted", "sessionPlanning.responded", "sessionPlanning.respond"];
const auditActions = ["Auto Assign Unassigned Rooms", "Session planning: accepted", "Session planning: responded", "Respond"];
const population = Object.freeze({
  "http:concurrent-2-agenda": 2, "http:concurrent-4-agenda": 4,
  "http:competing-schedule-a": 1, "http:competing-schedule-b": 1,
  "http:contention-pending-room": 1, "http:contended-bulk": 1, "http:contended-acceptance": 1,
});
const validatedReferences = new WeakSet();
/** @param {ContentionReferences} refs */
function assertValidated(refs) {
  assert.ok(refs && typeof refs === "object" && validatedReferences.has(refs), "Contention references must come from the validated builder/loader");
}
/** @param {unknown} value @param {string} label @returns {Evidence} */
function record(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return /** @type {Evidence} */ (value);
}
/** @param {unknown} value @param {string} label @returns {string} */
function text(value, label) {
  assert.ok(typeof value === "string" && value.trim().length > 0, `${label} must be nonempty`);
  return value;
}
/** @param {unknown} value @param {number} length @param {string} label @returns {string} */
function sha(value, length, label) {
  assert.ok(typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value), `${label} must be an immutable lowercase hash`);
  return value;
}
/** Avoid potentially enormous assertion diffs while retaining the original graphs.
 * @param {unknown} actual @param {unknown} expected @param {string} label */
function same(actual, expected, label) {
  assert.ok(isDeepStrictEqual(actual, expected), `Incomparable ${label}`);
}
/** @param {unknown} value @param {string} label @returns {number} */
function finite(value, label) {
  assert.ok(typeof value === "number" && Number.isFinite(value) && value >= 0, `${label} must be finite and nonnegative`);
  return value;
}
/** @param {unknown} value @param {string} label @returns {number} */
function pid(value, label) {
  assert.ok(typeof value === "number" && Number.isSafeInteger(value) && value > 0, `${label} must be a positive PID`);
  return value;
}
/** @param {unknown} value @param {string} label @returns {number} */
function instant(value, label) {
  assert.ok(typeof value === "string" && Number.isFinite(Date.parse(value)), `${label} must be a timestamp`);
  return Date.parse(value);
}
/** @param {unknown} value @returns {string} */
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** @param {Evidence} report */
function migrationContract(report) {
  assert.ok(Array.isArray(report.migrationFiles) && report.migrationFiles.length > 0 && Array.isArray(report.migrations), "Missing migration evidence");
  const names = new Set();
  for (const file of report.migrationFiles) {
    record(file, "Migration file");
    const name = text(file.name, "Migration name");
    assert.ok(!names.has(name), "Duplicate migration file");
    names.add(name);
    for (const key of ["sha256", "lfSha256", "crlfSha256"]) sha(file[key], 64, "Migration hash");
  }
  const applied = new Set();
  for (const row of report.migrations) {
    record(row, "Applied migration");
    assert.ok(!applied.has(row.name), "Duplicate applied migration");
    applied.add(row.name);
    /** @type {Evidence|undefined} */
    const file = report.migrationFiles.find((item) => item.name === row.name);
    assert.ok(file && [file.sha256, file.lfSha256, file.crlfSha256].includes(row.checksum), "Applied migration checksum differs");
  }
  same(applied.size, names.size, "complete applied migration population");
  return { migrationFiles: report.migrationFiles, migrations: report.migrations };
}

/** Static compatibility deliberately accepts RUNNING reports. Runner identity and
 * CPU model can differ between jobs; Node/platform/architecture cannot.
 * @param {unknown} value */
function staticContract(value) {
  const report = record(value, "Report");
  same(report.schemaVersion, 3, "report schema");
  same(report.partitionProtocolVersion, 1, "partition protocol");
  same(report.transport, "http", "HTTP transport");
  const fixture = record(report.fixture, "Fixture");
  same(fixture.transport, "http", "fixture transport");
  instant(fixture.anchor, "Shared anchor");
  const { scenarios: _scenarios, samples: _samples, ...sharedFixture } = fixture;
  const runtime = record(report.runtime, "Runtime");
  assert.match(text(runtime.node, "Node runtime"), /^v22\./, "Reference runtime must use Node 22");
  same(runtime.platform, "linux", "runtime platform");
  text(runtime.arch, "Runtime architecture");
  const harness = record(report.harnessHashes, "Harness hashes");
  for (const [path, hash] of Object.entries(harness)) { text(path, "Harness path"); sha(hash, 64, "Harness hash"); }
  for (const path of harnessPaths) sha(harness[path], 64, `Required harness ${path}`);
  const sources = record(report.sourceHashes, "Source hashes");
  assert.ok(Object.keys(sources).length > 2, "Missing application source inventory");
  for (const [path, hash] of Object.entries(sources)) { text(path, "Source path"); sha(hash, 64, "Source hash"); }
  const schema = sha(sources["prisma/schema.prisma"], 64, "Shared schema");
  const lockfile = sha(sources["package-lock.json"], 64, "Dependency lockfile");
  const postgres = report.postgresVersion;
  assert.ok(Array.isArray(postgres) && postgres.length === 1, "Missing PostgreSQL runtime");
  text(record(postgres[0], "PostgreSQL runtime").server_version, "PostgreSQL version");
  const database = record(report.database, "Owned database");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.host) && database.port === 55439 && database.name === "shbs_performance_test" && database.poolMax === 6, "Wrong owned database");
  return {
    common: { schemaVersion: report.schemaVersion, partitionProtocolVersion: report.partitionProtocolVersion,
      fixture: sharedFixture, harnessHashes: harness, schema, lockfile,
      runtime: { node: runtime.node, platform: runtime.platform, arch: runtime.arch },
      postgresVersion: postgres, database, ...migrationContract(report) },
    sourceHashes: sources,
  };
}

/** The reference files must retain their independently captured image and
 * comparison receipt; a reference cannot supply its own missing free-run input.
 * @param {Evidence} pair @param {Evidence} before @param {Evidence} after @param {string} baseline */
function referenceInputs(pair, before, after, baseline) {
  const nodeImage = sha(text(pair.nodeImage, "Controlled immutable Node image").trim().replace(/^sha256:/, ""), 64, "Controlled immutable Node image");
  const comparison = record(pair.comparison, "Controlled comparison inputs");
  same(comparison.baselineRevision, baseline, "controlled comparison baseline revision");
  assert.ok(["identical", "additive", "reviewed"].includes(comparison.mode), "Unknown controlled schema protocol");
  same(comparison.requiresNativeSchemaControl, comparison.mode !== "identical", "controlled native schema requirement");
  for (const key of ["originalSchemaSha256", "candidateSchemaSha256", "originalLockfileSha256", "candidateLockfileSha256"]) sha(comparison[key], 64, key);
  same(comparison.originalLockfileSha256, comparison.candidateLockfileSha256, "controlled dependency bytes");
  const expectedMigrations = record(comparison.candidateMigrationHashes, "Controlled migration inventory");
  const historical = record(comparison.historicalMigrations, "Original migration inventory");
  for (const [path, hash] of Object.entries(expectedMigrations)) { assert.match(path, /^prisma\/migrations\/[^/]+\/migration\.sql$/); sha(hash, 64, "Controlled migration hash"); }
  for (const [path, hash] of Object.entries(historical)) same(expectedMigrations[path], sha(hash, 64, "Historical migration hash"), "unchanged historical migration");
  if (comparison.mode === "identical") {
    same(comparison.originalSchemaSha256, comparison.candidateSchemaSha256, "identical controlled schema");
    same(historical, expectedMigrations, "identical controlled migrations");
  }
  const originalSources = record(comparison.originalSourceHashes, "Original control source inventory");
  const controlSources = Object.fromEntries(Object.entries(before.sourceHashes).filter(([path]) => path.startsWith("src/")));
  same(originalSources, controlSources, "original control runtime source bytes");
  const selection = comparison.baselineSelectionPath;
  if (selection === null) {
    same(comparison.baselineSelectionFileSha256, null, "absent reviewed pin hash");
    assert.ok(["default-baseline", "manual-baseline", "explicit-cli"].includes(comparison.baselineSelectionSource), "Unknown explicit control selection");
  } else {
    assert.ok(typeof selection === "string" && /^\.github\/scheduling-profile-manifests\/(?:baseline|pr-[1-9][0-9]*-baseline)\.txt$/.test(selection), "Invalid reviewed primary control pin path");
    assert.ok(["reviewed-baseline-file", "reviewed-pr-baseline-file"].includes(comparison.baselineSelectionSource), "Unknown reviewed control pin source");
    assert.ok([digestText(baseline), digestText(`${baseline}\n`)].includes(sha(comparison.baselineSelectionFileSha256, 64, "Reviewed control pin hash")), "Control pin does not contain the expected revision");
    assert.ok(comparison.reviewedManifestPath !== null, "Reviewed control pin needs its explicit reviewed manifest");
  }
  if (comparison.reviewedManifestPath !== null) {
    assert.ok(typeof comparison.reviewedManifestPath === "string" && /^\.github\/scheduling-profile-manifests\/[A-Za-z0-9_-]+\.json$/.test(comparison.reviewedManifestPath), "Invalid reviewed manifest path");
    record(comparison.reviewedManifest, "Reviewed comparison manifest");
    same(digest(comparison.reviewedManifest), sha(comparison.reviewedManifestSha256, 64, "Reviewed semantic manifest hash"), "reviewed manifest contents");
    sha(comparison.reviewedManifestFileSha256, 64, "Reviewed manifest file hash");
  } else {
    same(comparison.reviewedManifest, null, "absent reviewed manifest");
    same(comparison.reviewedManifestSha256, null, "absent reviewed semantic manifest hash");
    same(comparison.reviewedManifestFileSha256, null, "absent reviewed manifest file hash");
  }
  const inputs = { nodeImage, comparison };
  for (const report of [before, after]) {
    same(report.contentionInputs, inputs, "controlled raw/sidecar inputs");
    same(report.sourceHashes["prisma/schema.prisma"], comparison.candidateSchemaSha256, "controlled shared schema receipt");
    same(report.sourceHashes["package-lock.json"], comparison.candidateLockfileSha256, "controlled dependency receipt");
    same(Object.fromEntries(report.migrationFiles.map((/** @type {Evidence} */ file) => [`prisma/migrations/${file.name}/migration.sql`, file.sha256])), expectedMigrations, "controlled complete migration bytes");
  }
  return inputs;
}
/** @param {string} value */
const digestText = (value) => createHash("sha256").update(value).digest("hex");

/** @param {Evidence} evidence @param {ContentionOrder} order */
function validateProof(evidence, order) {
  same(evidence.order, order, "controlled lock order");
  same(evidence.phase, "completed", "controlled proof completion phase");
  same(evidence.completed, true, "controlled proof completion");
  for (const field of ["requestErrors", "cleanupErrors"]) {
    if (Object.hasOwn(evidence, field)) same(evidence[field], [], `controlled ${field}`);
  }
  const application = text(evidence.applicationName, "Controlled application name");
  assert.match(application, /^[A-Za-z0-9:_-]{1,54}$/, "Invalid controlled application scope");
  const holder = pid(evidence.holderPid, "Holder PID"), first = pid(evidence.firstPid, "First request PID"), second = pid(evidence.secondPid, "Second request PID");
  same(new Set([holder, first, second]).size, 3, "distinct lock-chain backends");
  assert.ok(finite(evidence.holdMs, "Controlled hold duration") > 0 && evidence.holdMs <= 10_000, "Controlled hold exceeds its bounded holder lifetime");
  const keys = record(evidence.lockKeys, "Server-derived lock tags");
  for (const key of ["period", "room"]) {
    const tag = record(keys[key], "Server-derived lock tag");
    for (const field of ["classid", "objid"]) assert.ok(typeof tag[field] === "string" && /^(?:0|[1-9]\d*)$/.test(tag[field]) && Number(tag[field]) <= 4_294_967_295, "Invalid 64-bit advisory lock tag");
    same(tag.objsubid, 1, "64-bit advisory lock namespace");
  }
  assert.ok(!isDeepStrictEqual(keys.period, keys.room), "Period and room tags must differ");
  assert.ok(Array.isArray(evidence.snapshots) && evidence.snapshots.length >= 2 && evidence.snapshots.length <= 256, "Missing/beyond-bound controlled observations");
  let elapsed = -1;
  let firstProof = false;
  let secondPhase = false;
  for (const snapshot of evidence.snapshots) {
    record(snapshot, "Lock observation");
    const current = finite(snapshot.elapsedMs, "Observation elapsed");
    assert.ok(current >= elapsed, "Lock observations went backwards");
    elapsed = current;
    assert.ok(snapshot.phase === "first-request" || snapshot.phase === "second-request", "Unknown observation phase");
    if (snapshot.phase === "second-request") secondPhase = true;
    else assert.ok(!secondPhase, "First request observation followed second launch");
    assert.ok(Array.isArray(snapshot.rows) && snapshot.rows.length <= 4, "Unexpected controlled lock population");
    const seen = new Set();
    for (const row of snapshot.rows) {
      record(row, "Observed lock");
      assert.ok([holder, first, second].includes(pid(row.pid, "Observed backend")), "Foreign backend in controlled chain");
      assert.ok(row.key === "period" || row.key === "room", "Unknown lock key");
      const identity = `${row.pid}:${row.key}`;
      assert.ok(!seen.has(identity), "Duplicate observed lock"); seen.add(identity);
      same({ classid: row.classid, objid: row.objid, objsubid: row.objsubid }, keys[row.key], "exact server-derived advisory tag");
      same(row.mode, "ExclusiveLock", "exclusive scheduling lock");
      assert.ok(typeof row.granted === "boolean", "Missing granted state");
      same(row.applicationName, row.pid === holder ? `${application}-hold` : application, "scoped application identity");
      assert.ok(Array.isArray(row.blockers) && row.blockers.every((/** @type {unknown} */ value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0) && new Set(row.blockers).size === row.blockers.length, "Invalid blocker PIDs");
      assert.ok(instant(row.xactStart, "Transaction start") <= instant(row.observedAt, "Observation time"), "Observation predates transaction");
    }
    const has = (/** @type {number} */ backend, /** @type {string} */ key, /** @type {boolean} */ granted, /** @type {number[]} */ blockers) => snapshot.rows.some((/** @type {Evidence} */ row) => row.pid === backend && row.key === key && row.granted === granted && isDeepStrictEqual(row.blockers, blockers));
    // pg_blocking_pids is backend-wide, so the granted period row reports the
    // same room blocker as this backend's waiting room row.
    /** @type {boolean} */ const chain = has(holder, "room", true, []) && has(first, "period", true, [holder]) && has(first, "room", false, [holder]);
    if (snapshot.phase === "first-request" && chain && snapshot.rows.length === 3 && !snapshot.rows.some((/** @type {Evidence} */ row) => row.pid === second)) firstProof = true;
    if (snapshot === evidence.snapshots.at(-1)) {
      assert.ok(snapshot.phase === "second-request" && chain && snapshot.rows.length === 4 && has(second, "period", false, [first]), "Final observation does not prove holder→first→second lock chain");
      const leader = snapshot.rows.find((/** @type {Evidence} */ row) => row.pid === first && row.key === "period");
      const follower = snapshot.rows.find((/** @type {Evidence} */ row) => row.pid === second);
      assert.ok(leader && follower && Date.parse(follower.xactStart) - Date.parse(leader.xactStart) >= 3, "Controlled transactions lack the proven timestamp separation");
    }
  }
  assert.ok(firstProof, "Missing first-request-only lock proof");
}

/** Acquisition ordinals come from the exact real SQL result, before its handler
 * resumes. Persisted audit clocks are a separate, checked chronology witness.
 * @param {unknown} value @returns {FenceChronology} */
function validateFence(value) {
  const evidence = record(value, "Contention fence evidence");
  same(evidence.schemaVersion, 1, "fence witness schema");
  const auditTimestampOrderBasis = "Persisted AuditLog.createdAt values; chronology is not a lock or transaction-start witness";
  same(evidence.auditTimestampOrderBasis, auditTimestampOrderBasis, "audit clock witness basis");
  assert.ok(Array.isArray(evidence.operations) && evidence.operations.length === 2, "Missing actual contention pair");
  same(evidence.operations.map((operation) => operation.invocation), [0, 1], "operation invocation identities");
  const roles = new Set();
  for (const operation of evidence.operations) {
    record(operation, "Fence operation");
    assert.ok((operation.role === "bulk" || operation.role === "acceptance") && !roles.has(operation.role), "Missing/duplicate contention role"); roles.add(operation.role);
    same(operation.terminal, "succeeded", "successful contention operation");
    same(operation.failedAcquisitions, 0, "successful real fence acquisition");
    assert.ok(Array.isArray(operation.acquisitions) && operation.acquisitions.length === 1, "Missing/duplicate actual fence acquisition");
    const acquisition = record(operation.acquisitions[0], "Actual period acquisition");
    finite(acquisition.elapsedMs, "Real fence duration");
    assert.ok(instant(operation.startedAt, "Operation start") <= instant(acquisition.startedAt, "Acquisition start") &&
      instant(acquisition.startedAt, "Acquisition start") <= instant(acquisition.acquiredAt, "Acquisition completion") &&
      instant(acquisition.acquiredAt, "Acquisition completion") <= instant(operation.terminalAt, "Operation terminal"), "Invalid real acquisition chronology");
  }
  const bulk = evidence.operations.find((operation) => operation.role === "bulk"), acceptance = evidence.operations.find((operation) => operation.role === "acceptance");
  assert.ok(bulk && acceptance, "Missing actual contention roles");
  const bulkSequence = bulk.acquisitions[0].sequence, acceptanceSequence = acceptance.acquisitions[0].sequence;
  assert.ok((bulkSequence === 1 && acceptanceSequence === 2) || (bulkSequence === 2 && acceptanceSequence === 1), "Missing/duplicate actual acquisition ordinals");
  /** @type {ContentionOrder} */ const actualOrder = bulkSequence === 1 ? "bulk-before-acceptance" : "acceptance-before-bulk";
  same(evidence.order, actualOrder, "declared actual fence order");
  assert.ok(Array.isArray(evidence.audits) && evidence.audits.length === 4, "Missing four raw final audit identities");
  const identities = new Set();
  /** @type {{createdAt:string,auditId:string}|undefined} */ let prior;
  for (const audit of evidence.audits) {
    record(audit, "Raw contention audit");
    const id = text(audit.auditId, "Raw audit identity");
    assert.ok(!identities.has(id) && !id.startsWith("@alias:"), "Duplicate/normalized raw audit identity"); identities.add(id);
    const createdAt = text(audit.createdAt, "Raw persisted audit timestamp");
    instant(createdAt, "Raw persisted audit timestamp");
    same(new Date(createdAt).toISOString(), createdAt, "canonical persisted audit timestamp");
    assert.ok(auditOperations.includes(audit.operation), "Unknown final audit operation");
    if (prior) assert.ok(prior.createdAt < createdAt || prior.createdAt === createdAt && prior.auditId <= id, "Raw audits are not ordered by createdAt/id");
    prior = { createdAt, auditId: id };
  }
  for (const operation of auditOperations) same(evidence.audits.filter((audit) => audit.operation === operation).length, 1, "exact final audit operation population");
  const allocator = evidence.audits.find((audit) => audit.operation === auditOperations[0]);
  const response = evidence.audits.find((audit) => audit.operation === "sessionPlanning.respond");
  assert.ok(allocator && response, "Missing final operation audit");
  const responses = evidence.audits.filter((audit) => audit.operation !== auditOperations[0]);
  const allocatorIndex = evidence.audits.indexOf(allocator);
  /** @type {ContentionOrder|'interleaved'} */ const auditHistoryOrder = allocatorIndex === 0 ? "bulk-before-acceptance" : allocatorIndex === 3 ? "acceptance-before-bulk" : "interleaved";
  const responseTimestampUniform = new Set(responses.map((audit) => audit.createdAt)).size === 1;
  const hasTimestampTies = new Set(evidence.audits.map((audit) => audit.createdAt)).size !== 4;
  const crossGroupTimestampTie = responses.some((audit) => audit.createdAt === allocator.createdAt);
  /** @type {ContentionOrder|'tied'|'interleaved'} */ const auditTimestampOrder = responses.every((audit) => allocator.createdAt < audit.createdAt) ? "bulk-before-acceptance"
    : responses.every((audit) => allocator.createdAt > audit.createdAt) ? "acceptance-before-bulk" : crossGroupTimestampTie ? "tied" : "interleaved";
  const historyContradictsFence = auditHistoryOrder !== actualOrder;
  const auditTimestampContradictsFence = auditTimestampOrder !== "tied" && auditTimestampOrder !== actualOrder;
  for (const [key, result] of Object.entries({ auditHistoryOrder, auditTimestampOrder, responseTimestampUniform, hasTimestampTies, crossGroupTimestampTie, historyContradictsFence, auditTimestampContradictsFence })) same(evidence[key], result, `raw fence ${key}`);
  assert.ok(auditHistoryOrder !== "interleaved", "Final acceptance audit block is not intact");
  return { actualOrder, auditHistoryOrder, auditTimestampOrder, auditTimestampOrderBasis, responseTimestampUniform, hasTimestampTies,
    crossGroupTimestampTie, historyContradictsFence, auditTimestampContradictsFence,
    operations: evidence.operations, audits: evidence.audits };
}

/** @param {unknown} value @returns {Evidence[]} */
function finalAuditBlock(value) {
  const graph = record(value, "Full contention graph");
  const audits = record(graph.tables, "Full graph tables").AuditLog;
  assert.ok(Array.isArray(audits) && audits.length >= 4, "Missing full final audit block");
  const block = audits.slice(-4);
  for (let index = 0; index < auditOperations.length; index++) {
    const operation = auditOperations[index];
    const rows = block.filter((row) => row.operation === operation);
    assert.ok(rows.length === 1 && rows[0].action === auditActions[index] && rows[0].details?.outcome === "APPLIED", "Final graph audit block is not the four exact applied operations");
    same(audits.filter((row) => row.operation === operation && row.details?.outcome === "APPLIED").length, 1, "unique applied final operation graph");
  }
  return block;
}

/** Only an intact one-row/three-row audit block swap can certify a cross-clock
 * discrepancy. Every other graph byte/array position remains compared exactly.
 * @param {unknown} left @param {unknown} right @returns {boolean} */
function auditBlockSwapCertificate(left, right) {
  const a = record(left, "Bulk-first reference"), b = record(right, "Acceptance-first reference");
  const at = record(a.tables, "Bulk-first tables"), bt = record(b.tables, "Acceptance-first tables");
  const { AuditLog: aa, ...ar } = at, { AuditLog: ba, ...br } = bt;
  if (!isDeepStrictEqual({ ...a, tables: ar }, { ...b, tables: br }) || !Array.isArray(aa) || !Array.isArray(ba) || aa.length !== ba.length) return false;
  const first = aa.findIndex((row, index) => !isDeepStrictEqual(row, ba[index]));
  if (first < 0 || first + 4 > aa.length) return false;
  if (!isDeepStrictEqual(aa.slice(0, first), ba.slice(0, first)) || !isDeepStrictEqual(aa.slice(first + 4), ba.slice(first + 4))) return false;
  const ab = aa.slice(first, first + 4), bb = ba.slice(first, first + 4);
  const applied = (/** @type {Evidence} */ row) => row.details?.outcome === "APPLIED" && auditOperations.includes(row.operation) && row.action === auditActions[auditOperations.indexOf(row.operation)];
  return ab.every(applied) && bb.every(applied) && ab[0].operation === auditOperations[0] && bb[3].operation === auditOperations[0] &&
    new Set(ab.slice(1).map((row) => row.operation)).size === 3 && ab.slice(1).every((row) => auditOperations.slice(1).includes(row.operation)) &&
    isDeepStrictEqual(ab[0], bb[3]) && isDeepStrictEqual(ab.slice(1), bb.slice(0, 3));
}

/** @param {Evidence} report @param {Evidence} receipt @returns {FenceChronology} */
function receiptFence(report, receipt) {
  const chronology = validateFence(receipt.contentionFenceEvidence);
  same(receipt.contentionOrder, chronology.actualOrder, "receipt actual fence order");
  assert.ok(Array.isArray(report.preparationEvidence), "Missing report fence preparation evidence");
  const saved = report.preparationEvidence.filter((entry) => entry.stage === "contention-fence" && entry.scenario === receipt.scenario && entry.round === receipt.round);
  assert.ok(saved.length === 1, "Missing/duplicate saved fence witness");
  same(saved[0].evidence, receipt.contentionFenceEvidence, "saved/receipt actual fence witness");
  const block = finalAuditBlock(receipt.parity);
  same(block.map((row) => row.operation), /** @type {Evidence[]} */ (chronology.audits).map((row) => row.operation), "raw timestamp/id order explains the exact stored full history");
  return chronology;
}

/** @param {unknown} value @param {ContentionOrder} order @param {string} revision @param {boolean} candidate */
function validateControlledReport(value, order, revision, candidate) {
  const report = record(value, "Controlled report");
  same(report.status, "PASS", "successful controlled report");
  for (const key of ["failure", "error", "parityFailure"]) assert.ok(!Object.hasOwn(report, key), "Controlled report retains a failure");
  if (Object.hasOwn(report, "cleanupErrors")) same(report.cleanupErrors, [], "controlled report cleanup");
  same(report.revision, revision, "expected immutable revision");
  same(report.mode, "diagnostic", "controlled diagnostics remain separate from latency");
  same(report.partition, null, "unpartitioned controlled diagnostics");
  same(report.samplingComplete, true, "complete controlled sampling");
  same(report.partitionComplete, false, "unpartitioned completion flag");
  same(report.latencyComparisonEligible, false, "diagnostic latency ineligibility");
  same(report.beforeAfterSemanticEquality, candidate ? true : null, "controlled before/after semantic equality");
  const contract = staticContract(report);
  const scenario = CONTENTION_SCENARIOS[order];
  same(report.fixture.scenarios, [scenario], "controlled scenario population");
  same(report.fixture.samples, 3, "three complete measured controlled rounds");
  const runtime = record(report.runtime, "Controlled runtime");
  text(runtime.cpu, "Controlled CPU evidence");
  assert.ok(Number.isInteger(runtime.logicalCpus) && runtime.logicalCpus > 0, "Missing controlled CPU count");
  const runner = record(report.profileRunner, "Controlled runner");
  for (const key of ["id", "name", "os", "arch"]) text(runner[key], `Controlled runner ${key}`);
  assert.ok(Number.isInteger(report.timeoutMs) && report.timeoutMs >= 30_000 && report.timeoutMs <= 150_000 && finite(report.elapsedMs, "Completed command duration") <= report.timeoutMs, "Over-budget controlled command");
  assert.ok(instant(report.startedAt, "Report start") <= instant(report.finishedAt, "Report finish"), "Report finish predates start");
  assert.ok(Array.isArray(report.phaseTimings) && report.phaseTimings.length > 0 && report.phaseTimings.every((phase) => phase.status === "completed" && phase.elapsedIsLowerBound === false && Number.isFinite(phase.elapsedMs) && phase.elapsedMs >= 0), "Incomplete controlled harness phase");
  same(report.httpUnauthorized, [{ case: "missing", status: 401, code: "UNAUTHORIZED" }, { case: "wrong", status: 401, code: "UNAUTHORIZED" }], "actual HTTP denial evidence");
  assert.ok(report.http?.loopback === true && Number.isInteger(report.http.requests) && report.http.requests >= 2, "Missing actual HTTP evidence");
  assert.ok(Array.isArray(report.receipts) && report.receipts.length === 3, "Missing three controlled receipts");
  same(report.receipts.map((receipt) => receipt.round), [0, 1, 2], "exact controlled round order");
  const first = record(report.receipts[0], "First controlled receipt");
  const parity = record(first.parity, "Full controlled parity");
  same(record(parity.normalization, "Parity normalization").version, 2, "complete parity normalization version");
  record(parity.tables, "Full parity tables"); record(parity.semanticAliases, "Complete alias dictionary");
  assert.ok(Array.isArray(parity.clockEvidence) && Array.isArray(parity.continuationProvenance), "Missing full clock/continuation evidence");
  const semanticDigest = sha(first.digest, 64, "Controlled semantic digest");
  same(digest(parity), semanticDigest, "controlled full parity digest");
  for (const receipt of report.receipts) {
    same(receipt.scenario, scenario, "controlled receipt scenario");
    same(receipt.contentionOrder, order, "declared controlled receipt order");
    same(receipt.digest, semanticDigest, "stable controlled round digest");
    same(receipt.parity, parity, "every controlled full graph");
    assert.ok(Object.hasOwn(receipt, "output"), "Missing raw controlled output");
    same(record(receipt.output, "Raw controlled output").scenario, "contention", "canonical full procedure result label");
    for (const key of ["receiptInputs", "pairingCreations", "operationWindows", "parityWindow"]) assert.ok(Array.isArray(receipt[key]), `Missing raw controlled ${key}`);
  }
  assert.ok(Array.isArray(report.preparationEvidence), "Missing controlled preparation evidence");
  const proofs = report.preparationEvidence.filter((entry) => entry.stage === "controlled-contention-chain");
  const proofRounds = new Set();
  for (const proof of proofs) {
    same(proof.scenario, scenario, "controlled proof scenario");
    assert.ok([-1, 0, 1, 2].includes(proof.round) && !proofRounds.has(proof.round), "Duplicate/foreign controlled proof round");
    proofRounds.add(proof.round);
    validateProof(record(proof.evidence, "Controlled proof"), order);
  }
  for (const round of [0, 1, 2]) assert.ok(proofRounds.has(round), "Missing measured-round lock-chain proof");
  for (const receipt of report.receipts) {
    const chronology = receiptFence(report, receipt);
    same(chronology.actualOrder, order, "controlled real fence order");
    same(chronology.auditHistoryOrder, order, "controlled raw final history order");
  }
  const metrics = record(report.metrics, "Controlled metrics");
  same(metrics.mode, "diagnostic", "raw diagnostic metrics");
  assert.ok(Array.isArray(metrics.samples) && Array.isArray(report.sampleRounds) && metrics.samples.length === report.sampleRounds.length, "Missing indexed raw controlled samples");
  const indices = new Set();
  for (const link of report.sampleRounds) {
    assert.ok(Number.isInteger(link.sampleIndex) && link.sampleIndex >= 0 && link.sampleIndex < metrics.samples.length && !indices.has(link.sampleIndex), "Duplicate/foreign sample index");
    indices.add(link.sampleIndex);
    same(link.scenario, scenario, "raw sample scenario");
    assert.ok([0, 1, 2].includes(link.round), "Warmup/foreign sample entered controlled distribution");
    const sample = record(metrics.samples[link.sampleIndex], "Completed controlled sample");
    same(sample.label, link.label, "raw sample label");
    assert.ok(Object.hasOwn(population, sample.label), "Unexpected controlled sample label");
    finite(sample.elapsedMs, "Raw diagnostic duration");
    same(sample.censored, false, "uncensored controlled sample"); same(sample.elapsedIsLowerBound, false, "complete controlled duration");
    assert.ok(sample.status === "succeeded" || sample.status === "failed", "Unfinished controlled operation");
    same(sample.succeeded, sample.status === "succeeded", "controlled operation outcome");
    if (sample.succeeded) assert.ok(!sample.error, "Successful controlled operation retains an error");
    else same(sample.error, "OPERATION_FAILED", "intentional completed operation error");
    record(sample.diagnostics, "Raw diagnostic attribution");
  }
  for (const round of [0, 1, 2]) {
    /** @type {Evidence[]} */ const rows = report.sampleRounds.filter((link) => link.round === round).map((link) => metrics.samples[link.sampleIndex]);
    same(Object.fromEntries(Object.keys(population).map((label) => [label, rows.filter((sample) => sample.label === label).length])), population, "complete controlled per-round operations");
    same(rows.filter((sample) => sample.label.startsWith("http:competing-schedule-") && !sample.succeeded).length, 1, "one intentional competing request conflict");
    assert.ok(rows.every((sample) => sample.label.startsWith("http:competing-schedule-") || sample.succeeded), "Unexpected controlled operation failure");
  }
  const summaries = record(metrics.operations, "Diagnostic summaries");
  same(new Set(Object.keys(summaries)), new Set(Object.keys(population)), "diagnostic summary labels");
  for (const [label, summary] of Object.entries(summaries)) {
    const rows = metrics.samples.filter((sample) => sample.label === label);
    same({ samples: summary.samples, completed: summary.completed, errors: summary.errors, unfinished: summary.unfinished, censored: summary.censored }, { samples: rows.length, completed: rows.length, errors: rows.filter((sample) => !sample.succeeded).length, unfinished: 0, censored: 0 }, "diagnostic summary/raw agreement");
  }
  return { report, contract, parity, digest: semanticDigest };
}

/** @template T @param {T} value @param {Set<object>} [seen] @returns {T} */
function freeze(value, seen = new Set()) {
  if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  return value;
}

/** Validate both independent real ordering references before accepting any free
 * observation. Returning a detached frozen copy prevents later input mutation.
 * @param {Record<ContentionOrder,ReportPair>} pairs
 * @param {ReferenceOptions} options @returns {ContentionReferences} */
export function buildContentionReferences(pairs, options) {
  const baseline = sha(options.expectedBaseline, 40, "Expected control revision"), candidate = sha(options.expectedCandidate, 40, "Expected candidate revision");
  assert.ok(baseline !== candidate, "Control and candidate revisions must differ");
  same(new Set(Object.keys(record(pairs, "Controlled pairs"))), new Set(CONTENTION_ORDERS), "exactly two canonical ordering pairs");
  /** @type {Partial<Record<ContentionOrder,OrderReference>>} */
  const byOrder = {};
  /** @type {ControlledEvidence[]} */
  const controlledEvidence = [];
  /** @type {unknown} */ let common;
  /** @type {{nodeImage:string,comparison:unknown}|undefined} */ let inputs;
  /** @type {Record<string,unknown>} */ const byRevision = {};
  for (const order of CONTENTION_ORDERS) {
    const pair = record(pairs[order], "Controlled report pair");
    const before = validateControlledReport(pair.baseline, order, baseline, false), after = validateControlledReport(pair.candidate, order, candidate, true);
    const currentInputs = referenceInputs(pair, before.report, after.report, baseline);
    if (inputs) same(currentInputs, inputs, "same controlled image/comparison inputs across ordering jobs");
    else inputs = currentInputs;
    same(after.parity, before.parity, "fixed-order complete before/after graph");
    same(after.digest, before.digest, "fixed-order semantic digest");
    for (const key of ["runtime", "profileRunner", "database", "postgresVersion"]) same(after.report[key], before.report[key], `paired controlled ${key}`);
    for (const entry of [before, after]) {
      if (common === undefined) common = entry.contract.common;
      else same(entry.contract.common, common, "controlled shared source/harness/schema/anchor contract");
      if (Object.hasOwn(byRevision, entry.report.revision)) same(entry.contract.sourceHashes, byRevision[entry.report.revision], "same-revision complete source inventory");
      else byRevision[entry.report.revision] = entry.contract.sourceHashes;
    }
    byOrder[order] = { scenario: CONTENTION_SCENARIOS[order], parity: before.parity, digest: before.digest };
    controlledEvidence.push({ order, scenario: CONTENTION_SCENARIOS[order], reference: pair.reference === undefined ? null : text(pair.reference, "Artifact reference"), baseline: before.report, candidate: after.report });
  }
  const first = byOrder[CONTENTION_ORDERS[0]], second = byOrder[CONTENTION_ORDERS[1]];
  assert.ok(first && second && first.digest !== second.digest && !isDeepStrictEqual(first.parity, second.parity), "Controlled orderings must have unique full graphs and digests");
  assert.ok(inputs, "Missing validated controlled input receipts");
  const result = freeze(structuredClone({ version: /** @type {const} */ (1), expectedBaseline: baseline, expectedCandidate: candidate,
    byOrder: /** @type {Record<ContentionOrder,OrderReference>} */ (byOrder), controlledEvidence,
    auditBlockSwapCertificate: auditBlockSwapCertificate(first.parity, second.parity),
    compatibility: { common, byRevision, ...inputs } }));
  validatedReferences.add(result);
  return result;
}

/** Bounded JSON loading only; callers resolve artifact layouts explicitly instead
 * of accidentally picking a report from another run or attempt.
 * @param {Record<ContentionOrder,PathPair>} pairs
 * @param {ReferenceOptions} options @returns {ContentionReferences} */
export function loadContentionReferences(pairs, options) {
  /** @type {Partial<Record<ContentionOrder,ReportPair>>} */ const reports = {};
  same(new Set(Object.keys(record(pairs, "Controlled paths"))), new Set(CONTENTION_ORDERS), "exactly two canonical path pairs");
  const paths = new Set();
  for (const order of CONTENTION_ORDERS) {
    const pair = record(pairs[order], "Controlled paths");
    const read = (/** @type {unknown} */ value, json = true, unique = false) => {
      const path = resolve(text(value, "Controlled report path"));
      if (unique) { assert.ok(!paths.has(path), "Controlled report path reused"); paths.add(path); }
      const stat = statSync(path);
      assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 64 * 1024 * 1024, "Controlled JSON file is empty or oversized");
      const bytes = readFileSync(path, "utf8");
      return json ? /** @type {unknown} */ (JSON.parse(bytes)) : bytes;
    };
    reports[order] = { baseline: read(pair.baselinePath, true, true), candidate: read(pair.candidatePath, true, true), comparison: read(pair.comparisonPath), nodeImage: text(read(pair.nodeImagePath, false), "Node image file"), reference: pair.reference ?? `${resolve(pair.baselinePath)} | ${resolve(pair.candidatePath)}` };
  }
  return buildContentionReferences(/** @type {Record<ContentionOrder,ReportPair>} */ (reports), options);
}

/** Static admission for the current free report, including a RUNNING report
 * before its first observation. CPU/runner differences across jobs are retained,
 * while complete source bytes for that immutable revision must match.
 * @param {unknown} value @param {ContentionReferences} refs */
export function assertContentionReferenceCompatibility(value, refs) {
  assertValidated(refs);
  const report = record(value, "Free contention report");
  assert.ok(report.revision === refs.expectedBaseline || report.revision === refs.expectedCandidate, "Free report has an unexpected revision");
  assert.ok(Array.isArray(report.fixture?.scenarios) && report.fixture.scenarios.length === 1 && ["contention", ...Object.values(CONTENTION_SCENARIOS)].includes(report.fixture.scenarios[0]), "Unexpected contention scenario");
  const contract = staticContract(report);
  same(contract.common, refs.compatibility.common, "free/reference shared static contract");
  same(contract.sourceHashes, refs.compatibility.byRevision[report.revision], "free/reference same-revision source bytes");
  same(report.contentionInputs, { nodeImage: refs.compatibility.nodeImage, comparison: refs.compatibility.comparison }, "free/reference independently captured image/comparison inputs");
}

/** A free graph must be exactly one real controlled reference. Matching only the
 * digest is insufficient, and no graph/array canonicalization is performed here.
 * @param {unknown} value @param {ContentionReferences} refs @returns {ContentionOrder} */
export function validateContentionReceipt(value, refs) {
  assertValidated(refs);
  const receipt = record(value, "Free contention receipt");
  const full = record(receipt.parity, "Stored full free parity");
  const supplied = sha(receipt.digest, 64, "Free semantic digest");
  same(digest(full), supplied, "free full parity digest");
  const matches = CONTENTION_ORDERS.filter((order) => refs.byOrder[order].digest === supplied && isDeepStrictEqual(refs.byOrder[order].parity, full));
  assert.ok(matches.length === 1, matches.length === 0 ? "Free contention graph is outside both controlled references" : "Free contention graph ambiguously matches multiple references");
  const order = matches[0];
  assert.ok(order, "Missing unique contention ordering");
  if (Object.hasOwn(receipt, "contentionHistoryOrder")) same(receipt.contentionHistoryOrder, order, "declared free contention history ordering");
  return order;
}

/** Actual mutex acquisition determines timing strata. A different exact history
 * class is accepted only with both the restrictive whole-reference certificate
 * and independently checked persisted audit timestamps/IDs explaining that class.
 * The receipt need not already be appended to a currently RUNNING report.
 * @param {unknown} value @param {unknown} receiptValue @param {ContentionReferences} refs
 * @returns {{actualOrder:ContentionOrder,historyOrder:ContentionOrder,certifiedDisagreement:boolean,chronology:FenceChronology}} */
export function validateFreeContentionReceipt(value, receiptValue, refs) {
  assertContentionReferenceCompatibility(value, refs);
  const report = record(value, "Free contention report"), receipt = record(receiptValue, "Free contention receipt");
  same(receipt.scenario, "contention", "free contention receipt scenario");
  assert.ok(Number.isInteger(receipt.round) && receipt.round >= -1, "Invalid free receipt round");
  const historyOrder = validateContentionReceipt(receipt, refs);
  same(receipt.contentionHistoryOrder, historyOrder, "stored exact history class");
  const chronology = receiptFence(report, receipt);
  same(chronology.auditHistoryOrder, historyOrder, "raw chronology and complete reference history");
  const certifiedDisagreement = chronology.actualOrder !== historyOrder;
  if (certifiedDisagreement) {
    assert.ok(refs.auditBlockSwapCertificate, "Actual fence/history discrepancy lacks the exact intact audit-block swap certificate");
    assert.ok(chronology.crossGroupTimestampTie || chronology.auditTimestampContradictsFence, "Raw persisted audit clocks do not explain fence/history discrepancy");
  }
  return freeze(structuredClone({ actualOrder: chronology.actualOrder, historyOrder, certifiedDisagreement, chronology }));
}
