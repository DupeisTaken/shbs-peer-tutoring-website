import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { profileMatrix } from "./aggregate-partitions.mjs";
import { createClockAdmission } from "./clock-admission.mjs";
import {
  artifactInventoryHash,
  authorizeArtifactRetry,
  selectResumeArtifacts,
  slotKey,
} from "./resume-artifacts.mjs";

type Input = Parameters<typeof selectResumeArtifacts>[0];
type Campaign = Input["campaign"];
type Artifact = Input["artifacts"][number];
type Execution = Input["executions"][number];
type Slot = Input["requiredSlots"][number];
const matrix = profileMatrix().include;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const data = (value: unknown) => value as Record<string, unknown>;
const anchor = "2026-11-02T23:00:00.000Z";
const slot = matrix.find((entry) => entry.scenario === "negotiation" && entry.mode === "latency")!;
const references = matrix.filter((entry) => entry.scenario.startsWith("contention-") && entry.mode === "diagnostic");
function campaign(currentAttempt = 2): Campaign {
  return {
    repository: "example/synthetic", runId: "12345", workflowSha: "1".repeat(40),
    campaignAttempt: 1, currentAttempt, candidateRevision: "b".repeat(40), anchor,
    nodeImage: `node:22-alpine@sha256:${sha("node registry manifest")}`,
    nodeImageId: `sha256:${sha("distinct docker config digest")}`,
    postgresImage: `postgres:16-alpine@sha256:${sha("postgres manifest")}`,
    candidateSchemaSha256: sha("schema"), dependencyLockSha256: sha("lock"),
    reportSchemaVersion: 3, partitionProtocolVersion: 1,
    scenarios: Object.fromEntries([...new Set(matrix.map((entry) => entry.scenario))].map((scenario) => [scenario, {
      baselineRevision: (scenario === "catalog" ? "c" : "a").repeat(40),
      comparisonSha256: sha(`frozen comparison ${scenario}`), requiresNativeSchemaControl: false,
    }])),
  };
}
function telemetry(lastPhase: string, exitCode = 0) {
  const phases = lastPhase === "bootstrap-packages" ? [lastPhase] : ["bootstrap-packages", lastPhase];
  const events = phases.flatMap((phase, index) => {
    const startedAtEpochSeconds = 1000 + index * 10;
    const common = { phase, attempt: 1, startedAtEpochSeconds, budgetSeconds: 30 };
    return [
      { ...common, event: "start", finishedAtEpochSeconds: startedAtEpochSeconds, elapsedSeconds: 0, exitCode: null },
      { ...common, event: "finish", finishedAtEpochSeconds: startedAtEpochSeconds + 1, elapsedSeconds: 1, exitCode: index === phases.length - 1 ? exitCode : 0 },
    ];
  });
  const firstFailedBootstrapAttempt = lastPhase === "bootstrap-packages" && exitCode !== 0
    ? { phase: lastPhase, attempt: 1, exitCode, elapsedSeconds: 1, budgetSeconds: 30 } : null;
  return {
    status: { schemaVersion: 1, status: exitCode === 0 ? "PASS" : "FAIL", exitCode, lastPhase, firstFailedBootstrapAttempt },
    events,
    ...(exitCode !== 0 ? { exit: { status: "FAIL", exitCode, lastPhase, firstFailedBootstrapAttempt } } : {}),
  };
}
type Outcome = "success" | "base-bootstrap" | "head-dependency" | "measured";
function packaged(c: Campaign, selected: Slot, attempt: number, outcome: Outcome = "success") {
  const index = matrix.findIndex((entry) => slotKey(entry) === slotKey(selected));
  const jobId = `${attempt}${1000 + index}`, artifactId = `9${jobId}`;
  const files: Record<string, string> = {
    "comparison-inputs.json": c.scenarios[selected.scenario]!.comparisonSha256,
    "anchor.txt": sha(`${c.anchor}\n`), "node-image.txt": sha(`${c.nodeImageId}\n`),
  };
  const phaseFiles: Artifact["phaseFiles"] = {
    base: telemetry(outcome === "base-bootstrap" ? "bootstrap-packages" : "shared-measurement", outcome === "base-bootstrap" ? 1 : 0),
    ...(outcome !== "base-bootstrap" ? { head: telemetry(outcome === "head-dependency" ? "dependency-install" : "shared-measurement", outcome === "success" ? 0 : 1) } : {}),
  };
  for (const [arm, phase] of Object.entries(phaseFiles)) {
    files[`${arm}-phase-status.json`] = sha(JSON.stringify(phase.status));
    files[`${arm}-phase-events.jsonl`] = sha(JSON.stringify(phase.events));
    if (phase.exit) files[`${arm}-command-exit.json`] = sha(JSON.stringify(phase.exit));
  }
  const reports: NonNullable<Artifact["reports"]> = {};
  for (const arm of ["base", "head", "native"] as const) {
    if (outcome === "base-bootstrap" || arm === "head" && outcome === "head-dependency") continue;
    if (arm === "native" && !(selected.scenario === "cold" && selected.mode === "latency" && c.scenarios.cold!.requiresNativeSchemaControl)) continue;
    const filename = arm === "native" ? "base-native-latency.json" : `${arm}-${selected.mode}.json`;
    files[filename] = sha(`verified original ${jobId}/${filename}`);
    const latency = selected.mode === "latency";
    reports[arm] = {
      fileSha256: files[filename], status: arm === "head" && outcome === "measured" ? "FAIL" : "PASS",
      schemaVersion: 3, partitionProtocolVersion: 1, revision: arm === "head" ? c.candidateRevision : c.scenarios[selected.scenario]!.baselineRevision,
      mode: selected.mode, transport: "http", captureSchema: arm === "native" ? "native-original" : "shared",
      partition: latency ? { index: selected.partition, count: selected.partitionCount, start: selected.partition * 4, end: selected.partition * 4 + 4, totalSamples: selected.samples, warmupRounds: 1 } : null,
      samplingComplete: !latency, partitionComplete: latency, latencyComparisonEligible: false,
      fixture: { anchor, scenarios: [selected.scenario], samples: selected.samples, clockAdmission: createClockAdmission(anchor, anchor) },
      databaseClock: { startedAt: "2026-11-02T23:01:00.000Z", finishedAt: "2026-11-02T23:01:01.000Z" },
      startedAt: "2026-11-02T23:01:00.000Z", finishedAt: "2026-11-02T23:01:01.000Z", elapsedMs: 1000, timeoutMs: arm === "native" ? 90_000 : 150_000,
      profileRunner: { id: `${c.runId}-${attempt}-${selected.scenario}-${selected.mode}-${selected.partition}` },
      receiptCount: latency ? 4 : selected.samples, hasFailure: false, cleanupErrorCount: 0,
      unfinishedSampleCount: 0, censoredSampleCount: 0, incompletePhaseCount: 0,
    };
  }
  const identity = {
    ...c, version: 1, attempt, slot: selected,
    baselineRevision: c.scenarios[selected.scenario]!.baselineRevision,
    comparisonSha256: c.scenarios[selected.scenario]!.comparisonSha256, files, reports,
  };
  const artifact: Artifact = {
    repository: c.repository, runId: c.runId, attempt, artifactId,
    name: `scheduling-profile-${selected.scenario}-${selected.mode}-part-${selected.partition}-${attempt}`,
    archiveSha256: sha(`original immutable archive ${artifactId}`), archiveSize: 1234,
    identitySha256: sha(JSON.stringify(identity)), inventorySha256: artifactInventoryHash(files),
    identity, files, phaseFiles, reports,
  };
  const execution: Execution = { repository: c.repository, runId: c.runId, workflowSha: c.workflowSha,
    attempt, jobId, slot: selected, conclusion: outcome === "success" ? "success" : "failure", artifactId };
  return { artifact, execution };
}
function input(c: Campaign, packages: ReturnType<typeof packaged>[], requiredSlots = [slot]): Input {
  return { campaign: c, artifacts: packages.map((entry) => entry.artifact), executions: packages.map((entry) => entry.execution), requiredSlots };
}
function reseal(artifact: Artifact) {
  data(artifact.identity).files = artifact.files;
  data(artifact.identity).reports = artifact.reports;
  artifact.inventorySha256 = artifactInventoryHash(artifact.files);
  artifact.identitySha256 = sha(JSON.stringify(artifact.identity));
}
function skipped(c: Campaign, selected: Slot, attempt = 1, stage?: string): Execution {
  const jobId = stage ? "80000" : "80001";
  return { repository: c.repository, runId: c.runId, workflowSha: c.workflowSha,
    attempt, jobId, slot: selected, conclusion: "skipped", artifactId: null,
    nonStart: { kind: "PROVIDER_SKIPPED_JOB", jobId, status: "completed", conclusion: "skipped", stepCount: 0, ...(stage ? { stage } : {}) } };
}

