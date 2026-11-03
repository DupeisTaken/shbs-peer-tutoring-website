import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
