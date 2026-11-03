import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CONTENTION_ORDERS, CONTENTION_SCENARIOS, assertContentionReferenceCompatibility,
  buildContentionReferences, loadContentionReferences, validateContentionReceipt, validateFreeContentionReceipt,
} from "./contention-references.mjs";

type Order = typeof CONTENTION_ORDERS[number];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const options = { expectedBaseline: "a".repeat(40), expectedCandidate: "b".repeat(40) };
const harnessPaths = ["scripts/profile-scheduling-requests.ts", "scripts/scheduling-profile/fixtures.ts", "scripts/scheduling-profile/scenarios.ts", "scripts/scheduling-profile/metrics.ts", "scripts/scheduling-profile/parity.ts", "scripts/scheduling-profile/http.ts", "scripts/scheduling-profile/register-server-runtime.mjs", "scripts/scheduling-profile/server-runtime-hooks.mjs", "scripts/scheduling-profile/controlled-contention.ts", "scripts/scheduling-profile/contention-references.mjs", "scripts/scheduling-profile/contention-fence-witness.ts"];
const population = { "http:concurrent-2-agenda": 2, "http:concurrent-4-agenda": 4, "http:competing-schedule-a": 1, "http:competing-schedule-b": 1, "http:contention-pending-room": 1, "http:contended-bulk": 1, "http:contended-acceptance": 1 };
const period = { classid: "10", objid: "20", objsubid: 1 };
const room = { classid: "30", objid: "40", objsubid: 1 };
const auditOperations = ["admin.autoAssignUnassignedRooms", "sessionPlanning.accepted", "sessionPlanning.responded", "sessionPlanning.respond"];
const auditActions = ["Auto Assign Unassigned Rooms", "Session planning: accepted", "Session planning: responded", "Respond"];
const nodeImage = sha("immutable Node image");
function comparison() {
  const migrations = { "prisma/migrations/20260101000000_initial/migration.sql": sha("SQL") };
  return { baselineRevision: options.expectedBaseline, mode: "identical", requiresNativeSchemaControl: false,
    originalSchemaSha256: sha("shared schema"), candidateSchemaSha256: sha("shared schema"),
    originalLockfileSha256: sha("same dependencies"), candidateLockfileSha256: sha("same dependencies"),
    historicalMigrations: migrations, candidateMigrationHashes: migrations,
    originalSourceHashes: { "src/server/session-planning/index.ts": sha("control") },
    baselineSelectionPath: null as string | null, baselineSelectionFileSha256: null as string | null, baselineSelectionSource: "explicit-cli",
    reviewedManifestPath: null as string | null, reviewedManifest: null as unknown,
    reviewedManifestSha256: null as string | null, reviewedManifestFileSha256: null as string | null };
}
function auditBlock(order: Order) {
  const rows = auditOperations.map((operation, index) => ({ id: `normalized-audit-${index}`, operation, action: auditActions[index], details: { outcome: "APPLIED", retained: { ordinal: index } } }));
  return order === "bulk-before-acceptance" ? rows : [...rows.slice(1), rows[0]!];
}
function fence(order: Order, history: Order = order, tied = false) {
  const operations = (["bulk", "acceptance"] as const).map((role, invocation) => {
    const sequence = (role === "bulk") === (order === "bulk-before-acceptance") ? 1 : 2;
    return { role, invocation, terminal: "succeeded", failedAcquisitions: 0, startedAt: "2026-11-03T00:00:00.000Z", terminalAt: "2026-11-03T00:00:00.040Z",
      acquisitions: [{ sequence, startedAt: "2026-11-03T00:00:00.000Z", acquiredAt: `2026-11-03T00:00:00.${sequence === 1 ? "020" : "030"}Z`, elapsedMs: sequence * 10 }] };
  });
  const audits = auditBlock(history).map((row) => {
    const bulk = row.operation === auditOperations[0];
    const earlier = bulk === (history === "bulk-before-acceptance");
    return { auditId: bulk ? history === "bulk-before-acceptance" ? "a-bulk" : "z-bulk" : `b-response-${auditOperations.indexOf(row.operation)}`,
      operation: row.operation, createdAt: `2026-11-03T00:00:00.${tied || earlier ? "001" : "005"}Z` };
  });
  return { schemaVersion: 1, order, operations, audits, auditHistoryOrder: history,
    auditTimestampOrder: tied ? "tied" : history, auditTimestampOrderBasis: "Persisted AuditLog.createdAt values; chronology is not a lock or transaction-start witness", responseTimestampUniform: true, hasTimestampTies: true,
    crossGroupTimestampTie: tied, historyContradictsFence: history !== order, auditTimestampContradictsFence: !tied && history !== order };
}

