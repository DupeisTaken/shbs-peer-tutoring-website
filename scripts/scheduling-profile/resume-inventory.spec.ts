import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { zipSync, strToU8, type Zippable } from "fflate";
import { collectInventory, downloadArchives } from "./resume-inventory.mjs";
import type { Archive, Campaign, Slot } from "./resume-inventory.mjs";

const campaign: Campaign = {
  repository: "synthetic/profile", runId: "123", campaignAttempt: 1, currentAttempt: 2,
  candidateRevision: "a".repeat(40), workflowSha: "b".repeat(40),
};
const slot: Slot = { scenario: "negotiation", mode: "latency", partition: 0, partitionCount: 10, samples: 40 };
const other: Slot = { scenario: "warm", mode: "latency", partition: 1, partitionCount: 10, samples: 40 };
const token = "synthetic-token-not-for-output";
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
type ProviderRecord = Record<string, unknown>;
function job(id: number, attempt: number, target = slot, conclusion = "success"): ProviderRecord {
  return {
    id, run_id: 123, run_attempt: attempt, head_sha: campaign.candidateRevision,
    name: `profile (${target.scenario}, ${target.mode}, ${target.partition}, ${target.partitionCount}, ${target.samples}) / measure`,
    status: "completed", conclusion,
    steps: [{ name: "Measure baseline then candidate", status: "completed", conclusion }],
  };
}
function artifact(id: number, attempt: number, target = slot): ProviderRecord {
  return {
    id, name: `scheduling-profile-${target.scenario}-${target.mode}-part-${target.partition}-${attempt}`,
    size_in_bytes: 123, digest: `sha256:${"c".repeat(64)}`, expired: false,
    workflow_run: { id: 123, head_sha: campaign.candidateRevision },
    created_at: "2026-11-03T01:00:00Z", updated_at: "2026-11-03T01:00:00Z",
  };
}
function fixture(binding: Campaign = campaign) {
  const state = {
    run: { id: Number(binding.runId), repository: { full_name: binding.repository }, path: ".github/workflows/scheduling-profile.yml",
      head_sha: binding.candidateRevision, event: "pull_request", run_attempt: binding.currentAttempt } as ProviderRecord,
    jobs: new Map<number, ProviderRecord[]>([[1, [job(101, 1)]], [2, [job(102, 2, slot, "failure")]]]),
    artifacts: [artifact(201, 1)] as ProviderRecord[],
  };
  const attempts = new Map<number, ProviderRecord>();
  for (let attempt = binding.campaignAttempt; attempt <= binding.currentAttempt; attempt++) attempts.set(attempt, {
    ...state.run, run_attempt: attempt, run_started_at: `2026-11-03T0${attempt}:00:00Z`,
  });
  const calls: string[] = [];
  const send: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input); calls.push(url.pathname + url.search);
    assert.equal(url.origin, "https://api.github.com");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
    assert.equal(init?.redirect, "error");
    let body: unknown;
    if (url.pathname.endsWith(`/runs/${binding.runId}`)) body = state.run;
    else if (/\/attempts\/[1-9][0-9]*$/.test(url.pathname)) body = attempts.get(Number(url.pathname.split("/").at(-1)));
    else {
      const match = /\/attempts\/([1-9][0-9]*)\/jobs$/.exec(url.pathname);
      const values = match ? state.jobs.get(Number(match[1])) ?? [] : state.artifacts;
      assert.ok(match ?? url.pathname.endsWith(`/runs/${binding.runId}/artifacts`));
      const page = Number(url.searchParams.get("page"));
      body = { total_count: values.length, [match ? "jobs" : "artifacts"]: values.slice((page - 1) * 100, page * 100) };
    }
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
  return { state, attempts, calls, options: { fetch: send, token } };
}

void test("retains every authenticated execution, including a newer failed job without an artifact", async () => {
  const { options } = fixture();
  const inventory = await collectInventory(campaign, [slot], options);
  assert.equal(inventory.executions.length, 2);
  assert.deepEqual(inventory.executions.map(({ attempt, conclusion, artifactId }) => ({ attempt, conclusion, artifactId })), [
    { attempt: 1, conclusion: "success", artifactId: "201" },
    { attempt: 2, conclusion: "failure", artifactId: null },
  ]);
  assert.equal(inventory.executions[1]!.measurementStarted, true);
  assert.equal(inventory.executions[1]!.workflowSha, campaign.workflowSha);
  assert.equal(inventory.archives[0]!.archiveSha256, "c".repeat(64));
  assert.equal(inventory.archives[0]!.archiveSize, 123);
});

