import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zipSync } from "fflate";
import { profileMatrix } from "./aggregate-partitions.mjs";

void test("worker CLI seals a failed arm, authenticates the next attempt, and refuses a newer failure without an archive", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "profile-resume-worker-"));
  const directory = join(cwd, "outputs/scheduling-profile");
  const script = fileURLToPath(new URL("./resume-run.mjs", import.meta.url));
  const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  try {
    await mkdir(directory, { recursive: true });
    const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    git("init", "--quiet");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "commit", "--quiet", "--allow-empty", "-m", "synthetic");
    const candidate = git("rev-parse", "HEAD"), comparison = "synthetic immutable comparison";
    const control = { baselineRevision: "b".repeat(40), comparisonSha256: hash(comparison), requiresNativeSchemaControl: false };
    const campaign = { repository: "synthetic/profile", runId: "123", workflowSha: "a".repeat(40), candidateRevision: candidate,
      anchor: "2026-11-03T12:02:12.645Z", campaignAttempt: 1, currentAttempt: 1,
      nodeImage: "node@sha256:" + "1".repeat(64), nodeImageId: "sha256:" + "2".repeat(64), postgresImage: "postgres@sha256:" + "3".repeat(64),
      candidateSchemaSha256: hash("schema"), dependencyLockSha256: hash("lock"), reportSchemaVersion: 3, partitionProtocolVersion: 1,
      scenarios: Object.fromEntries(profileMatrix().include.map(({ scenario }) => [scenario, control])) };
    const status = { schemaVersion: 1, status: "FAIL", exitCode: 1, lastPhase: "dependency-install", firstFailedBootstrapAttempt: null };
    const phase = { phase: "dependency-install", attempt: 1, startedAtEpochSeconds: 1793707400, budgetSeconds: 90 };
    const events = [
      { ...phase, event: "start", finishedAtEpochSeconds: phase.startedAtEpochSeconds, elapsedSeconds: 0, exitCode: null },
      { ...phase, event: "finish", finishedAtEpochSeconds: phase.startedAtEpochSeconds + 1, elapsedSeconds: 1, exitCode: 1 },
    ];
    for (const [name, value] of Object.entries({ "comparison-inputs.json": comparison, "anchor.txt": campaign.anchor + "\n",
      "node-image.txt": campaign.nodeImageId + "\n", "base-phase-status.json": JSON.stringify(status),
      "base-command-exit.json": JSON.stringify(status), "base-phase-events.jsonl": events.map(row=>JSON.stringify(row)).join("\n") + "\n" }))
      await writeFile(join(directory, name), value);
    const env = { ...process.env, GH_TOKEN: "synthetic", RUNNER_TEMP: cwd, GITHUB_RUN_ID: campaign.runId, GITHUB_WORKFLOW_SHA: campaign.workflowSha,
      GITHUB_REPOSITORY: campaign.repository, PROFILE_CAMPAIGN: JSON.stringify(campaign), GITHUB_RUN_ATTEMPT: "1", CANDIDATE_SHA: candidate,
      PROFILE_MODE: "latency", PROFILE_SCENARIO: "warm", PROFILE_SAMPLES: "40", PROFILE_PARTITION_INDEX: "0", PROFILE_PARTITION_COUNT: "10",
      BASELINE_SHA: control.baselineRevision, PROFILE_NODE_IMAGE: campaign.nodeImage, PROFILE_ANCHOR: campaign.anchor };
    const run = (args: string[], attempt = 1) => execFileSync(process.execPath, args, {
      cwd, env: { ...env, GITHUB_RUN_ATTEMPT: String(attempt) }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    run([script, "seal"]);
    const zipped = zipSync(Object.fromEntries(await Promise.all((await readdir(directory)).map(async name =>
      [name, await readFile(join(directory, name))] as const))));
    await writeFile(join(cwd, "fixture.zip"), zipped);
    const name = "profile (warm, latency, 0, 10, 40) / measure";
    const prior = { id: 201, run_id: 123, run_attempt: 1, head_sha: candidate, name, status: "completed", conclusion: "failure",
      steps: [{ name: "Measure baseline then candidate", status: "completed", conclusion: "failure" }] };
    const current = { ...prior, id: 202, run_attempt: 2, status: "in_progress", conclusion: null, steps: [] };
    const runState = { id: 123, repository: { full_name: campaign.repository }, head_sha: candidate, run_attempt: 2,
      event: "pull_request", path: ".github/workflows/scheduling-profile.yml" };
    const archives = [{ id: 401, name: "scheduling-profile-warm-latency-part-0-1", size_in_bytes: zipped.length, digest: "sha256:" + hash(zipped),
      expired: false, workflow_run: { id: 123, head_sha: candidate }, created_at: campaign.anchor, updated_at: campaign.anchor }];
    const responses: Record<string, unknown> = { "runs/123": runState, "runs/123/attempts/1/jobs": { jobs: [prior], total_count: 1 },
      "runs/123/attempts/2/jobs": { jobs: [current], total_count: 1 }, "runs/123/artifacts": { artifacts: archives, total_count: 1 } };
    responses["runs/123/attempts/1"] = { ...runState, run_attempt: 1, run_started_at: "2026-11-03T12:02:00Z" };
    responses["runs/123/attempts/2"] = { ...runState, run_attempt: 2, run_started_at: "2026-11-03T12:07:00Z" };
    const mock = join(cwd, "provider.mjs");
    await writeFile(mock, `
      import { readFileSync } from "node:fs";
      const fixtures = JSON.parse(readFileSync("provider.json", "utf8"));
      globalThis.fetch = async url => {
        const key = new URL(url).pathname.split("/actions/")[1];
        if (key === "artifacts/401/zip") return new Response(readFileSync("fixture.zip"));
        if (!Object.hasOwn(fixtures, key)) throw new Error("Unexpected fixture request");
        return Response.json(fixtures[key]);
      };
    `);
    const authorize = ["--import", pathToFileURL(mock).href, script, "authorize"];
    await writeFile(join(cwd, "provider.json"), JSON.stringify(responses));
    run(authorize, 2);
    const receipt = await readFile(join(directory, "retry-authorization.json"), "utf8");
    const authorization = JSON.parse(receipt) as { state: string };
    assert.equal(authorization.state, "AUTHORIZED_REMEASURE_PAIRED_ARMS");
    responses["runs/123/attempts/2/jobs"] = { jobs: [{ ...prior, id: 202, run_attempt: 2 }], total_count: 1 };
    await writeFile(join(cwd, "provider.json"), JSON.stringify(responses));
    assert.throws(() => run(authorize, 2));
    assert.equal(await readFile(join(directory, "retry-authorization.json"), "utf8"), receipt);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
