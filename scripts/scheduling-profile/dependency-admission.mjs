import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";

/** Non-dependency paths from .github/workflows/scheduling-profile.yml plus
 * execution-affecting config files. Verified against the workflow YAML in
 * scripts/scheduling-profile/group-plan.spec.ts so trigger lists never drift. */
export const SCHEDULING_TRIGGER_PATHS = Object.freeze([
  ".github/workflows/scheduling-profile.yml",
  ".github/workflows/scheduling-profile-worker.yml",
  ".github/actions/scheduling-profile-partition/**",
  ".github/scheduling-profile-manifests/**",
  "scripts/profile-scheduling-requests.ts",
  "scripts/scheduling-profile/**",
  "scripts/run-scheduling-profile-ci.sh",
  "src/server/session-planning/**",
  "src/server/room-allocation.ts",
  "src/server/ordered-pairing-release.ts",
  "src/server/bulk-room-allocation.ts",
  "src/server/api/routers/admin.ts",
  "src/server/api/routers/tutor.ts",
  "src/server/database-options.ts",
  "src/lib/program-time.ts",
  "src/lib/school-calendar.ts",
  "prisma/**",
]);

const EXTRA_RUNTIME_CONFIG_FILES = new Set([
  "tsconfig.json",
  "prisma.config.ts",
  "Dockerfile",
  ".npmrc",
]);

/** Mandatory runtime/harness/Prisma packages invoked by the profiling workflow
 * even when not statically imported by a single TypeScript entrypoint. */
export const MANDATORY_SCHEDULING_ROOT_PACKAGES = Object.freeze([
  "tsx",
  "prisma",
  "@prisma/client",
  "@prisma/adapter-pg",
  "pg",
  "dotenv",
  "js-yaml",
  "typescript",
  "server-only",
]);

const PACKAGE_DEPENDENCY_SECTIONS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
]);

const ADMISSION_MANIFEST_DISPOSITION = "NOT_APPLICABLE_NON_SCHEDULING_DEPENDENCY";
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;

/** @param {string | Buffer} bytes */
const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** @param {unknown} value @param {string} label @returns {Record<string, unknown>} */
function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  const proto = /** @type {unknown} */ (Object.getPrototypeOf(value));
  assert.ok(proto === Object.prototype || proto === null, `${label} must be a plain object`);
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @param {string} label */
function sha256Field(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`${label} must be a lowercase 64-character SHA256 digest`);
  return value;
}

/** @param {unknown} value @param {string} label */
function commitShaField(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value))
    throw new Error(`${label} must be a lowercase 40-character commit SHA`);
  return value;
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function deepEqual(left, right) {
  try {
    assert.deepStrictEqual(left, right);
    return true;
  } catch {
    return false;
  }
}

/** Validate a reviewed non-scheduling dependency admission manifest strictly.
 * @param {unknown} raw */
