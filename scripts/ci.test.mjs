import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import yaml from "js-yaml";
import { publishImage } from "./ci-publish.mjs";
import { profileMatrix } from "./scheduling-profile/aggregate-partitions.mjs";
import { groupSlots, profileGroups } from "./scheduling-profile/group-plan.mjs";
import { renderWorker } from "./scheduling-profile/generate-workflow.mjs";
import {
  isAllowedHelpTarEntry,
  unpackHelpAssets,
  unpackHelpAssetsWithFallback,
  validateTarListing,
  verifyArchiveChecksum,
  verifyExtractedCaptures,
} from "./unpack-help-assets.mjs";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";

const root = path.resolve(import.meta.dirname, "..");
const workflow = yaml.load(
  readFileSync(path.join(root, ".github/workflows/docker-build.yml"), "utf8"),
);
const { checks, tests, image, verify, publish } = workflow.jobs;

test("typed lint has a bounded step-only heap without weakening the full check", () => {
  const staticSteps = checks.steps.filter(
    (step) => step.name === "Generate route types, lint and type-check",
  );
  assert.equal(staticSteps.length, 1);
  const [staticStep] = staticSteps;
  assert.equal(staticStep.run, "npm run check");
  assert.deepEqual(staticStep.env, {
    NODE_OPTIONS: "--max-old-space-size=6144",
  });
  assert.equal(staticStep.if, undefined);
  assert.equal(staticStep["continue-on-error"], undefined);
  assert.equal(checks["continue-on-error"], undefined);
  const packageJson = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts.check,
    "next typegen && eslint . --max-warnings=0 && tsc --noEmit",
  );
  assert.equal(workflow.env?.NODE_OPTIONS, undefined);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.env?.NODE_OPTIONS, undefined, `${name} job heap scope`);
    for (const step of job.steps) {
      if (step === staticStep) continue;
      assert.equal(
        step.env?.NODE_OPTIONS,
        undefined,
        `${name}: ${step.name} heap scope`,
      );
    }
  }
});

test("the stable verify gate rejects failure, cancellation, skips and missing jobs", () => {
  assert.deepEqual(verify.needs, ["checks", "tests", "image", "image-storage"]);
  assert.equal(verify.if, "${{ always() }}");
  const gate = verify.steps[0];
  assert.equal(gate.env.NEEDS_JSON, "${{ toJSON(needs) }}");
  // Execute the actual gate for every combination, including a missing dependency.
  const states = ["success", "failure", "cancelled", "skipped", undefined];
  for (const checkResult of states)
    for (const testResult of states)
      for (const imageResult of states) {
        for (const storageResult of states) {
          const results = Object.fromEntries(
            [checkResult, testResult, imageResult, storageResult].flatMap(
              (result, index) =>
                result ? [[verify.needs[index], { result }]] : [],
            ),
          );
          const failures = [];
          vm.runInNewContext(gate.with.script, {
            process: { env: { NEEDS_JSON: JSON.stringify(results) } },
            core: { setFailed: (message) => failures.push(message) },
          });
          assert.equal(
            failures.length,
            [checkResult, testResult, imageResult, storageResult].filter(
              (result) => result !== "success",
            ).length,
          );
        }
      }
});

