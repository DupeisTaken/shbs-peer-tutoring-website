import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import { markdownModel, reportLink, root } from "./build-docs.mjs";
import { validateLinks, validateForm } from "./check-docs.mjs";

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

test("image publishing cancels stale runs and fails closed on an old main commit", () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(root, ".github/workflows/docker-build.yml"), "utf8"),
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
  assert.ok(guardIndex < pushIndex, "the current-main guard must precede the image push");
  const push = publish.steps[pushIndex];
  assert.equal(push.with.push, true);
});
