import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";

const workflow = yaml.load(
  fs.readFileSync(
    new URL("../.github/workflows/pr-size.yml", import.meta.url),
    "utf8",
  ),
);
// Execute the actual workflow body with fake GitHub APIs, so tests cannot drift
// into validating a separate implementation or modify a real repository's labels.
const script = workflow.jobs.label.steps.find((step) => step.with?.script).with
  .script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runScript = new AsyncFunction(
  "require",
  "github",
  "context",
  "core",
  script,
);
const failure = (status) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

async function run({
  total = 0,
  nonTest = total,
  labels = [],
  gitDiff,
  head = "head",
  fetchedHead = head,
  latestHead = head,
  state = "open",
  latestBase = "base",
  missing = false,
  race = false,
  apiError,
  removeError,
} = {}) {
  const mutations = [];
  const messages = [];
  const commands = [];
  const created = new Set();
  let reads = 0;
  const issues = {
    getLabel: async ({ name }) => {
      if (apiError) throw failure(apiError);
      if (missing && !created.has(name)) throw failure(404);
      return { data: { name, color: "old", description: "old" } };
    },
    createLabel: async (label) => {
      created.add(label.name);
      if (race) throw failure(422);
      mutations.push(["create", label]);
    },
    updateLabel: async (label) => mutations.push(["update", label]),
    listLabelsOnIssue: async () => {},
    addLabels: async (args) => mutations.push(["add", args.labels]),
    removeLabel: async ({ name }) => {
      if (removeError) throw failure(removeError);
      mutations.push(["remove", name]);
    },
  };
  const github = {
    rest: {
      issues,
      pulls: {
        get: async () => ({
          data: {
            state,
            head: { sha: reads++ === 0 ? head : latestHead },
            base: { sha: reads === 1 ? "base" : latestBase },
          },
        }),
      },
    },
    paginate: async (method, params) => {
      assert.equal(method, issues.listLabelsOnIssue);
      assert.equal(params.per_page, 100);
      return labels.map((name) => ({ name }));
    },
  };
  await runScript(
    (name) => {
      assert.equal(name, "node:child_process");
      return {
        execFileSync: (command, args) => {
          assert.equal(command, "git");
          commands.push(args);
          if (args[0] === "fetch") return "";
          if (args[0] === "rev-parse") return fetchedHead;
          assert.equal(
            args[0],
            "diff",
            "PR data must never be executed or checked out",
          );
          return gitDiff
            ? gitDiff(args)
            : `${args.includes("--") ? nonTest : total}\t0\tfile.ts\n`;
        },
      };
    },
    github,
    {
      repo: { owner: "example", repo: "repo" },
      payload: { pull_request: { number: 7 } },
    },
    { info: (message) => messages.push(message) },
  );
  return { mutations, commands, messages };
}

test("workflow supports forks and base changes without executing PR code", () => {
  assert.deepEqual(workflow.on.pull_request_target.types, [
    "opened",
    "reopened",
    "synchronize",
    "edited",
    "ready_for_review",
    "converted_to_draft",
  ]);
  assert.equal(workflow.on.pull_request_target.branches, undefined);
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
  assert.equal(workflow.jobs.label["timeout-minutes"], 5);
  assert.deepEqual(workflow.jobs.label.permissions, {
    contents: "read",
    issues: "write",
    "pull-requests": "write",
  });
  assert.equal(workflow.jobs.label.steps.length, 2);
  assert.equal(
    workflow.jobs.label.steps[0].with.ref,
    "${{ github.event.repository.default_branch }}",
  );
  assert.equal(workflow.jobs.label.steps[0].with["fetch-depth"], 0);
  assert.ok(
    !script.includes("${{"),
    "PR values must enter via context, not script interpolation",
  );
});

for (const [total, label] of [
  [0, "XS"],
  [9, "XS"],
  [10, "S"],
  [29, "S"],
  [30, "M"],
  [99, "M"],
  [100, "L"],
  [499, "L"],
  [500, "XL"],
  [999, "XL"],
  [1000, "XXL"],
  [20000, "XXL"],
]) {
  test(`${total} effective lines receives size:${label}`, async () => {
    const { mutations } = await run({ total });
    assert.deepEqual(
      mutations.filter(([action]) => action === "add"),
      [["add", [`size:${label}`]]],
    );
  });
}

test("mixed PRs exclude tests and test-only PRs retain their size", async () => {
  for (const [nonTest, expected] of [
    [10, "size:S"],
    [0, "size:XXL"],
  ]) {
    const { mutations } = await run({ total: 1500, nonTest });
    assert.deepEqual(
      mutations.find(([action]) => action === "add"),
      ["add", [expected]],
    );
  }
});