test("packaging comparison follows image verification and runs only for relevant changes", () => {
  const storage = workflow.jobs["image-storage"];
  assert.equal(storage.needs, "image");
  assert.equal(
    storage.env.STORAGE_BASE_REF,
    "${{ inputs.storage-baseline || github.event.pull_request.base.sha || github.event.before }}",
  );
  assert.equal(storage.steps[0].with["fetch-depth"], 0);
  assert.equal(
    workflow.on.workflow_dispatch.inputs["storage-baseline"].required,
    false,
  );
  const scope = storage.steps.find((step) => step.id === "scope");
  assert.equal(scope.run, "node scripts/compare-runtime-images.mjs scope");
  const comparison = storage.steps.find(
    (step) =>
      step.name ===
      "Compare identical runtime files and retained image layouts",
  );
  assert.equal(comparison.if, "steps.scope.outputs.compare == 'true'");
  assert.match(comparison.run, /\$RUNNER_TEMP\/runtime-storage-comparison/);
  const graphTools = storage.steps.find((step) => step.name === "Install locked source-graph inspection tools");
  assert.equal(graphTools.if, "steps.scope.outputs.compare == 'true'");
  assert.equal(graphTools.run, "npm ci --ignore-scripts");
  assert.ok(storage.steps.indexOf(graphTools) > storage.steps.indexOf(scope));
  assert.ok(storage.steps.indexOf(graphTools) < storage.steps.indexOf(comparison));
  const evidence = storage.steps.find(
    (step) => step.uses === "actions/upload-artifact@v4",
  );
  assert.equal(evidence.with["retention-days"], 7);
  assert.ok(
    checks.steps.some(
      (step) => step.run === "python3 scripts/test_image_storage_metrics.py",
    ),
  );
});

test("inline comparison builds receive masked runtime cache authentication", () => {
  const step = workflow.jobs["image-storage"].steps.find(
    (item) =>
      item.name === "Expose cache authentication to the comparison build",
  );
  assert.equal(step.if, "steps.scope.outputs.compare == 'true'");
  assert.equal(step.uses, "actions/github-script@v7");
  const env = {
    ACTIONS_RUNTIME_TOKEN: "synthetic-test-token",
    ACTIONS_RESULTS_URL: "https://example.invalid/cache",
    ACTIONS_CACHE_SERVICE_V2: "true",
  };
  const exported = {};
  const masked = [];
  vm.runInNewContext(step.with.script, {
    process: { env },
    core: {
      setSecret: (value) => masked.push(value),
      exportVariable: (name, value) => {
        exported[name] = value;
      },
    },
  });
  assert.deepEqual(exported, env);
  assert.deepEqual(masked, [env.ACTIONS_RUNTIME_TOKEN]);
  assert.throws(() =>
    vm.runInNewContext(step.with.script, { process: { env: {} } }),
  );
});

test("parallel jobs retain checks, isolated databases, bounded workers and failure reports", () => {
  for (const job of [checks, tests]) assert.equal(job.needs, undefined);
  assert.equal(image.needs, "checks");
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job["timeout-minutes"], job === verify ? 2 : 30);
    for (const step of job.steps) assert.ok(step.name);
  }
  for (const command of [
    "npm ci",
    "npm run check",
    "npm run docs:check",
    "npm run test:ci",
    "npm run test:lint-glob",
    "npm run test:pr-size",
    "npm run test:deployment",
    "npm run test:recovery",
    "npm audit",
  ]) {
    assert.ok(
      checks.steps.some((step) => step.run === command),
      command,
    );
  }
  // Pin the measured capacity and contiguous IDs; coverage below exercises the
  // actual installed Vitest sequencer for every matrix entry, without fixtures.
  assert.deepEqual(tests.strategy.matrix.shard, [1, 2, 3]);
  assert.equal(
    tests.name,
    "tests (${{ matrix.shard }}/${{ strategy.job-total }})",
  );
  assert.equal(tests.strategy["fail-fast"], false);
  assert.equal(tests.services.postgres.env.POSTGRES_DB, "shbs_shipping_test");
  assert.equal(image.services.postgres.env.POSTGRES_DB, "shbs_boot_test");
  assert.match(tests.env.DATABASE_URL, /localhost:5432\/shbs_shipping_test$/);
  assert.match(image.env.DATABASE_URL, /localhost:5432\/shbs_boot_test$/);
  assert.ok(tests.steps.some((step) => step.run === "npm run db:migrate"));
  assert.ok(
    tests.steps.some(
      (step) =>
        step.run?.includes("prisma migrate diff") &&
        step.run.includes("--exit-code"),
    ),
  );
  const run = tests.steps.find((step) => step.name === "Run test shard").run;
  assert.ok(
    run.includes(
      "--shard=${{ matrix.shard }}/${{ strategy.job-total }} --maxWorkers=1",
    ),
    "the shard denominator must follow the actual matrix size",
  );
  assert.match(
    run,
    /--reporter=json --outputFile.json=\.validation\/test-results.json/,
  );
  const report = tests.steps.find(
    (step) => step.uses === "actions/upload-artifact@v4",
  );
  assert.equal(report.if, "${{ !cancelled() }}");
  assert.equal(report.with["include-hidden-files"], true);
  assert.equal(report.with.path, ".validation/test-results.json");
});

