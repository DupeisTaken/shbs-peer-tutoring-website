import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregatePartitions, loadControlledReferencePaths, loadPartitionInputs, profileMatrix } from "./aggregate-partitions.mjs";
import { loadContentionReferences, CONTENTION_SCENARIOS } from "./contention-references.mjs";
import { selectResumeArtifacts, authorizeArtifactRetry } from "./resume-artifacts.mjs";
import { currentCampaign, setting, workerSlot } from "./resume-campaign.mjs";
import { collectInventory, downloadArchives } from "./resume-inventory.mjs";
import { readReceipt, sealReceipt } from "./resume-receipt.mjs";

/** @typedef {import("./resume-artifacts.mjs").Campaign} Campaign
 * @typedef {import("./resume-artifacts.mjs").Slot} Slot */

/** @param {string} path @param {unknown} value */
const json = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n");

/** @param {Campaign} campaign @param {Slot} slot @param {string} directory */
async function seal(campaign, slot, directory) {
  const spec = campaign.scenarios[slot.scenario];
  assert.ok(spec);
  assert.equal(setting("BASELINE_SHA"), spec.baselineRevision);
  assert.equal(setting("PROFILE_NODE_IMAGE"), campaign.nodeImage);
  assert.equal(setting("PROFILE_ANCHOR"), campaign.anchor);
  assert.equal((await readFile(join(directory, "node-image.txt"), "utf8")).trim(), campaign.nodeImageId);
  const comparison = await readFile(join(directory, "comparison-inputs.json"));
  assert.equal(createHash("sha256").update(comparison).digest("hex"), spec.comparisonSha256, "Worker comparison differs from matrix declaration");
  const { scenarios: _controls, currentAttempt, ...binding } = campaign;
  await sealReceipt(directory, { version: 1, ...binding, attempt: currentAttempt, slot,
    baselineRevision: spec.baselineRevision, comparisonSha256: spec.comparisonSha256 });
}

/** Stage verified archive bytes by hard link in a fresh directory. Raw attempts
 * (including failures) remain separate. Recheck GitHub after canonical validation.
 * @param {"authorize"|"references"|"aggregate"} command @param {Campaign} campaign */
async function verify(command, campaign) {
  const all = profileMatrix("all").include;
  const slots = command === "aggregate" ? all : command === "authorize" ? [workerSlot()] :
    all.filter((slot) => Object.values(CONTENTION_SCENARIOS).some((scenario) => scenario === slot.scenario) && slot.mode === "diagnostic");
  const temp = await mkdtemp(join(setting("RUNNER_TEMP"), "profile-resume-"));
  const raw = join(temp, "raw");
  await mkdir(raw);
  const snapshot = await collectInventory(campaign, slots);
  if (command === "aggregate")
    await json("outputs/scheduling-profile-selection.json", { state: "CHECKING", campaign, ...snapshot });
  await downloadArchives(snapshot.archives, raw);
  const artifacts = [];
  for (const archive of snapshot.archives) artifacts.push(await readReceipt(join(raw, archive.name), archive));
  const inventory = { campaign, executions: snapshot.executions, artifacts };
  const recheck = async () => assert.deepEqual(await collectInventory(campaign, slots), snapshot, "GitHub execution history changed during verification");
  if (command === "authorize") {
    const authorization = authorizeArtifactRetry({ ...inventory, slot: workerSlot() });
    await recheck();
    await mkdir("outputs/scheduling-profile", { recursive: true });
    await json("outputs/scheduling-profile/retry-authorization.json", authorization);
    return;
  }
  const selection = selectResumeArtifacts({ ...inventory, requiredSlots: slots });
  const selected = join(temp, "selected");
  await mkdir(selected);
  for (const receipt of selection.selected) {
    assert.ok(receipt.name && receipt.files);
    const directory = join(selected, receipt.name);
    await mkdir(directory);
    for (const filename of Object.keys(receipt.files)) {
      assert.ok(!filename.includes("/"), "Unexpected nested partition evidence");
      await link(join(raw, receipt.name, filename), join(directory, filename));
    }
  }
  const names = new Set(selection.selected.map((entry) => { assert.ok(entry.name); return entry.name; }));
  const paths = loadControlledReferencePaths(selected, names);
  const expectedBaseline = campaign.scenarios.contention?.baselineRevision;
  assert.ok(expectedBaseline);
  const references = loadContentionReferences(paths, { expectedBaseline, expectedCandidate: campaign.candidateRevision });
  if (command === "references") {
    await recheck();
    for (const [order, pair] of Object.entries(paths)) {
      const target = resolve("outputs/contention-references", order);
      await mkdir(target, { recursive: true });
      for (const [file, path] of Object.entries({ "base-diagnostic.json": pair.baselinePath,
        "head-diagnostic.json": pair.candidatePath, "node-image.txt": pair.nodeImagePath, "comparison-inputs.json": pair.comparisonPath })) {
        // RUNNER_TEMP and workspace can be mounted separately.
        await writeFile(join(target, file), await readFile(path), { flag: "wx" });
      }
    }
    return;
  }
  const result = aggregatePartitions(loadPartitionInputs(selected), { baseline: expectedBaseline,
    candidate: campaign.candidateRevision, contentionReferences: references,
    ...(process.env.CATALOG_SELECTION_SOURCE === "reviewed-pr-catalog-baseline-file" ? { catalogBaseline: setting("CATALOG_BASELINE_SHA") } : {}) });
  await recheck();
  await json("outputs/scheduling-profile-selection.json", { ...selection, campaign });
  await json("outputs/scheduling-profile-aggregate.json", result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === "aggregate") await mkdir("outputs", { recursive: true });
    const campaign = currentCampaign();
    if (command === "seal") await seal(campaign, workerSlot(), "outputs/scheduling-profile");
    else {
      assert.ok(command === "authorize" || command === "references" || command === "aggregate", "Unknown resume command");
      await verify(command, campaign);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1200) : "Invalid scheduling profile evidence";
    if (command === "aggregate") await json("outputs/scheduling-profile-aggregate.json",
      { status: "FAIL", samplingComplete: false, latencyComparisonEligible: false, error: message });
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  }
}
