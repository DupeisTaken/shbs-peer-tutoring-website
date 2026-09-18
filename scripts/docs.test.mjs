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
import {
  root,
  markdownModel,
  checkDocs,
  validateLinks,
  validateForm,
} from "./check-docs.mjs";

test("the root has only its README and agent instructions, and every guide is reachable", () => {
  // AGENTS.md must remain at the root for agent discovery; user guides still live in docs.
  assert.deepEqual(
    fs
      .readdirSync(root)
      .filter((name) => /\.(md|mdx|rst|txt)$/i.test(name))
      .sort(),
    ["AGENTS.md", "README.md"],
  );
  const readme = markdownModel(
    fs.readFileSync(path.join(root, "README.md"), "utf8"),
  );
  assert.equal(
    readme.links[0],
    "docs/README.md",
    "the documentation hub is the first README destination",
  );
  // Discover actual guides so a new orphan page cannot silently evade navigation.
  const discover = (directory) =>
    fs
      .readdirSync(path.join(root, directory), { withFileTypes: true })
      .flatMap((entry) => {
        const file = path.posix.join(directory, entry.name);
        if (entry.isDirectory())
          return entry.name === "reports" ? [] : discover(file);
        return entry.name.endsWith(".md") ? [file] : [];
      });
  const guides = new Set(discover("docs"));
  const visited = new Set();
  const pending = ["docs/README.md"];
  while (pending.length) {
    const source = pending.pop();
    if (visited.has(source)) continue;
    visited.add(source);
    const model = markdownModel(
      fs.readFileSync(path.join(root, source), "utf8"),
    );
    for (const href of model.links) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(href)) continue;
      const target = path.posix.normalize(
        path.posix.join(
          path.posix.dirname(source),
          decodeURIComponent(href.split("#")[0]),
        ),
      );
      if (guides.has(target)) pending.push(target);
    }
  }
  assert.deepEqual([...visited].sort(), [...guides].sort());
});

test("HTML reports are ignored while source docs and application HTML remain trackable", () => {
  const ignored = [
    "docs/reports/user-guide.html",
    "docs/reports/technical-report.html",
    "docs/reports/release-audit.html",
    "docs/reports/nested/print.html",
    "docs/reports/audit-assets/example.png",
    "playwright-report/index.html",
    "test-report.html",
    "docs/signup-audit.html",
  ];
  const tracked = [
    "docs/user-guide.md",
    "scripts/check-docs.mjs",
    "public/example.html",
  ];
  const result = execFileSync(
    "git",
    ["check-ignore", "--no-index", "--stdin"],
    {
      cwd: root,
      input: [...ignored, ...tracked].join("\n") + "\n",
      encoding: "utf8",
    },
  );
  assert.deepEqual(result.trim().split(/\r?\n/), ignored);
});

test("documentation validation reads Markdown sources without writing files", (t) => {
  // Local artifacts must never become prerequisites for source validation.
  const read = fs.readFileSync;
  const exists = fs.existsSync;
  const isReport = (file) =>
    /\/reports\/.*\.html$/.test(String(file).replaceAll("\\", "/"));
  t.mock.method(fs, "existsSync", (file) =>
    isReport(file) ? false : exists(file),
  );
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    assert.equal(isReport(file), false, "checks must use Markdown sources");
    return read(file, ...args);
  });
  t.mock.method(fs, "writeFileSync", () =>
    assert.fail("checks must not write files"),
  );
  assert.doesNotThrow(() => checkDocs());
});

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
  );
  assert.deepEqual(
    model.headings.map((h) => h.id),
    ["a-bold-heading", "a-bold-heading-1", "中文政策"],
  );
});

test("Markdown parsing finds table links, reference links and images while ignoring examples", () => {
  const model = markdownModel(
    [
      "| Guide | Image |",
      "| --- | --- |",
      "| [setup][local] | ![diagram](diagram.png) |",
      "",
      "[local]: local-development.md#prerequisites",
      "[unused]: missing.md",
      "",
      "![badge][asset]",
      "",
      "[asset]: badge.png",
      "",
      "\`[example](inline.md)\`",
      "\`\`\`md",
      "[example](fenced.md)",
      "\`\`\`",
    ].join("\n"),
  );
  assert.deepEqual(model.links, [
    "local-development.md#prerequisites",
    "diagram.png",
    "badge.png",
  ]);
  assert.deepEqual(model.headings, []);
});

test("link validation finds missing files and headings, ignoring code examples", () => {
  const source = "docs/example.md";
  const model = markdownModel(
    "# Present\n[ok](#present) [bad](missing.md) [bad heading](#absent)\n\n```md\n[example](not-real.md)\n```",
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