function proof(order: Order) {
  const row = (pid: number, key: "period" | "room", granted: boolean, blockers: number[]) => ({
    pid, key, granted, blockers, mode: "ExclusiveLock", ...(key === "period" ? period : room),
    applicationName: pid === 101 ? "fixture-hold" : "fixture",
    xactStart: `2026-11-03T00:00:00.${pid === 103 ? "005" : "001"}Z`,
    observedAt: "2026-11-03T00:00:00.010Z",
  });
  const first = [row(101, "room", true, []), row(102, "period", true, [101]), row(102, "room", false, [101])];
  return {
    order, applicationName: "fixture", phase: "completed", completed: true,
    holderPid: 101, firstPid: 102, secondPid: 103, holdMs: 10, lockKeys: { period, room },
    snapshots: [{ phase: "first-request", elapsedMs: 3, rows: first },
      { phase: "second-request", elapsedMs: 8, rows: [...first, row(103, "period", false, [102])] }],
  };
}

function report(order: Order, head = false) {
  const scenario = CONTENTION_SCENARIOS[order];
  const graph = {
    captureSchema: "shared",
    normalization: { version: 3, preserved: ["full recovery graph and ordering"] },
    tables: { RecoveryChange: [{ ordinal: 1, operation: order }, { ordinal: 2, operation: "other" }], AuditLog: auditBlock(order) },
    semanticAliases: { "@alias:complete": `complete identity:${order}` },
    continuationProvenance: [{ assignedAt: "unchanged exact domain boundary" }], clockEvidence: [{ equal: false, relation: order }],
  };
  const samples: { label: string; elapsedMs: number; succeeded: boolean; status: string; censored: boolean; elapsedIsLowerBound: boolean; error?: string; diagnostics: { acquisitionStatementMs: number[] } }[] = [];
  const sampleRounds: { sampleIndex: number; scenario: string; round: number; label: string }[] = [];
  for (let round = 0; round < 3; round++) {
    for (const [label, count] of Object.entries(population)) {
      for (let occurrence = 0; occurrence < count; occurrence++) {
        const failed = label === "http:competing-schedule-a";
        sampleRounds.push({ sampleIndex: samples.length, scenario, round, label });
        samples.push({ label, elapsedMs: 10 + round + occurrence, succeeded: !failed, status: failed ? "failed" : "succeeded", censored: false, elapsedIsLowerBound: false, ...(failed ? { error: "OPERATION_FAILED" } : {}), diagnostics: { acquisitionStatementMs: [2 + round] } });
      }
    }
  }
  const migration = { name: "20260101000000_initial", sha256: sha("SQL"), lfSha256: sha("SQL"), crlfSha256: sha("SQL") };
  return {
    status: "PASS", captureSchema: "shared", schemaVersion: 3, partitionProtocolVersion: 1, partition: null,
    mode: "diagnostic", transport: "http", samplingComplete: true, partitionComplete: false, latencyComparisonEligible: false,
    revision: head ? options.expectedCandidate : options.expectedBaseline,
    contentionInputs: { nodeImage, comparison: comparison() },
    beforeAfterSemanticEquality: head ? true : null,
    fixture: { anchor: "2026-11-02T23:00:00.000Z", scenarios: [scenario], transport: "http", samples: 3, currentPairings: 100, rooms: 100 },
    runtime: { node: "v22.20.0", platform: "linux", arch: "x64", cpu: `hosted-${order}`, logicalCpus: 4 },
    profileRunner: { id: `runner-${order}`, name: `runner-${order}`, os: "Linux", arch: "X64" },
    database: { host: "127.0.0.1", port: 55439, name: "shbs_performance_test", poolMax: 6 }, postgresVersion: [{ server_version: "16.6" }],
    harnessHashes: Object.fromEntries(harnessPaths.map((path) => [path, sha(path)])),
    sourceHashes: { "prisma/schema.prisma": sha("shared schema"), "package-lock.json": sha("same dependencies"), "src/server/session-planning/index.ts": sha(head ? "candidate" : "control") },
    migrationFiles: [migration], migrations: [{ name: migration.name, checksum: migration.sha256 }],
    timeoutMs: 150_000, elapsedMs: 4000, startedAt: "2026-11-03T00:00:00.000Z", finishedAt: "2026-11-03T00:00:04.000Z",
    phaseTimings: [{ phase: "scenario", status: "completed", elapsedIsLowerBound: false, elapsedMs: 3000 }],
    httpUnauthorized: [{ case: "missing", status: 401, code: "UNAUTHORIZED" }, { case: "wrong", status: 401, code: "UNAUTHORIZED" }], http: { loopback: true, requests: 35 },
    receipts: [0, 1, 2].map((round) => ({ scenario, round, contentionOrder: order, contentionHistoryOrder: order, contentionFenceEvidence: fence(order), parity: graph, digest: sha(JSON.stringify(graph)), output: { scenario: "contention", results: ["full original prelude", "bulk", "acceptance"] }, receiptInputs: [], pairingCreations: [], operationWindows: [], parityWindow: [] })),
    preparationEvidence: [
      ...[-1, 0, 1, 2].map((round) => ({ scenario, round, stage: "controlled-contention-chain" as const, evidence: proof(order) })),
      ...[0, 1, 2].map((round) => ({ scenario, round, stage: "contention-fence" as const, evidence: fence(order) })),
    ],
    sampleRounds, metrics: { mode: "diagnostic", samples, operations: Object.fromEntries(Object.keys(population).map((label) => {
      const rows = samples.filter((sample) => sample.label === label);
      return [label, { samples: rows.length, completed: rows.length, errors: rows.filter((sample) => !sample.succeeded).length, unfinished: 0, censored: 0 }];
    })) },
  };
}
function pairs() {
  return {
    "bulk-before-acceptance": { baseline: report("bulk-before-acceptance"), candidate: report("bulk-before-acceptance", true), nodeImage: `sha256:${nodeImage}`, comparison: comparison(), reference: "artifact-bulk-first" },
    "acceptance-before-bulk": { baseline: report("acceptance-before-bulk"), candidate: report("acceptance-before-bulk", true), nodeImage: `sha256:${nodeImage}`, comparison: comparison(), reference: "artifact-acceptance-first" },
  };
}
function auditSwapPairs() {
  const input = pairs(), common = structuredClone(input[CONTENTION_ORDERS[0]].baseline.receipts[0]!.parity);
  for (const order of CONTENTION_ORDERS) {
    for (const arm of [input[order].baseline, input[order].candidate]) {
      const graph = { ...structuredClone(common), tables: { ...structuredClone(common.tables), AuditLog: auditBlock(order) } };
      for (const receipt of arm.receipts) { receipt.parity = structuredClone(graph); receipt.digest = sha(JSON.stringify(graph)); }
    }
  }
  return input;
}
function freeObservation(input: ReturnType<typeof pairs>, actual: Order, history: Order = actual, tied = false) {
  const receipt = { ...structuredClone(input[history].candidate.receipts[0]!), scenario: "contention", contentionOrder: actual,
    contentionHistoryOrder: history, contentionFenceEvidence: fence(actual, history, tied) };
  const current = { ...structuredClone(input[history].candidate), status: "RUNNING", mode: "latency",
    fixture: { ...input[history].candidate.fixture, scenarios: ["contention"], samples: 40 },
    preparationEvidence: [{ scenario: "contention", round: 0, stage: "contention-fence", evidence: receipt.contentionFenceEvidence }], receipts: [] };
  return { report: current, receipt };
}

