import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { ESLint } from "eslint";
import prettier from "prettier";
import ts from "typescript";
import yaml from "js-yaml";
import { markdownModel, reportLink, root } from "./build-docs.mjs";
import { validateLinks, validateForm } from "./check-docs.mjs";

test("local evidence stays outside Git, lint, formatting and TypeScript inputs", async () => {
  const directories = [
    "outputs",
    ".validation",
    "coverage",
    "backups",
    "local-operations",
  ];
  const eslint = new ESLint({ cwd: root });
  for (const directory of directories) {
    const relative = `${directory}/maintenance-probe.ts`;
    assert.equal(
      await eslint.isPathIgnored(path.join(root, relative)),
      true,
      relative,
    );
    const info = await prettier.getFileInfo(path.join(root, relative), {
      ignorePath: path.join(root, ".prettierignore"),
    });
    assert.equal(info.ignored, true, relative);
    assert.equal(
      execFileSync("git", ["check-ignore", "--no-index", relative], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      relative,
    );
  }
  // A disposable filesystem exercises TypeScript's real include/exclude matching,
  // while the application's live outputs and database fixtures remain untouched.
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "shbs-hygiene-"));
  try {
    for (const directory of ["src", ...directories]) {
      fs.mkdirSync(path.join(fixture, directory));
      fs.writeFileSync(
        path.join(fixture, directory, "probe.ts"),
        "export const probe = 1;\n",
      );
    }
    const loaded = ts.readConfigFile(
      path.join(root, "tsconfig.json"),
      ts.sys.readFile,
    );
    assert.equal(loaded.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(
      loaded.config,
      ts.sys,
      fixture,
    );
    assert.equal(parsed.errors.length, 0);
    assert.deepEqual(
      parsed.fileNames.map((file) =>
        path.relative(fixture, file).replaceAll("\\", "/"),
      ),
      ["src/probe.ts"],
    );
  } finally {
    const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(path.resolve(fixture).startsWith(temporaryRoot));
    assert.ok(path.basename(fixture).startsWith("shbs-hygiene-"));
    fs.rmSync(fixture, { recursive: true });
  }
  assert.equal(
    await eslint.isPathIgnored(path.join(root, "src/lib/time.ts")),
    false,
  );
});

test("headings retain Unicode, format-independent anchors and unique duplicate ids", () => {
  const model = markdownModel(
    "## A **bold** heading\n## A bold heading\n## 中文政策\n",
    "docs/example.md",
  );
  assert.deepEqual(
    model.headings.map((h) => h.id),
    ["a-bold-heading", "a-bold-heading-1", "中文政策"],
  );
});

test("Markdown rendering supports tables and excludes raw executable HTML", () => {
  const model = markdownModel(
    "| One | Two |\n| --- | --- |\n| A | B |\n\n<script>alert(1)</script>\n",
    "docs/example.md",
  );
  assert.match(model.html, /<table>/);
  assert.doesNotMatch(model.html, /<script>/);
});

test("link validation finds missing files and headings, ignoring code examples", () => {
  const source = "docs/example.md";
  const model = markdownModel(
    "# Present\n[ok](#present) [bad](missing.md) [bad heading](#absent)\n\n```md\n[example](not-real.md)\n```",
    source,
  );
  const errors = validateLinks(
    source,
    model,
    (p) => p === source,
    () => ["present"],
  );
  assert.equal(errors.length, 2);
  assert.match(errors[0], /missing target/);
  assert.match(errors[1], /missing heading/);
});

test("HTML reports link locally to each other and to exact repository sources", () => {
  assert.equal(
    reportLink("user-guide.md#tutors", "docs/technical-report.md"),
    "user-guide.html#tutors",
  );
  assert.equal(
    reportLink("#architecture", "docs/technical-report.md"),
    "#architecture",
  );
  assert.equal(
    reportLink(
      "../prisma/policies/tutor-policy.en.md#service-hours",
      "docs/user-guide.md",
    ),
    "https://github.com/DupeisTaken/shbs-peer-tutoring-website/blob/main/prisma/policies/tutor-policy.en.md#service-hours",
  );
});

test("issue forms reject duplicate field ids and missing report content", () => {
  const field = {
    type: "input",
    id: "problem",
    attributes: { label: "Problem" },
    validations: { required: true },
  };
  const privacy = {
    type: "checkboxes",
    id: "privacy",
    attributes: {
      label: "Privacy",
      options: [{ label: "Checked", required: true }],
    },
  };
  const form = {
    name: "Bug",
    description: "Report a bug",
    body: [field, privacy],
  };
  assert.deepEqual(validateForm(form), []);
  assert.match(
    validateForm({ ...form, body: [field, field, privacy] }).join(),
    /duplicate/,
  );
  assert.match(
    validateForm({ ...form, body: [privacy] }).join(),
    /required report/,
  );
  assert.throws(
    () => yaml.load("name: First\nname: Duplicate"),
    /duplicated mapping key/,
  );
});