function matrixSize(matrix) {
  if (!matrix) return 1;
  // Resolve dynamic matrices from their real generator before counting them.
  // Reject unfamiliar shapes instead of silently treating new fanout as one job.
  assert.equal(typeof matrix, "object");
  if (Object.hasOwn(matrix, "include")) {
    assert.deepEqual(Object.keys(matrix), ["include"]);
    return matrix.include.length;
  }
  if (Object.hasOwn(matrix, "group")) {
    assert.deepEqual(Object.keys(matrix), ["group"]);
    return matrix.group.length;
  }
  assert.deepEqual(Object.keys(matrix), ["shard"]);
  return matrix.shard.length;
}

function peakRunnerSlots(workflowJobs) {
  const jobs = Object.entries(workflowJobs);
  const ancestors = (id) => {
    const needs = workflowJobs[id].needs ?? [];
    return new Set(
      [needs].flat().flatMap((parent) => [parent, ...ancestors(parent)]),
    );
  };
  const dependencies = new Map(jobs.map(([id]) => [id, ancestors(id)]));
  let peak = 0;
  // Any concurrently running jobs form an antichain in the dependency graph.
  // Count matrix slots, not just job definitions; include verify and publish.
  for (let mask = 1; mask < 2 ** jobs.length; mask++) {
    const simultaneous = jobs.filter((_, index) => mask & (1 << index));
    if (
      simultaneous.some(([id]) =>
        simultaneous.some(([other]) => dependencies.get(id).has(other)),
      )
    )
      continue;
    const slots = simultaneous.reduce((total, [, job]) => {
      const matrix = job.strategy?.matrix;
      return (
        total +
        Math.min(matrixSize(matrix), job.strategy?.["max-parallel"] ?? Infinity)
      );
    }, 0);
    peak = Math.max(peak, slots);
  }
  return peak;
}