void test("paginates complete provider history, filters slots and produces stable fresh rechecks", async () => {
  const { state, options, calls } = fixture();
  state.jobs.set(1, [job(101, 1), ...Array.from({ length: 100 }, (_, index) => ({ ...job(1000 + index, 1, other), name: `unrelated-${index}` }))]);
  state.jobs.set(2, []);
  state.artifacts.push(artifact(202, 1, other));
  const first = await collectInventory(campaign, [slot], options);
  assert.ok(calls.some((path) => path.includes("attempts/1/jobs?per_page=100&page=2")));
  assert.equal(first.executions.length, 1);
  assert.equal(first.archives.length, 1);
  assert.deepEqual(await collectInventory(campaign, [slot], options), first);
  state.artifacts = [];
  assert.notDeepEqual(await collectInventory(campaign, [slot], options), first);
});

void test("proves skipped unexpanded stages only from an authenticated completed skipped zero-step job", async () => {
  const { state, options } = fixture();
  state.jobs.set(1, [{ ...job(101, 1), name: "profile", conclusion: "skipped", steps: [] }]);
  state.jobs.set(2, []); state.artifacts = [];
  const inventory = await collectInventory(campaign, [slot, other], options);
  assert.equal(inventory.executions.length, 2);
  for (const execution of inventory.executions) assert.deepEqual(execution.nonStart, {
    kind: "PROVIDER_SKIPPED_JOB", jobId: "101", status: "completed", conclusion: "skipped", stepCount: 0, stage: "profile",
  });
  state.jobs.set(1, []);
  assert.deepEqual((await collectInventory(campaign, [slot], options)).executions, [], "absence cannot become non-start proof");
});

void test("explicit skipped slots have no stage proof, and current running/queued jobs remain visible", async () => {
  const { state, options } = fixture();
  state.jobs.set(1, [{ ...job(101, 1), conclusion: "skipped", steps: [] }]);
  state.jobs.set(2, [{ ...job(102, 2), status: "in_progress", conclusion: null, steps: [] }]);
  state.artifacts = [];
  const inventory = await collectInventory(campaign, [slot], options);
  assert.equal(inventory.executions[0]!.nonStart?.stage, undefined);
  assert.equal(inventory.executions[1]!.conclusion, "in_progress");
  assert.equal(inventory.executions[1]!.nonStart, undefined);
  state.jobs.set(2, [{ ...job(102, 2), status: "queued", conclusion: null, steps: [] }]);
  assert.equal((await collectInventory(campaign, [slot], options)).executions[1]!.conclusion, "queued");
});