test("the issue guide links every available form to a valid template", () => {
  // Discover the chooser's forms so future additions cannot silently lack guidance.
  const directory = path.join(root, ".github/ISSUE_TEMPLATE");
  const guide = markdownModel(
    fs.readFileSync(path.join(root, "docs/issues.md"), "utf8"),
    "docs/issues.md",
  );
  const linkedTemplates = guide.links
    .filter((href) => href.includes("/issues/new?template="))
    .map((href) => new URL(href).searchParams.get("template"));
  const templates = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".yml") && name !== "config.yml");
  assert.deepEqual(linkedTemplates, templates.sort());
  for (const name of templates) {
    const form = yaml.load(fs.readFileSync(path.join(directory, name), "utf8"));
    assert.deepEqual(validateForm(form), [], name);
  }
});

test("every guided issue form assigns exactly its own category label", () => {
  // Parse the actual YAML: title prefixes and body field labels do not categorize issues.
  const categories = {
    "01-bug_report.yml": "bug",
    "02-enhancement.yml": "enhancement",
    "03-feature_request.yml": "feature",
    "04-documentation.yml": "documentation",
  };
  const directory = path.join(root, ".github/ISSUE_TEMPLATE");
  const templates = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".yml") && name !== "config.yml");
  assert.deepEqual(templates.sort(), Object.keys(categories).sort());
  for (const [name, category] of Object.entries(categories)) {
    const form = yaml.load(fs.readFileSync(path.join(directory, name), "utf8"));
    assert.deepEqual(form.labels, [category], name);
  }
});

test("the chooser orders bug, enhancement, feature and docs before support and blank issues", () => {
  // GitHub sorts YAML forms by filename, then displays contact links and the blank option.
  const directory = path.join(root, ".github/ISSUE_TEMPLATE");
  const templates = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".yml") && name !== "config.yml")
    .sort();
  assert.deepEqual(templates, [
    "01-bug_report.yml",
    "02-enhancement.yml",
    "03-feature_request.yml",
    "04-documentation.yml",
  ]);
  const config = yaml.load(
    fs.readFileSync(path.join(directory, "config.yml"), "utf8"),
  );
  assert.deepEqual(
    config.contact_links.map((link) => link.name),
    ["Read the role guide"],
  );
  assert.equal(config.blank_issues_enabled, true);
});

test("enhancement requests require context and an outcome while leaving alternatives optional", () => {
  const form = yaml.load(
    fs.readFileSync(
      path.join(root, ".github/ISSUE_TEMPLATE/02-enhancement.yml"),
      "utf8",
    ),
  );
  assert.equal(form.title, "[Enhancement]: ");
  for (const id of ["feature", "current_behavior", "improvement"]) {
    assert.equal(
      form.body.find((field) => field.id === id)?.validations?.required,
      true,
      id,
    );
  }
  for (const id of ["alternatives", "constraints"]) {
    const field = form.body.find((field) => field.id === id);
    assert.ok(field, id);
    assert.notEqual(field.validations?.required, true, id);
  }
  assert.deepEqual(validateForm(form), []);
});

test("image publishing cancels stale runs and fails closed on an old main commit", () => {
  const workflow = yaml.load(
    fs.readFileSync(
      path.join(root, ".github/workflows/docker-build.yml"),
      "utf8",
    ),
  );
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
  assert.match(workflow.concurrency.group, /github\.workflow/);
  assert.match(workflow.concurrency.group, /pull_request\.number/);
  assert.match(workflow.concurrency.group, /github\.ref/);

  const publish = workflow.jobs.publish;
  assert.match(publish.if, /refs\/heads\/main/);
  assert.match(publish.if, /event_name == 'push'/);
  assert.match(publish.if, /workflow_dispatch/);
  const guardIndex = publish.steps.findIndex(
    (step) => step.name === "Confirm commit is current main",
  );
  const guard = publish.steps[guardIndex];
  assert.ok(guard, "publish must recheck the main branch before pushing");
  assert.match(guard.run, /git ls-remote origin refs\/heads\/main/);
  assert.match(guard.run, /EXPECTED_SHA/);
  const pushIndex = publish.steps.findIndex(
    (step) => step.uses === "docker/build-push-action@v6",
  );
  assert.ok(
    guardIndex < pushIndex,
    "the current-main guard must precede the image push",
  );
  const push = publish.steps[pushIndex];
  assert.equal(push.with.push, true);
});