test("PR capacity includes every automatic workflow and the full profile population", () => {
  const directory = path.join(root, ".github/workflows");
  const automatic = Object.fromEntries(
    readdirSync(directory)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .map((name) => [
        name,
        yaml.load(readFileSync(path.join(directory, name), "utf8")),
      ])
      .filter(([, definition]) => {
        const events = typeof definition.on === "object" && !Array.isArray(definition.on)
          ? Object.keys(definition.on) : [definition.on].flat();
        return events.some((event) => ["pull_request", "pull_request_target"].includes(event));
      }),
  );
  assert.deepEqual(
    Object.keys(automatic),
    [
      "docker-build.yml",
      "pr-size.yml",
      "production-network-observation.yml",
      "recovery-rehearsal.yml",
      "scheduling-profile.yml",
    ],
    "new automatic workflows need an explicit capacity review",
  );

  const profile = automatic["scheduling-profile.yml"];
  assert.deepEqual(profile.jobs.profile.strategy.matrix, { group: profileGroups() });
  assert.equal(profile.jobs.profile.strategy["max-parallel"], 4,
    "each PR has four additional scheduling benchmark slots, independent of core CI");
  assert.equal(profile.jobs.preflight.strategy, undefined);
  const population = profileMatrix().include;
  assert.equal(population.filter((row) => row.mode === "latency").length, 60);
  assert.equal(
    population.filter((row) => row.mode === "diagnostic").length,
    10,
  );
  assert.equal(groupSlots("preflight").length, 5);
  assert.equal(profileGroups().length, 8);
  assert.deepEqual(
    ["preflight", ...profileGroups()].flatMap(groupSlots)
      .map((row) => JSON.stringify(row))
      .sort(),
    population.map((row) => JSON.stringify(row)).sort(),
    "preflight and remaining jobs must cover the complete population exactly once",
  );

  // Each reusable group currently occupies exactly one runner. A worker
  // workflow that adds jobs must also update the capacity calculation.
  const workerPath = "./.github/workflows/scheduling-profile-worker.yml";
  const worker = yaml.load(readFileSync(path.join(root, workerPath), "utf8"));
  assert.equal(readFileSync(path.join(root, workerPath), "utf8").replaceAll("\r\n", "\n"), renderWorker(),
    "the checked-in worker must match the complete generated serial plan");
  assert.deepEqual(Object.keys(worker.jobs), ["measure"]);
  assert.ok(worker.jobs.measure["runs-on"]);
  assert.equal(worker.jobs.measure.strategy, undefined);
  for (const id of ["preflight", "profile"])
    assert.equal(profile.jobs[id].uses, workerPath);

  const counts = Object.fromEntries(
    Object.entries(automatic).map(([name, definition]) => {
      return [
        name,
        {
          displayed: Object.values(definition.jobs).reduce(
            (total, job) =>
              total + matrixSize(job.strategy?.matrix),
            0,
          ),
          peak: peakRunnerSlots(definition.jobs),
        },
      ];
    }),
  );
  assert.deepEqual(counts, {
    "docker-build.yml": { displayed: 8, peak: 4 },
    "pr-size.yml": { displayed: 1, peak: 1 },
    "production-network-observation.yml": { displayed: 1, peak: 1 },
    "recovery-rehearsal.yml": { displayed: 1, peak: 1 },
    "scheduling-profile.yml": { displayed: 11, peak: 4 },
  });
  const scenarios = [
    ["docker-build.yml", "pr-size.yml"],
    ["docker-build.yml", "pr-size.yml", "scheduling-profile.yml"],
    [
      "docker-build.yml",
      "pr-size.yml",
      "scheduling-profile.yml",
      "recovery-rehearsal.yml",
    ],
    Object.keys(automatic),
  ].map((names) =>
    names.reduce(
      (total, name) => ({
        displayed: total.displayed + counts[name].displayed,
        peak: total.peak + counts[name].peak,
      }),
      { displayed: 0, peak: 0 },
    ),
  );
  assert.deepEqual(scenarios, [
    { displayed: 9, peak: 5 },
    { displayed: 20, peak: 9 },
    { displayed: 21, peak: 10 },
    { displayed: 22, peak: 11 },
  ]);
  assert.equal(
    4 * scenarios[0].peak,
    20,
    "four core-only PR runs fit the planning budget",
  );
  assert.ok(3 * scenarios[1].peak > 20, "three profiled PR runs can queue");
});

test("shards run after local setup without retries or dropped coverage", () => {
  assert.equal(tests["continue-on-error"], undefined);
  assert.equal(tests.strategy["max-parallel"], 3);
  const runIndex = tests.steps.findIndex(
    (step) => step.name === "Run test shard",
  );
  for (const command of ["npm ci", "npm run db:migrate"]) {
    const setupIndex = tests.steps.findIndex((step) => step.run === command);
    assert.ok(setupIndex >= 0 && setupIndex < runIndex, command);
  }
  const run = tests.steps[runIndex];
  assert.equal(
    run.if,
    undefined,
    "every shard must run for every checked revision",
  );
  assert.equal(run["continue-on-error"], undefined);
  assert.ok(
    !/--(?:retry|bail|passWithNoTests|testNamePattern|exclude)/.test(run.run),
  );
});

test("Vitest shards cover every discovered test file exactly once without running fixtures", async () => {
  // filesOnly listing does not apply sharding in Vitest 4. Use its resolved
  // sequencer with discovered specifications; never collect/import DB fixtures.
  const { createVitest } = await import("vitest/node");
  const shards = [];
  let all;
  for (const index of tests.strategy.matrix.shard) {
    const ctx = await createVitest("test", {
      root,
      watch: false,
      shard: index + "/" + tests.strategy.matrix.shard.length,
      maxWorkers: 1,
    });
    try {
      assert.equal(ctx.config.fileParallelism, false);
      assert.equal(ctx.config.maxWorkers, 1);
      const specs = await ctx.globTestSpecifications();
      const discovered = specs.map((spec) => spec.moduleId).sort();
      if (all) assert.deepEqual(discovered, all);
      else all = discovered;
      const sequencer = new ctx.config.sequence.sequencer(ctx);
      const files = (await sequencer.shard(specs)).map((spec) => spec.moduleId);
      shards.push(files);
    } finally {
      await ctx.close();
    }
  }
  assert.ok(all.length > 0);
  for (const shard of shards) assert.ok(shard.length > 0);
  const combined = shards.flat();
  assert.equal(
    new Set(combined).size,
    combined.length,
    "no file may appear in multiple shards",
  );
  assert.deepEqual(combined.sort(), all, "no file may be dropped");
});