void test("validates both full controlled orders, retaining132 diagnostic observations separately", () => {
  const input = pairs(), refs = buildContentionReferences(input, options);
  assert.deepEqual(CONTENTION_ORDERS, ["bulk-before-acceptance", "acceptance-before-bulk"]);
  assert.notEqual(refs.byOrder[CONTENTION_ORDERS[0]].digest, refs.byOrder[CONTENTION_ORDERS[1]].digest);
  assert.equal(refs.controlledEvidence.length, 2);
  assert.deepEqual(refs.controlledEvidence[0]?.baseline, input[CONTENTION_ORDERS[0]].baseline);
  assert.equal(CONTENTION_ORDERS.flatMap((order) => [input[order].baseline, input[order].candidate]).reduce((sum, row) => sum + row.metrics.samples.length, 0), 132);
  for (const order of CONTENTION_ORDERS) {
    for (const receipt of input[order].baseline.receipts) assert.equal(validateContentionReceipt(receipt, refs), order);
  }
  assert.ok(Object.isFrozen(refs) && Object.isFrozen(refs.byOrder) && Object.isFrozen(refs.byOrder[CONTENTION_ORDERS[0]].parity));
  input[CONTENTION_ORDERS[0]].baseline.receipts[0]!.parity.tables.RecoveryChange[0]!.operation = "later input mutation";
  assert.notDeepEqual(refs.byOrder[CONTENTION_ORDERS[0]].parity, input[CONTENTION_ORDERS[0]].baseline.receipts[0]!.parity);
});

