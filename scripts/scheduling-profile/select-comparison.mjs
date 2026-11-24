import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const manifestPattern = /^\.github\/scheduling-profile-manifests\/[a-zA-Z0-9_-]+\.json$/;
const baselinePath = ".github/scheduling-profile-manifests/baseline.txt";
const defaultManifest = ".github/scheduling-profile-manifests/current.json";
/** @param {string} value */
const immutable = (value) => {
  assert.ok(value.length === 40 && /^[0-9a-f]{40}$/.test(value), "Comparison revisions must be immutable lowercase commit SHAs");
  return value;
};
/** Select only explicit reviewed paths; this does not authorize their schema or
 * dependency delta. Comparison and admission helpers still validate every byte.
 * @param {string} root
 * @param {{defaultBaseline:string, manualBaseline?:string, manualManifest?:string, manualAdmissionManifest?:string, prNumber?:string}} options
 */
export function selectComparison(root, options) {
  const defaultBaseline = immutable(options.defaultBaseline);
  let baseline = defaultBaseline;
  let selectedPath = null;
  let selectedHash = null;
  let catalogPath = null;
  let source = "default-baseline";
  let manifest = options.manualManifest || null;
  let admissionManifest = options.manualAdmissionManifest || null;
  let admissionManifestFileSha256 = null;
  const prNumber = options.prNumber ?? "";
  assert.ok(typeof prNumber === "string" && (prNumber === "" ||
    /^[1-9][0-9]*$/.test(prNumber) && Number.isSafeInteger(Number(prNumber))),
  "PR_NUMBER must be a positive decimal safe integer without leading zeroes");
  assert.ok(!(options.manualManifest && options.manualAdmissionManifest),
    "Manual schema manifest and admission manifest are mutually exclusive");
  // Explicit manual authority bypasses scoped discovery as one selection. This
  // prevents a different manual manifest being labelled as a matched PR pair.
  const hasManualOverride = Boolean(options.manualBaseline || options.manualManifest || options.manualAdmissionManifest);
  if (prNumber && !hasManualOverride) {
    const scopedBaseline = `.github/scheduling-profile-manifests/pr-${prNumber}-baseline.txt`;
    const scopedManifest = `.github/scheduling-profile-manifests/pr-${prNumber}.json`;
    const scopedCatalog = `.github/scheduling-profile-manifests/pr-${prNumber}-catalog-baseline.txt`;
    const scopedAdmission = `.github/scheduling-profile-manifests/pr-${prNumber}-admission.json`;
    const hasBaseline = existsSync(resolve(root, scopedBaseline));
    const hasManifest = existsSync(resolve(root, scopedManifest));
    const hasCatalog = existsSync(resolve(root, scopedCatalog));
    const hasAdmission = existsSync(resolve(root, scopedAdmission));
    assert.ok(!hasAdmission || (!hasBaseline && !hasManifest && !hasCatalog),
      "PR-scoped admission manifest cannot coexist with PR-scoped baseline or schema manifests");
    assert.equal(hasBaseline, hasManifest, "PR-scoped baseline and reviewed manifest must both exist");
    assert.ok(!hasCatalog || hasBaseline && hasManifest, "PR-scoped catalog baseline requires its ordinary baseline and reviewed manifest pair");
    if (hasAdmission) {
      admissionManifest = scopedAdmission;
    } else if (hasBaseline) {
      selectedPath = scopedBaseline;
      manifest = scopedManifest;
      source = "reviewed-pr-baseline-file";
      if (hasCatalog) catalogPath = scopedCatalog;
    }
  }
  if (admissionManifest) {
    assert.match(admissionManifest, manifestPattern, "Reviewed admission manifest path is outside the fixed directory");
    assert.ok(lstatSync(resolve(root, admissionManifest)).isFile(), "Reviewed admission manifest must be a regular file");
    admissionManifestFileSha256 = createHash("sha256").update(readFileSync(resolve(root, admissionManifest))).digest("hex");
    if (options.manualBaseline) {
      baseline = immutable(options.manualBaseline);
      source = "manual-baseline";
    }
    return {
      baseline, manifest: null, baselineSelectionSource: source,
      baselineSelectionPath: null, baselineSelectionFileSha256: null,
      catalogBaseline: baseline, catalogBaselineSelectionPath: null,
      catalogBaselineSelectionFileSha256: null, catalogBaselineSelectionSource: source,
      admissionManifest, admissionManifestFileSha256,
    };
  }
  if (manifest) assert.match(manifest, manifestPattern, "Reviewed manifest path is outside the fixed directory");
  else if (existsSync(resolve(root, defaultManifest))) manifest = defaultManifest;
  if (manifest) assert.ok(lstatSync(resolve(root, manifest)).isFile(), "Reviewed manifest must be a regular file");
  if (options.manualBaseline) {
    baseline = immutable(options.manualBaseline);
    source = "manual-baseline";
  } else if (selectedPath || existsSync(resolve(root, baselinePath))) {
    if (!selectedPath) {
      selectedPath = baselinePath;
      source = "reviewed-baseline-file";
    }
    assert.ok(lstatSync(resolve(root, selectedPath)).isFile(), "Reviewed baseline must be a regular file");
    const bytes = readFileSync(resolve(root, selectedPath));
    const contents = bytes.toString("utf8");
    assert.ok((contents.length === 40 || contents.length === 41) && /^[0-9a-f]{40}\n?$/.test(contents), "Reviewed baseline requires exactly one immutable SHA, optionally followed by LF");
    baseline = immutable(contents.replace(/\n$/, ""));
    selectedHash = createHash("sha256").update(bytes).digest("hex");
  }
  if (selectedPath || baseline !== defaultBaseline)
    assert.ok(manifest, "Overriding the default baseline requires an exact reviewed schema manifest");
  let catalogBaseline = baseline;
  let catalogHash = selectedHash;
  let catalogSource = source;
  if (catalogPath) {
    assert.ok(lstatSync(resolve(root, catalogPath)).isFile(), "Reviewed catalog baseline must be a regular file");
    const bytes = readFileSync(resolve(root, catalogPath));
    const contents = bytes.toString("utf8");
    assert.ok(bytes.length === 41 && /^[0-9a-f]{40}\n$/.test(contents), "Reviewed catalog baseline requires exactly one immutable SHA followed by LF");
    catalogBaseline = immutable(contents.slice(0, -1));
    catalogHash = createHash("sha256").update(bytes).digest("hex");
    catalogSource = "reviewed-pr-catalog-baseline-file";
  }
  return { baseline, manifest, baselineSelectionSource: source,
    baselineSelectionPath: selectedPath, baselineSelectionFileSha256: selectedHash,
    catalogBaseline, catalogBaselineSelectionPath: catalogPath ?? selectedPath,
    catalogBaselineSelectionFileSha256: catalogHash, catalogBaselineSelectionSource: catalogSource,
    admissionManifest: null, admissionManifestFileSha256: null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, "Usage: select-comparison.mjs <candidate-checkout>");
  const candidateRoot = process.argv[2];
  assert.ok(candidateRoot, "Require a candidate checkout path");
  const selected = selectComparison(candidateRoot, {
    defaultBaseline: process.env.DEFAULT_BASELINE_SHA ?? "",
    manualBaseline: process.env.MANUAL_BASELINE_SHA,
    manualManifest: process.env.MANUAL_SCHEMA_MANIFEST,
    manualAdmissionManifest: process.env.MANUAL_ADMISSION_MANIFEST,
    prNumber: process.env.PR_NUMBER,
  });
  for (const [key, value] of Object.entries(selected)) process.stdout.write(`${key}=${value ?? ""}\n`);
}