test("sharding assigns shorter measured files around the longest file", async () => {
  const { durationsMs } = JSON.parse(
    readFileSync(path.join(root, "scripts/ci-shard-timings.json"), "utf8"),
  );
  const byDuration = Object.keys(durationsMs).sort(
    (a, b) => durationsMs[b] - durationsMs[a],
  );
  const longest = byDuration[0];
  const shortest = byDuration.slice(-2);
  const { createVitest } = await import("vitest/node");
  const ctx = await createVitest("test", { root, watch: false });
  try {
    // Put the long file last in discovery order. Its weight should give it a
    // shard to itself, with the two short files sharing the other runner.
    const specs = [...shortest, longest].map((file) =>
      ctx.projects[0].createSpecification(path.join(root, file)),
    );
    for (const [index, expected] of [
      [1, [longest]],
      [2, shortest],
    ]) {
      ctx.config.shard = { index, count: 2 };
      const sequencer = new ctx.config.sequence.sequencer(ctx);
      const assigned = await sequencer.shard(specs);
      const paths = assigned.map((file) =>
        path.relative(root, file.moduleId).split(path.sep).join("/"),
      );
      assert.deepEqual(paths.sort(), [...expected].sort());
    }
  } finally {
    await ctx.close();
  }
});

test("unmeasured specs are distributed reproducibly when discovery order changes", async () => {
  const { createVitest } = await import("vitest/node");
  const ctx = await createVitest("test", { root, watch: false });
  try {
    const specs = Array.from({ length: 12 }, (_, index) =>
      ctx.projects[0].createSpecification(
        path.join(root, "ci-fixture", `new-${index}.test.ts`),
      ),
    );
    const assigned = [];
    for (let index = 1; index <= 3; index++) {
      ctx.config.shard = { index, count: 3 };
      const sequencer = new ctx.config.sequence.sequencer(ctx);
      const ids = async (input) =>
        (await sequencer.shard(input)).map((spec) => spec.moduleId).sort();
      const files = await ids(specs);
      assert.equal(
        files.length,
        4,
        "equal fallback weights should fill all three shards",
      );
      assert.deepEqual(await ids([...specs].reverse()), files);
      assigned.push(...files);
    }
    assert.deepEqual(
      assigned.sort(),
      specs.map((spec) => spec.moduleId).sort(),
    );
  } finally {
    await ctx.close();
  }
});

test("the required image build reads cache without optional export or ignored verification failures", () => {
  const build = image.steps.find((step) => step.id === "build");
  const smoke = image.steps.find(
    (step) => step.run === "bash scripts/smoke-image.sh shbs-smoke:local",
  );
  assert.equal(build.with["cache-from"], "type=gha");
  assert.equal(
    build.with["cache-to"],
    undefined,
    "cache backend timeouts do not bound the full preparation/upload phase",
  );
  assert.equal(build.if, undefined);
  assert.equal(smoke.if, undefined);
  assert.equal(image["continue-on-error"], undefined);
  for (const step of image.steps) {
    assert.equal(
      step["continue-on-error"],
      undefined,
      `${step.name} must still fail the required image job`,
    );
  }
});