// Minimal exact enum/time examples from authenticated API reads, retained at
// .validation/complete-recovery/resume-provider-RUN-attempt2.json. These are
// observations of active jobs, not reconstructed snapshots of the failed run.
const observedActiveJobs = [
  {
    capturedAt: "2026-11-03T17:37:52.4499648Z", runId: "41654909625", jobId: "126090636477",
    headSha: "b00c95dac80115d08abfa55905474c6db98e2e82", scenario: "sunday",
    measureStartedAt: "2026-11-03T17:35:37Z", attemptStartedAt: "2026-11-03T16:30:51Z",
  },
  {
    capturedAt: "2026-11-03T17:37:52.4418644Z", runId: "41654810867", jobId: "126090623585",
    headSha: "ca93010c75fffd74475f96357dcb80d1d9fb5906", scenario: "warm",
    measureStartedAt: "2026-11-03T17:35:33Z", attemptStartedAt: "2026-11-03T16:30:48Z",
  },
] as const;
for (const observed of observedActiveJobs) void test(`accepts observed pending/null future step without promoting active job ${observed.jobId}`, async () => {
  const target = { scenario: observed.scenario, mode: "diagnostic", partition: 0, partitionCount: 1, samples: 3 };
  const current = { ...campaign, repository: "DupeisTaken/shbs-peer-tutoring-website", runId: observed.runId,
    campaignAttempt: 2, candidateRevision: observed.headSha, workflowSha: observed.headSha };
  const body = {
    id: Number(observed.jobId), run_id: Number(observed.runId), run_attempt: 2, head_sha: observed.headSha,
    name: `profile (${observed.scenario}, diagnostic, 0, 1, 3) / measure`, status: "in_progress", conclusion: null,
    steps: [
      { name: "Measure baseline then candidate", number: 10, status: "in_progress", conclusion: null, started_at: observed.measureStartedAt, completed_at: null },
      { name: "Retain raw samples and failure receipts", number: 11, status: "pending", conclusion: null, started_at: null, completed_at: null },
    ],
  };
  const send: typeof fetch = async (input) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    const response = path.endsWith(`/runs/${observed.runId}`)
      ? { id: Number(observed.runId), repository: { full_name: current.repository }, path: ".github/workflows/scheduling-profile.yml", event: "pull_request", head_sha: observed.headSha, run_attempt: 2 }
      : path.endsWith("/attempts/2")
        ? { id: Number(observed.runId), run_attempt: 2, head_sha: observed.headSha, path: ".github/workflows/scheduling-profile.yml", run_started_at: observed.attemptStartedAt }
        : path.endsWith("/jobs") ? { total_count: 1, jobs: [body] } : { total_count: 0, artifacts: [] };
    return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
  };
  const result = await collectInventory(current, [target], { fetch: send, token });
  assert.equal(result.executions[0]!.conclusion, "in_progress");
  assert.equal(result.executions[0]!.measurementStarted, true);
  assert.equal(result.executions[0]!.nonStart, undefined);
  assert.equal(result.executions[0]!.artifactId, null);
  assert.deepEqual(result.archives, []);
});

void test("validates every job envelope but ignores unrelated and unselected step bodies", async () => {
  const { state, options } = fixture();
  state.jobs.get(2)!.push(
    { ...job(103, 2), name: "aggregate", steps: [{ status: "unrecognized-irrelevant-body" }] },
    { ...job(104, 2, other), steps: [{ status: "unrecognized-unselected-body" }] },
  );
  const result = await collectInventory(campaign, [slot], options);
  assert.equal(result.executions.length, 2);
  state.jobs.get(2)![1]!.run_id = 999;
  await assert.rejects(collectInventory(campaign, [slot], options), /Wrong provider job run/);
});

void test("never accepts pending/null as a completed successful measure or skipped-job non-start proof", async () => {
  const { state, options } = fixture();
  const pending = { name: "Retain raw samples and failure receipts", status: "pending", conclusion: null, started_at: null, completed_at: null };
  state.jobs.set(2, [{ ...job(102, 2), steps: [{ name: "Measure baseline then candidate", status: "completed", conclusion: "success" }, pending] }]);
  await assert.rejects(collectInventory(campaign, [slot], options), /Completed provider job retains an active step/);
  state.jobs.set(2, [{ ...job(102, 2), status: "in_progress", conclusion: null, steps: [{ ...pending, conclusion: "success" }] }]);
  await assert.rejects(collectInventory(campaign, [slot], options), /Invalid provider step conclusion/);
  state.jobs.set(2, [{ ...job(102, 2), conclusion: "skipped", steps: [pending] }]);
  await assert.rejects(collectInventory(campaign, [slot], options), /Completed provider job retains an active step/);
  state.jobs.set(2, [{ ...job(102, 2), steps: [] }]);
  await assert.rejects(collectInventory(campaign, [slot], options), /Successful provider job lacks completed measurement/);
});