test("label replacement preserves unrelated labels and repeated runs do not relabel", async () => {
  const labels = ["bug", "size:XS", "size:XXL", "size:custom"];
  const { mutations } = await run({ total: 40, labels });
  assert.deepEqual(
    mutations.filter(([action]) => ["add", "remove"].includes(action)),
    [
      ["add", ["size:M"]],
      ["remove", "size:XS"],
      ["remove", "size:XXL"],
    ],
  );
  const repeated = await run({ total: 40, labels: ["bug", "size:M"] });
  assert.ok(
    !repeated.mutations.some(([action]) => ["add", "remove"].includes(action)),
  );
});

test("first use creates all definitions and concurrent creation reconciles them", async () => {
  for (const race of [false, true]) {
    const { mutations } = await run({ missing: true, race });
    const definitions = mutations.filter(
      ([action]) => action === (race ? "update" : "create"),
    );
    assert.equal(definitions.length, 6);
    assert.equal(definitions[0][1].color, "0e8a16");
    assert.equal(definitions[5][1].color, "b60205");
  }
});

test("closed or changing PRs cause no label mutations", async () => {
  for (const options of [
    { state: "closed" },
    { fetchedHead: "new" },
    { latestHead: "new" },
    { latestBase: "new-base" },
  ]) {
    assert.deepEqual((await run(options)).mutations, []);
  }
});

test("API failures propagate, except removal of an already missing label", async () => {
  await assert.rejects(run({ apiError: 403 }), /HTTP 403/);
  await assert.rejects(
    run({ labels: ["size:L"], removeError: 500 }),
    /HTTP 500/,
  );
  await run({ labels: ["size:L"], removeError: 404 });
});

test("real Git diffs handle merge bases, test paths, whitespace, deletions, renames and binaries", async (t) => {
  // A tiny disposable repo exercises real Git pathspec/diff semantics. No server
  // or network is needed, and cleanup is restricted to this generated directory.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shbs-pr-size-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" });
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  };
  git("init", "--quiet");
  git("config", "user.name", "PR size test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.autocrlf", "false");
  write("app.ts", "const value = 1;\n");
  write("deleted.ts", "one\ntwo\n");
  write("renamed.ts", "unchanged\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();
  // Base-only changes must not count against this PR (three-dot comparison).
  write("base-only.ts", "base\n".repeat(1000));
  git("add", ".");
  git("commit", "--quiet", "-m", "base advances");
  const advancedBase = git("rev-parse", "HEAD").trim();
  git("checkout", "--quiet", "--detach", base);
  write("app.ts", "const   value = 1;\n\n");
  git("rm", "--quiet", "deleted.ts");
  git("mv", "renamed.ts", "new-name.ts");
  write("binary.png", Buffer.from([0, 1, 2, 3]));
  for (const file of [
    "src/a.test.ts",
    "scripts/docs.test.mjs",
    "src/a.spec.ts",
    "src/a.browser.ts",
    "src/a.integration.ts",
    "src/test/setup.ts",
    "test/helper.ts",
    "tests/helper.ts",
    "src/__tests__/helper.ts",
    "scripts/test-runtime.mjs",
    "scripts/smoke-image.sh",
  ]) {
    write(file, "test\n".repeat(100));
  }
  git("add", ".");
  git("commit", "--quiet", "-m", "PR changes");
  const head = git("rev-parse", "HEAD").trim();
  const gitDiff = (args) =>
    git(
      ...args.map((arg) =>
        arg === `base...${head}` ? `${advancedBase}...${head}` : arg,
      ),
    );
  const { mutations, messages } = await run({ head, gitDiff });
  assert.match(
    messages.at(-1),
    /1102 total lines, 2 non-test lines, 2 effective lines/,
  );
  assert.deepEqual(
    mutations.find(([action]) => action === "add"),
    ["add", ["size:XS"]],
  );
  // Removing the only non-test changes exercises the real test-only fallback.
  git("restore", "--source", base, "--", "deleted.ts");
  git("add", ".");
  git("commit", "--quiet", "-m", "restore deleted source");
  const testHead = git("rev-parse", "HEAD").trim();
  const testsOnly = await run({
    head: testHead,
    gitDiff: (args) =>
      git(
        ...args.map((arg) =>
          arg === `base...${testHead}` ? `${advancedBase}...${testHead}` : arg,
        ),
      ),
  });
  assert.match(
    testsOnly.messages.at(-1),
    /1100 total lines, 0 non-test lines, 1100 effective lines/,
  );
  assert.deepEqual(
    testsOnly.mutations.find(([action]) => action === "add"),
    ["add", ["size:XXL"]],
  );
});