test("publishing receives only the smoke-tested artifact and cannot bypass the gate", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(publish.needs, ["verify", "image"]);
  assert.equal(publish.permissions.packages, "write");
  for (const job of [checks, tests, image, verify])
    assert.equal(job.permissions?.packages, undefined);
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
  assert.match(
    workflow.concurrency.group,
    /github\.workflow.*pull_request\.number.*github\.ref/,
  );
  assert.deepEqual(Object.keys(workflow.on), [
    "push",
    "pull_request",
    "workflow_dispatch",
  ]);
  assert.equal(workflow.on.pull_request, null, "stacked PRs remain covered");
  const publishCondition =
    "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')";
  assert.equal(publish.if, publishCondition);
  const build = image.steps.find((step) => step.id === "build");
  assert.equal(build.with.load, true);
  assert.notEqual(build.with.push, true);
  assert.equal(build.with.tags, "shbs-smoke:local");
  assert.equal(build.with.labels, "${{ steps.meta.outputs.labels }}");
  const smokeIndex = image.steps.findIndex(
    (step) => step.run === "bash scripts/smoke-image.sh shbs-smoke:local",
  );
  const saveIndex = image.steps.findIndex(
    (step) => step.name === "Save tested image",
  );
  const archiveIndex = image.steps.findIndex((step) => step.id === "archive");
  assert.ok(
    smokeIndex > image.steps.indexOf(build) &&
      saveIndex > smokeIndex &&
      archiveIndex > saveIndex,
  );
  for (const step of [image.steps[saveIndex], image.steps[archiveIndex]])
    assert.equal(step.if, publishCondition);
  assert.equal(image.steps[archiveIndex].with["if-no-files-found"], "error");
  assert.equal(image.steps[archiveIndex].with["retention-days"], 1);
  assert.equal(image.outputs["image-id"], "${{ steps.build.outputs.imageid }}");
  assert.equal(
    image.outputs["artifact-id"],
    "${{ steps.archive.outputs.artifact-id }}",
  );
  const download = publish.steps.find(
    (step) => step.uses === "actions/download-artifact@v4",
  );
  assert.equal(
    download.with["artifact-ids"],
    "${{ needs.image.outputs.artifact-id }}",
  );
  assert.equal(download.with["merge-multiple"], true);
  assert.equal(download.with["run-id"], undefined);
  const promote = publish.steps.find(
    (step) => step.run === "node scripts/ci-publish.mjs",
  );
  assert.equal(
    promote.env.EXPECTED_IMAGE_ID,
    "${{ needs.image.outputs.image-id }}",
  );
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
  assert.equal(
    steps.filter((step) => step.uses === "docker/build-push-action@v6").length,
    1,
  );
  assert.ok(!steps.some((step) => step.run === "npm run build"));
});

const sha = "a".repeat(40);
const imageId = `sha256:${"b".repeat(64)}`;
const environment = {
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "push",
  GITHUB_SHA: sha,
  GITHUB_REPOSITORY: "Example/School",
  IMAGE_ARCHIVE: "/tmp/verified image.tar",
  EXPECTED_IMAGE_ID: imageId,
};

function promotion(options = {}) {
  const calls = [];
  let remoteReads = 0;
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (options.fail === `${command} ${args[0]}`)
      throw new Error("Command failed");
    if (command === "git")
      return `${(options.heads ?? [sha, sha])[remoteReads++] ?? ""}\trefs/heads/main\n`;
    if (args[0] === "image") return `${options.imageId ?? imageId}\n`;
    return "";
  };
  let error;
  try {
    publishImage({ ...environment, ...options.env }, run);
  } catch (caught) {
    error = caught;
  }
  return { calls, error, pushes: calls.filter((call) => call[1] === "push") };
}

for (const event of ["push", "workflow_dispatch"]) {
  test(`${event}: load and identify the tested image, then push revision before latest`, () => {
    const result = promotion({ env: { GITHUB_EVENT_NAME: event } });
    assert.ifError(result.error);
    assert.deepEqual(result.calls, [
      ["docker", "load", "--input", environment.IMAGE_ARCHIVE],
      ["docker", "image", "inspect", "--format", "{{.Id}}", "shbs-smoke:local"],
      ["docker", "tag", imageId, "ghcr.io/example/school:sha-aaaaaaa"],
      ["git", "ls-remote", "origin", "refs/heads/main"],
      ["docker", "push", "ghcr.io/example/school:sha-aaaaaaa"],
      ["docker", "tag", imageId, "ghcr.io/example/school:latest"],
      ["git", "ls-remote", "origin", "refs/heads/main"],
      ["docker", "push", "ghcr.io/example/school:latest"],
    ]);
  });
}

