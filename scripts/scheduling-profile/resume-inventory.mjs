import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import { profileMatrix } from "./aggregate-partitions.mjs";

/** @typedef {{scenario:string,mode:string,partition:number,partitionCount:number,samples:number}} Slot */
/** @typedef {{repository:string,runId:string,campaignAttempt:number,currentAttempt:number,candidateRevision:string,workflowSha:string}} Campaign */
/** @typedef {{kind:'PROVIDER_SKIPPED_JOB',jobId:string,status:'completed',conclusion:'skipped',stepCount:0,stage?:'profile'|'preflight'}} NonStart */
/** @typedef {{repository:string,runId:string,workflowSha:string,attempt:number,jobId:string,slot:Slot,conclusion:string,status:string,artifactId:string|null,measurementStarted:boolean,headSha:string,nonStart?:NonStart}} Execution */
/** @typedef {{repository:string,runId:string,attempt:number,artifactId:string,name:string,digest:string,size:number,archiveSha256:string,archiveSize:number,slot:Slot,expired:boolean,headSha:string,createdAt:string,updatedAt:string}} Archive */
/** @typedef {{fetch?:typeof fetch,token?:string,maximumExtractedBytes?:number}} Options */
/** @typedef {Record<string, any>} Evidence */
/** @typedef {{repository:string,runId:string,slot:Slot,aliasAttempt:number,aliasJobId:string,sourceAttempt:number,sourceJobId:string,attemptStartedAt:string,startedAt:string,completedAt:string,aliasCreatedAt:string,sourceCreatedAt:string,runnerId:string,runnerName:string,runnerGroupName:string,sourceRunnerGroupId:number|null,aliasRunnerGroupId:number|null,stepsSha256:string,sourceArtifactId:string|null,sourceArchiveSha256:string|null}} CarriedExecution */
const API = "https://api.github.com";
const MAX_ARCHIVE = 512 * 1024 * 1024;
const MAX_ARCHIVE_CORPUS = 4 * 1024 * 1024 * 1024;
const MAX_EXTRACTED_CORPUS = 10 * 1024 * 1024 * 1024;
const MAX_JSON = 16 * 1024 * 1024;
const workflowPath = ".github/workflows/scheduling-profile.yml";
const canonicalId = (/** @type {unknown} */ value) => {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  assert.ok(typeof text === "string" && /^[1-9][0-9]{0,17}$/.test(text), "Invalid provider identifier");
  return text;
};
const object = (/** @type {unknown} */ value) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Malformed provider evidence");
  return /** @type {Evidence} */ (value);
};
const sha = (/** @type {unknown} */ value) => {
  assert.ok(typeof value === "string" && /^[a-f0-9]{40}$/.test(value), "Invalid provider revision");
  return value;
};
const timestamp = (/** @type {unknown} */ value) => {
  assert.ok(typeof value === "string" && Number.isFinite(Date.parse(value)), "Invalid provider timestamp");
  return value;
};
const key = (/** @type {Slot} */ slot) => `${slot.scenario}/${slot.mode}/${slot.partition}`;
const declaredSlots = new Map(profileMatrix("all").include.map((slot) => [key(slot), slot]));
const stageFor = (/** @type {Slot} */ slot) => slot.mode === "diagnostic" && ["negotiation", "allocation", "catalog", "contention-bulk-first", "contention-acceptance-first"].includes(slot.scenario) ? "preflight" : "profile";
function slotValid(/** @type {Slot} */ slot) {
  assert.ok(/^[a-z][a-z-]{0,60}$/.test(slot.scenario) && ["latency", "diagnostic"].includes(slot.mode), "Invalid inventory slot");
  assert.ok(Number.isSafeInteger(slot.partition) && Number.isSafeInteger(slot.partitionCount) && slot.partition >= 0 && slot.partition < slot.partitionCount && slot.partitionCount <= 100 && Number.isSafeInteger(slot.samples) && slot.samples > 0 && slot.samples <= 100, "Invalid inventory population");
  assert.deepEqual(slot, declaredSlots.get(key(slot)), "Inventory slot is not in the canonical matrix");
  return slot;
}
function credentials(/** @type {Options} */ options) {
  const token = options.token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  assert.ok(typeof token === "string" && token.trim() && !/[\r\n]/.test(token), "Authenticated Actions inventory requires GH_TOKEN or GITHUB_TOKEN");
  return { send: options.fetch ?? fetch, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } };
}
async function request(/** @type {ReturnType<typeof credentials>} */ client, /** @type {string} */ path) {
  let response;
  try { response = await client.send(`${API}${path}`, { headers: client.headers, redirect: "error", signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error("Actions inventory request failed"); }
  assert.ok(response.ok, `Actions inventory HTTP ${response.status}`);
  assert.ok(response.headers.get("content-type")?.includes("application/json"), "Actions inventory returned non-JSON evidence");
  const body = await bytes(response, MAX_JSON);
  try { return object(JSON.parse(body.toString("utf8"))); }
  catch { throw new Error("Malformed Actions inventory JSON"); }
}
async function bytes(/** @type {Response} */ response, /** @type {number} */ maximum) {
  assert.ok(response.body, "Missing provider response body");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      assert.ok(size <= maximum, "Provider response exceeds its size limit");
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
async function paginated(/** @type {ReturnType<typeof credentials>} */ client, /** @type {string} */ path, /** @type {string} */ field) {
  const rows = [];
  let expected;
  for (let page = 1; page <= 20; page++) {
    const value = await request(client, `${path}?per_page=100&page=${page}`);
    assert.ok(Number.isSafeInteger(value.total_count) && value.total_count >= 0 && value.total_count <= 2000 && Array.isArray(value[field]), "Malformed inventory pagination");
    expected ??= value.total_count;
    assert.equal(value.total_count, expected, "Actions inventory changed during pagination");
    assert.ok(value[field].length <= 100, "Oversized inventory page");
    rows.push(...value[field].map(object));
    assert.ok(rows.length <= expected, "Duplicate or excessive inventory rows");
    if (rows.length === expected) return rows;
    assert.equal(value[field].length, 100, "Truncated inventory page");
  }
  throw new Error("Actions inventory pagination limit exceeded");
}
function campaignValid(/** @type {Campaign} */ campaign) {
  assert.match(campaign.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  canonicalId(campaign.runId); sha(campaign.candidateRevision); sha(campaign.workflowSha);
  assert.ok(Number.isSafeInteger(campaign.campaignAttempt) && Number.isSafeInteger(campaign.currentAttempt) && campaign.campaignAttempt >= 1 && campaign.currentAttempt >= campaign.campaignAttempt && campaign.currentAttempt <= 50, "Invalid campaign attempt interval");
}

/** Job/step bodies are only relevant after the exact selected slot is known.
 * GitHub reports future steps as pending/null while a job is still active; this
 * is neither a completed measure nor provider proof that the job never ran. */
function selectedSteps(/** @type {Evidence} */ job) {
  assert.ok(["queued", "in_progress", "completed", "waiting", "pending", "requested"].includes(job.status), "Invalid provider job status");
  assert.ok(job.status === "completed" ? ["success", "failure", "cancelled", "skipped", "timed_out", "action_required", "neutral", "stale", "startup_failure"].includes(job.conclusion) : job.conclusion === null, "Invalid provider job conclusion");
  assert.ok(Array.isArray(job.steps), "Missing provider job steps");
  for (const rawStep of job.steps) {
    const step = object(rawStep);
    assert.ok(typeof step.name === "string" && ["queued", "pending", "in_progress", "completed"].includes(step.status), "Invalid provider step status");
    assert.ok(step.status === "completed"
      ? ["success", "failure", "cancelled", "skipped", "timed_out", "action_required", "neutral"].includes(step.conclusion)
      : step.conclusion === null, "Invalid provider step conclusion");
    assert.ok(job.status !== "completed" || step.status === "completed", "Completed provider job retains an active step");
    if (step.status === "pending") {
      assert.ok((!("started_at" in step) || step.started_at === null) && (!("completed_at" in step) || step.completed_at === null), "Pending provider step retains execution times");
    }
  }
  return /** @type {Evidence[]} */ (job.steps);
}

/** Carried successful check records have a new ID/attempt/creation time but no
 * new runner execution. Missing or approximate historical evidence is not an
 * alias. In particular, only the observed null/zero group sentinel is equivalent. */
function carryProof(/** @type {Evidence} */ job, /** @type {Evidence} */ source, /** @type {string} */ attemptStartedAt) {
  assert.ok(job.status === "completed" && job.conclusion === "success" && source.status === "completed" && source.conclusion === "success", "Carried provider job has no successful source");
  for (const name of ["name", "head_sha", "started_at", "completed_at", "runner_id", "runner_name", "runner_group_name", "labels", "steps"])
    assert.ok(isDeepStrictEqual(job[name], source[name]), "Carried provider execution differs from its historical source");
  const start = timestamp(job.started_at), finish = timestamp(job.completed_at);
  const created = timestamp(job.created_at), sourceCreated = timestamp(source.created_at);
  assert.ok(Date.parse(sourceCreated) <= Date.parse(start) && Date.parse(start) <= Date.parse(finish) && Date.parse(finish) < Date.parse(attemptStartedAt) && Date.parse(created) >= Date.parse(attemptStartedAt), "Carried provider execution has an invalid timeline");
  canonicalId(job.runner_id);
  assert.ok(typeof job.runner_name === "string" && job.runner_name && typeof job.runner_group_name === "string" && job.runner_group_name && Array.isArray(job.labels) && job.labels.length > 0 && job.labels.every((/** @type {unknown} */ label) => typeof label === "string" && label), "Missing carried provider runner identity");
  for (const value of [source.runner_group_id, job.runner_group_id])
    assert.ok(value === null || (Number.isSafeInteger(value) && value >= 0), "Missing carried runner group evidence");
  assert.equal(source.runner_group_id ?? 0, job.runner_group_id ?? 0, "Carried provider runner group differs");
  const numbers = new Set();
  for (const raw of job.steps) {
    const step = object(raw), stepStart = timestamp(step.started_at), stepFinish = timestamp(step.completed_at);
    assert.ok(Number.isSafeInteger(step.number) && step.number > 0 && !numbers.has(step.number), "Invalid carried provider step identity"); numbers.add(step.number);
    assert.ok(step.status === "completed" && ["success", "skipped"].includes(step.conclusion) && Date.parse(start) <= Date.parse(stepStart) && Date.parse(stepStart) <= Date.parse(stepFinish) && Date.parse(stepFinish) <= Date.parse(finish), "Incomplete carried provider step timeline");
  }
  return { start, finish, created, sourceCreated };
}

/** Enumerate every execution, including failed/in-progress jobs with no archive.
 * Selection and retry authorization belong to the caller; inventory never chooses
 * an older PASS or hides a current worker. Proven carried successful checks are
 * recorded separately with their original execution/artifact lineage. Compare a
 * fresh complete result after extraction to reject provider evidence changes.
 * @param {Campaign} campaign @param {Slot[]} slots @param {Options} [options]
 * @returns {Promise<{executions:Execution[],archives:Archive[],audit:{attempts:Array<{attempt:number,startedAt:string,headSha:string}>,carriedExecutions:CarriedExecution[]}}>} */
export async function collectInventory(campaign, slots, options = {}) {
  campaignValid(campaign);
  const selected = new Map(slots.map((slot) => [key(slotValid(slot)), slot]));
  assert.ok(selected.size === slots.length && selected.size > 0, "Duplicate or empty inventory slots");
  const client = credentials(options), base = `/repos/${campaign.repository}/actions`;
  const run = await request(client, `${base}/runs/${campaign.runId}`);
  assert.equal(canonicalId(run.id), campaign.runId, "Wrong provider run");
  assert.equal(object(run.repository).full_name?.toLowerCase(), campaign.repository.toLowerCase(), "Wrong provider repository");
  assert.equal(run.path, workflowPath, "Wrong provider workflow");
  assert.ok(["pull_request", "workflow_dispatch"].includes(run.event), "Unsupported provider event");
  const head = sha(run.head_sha);
  // PR API metadata can identify the event head rather than its merge workflow
  // commit. Both must be externally pinned, and every job must match this run.
  assert.ok([campaign.workflowSha, campaign.candidateRevision].includes(head), "Wrong provider event revision");
  assert.equal(run.run_attempt, campaign.currentAttempt, "Provider run attempt changed");
  /** @type {Execution[]} */ const executions = [];
  /** @type {Array<{attempt:number,startedAt:string,headSha:string}>} */ const attempts = [];
  /** @type {CarriedExecution[]} */ const carriedExecutions = [];
  /** @type {Map<string,{job:Evidence,execution:Execution}>} */ const history = new Map();
  const jobIds = new Set();
  for (let attempt = campaign.campaignAttempt; attempt <= campaign.currentAttempt; attempt++) {
    const metadata = await request(client, `${base}/runs/${campaign.runId}/attempts/${attempt}`);
    assert.equal(canonicalId(metadata.id), campaign.runId, "Wrong provider attempt run");
    assert.equal(metadata.run_attempt, attempt, "Wrong provider attempt identity");
    assert.equal(sha(metadata.head_sha), head, "Wrong provider attempt revision");
    assert.equal(metadata.path, workflowPath, "Wrong provider attempt workflow");
    const attemptStartedAt = timestamp(metadata.run_started_at);
    const previousAttempt = attempts.at(-1);
    assert.ok(!previousAttempt || Date.parse(attemptStartedAt) > Date.parse(previousAttempt.startedAt), "Provider attempt clock did not advance");
    attempts.push({ attempt, startedAt: attemptStartedAt, headSha: head });
    const jobs = await paginated(client, `${base}/runs/${campaign.runId}/attempts/${attempt}/jobs`, "jobs");
    const seenSlots = new Set();
    for (const job of jobs) {
      const id = canonicalId(job.id);
      assert.ok(!jobIds.has(id), "Duplicate provider job"); jobIds.add(id);
      assert.equal(canonicalId(job.run_id), campaign.runId, "Wrong provider job run");
      assert.equal(job.run_attempt, attempt, "Wrong provider job attempt");
      assert.equal(sha(job.head_sha), head, "Wrong provider job revision");
      assert.ok(typeof job.name === "string", "Missing provider job name");
      if (job.name === "profile" || job.name === "preflight") {
        const relevant = [...selected.values()].filter((slot) => job.name === stageFor(slot));
        if (!relevant.length) continue;
        const steps = selectedSteps(job);
        assert.ok(job.status === "completed" && job.conclusion === "skipped" && steps.length === 0, "Unrecognized provider matrix placeholder");
        for (const slot of relevant) {
          assert.ok(!seenSlots.has(key(slot)), "Duplicate skipped matrix execution"); seenSlots.add(key(slot));
          executions.push({ repository: campaign.repository, runId: campaign.runId, workflowSha: campaign.workflowSha, attempt, jobId: id, slot, conclusion: "skipped", status: "completed", artifactId: null, measurementStarted: false, headSha: head,
            nonStart: { kind: "PROVIDER_SKIPPED_JOB", jobId: id, status: "completed", conclusion: "skipped", stepCount: 0, stage: job.name } });
        }
        continue;
      }
      const match = /^(?:preflight|profile) \(([a-z-]+), (latency|diagnostic), (0|[1-9][0-9]*), ([1-9][0-9]*), ([1-9][0-9]*)\) \/ measure$/.exec(job.name);
      if (!match) {
        assert.ok(!/^(?:preflight|profile)(?:$|[ (])/.test(job.name), "Unrecognized provider matrix job");
        continue;
      }
      assert.ok(typeof match[1] === "string" && typeof match[2] === "string", "Missing provider matrix identity");
      const slot = slotValid({ scenario: match[1], mode: match[2], partition: Number(match[3]), partitionCount: Number(match[4]), samples: Number(match[5]) });
      assert.ok(job.name.startsWith(stageFor(slot) + " ("), "Provider matrix stage differs");
      const wanted = selected.get(key(slot));
      if (!wanted) continue;
      assert.deepEqual(slot, wanted, "Provider job population differs");
      assert.ok(!seenSlots.has(key(slot)), "Duplicate provider slot execution"); seenSlots.add(key(slot));
      const steps = selectedSteps(job);
      const skipped = job.status === "completed" && job.conclusion === "skipped" && steps.length === 0;
      const measured = steps.filter((step) => step.name === "Measure baseline then candidate");
      assert.ok(measured.length <= 1, "Duplicate provider measurement step");
      if (job.status === "completed" && job.conclusion === "success")
        assert.ok(measured.length === 1 && measured[0]?.status === "completed" && measured[0]?.conclusion === "success", "Successful provider job lacks completed measurement");
      if (job.completed_at !== undefined && job.completed_at !== null && Date.parse(timestamp(job.completed_at)) < Date.parse(attemptStartedAt)) {
        const source = history.get(key(wanted));
        assert.ok(source, "Carried provider job is missing its original execution");
        const proof = carryProof(job, source.job, attemptStartedAt);
        carriedExecutions.push({ repository: campaign.repository, runId: campaign.runId, slot: wanted,
          aliasAttempt: attempt, aliasJobId: id, sourceAttempt: source.execution.attempt, sourceJobId: source.execution.jobId,
          attemptStartedAt, startedAt: proof.start, completedAt: proof.finish, aliasCreatedAt: proof.created,
          sourceCreatedAt: proof.sourceCreated, runnerId: canonicalId(job.runner_id), runnerName: job.runner_name,
          runnerGroupName: job.runner_group_name, sourceRunnerGroupId: source.job.runner_group_id, aliasRunnerGroupId: job.runner_group_id,
          stepsSha256: createHash("sha256").update(JSON.stringify(job.steps)).digest("hex"), sourceArtifactId: null, sourceArchiveSha256: null });
        continue;
      }
      const measurementStarted = measured.some((/** @type {Evidence} */ step) => step.status === "in_progress" || (step.status === "completed" && step.conclusion !== "skipped"));
      const conclusion = job.status === "completed" ? String(job.conclusion) : String(job.status);
      /** @type {Execution} */ const execution = { repository: campaign.repository, runId: campaign.runId, workflowSha: campaign.workflowSha, attempt, jobId: id, slot: wanted, conclusion, status: job.status, artifactId: null, measurementStarted, headSha: head,
        ...(skipped ? { nonStart: { kind: "PROVIDER_SKIPPED_JOB", jobId: id, status: "completed", conclusion: "skipped", stepCount: 0 } } : {}) };
      executions.push(execution);
      history.set(key(wanted), { job, execution });
    }
  }
  /** @type {Archive[]} */ const archives = [];
  const artifactIds = new Set(), names = new Set();
  for (const artifact of await paginated(client, `${base}/runs/${campaign.runId}/artifacts`, "artifacts")) {
    const id = canonicalId(artifact.id);
    assert.ok(!artifactIds.has(id), "Duplicate provider artifact"); artifactIds.add(id);
    assert.ok(typeof artifact.name === "string", "Missing provider artifact name");
    const match = /^scheduling-profile-([a-z-]+)-(latency|diagnostic)-part-(0|[1-9][0-9]*)-([1-9][0-9]*)$/.exec(artifact.name);
    if (!match) {
      assert.ok(!/^scheduling-profile-.*-(?:latency|diagnostic)-part-/.test(artifact.name), "Malformed provider partition archive");
      continue;
    }
    const declared = declaredSlots.get(`${match[1]}/${match[2]}/${Number(match[3])}`);
    assert.ok(declared, "Provider archive has an unknown matrix slot");
    const wanted = selected.get(`${match[1]}/${match[2]}/${Number(match[3])}`);
    const attempt = Number(match[4]);
    if (!wanted || attempt < campaign.campaignAttempt) continue;
    assert.ok(attempt <= campaign.currentAttempt, "Future provider artifact attempt");
    assert.ok(!names.has(artifact.name), "Duplicate provider artifact name"); names.add(artifact.name);
    const origin = object(artifact.workflow_run);
    assert.equal(canonicalId(origin.id), campaign.runId, "Wrong artifact run");
    assert.equal(sha(origin.head_sha), head, "Wrong artifact revision");
    assert.ok(typeof artifact.expired === "boolean", "Missing artifact expiry evidence");
    assert.ok(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= MAX_ARCHIVE, "Invalid artifact archive size");
    assert.ok(typeof artifact.digest === "string" && /^sha256:[a-f0-9]{64}$/.test(artifact.digest), "Missing provider artifact SHA256");
    const execution = executions.find((entry) => entry.attempt === attempt && key(entry.slot) === key(wanted));
    assert.ok(!carriedExecutions.some((entry) => entry.aliasAttempt === attempt && key(entry.slot) === key(wanted)), "Carried provider alias cannot own a new artifact");
    assert.ok(execution && !execution.artifactId, "Artifact has no unique provider execution");
    execution.artifactId = id;
    assert.ok(!execution.nonStart, "Skipped provider job cannot have a measurement archive");
    archives.push({ repository: campaign.repository, runId: campaign.runId, attempt, artifactId: id, name: artifact.name, digest: artifact.digest, size: artifact.size_in_bytes, archiveSha256: artifact.digest.slice(7), archiveSize: artifact.size_in_bytes, slot: wanted, expired: artifact.expired, headSha: head, createdAt: timestamp(artifact.created_at), updatedAt: timestamp(artifact.updated_at) });
  }
  // Stable sorting makes equality rechecks independent of provider listing order.
  executions.sort((a, b) => key(a.slot).localeCompare(key(b.slot)) || a.attempt - b.attempt);
  archives.sort((a, b) => key(a.slot).localeCompare(key(b.slot)) || a.attempt - b.attempt);
  for (const alias of carriedExecutions) {
    const source = archives.find((archive) => archive.attempt === alias.sourceAttempt && key(archive.slot) === key(alias.slot));
    assert.ok(source, "Carried provider job is missing its original authenticated artifact");
    alias.sourceArtifactId = source.artifactId;
    alias.sourceArchiveSha256 = source.archiveSha256;
  }
  carriedExecutions.sort((a, b) => key(a.slot).localeCompare(key(b.slot)) || a.aliasAttempt - b.aliasAttempt);
  return { executions, archives, audit: { attempts, carriedExecutions } };
}

const execute = promisify(execFile);
async function extract(/** @type {string} */ zip, /** @type {string} */ destination, /** @type {number} */ remaining) {
  try {
    const result = await execute("python3", [fileURLToPath(new URL("./resume-extract.py", import.meta.url)), zip, destination, String(remaining)], {
      timeout: 120_000, maxBuffer: 65536, windowsHide: true,
    });
    const count = Number(result.stdout.trim());
    assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= remaining, "Invalid extraction size receipt");
    return count;
  } catch {
    // zipfile diagnostics can contain member paths; do not copy provider payloads
    // or signed archive URLs into the public selection receipt.
    throw new Error("Artifact ZIP extraction failed safety or integrity validation");
  }
}
function redirectUrl(/** @type {string} */ input) {
  const url = new URL(input);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.port && /(?:^|\.)(?:blob\.core\.windows\.net|githubusercontent\.com|actions\.githubusercontent\.com)$/.test(url.hostname), "Unsafe artifact download redirect");
  return url;
}

/** Download only selected immutable artifact IDs. Provider SHA256 covers the ZIP;
 * Python zipfile independently checks bounded flat entries, CRC and sizes.
 * No archive payload is executed, overlaid or followed through a filesystem link.
 * @param {Archive[]} archives @param {string} directory @param {Options} [options]
 * @returns {Promise<string[]>} */
export async function downloadArchives(archives, directory, options = {}) {
  const client = credentials(options);
  // A caller may tighten this budget; the hard campaign cap is never raised.
  const maximumExtracted = options.maximumExtractedBytes ?? MAX_EXTRACTED_CORPUS;
  assert.ok(Number.isSafeInteger(maximumExtracted) && maximumExtracted >= 0 && maximumExtracted <= MAX_EXTRACTED_CORPUS, "Invalid campaign extraction budget");
  let declaredBytes = 0;
  for (const archive of archives) {
    assert.ok(Number.isSafeInteger(archive.size) && archive.size > 0 && archive.size <= MAX_ARCHIVE, "Invalid artifact archive size");
    declaredBytes += archive.size;
    assert.ok(declaredBytes <= MAX_ARCHIVE_CORPUS, "Archive corpus exceeds its declared size limit");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  assert.ok((await lstat(directory)).isDirectory() && !(await lstat(directory)).isSymbolicLink(), "Archive destination must be a real directory");
  const root = await realpath(directory), names = new Set(), ids = new Set(), directories = [];
  assert.equal(root, resolve(directory), "Archive destination must not traverse links");
  let extractedBytes = 0;
  for (const archive of archives) {
    campaignValid({ repository: archive.repository, runId: archive.runId, campaignAttempt: archive.attempt, currentAttempt: archive.attempt, candidateRevision: archive.headSha, workflowSha: archive.headSha });
    canonicalId(archive.artifactId); slotValid(archive.slot);
    assert.equal(archive.name, `scheduling-profile-${archive.slot.scenario}-${archive.slot.mode}-part-${archive.slot.partition}-${archive.attempt}`, "Archive name differs from its exact slot");
    assert.ok(!names.has(archive.name) && !ids.has(archive.artifactId), "Duplicate selected archive"); names.add(archive.name); ids.add(archive.artifactId);
    assert.ok(!archive.expired && /^sha256:[a-f0-9]{64}$/.test(archive.digest) && Number.isSafeInteger(archive.size) && archive.size > 0 && archive.size <= MAX_ARCHIVE, "Invalid selected archive");
    assert.ok(archive.archiveSha256 === archive.digest.slice(7) && archive.archiveSize === archive.size, "Archive receipt metadata differs");
    const target = join(root, archive.name), temporary = join(root, `.archive-${randomUUID()}.zip`);
    await mkdir(target, { mode: 0o700 });
    try {
      let response;
      try { response = await client.send(`${API}/repos/${archive.repository}/actions/artifacts/${archive.artifactId}/zip`, { headers: client.headers, redirect: "manual", signal: AbortSignal.timeout(30_000) }); }
      catch { throw new Error("Artifact archive request failed"); }
      for (let redirects = 0; response.status === 302 || response.status === 307; redirects++) {
        const location = response.headers.get("location");
        assert.ok(redirects < 3 && location, "Artifact redirect limit exceeded");
        const url = redirectUrl(location);
        // The signed storage URL is a capability. Never forward GitHub auth or
        // include its query/body in diagnostics.
        try { response = await client.send(url, { redirect: "manual", signal: AbortSignal.timeout(120_000) }); }
        catch { throw new Error("Artifact storage request failed"); }
      }
      assert.equal(response.status, 200, "Artifact download failed");
      assert.ok(response.body, "Missing artifact archive body");
      const hash = createHash("sha256"); let downloaded = 0;
      const check = new Transform({ transform(chunk, _encoding, callback) {
        downloaded += chunk.length;
        if (downloaded > archive.size || downloaded > MAX_ARCHIVE) return callback(new Error("Artifact archive exceeds declared size"));
        hash.update(chunk); callback(null, chunk);
      } });
      await pipeline(response.body, check, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      assert.ok(downloaded === archive.size && `sha256:${hash.digest("hex")}` === archive.digest, "Artifact archive SHA256 or size differs");
      extractedBytes += await extract(temporary, target, maximumExtracted - extractedBytes);
      directories.push(target);
    } catch (error) {
      assert.equal(dirname(target), root, "Invalid owned archive cleanup path");
      await rm(target, { recursive: true, force: true });
      const safe = ["Artifact ZIP extraction failed safety or integrity validation", "Artifact archive SHA256 or size differs", "Artifact archive exceeds declared size", "Unsafe artifact download redirect", "Artifact redirect limit exceeded", "Artifact download failed", "Missing artifact archive body", "Artifact archive request failed", "Artifact storage request failed"];
      if (error instanceof Error && safe.includes(error.message)) throw error;
      throw new Error("Artifact archive streaming or filesystem write failed");
    } finally { await rm(temporary, { force: true }); }
  }
  return directories;
}
