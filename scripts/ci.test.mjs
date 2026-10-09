import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import yaml from "js-yaml";
import { publishImage } from "./ci-publish.mjs";

const root = path.resolve(import.meta.dirname, "..");
const workflow = yaml.load(
  readFileSync(path.join(root, ".github/workflows/docker-build.yml"), "utf8"),
);
const { checks, tests, image, verify, publish } = workflow.jobs;

test("the stable verify gate rejects failure, cancellation, skips and missing jobs", () => {
  assert.deepEqual(verify.needs, ["checks", "tests", "image"]);
  assert.equal(verify.if, "${{ always() }}");
  const gate = verify.steps[0];
  assert.equal(gate.env.NEEDS_JSON, "${{ toJSON(needs) }}");
  // Execute the actual gate for every combination, including a missing dependency.
  const states = ["success", "failure", "cancelled", "skipped", undefined];
  for (const checkResult of states)
    for (const testResult of states)
      for (const imageResult of states) {
        const results = Object.fromEntries(
          [checkResult, testResult, imageResult].flatMap((result, index) =>
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
          [checkResult, testResult, imageResult].filter(
            (result) => result !== "success",
          ).length,
        );
      }
});

test("parallel jobs retain checks, isolated databases, bounded workers and failure reports", () => {
  for (const job of [checks, tests, image]) assert.equal(job.needs, undefined);
  for (const job of Object.values(workflow.jobs)) {
    assert.ok(job["timeout-minutes"] > 0 && job["timeout-minutes"] <= 15);
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
    "npm audit",
  ]) {
    assert.ok(
      checks.steps.some((step) => step.run === command),
      command,
    );
  }
  assert.deepEqual(tests.strategy.matrix.shard, [1, 2]);
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
  assert.match(run, /--shard=\$\{\{ matrix.shard \}\}\/2 --maxWorkers=1/);
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
      shard: index + "/2",
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
      shards.push((await sequencer.shard(specs)).map((spec) => spec.moduleId));
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
    "no file may appear in both shards",
  );
  assert.deepEqual(combined.sort(), all, "no file may be dropped");
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