test("PRs, other refs, and incomplete metadata cannot perform any Docker or Git operations", () => {
  for (const env of [
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REF: "refs/tags/main" },
    { GITHUB_SHA: "" },
    { GITHUB_REPOSITORY: "" },
    { EXPECTED_IMAGE_ID: "" },
    { IMAGE_ARCHIVE: "" },
  ]) {
    const result = promotion({ env });
    assert.ok(result.error);
    assert.deepEqual(result.calls, []);
  }
});

test("a missing, mismatched, or unloadable image cannot be pushed", () => {
  for (const options of [
    { imageId: "sha256:wrong" },
    { fail: "docker load" },
    { fail: "docker image" },
  ]) {
    const result = promotion(options);
    assert.ok(result.error);
    assert.deepEqual(result.pushes, []);
  }
});

test("stale/missing main and failed remote lookups cannot publish", () => {
  for (const options of [
    { heads: ["c".repeat(40)] },
    { heads: [""] },
    { fail: "git ls-remote" },
  ]) {
    const result = promotion(options);
    assert.ok(result.error);
    assert.deepEqual(result.pushes, []);
  }
});

test("main advancing during revision upload prevents promotion to latest", () => {
  const result = promotion({ heads: [sha, "c".repeat(40)] });
  assert.match(result.error.message, /stale commit/);
  assert.deepEqual(result.pushes, [
    ["docker", "push", "ghcr.io/example/school:sha-aaaaaaa"],
  ]);
});

test("failed revision upload cannot continue to latest", () => {
  const result = promotion({ fail: "docker push" });
  assert.match(result.error.message, /Command failed/);
  assert.equal(result.pushes.length, 1);
  assert.ok(
    !result.calls.some((call) =>
      call.includes("ghcr.io/example/school:latest"),
    ),
  );
});

test("docker-build unpacks baked help assets before image build and help-assets publishes main-only rolling release", () => {
  const unpackIndex = image.steps.findIndex(
    (step) => step.run === "node scripts/unpack-help-assets.mjs",
  );
  const buildIndex = image.steps.findIndex((step) => step.id === "build");
  assert.ok(unpackIndex >= 0 && unpackIndex < buildIndex);
  assert.equal(
    image.steps[unpackIndex].env?.GH_TOKEN,
    "${{ secrets.GITHUB_TOKEN }}",
  );

  const helpWorkflow = yaml.load(
    readFileSync(path.join(root, ".github/workflows/help-assets.yml"), "utf8"),
  );
  assert.deepEqual(Object.keys(helpWorkflow.on), ["workflow_dispatch"]);
  assert.deepEqual(helpWorkflow.permissions, { contents: "read" });
  assert.equal(helpWorkflow.jobs.bake.permissions?.contents, "write");
  assert.equal(helpWorkflow.jobs.bake.env?.AUTH_TRUST_HOST, "true");
  const verifyStep = helpWorkflow.jobs.bake.steps.find((step) =>
    step.name.includes("Verify baked screenshot manifest"),
  );
  assert.ok(verifyStep);
  assert.match(verifyStep.run, /check-help-captures\.ts --require-captures/);
  const packageStep = helpWorkflow.jobs.bake.steps.find((step) =>
    step.name.includes("Package baked runtime screenshot bundle"),
  );
  assert.ok(packageStep);
  assert.match(packageStep.run, /--exclude=docs\/guides\/help\/assets\/annotated/);
  const releaseStep = helpWorkflow.jobs.bake.steps.find((step) =>
    step.name.includes("Publish rolling help-assets-latest release"),
  );
  assert.ok(releaseStep);
  assert.equal(
    releaseStep.if,
    "github.ref == 'refs/heads/main' && inputs.publish_release == true",
  );
});

