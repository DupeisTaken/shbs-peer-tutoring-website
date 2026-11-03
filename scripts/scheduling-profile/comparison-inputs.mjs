import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const migration = "20261103030000_scheduling_maintenance";
const metadataModels = ["SchedulingMaintenanceState", "SchedulingDirtyEvent"];
/** @param {string | Buffer} bytes */
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** @param {string} root @param {string} path */
const read = (root, path) => readFileSync(resolve(root, path));
/** @param {Buffer} bytes */
const normalized = (bytes) => bytes.toString("utf8").replaceAll("\r\n", "\n").trim();

/** @typedef {{ version: 1, baselineSchemaSha256: string, candidateSchemaSha256: string,
 * dependencyLockSha256: string, addedMigrations: { path: string, sha256: string }[],
 * historicalMigrations: Record<string, string> }} ReviewedSchemaDeltaManifest */

/** @param {unknown} value @param {string} label @returns {Record<string, unknown>} */
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const prototype = /** @type {unknown} */ (Object.getPrototypeOf(value));
  assert.ok(prototype === Object.prototype || prototype === null, `${label} must be a plain object`);
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} label */
function sha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`${label} must be a lowercase SHA256 digest`);
  return value;
}

/** New overlay destinations remain timestamped. The exact legacy bootstrap is
 * accepted only while validating historical/inventory entries, never additions.
 * @param {unknown} value @param {string} label @param {boolean} [historical] */
function migrationPath(value, label, historical = false) {
  if (typeof value !== "string" ||
      !(historical && value === "prisma/migrations/0_init/migration.sql") &&
      !/^prisma\/migrations\/[0-9]{14}_[A-Za-z0-9_-]+\/migration\.sql$/.test(value))
    throw new Error(`${label} must be an exact normalized migration.sql path`);
  return value;
}

/** Validate and copy into one canonical representation before hashing. No
 * candidate-owned manifest is discovered or accepted implicitly.
 * @param {unknown} value @returns {ReviewedSchemaDeltaManifest} */
function reviewedDelta(value) {
  const input = record(value, "Reviewed schema manifest");
  assert.deepEqual(Object.keys(input).sort(), [
    "version", "baselineSchemaSha256", "candidateSchemaSha256",
    "dependencyLockSha256", "addedMigrations", "historicalMigrations",
  ].sort(), "Reviewed schema manifest has missing or unrecognized fields");
  assert.equal(input.version, 1, "Unsupported reviewed schema manifest version");
  assert.ok(Array.isArray(input.addedMigrations), "Reviewed addedMigrations must be an array");
  const additions = /** @type {unknown[]} */ (input.addedMigrations);
  const addedMigrations = additions.map((value) => {
    const entry = record(value, "Reviewed added migration");
    assert.deepEqual(Object.keys(entry).sort(), ["path", "sha256"], "Reviewed added migration has unrecognized fields");
    return { path: migrationPath(entry.path, "Added migration path"), sha256: sha256(entry.sha256, "Added migration hash") };
  }).sort((left, right) => left.path.localeCompare(right.path));
  assert.equal(new Set(addedMigrations.map((entry) => entry.path)).size, addedMigrations.length,
    "Duplicate reviewed added migration path");
  const historical = record(input.historicalMigrations, "Reviewed historical migrations");
  const historicalMigrations = Object.fromEntries(Object.entries(historical).sort(([a], [b]) => a.localeCompare(b)).map(([path, hash]) => [
    migrationPath(path, "Historical migration path", true), sha256(hash, "Historical migration hash"),
  ]));
  assert.ok(addedMigrations.every((entry) => !(entry.path in historicalMigrations)),
    "An added migration cannot replace a historical migration");
  for (const entry of addedMigrations) Object.freeze(entry);
  Object.freeze(addedMigrations);
  Object.freeze(historicalMigrations);
  return Object.freeze({
    version: 1,
    baselineSchemaSha256: sha256(input.baselineSchemaSha256, "Baseline schema hash"),
    candidateSchemaSha256: sha256(input.candidateSchemaSha256, "Candidate schema hash"),
    dependencyLockSha256: sha256(input.dependencyLockSha256, "Dependency lock hash"),
    addedMigrations,
    historicalMigrations,
  });
}

/** Reviewed mode inventories every migration directory and rejects ignored files
 * or links that could otherwise escape the declared SQL inventory. The lock
 * file is compared separately because it is configuration, not a SQL migration.
 * @param {string} root */
