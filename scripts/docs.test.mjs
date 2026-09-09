import assert from "node:assert/strict";
import test from "node:test";
import yaml from "js-yaml";
import { markdownModel, reportLink } from "./build-docs.mjs";
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