void test("rejects original-schema contention evidence before reference acceptance", () => {
  const input = pairs();
  const report = input["bulk-before-acceptance"].baseline;
  report.captureSchema = "native-original";
  assert.throws(() => buildContentionReferences(input, options), /complete shared capture/);
  report.captureSchema = "shared";
  report.receipts[0]!.parity.captureSchema = "native-original";
  assert.throws(() => buildContentionReferences(input, options), /graph capture schema/);
});

void test("admits static RUNNING free reports across runners, while pinning all source/fixture inputs", () => {
  const input = pairs(), refs = buildContentionReferences(input, options);
  const current = { ...input[CONTENTION_ORDERS[0]].candidate, status: "RUNNING", mode: "latency",
    fixture: { ...input[CONTENTION_ORDERS[0]].candidate.fixture, scenarios: ["contention"], samples: 40 },
    profileRunner: { id: "another", name: "another", os: "Linux", arch: "X64" },
    runtime: { ...input[CONTENTION_ORDERS[0]].candidate.runtime, cpu: "another hosted CPU", logicalCpus: 8 } };
  assert.doesNotThrow(() => assertContentionReferenceCompatibility(current, refs));
  for (const mutate of [
    (row: typeof current) => { row.fixture.anchor = "2026-11-03T23:00:00.000Z"; },
    (row: typeof current) => { row.sourceHashes["src/server/session-planning/index.ts"] = sha("different bytes"); },
    (row: typeof current) => { row.runtime.node = "v22.21.0"; },
    (row: typeof current) => { row.harnessHashes["scripts/scheduling-profile/parity.ts"] = sha("different harness"); },
    (row: typeof current) => { row.migrations[0]!.checksum = sha("different SQL"); },
    (row: typeof current) => { row.fixture.currentPairings = 99; },
  ]) {
    const changed = structuredClone(current); mutate(changed);
    assert.throws(() => assertContentionReferenceCompatibility(changed, refs));
  }
});

