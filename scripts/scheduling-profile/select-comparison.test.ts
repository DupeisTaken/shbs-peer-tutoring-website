import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { selectComparison } from "./select-comparison.mjs";

const base = "a".repeat(40), reviewed = "b".repeat(40), manual = "c".repeat(40);
const directory = ".github/scheduling-profile-manifests";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scheduling-selection-"));
  mkdirSync(join(root, directory), { recursive: true });
  return { root, write: (name: string, contents: string) => writeFileSync(join(root, directory, name), contents),
    close: () => rmSync(root, { recursive: true, force: true }) };
}

void test("default comparison has no implicit schema authorization", () => {
  const f = fixture();
  try { assert.deepEqual(selectComparison(f.root, { defaultBaseline: base }), {
    baseline: base, manifest: null, baselineSelectionSource: "default-baseline",
    baselineSelectionPath: null, baselineSelectionFileSha256: null,
  }); } finally { f.close(); }
});
void test("reviewed conventional files bind the selected immutable baseline and exact bytes", () => {
  const f = fixture();
  try {
    f.write("current.json", "{}"); f.write("baseline.txt", `${reviewed}\n`);
    const result = selectComparison(f.root, { defaultBaseline: base });
    assert.equal(result.baseline, reviewed);
    assert.equal(result.manifest, `${directory}/current.json`);
    assert.equal(result.baselineSelectionPath, `${directory}/baseline.txt`);
    assert.equal(result.baselineSelectionFileSha256, createHash("sha256").update(`${reviewed}\n`).digest("hex"));
  } finally { f.close(); }
});
void test("manual inputs take precedence over reviewed conventional files", () => {
  const f = fixture();
  try {
    f.write("current.json", "{}"); f.write("manual.json", "{}"); f.write("baseline.txt", "invalid ignored fallback");
    const result = selectComparison(f.root, { defaultBaseline: base, manualBaseline: manual, manualManifest: `${directory}/manual.json` });
    assert.equal(result.baseline, manual); assert.equal(result.manifest, `${directory}/manual.json`);
    assert.equal(result.baselineSelectionSource, "manual-baseline");
    assert.equal(result.baselineSelectionPath, null); assert.equal(result.baselineSelectionFileSha256, null);
  } finally { f.close(); }
});
void test("PR-scoped pairs override global defaults only for their exact PR number", () => {
  const f = fixture();
  try {
    f.write("current.json", "{}"); f.write("baseline.txt", `${base}\n`);
    f.write("pr-569.json", "{}"); f.write("pr-569-baseline.txt", `${reviewed}\n`);
    const result = selectComparison(f.root, { defaultBaseline: manual, prNumber: "569" });
    assert.equal(result.baseline, reviewed);
    assert.equal(result.manifest, `${directory}/pr-569.json`);
    assert.equal(result.baselineSelectionPath, `${directory}/pr-569-baseline.txt`);
    assert.equal(result.baselineSelectionSource, "reviewed-pr-baseline-file");
    assert.equal(result.baselineSelectionFileSha256, createHash("sha256").update(`${reviewed}\n`).digest("hex"));
    for (const prNumber of ["570", undefined, ""]) {
      const unrelated = selectComparison(f.root, { defaultBaseline: manual, prNumber });
      assert.equal(unrelated.baseline, base);
      assert.equal(unrelated.manifest, `${directory}/current.json`);
      assert.equal(unrelated.baselineSelectionSource, "reviewed-baseline-file");
    }
  } finally { f.close(); }
});
void test("manual authority bypasses even an incomplete scoped pair", () => {
  const f = fixture();
  try {
    f.write("pr-569-baseline.txt", "invalid ignored scoped fallback");
    f.write("manual.json", "{}");
    const result = selectComparison(f.root, { defaultBaseline: base, prNumber: "569", manualBaseline: manual, manualManifest: `${directory}/manual.json` });
    assert.equal(result.baseline, manual);
    assert.equal(result.manifest, `${directory}/manual.json`);
    assert.equal(result.baselineSelectionSource, "manual-baseline");
    assert.equal(result.baselineSelectionPath, null);
    // A manifest-only manual override also must not borrow a scoped pin and
    // falsely claim that its different manifest is the reviewed scoped pair.
    const manifestOnly = selectComparison(f.root, { defaultBaseline: base, prNumber: "569", manualManifest: `${directory}/manual.json` });
    assert.equal(manifestOnly.baseline, base);
    assert.equal(manifestOnly.baselineSelectionSource, "default-baseline");
    assert.equal(manifestOnly.baselineSelectionPath, null);
  } finally { f.close(); }
});
void test("incomplete scoped pairs fail closed without affecting unrelated PRs", () => {
  for (const name of ["pr-569-baseline.txt", "pr-569.json"]) {
    const f = fixture();
    try {
      f.write(name, name.endsWith(".txt") ? reviewed : "{}");
      assert.throws(() => selectComparison(f.root, { defaultBaseline: base, prNumber: "569" }), /must both exist/);
      assert.equal(selectComparison(f.root, { defaultBaseline: base, prNumber: "570" }).baseline, base);
    } finally { f.close(); }
  }
});
void test("PR numbers and scoped baseline bytes reject ambiguous or unsafe selections", () => {
  const f = fixture();
  try {
    for (const prNumber of ["0", "-1", "01", "1.0", "1e3", "569/../570", " 569", "569\n", "9007199254740992"]) {
      assert.throws(() => selectComparison(f.root, { defaultBaseline: base, prNumber }), /PR_NUMBER/);
    }
    f.write("pr-569.json", "{}"); f.write("pr-569-baseline.txt", `${reviewed}\r\n`);
    assert.throws(() => selectComparison(f.root, { defaultBaseline: base, prNumber: "569" }), /exactly one immutable SHA/);
  } finally { f.close(); }
});
void test("CLI PR_NUMBER selects the scoped pair and rejects invalid environment values", () => {
  const f = fixture();
  try {
    f.write("pr-569.json", "{}"); f.write("pr-569-baseline.txt", `${reviewed}\n`);
    const script = fileURLToPath(new URL("./select-comparison.mjs", import.meta.url));
    const env = { ...process.env, DEFAULT_BASELINE_SHA: base, MANUAL_BASELINE_SHA: "", MANUAL_SCHEMA_MANIFEST: "", PR_NUMBER: "569" };
    const selected = spawnSync(process.execPath, [script, f.root], { encoding: "utf8", env });
    assert.equal(selected.status, 0, selected.stderr);
    assert.match(selected.stdout, new RegExp(`^baseline=${reviewed}$`, "m"));
    assert.match(selected.stdout, /^manifest=\.github\/scheduling-profile-manifests\/pr-569\.json$/m);
    assert.match(selected.stdout, /^baselineSelectionSource=reviewed-pr-baseline-file$/m);
    const invalid = spawnSync(process.execPath, [script, f.root], { encoding: "utf8", env: { ...env, PR_NUMBER: "0569" } });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /PR_NUMBER/);
  } finally { f.close(); }
});
void test("baseline overrides require a manifest and reject branch names, traversal and extra content", () => {
  const f = fixture();
  try {
    f.write("baseline.txt", reviewed);
    assert.throws(() => selectComparison(f.root, { defaultBaseline: base }), /requires an exact reviewed/);
    f.write("current.json", "{}");
    for (const contents of ["main", reviewed.toUpperCase(), `${reviewed}\r\n`, `${reviewed}\n\n`, `${reviewed}\n${base}`, ` ${reviewed}`]) {
      f.write("baseline.txt", contents);
      assert.throws(() => selectComparison(f.root, { defaultBaseline: base }), /exactly one immutable SHA/);
    }
    assert.throws(() => selectComparison(f.root, { defaultBaseline: base, manualBaseline: "main" }), /immutable/);
    assert.throws(() => selectComparison(f.root, { defaultBaseline: base, manualManifest: `${directory}/../outside.json` }), /fixed directory/);
  } finally { f.close(); }
});