export function parseAdmissionManifest(raw) {
  const input = plainObject(raw, "Reviewed admission manifest");
  assert.deepEqual(
    Object.keys(input).sort(),
    [
      "version",
      "disposition",
      "baselineRevision",
      "baselinePackageJsonSha256",
      "candidatePackageJsonSha256",
      "baselineDependencyLockSha256",
      "candidateDependencyLockSha256",
      "changedPackages",
      "reason",
    ].sort(),
    "Reviewed admission manifest has missing or unrecognized fields",
  );
  assert.equal(input.version, 1, "Unsupported reviewed admission manifest version");
  assert.equal(input.disposition, ADMISSION_MANIFEST_DISPOSITION, "Unsupported reviewed admission disposition");
  const baselineRevision = commitShaField(input.baselineRevision, "baselineRevision");
  const baselinePackageJsonSha256 = sha256Field(input.baselinePackageJsonSha256, "baselinePackageJsonSha256");
  const candidatePackageJsonSha256 = sha256Field(input.candidatePackageJsonSha256, "candidatePackageJsonSha256");
  const baselineDependencyLockSha256 = sha256Field(input.baselineDependencyLockSha256, "baselineDependencyLockSha256");
  const candidateDependencyLockSha256 = sha256Field(input.candidateDependencyLockSha256, "candidateDependencyLockSha256");
  assert.ok(Array.isArray(input.changedPackages) && input.changedPackages.length > 0,
    "Reviewed admission manifest changedPackages must be a non-empty array");
  const changedPackages = input.changedPackages.map((entry) => {
    if (typeof entry !== "string" || !PACKAGE_NAME_PATTERN.test(entry))
      throw new Error(`Invalid package name in changedPackages: ${String(entry)}`);
    return entry;
  });
  const sortedPackages = [...new Set(changedPackages)].sort();
  assert.deepEqual(changedPackages, sortedPackages,
    "Reviewed admission manifest changedPackages must be unique and sorted");
  assert.ok(typeof input.reason === "string" && input.reason.trim().length > 0 && input.reason.length <= 500,
    "Reviewed admission manifest reason must be a concise non-empty string (<= 500 chars)");
  return Object.freeze({
    version: /** @type {const} */ (1),
    disposition: /** @type {"NOT_APPLICABLE_NON_SCHEDULING_DEPENDENCY"} */ (ADMISSION_MANIFEST_DISPOSITION),
    baselineRevision,
    baselinePackageJsonSha256,
    candidatePackageJsonSha256,
    baselineDependencyLockSha256,
    candidateDependencyLockSha256,
    changedPackages: Object.freeze(sortedPackages),
    reason: input.reason.trim(),
  });
}

/** @param {string} filePath @param {string} pattern */
function matchesWorkflowPattern(filePath, pattern) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return filePath === prefix || filePath.startsWith(`${prefix}/`);
  }
  return filePath === pattern;
}

/** List tracked files in a git checkout, falling back to a recursive file walk
 * for synthetic non-git fixtures.
 * @param {string} root */
function listCheckoutFiles(root) {
  const absRoot = path.resolve(root);
  if (existsSync(path.join(absRoot, ".git"))) {
    const out = execFileSync("git", ["ls-files", "-z"], { cwd: absRoot, encoding: "utf8" });
    return out.split("\0").filter(Boolean).sort();
  }
  /** @type {string[]} */
  const files = [];
  /** @param {string} dir @param {string} rel */
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".next" ||
        entry.name === "outputs" || entry.name === ".validation" || entry.name === "generated") continue;
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      const nextAbs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(nextAbs, nextRel);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(nextRel);
    }
  };
  walk(absRoot, "");
  return files.sort();
}

/** Return sorted relative paths whose contents or presence differ between two checkouts.
 * @param {string} baselineRoot @param {string} candidateRoot */
function diffCheckoutFiles(baselineRoot, candidateRoot) {
  const baseFiles = new Set(listCheckoutFiles(baselineRoot));
  const candFiles = new Set(listCheckoutFiles(candidateRoot));
  const all = [...new Set([...baseFiles, ...candFiles])].sort();
  /** @type {string[]} */
  const changed = [];
  for (const rel of all) {
    if (!baseFiles.has(rel) || !candFiles.has(rel)) {
      changed.push(rel);
      continue;
    }
    const baseBytes = readFileSync(path.resolve(baselineRoot, rel));
    const candBytes = readFileSync(path.resolve(candidateRoot, rel));
    if (!baseBytes.equals(candBytes)) changed.push(rel);
  }
  return changed;
}

/** Strip JS/TS single-line and block comments while keeping string/template literals intact.
 * @param {string} source */
function stripComments(source) {
  let out = "";
  let i = 0;
  /** @type {string | null} */
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < source.length) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Extract static module specifiers using pure Node built-ins (matrix runs without npm ci).
 * @param {string} source */