void test("selects immutable complete pairs after explicit head dependency failure, remeasuring both arms", () => {
  const c = campaign(), old = packaged(c, slot, 1, "head-dependency"), next = packaged(c, slot, 2);
  const source = input(c, [old, next]), unchanged = structuredClone(source);
  const selected = selectResumeArtifacts(source);
  assert.equal(selected.state, "SELECTED_FOR_CANONICAL_VALIDATION");
  assert.equal(selected.requiresCanonicalValidation, true);
  assert.equal(selected.selected[0]!.artifactId, next.artifact.artifactId);
  assert.deepEqual(selected.selected[0]!.history.map((row) => row.outcome), ["retryable", "success"]);
  assert.deepEqual(source, unchanged, "Planning must never rewrite/delete prior raw evidence");
  const authorization = authorizeArtifactRetry({ ...input(c, [old]), slot });
  assert.equal(authorization.remeasureBaseline, true); assert.equal(authorization.remeasureCandidate, true);
  assert.equal(authorization.preserveOriginalArtifacts, true);
});

void test("supports reference-only selection and the complete 70-slot declared population", () => {
  const c = campaign();
  assert.equal(matrix.length, 70);
  assert.equal(selectResumeArtifacts(input(c, references.map((entry) => packaged(c, entry, 1)), references)).selected.length, 2);
  const all = input(c, matrix.map((entry) => packaged(c, entry, 1)), matrix);
  assert.equal(selectResumeArtifacts(all).selected.length, 70);
  assert.throws(() => selectResumeArtifacts({ ...all, artifacts: all.artifacts.slice(1) }), /MISSING_EXECUTED_ARTIFACT/);
});