void test("rejects missing/duplicate pairs, wrong revisions and incomplete/failed/over-budget reports", () => {
  const mutations = [
    (row: ReturnType<typeof report>) => { row.revision = "c".repeat(40); },
    (row: ReturnType<typeof report>) => { row.status = "FAIL"; },
    (row: ReturnType<typeof report>) => { row.mode = "latency"; },
    (row: ReturnType<typeof report>) => { row.samplingComplete = false; },
    (row: ReturnType<typeof report>) => { row.elapsedMs = 150_001; },
    (row: ReturnType<typeof report>) => { row.receipts.pop(); },
    (row: ReturnType<typeof report>) => { row.receipts[2]!.round = 1; },
    (row: ReturnType<typeof report>) => { row.preparationEvidence.splice(2, 1); },
    (row: ReturnType<typeof report>) => { row.metrics.samples[0]!.censored = true; },
    (row: ReturnType<typeof report>) => { row.sampleRounds[1]!.sampleIndex = 0; },
    (row: ReturnType<typeof report>) => { row.metrics.samples[0]!.status = "unfinished"; },
    (row: ReturnType<typeof report>) => { row.metrics.samples[0]!.succeeded = false; row.metrics.samples[0]!.status = "failed"; row.metrics.samples[0]!.error = "OPERATION_FAILED"; },
    (row: ReturnType<typeof report>) => { row.migrationFiles.push(row.migrationFiles[0]!); },
  ];
  for (const mutate of mutations) {
    const input = pairs(); mutate(input[CONTENTION_ORDERS[0]].candidate);
    assert.throws(() => buildContentionReferences(input, options));
  }
  const missing = { "bulk-before-acceptance": pairs()[CONTENTION_ORDERS[0]] };
  assert.throws(() => buildContentionReferences(missing as ReturnType<typeof pairs>, options), /exactly two/);
  const input = pairs(); input[CONTENTION_ORDERS[1]] = input[CONTENTION_ORDERS[0]];
  assert.throws(() => buildContentionReferences(input, options));
});

void test("requires real exclusive holder→first→second proof each round, not launch order labels", () => {
  const mutations = [
    (row: ReturnType<typeof proof>) => { row.completed = false; },
    (row: ReturnType<typeof proof>) => { row.firstPid = row.holderPid; },
    (row: ReturnType<typeof proof>) => { row.snapshots[1]!.rows[3]!.granted = true; },
    (row: ReturnType<typeof proof>) => { row.snapshots[1]!.rows[3]!.blockers = [101]; },
    (row: ReturnType<typeof proof>) => { row.snapshots[1]!.rows[3]!.objid = "999"; },
    (row: ReturnType<typeof proof>) => { row.snapshots[1]!.rows[3]!.applicationName = "foreign-pool"; },
    (row: ReturnType<typeof proof>) => { row.snapshots[1]!.rows[3]!.xactStart = "2026-11-03T00:00:00.002Z"; },
    (row: ReturnType<typeof proof>) => { row.snapshots[0]!.rows = []; },
    (row: ReturnType<typeof proof>) => { row.snapshots[1]!.rows.push(row.snapshots[1]!.rows[3]!); },
    (row: ReturnType<typeof proof>) => { row.holdMs = 10_001; },
  ];
  for (const mutate of mutations) {
    const input = pairs(), entry = input[CONTENTION_ORDERS[0]].candidate.preparationEvidence[1]!;
    assert.equal(entry.stage, "controlled-contention-chain");
    assert.ok(entry.stage === "controlled-contention-chain");
    mutate(entry.evidence);
    assert.throws(() => buildContentionReferences(input, options));
  }
});