export function extractModuleSpecifiers(source) {
  const cleaned = stripComments(source);
  /** @type {Set<string>} */
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"'`]+)["']/g,
    /\bimport\s*\(\s*["']([^"'`]+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"'`]+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of cleaned.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

/** @param {string} specifier */
function barePackageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Traverse the static local import graph of the scheduling profile runtime and
 * harness helpers inside one checkout.
 * @param {string} root */
export function collectSchedulingGraph(root) {
  const absRoot = path.resolve(root);
  /** @type {Set<string>} */
  const files = new Set();
  /** @type {Set<string>} */
  const packages = new Set(MANDATORY_SCHEDULING_ROOT_PACKAGES);

  const entrypoints = [];
  if (existsSync(path.join(absRoot, "scripts/profile-scheduling-requests.ts"))) {
    entrypoints.push("scripts/profile-scheduling-requests.ts");
  }
  const helperDir = path.join(absRoot, "scripts/scheduling-profile");
  if (existsSync(helperDir)) {
    for (const entry of readdirSync(helperDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(?:mjs|js|ts|cjs)$/.test(entry.name)) continue;
      if (/\.(?:test|spec)\.(?:mjs|js|ts)$/.test(entry.name)) continue;
      entrypoints.push(`scripts/scheduling-profile/${entry.name}`);
    }
  }

  /** @param {string} rel */
  const resolveLocal = (rel) => {
    const candidates = [
      rel,
      `${rel}.ts`,
      `${rel}.tsx`,
      `${rel}.js`,
      `${rel}.mjs`,
      `${rel}.cjs`,
      `${rel}/index.ts`,
      `${rel}/index.tsx`,
      `${rel}/index.js`,
      `${rel}/index.mjs`,
    ];
    for (const candidate of candidates) {
      try {
        const stat = lstatSync(path.join(absRoot, candidate));
        if (stat.isFile()) return candidate;
      } catch {
        // try next candidate
      }
    }
    return null;
  };

  /** @param {string} rel */
  const visit = (rel) => {
    if (files.has(rel)) return;
    files.add(rel);
    if (rel.startsWith("generated/") || rel.endsWith(".json")) return;
    let source;
    try {
      source = readFileSync(path.join(absRoot, rel), "utf8");
    } catch {
      return;
    }
    for (const specifier of extractModuleSpecifiers(source)) {
      if (isBuiltin(specifier) || specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".") && !specifier.startsWith("~/")) {
        const pkg = barePackageName(specifier);
        if (pkg) packages.add(pkg);
        continue;
      }
      const normalized = specifier.startsWith("~/")
        ? `src/${specifier.slice(2)}`
        : path.posix.normalize(path.posix.join(path.posix.dirname(rel), specifier));
      if (normalized.startsWith("../")) continue;
      if (normalized.startsWith("generated/")) {
        files.add(normalized);
        continue;
      }
      const target = resolveLocal(normalized);
      if (target) visit(target);
    }
  };

  for (const entry of entrypoints) visit(entry);
  return { files, packages };
}

/** Resolve a package name from a lockfile v3 package key using npm's ancestor
 * node_modules lookup rules.
 * @param {Record<string, Record<string, unknown>>} packages
 * @param {string} fromKey
 * @param {string} depName */
function resolveLockfilePackageKey(packages, fromKey, depName) {
  let cursor = fromKey;
  while (true) {
    const candidate = cursor ? `${cursor}/node_modules/${depName}` : `node_modules/${depName}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
    if (!cursor) return null;
    const nested = cursor.lastIndexOf("/node_modules/");
    if (nested >= 0) {
      cursor = cursor.slice(0, nested);
    } else if (cursor.startsWith("node_modules/")) {
      cursor = "";
    } else {
      cursor = "";
    }
  }
}

/** Compute the transitive lockfile package-key closure reachable from rootPackages.
 * @param {Record<string, Record<string, unknown>>} packages
 * @param {Iterable<string>} rootPackages */
export function computeLockfileClosure(packages, rootPackages) {
  /** @type {Set<string>} */
  const closure = new Set();
  /** @type {string[]} */
  const queue = [];

  /** @param {string} key */
  const enqueue = (key) => {
    if (closure.has(key) || !Object.hasOwn(packages, key)) return;
    closure.add(key);
    queue.push(key);
  };

  for (const dep of rootPackages) {
    const key = resolveLockfilePackageKey(packages, "", dep);
    if (key) enqueue(key);
  }

  while (queue.length > 0) {
    const currentKey = queue.shift();
    if (!currentKey) continue;
    const entry = packages[currentKey];
    if (!entry || typeof entry !== "object") continue;

    if (entry.link === true && typeof entry.resolved === "string") {
      const targetKey = entry.resolved.replace(/\\/g, "/");
      if (Object.hasOwn(packages, targetKey)) enqueue(targetKey);
    }

    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const deps = entry[section];
      if (!deps || typeof deps !== "object") continue;
      for (const depName of Object.keys(deps)) {
        const resolvedKey = resolveLockfilePackageKey(packages, currentKey, depName);
        if (resolvedKey) enqueue(resolvedKey);
      }
    }
  }

  return closure;
}