function reviewedInventory(root) {
  const entries = readdirSync(resolve(root, "prisma/migrations"), { withFileTypes: true });
  /** @type {string[]} */
  const paths = [];
  /** @type {Buffer | undefined} */
  let lock;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const path = migrationPath(`prisma/migrations/${entry.name}/migration.sql`, "Inventory migration path", true);
      const files = readdirSync(resolve(root, "prisma/migrations", entry.name), { withFileTypes: true });
      assert.ok(files.length === 1 && files[0]?.name === "migration.sql" && files[0].isFile(),
        `Unreviewed migration directory contents: ${entry.name}`);
      paths.push(path);
    } else {
      assert.ok(entry.isFile() && entry.name === "migration_lock.toml", "Unreviewed migration root entry");
      lock = read(root, "prisma/migrations/migration_lock.toml");
    }
  }
  return { paths: paths.sort(), lock };
}

/** Exact identical inputs need no overlay. Otherwise only the first introduction
 * of the reviewed appended metadata is allowed. Identical mode compares schema,
 * lockfile and migration bytes exactly (including CRLF); both checkouts share OS.
 * The additive overlay is an explicit control, never a runtime source patch.
 * @param {string} baseline
 * @param {string} candidate
 * @param {unknown} [reviewedManifest] Explicit reviewed data only; never auto-discovered.
 */