function observedCarry() {
  const binding: Campaign = { ...campaign, repository: "DupeisTaken/shbs-peer-tutoring-website", runId: "41688808733",
    candidateRevision: "f8a380786004d00eddcb31bece14eb5a2c95c2d7", workflowSha: "f8a380786004d00eddcb31bece14eb5a2c95c2d7" };
  const target: Slot = { scenario: "contention-acceptance-first", mode: "diagnostic", partition: 0, partitionCount: 1, samples: 3 };
  const result = fixture(binding);
  result.attempts.get(1)!.run_started_at = "2026-11-03T17:55:02Z";
  result.attempts.get(2)!.run_started_at = "2026-11-03T18:07:46Z";
  // Full real step timeline from the signed f8-attempt1-complete-jobs and
  // f8-attempt2-start-jobs snapshots. The archive hash/size below are synthetic
  // unit metadata; production always joins the separately authenticated ZIP.
  const timeline: Array<[number, string, string, string, "success" | "skipped"]> = [
    [1, "Set up job", "18:01:46", "18:01:47", "success"],
    [2, "Initialize containers", "18:01:47", "18:01:58", "success"],
    [3, "Validate immutable source selection", "18:01:58", "18:01:58", "success"],
    [4, "Checkout candidate", "18:01:58", "18:02:06", "success"],
    [5, "Check remaining wall-clock budget before preparing the databases", "18:02:06", "18:02:06", "success"],
    [6, "Authorize the partition from its execution history", "18:02:06", "18:02:06", "skipped"],
    [7, "Checkout baseline", "18:02:06", "18:02:16", "success"],
    [8, "Authenticate both controlled ordering references", "18:02:16", "18:02:16", "skipped"],
    [9, "Freeze comparison inputs", "18:02:16", "18:02:18", "success"],
    [10, "Measure baseline then candidate", "18:02:18", "18:05:28", "success"],
    [11, "Seal the raw partition including setup and measurement failures", "18:05:28", "18:05:28", "success"],
    [12, "Retain raw samples and failure receipts", "18:05:28", "18:05:30", "success"],
    [22, "Post Checkout baseline", "18:05:30", "18:05:30", "success"],
    [23, "Post Checkout candidate", "18:05:30", "18:05:30", "success"],
    [24, "Stop containers", "18:05:30", "18:05:31", "success"],
    [25, "Complete job", "18:05:31", "18:05:31", "success"],
  ];
  const original: ProviderRecord = {
    id: 126105236044, run_id: Number(binding.runId), run_attempt: 1,
    name: "preflight (contention-acceptance-first, diagnostic, 0, 1, 3) / measure",
    head_sha: binding.candidateRevision, status: "completed", conclusion: "success",
    runner_id: 1000008866, runner_name: "GitHub Actions 1000008866", runner_group_id: 0,
    runner_group_name: "GitHub Actions", labels: ["ubuntu-latest"],
    created_at: "2026-11-03T18:01:44Z", started_at: "2026-11-03T18:01:46Z", completed_at: "2026-11-03T18:05:33Z",
    steps: timeline.map(([number, name, start, finish, conclusion]) => ({ number, name, status: "completed", conclusion,
      started_at: `2026-11-03T${start}Z`, completed_at: `2026-11-03T${finish}Z` })),
  };
  const alias: ProviderRecord = { ...original, id: 126108597002, run_attempt: 2,
    runner_group_id: null, created_at: "2026-11-03T18:07:48Z", steps: structuredClone(original.steps) };
  result.state.jobs.set(1, [original]); result.state.jobs.set(2, [alias]);
  result.state.artifacts = [{ ...artifact(13257032315, 1, target), workflow_run: { id: Number(binding.runId), head_sha: binding.candidateRevision } }];
  return { ...result, binding, target, original, alias };
}

void test("retains the original execution and ZIP while auditing a provider-carried successful check alias", async () => {
  const { binding, target, options } = observedCarry();
  const result = await collectInventory(binding, [target], options);
  assert.deepEqual(result.executions.map(({ jobId, attempt, artifactId }) => ({ jobId, attempt, artifactId })), [
    { jobId: "126105236044", attempt: 1, artifactId: "13257032315" },
  ]);
  assert.equal(result.archives.length, 1);
  assert.deepEqual(result.audit.attempts.map(({ attempt, startedAt }) => ({ attempt, startedAt })), [
    { attempt: 1, startedAt: "2026-11-03T17:55:02Z" }, { attempt: 2, startedAt: "2026-11-03T18:07:46Z" },
  ]);
  assert.equal(result.audit.carriedExecutions.length, 1);
  assert.equal(result.audit.carriedExecutions[0]!.sourceJobId, "126105236044");
  assert.equal(result.audit.carriedExecutions[0]!.aliasJobId, "126108597002");
  assert.equal(result.audit.carriedExecutions[0]!.sourceArtifactId, "13257032315");
  assert.equal(result.audit.carriedExecutions[0]!.sourceArchiveSha256, "c".repeat(64));
  assert.equal(result.audit.carriedExecutions[0]!.sourceRunnerGroupId, 0);
  assert.equal(result.audit.carriedExecutions[0]!.aliasRunnerGroupId, null);
  assert.deepEqual(await collectInventory(binding, [target], options), result);
});