/** Extract canonical package name from a lockfile v3 key.
 * @param {string} key @param {Record<string, unknown> | undefined} entry */
function lockfileKeyPackageName(key, entry) {
  if (entry && typeof entry.name === "string" && entry.name.length > 0) return entry.name;
  const marker = "node_modules/";
  const idx = key.lastIndexOf(marker);
  return idx >= 0 ? key.slice(idx + marker.length) : key;
}

/** Diff direct dependency/override package names between baseline and candidate package.json.
 * @param {Record<string, unknown>} basePkg @param {Record<string, unknown>} candPkg */
function changedDirectPackageNames(basePkg, candPkg) {
  /** @type {Set<string>} */
  const changed = new Set();
  for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
    const baseSec = /** @type {Record<string, unknown>} */ (
      basePkg[section] && typeof basePkg[section] === "object" ? basePkg[section] : {}
    );
    const candSec = /** @type {Record<string, unknown>} */ (
      candPkg[section] && typeof candPkg[section] === "object" ? candPkg[section] : {}
    );
    for (const name of new Set([...Object.keys(baseSec), ...Object.keys(candSec)])) {
      if (!deepEqual(baseSec[name], candSec[name])) changed.add(name);
    }
  }
  return [...changed].sort();
}

/** Check whether any non-dependency top-level package.json field changed (e.g., scripts, engines, type).
 * @param {Record<string, unknown>} basePkg @param {Record<string, unknown>} candPkg */
function changedNonDependencyPackageFields(basePkg, candPkg) {
  const allowed = new Set(PACKAGE_DEPENDENCY_SECTIONS);
  /** @type {string[]} */
  const changed = [];
  for (const key of new Set([...Object.keys(basePkg), ...Object.keys(candPkg)])) {
    if (allowed.has(key)) continue;
    if (!deepEqual(basePkg[key], candPkg[key])) changed.push(key);
  }
  return changed.sort();
}

/** Evaluate whether a lockfile difference between immutable baseline and candidate
 * checkouts qualifies for an explicit reviewed NOT_APPLICABLE disposition, or must
 * be blocked (requiring measurement against a compatible immutable control or a
 * reviewed admission manifest).
 * @param {{
 *   baselineRoot: string,
 *   candidateRoot: string,
 *   baselineRevision: string,
 *   candidateRevision: string,
 *   admissionManifestPath?: string | null,
 * }} options */