void test("matches exact full graphs/digests; preserves journal order, ties, dictionaries and declared lock order", () => {
  const input = pairs(), refs = buildContentionReferences(input, options);
  const receipt = structuredClone(input[CONTENTION_ORDERS[0]].baseline.receipts[0]!);
  for (const mutate of [
    (row: typeof receipt) => { row.parity.tables.RecoveryChange.reverse(); },
    (row: typeof receipt) => { row.parity.clockEvidence[0]!.equal = true; },
    (row: typeof receipt) => { row.parity.semanticAliases["@alias:complete"] = "changed full semantic identity"; },
  ]) {
    const changed = structuredClone(receipt); mutate(changed); changed.digest = sha(JSON.stringify(changed.parity));
    assert.throws(() => validateContentionReceipt(changed, refs), /outside both/);
  }
  assert.throws(() => validateContentionReceipt({ ...receipt, digest: "0".repeat(64) }, refs), /full parity digest/);
  assert.throws(() => validateContentionReceipt({ ...receipt, parity: undefined }, refs), /Stored full/);
  assert.equal(validateContentionReceipt({ ...receipt, contentionOrder: CONTENTION_ORDERS[1] }, refs), CONTENTION_ORDERS[0], "Graph classification does not infer actual lock acquisition");
  assert.throws(() => validateContentionReceipt({ ...receipt, contentionHistoryOrder: CONTENTION_ORDERS[1] }, refs), /history ordering/);
  assert.throws(() => validateContentionReceipt(receipt, structuredClone(refs)), /validated builder/);
  assert.throws(() => assertContentionReferenceCompatibility(input[CONTENTION_ORDERS[0]].baseline, structuredClone(refs)), /validated builder/);
});

void test("fails before use when fixed-order graphs diverge or both order references collapse", () => {
  const diverged = pairs();
  const altered = diverged[CONTENTION_ORDERS[0]].candidate;
  for (const receipt of altered.receipts) { receipt.parity.tables.RecoveryChange.reverse(); receipt.digest = sha(JSON.stringify(receipt.parity)); }
  assert.throws(() => buildContentionReferences(diverged, options));
  const collapsed = pairs(), graph = collapsed[CONTENTION_ORDERS[0]].baseline.receipts[0]!.parity;
  for (const row of [collapsed[CONTENTION_ORDERS[1]].baseline, collapsed[CONTENTION_ORDERS[1]].candidate]) {
    for (const receipt of row.receipts) { receipt.parity = structuredClone(graph); receipt.digest = sha(JSON.stringify(graph)); }
  }
  assert.throws(() => buildContentionReferences(collapsed, options), "Collapsed references contradict their independently retained raw history");
});

void test("uses real fence order for strata and preserves independently witnessed timestamp ties/reversals", () => {
  const input = auditSwapPairs(), refs = buildContentionReferences(input, options);
  assert.equal(refs.auditBlockSwapCertificate, true);
  for (const actual of CONTENTION_ORDERS) {
    const ordinary = freeObservation(input, actual);
    const checked = validateFreeContentionReceipt(ordinary.report, ordinary.receipt, refs);
    assert.equal(checked.actualOrder, actual); assert.equal(checked.historyOrder, actual);
    assert.equal(checked.certifiedDisagreement, false);
    assert.equal(checked.chronology.hasTimestampTies, true, "Same-transaction response ties remain raw evidence");
  }
  const tied = freeObservation(input, "acceptance-before-bulk", "bulk-before-acceptance", true);
  const tiedResult = validateFreeContentionReceipt(tied.report, tied.receipt, refs);
  assert.equal(tiedResult.actualOrder, "acceptance-before-bulk"); assert.equal(tiedResult.historyOrder, "bulk-before-acceptance");
  assert.equal(tiedResult.certifiedDisagreement, true); assert.equal(tiedResult.chronology.crossGroupTimestampTie, true);
  assert.equal(tiedResult.chronology.auditTimestampOrder, "tied"); assert.equal(tiedResult.chronology.auditTimestampContradictsFence, false);
  const reversed = freeObservation(input, "bulk-before-acceptance", "acceptance-before-bulk");
  const reversedResult = validateFreeContentionReceipt(reversed.report, reversed.receipt, refs);
  assert.equal(reversedResult.certifiedDisagreement, true); assert.equal(reversedResult.chronology.auditTimestampContradictsFence, true);
  assert.deepEqual(reversedResult.chronology.audits, reversed.receipt.contentionFenceEvidence.audits);
});

