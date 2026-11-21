// Provider/workflow assertions run only in the candidate's root validation.
// Measured checkouts copy the harness but retain their original workflow files.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PROFILE_WATCH_PATHS } from "./applicability.mjs";

const workflowFile = fileURLToPath(
  new URL("../../.github/workflows/scheduling-profile.yml", import.meta.url),
);
void test("workflow keeps path policy, unconditional bounded helper validation and independently verified N/A aggregation", () => {
  const workflow = readFileSync(workflowFile, "utf8").replaceAll("\r\n", "\n");
  const triggers = workflow
    .split("    paths:\n")[1]!
    .split("  workflow_dispatch:")[0]!;
  assert.deepEqual(
    [...triggers.matchAll(/^\s+- "([^"]+)"$/gm)].map((match) => match[1]),
    [...PROFILE_WATCH_PATHS],
  );
  const matrix = workflow.split("  matrix:\n")[1]!.split("  preflight:\n")[0]!;
  const validation =
    /- name: Validate profile helpers before any applicability decision\n([\s\S]*?)(?=\n      - )/.exec(matrix)![1]!;
  assert.doesNotMatch(validation, /\bif:/);
  assert.match(
    validation,
    /timeout 120 node --import tsx --test --test-concurrency=1/,
  );
  assert.match(validation, /NODE_OPTIONS: --max-old-space-size=4096/);
  assert.match(matrix, /timeout-minutes: 10/);
  assert.ok(
    matrix.indexOf("Determine scheduling-profile applicability") <
      matrix.indexOf("Determine the common measurement interval"),
  );
  assert.ok(
    matrix.indexOf("Determine scheduling-profile applicability") <
      matrix.indexOf("docker pull"),
  );
  assert.match(
    matrix,
    /assert.notEqual\(control, candidate, "A measurement control cannot be the candidate revision"\)/,
  );
  for (const step of [
    "Select immutable comparison and reviewed schema contract",
    "Determine the common measurement interval",
  ])
    assert.match(
      matrix.slice(
        matrix.indexOf(`- name: ${step}`),
        matrix.indexOf(`- name: ${step}`) + 200,
      ),
      /if: steps.scope.outputs.status == 'REQUIRED'/,
    );
  const aggregate = workflow.split("  aggregate:\n")[1]!;
  assert.match(
    aggregate,
    /if: always\(\) && needs.matrix.outputs.admission != 'DEFERRED'/,
  );
  assert.match(
    aggregate,
    /run: node scripts\/scheduling-profile\/applicability.mjs gate/,
  );
  assert.match(
    aggregate,
    /name: scheduling-profile-applicability-\$\{\{ needs.matrix.outputs.scope_attempt \}\}/,
  );
  assert.match(
    aggregate,
    /PROFILE_SCOPE_PROOF_SHA256: \$\{\{ needs.matrix.outputs.scope_proof_sha256 \}\}/,
  );
  assert.match(
    aggregate,
    /applicability.mjs verify \.profile-scope-base \. \.profile-applicability\/scheduling-profile-applicability.json/,
  );
  assert.match(
    aggregate,
    /Authenticate every execution and pool complete paired populations\n        if: needs.matrix.outputs.applicability == 'REQUIRED'/,
  );
  assert.match(
    aggregate,
    /Require every diagnostic and latency partition\n        if: always\(\) && needs.matrix.outputs.applicability == 'REQUIRED'/,
  );
});
void test("measured helper discovery excludes orchestration specs while unconditional root validation includes them", () => {
  const runner = readFileSync(
    new URL("../run-scheduling-profile-ci.sh", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const measuredCommand = /^bounded helper-regressions 30 (.+)$/m.exec(runner)?.[1];
  assert.ok(measuredCommand, "The measured helper gate must remain explicit");
  assert.deepEqual(
    [...measuredCommand.matchAll(/scripts\/scheduling-profile\/[^\s]+/g)].map(
      (match) => match[0],
    ),
    ["scripts/scheduling-profile/*.test.ts"],
    "Measured application controls must not run candidate-only workflow specs",
  );
  // This is the actual one-directory shell glob above, applied to the real
  // helper inventory rather than a fixture that could omit a misplaced test.
  const measuredFiles = readdirSync(new URL("./", import.meta.url)).filter(
    (name) => name.endsWith(".test.ts"),
  );
  assert.ok(measuredFiles.includes("applicability.test.ts"));
  for (const spec of ["applicability-workflow.spec.ts", "group-plan.spec.ts"]) {
    assert.ok(!measuredFiles.includes(spec));
    const workflow = readFileSync(workflowFile, "utf8").replaceAll("\r\n", "\n");
    const validation =
      /- name: Validate profile helpers before any applicability decision\n([\s\S]*?)(?=\n      - )/.exec(workflow)?.[1];
    assert.ok(validation);
    assert.doesNotMatch(validation, /\bif:/);
    assert.ok(
      validation.includes(`scripts/scheduling-profile/${spec}`),
      `${spec} must run even for an unmeasured or deferred decision`,
    );
  }
  const partitionAction = readFileSync(
    new URL("../../.github/actions/scheduling-profile-partition/action.yml", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const freeze = /- name: Freeze comparison inputs\n([\s\S]*?)(?=\n    - name:)/.exec(
    partitionAction,
  )?.[1];
  assert.ok(freeze);
  assert.match(
    freeze,
    /cp profile-head\/scripts\/scheduling-profile\/\* profile-base\/scripts\/scheduling-profile\//,
  );
  assert.doesNotMatch(
    freeze,
    /\.github\/workflows|profile-base\/\.github/,
    "Keep the baseline orchestrator immutable instead of copying it to satisfy tests",
  );
});