for (const [name, change] of [
  ["different runner", (data: ReturnType<typeof observedCarry>) => { data.alias.runner_id = 1000009999; }],
  ["different runner group", (data: ReturnType<typeof observedCarry>) => { data.alias.runner_group_id = 5; }],
  ["changed real step", (data: ReturnType<typeof observedCarry>) => { (data.alias.steps as ProviderRecord[])[9]!.completed_at = "2026-11-03T18:05:27Z"; }],
  ["missing original", (data: ReturnType<typeof observedCarry>) => { data.state.jobs.set(1, []); }],
  ["missing original artifact", (data: ReturnType<typeof observedCarry>) => { data.state.artifacts = []; }],
  ["failed original", (data: ReturnType<typeof observedCarry>) => { data.original.conclusion = "failure"; }],
  ["failed alias", (data: ReturnType<typeof observedCarry>) => { data.alias.conclusion = "failure"; }],
  ["cancelled alias", (data: ReturnType<typeof observedCarry>) => { data.alias.conclusion = "cancelled"; }],
  ["incomplete alias", (data: ReturnType<typeof observedCarry>) => { data.alias.status = "in_progress"; data.alias.conclusion = null; }],
  ["new alias artifact", (data: ReturnType<typeof observedCarry>) => { data.state.artifacts.push({ ...artifact(13259999999, 2, data.target), workflow_run: { id: Number(data.binding.runId), head_sha: data.binding.candidateRevision } }); }],
  ["creation before rerun", (data: ReturnType<typeof observedCarry>) => { data.alias.created_at = "2026-11-03T18:06:00Z"; }],
] as const) void test(`does not elide an unproven carried execution: ${name}`, async () => {
  const data = observedCarry(); change(data);
  await assert.rejects(collectInventory(data.binding, [data.target], data.options));
});

void test("a real newer rerun remains a distinct execution instead of inheriting the old success", async () => {
  const data = observedCarry();
  data.alias.runner_id = 1000009999;
  data.alias.started_at = "2026-11-03T18:08:00Z";
  data.alias.completed_at = "2026-11-03T18:10:00Z";
  data.alias.conclusion = "failure";
  const result = await collectInventory(data.binding, [data.target], data.options);
  assert.equal(result.executions.length, 2);
  assert.equal(result.executions[1]!.conclusion, "failure");
  assert.equal(result.executions[1]!.artifactId, null);
  assert.deepEqual(result.audit.carriedExecutions, []);
});

for (const [name, change] of [
  ["wrong run", (state: ReturnType<typeof fixture>["state"]) => { state.run.id = 999; }],
  ["wrong repository", (state: ReturnType<typeof fixture>["state"]) => { state.run.repository = { full_name: "other/repository" }; }],
  ["wrong workflow", (state: ReturnType<typeof fixture>["state"]) => { state.run.path = ".github/workflows/unrelated.yml"; }],
  ["wrong event revision", (state: ReturnType<typeof fixture>["state"]) => { state.run.head_sha = "d".repeat(40); }],
  ["concurrent later attempt", (state: ReturnType<typeof fixture>["state"]) => { state.run.run_attempt = 3; }],
  ["job from another attempt", (state: ReturnType<typeof fixture>["state"]) => { state.jobs.get(1)![0]!.run_attempt = 2; }],
  ["duplicate provider execution", (state: ReturnType<typeof fixture>["state"]) => { state.jobs.get(1)!.push(job(103, 1)); }],
  ["wrong population", (state: ReturnType<typeof fixture>["state"]) => { state.jobs.get(1)![0]!.name = "profile (negotiation, latency, 0, 5, 20) / measure"; }],
  ["wrong stage", (state: ReturnType<typeof fixture>["state"]) => { state.jobs.get(1)![0]!.name = "preflight (negotiation, latency, 0, 10, 40) / measure"; }],
  ["unknown matrix job", (state: ReturnType<typeof fixture>["state"]) => { state.jobs.get(1)![0]!.name = "profile (unexpected, latency, 0, 10, 40) / measure"; }],
  ["unknown matrix archive", (state: ReturnType<typeof fixture>["state"]) => { state.artifacts[0]!.name = "scheduling-profile-unexpected-latency-part-0-1"; }],
  ["missing steps", (state: ReturnType<typeof fixture>["state"]) => { delete state.jobs.get(1)![0]!.steps; }],
  ["malformed step status", (state: ReturnType<typeof fixture>["state"]) => { state.jobs.get(1)![0]!.steps = [{ name: "Measure baseline then candidate", status: "unknown", conclusion: null }]; }],
  ["duplicate archive", (state: ReturnType<typeof fixture>["state"]) => { state.artifacts.push(artifact(202, 1)); }],
  ["archive without execution", (state: ReturnType<typeof fixture>["state"]) => { state.jobs.set(1, []); }],
  ["archive digest missing", (state: ReturnType<typeof fixture>["state"]) => { delete state.artifacts[0]!.digest; }],
  ["artifact from another run", (state: ReturnType<typeof fixture>["state"]) => { state.artifacts[0]!.workflow_run = { id: 999, head_sha: campaign.candidateRevision }; }],
  ["archive attached to skipped job", (state: ReturnType<typeof fixture>["state"]) => { state.jobs.set(1, [{ ...job(101, 1), conclusion: "skipped", steps: [] }]); }],
] as const) void test(`rejects malformed authenticated evidence: ${name}`, async () => {
  const { state, options } = fixture(); change(state);
  await assert.rejects(collectInventory(campaign, [slot], options));
});

