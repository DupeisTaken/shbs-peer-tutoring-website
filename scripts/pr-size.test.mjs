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
  effective = total,
  documentation = 0,
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
  addError,
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
    addLabels: async (args) => {
      if (addError) throw failure(addError);
      mutations.push(["add", args.labels]);
    },
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
          if (gitDiff) return gitDiff(args);
          // Distinguish the all-files, code-exclusion and docs-inclusion diffs;
          // documentation must not accidentally inherit the code stub's count.
          const separator = args.indexOf("--");
          const lines =
            separator === -1
              ? total
              : args[separator + 1] === "."
                ? effective
                : documentation;
          return `${lines}\t0\tfile.ts\n`;
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

test("PR build verification runs the actual sizing regression suite", () => {
  const build = yaml.load(
    fs.readFileSync(
      new URL("../.github/workflows/docker-build.yml", import.meta.url),
      "utf8",
    ),
  );
  const packageJson = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  // Label writes stay in the trusted workflow; ordinary PR builds execute the
  // regression suite, whose failure must propagate to the required verify gate.
  assert.ok(Object.hasOwn(build.on, "pull_request"));
  assert.equal(build.on.pull_request?.branches, undefined);
  assert.equal(build.on.pull_request?.paths, undefined);
  assert.equal(build.jobs.checks.if, undefined);
  const sizingStep = build.jobs.checks.steps.find(
    (step) => step.run?.trim() === "npm run test:pr-size",
  );
  assert.ok(sizingStep, "PR checks must run the sizing regression suite");
  assert.equal(sizingStep.if, undefined);
  assert.equal(sizingStep["continue-on-error"], undefined);
  assert.ok(build.jobs.verify.needs.includes("checks"));
  assert.equal(
    packageJson.scripts["test:pr-size"],
    "node --test scripts/pr-size.test.mjs",
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

test("excluded lines never inflate mixed or supporting-material-only PRs", async () => {
  for (const [effective, expected] of [
    [10, "size:S"],
    [0, "size:XS"],
  ]) {
    const { mutations, messages } = await run({ total: 1500, effective });
    assert.deepEqual(
      mutations.find(([action]) => action === "add"),
      ["add", [expected]],
    );
    assert.equal(
      messages.at(-1),
      `PR #7: 1500 total lines, ${1500 - effective} excluded lines, ${effective} effective lines -> ${expected}; 0 documentation lines -> none`,
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
    assert.equal(definitions.length, 11);
    assert.equal(definitions[0][1].color, "0e8a16");
    assert.equal(definitions[5][1].color, "b60205");
    assert.deepEqual(
      definitions
        .slice(6)
        .map(([, label]) => [label.name, label.color, label.description]),
      [
        ["docs:S", "5ebd3e", "1-29 documentation changed lines."],
        ["docs:M", "fbca04", "30-99 documentation changed lines."],
        ["docs:L", "fe7d37", "100-499 documentation changed lines."],
        ["docs:XL", "d93f0b", "500-999 documentation changed lines."],
        ["docs:XXL", "b60205", "1,000+ documentation changed lines."],
      ],
    );
    for (const [, label] of definitions.slice(0, 6)) {
      assert.match(
        label.description,
        /excludes tests, docs and translation files/,
      );
    }
    assert.ok(
      definitions.every(([, label]) => label.description.length <= 100),
    );
  }
});

test("closed or changing PRs cause no label mutations", async () => {
  for (const options of [
    { state: "closed" },
    { fetchedHead: "new" },
    { latestHead: "new" },
    { latestBase: "new-base" },
  ]) {
    // A stale run must neither add a newly warranted docs label nor remove one.
    for (const documentation of [0, 500]) {
      assert.deepEqual(
        (
          await run({
            ...options,
            documentation,
            labels: ["size:L", "docs:L", "documentation", "docs:custom"],
          })
        ).mutations,
        [],
      );
    }
  }
});

test("API failures propagate, except removal of an already missing label", async () => {
  await assert.rejects(run({ apiError: 403 }), /HTTP 403/);
  await assert.rejects(
    run({ labels: ["size:L"], removeError: 500 }),
    /HTTP 500/,
  );
  await run({ labels: ["size:L"], removeError: 404 });
  await assert.rejects(
    run({ labels: ["size:XS", "docs:L"], removeError: 500 }),
    /HTTP 500/,
  );
  await run({ labels: ["size:XS", "docs:L"], removeError: 404 });
});

for (const [documentation, expected] of [
  [0, null],
  [1, "S"],
  [9, "S"],
  [10, "S"],
  [29, "S"],
  [30, "M"],
  [99, "M"],
  [100, "L"],
  [499, "L"],
  [500, "XL"],
  [999, "XL"],
  [1000, "XXL"],
]) {
  test(`${documentation} documentation lines receives ${expected ? `docs:${expected}` : "no docs label"}`, async () => {
    const { mutations, messages } = await run({
      total: documentation,
      effective: 0,
      documentation,
    });
    assert.deepEqual(
      mutations.filter(([action]) => action === "add"),
      [["add", ["size:XS", ...(expected ? [`docs:${expected}`] : [])]]],
    );
    assert.ok(
      messages
        .at(-1)
        .endsWith(
          `${documentation} documentation lines -> ${expected ? `docs:${expected}` : "none"}`,
        ),
    );
  });
}

test("code and documentation sizes transition independently and preserve manual labels", async () => {
  const initial = await run({
    total: 2000,
    effective: 1000,
    documentation: 500,
    labels: ["bug", "size:L", "docs:S", "documentation", "docs:custom"],
  });
  assert.deepEqual(
    initial.mutations.filter(([action]) => ["add", "remove"].includes(action)),
    [
      ["add", ["size:XXL", "docs:XL"]],
      ["remove", "size:L"],
      ["remove", "docs:S"],
    ],
  );
  assert.match(initial.messages.at(-1), /500 documentation lines -> docs:XL$/);
  const repeated = await run({
    total: 2000,
    effective: 1000,
    documentation: 500,
    labels: ["bug", "size:XXL", "docs:XL", "documentation", "docs:custom"],
  });
  assert.ok(
    !repeated.mutations.some(([action]) => ["add", "remove"].includes(action)),
  );
  const shrunk = await run({
    total: 1499,
    effective: 1000,
    documentation: 499,
    labels: ["bug", "size:XXL", "docs:XL", "documentation", "docs:custom"],
  });
  assert.deepEqual(
    shrunk.mutations.filter(([action]) => ["add", "remove"].includes(action)),
    [
      ["add", ["docs:L"]],
      ["remove", "docs:XL"],
    ],
  );
  assert.match(shrunk.messages.at(-1), /499 documentation lines -> docs:L$/);
  const grown = await run({
    total: 1500,
    effective: 10,
    documentation: 500,
    labels: ["bug", "size:XXL", "docs:L", "documentation", "docs:custom"],
  });
  assert.deepEqual(
    grown.mutations.filter(([action]) => ["add", "remove"].includes(action)),
    [
      ["add", ["size:S", "docs:XL"]],
      ["remove", "size:XXL"],
      ["remove", "docs:L"],
    ],
  );
  const removed = await run({
    total: 10,
    effective: 10,
    documentation: 0,
    labels: [
      "bug",
      "size:S",
      "docs:S",
      "docs:XXL",
      "documentation",
      "docs:custom",
    ],
  });
  assert.deepEqual(
    removed.mutations.filter(([action]) => ["add", "remove"].includes(action)),
    [
      ["remove", "docs:S"],
      ["remove", "docs:XXL"],
    ],
  );
});

test("failed additions cannot remove existing size or documentation labels", async () => {
  await assert.rejects(
    run({
      total: 40,
      documentation: 0,
      labels: ["size:XXL", "docs:XL"],
      addError: 403,
      removeError: 500,
    }),
    /HTTP 403/,
  );
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
    /1102 total lines, 1100 excluded lines, 2 effective lines/,
  );
  assert.deepEqual(
    mutations.find(([action]) => action === "add"),
    ["add", ["size:XS"]],
  );
  // Removing the only code changes must not reintroduce the excluded tests.
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
    /1100 total lines, 1100 excluded lines, 0 effective lines/,
  );
  assert.deepEqual(
    testsOnly.mutations.find(([action]) => action === "add"),
    ["add", ["size:XS"]],
  );
});

test("real Git excludes docs, catalogs and colocated TSX tests while retaining runtime inputs", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "shbs-pr-size-content-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" });
  const write = (file, lines) => {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), "changed\n".repeat(lines));
  };
  git("init", "--quiet");
  git("config", "user.name", "PR size test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.autocrlf", "false");
  git("commit", "--quiet", "--allow-empty", "-m", "base");

  // Compare each scenario with its own base so exclusion-only changes cannot
  // pass merely because another scenario supplied a small amount of code.
  const scenarios = [
    {
      name: "documentation only",
      effective: 0,
      documentation: 600,
      files: {
        "README.md": 100,
        "AGENTS.md": 100,
        "docs/guide.md": 100,
        "docs/nested/example.json": 100,
        "tools/README.md": 100,
        "src/AGENTS.md": 100,
      },
    },
    {
      name: "translations only",
      effective: 0,
      files: {
        "messages/en.json": 600,
        "messages/zh.json": 600,
      },
    },
    {
      name: "colocated TSX test from PR 422",
      effective: 0,
      files: {
        "src/app/_components/program-calendar-settings.test.tsx": 314,
      },
    },
    {
      name: "tests plus docs and translations",
      effective: 0,
      documentation: 500,
      files: {
        "src/app/_components/calendar.spec.tsx": 500,
        "docs/new-guide.md": 500,
        "messages/fr.json": 500,
      },
    },
    {
      name: "mixed changes",
      effective: 10,
      documentation: 600,
      files: {
        "src/app/_components/program-calendar.tsx": 10,
        "src/app/_components/new-calendar.test.tsx": 600,
        "docs/new-feature.md": 600,
        "messages/de.json": 600,
      },
    },
    {
      name: "runtime inputs and localization implementation",
      effective: 30,
      files: {
        "prisma/policies/tutor-policy.en.md": 5,
        "src/i18n/request.ts": 5,
        "src/server/api/routers/i18n.ts": 5,
        "src/config.json": 5,
        "src/app/content.mdx": 5,
        "package-lock.json": 5,
      },
    },
  ];
  for (const { name, effective, documentation = 0, files } of scenarios) {
    const base = git("rev-parse", "HEAD").trim();
    for (const [file, lines] of Object.entries(files)) write(file, lines);
    git("add", ".");
    git("commit", "--quiet", "-m", name);
    const head = git("rev-parse", "HEAD").trim();
    const result = await run({
      head,
      gitDiff: (args) =>
        git(
          ...args.map((arg) =>
            arg === `base...${head}` ? `${base}...${head}` : arg,
          ),
        ),
    });
    const total = Object.values(files).reduce((sum, lines) => sum + lines, 0);
    assert.ok(
      result.messages
        .at(-1)
        .includes(
          `${total} total lines, ${total - effective} excluded lines, ${effective} effective lines`,
        ),
      name,
    );
    assert.deepEqual(
      result.mutations.find(([action]) => action === "add"),
      [
        "add",
        [
          effective === 0 ? "size:XS" : effective === 10 ? "size:S" : "size:M",
          ...(documentation > 0 ? ["docs:XL"] : []),
        ],
      ],
      name,
    );
  }
});