void test("current in-progress authorization permits no terminal outcome and no older successful measurement", () => {
  const c = campaign(), old = packaged(c, slot, 1, "base-bootstrap");
  const source = input(c, [old]);
  source.executions.push({ ...old.execution, attempt: 2, jobId: "77777", conclusion: "in_progress", artifactId: null });
  assert.equal(authorizeArtifactRetry({ ...source, slot }).state, "AUTHORIZED_REMEASURE_PAIRED_ARMS");
  source.executions.at(-1)!.conclusion = "timed_out";
  assert.throws(() => authorizeArtifactRetry({ ...source, slot }), /CURRENT_ATTEMPT_ALREADY_TERMINAL/);
  const measured = input(c, [packaged(c, slot, 1)]);
  assert.throws(() => authorizeArtifactRetry({ ...measured, slot }), /IDENTITY_MISMATCH/);
});

for (const outcome of ["head-dependency", "measured"] as const) void test(`never falls back from a newer ${outcome} outcome`, () => {
  const c = campaign(), source = input(c, [packaged(c, slot, 1), packaged(c, slot, 2, outcome)]);
  assert.throws(() => selectResumeArtifacts(source), /RESUME_/);
});
void test("duplicate measured successes and missing newer uploads cannot be cherry-picked", () => {
  const c = campaign();
  assert.throws(() => selectResumeArtifacts(input(c, [packaged(c, slot, 1), packaged(c, slot, 2)])), /IDENTITY_MISMATCH/);
  const source = input(c, [packaged(c, slot, 1, "head-dependency")]);
  source.executions.push({ ...source.executions[0]!, attempt: 2, jobId: "77777", artifactId: null });
  assert.throws(() => selectResumeArtifacts(source), /MISSING_EXECUTED_ARTIFACT/);
});

void test("authenticated zero-step skipped stage proof permits first execution in a later attempt", () => {
  const c = campaign(), source = input(c, [packaged(c, slot, 2)]);
  source.executions.unshift(skipped(c, slot, 1, "profile"));
  assert.deepEqual(selectResumeArtifacts(source).selected[0]!.history.map((row) => row.outcome), ["not_started", "success"]);
  assert.equal(authorizeArtifactRetry({ ...source, executions: source.executions.slice(0, 1), artifacts: [], slot }).state, "AUTHORIZED_REMEASURE_PAIRED_ARMS");
  const refs = input(c, references.map((entry) => packaged(c, entry, 2)), references);
  refs.executions.unshift(...references.map((entry) => skipped(c, entry, 1, "preflight")));
  assert.equal(selectResumeArtifacts(refs).selected.length, 2);
  refs.executions.splice(0, 1);
  assert.throws(() => selectResumeArtifacts(refs), /INCOMPLETE_SKIPPED_STAGE/);
});

for (const change of [
  (row: Execution) => { delete row.nonStart; },
  (row: Execution) => { row.nonStart!.stepCount = 1; },
  (row: Execution) => { row.nonStart!.stage = "preflight"; },
  (row: Execution) => { row.conclusion = "cancelled"; },
]) void test("missing/contradictory provider non-start evidence remains blocking", () => {
  const c = campaign(), source = input(c, [packaged(c, slot, 2)]), prior = skipped(c, slot, 1, "profile");
  change(prior); source.executions.unshift(prior);
  assert.throws(() => selectResumeArtifacts(source), /RESUME_/);
});

for (const field of ["workflowSha", "candidateRevision", "nodeImage", "nodeImageId", "postgresImage", "candidateSchemaSha256", "dependencyLockSha256", "baselineRevision", "comparisonSha256", "anchor", "partitionProtocolVersion"])
  void test(`rejects substituted ${field} provenance`, () => {
    const c = campaign(), pair = packaged(c, slot, 1), source = input(c, [pair]);
    data(pair.artifact.identity)[field] = "substituted";
    assert.throws(() => selectResumeArtifacts(source), /IDENTITY_MISMATCH/);
  });