void test("fails closed on truncated pages and masks transport/JSON diagnostics", async () => {
  const response: typeof fetch = async () => new Response(JSON.stringify({ total_count: 2, jobs: [] }), { headers: { "content-type": "application/json" } });
  const { options } = fixture();
  const truncated: typeof fetch = (input, init) => new URL(input instanceof Request ? input.url : input).pathname.endsWith("/jobs")
    ? response(input, init) : options.fetch(input, init);
  await assert.rejects(collectInventory(campaign, [slot], { fetch: truncated, token }), /Truncated inventory page/);
  const failed: typeof fetch = async () => { throw new Error(token); };
  await assert.rejects(collectInventory(campaign, [slot], { fetch: failed, token }), (error: unknown) => error instanceof Error && !error.message.includes(token));
});

function zipped(files: Zippable = { "base-latency.json": strToU8('{"synthetic":true}') }) {
  return Buffer.from(zipSync(files, { level: 0 }));
}
function archive(zip: Buffer): Archive {
  return {
    repository: campaign.repository, runId: campaign.runId, attempt: 1, artifactId: "201",
    name: "scheduling-profile-negotiation-latency-part-0-1", slot,
    digest: `sha256:${digest(zip)}`, size: zip.length, archiveSha256: digest(zip), archiveSize: zip.length,
    expired: false, headSha: campaign.candidateRevision,
    createdAt: "2026-11-03T01:00:00Z", updatedAt: "2026-11-03T01:00:00Z",
  };
}
function zipProvider(zip: Buffer, redirect = true) {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const send: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const auth = new Headers(init?.headers).get("authorization"); calls.push({ url, auth });
    if (url.startsWith("https://api.github.com")) {
      assert.equal(auth, `Bearer ${token}`);
      if (redirect) return new Response(null, { status: 302, headers: { location: "https://synthetic.blob.core.windows.net/artifact?signature=private-capability" } });
    } else assert.equal(auth, null, "GitHub auth must not follow the signed storage URL");
    return new Response(new Uint8Array(zip));
  };
  return { options: { fetch: send, token }, calls };
}
async function disposable(work: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "profile-archive-test-"));
  try { await work(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

void test("downloads exact provider-hashed bytes, extracts with Python stdlib and never forwards auth", async () => {
  await disposable(async (directory) => {
    const zip = Buffer.from(zipSync({ "base-latency.json": strToU8('{"synthetic":true}'), "head.log": strToU8("synthetic") }, { level: 6 }));
    const { options, calls } = zipProvider(zip);
    const dirs = await downloadArchives([archive(zip)], directory, options);
    assert.deepEqual(dirs, [join(directory, archive(zip).name)]);
    assert.equal(await readFile(join(dirs[0]!, "base-latency.json"), "utf8"), '{"synthetic":true}');
    assert.equal(calls.length, 2);
    assert.deepEqual((await readdir(directory)).sort(), [archive(zip).name]);
    await assert.rejects(downloadArchives([archive(zip)], directory, options), /EEXIST/);
    assert.equal(await readFile(join(dirs[0]!, "head.log"), "utf8"), "synthetic");
  });
});

for (const name of ["../outside.json", "nested/inside.json", "/absolute.json", "C:escape.json", "back\\slash.json", "trailing.", "NUL.json"]) {
  void test(`rejects unsafe ZIP member ${name} without retaining partial output`, async () => {
    await disposable(async (directory) => {
      const zip = zipped({ [name]: strToU8("synthetic") });
      await assert.rejects(downloadArchives([archive(zip)], directory, zipProvider(zip).options), /ZIP extraction failed/);
      assert.deepEqual(await readdir(directory), []);
    });
  });
}

void test("rejects ZIP symlinks, case-duplicate members, CRC corruption and excessive declared expansion", async () => {
  const cases = [
    zipped({ link: [strToU8("outside"), { os: 3, attrs: (0o120777 << 16) >>> 0 }] }),
    zipped({ "base.json": strToU8("one"), "BASE.json": strToU8("two") }),
    zipped({ "base.json": strToU8("CRC-CONTENT") }),
    zipped({ "base.json": strToU8("tiny") }),
  ];
  const crcAt = cases[2]!.indexOf("CRC-CONTENT"); assert.ok(crcAt > 0); cases[2]![crcAt] = cases[2]![crcAt]! ^ 1;
  const central = cases[3]!.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); assert.ok(central > 0);
  cases[3]!.writeUInt32LE(1024 * 1024 * 1024, central + 24);
  for (const zip of cases) await disposable(async (directory) => {
    await assert.rejects(downloadArchives([archive(zip)], directory, zipProvider(zip).options), /ZIP extraction failed/);
    assert.deepEqual(await readdir(directory), []);
  });
});

void test("rejects provider hash/size mismatch, expired artifacts and unsafe redirect before extraction", async () => {
  const zip = zipped();
  for (const value of [{ ...archive(zip), digest: `sha256:${"0".repeat(64)}` }, { ...archive(zip), size: zip.length + 1 }, { ...archive(zip), expired: true }]) {
    await disposable(async (directory) => {
      await assert.rejects(downloadArchives([value], directory, zipProvider(zip).options));
      assert.deepEqual(await readdir(directory), []);
    });
  }
  await disposable(async (directory) => {
    const send: typeof fetch = async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    await assert.rejects(downloadArchives([archive(zip)], directory, { fetch: send, token }), /Unsafe artifact download redirect/);
    assert.deepEqual(await readdir(directory), []);
  });
});

void test("does not overwrite a pre-existing artifact directory or follow its files", async () => {
  await disposable(async (directory) => {
    const zip = zipped(), target = join(directory, archive(zip).name);
    await mkdir(target); await writeFile(join(target, "keep.txt"), "independent");
    await assert.rejects(downloadArchives([archive(zip)], directory, zipProvider(zip).options), /EEXIST/);
    assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "independent");
  });
});