export function inspectComparisonInputs(baseline, candidate, reviewedManifest) {
  assert.deepEqual(read(baseline, "package-lock.json"), read(candidate, "package-lock.json"), "Dependency lockfiles differ");
  const originalSchema = read(baseline, "prisma/schema.prisma");
  const candidateSchema = read(candidate, "prisma/schema.prisma");
  const baselineText = normalized(originalSchema);
  const candidateText = normalized(candidateSchema);
  /** @param {string} root */
  const migrationNames = (root) => readdirSync(resolve(root, "prisma/migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const before = migrationNames(baseline);
  const after = migrationNames(candidate);
  const reviewed = reviewedManifest === undefined ? undefined : reviewedDelta(reviewedManifest);
  const identical = originalSchema.equals(candidateSchema);
  const mode = reviewed ? "reviewed" : identical ? "identical" : "additive";
  /** @type {string | null} */
  let migrationLockSha256 = null;
  if (reviewed) {
    assert.equal(digest(originalSchema), reviewed.baselineSchemaSha256, "Reviewed baseline schema hash differs");
    assert.equal(digest(candidateSchema), reviewed.candidateSchemaSha256, "Reviewed candidate schema hash differs");
    assert.equal(digest(read(baseline, "package-lock.json")), reviewed.dependencyLockSha256, "Reviewed dependency lock hash differs");
    const baselineInventory = reviewedInventory(baseline);
    const candidateInventory = reviewedInventory(candidate);
    assert.deepEqual(baselineInventory.paths, Object.keys(reviewed.historicalMigrations).sort(),
      "Reviewed historical inventory differs from the complete baseline");
    assert.deepEqual(candidateInventory.paths,
      [...baselineInventory.paths, ...reviewed.addedMigrations.map((entry) => entry.path)].sort(),
      "Reviewed candidate inventory differs; migrations were added, removed or renamed");
    assert.deepEqual(baselineInventory.lock, candidateInventory.lock, "Migration lock files differ");
    migrationLockSha256 = baselineInventory.lock ? digest(baselineInventory.lock) : null;
    for (const [path, expected] of Object.entries(reviewed.historicalMigrations)) {
      assert.equal(digest(read(baseline, path)), expected, `Reviewed historical baseline hash differs: ${path}`);
      assert.equal(digest(read(candidate, path)), expected, `Reviewed historical candidate hash differs: ${path}`);
    }
    for (const { path, sha256: expected } of reviewed.addedMigrations)
      assert.equal(digest(read(candidate, path)), expected, `Reviewed added migration hash differs: ${path}`);
  } else if (identical) {
    // This path remains valid after the metadata feature has merged. It permits
    // neither a migration-only change nor modifications to existing metadata.
    assert.deepEqual(after, before, "Identical-schema comparison requires the exact same migration list");
  } else {
    const stripped = candidateText.replace(
      /^model (SchedulingMaintenanceState|SchedulingDirtyEvent)\s*\{[^}]*\}/gm,
      "",
    );
    // Only appended metadata declarations/comments may differ. This deliberately
    // rejects edits to existing domain models, even when Prisma would accept them.
    assert.ok(candidateText.startsWith(baselineText), "Candidate edits an existing schema block");
    const appended = stripped.slice(baselineText.length).replace(/^\s*\/\/.*$/gm, "").trim();
    assert.equal(appended, "", "Unreviewed schema additions");
    for (const model of metadataModels) {
      const occurrences = [...candidateText.matchAll(new RegExp(`^model ${model}\\s*\\{`, "gm"))];
      assert.equal(occurrences.length, 1, `Expected one metadata model ${model}`);
      assert.ok(!new RegExp(`^model ${model}\\s*\\{`, "m").test(baselineText), "Baseline already has metadata; select the pre-change baseline");
    }
    assert.deepEqual(after.filter((name) => !before.includes(name)), [migration], "Only the reviewed additive scheduling migration may be overlaid");
    assert.ok(before.every((name) => after.includes(name)), "Candidate removed a migration");
  }
  const historicalMigrations = Object.fromEntries(before.map((name) => {
    const path = `prisma/migrations/${name}/migration.sql`;
    const originalBytes = read(baseline, path);
    const candidateBytes = read(candidate, path);
    if (reviewed || identical) assert.deepEqual(originalBytes, candidateBytes, `Historical migration changed: ${name}`);
    else assert.equal(normalized(originalBytes), normalized(candidateBytes), `Historical migration changed: ${name}`);
    return [path, digest(originalBytes)];
  }));
  const candidateMigrationHashes = Object.fromEntries(after.map((name) => {
    const path = `prisma/migrations/${name}/migration.sql`;
    return [path, digest(read(candidate, path))];
  }));
  const overlayPaths = reviewed
    ? ["prisma/schema.prisma", ...reviewed.addedMigrations.map((entry) => entry.path)]
    : identical ? [] : ["prisma/schema.prisma", `prisma/migrations/${migration}/migration.sql`];
  return {
    mode,
    requiresNativeSchemaControl: mode !== "identical",
    interpretation: reviewed
      ? "The explicitly supplied reviewed manifest pins both schema versions, dependencies and every SQL migration byte. Baseline application sources remain unchanged under the reviewed candidate schema. This is a shared-schema control, separate from pristine native-schema measurements; no baseline support or semantic parity is inferred for new-only scenarios."
      : identical
      ? "Both application revisions already have byte-identical schemas and migration chains. No overlay or original-schema control is required."
      : "Old and optimized application sources run under the identical new metadata schema/triggers. This isolates application changes; the separately labelled native-schema cold baseline measures the old schema before the overlay.",
    originalSchemaSha256: digest(originalSchema),
    candidateSchemaSha256: digest(candidateSchema),
    originalLockfileSha256: digest(read(baseline, "package-lock.json")),
    candidateLockfileSha256: digest(read(candidate, "package-lock.json")),
    historicalMigrations,
    candidateMigrationHashes,
    migrationLockSha256,
    reviewedManifest: reviewed ?? null,
    reviewedManifestSha256: reviewed ? digest(JSON.stringify(reviewed)) : null,
    overlayHashes: Object.fromEntries(overlayPaths.map((path) => [path, digest(read(candidate, path))])),
    overlayPaths,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baseline, candidate, receipt, action = "inspect", reviewedManifestPath, ...extra] = process.argv.slice(2);
  assert.ok(baseline && candidate && receipt && ["inspect", "apply"].includes(action) && extra.length === 0,
    "Usage: comparison-inputs.mjs BASELINE CANDIDATE RECEIPT [inspect|apply] [EXPLICIT_REVIEWED_MANIFEST]");
  const reviewedBytes = reviewedManifestPath ? readFileSync(resolve(reviewedManifestPath)) : undefined;
  const reviewedManifest = reviewedBytes ? /** @type {unknown} */ (JSON.parse(reviewedBytes.toString("utf8"))) : undefined;
  const manifest = inspectComparisonInputs(baseline, candidate, reviewedManifest);
  /** @param {...string} args */
  const git = (...args) => execFileSync("git", args, { cwd: baseline, encoding: "utf8" });
  assert.equal(git("diff", "--name-only", "HEAD", "--", "src").trim(), "", "Baseline runtime source differs from its commit");
  const sourcePaths = git("ls-files", "src").trim().split(/\r?\n/).filter(Boolean);
  const originalSourceHashes = Object.fromEntries(sourcePaths.map((path) => [path, digest(read(baseline, path))]));
  if (action === "apply") {
    for (const path of manifest.overlayPaths) {
      mkdirSync(dirname(resolve(baseline, path)), { recursive: true });
      copyFileSync(resolve(candidate, path), resolve(baseline, path));
    }
    for (const [path, hash] of Object.entries(originalSourceHashes))
      assert.equal(digest(read(baseline, path)), hash, `Overlay changed runtime source: ${path}`);
  }
  mkdirSync(dirname(resolve(receipt)), { recursive: true });
  writeFileSync(receipt, JSON.stringify({ ...manifest,
    baselineSelectionPath: process.env.PROFILE_BASELINE_SELECTION_PATH || null,
    baselineSelectionFileSha256: process.env.PROFILE_BASELINE_SELECTION_FILE_SHA256 || null,
    baselineSelectionSource: process.env.PROFILE_BASELINE_SELECTION_SOURCE || "explicit-cli",
    reviewedManifestPath: reviewedManifestPath ? relative(resolve(candidate), resolve(reviewedManifestPath)).replaceAll("\\", "/") : null,
    reviewedManifestFileSha256: reviewedBytes ? digest(reviewedBytes) : null,
    action, baselineRevision: git("rev-parse", "HEAD").trim(), originalSourceHashes }, null, 2) + "\n");
}