void test("persisted response audit timestamps may differ and are never equated with backend transaction starts", () => {
  const input = auditSwapPairs();
  for (const order of CONTENTION_ORDERS) {
    for (const arm of [input[order].baseline, input[order].candidate]) {
      for (const receipt of arm.receipts) {
        const evidence = receipt.contentionFenceEvidence;
        for (let index = 0; index < evidence.audits.length; index++) evidence.audits[index]!.createdAt = `2026-11-03T00:00:00.10${index}Z`;
        evidence.responseTimestampUniform = false; evidence.hasTimestampTies = false;
        const saved = arm.preparationEvidence.find((entry) => entry.stage === "contention-fence" && entry.round === receipt.round);
        assert.ok(saved?.stage === "contention-fence"); saved.evidence = structuredClone(evidence);
      }
    }
  }
  const refs = buildContentionReferences(input, options), current = freeObservation(input, "bulk-before-acceptance");
  for (let index = 0; index < current.receipt.contentionFenceEvidence.audits.length; index++) current.receipt.contentionFenceEvidence.audits[index]!.createdAt = `2026-11-03T00:00:00.20${index}Z`;
  current.receipt.contentionFenceEvidence.responseTimestampUniform = false;
  current.receipt.contentionFenceEvidence.hasTimestampTies = false;
  const checked = validateFreeContentionReceipt(current.report, current.receipt, refs);
  assert.equal(checked.chronology.responseTimestampUniform, false); assert.equal(checked.chronology.hasTimestampTies, false);
  assert.equal(checked.chronology.auditTimestampOrder, "bulk-before-acceptance");
  assert.equal("txStartOrder" in checked.chronology, false);
});

void test("pins independently captured Node image and complete comparison sidecars before free admission", () => {
  const input = auditSwapPairs(), refs = buildContentionReferences(input, options);
  assert.equal(refs.compatibility.nodeImage, nodeImage); assert.deepEqual(refs.compatibility.comparison, comparison());
  const changedImage = pairs(); changedImage[CONTENTION_ORDERS[0]].nodeImage = `sha256:${sha("another image")}`;
  assert.throws(() => buildContentionReferences(changedImage, options), /raw\/sidecar inputs/);
  const changedPin = pairs(); changedPin[CONTENTION_ORDERS[0]].comparison.baselineRevision = "c".repeat(40);
  assert.throws(() => buildContentionReferences(changedPin, options), /comparison baseline revision/);
  const changedSql = pairs(); changedSql[CONTENTION_ORDERS[0]].comparison.candidateMigrationHashes["prisma/migrations/20260101000000_initial/migration.sql"] = sha("changed SQL");
  assert.throws(() => buildContentionReferences(changedSql, options));
  const current = freeObservation(input, "bulk-before-acceptance"); current.report.contentionInputs.nodeImage = sha("free job image");
  assert.throws(() => validateFreeContentionReceipt(current.report, current.receipt, refs), /independently captured/);
});

void test("a clock discrepancy never excuses a changed journal/clock/dictionary or a non-intact block swap", () => {
  const ordinary = pairs(), refs = buildContentionReferences(ordinary, options);
  assert.equal(refs.auditBlockSwapCertificate, false, "These references also differ in journals/clocks/aliases");
  const observation = freeObservation(ordinary, "bulk-before-acceptance", "acceptance-before-bulk");
  assert.throws(() => validateFreeContentionReceipt(observation.report, observation.receipt, refs), /block swap certificate/);
  const own = freeObservation(ordinary, "bulk-before-acceptance");
  assert.doesNotThrow(() => validateFreeContentionReceipt(own.report, own.receipt, refs), "The true corresponding whole reference remains valid");
  const input = auditSwapPairs();
  for (const arm of [input[CONTENTION_ORDERS[1]].baseline, input[CONTENTION_ORDERS[1]].candidate]) {
    const changed = structuredClone(arm.receipts[0]!.parity); changed.tables.AuditLog[0]!.details.retained.ordinal = 99;
    for (const receipt of arm.receipts) { receipt.parity = structuredClone(changed); receipt.digest = sha(JSON.stringify(changed)); }
  }
  const changedRefs = buildContentionReferences(input, options);
  assert.equal(changedRefs.auditBlockSwapCertificate, false, "A changed response row cannot be certified as an intact block swap");
});