test("unpack-help-assets enforces strict tar paths, checksums, and graceful missing-release fallback", () => {
  assert.equal(isAllowedHelpTarEntry("docs/guides/help/captures.json"), true);
  assert.equal(
    isAllowedHelpTarEntry("docs/guides/help/assets/use-help-catalogue-step-1.en.jpg"),
    true,
  );
  for (const bad of [
    "../escape.jpg",
    "/etc/passwd",
    "docs/guides/help/assets/evil.sh",
    "docs/guides/help/assets/../other.json",
    "src/server/db.ts",
  ]) {
    assert.equal(isAllowedHelpTarEntry(bad), false, bad);
  }

  assert.deepEqual(
    validateTarListing(
      [
        "drwxr-xr-x runner/runner 0 2026-11-23 00:00 docs/guides/help/assets/",
        "-rw-r--r-- runner/runner 120 2026-11-23 00:00 docs/guides/help/captures.json",
        "-rw-r--r-- runner/runner 400 2026-11-23 00:00 docs/guides/help/assets/use-help-catalogue-step-1.en.jpg",
      ].join("\n"),
    ),
    [
      "docs/guides/help/captures.json",
      "docs/guides/help/assets/use-help-catalogue-step-1.en.jpg",
    ],
  );
  assert.throws(
    () =>
      validateTarListing(
        "lrwxrwxrwx runner/runner 0 2026-11-23 00:00 docs/guides/help/captures.json -> /etc/passwd",
      ),
    /Disallowed tar entry type/,
  );
  assert.throws(
    () =>
      validateTarListing(
        "-rw-r--r-- runner/runner 10 2026-11-23 00:00 docs/guides/help/assets/use-help-catalogue-step-1.en.jpg",
      ),
    /missing docs\/guides\/help\/captures\.json/,
  );

  const payload = Buffer.from("synthetic-tarball-bytes");
  const digest = createHash("sha256").update(payload).digest("hex");
  assert.equal(
    verifyArchiveChecksum(payload, `${digest}  help-assets-baked.tar.gz\n`),
    digest,
  );
  assert.throws(
    () => verifyArchiveChecksum(payload, `${"0".repeat(64)}  help-assets-baked.tar.gz\n`),
    /SHA-256 mismatch/,
  );

  const missingResult = unpackHelpAssets({
    env: { GITHUB_REPOSITORY: "Example/School" },
    exec: () => {
      const err = new Error("release not found");
      err.stderr = "release not found";
      throw err;
    },
  });
  assert.deepEqual(missingResult, { status: "missing-release", count: 0 });

  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "shbs-unpack-test-"));
  try {
    mkdirSync(path.join(fixtureRoot, "docs/guides/help/assets"), { recursive: true });
    const jpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const jpgSha = createHash("sha256").update(jpgBytes).digest("hex");
    writeFileSync(
      path.join(fixtureRoot, "docs/guides/help/assets/example-step-1.en.jpg"),
      jpgBytes,
    );
    writeFileSync(
      path.join(fixtureRoot, "docs/guides/help/captures.json"),
      JSON.stringify({
        screenshots: [{ file: "example-step-1.en.jpg", sha256: jpgSha }],
      }),
    );
    assert.equal(verifyExtractedCaptures(fixtureRoot), 1);

    writeFileSync(
      path.join(fixtureRoot, "docs/guides/help/assets/example-step-1.en.jpg"),
      Buffer.from([0xff, 0xd8, 0x00, 0xd9]),
    );
    assert.throws(() => verifyExtractedCaptures(fixtureRoot), /checksum mismatch/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("unpack-help-assets falls back to public HTTPS release download when gh is unauthenticated", async () => {
  const missingFallback = await unpackHelpAssetsWithFallback({
    env: { GITHUB_REPOSITORY: "Example/School" },
    exec: () => {
      const err = new Error("gh auth login required");
      err.stderr = "To get started with GitHub CLI, please run: gh auth login";
      throw err;
    },
    fetchImpl: async () => ({ status: 404, ok: false }),
  });
  assert.deepEqual(missingFallback, { status: "missing-release", count: 0 });
});
