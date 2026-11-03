import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateClockAdmission } from "./clock-admission.mjs";
import { profileMatrix } from "./aggregate-partitions.mjs";

/** @param {string} name */
export function setting(name) {
  const value = process.env[name];
  assert.ok(value, `Missing ${name}`);
  return value;
}

/** @param {string} cwd */
const revision = (cwd) => execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();

/** GitHub preserves the declaration job's outputs on a failed-jobs rerun.
 * Each baseline is independently inspected before any partition is measured. */
export function freezeCampaign() {
  const selected = JSON.parse(setting("SELECTION"));
  const candidateRevision = setting("CANDIDATE_SHA");
  assert.equal(revision("."), candidateRevision);
  const inspect = (/** @type {boolean} */ catalog) => {
    const root = catalog && selected.catalogBaseline !== selected.baseline ? ".profile-catalog" : ".profile-baseline";
    const baselineRevision = catalog ? selected.catalogBaseline : selected.baseline;
    const prefix = catalog ? "catalogBaselineSelection" : "baselineSelection";
    assert.equal(revision(root), baselineRevision);
    const receipt = resolve(setting("RUNNER_TEMP"), catalog ? "catalog-inputs.json" : "baseline-inputs.json");
    execFileSync(process.execPath, ["scripts/scheduling-profile/comparison-inputs.mjs", root, ".", receipt,
      ...(selected.manifest ? ["inspect", resolve(selected.manifest)] : [])], { env: {
      ...process.env,
      PROFILE_BASELINE_SELECTION_PATH: selected[prefix + "Path"],
      PROFILE_BASELINE_SELECTION_FILE_SHA256: selected[prefix + "FileSha256"],
      PROFILE_BASELINE_SELECTION_SOURCE: selected[prefix + "Source"],
    } });
    const bytes = readFileSync(receipt);
    return { control: { baselineRevision, comparisonSha256: createHash("sha256").update(bytes).digest("hex"),
      requiresNativeSchemaControl: JSON.parse(bytes.toString()).requiresNativeSchemaControl }, receipt: JSON.parse(bytes.toString()) };
  };
  const common = inspect(false), catalog = inspect(true);
  const campaignAttempt = Number(setting("GITHUB_RUN_ATTEMPT"));
  const nodeImage = setting("PROFILE_NODE_IMAGE"), postgresImage = setting("PROFILE_POSTGRES_IMAGE");
  const nodeImageId = setting("PROFILE_NODE_IMAGE_ID");
  assert.match(nodeImageId, /^sha256:[a-f0-9]{64}$/);
  assert.match(nodeImage, /^node@sha256:[a-f0-9]{64}$/);
  assert.match(postgresImage, /^postgres@sha256:[a-f0-9]{64}$/);
  const clock = JSON.parse(readFileSync("clock-admission.json", "utf8"));
  assert.equal(clock.status, "ADMITTED");
  assert.ok(clock.clockAdmission, "Missing clock declaration");
  validateClockAdmission({ anchor: clock.anchor, startedAt: clock.anchor, finishedAt: clock.anchor }, clock.clockAdmission);
  assert.equal(clock.revision, candidateRevision);
  assert.equal(clock.run, setting("GITHUB_RUN_ID"));
  assert.equal(Number(clock.attempt), campaignAttempt);
  return { repository: setting("GITHUB_REPOSITORY"), runId: clock.run, workflowSha: setting("GITHUB_WORKFLOW_SHA"),
    campaignAttempt, currentAttempt: campaignAttempt, candidateRevision, anchor: clock.anchor, clockAdmission: clock.clockAdmission, nodeImage, nodeImageId, postgresImage,
    candidateSchemaSha256: common.receipt.candidateSchemaSha256, dependencyLockSha256: common.receipt.candidateLockfileSha256,
    reportSchemaVersion: 3, partitionProtocolVersion: 1,
    scenarios: Object.fromEntries(profileMatrix("all").include.map(({ scenario }) =>
      [scenario, scenario === "catalog" ? catalog.control : common.control])) };
}

export function currentCampaign() {
  const campaign = JSON.parse(setting("PROFILE_CAMPAIGN"));
  assert.equal(campaign.repository, setting("GITHUB_REPOSITORY"));
  assert.equal(campaign.runId, setting("GITHUB_RUN_ID"));
  assert.equal(campaign.workflowSha, setting("GITHUB_WORKFLOW_SHA"));
  assert.equal(campaign.candidateRevision, setting("CANDIDATE_SHA"));
  assert.equal(revision("."), campaign.candidateRevision);
  const currentAttempt = Number(setting("GITHUB_RUN_ATTEMPT"));
  assert.ok(Number.isSafeInteger(currentAttempt) && currentAttempt >= campaign.campaignAttempt);
  return { ...campaign, currentAttempt };
}

export function workerSlot() {
  const slot = profileMatrix("all").include.find(({ scenario, mode, partition }) =>
    scenario === setting("PROFILE_SCENARIO") && mode === setting("PROFILE_MODE") && partition === Number(setting("PROFILE_PARTITION_INDEX")));
  assert.ok(slot, "Slot is absent from the declared population");
  assert.equal(slot.partitionCount, Number(setting("PROFILE_PARTITION_COUNT")));
  assert.equal(slot.samples, Number(setting("PROFILE_SAMPLES")));
  return slot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write("campaign=" + JSON.stringify(freezeCampaign()) + "\n");
}