void test("rejects missing, duplicated, fabricated or contradictory raw free fence and chronology witnesses", () => {
  const input = auditSwapPairs(), refs = buildContentionReferences(input, options);
  const mutations = [
    (row: ReturnType<typeof freeObservation>) => { row.receipt.contentionFenceEvidence.operations[1]!.acquisitions[0]!.sequence = 1; },
    (row: ReturnType<typeof freeObservation>) => { row.receipt.contentionFenceEvidence.operations[0]!.failedAcquisitions = 1; },
    (row: ReturnType<typeof freeObservation>) => { row.receipt.contentionFenceEvidence.operations[0]!.acquisitions.push(row.receipt.contentionFenceEvidence.operations[0]!.acquisitions[0]!); },
    (row: ReturnType<typeof freeObservation>) => { row.receipt.contentionFenceEvidence.audits[1]!.auditId = row.receipt.contentionFenceEvidence.audits[0]!.auditId; },
    (row: ReturnType<typeof freeObservation>) => { row.receipt.contentionFenceEvidence.audits.reverse(); },
    (row: ReturnType<typeof freeObservation>) => { row.receipt.contentionFenceEvidence.auditTimestampContradictsFence = true; },
    (row: ReturnType<typeof freeObservation>) => { row.receipt.contentionOrder = "acceptance-before-bulk"; },
    (row: ReturnType<typeof freeObservation>) => { row.report.preparationEvidence = []; },
    (row: ReturnType<typeof freeObservation>) => { row.report.preparationEvidence.push(row.report.preparationEvidence[0]!); },
    (row: ReturnType<typeof freeObservation>) => { row.receipt.contentionFenceEvidence.audits[1]!.operation = "unrelated"; },
  ];
  for (const mutate of mutations) {
    const observation = freeObservation(input, "bulk-before-acceptance"); mutate(observation);
    assert.throws(() => validateFreeContentionReceipt(observation.report, observation.receipt, refs));
  }
});

void test("loads only explicit pair paths, rejecting reuse, corruption and missing files", () => {
  const root = mkdtempSync(join(tmpdir(), "contention-references-"));
  try {
    const input = pairs();
    const paths = Object.fromEntries(CONTENTION_ORDERS.map((order) => {
      const directory = join(root, CONTENTION_SCENARIOS[order]); mkdirSync(directory);
      const baselinePath = join(directory, "base-diagnostic.json"), candidatePath = join(directory, "head-diagnostic.json"), nodeImagePath = join(directory, "node-image.txt"), comparisonPath = join(directory, "comparison-inputs.json");
      writeFileSync(baselinePath, JSON.stringify(input[order].baseline)); writeFileSync(candidatePath, JSON.stringify(input[order].candidate));
      writeFileSync(nodeImagePath, input[order].nodeImage); writeFileSync(comparisonPath, JSON.stringify(input[order].comparison));
      return [order, { baselinePath, candidatePath, nodeImagePath, comparisonPath, reference: directory }];
    })) as Record<Order, { baselinePath: string; candidatePath: string; nodeImagePath: string; comparisonPath: string; reference: string }>;
    assert.equal(loadContentionReferences(paths, options).controlledEvidence.length, 2);
    const reused = structuredClone(paths); reused[CONTENTION_ORDERS[1]].baselinePath = reused[CONTENTION_ORDERS[0]].baselinePath;
    assert.throws(() => loadContentionReferences(reused, options), /path reused/);
    writeFileSync(paths[CONTENTION_ORDERS[0]].candidatePath, "{broken JSON");
    assert.throws(() => loadContentionReferences(paths, options));
    paths[CONTENTION_ORDERS[0]].candidatePath = join(root, "missing.json");
    assert.throws(() => loadContentionReferences(paths, options));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
