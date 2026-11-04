import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { profileMatrix } from "./aggregate-partitions.mjs";
import { validateReportClocks } from "./clock-admission.mjs";

/** Pure selection of original artifact packages, never file I/O or measurement.
 * The caller authenticates an exhaustive GitHub executions/artifacts inventory,
 * streams archive/file hashes, and binds parsed compact metadata to those bytes.
 * Compact reports are NOT semantic certification: selected original directories
 * must still pass the unchanged canonical aggregate/reference validators.
 *
 * @typedef {{scenario:string,mode:string,partition:number,partitionCount:number,samples:number}} Slot
 * @typedef {{repository:string,runId:string,workflowSha:string,campaignAttempt:number,currentAttempt:number,candidateRevision:string,anchor:string,nodeImage:string,nodeImageId:string,postgresImage:string,candidateSchemaSha256:string,dependencyLockSha256:string,reportSchemaVersion:number,partitionProtocolVersion:number,scenarios:Record<string,{baselineRevision:string,comparisonSha256:string,requiresNativeSchemaControl:boolean}>}} Campaign
 * @typedef {{repository:string,runId:string,workflowSha:string,attempt:number,jobId:string,slot:Slot,conclusion:string,artifactId:string|null,nonStart?:{kind:string,jobId:string,status:string,conclusion:string,stepCount:number,stage?:string}}} Execution
 * @typedef {{status?:unknown,exit?:unknown,budget?:unknown,events?:unknown[]}} PhaseFiles
 * @typedef {{repository:string,runId:string,attempt:number,artifactId:string,name:string,archiveSha256:string,archiveSize:number,identitySha256:string,inventorySha256:string,identity:unknown,files:Record<string,string>,phaseFiles:Partial<Record<'base'|'head',PhaseFiles>>,reports?:Partial<Record<'base'|'head'|'native',unknown>>}} Artifact
 * @typedef {{campaign:Campaign,executions:Execution[],artifacts:Artifact[]}} Inventory
 * @typedef {Record<string,any>} Evidence
 *
 * identity JSON (`resume-identity.json`, excluded from files) has version:1,
 * repository/runId/workflowSha/campaignAttempt/attempt/slot/candidateRevision,
 * baselineRevision/anchor/nodeImage/nodeImageId/postgresImage/candidateSchemaSha256,
 * dependencyLockSha256/reportSchemaVersion/partitionProtocolVersion,
 * comparisonSha256, files (the exact same verified hash map), and reports.
 *
 * reports.base/head/native are compact values bound by the I/O layer to their
 * corresponding fileSha256 and verified original report bytes. Required fields:
 * fileSha256,status,schemaVersion,partitionProtocolVersion,revision,mode,
 * transport,captureSchema,partition,samplingComplete,partitionComplete,
 * latencyComparisonEligible,fixture:{anchor,clockAdmission,scenarios,samples},
 * databaseClock:{startedAt,finishedAt},startedAt,finishedAt,elapsedMs,timeoutMs,
 * profileRunner:{id},receiptCount,hasFailure,cleanupErrorCount,
 * unfinishedSampleCount,censoredSampleCount,incompletePhaseCount.
 * Counts are computed from original samples/phases, not summary claims.
 *
 * phaseFiles.base/head bind status/exit/budget to the corresponding original
 * *-phase-status.json/*-command-exit.json/*-budget.json; events is the complete
 * parsed *-phase-events.jsonl (current wrapper schema, no synthesized rows).
 */
const slots = profileMatrix().include;
const allowed = new Map(slots.map((slot) => [slotKey(slot), slot]));
const hash = (/** @type {string} */ value) => createHash("sha256").update(value).digest("hex");
/** @param {unknown} condition @param {string} code @returns {asserts condition} */
function require(condition, code) { if (!condition) throw new Error(`RESUME_${code}`); }
/** @param {unknown} value @returns {Evidence} */
function object(value) {
  require(value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), "INVALID_RECORD");
  return /** @type {Evidence} */ (value);
}
/** @param {unknown} value @param {number} length */
function digest(value, length = 64) { require(typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value), "INVALID_HASH"); }
/** @param {unknown} value */
function id(value) { require(typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value), "INVALID_ID"); }
/** @param {unknown} value */
function positive(value) { require(Number.isSafeInteger(value) && Number(value) > 0, "INVALID_NUMBER"); }
/** @param {unknown} actual @param {unknown} expected */
function same(actual, expected) { require(isDeepStrictEqual(actual, expected), "IDENTITY_MISMATCH"); }
/** Canonical matrix key; population/count cannot be supplied independently.
 * @param {Slot} slot */
