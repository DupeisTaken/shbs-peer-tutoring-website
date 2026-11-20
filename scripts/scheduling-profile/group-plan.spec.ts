// Orchestration specs run only in root CI: measured baseline helpers use the
// *.test.ts glob and intentionally retain their original workflow/assets.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yamlModule from "js-yaml";
import { profileMatrix } from "./aggregate-partitions.mjs";
import { groupSlots, partitionStepName, prepareStepName, profileGroups } from "./group-plan.mjs";
import { renderWorker, workerDefinition } from "./generate-workflow.mjs";

const yaml = yamlModule as { load(source: string): unknown };

void test("scenario groups preserve every original partition once without changing sample counts", () => {
  assert.deepEqual(profileGroups(), ["cold", "warm", "sunday", "negotiation", "allocation", "catalog", "contention", "backlog"]);
  const grouped = ["preflight", ...profileGroups()].flatMap(groupSlots);
  assert.deepEqual(grouped.map((slot) => JSON.stringify(slot)).sort(),
    profileMatrix("all").include.map((slot) => JSON.stringify(slot)).sort());
  assert.equal(grouped.length, 70);
  assert.deepEqual(["preflight", ...profileGroups()].map((group) => groupSlots(group).length), [5, 6, 11, 6, 10, 10, 10, 11, 1]);
  for (const group of ["", "all", "diagnostic", "../warm"]) assert.throws(() => groupSlots(group));
  const copy = profileGroups();
  copy.pop();
  assert.equal(profileGroups().length, 8, "callers cannot mutate the group declaration");
});

void test("generated worker journals preparation and execution separately for every serial slot", () => {
  const workflow = workerDefinition();
  assert.equal(workflow.jobs.measure["timeout-minutes"], 120);
  const steps = workflow.jobs.measure.steps;
  for (const group of ["preflight", ...profileGroups()]) for (const slot of groupSlots(group)) {
    const prepare = steps.find((step) => step.name === prepareStepName(slot));
    const partition = steps.find((step) => step.name === partitionStepName(slot));
    assert.ok(prepare && partition);
    assert.equal(steps.indexOf(partition), steps.indexOf(prepare) + 1);
    assert.equal(prepare.run, "node scripts/scheduling-profile/resume-run.mjs prepare");
    assert.equal(prepare["timeout-minutes"], 9);
    assert.equal(prepare.if, `\${{ !cancelled() && inputs.group == '${group}' }}`);
    assert.ok(partition.if?.includes(`steps.${prepare.id}.outputs.should_run == 'true'`));
    assert.equal(partition.uses, "./.github/actions/scheduling-profile-partition");
    assert.equal(partition["timeout-minutes"], 9);
    assert.deepEqual(partition.env, prepare.env);
    assert.equal(partition.env?.PROFILE_SAMPLES, slot.samples);
    assert.equal(partition.env?.PROFILE_PARTITION_COUNT, slot.partitionCount);
    if (slot.scenario === "catalog") assert.equal(partition.env?.BASELINE_SHA, "${{ inputs.catalog-baseline }}");
  }
  assert.equal(steps.filter((step) => step.name.startsWith("partition (")).length, 70);
  assert.equal(steps.filter((step) => step.name.startsWith("prepare (")).length, 70);
});

void test("checked-in workflow is the generated serial group plan", () => {
  const bytes = readFileSync(new URL("../../.github/workflows/scheduling-profile-worker.yml", import.meta.url), "utf8");
  assert.equal(bytes.replaceAll("\r\n", "\n"), renderWorker());
  const parent = yaml.load(readFileSync(new URL("../../.github/workflows/scheduling-profile.yml", import.meta.url), "utf8")) as {
    jobs: { preflight: { strategy?: unknown; with: { group: string } }; profile: { strategy: { matrix: { group: string[] }; "max-parallel": number } } };
  };
  assert.equal(parent.jobs.preflight.with.group, "preflight");
  assert.equal(parent.jobs.preflight.strategy, undefined);
  assert.deepEqual(parent.jobs.profile.strategy.matrix.group, profileGroups());
  assert.equal(parent.jobs.profile.strategy["max-parallel"], 4);
});

void test("each partition owns pristine checkouts, a fresh job database and original bounded resource limits", () => {
  const action = yaml.load(readFileSync(new URL("../../.github/actions/scheduling-profile-partition/action.yml", import.meta.url), "utf8")) as {
    runs: { using: string; steps: Array<{ name: string; run?: string; shell?: string; uses?: string; with?: Record<string, unknown> }> };
  };
  assert.equal(action.runs.using, "composite");
  const steps = action.runs.steps;
  const checkout = steps.filter((step) => step.uses === "actions/checkout@v4");
  assert.deepEqual(checkout.map((step) => step.with?.path), ["profile-head", "profile-base"]);
  for (const step of checkout) {
    assert.equal(step.with?.clean, true);
    assert.equal(step.with?.["persist-credentials"], false);
  }
  const reset = steps.find((step) => step.name === "Reset only this job-owned partition database");
  assert.match(reset?.run ?? "", /timeout 30 docker exec "\$POSTGRES_CONTAINER_ID"/);
  assert.match(reset?.run ?? "", /DROP DATABASE IF EXISTS shbs_performance_test WITH \(FORCE\)/);
  assert.match(reset?.run ?? "", /CREATE DATABASE shbs_performance_test TEMPLATE template0 ENCODING 'UTF8'/);
  const measurement = steps.find((step) => step.name === "Measure baseline then candidate");
  assert.ok(reset && measurement && steps.indexOf(reset) < steps.indexOf(measurement));
  assert.match(measurement.run ?? "", /for revision in base head; do/);
  assert.match(measurement.run ?? "", /docker run --rm --cpus=2 --memory=4g/);
  assert.match(steps[0]?.run ?? "", /date \+%s\) \+ 420/);
  for (const step of steps.filter((step) => step.run)) assert.equal(step.shell, "bash");
  const upload = steps.find((step) => step.uses === "actions/upload-artifact@v4");
  assert.equal(upload?.with?.["retention-days"], 7);
});

void test("partition cleanup restores only owned checkout trees after evidence upload without following links", () => {
  const action = yaml.load(readFileSync(new URL("../../.github/actions/scheduling-profile-partition/action.yml", import.meta.url), "utf8")) as {
    runs: { steps: Array<{ name: string; run?: string; if?: string; uses?: string }> };
  };
  const steps = action.runs.steps;
  const upload = steps.findIndex((step) => step.uses === "actions/upload-artifact@v4");
  const cleanup = steps.findIndex((step) => step.name === "Restore ownership of only the partition checkout trees");
  assert.ok(cleanup > upload && upload >= 0);
  assert.equal(steps[cleanup]?.if, "always()");
  const script = steps[cleanup]?.run ?? "";
  assert.match(script, /realpath -e -- "\$GITHUB_WORKSPACE"/);
  assert.match(script, /for relative in profile-head profile-base; do/);
  assert.match(script, /\[\[ -d "\$target" && ! -L "\$target" \]\]/);
  assert.match(script, /realpath -e -- "\$target"\)" == "\$target"/);
  assert.match(script, /timeout 30 sudo chown -R -P --no-dereference "\$owner" -- "\$target"/);
  assert.doesNotMatch(script, /rm |chmod|chown.*"\$workspace"/);
});