void test("node-image file binds Docker config ID, never the registry-manifest digest", () => {
  const c = campaign(), pair = packaged(c, slot, 1);
  pair.artifact.files["node-image.txt"] = sha(`${c.nodeImage}\n`); reseal(pair.artifact);
  assert.throws(() => selectResumeArtifacts(input(c, [pair])), /IDENTITY_MISMATCH/);
});

for (const field of ["status", "hasFailure", "censoredSampleCount", "unfinishedSampleCount", "incompletePhaseCount", "receiptCount", "partitionComplete"])
  void test(`rejects incomplete candidate compact ${field}`, () => {
    const c = campaign(), pair = packaged(c, slot, 1);
    data(pair.artifact.reports!.head)[field] = field === "status" ? "FAIL" : field === "hasFailure" ? true : 0;
    if (field.endsWith("Count") && field !== "receiptCount") data(pair.artifact.reports!.head)[field] = 1;
    reseal(pair.artifact);
    assert.throws(() => selectResumeArtifacts(input(c, [pair])), /RESUME_/);
  });

void test("candidate output, censoring or missing telemetry prevents bootstrap replacement", () => {
  for (const kind of ["candidate-output", "budget", "incomplete-events", "legacy-missing-phase"] as const) {
    const c = campaign(), pair = packaged(c, slot, 1, "head-dependency");
    if (kind === "candidate-output") pair.artifact.files["head-latency.json"] = sha("measured candidate");
    if (kind === "budget") pair.artifact.files["head-budget.json"] = sha("censored command");
    if (kind === "incomplete-events") pair.artifact.phaseFiles.head!.events!.pop();
    if (kind === "legacy-missing-phase") delete pair.artifact.phaseFiles.head!.status;
    reseal(pair.artifact);
    assert.throws(() => authorizeArtifactRetry({ ...input(c, [pair]), slot }), /RESUME_/);
  }
});

for (const exitCode of [124, 137, 143]) void test(`setup exit ${exitCode} cannot authorize replacement`, () => {
  const c = campaign(), pair = packaged(c, slot, 1, "head-dependency");
  const phase = pair.artifact.phaseFiles.head!;
  data(phase.status).exitCode = exitCode;
  data(phase.exit).exitCode = exitCode;
  data(phase.events!.at(-1)).exitCode = exitCode;
  reseal(pair.artifact);
  assert.throws(() => authorizeArtifactRetry({ ...input(c, [pair]), slot }), /TIMEOUT_OR_SIGNAL_NOT_REPLACEABLE/);
});

void test("old baseline cannot be spliced into a fresh candidate pair and required native controls cannot disappear", () => {
  const c = campaign(), old = packaged(c, slot, 1), next = packaged(c, slot, 2);
  next.artifact.reports!.base = old.artifact.reports!.base;
  next.artifact.files["base-latency.json"] = old.artifact.files["base-latency.json"]!; reseal(next.artifact);
  assert.throws(() => selectResumeArtifacts(input(c, [next])), /IDENTITY_MISMATCH/);
  c.scenarios.cold!.requiresNativeSchemaControl = true;
  const cold = matrix.find((entry) => entry.scenario === "cold" && entry.mode === "latency")!;
  const native = packaged(c, cold, 1);
  assert.equal(selectResumeArtifacts(input(c, [native], [cold])).selected.length, 1);
  delete native.artifact.reports!.native; delete native.artifact.files["base-native-latency.json"]; reseal(native.artifact);
  assert.throws(() => selectResumeArtifacts(input(c, [native], [cold])), /RESUME_/);
});

void test("file paths, duplicate slots and missing proof are rejected without raw payload access", () => {
  assert.throws(() => artifactInventoryHash({ "../head-latency.json": sha("private payload") }), /UNSAFE_FILE_NAME/);
  assert.throws(() => artifactInventoryHash({ "nested/head-latency.json": sha("private payload") }), /UNSAFE_FILE_NAME/);
  const c = campaign(), pair = packaged(c, slot, 1), source = input(c, [pair]);
  assert.throws(() => selectResumeArtifacts({ ...source, requiredSlots: [slot, slot] }), /DUPLICATE_REQUIRED_SLOT/);
  assert.throws(() => selectResumeArtifacts({ ...source, executions: [...source.executions, source.executions[0]!] }), /DUPLICATE_EXECUTION/);
  source.artifacts[0]!.inventorySha256 = sha("unverified inventory");
  assert.throws(() => selectResumeArtifacts(source), /IDENTITY_MISMATCH/);
});