void test("caps total declared ZIP bytes before downloads and enforces the cumulative extracted budget", async () => {
  const zip = zipped({ "base.json": strToU8("12345") });
  await disposable(async (directory) => {
    const oversized = Array.from({ length: 9 }, (_, index) => ({
      ...archive(zip), attempt: index + 1, artifactId: String(200 + index),
      size: 512 * 1024 * 1024, archiveSize: 512 * 1024 * 1024,
      name: `scheduling-profile-negotiation-latency-part-0-${index + 1}`,
    }));
    const send: typeof fetch = async () => assert.fail("Oversized declared corpus must not be downloaded");
    await assert.rejects(downloadArchives(oversized, directory, { fetch: send, token }), /corpus exceeds/);
    assert.deepEqual(await readdir(directory), []);
    const first = archive(zip), second = { ...archive(zip), attempt: 2, artifactId: "202", name: "scheduling-profile-negotiation-latency-part-0-2" };
    await assert.rejects(downloadArchives([first, second], directory, {
      ...zipProvider(zip).options, maximumExtractedBytes: 6,
    }), /ZIP extraction failed/);
    assert.deepEqual(await readdir(directory), [first.name]);
    assert.equal(await readFile(join(directory, first.name, "base.json"), "utf8"), "12345");
  });
});
