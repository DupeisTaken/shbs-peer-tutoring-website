import assert from "node:assert/strict";
import { constants as bufferConstants } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  link,
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify, isDeepStrictEqual } from "node:util";
import { artifactInventoryHash } from "./resume-artifacts.mjs";

/** @typedef {Record<string, any>} Evidence */
const RECEIPT = "resume-identity.json";
const MAX_SMALL = 256 * 1024;
const MAX_REPORT =
  Math.min(bufferConstants.MAX_STRING_LENGTH, 512 * 1024 * 1024) - 1024;
const MAX_TOTAL = 2 * 1024 ** 3;
const run = promisify(execFile);
const hash = (/** @type {string | Buffer} */ bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const record = (/** @type {unknown} */ value) => {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Malformed resume receipt record",
  );
  return /** @type {Evidence} */ (value);
};
const digest = (/** @type {unknown} */ value, length = 64) => {
  assert.ok(
    typeof value === "string" &&
      new RegExp(`^[a-f0-9]{${length}}$`).test(value),
    "Invalid receipt digest",
  );
  return value;
};
const identifier = (/** @type {unknown} */ value) => {
  assert.ok(
    typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value),
    "Invalid receipt identifier",
  );
  return value;
};
function validateIdentity(/** @type {Evidence} */ identity) {
  assert.equal(identity.version, 1, "Unsupported resume receipt version");
  assert.match(identity.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  identifier(identity.runId);
  for (const key of ["workflowSha", "candidateRevision", "baselineRevision"])
    digest(identity[key], 40);
  for (const key of [
    "candidateSchemaSha256",
    "dependencyLockSha256",
    "comparisonSha256",
  ])
    digest(identity[key]);
  for (const key of ["campaignAttempt", "attempt"])
    assert.ok(
      Number.isSafeInteger(identity[key]) &&
        identity[key] > 0 &&
        identity[key] <= 1000,
      "Invalid receipt attempt",
    );
  assert.ok(
    identity.campaignAttempt <= identity.attempt,
    "Receipt predates campaign",
  );
  assert.ok(
    typeof identity.anchor === "string" &&
      Number.isFinite(Date.parse(identity.anchor)) &&
      new Date(identity.anchor).toISOString() === identity.anchor,
    "Invalid receipt anchor",
  );
  for (const key of ["nodeImage", "postgresImage"])
    assert.match(identity[key], /^(?:[A-Za-z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/);
  assert.match(identity.nodeImageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(identity.reportSchemaVersion, 3);
  assert.equal(identity.partitionProtocolVersion, 1);
  const slot = record(identity.slot);
  assert.match(slot.scenario, /^[a-z][a-z0-9-]{0,63}$/);
  assert.ok(
    ["latency", "diagnostic"].includes(slot.mode),
    "Invalid receipt mode",
  );
  assert.ok(
    Number.isSafeInteger(slot.partition) &&
      slot.partition >= 0 &&
      Number.isSafeInteger(slot.partitionCount) &&
      slot.partitionCount > slot.partition &&
      slot.partitionCount <= 100 &&
      Number.isSafeInteger(slot.samples) &&
      slot.samples > 0 &&
      slot.samples <= 100,
    "Invalid receipt partition",
  );
}

/** Do not follow extraction links, including a linked directory or receipt. The
 * caller supplies an owned, quiescent worker directory or freshly extracted ZIP.
 * @param {string} directory */
async function rootDirectory(directory) {
  const root = resolve(directory);
  const info = await lstat(root);
  assert.ok(
    info.isDirectory() && !info.isSymbolicLink(),
    "Receipt directory must be a real directory",
  );
  assert.equal(
    await realpath(root),
    root,
    "Receipt directory must not traverse links",
  );
  return root;
}
/** @param {string} path */
async function fileHash(path) {
  const before = await lstat(path);
  assert.ok(
    before.isFile() && !before.isSymbolicLink(),
    "Receipt inventory contains a non-regular file",
  );
  assert.ok(before.size <= 768 * 1024 * 1024, "Receipt file is too large");
  const value = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    assert.ok(
      bytes <= 768 * 1024 * 1024,
      "Receipt file grew beyond size limit",
    );
    value.update(chunk);
  }
  const after = await lstat(path);
  assert.ok(
    before.ino === after.ino &&
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs &&
      bytes === before.size,
    "Receipt file changed while hashing",
  );
  return { sha256: value.digest("hex"), size: bytes };
}
/** @param {string} root */
async function inventory(root) {
  /** @type {Record<string,string>} */ const files = {};
  let count = 0,
    total = 0;
  async function visit(/** @type {string} */ prefix) {
    const entries = await readdir(join(root, prefix), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      assert.ok(
        ++count <= 256 &&
          name.length <= 240 &&
          !/[\\:\u0000-\u001f]/.test(name) &&
          name
            .split("/")
            .every((part) => part !== "" && part !== "." && part !== ".."),
        "Unsafe or excessive receipt inventory",
      );
      assert.ok(
        !entry.isSymbolicLink(),
        "Receipt inventory must not contain links",
      );
      if (entry.isDirectory()) {
        await visit(name);
        continue;
      }
      assert.ok(
        entry.isFile(),
        "Receipt inventory must contain only regular files",
      );
      if (name === RECEIPT) continue;
      assert.ok(!name.endsWith(RECEIPT), "Nested receipt is not allowed");
      const value = await fileHash(join(root, name));
      total += value.size;
      assert.ok(total <= MAX_TOTAL, "Extracted receipt exceeds size limit");
      // An archive entry named __proto__ is data, never a prototype setter.
      Object.defineProperty(files, name, {
        value: value.sha256,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  await visit("");
  return { files, inventorySha256: artifactInventoryHash(files) };
}
/** Read telemetry only after binding these exact bytes to the inventory.
 * @param {string} path @param {string | undefined} expected */
async function smallBytes(path, expected) {
  const info = await lstat(path);
  assert.ok(
    info.isFile() && !info.isSymbolicLink() && info.size <= MAX_SMALL,
    "Receipt metadata exceeds size limit or is linked",
  );
  const handle = await open(path, "r");
  let bytes;
  try {
    const buffer = Buffer.alloc(MAX_SMALL + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const part = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (part.bytesRead === 0) break;
      offset += part.bytesRead;
    }
    assert.ok(offset <= MAX_SMALL, "Receipt metadata exceeds size limit");
    bytes = buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
  if (expected !== undefined)
    assert.equal(hash(bytes), expected, "Receipt metadata changed");
  return bytes;
}
/** @param {string} root @param {Record<string,string>} files */
async function phases(root, files) {
  /** @type {Evidence} */ const result = {};
  for (const arm of ["base", "head"]) {
    /** @type {Evidence} */ const value = {};
    for (const [key, suffix] of [
      ["status", "phase-status.json"],
      ["exit", "command-exit.json"],
      ["budget", "budget.json"],
      ["events", "phase-events.jsonl"],
    ]) {
      assert.ok(key && suffix);
      const name = `${arm}-${suffix}`;
      if (!Object.hasOwn(files, name)) continue;
      const text = (await smallBytes(join(root, name), files[name])).toString(
        "utf8",
      );
      value[key] =
        key === "events"
          ? text
              .split(/\r?\n/)
              .filter((line) => line.trim() !== "")
              .map((line) => JSON.parse(line))
          : JSON.parse(text);
      if (key === "events")
        assert.ok(value[key].length <= 128, "Excessive phase telemetry");
    }
    if (Object.keys(value).length) result[arm] = value;
  }
  return result;
}
/** A single disposable child owns each large JSON parse. Neither campaign nor
 * resume selection retains report graphs, receipt bodies or sample arrays.
 * @param {string} path @param {string} expected */
async function reportSummary(path, expected) {
  const result = await run(
    process.execPath,
    [
      "--max-old-space-size=3072",
      fileURLToPath(import.meta.url),
      "--compact-report",
      path,
      expected,
    ],
    {
      env: { ...process.env, NODE_OPTIONS: "" },
      timeout: 30_000,
      maxBuffer: MAX_SMALL,
      windowsHide: true,
      encoding: "utf8",
    },
  );
  return record(JSON.parse(result.stdout));
}
/** @param {string} root @param {Evidence} identity @param {Record<string,string>} files */
async function reports(root, identity, files) {
  /** @type {Evidence} */ const result = {};
  for (const arm of ["base", "head", "native"]) {
    const name =
      arm === "native"
        ? "base-native-latency.json"
        : `${arm}-${identity.slot.mode}.json`;
    const expected = files[name];
    if (expected !== undefined)
      result[arm] = await reportSummary(join(root, name), expected);
  }
  return result;
}
/** Seal in the worker BEFORE upload. Never reseal a historical archive to make
 * it reusable. The archive digest must authenticate the receipt itself. The
 * return value is pre-upload metadata; archive identity exists only after upload.
 * @param {string} directory @param {Evidence} identityWithoutFiles */
export async function sealReceipt(directory, identityWithoutFiles) {
  const root = await rootDirectory(directory);
  const identity = { ...record(identityWithoutFiles) };
  assert.ok(
    !Object.hasOwn(identity, "files") && !Object.hasOwn(identity, "reports"),
    "Caller must not supply sealed evidence",
  );
  validateIdentity(identity);
  try {
    await lstat(join(root, RECEIPT));
    assert.fail("Receipt is already sealed");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT")
      throw error;
  }
  const values = await inventory(root);
  const compact = await reports(root, identity, values.files);
  const phaseFiles = await phases(root, values.files);
  const check = await inventory(root);
  assert.ok(
    isDeepStrictEqual(values.files, check.files),
    "Worker files changed before sealing",
  );
  const sealed = { ...identity, files: values.files, reports: compact };
  const bytes = Buffer.from(`${JSON.stringify(sealed, null, 2)}\n`);
  assert.ok(bytes.length <= MAX_SMALL, "Receipt metadata exceeds size limit");
  const temporary = join(dirname(root), `.resume-receipt-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    // Hard-link publication is atomic and cannot overwrite another sealed receipt.
    await link(temporary, join(root, RECEIPT));
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return {
    identity: sealed,
    identitySha256: hash(bytes),
    ...values,
    phaseFiles,
    reports: compact,
  };
}
/** Read ONLY a fresh extraction of a GitHub digest-verified archive. Checking a
 * local envelope alone cannot establish the provider origin of its summaries.
 * @param {string} directory @param {Evidence} archive */
export async function readReceipt(directory, archive) {
  const root = await rootDirectory(directory);
  const bytes = await smallBytes(join(root, RECEIPT), undefined);
  const identity = record(JSON.parse(bytes.toString("utf8")));
  validateIdentity(identity);
  const values = await inventory(root);
  assert.ok(
    isDeepStrictEqual(record(identity.files), values.files),
    "Receipt file inventory mismatch",
  );
  const compact = record(identity.reports);
  const expectedNames = new Map(
    ["base", "head", "native"].map((arm) => [
      arm,
      arm === "native"
        ? "base-native-latency.json"
        : `${arm}-${identity.slot.mode}.json`,
    ]),
  );
  assert.ok(
    Object.keys(compact).every((arm) => expectedNames.has(arm)),
    "Unknown compact report",
  );
  for (const [arm, name] of expectedNames) {
    assert.equal(
      Object.hasOwn(compact, arm),
      Object.hasOwn(values.files, name),
      "Missing or extra compact report",
    );
    if (Object.hasOwn(compact, arm))
      assert.equal(
        record(compact[arm]).fileSha256,
        values.files[name],
        "Compact report digest mismatch",
      );
  }
  assert.equal(archive.repository, identity.repository);
  assert.equal(archive.runId, identity.runId);
  assert.equal(archive.attempt, identity.attempt);
  identifier(archive.artifactId);
  const archiveSha256 =
    archive.archiveSha256 ??
    (typeof archive.digest === "string"
      ? archive.digest.replace(/^sha256:/, "")
      : undefined);
  digest(archiveSha256);
  const archiveSize = archive.archiveSize ?? archive.size;
  assert.ok(
    Number.isSafeInteger(archiveSize) &&
      archiveSize > 0 &&
      archiveSize <= 1024 ** 3,
    "Invalid archive size",
  );
  assert.equal(
    archive.name,
    `scheduling-profile-${identity.slot.scenario}-${identity.slot.mode}-part-${identity.slot.partition}-${identity.attempt}`,
  );
  return {
    repository: archive.repository,
    runId: archive.runId,
    attempt: archive.attempt,
    artifactId: archive.artifactId,
    name: archive.name,
    archiveSha256,
    archiveSize,
    identitySha256: hash(bytes),
    ...values,
    identity,
    phaseFiles: await phases(root, values.files),
    reports: compact,
  };
}

/** Runs only in the bounded parser subprocess. Hash the exact parsed bytes so a
 * source change between the inventory and parse cannot authenticate a new graph.
 * Failed/partial reports retain their real compact evidence; selection rejects
 * them rather than silently treating a zero-sample report as premeasurement.
 * @param {string} path @param {string} expected */
async function compactReport(path, expected) {
  const info = await lstat(path);
  assert.ok(
    info.isFile() && !info.isSymbolicLink() && info.size <= MAX_REPORT,
    "Report exceeds bounded parser limit",
  );
  const bytes = await readFile(path);
  assert.ok(bytes.length <= MAX_REPORT, "Report exceeds bounded parser limit");
  assert.equal(
    hash(bytes),
    expected,
    "Report changed before compact extraction",
  );
  const raw = record(JSON.parse(bytes.toString("utf8")));
  const pick = (/** @type {Evidence} */ value, /** @type {string[]} */ keys) =>
    Object.fromEntries(
      keys
        .filter((key) => Object.hasOwn(value, key))
        .map((key) => [key, value[key]]),
    );
  const array = (/** @type {unknown} */ value, /** @type {string} */ label) => {
    assert.ok(Array.isArray(value), `Report is missing raw ${label}`);
    return value;
  };
  const samples = array(record(raw.metrics).samples, "samples");
  const timings = array(raw.phaseTimings, "phase timings");
  const receipts = array(raw.receipts, "receipts");
  const result = {
    ...pick(raw, [
      "status",
      "schemaVersion",
      "partitionProtocolVersion",
      "revision",
      "mode",
      "transport",
      "captureSchema",
      "partition",
      "samplingComplete",
      "partitionComplete",
      "latencyComparisonEligible",
      "startedAt",
      "finishedAt",
      "elapsedMs",
      "timeoutMs",
    ]),
    fileSha256: expected,
    fixture: pick(record(raw.fixture), [
      "anchor",
      "clockAdmission",
      "scenarios",
      "samples",
    ]),
    databaseClock:
      raw.databaseClock === undefined
        ? {}
        : pick(record(raw.databaseClock), ["startedAt", "finishedAt"]),
    profileRunner: pick(record(raw.profileRunner), ["id"]),
    receiptCount: receipts.length,
    hasFailure: ["failure", "error", "parityFailure"].some((key) =>
      Object.hasOwn(raw, key),
    ),
    cleanupErrorCount:
      raw.cleanupErrors === undefined
        ? 0
        : array(raw.cleanupErrors, "cleanup errors").length,
    unfinishedSampleCount: samples.filter(
      (sample) => record(sample).status === "unfinished",
    ).length,
    censoredSampleCount: samples.filter(
      (sample) =>
        record(sample).censored !== false ||
        sample.elapsedIsLowerBound !== false,
    ).length,
    incompletePhaseCount: timings.filter(
      (phase) =>
        record(phase).status !== "completed" ||
        phase.elapsedIsLowerBound !== false,
    ).length,
  };
  const output = JSON.stringify(result);
  assert.ok(
    Buffer.byteLength(output) <= MAX_SMALL,
    "Compact report exceeds metadata limit",
  );
  process.stdout.write(output);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 5 || process.argv[2] !== "--compact-report")
    throw new Error("Internal compact report parser only");
  assert.ok(process.argv[3]);
  await compactReport(process.argv[3], digest(process.argv[4]));
}