export function evaluateDependencyAdmission(options) {
  const { baselineRoot, candidateRoot, baselineRevision, candidateRevision } = options;
  const admissionManifestPath = options.admissionManifestPath ?? null;

  const basePkgBytes = readFileSync(path.resolve(baselineRoot, "package.json"));
  const candPkgBytes = readFileSync(path.resolve(candidateRoot, "package.json"));
  const baseLockBytes = readFileSync(path.resolve(baselineRoot, "package-lock.json"));
  const candLockBytes = readFileSync(path.resolve(candidateRoot, "package-lock.json"));

  const baselinePackageJsonSha256 = sha256Hex(basePkgBytes);
  const candidatePackageJsonSha256 = sha256Hex(candPkgBytes);
  const baselineDependencyLockSha256 = sha256Hex(baseLockBytes);
  const candidateDependencyLockSha256 = sha256Hex(candLockBytes);
  const lockfilesIdentical = baseLockBytes.equals(candLockBytes);

  const baseReport = {
    baselineRevision,
    candidateRevision,
    baselinePackageJsonSha256,
    candidatePackageJsonSha256,
    baselineDependencyLockSha256,
    candidateDependencyLockSha256,
    admissionManifestPath,
    measured: false,
    samplingComplete: false,
    latencyComparisonEligible: false,
  };

  if (baselineRevision === candidateRevision) {
    return {
      ...baseReport,
      status: /** @type {const} */ ("BLOCKED"),
      disposition: /** @type {const} */ ("BLOCKED_SELF_CONTROL"),
      schedulingClosureUnchanged: false,
      schedulingClosureCount: 0,
      blockingFiles: /** @type {string[]} */ ([]),
      blockingPackages: /** @type {string[]} */ ([]),
      changedPackages: /** @type {string[]} */ ([]),
      summary: "Candidate revision cannot be substituted as its own control; select an independent immutable baseline.",
    };
  }

  if (lockfilesIdentical) {
    if (admissionManifestPath) {
      return {
        ...baseReport,
        status: /** @type {const} */ ("BLOCKED"),
        disposition: /** @type {const} */ ("BLOCKED_INVALID_ADMISSION_MANIFEST"),
        schedulingClosureUnchanged: true,
        schedulingClosureCount: 0,
        blockingFiles: /** @type {string[]} */ ([]),
        blockingPackages: /** @type {string[]} */ ([]),
        changedPackages: /** @type {string[]} */ ([]),
        summary: "Reviewed non-scheduling dependency admission manifest is invalid when baseline and candidate lockfiles are byte-identical; remove the admission manifest so normal paired measurement runs.",
      };
    }
    return {
      ...baseReport,
      status: /** @type {const} */ ("ELIGIBLE"),
      disposition: /** @type {const} */ ("MEASUREMENT_REQUIRED"),
      schedulingClosureUnchanged: true,
      schedulingClosureCount: 0,
      blockingFiles: /** @type {string[]} */ ([]),
      blockingPackages: /** @type {string[]} */ ([]),
      changedPackages: /** @type {string[]} */ ([]),
      summary: "Dependency lockfiles match; proceed to schema and clock admission.",
    };
  }

  const basePkg = /** @type {Record<string, unknown>} */ (JSON.parse(basePkgBytes.toString("utf8")));
  const candPkg = /** @type {Record<string, unknown>} */ (JSON.parse(candPkgBytes.toString("utf8")));
  const baseLock = /** @type {{ lockfileVersion?: number, packages?: Record<string, Record<string, unknown>> }} */ (
    JSON.parse(baseLockBytes.toString("utf8"))
  );
  const candLock = /** @type {{ lockfileVersion?: number, packages?: Record<string, Record<string, unknown>> }} */ (
    JSON.parse(candLockBytes.toString("utf8"))
  );

  if (
    baseLock.lockfileVersion !== 3 ||
    candLock.lockfileVersion !== 3 ||
    !baseLock.packages ||
    !candLock.packages
  ) {
    return {
      ...baseReport,
      status: /** @type {const} */ ("BLOCKED"),
      disposition: /** @type {const} */ ("BLOCKED_SCHEDULING_DEPENDENCY_CHANGE"),
      schedulingClosureUnchanged: false,
      schedulingClosureCount: 0,
      blockingFiles: ["package-lock.json"],
      blockingPackages: [],
      changedPackages: [],
      summary: "Unsupported lockfile format; cannot prove scheduling dependency closure is unchanged. Measure against an independently reviewed immutable control with compatible locked dependencies.",
    };
  }

  const baseGraph = collectSchedulingGraph(baselineRoot);
  const candGraph = collectSchedulingGraph(candidateRoot);
  const schedulingFiles = new Set([...baseGraph.files, ...candGraph.files]);
  const schedulingRootPackages = new Set([...baseGraph.packages, ...candGraph.packages]);

  const changedFiles = diffCheckoutFiles(baselineRoot, candidateRoot);
  /** @type {string[]} */
  const blockingFiles = [];
  for (const file of changedFiles) {
    if (file === "package.json" || file === "package-lock.json") continue;
    if (admissionManifestPath && file === admissionManifestPath) continue;
    const hitsTrigger = SCHEDULING_TRIGGER_PATHS.some((pattern) => matchesWorkflowPattern(file, pattern));
    const hitsConfig = EXTRA_RUNTIME_CONFIG_FILES.has(file);
    const hitsImportGraph = schedulingFiles.has(file);
    if (hitsTrigger || hitsConfig || hitsImportGraph) {
      blockingFiles.push(file);
    }
  }

  const nonDepFields = changedNonDependencyPackageFields(basePkg, candPkg);
  if (nonDepFields.length > 0) {
    blockingFiles.push(`package.json (${nonDepFields.join(", ")})`);
  }

  const baselineClosure = computeLockfileClosure(baseLock.packages, schedulingRootPackages);
  const candidateClosure = computeLockfileClosure(candLock.packages, schedulingRootPackages);
  /** @type {Set<string>} */
  const blockingPackages = new Set();

  // Root package.json specifiers for any scheduling-closure root must stay identical.
  for (const rootPkg of schedulingRootPackages) {
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      const bSec = /** @type {Record<string, unknown>} */ (
        basePkg[section] && typeof basePkg[section] === "object" ? basePkg[section] : {}
      );
      const cSec = /** @type {Record<string, unknown>} */ (
        candPkg[section] && typeof candPkg[section] === "object" ? candPkg[section] : {}
      );
      if (!deepEqual(bSec[rootPkg], cSec[rootPkg])) blockingPackages.add(rootPkg);
    }
  }

  for (const key of new Set([...baselineClosure, ...candidateClosure])) {
    if (!baselineClosure.has(key) || !candidateClosure.has(key) || !deepEqual(baseLock.packages[key], candLock.packages[key])) {
      const name = lockfileKeyPackageName(key, candLock.packages[key] ?? baseLock.packages[key]);
      blockingPackages.add(name);
    }
  }

  const directChanged = changedDirectPackageNames(basePkg, candPkg);
  let effectiveChangedPackages = directChanged;
  if (effectiveChangedPackages.length === 0) {
    /** @type {Set<string>} */
    const lockChanged = new Set();
    for (const key of new Set([...Object.keys(baseLock.packages), ...Object.keys(candLock.packages)])) {
      if (key === "") continue;
      if (!deepEqual(baseLock.packages[key], candLock.packages[key])) {
        lockChanged.add(lockfileKeyPackageName(key, candLock.packages[key] ?? baseLock.packages[key]));
      }
    }
    effectiveChangedPackages = [...lockChanged].sort();
  }

  const blockingPackageList = [...blockingPackages].sort();
  const schedulingClosureUnchanged = blockingFiles.length === 0 && blockingPackageList.length === 0;

  if (!schedulingClosureUnchanged) {
    const reasons = [];
    if (blockingFiles.length > 0) reasons.push(`scheduling-relevant files changed (${blockingFiles.join(", ")})`);
    if (blockingPackageList.length > 0) reasons.push(`scheduling dependency closure changed (${blockingPackageList.join(", ")})`);
    return {
      ...baseReport,
      status: /** @type {const} */ ("BLOCKED"),
      disposition: /** @type {const} */ ("BLOCKED_SCHEDULING_DEPENDENCY_CHANGE"),
      schedulingClosureUnchanged: false,
      schedulingClosureCount: baselineClosure.size,
      blockingFiles,
      blockingPackages: blockingPackageList,
      changedPackages: effectiveChangedPackages,
      summary: `Measurement is required because ${reasons.join(" and ")}. Select an independently reviewed immutable control with compatible locked dependencies; do not normalize lockfiles or bypass comparison checks.`,
    };
  }

  if (!admissionManifestPath) {
    return {
      ...baseReport,
      status: /** @type {const} */ ("BLOCKED"),
      disposition: /** @type {const} */ ("BLOCKED_LOCKFILE_MISMATCH"),
      schedulingClosureUnchanged: true,
      schedulingClosureCount: baselineClosure.size,
      blockingFiles: [],
      blockingPackages: [],
      changedPackages: effectiveChangedPackages,
      summary:
        `Dependency lockfiles differ (${effectiveChangedPackages.join(", ") || "lockfile-only"}) with no scheduling file or scheduling dependency-closure impact (${baselineClosure.size} locked packages unchanged). ` +
        "No automatic bypass is applied: either select an independently reviewed immutable control with compatible locked dependencies, or commit a reviewed PR-scoped admission manifest (.github/scheduling-profile-manifests/pr-<number>-admission.json) pinning these exact baseline/candidate hashes.",
    };
  }

  let parsedManifest;
  try {
    const manifestAbs = path.resolve(candidateRoot, admissionManifestPath);
    assert.ok(lstatSync(manifestAbs).isFile(), "Admission manifest must be a regular file");
    const rawManifest = /** @type {unknown} */ (JSON.parse(readFileSync(manifestAbs, "utf8")));
    parsedManifest = parseAdmissionManifest(rawManifest);
    assert.equal(parsedManifest.baselineRevision, baselineRevision,
      `Admission manifest baselineRevision (${parsedManifest.baselineRevision}) does not match selected baseline (${baselineRevision})`);
    assert.equal(parsedManifest.baselinePackageJsonSha256, baselinePackageJsonSha256,
      "Admission manifest baselinePackageJsonSha256 does not match immutable baseline package.json");
    assert.equal(parsedManifest.candidatePackageJsonSha256, candidatePackageJsonSha256,
      "Admission manifest candidatePackageJsonSha256 does not match candidate package.json");
    assert.equal(parsedManifest.baselineDependencyLockSha256, baselineDependencyLockSha256,
      "Admission manifest baselineDependencyLockSha256 does not match immutable baseline package-lock.json");
    assert.equal(parsedManifest.candidateDependencyLockSha256, candidateDependencyLockSha256,
      "Admission manifest candidateDependencyLockSha256 does not match candidate package-lock.json");
    assert.deepEqual([...parsedManifest.changedPackages], effectiveChangedPackages,
      `Admission manifest changedPackages (${parsedManifest.changedPackages.join(", ")}) does not match actual changed packages (${effectiveChangedPackages.join(", ")})`);
  } catch (error) {
    return {
      ...baseReport,
      status: /** @type {const} */ ("BLOCKED"),
      disposition: /** @type {const} */ ("BLOCKED_INVALID_ADMISSION_MANIFEST"),
      schedulingClosureUnchanged: true,
      schedulingClosureCount: baselineClosure.size,
      blockingFiles: [],
      blockingPackages: [],
      changedPackages: effectiveChangedPackages,
      summary: `Reviewed admission manifest rejected: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    ...baseReport,
    status: /** @type {const} */ ("NOT_APPLICABLE"),
    disposition: /** @type {"NOT_APPLICABLE_NON_SCHEDULING_DEPENDENCY"} */ (ADMISSION_MANIFEST_DISPOSITION),
    schedulingClosureUnchanged: true,
    schedulingClosureCount: baselineClosure.size,
    blockingFiles: [],
    blockingPackages: [],
    changedPackages: effectiveChangedPackages,
    reason: parsedManifest.reason,
    changedFileCount: changedFiles.length,
    summary:
      `Scheduling profile is NOT_APPLICABLE (reviewed non-scheduling dependency change: ${effectiveChangedPackages.join(", ")}; ${baselineClosure.size} scheduling-closure packages verified byte-identical). No benchmark ran; this is NOT a measured PASS.`,
  };
}