export function slotKey(slot) { return `${slot.scenario}/${slot.mode}/${slot.partition}`; }
/** @param {Slot} slot */
function checkedSlot(slot) { object(slot); same(slot, allowed.get(slotKey(slot))); return slotKey(slot); }
/** Deterministic inventory digest shared with the streaming I/O caller.
 * @param {Record<string,string>} files */
export function artifactInventoryHash(files) {
  object(files);
  const entries = Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  require(entries.length > 0 && entries.length <= 128, "INVALID_FILE_INVENTORY");
  for (const [name, value] of entries) {
    require(name.length <= 240 && !/[\\/:\u0000-\u001f]/.test(name) &&
      name.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
      !name.endsWith("resume-identity.json"), "UNSAFE_FILE_NAME");
    digest(value);
  }
  return hash(JSON.stringify(Object.fromEntries(entries)));
}
/** @param {Campaign} campaign */
function validateCampaign(campaign) {
  object(campaign);
  require(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(campaign.repository), "INVALID_REPOSITORY");
  id(campaign.runId); digest(campaign.workflowSha, 40); digest(campaign.candidateRevision, 40);
  digest(campaign.candidateSchemaSha256); digest(campaign.dependencyLockSha256);
  positive(campaign.campaignAttempt); positive(campaign.currentAttempt);
  require(campaign.campaignAttempt <= campaign.currentAttempt && campaign.currentAttempt <= 1000, "INVALID_ATTEMPT_RANGE");
  require(typeof campaign.anchor === "string" && Number.isFinite(Date.parse(campaign.anchor)) && new Date(campaign.anchor).toISOString() === campaign.anchor, "INVALID_ANCHOR");
  for (const image of [campaign.nodeImage, campaign.postgresImage])
    require(typeof image === "string" && /^(?:[A-Za-z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/.test(image), "UNPINNED_IMAGE");
  require(/^sha256:[a-f0-9]{64}$/.test(campaign.nodeImageId), "INVALID_IMAGE_ID");
  same(campaign.reportSchemaVersion, 3); same(campaign.partitionProtocolVersion, 1);
  object(campaign.scenarios);
  for (const scenario of new Set(slots.map((slot) => slot.scenario))) {
    const spec = object(campaign.scenarios[scenario]);
    digest(spec.baselineRevision, 40); digest(spec.comparisonSha256);
    require(typeof spec.requiresNativeSchemaControl === "boolean", "MISSING_NATIVE_CONTRACT");
  }
}
/** @param {Artifact} artifact @param {Execution} execution @param {Campaign} campaign */
function validateArtifact(artifact, execution, campaign) {
  object(artifact);
  same(artifact.repository, campaign.repository); same(artifact.runId, campaign.runId);
  same(artifact.attempt, execution.attempt); same(artifact.artifactId, execution.artifactId);
  same(artifact.name, `scheduling-profile-${execution.slot.scenario}-${execution.slot.mode}-part-${execution.slot.partition}-${execution.attempt}`);
  digest(artifact.archiveSha256); digest(artifact.identitySha256); positive(artifact.archiveSize);
  require(artifact.archiveSize <= 1024 ** 3, "ARCHIVE_TOO_LARGE");
  same(artifact.inventorySha256, artifactInventoryHash(artifact.files));
  const identity = object(artifact.identity);
  same(identity.version, 1); same(identity.files, artifact.files);
  same(identity.reports ?? {}, artifact.reports ?? {});
  for (const field of ["repository", "runId", "workflowSha", "campaignAttempt", "candidateRevision", "anchor", "nodeImage", "nodeImageId", "postgresImage", "candidateSchemaSha256", "dependencyLockSha256", "reportSchemaVersion", "partitionProtocolVersion"])
    same(identity[field], campaign[/** @type {keyof Campaign} */ (field)]);
  same(identity.attempt, execution.attempt); same(identity.slot, execution.slot);
  const spec = campaign.scenarios[execution.slot.scenario];
  require(spec, "MISSING_SCENARIO");
  same(identity.baselineRevision, spec.baselineRevision); same(identity.comparisonSha256, spec.comparisonSha256);
  same(artifact.files["comparison-inputs.json"], spec.comparisonSha256);
  same(artifact.files["anchor.txt"], hash(`${campaign.anchor}\n`));
  same(artifact.files["node-image.txt"], hash(`${campaign.nodeImageId}\n`));
  object(artifact.phaseFiles);
  require(Object.keys(artifact.phaseFiles).every((arm) => ["base", "head"].includes(arm)), "UNKNOWN_ARM");
  if (artifact.reports) {
    object(artifact.reports);
    require(Object.keys(artifact.reports).every((arm) => ["base", "head", "native"].includes(arm)), "UNKNOWN_REPORT");
  }
}
/** @param {Artifact} artifact @param {'base'|'head'} arm */
function phase(artifact, arm) {
  const files = object(artifact.phaseFiles[arm]);
  const status = object(files.status);
  require(artifact.files[`${arm}-phase-status.json`] && artifact.files[`${arm}-phase-events.jsonl`], "MISSING_PHASE_FILES");
  same(status.schemaVersion, 1);
  require(["PASS", "FAIL"].includes(status.status) && Number.isInteger(status.exitCode), "INCOMPLETE_PHASE_STATUS");
  require(Array.isArray(files.events) && files.events.length > 0 && files.events.length <= 128 && files.events.length % 2 === 0, "INCOMPLETE_PHASE_EVENTS");
  /** @type {Evidence[]} */ const finishes = [];
  for (let index = 0; index < files.events.length; index += 2) {
    const start = object(files.events[index]), finish = object(files.events[index + 1]);
    require(start.event === "start" && finish.event === "finish" && start.exitCode === null && Number.isInteger(finish.exitCode), "INCOMPLETE_PHASE_EVENTS");
    for (const field of ["phase", "attempt", "startedAtEpochSeconds", "budgetSeconds"]) same(start[field], finish[field]);
    require(typeof start.phase === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(start.phase), "INVALID_PHASE");
    positive(start.attempt); positive(start.budgetSeconds); positive(start.startedAtEpochSeconds);
    require(Number.isSafeInteger(finish.finishedAtEpochSeconds) && finish.finishedAtEpochSeconds >= start.startedAtEpochSeconds &&
      finish.elapsedSeconds === finish.finishedAtEpochSeconds - start.startedAtEpochSeconds && start.elapsedSeconds === 0 &&
      start.finishedAtEpochSeconds === start.startedAtEpochSeconds &&
      (index === 0 || start.startedAtEpochSeconds >= finishes.at(-1)?.finishedAtEpochSeconds), "INVALID_PHASE_CLOCK");
    finishes.push(finish);
  }
  const last = finishes.at(-1);
  require(last, "MISSING_TERMINAL_PHASE");
  same(status.lastPhase, last.phase); same(status.exitCode, last.exitCode);
  const firstFailure = finishes.find((event) => event.phase === "bootstrap-packages" && event.exitCode !== 0);
  same(status.firstFailedBootstrapAttempt, firstFailure ? {
    phase: firstFailure.phase, attempt: firstFailure.attempt, exitCode: firstFailure.exitCode,
    elapsedSeconds: firstFailure.elapsedSeconds, budgetSeconds: firstFailure.budgetSeconds,
  } : null);
  if (files.budget || artifact.files[`${arm}-budget.json`]) require(false, "BUDGET_OUTCOME_NOT_REPLACEABLE");
  return { status, files, finishes, last };
}
/** @param {Artifact} artifact @param {Execution} execution @param {Campaign} campaign @param {'base'|'head'|'native'} arm */
function report(artifact, execution, campaign, arm) {
  const value = object(artifact.reports?.[arm]);
  const native = arm === "native", slot = execution.slot;
  const file = native ? "base-native-latency.json" : `${arm}-${slot.mode}.json`;
  same(value.fileSha256, artifact.files[file]); digest(value.fileSha256);
  same(value.status, "PASS"); same(value.schemaVersion, 3); same(value.partitionProtocolVersion, 1);
  same(value.revision, arm === "head" ? campaign.candidateRevision : campaign.scenarios[slot.scenario]?.baselineRevision);
  same(value.mode, native ? "latency" : slot.mode); same(value.transport, "http");
  same(value.captureSchema, native ? "native-original" : "shared");
  const fixture = object(value.fixture), runner = object(value.profileRunner);
  same(fixture.scenarios, [slot.scenario]); same(fixture.samples, slot.samples); same(fixture.anchor, campaign.anchor);
  same(runner.id, `${campaign.runId}-${execution.attempt}-${slot.scenario}-${slot.mode}-${slot.partition}`);
  const latency = slot.mode === "latency";
  same(value.partition, latency ? { index: slot.partition, count: slot.partitionCount, start: slot.partition * 4, end: slot.partition * 4 + 4, totalSamples: slot.samples, warmupRounds: 1 } : null);
  same(value.partitionComplete, latency); same(value.samplingComplete, !latency); same(value.latencyComparisonEligible, false);
  same(value.receiptCount, latency ? 4 : slot.samples); same(value.hasFailure, false);
  for (const field of ["cleanupErrorCount", "unfinishedSampleCount", "censoredSampleCount", "incompletePhaseCount"]) same(value[field], 0);
  require(Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0 && Number.isInteger(value.timeoutMs) &&
    value.timeoutMs >= 30_000 && value.timeoutMs <= (native ? 90_000 : 150_000) && value.elapsedMs <= value.timeoutMs, "INCOMPLETE_REPORT");
  validateReportClocks(value);
}
/** A success and a retryable failure both require complete terminal telemetry.
 * @param {Artifact} artifact @param {Execution} execution @param {Campaign} campaign */
function classify(artifact, execution, campaign) {
  require(!Object.keys(artifact.files).some((name) => /\.parity-failure\.json$/.test(name)), "MEASURED_FAILURE_NOT_REPLACEABLE");
  const base = phase(artifact, "base");
  /** @param {'base'|'head'} arm @param {ReturnType<typeof phase>} evidence */
  const success = (arm, evidence) => {
    same(evidence.status.status, "PASS"); same(evidence.status.exitCode, 0); same(evidence.last.phase, "shared-measurement");
    require(!evidence.files.exit && !artifact.files[`${arm}-command-exit.json`], "RETAINED_FAILURE");
    require(evidence.finishes.every((event) => event.exitCode === 0 || event.phase === "bootstrap-packages" && event.attempt === 1), "RETAINED_FAILURE");
    report(artifact, execution, campaign, arm);
  };
  const nativeRequired = execution.slot.scenario === "cold" && execution.slot.mode === "latency" && campaign.scenarios.cold?.requiresNativeSchemaControl;
  if (!nativeRequired) require(!artifact.files["base-native-latency.json"] && !artifact.reports?.native, "UNEXPECTED_NATIVE_REPORT");
  if (execution.conclusion === "success") {
    success("base", base); success("head", phase(artifact, "head"));
    if (nativeRequired) report(artifact, execution, campaign, "native");
    else require(!artifact.files["base-native-latency.json"] && !artifact.reports?.native, "UNEXPECTED_NATIVE_REPORT");
    return "success";
  }
  same(execution.conclusion, "failure");
  const failedArm = base.status.status === "FAIL" ? "base" : "head";
  if (failedArm === "head") { success("base", base); if (nativeRequired) report(artifact, execution, campaign, "native"); }
  else require(!artifact.phaseFiles.head && !Object.keys(artifact.files).some((name) => /^head[.-]/.test(name)) && !artifact.reports?.head, "AMBIGUOUS_FAILURE");
  const failed = failedArm === "base" ? base : phase(artifact, "head");
  same(failed.status.status, "FAIL"); require(failed.status.exitCode !== 0, "AMBIGUOUS_FAILURE");
  require(!failed.finishes.some((event) => [124, 137, 143].includes(event.exitCode)), "TIMEOUT_OR_SIGNAL_NOT_REPLACEABLE");
  const exit = object(failed.files.exit);
  require(artifact.files[`${failedArm}-command-exit.json`], "MISSING_EXIT_RECEIPT");
  same(exit.status, "FAIL"); same(exit.exitCode, failed.status.exitCode); same(exit.lastPhase, failed.status.lastPhase);
  same(exit.firstFailedBootstrapAttempt, failed.status.firstFailedBootstrapAttempt);
  require(["bootstrap-packages", "dependency-install"].includes(failed.last.phase) &&
    failed.finishes.every((event) => ["bootstrap-packages", "dependency-install"].includes(event.phase)), "FAILURE_NOT_PREMEASUREMENT");
  require(!Object.keys(artifact.files).some((name) => name.startsWith(`${failedArm}-`) && /(?:latency|diagnostic)\.json/.test(name)) &&
    !artifact.reports?.[failedArm] && (failedArm !== "base" || !artifact.reports?.native), "MEASURED_FAILURE_NOT_REPLACEABLE");
  return "retryable";
}
/** The I/O caller authenticates skipped/completed zero-step provider records.
 * A missing artifact/job alone is never proof that measurement did not begin.
 * @param {Execution} execution */
function nonStart(execution) {
  if (execution.nonStart === undefined) return false;
  const proof = object(execution.nonStart);
  same(execution.conclusion, "skipped"); same(execution.artifactId, null);
  same(proof.kind, "PROVIDER_SKIPPED_JOB"); same(proof.jobId, execution.jobId);
  same(proof.status, "completed"); same(proof.conclusion, "skipped"); same(proof.stepCount, 0);
  require(proof.stage === undefined || ["profile", "preflight"].includes(proof.stage), "UNKNOWN_SKIPPED_STAGE");
  return true;
}
/** @param {Inventory} input @param {Slot[]} requested */
function inventory(input, requested) {
  const { campaign, executions, artifacts } = input;
  validateCampaign(campaign);
  require(Array.isArray(executions) && executions.length <= 1000 && Array.isArray(artifacts) && artifacts.length <= 1000, "INVENTORY_TOO_LARGE");
  /** @type {Map<string,Artifact>} */ const byArtifact = new Map();
  for (const artifact of artifacts) { id(artifact.artifactId); require(!byArtifact.has(artifact.artifactId), "DUPLICATE_ARTIFACT"); byArtifact.set(artifact.artifactId, artifact); }
  /** @type {Map<string,Execution[]>} */ const bySlot = new Map();
  /** @type {Map<string,Execution[]>} */ const jobs = new Map();
  const usedArtifacts = new Set();
  for (const execution of executions) {
    object(execution); same(execution.repository, campaign.repository); same(execution.runId, campaign.runId); same(execution.workflowSha, campaign.workflowSha);
    positive(execution.attempt); require(execution.attempt >= campaign.campaignAttempt && execution.attempt <= campaign.currentAttempt, "OUTSIDE_CAMPAIGN");
    id(execution.jobId); nonStart(execution);
    const jobRows = jobs.get(execution.jobId) ?? []; jobRows.push(execution); jobs.set(execution.jobId, jobRows);
    const key = checkedSlot(execution.slot), group = bySlot.get(key) ?? [];
    require(!group.some((entry) => entry.attempt === execution.attempt), "DUPLICATE_EXECUTION");
    require(["success", "failure", "cancelled", "timed_out", "skipped", "in_progress"].includes(execution.conclusion), "UNKNOWN_CONCLUSION");
    if (execution.artifactId !== null) {
      id(execution.artifactId); require(!usedArtifacts.has(execution.artifactId), "REUSED_ARTIFACT"); usedArtifacts.add(execution.artifactId);
      const artifact = byArtifact.get(execution.artifactId); require(artifact, "MISSING_EXECUTED_ARTIFACT"); validateArtifact(artifact, execution, campaign);
    }
    group.push(execution); bySlot.set(key, group);
  }
  require(usedArtifacts.size === artifacts.length, "UNREFERENCED_ARTIFACT");
  for (const group of jobs.values()) {
    const first = group[0]; require(first, "MISSING_JOB");
    const stage = first.nonStart?.stage;
    if (!stage) require(group.length === 1, "DUPLICATE_JOB");
    else {
      const declared = new Set(profileMatrix(stage === "preflight" ? "preflight" : "remaining").include.map(slotKey));
      for (const execution of group) {
        same(execution.attempt, first.attempt); same(execution.nonStart, first.nonStart);
        require(declared.has(slotKey(execution.slot)), "SKIPPED_STAGE_SLOT_MISMATCH");
      }
      const actual = new Set(group.map((execution) => slotKey(execution.slot)));
      require(requested.filter((slot) => declared.has(slotKey(slot))).every((slot) => actual.has(slotKey(slot))), "INCOMPLETE_SKIPPED_STAGE");
    }
  }
  for (const group of bySlot.values()) group.sort((a, b) => a.attempt - b.attempt);
  return { campaign, bySlot, byArtifact };
}
/** @param {Artifact} artifact @param {Execution} execution */
function provenance(artifact, execution) {
  return { jobId: execution.jobId, attempt: execution.attempt, artifactId: artifact.artifactId, name: artifact.name,
    archiveSha256: artifact.archiveSha256, archiveSize: artifact.archiveSize, identitySha256: artifact.identitySha256,
    inventorySha256: artifact.inventorySha256, files: { ...artifact.files } };
}
/** @param {Inventory & {requiredSlots:Slot[]}} input */
export function selectResumeArtifacts(input) {
  require(Array.isArray(input.requiredSlots) && input.requiredSlots.length > 0 && input.requiredSlots.length <= slots.length, "INVALID_REQUIRED_SLOTS");
  input.requiredSlots.forEach(checkedSlot);
  const { campaign, bySlot, byArtifact } = inventory(input, input.requiredSlots);
  const keys = new Set();
  const selected = input.requiredSlots.map((slot) => {
    const key = checkedSlot(slot); require(!keys.has(key), "DUPLICATE_REQUIRED_SLOT"); keys.add(key);
    const history = bySlot.get(key); require(history?.length, "MISSING_EXECUTION");
    const entries = history.map((execution, index) => {
      if (nonStart(execution)) {
        require(index < history.length - 1, "LATEST_EXECUTION_NOT_SUCCESSFUL");
        return { outcome: "not_started", jobId: execution.jobId, attempt: execution.attempt, nonStart: { ...execution.nonStart } };
      }
      const artifact = execution.artifactId && byArtifact.get(execution.artifactId); require(artifact, "MISSING_EXECUTED_ARTIFACT");
      const outcome = classify(artifact, execution, campaign);
      same(outcome, index === history.length - 1 ? "success" : "retryable");
      return { outcome, ...provenance(artifact, execution) };
    });
    const final = entries.at(-1); require(final && "artifactId" in final, "LATEST_EXECUTION_NOT_SUCCESSFUL");
    return { key, slot: { ...slot }, ...final, history: entries };
  });
  return { version: 1, state: "SELECTED_FOR_CANONICAL_VALIDATION", requiresCanonicalValidation: true,
    repository: campaign.repository, runId: campaign.runId, workflowSha: campaign.workflowSha,
    campaignAttempt: campaign.campaignAttempt, currentAttempt: campaign.currentAttempt, selected };
}
/** Authorize only an unmeasured current job after fully proven earlier failures.
 * The current slot may be absent or in_progress with no artifact; never ignore
 * an already terminal/newer outcome or reuse any old baseline measurements.
 * @param {Inventory & {slot:Slot}} input */
export function authorizeArtifactRetry(input) {
  const key = checkedSlot(input.slot), { campaign, bySlot, byArtifact } = inventory(input, [input.slot]);
  const all = bySlot.get(key) ?? [];
  const current = all.filter((execution) => execution.attempt === campaign.currentAttempt);
  require(current.every((execution) => execution.conclusion === "in_progress" && execution.artifactId === null), "CURRENT_ATTEMPT_ALREADY_TERMINAL");
  const history = all.filter((execution) => execution.attempt < campaign.currentAttempt);
  require(history.length > 0, "MISSING_PRIOR_FAILURE");
  const replaced = history.map((execution) => {
    if (nonStart(execution)) return { outcome: "not_started", jobId: execution.jobId, attempt: execution.attempt, nonStart: { ...execution.nonStart } };
    const artifact = execution.artifactId && byArtifact.get(execution.artifactId); require(artifact, "MISSING_EXECUTED_ARTIFACT");
    same(classify(artifact, execution, campaign), "retryable");
    return provenance(artifact, execution);
  });
  return { version: 1, state: "AUTHORIZED_REMEASURE_PAIRED_ARMS", key, slot: { ...input.slot },
    repository: campaign.repository, runId: campaign.runId, workflowSha: campaign.workflowSha,
    campaignAttempt: campaign.campaignAttempt, attempt: campaign.currentAttempt, remeasureBaseline: true,
    remeasureCandidate: true, preserveOriginalArtifacts: true, replaced };
}