test("real Git documentation boundaries use one scope and keep code and catalogs independent", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shbs-doc-review-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" });
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  };
  git("init", "--quiet");
  git("config", "user.name", "Documentation review test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.autocrlf", "false");
  write("docs/deleted.md", "removed\n".repeat(200));
  write("docs/whitespace.md", "const value = 1;\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();

  for (const { name, docs, code, translations, expected } of [
    {
      name: "499 docs lines",
      docs: 499,
      code: 0,
      translations: 1000,
      expected: ["size:XS", "docs:L"],
    },
    {
      name: "500 docs lines",
      docs: 500,
      code: 0,
      translations: 0,
      expected: ["size:XS", "docs:XL"],
    },
    {
      name: "large code and docs",
      docs: 500,
      code: 1000,
      translations: 1000,
      expected: ["size:XXL", "docs:XL"],
    },
    {
      name: "catalogs only",
      docs: 0,
      code: 0,
      translations: 1500,
      expected: ["size:XS"],
    },
  ]) {
    // Reset to the same committed base so every threshold case includes its own
    // additions and deletions, without carrying documentation from another case.
    git("checkout", "--quiet", "--detach", base);
    if (docs > 0) {
      git("rm", "--quiet", "docs/deleted.md");
      write("README.md", "added\n".repeat(docs - 400));
      write("tools/AGENTS.md", "added\n".repeat(50));
      write("tools/nested/README.md", "added\n".repeat(50));
      write("docs/nested/reference.json", "added\n".repeat(100));
      // Whitespace-only changes and a binary under docs contribute zero lines.
      write("docs/whitespace.md", "const   value = 1;\n\n");
      write("docs/figure.png", Buffer.from([0, 1, 2, 3]));
    }
    if (code > 0) write("src/runtime.ts", "code\n".repeat(code));
    if (translations > 0)
      write("messages/en.json", "catalog\n".repeat(translations));
    git("add", ".");
    git("commit", "--quiet", "-m", name);
    const head = git("rev-parse", "HEAD").trim();
    const result = await run({
      head,
      gitDiff: (args) =>
        git(
          ...args.map((arg) =>
            arg === `base...${head}` ? `${base}...${head}` : arg,
          ),
        ),
    });
    assert.deepEqual(
      result.mutations.filter(([action]) => action === "add"),
      [["add", expected]],
      name,
    );
    assert.ok(result.messages.at(-1).includes(`${code} effective lines`), name);
    assert.ok(
      result.messages.at(-1).includes(`${docs} documentation lines`),
      name,
    );
  }
});
