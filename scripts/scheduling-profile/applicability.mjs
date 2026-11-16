import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

/** This is the existing workflow's path policy, not a claim that all other
 * application changes are inert. Tests keep the trigger list synchronized. */
export const PROFILE_WATCH_PATHS = Object.freeze([
  ".github/workflows/scheduling-profile.yml",
  ".github/workflows/scheduling-profile-worker.yml",
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
  "package.json",
  "package-lock.json",
]);
const validationHelpers = new Set([
  "applicability.mjs",
  "comparison-inputs.mjs",
]);
const dependencyKinds = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];
const manifestKinds = ["dependencies", "devDependencies"];
const immutable = /^[a-f0-9]{40}$/;
const digest = (/** @type {string | Buffer} */ bytes) =>
  createHash("sha256").update(bytes).digest("hex");

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{owner:string,kind:string,name:string,before:string|null,after:string|null}} ResolutionChange */
/** @typedef {{eligible:boolean,reason:string,addedRoots:{kind:string,name:string,range:string}[],addedPackages:string[],productionResolutionChecks:number,developmentOptionalPeerChanges:ResolutionChange[]}} DependencyProof */
/** @typedef {{schemaVersion:1,policyVersion:1,status:"REQUIRED"|"NOT_APPLICABLE",reason:string,event:string,baseRevision:string,candidateRevision:string,changedPaths:string[],watchedSourcePaths:string[],validationOnlyPaths:string[],dependencyProof:DependencyProof|null,benchmarkRan:false}} ApplicabilityReceipt */

/** @param {unknown} value @param {string} label @returns {JsonObject} */
function object(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), label);
  return /** @type {JsonObject} */ (value);
}
/** @param {JsonObject} value @param {string} key */
function dictionary(value, key) {
  return value[key] === undefined
    ? {}
    : object(value[key], "invalid-package-dictionary");
}
/** @param {JsonObject} value @param {string[]} excluded */
function without(value, excluded) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.includes(key)),
  );
}
/** @param {boolean} value @param {string} reason */
function requireProof(value, reason) {
  assert.ok(value, reason);
}

/** Model Node's ancestor node_modules lookup from an exact lockfile install path.
 * A newly installed package must not satisfy or shadow an existing production edge.
 * @param {JsonObject} packages @param {string} owner @param {string} name
 * @returns {string|null} */
export function resolveDependency(packages, owner, name) {
  assert.match(
    name,
    /^(?:@[a-z0-9_.~-]+\/)?[a-z0-9_.~-]+$/i,
    "invalid-package-name",
  );
  const parts = owner ? owner.split("/") : [];
  while (parts.length) {
    if (parts.at(-1) !== "node_modules") {
      const candidate = `${parts.join("/")}/node_modules/${name}`;
      if (Object.hasOwn(packages, candidate)) return candidate;
    }
    parts.pop();
  }
  const root = `node_modules/${name}`;
  return Object.hasOwn(packages, root) ? root : null;
}

/** A semantic additive proof is used only for applicability. Measured comparisons
 * still demand byte-identical complete lockfiles in comparison-inputs.mjs.
 * @param {unknown} baselineManifest @param {unknown} candidateManifest
 * @param {unknown} baselineLock @param {unknown} candidateLock
 * @returns {DependencyProof} */
export function inspectDependencyAddition(
  baselineManifest,
  candidateManifest,
  baselineLock,
  candidateLock,
) {
  /** @type {DependencyProof} */
  const proof = {
    eligible: false,
    reason: "invalid-package-input",
    addedRoots: [],
    addedPackages: [],
    productionResolutionChecks: 0,
    developmentOptionalPeerChanges: [],
  };
  try {
    const before = object(baselineManifest, "invalid-package-manifest");
    const after = object(candidateManifest, "invalid-package-manifest");
    const oldLock = object(baselineLock, "invalid-package-lock");
    const newLock = object(candidateLock, "invalid-package-lock");
    requireProof(
      oldLock.lockfileVersion === 3 && newLock.lockfileVersion === 3,
      "lockfile-v3-required",
    );
    requireProof(
      isDeepStrictEqual(
        without(oldLock, ["packages"]),
        without(newLock, ["packages"]),
      ),
      "lockfile-metadata-changed",
    );
    requireProof(
      isDeepStrictEqual(
        without(before, [...manifestKinds, "scripts"]),
        without(after, [...manifestKinds, "scripts"]),
      ),
      "package-runtime-or-identity-fields-changed",
    );
    const oldScripts = dictionary(before, "scripts"),
      newScripts = dictionary(after, "scripts");
    for (const [name, command] of Object.entries(oldScripts)) {
      const candidate = newScripts[name];
      const docsExtension =
        name === "docs:check" &&
        typeof command === "string" &&
        typeof candidate === "string" &&
        candidate.startsWith(`${command} && `);
      requireProof(
        command === candidate || docsExtension,
        "existing-or-lifecycle-script-changed",
      );
    }
    for (const name of Object.keys(newScripts).filter(
      (name) => !Object.hasOwn(oldScripts, name),
    ))
      requireProof(
        /^(?:help|docs):[a-z0-9:_-]+$/i.test(name),
        "new-measured-or-lifecycle-script",
      );

    const oldPackages = dictionary(oldLock, "packages"),
      newPackages = dictionary(newLock, "packages");
    const oldRoot = object(oldPackages[""], "missing-lock-root"),
      newRoot = object(newPackages[""], "missing-lock-root");
    requireProof(
      isDeepStrictEqual(
        without(oldRoot, manifestKinds),
        without(newRoot, manifestKinds),
      ),
      "lock-root-identity-changed",
    );
    for (const kind of manifestKinds) {
      const oldDependencies = dictionary(before, kind),
        newDependencies = dictionary(after, kind);
      requireProof(
        isDeepStrictEqual(oldDependencies, dictionary(oldRoot, kind)) &&
          isDeepStrictEqual(newDependencies, dictionary(newRoot, kind)),
        "manifest-lock-root-mismatch",
      );
      for (const [name, spec] of Object.entries(oldDependencies))
        requireProof(
          Object.hasOwn(newDependencies, name) &&
            spec === newDependencies[name],
          "existing-root-dependency-changed",
        );
      for (const name of Object.keys(newDependencies).filter(
        (name) => !Object.hasOwn(oldDependencies, name),
      )) {
        const range = newDependencies[name];
        requireProof(
          typeof range === "string" &&
            range.trim().length > 0 &&
            !/^(?:file:|link:|workspace:|git|https?:|npm:)/i.test(range),
          "unsupported-new-root-source",
        );
        proof.addedRoots.push({
          kind,
          name,
          range: /** @type {string} */ (range),
        });
      }
    }
    for (const [name, metadata] of Object.entries(oldPackages)) {
      if (name === "") continue;
      requireProof(
        Object.hasOwn(newPackages, name) &&
          isDeepStrictEqual(metadata, newPackages[name]),
        "existing-lock-entry-changed-or-removed",
      );
    }
    proof.addedPackages = Object.keys(newPackages)
      .filter((name) => !Object.hasOwn(oldPackages, name))
      .sort();
    for (const name of proof.addedPackages) {
      requireProof(
        /^(?:node_modules\/(?:@[a-z0-9_.~-]+\/)?[a-z0-9_.~-]+\/)*node_modules\/(?:@[a-z0-9_.~-]+\/)?[a-z0-9_.~-]+$/i.test(
          name,
        ),
        "unsupported-install-path",
      );
      const metadata = object(newPackages[name], "invalid-new-package");
      requireProof(
        !metadata.link &&
          !metadata.hasInstallScript &&
          metadata.bin === undefined,
        "new-install-hook-link-or-binary",
      );
      requireProof(
        typeof metadata.version === "string" &&
          typeof metadata.integrity === "string" &&
          /^sha(?:256|384|512)-[a-z0-9+/=]+$/i.test(metadata.integrity),
        "new-package-missing-integrity",
      );
      const url =
        typeof metadata.resolved === "string"
          ? new URL(metadata.resolved)
          : null;
      requireProof(
        url?.protocol === "https:" &&
          url.hostname === "registry.npmjs.org" &&
          !url.username &&
          !url.password,
        "unsupported-new-package-registry",
      );
    }
    for (const [owner, raw] of Object.entries(oldPackages)) {
      const metadata = object(raw, "invalid-existing-package");
      for (const kind of dependencyKinds) {
        for (const name of Object.keys(dictionary(metadata, kind))) {
          const beforePath = resolveDependency(oldPackages, owner, name),
            afterPath = resolveDependency(newPackages, owner, name);
          if (metadata.dev !== true) proof.productionResolutionChecks++;
          if (beforePath === afterPath) continue;
          const peerMeta = dictionary(
            dictionary(metadata, "peerDependenciesMeta"),
            name,
          );
          if (
            metadata.dev === true &&
            kind === "peerDependencies" &&
            peerMeta.optional === true &&
            beforePath === null &&
            afterPath !== null
          ) {
            proof.developmentOptionalPeerChanges.push({
              owner,
              kind,
              name,
              before: beforePath,
              after: afterPath,
            });
          } else
            requireProof(
              false,
              metadata.dev === true
                ? "existing-development-resolution-changed"
                : "existing-production-resolution-changed",
            );
        }
      }
    }
    const visited = new Set();
    const queue = proof.addedRoots.map(({ name }) => {
      const installed = resolveDependency(newPackages, "", name);
      requireProof(installed !== null, "new-root-not-installed");
      return /** @type {string} */ (installed);
    });
    while (queue.length) {
      const owner = /** @type {string} */ (queue.pop());
      if (visited.has(owner)) continue;
      visited.add(owner);
      const metadata = object(newPackages[owner], "invalid-dependency-closure");
      for (const kind of dependencyKinds)
        for (const name of Object.keys(dictionary(metadata, kind))) {
          const installed = resolveDependency(newPackages, owner, name);
          if (installed !== null) queue.push(installed);
          else
            requireProof(
              kind !== "dependencies",
              "missing-new-required-dependency",
            );
        }
    }
    requireProof(
      proof.addedPackages.every((name) => visited.has(name)),
      "new-package-outside-additive-root-closure",
    );
    proof.addedRoots.sort((a, b) =>
      `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`),
    );
    proof.developmentOptionalPeerChanges.sort((a, b) =>
      `${a.owner}:${a.name}`.localeCompare(`${b.owner}:${b.name}`),
    );
    proof.eligible = true;
    proof.reason =
      proof.addedRoots.length || proof.addedPackages.length
        ? "additive-dependencies-outside-profile-scope"
        : "dependency-graph-unchanged";
  } catch (error) {
    proof.reason =
      error instanceof Error && /^[a-z0-9-]+$/.test(error.message)
        ? error.message
        : "invalid-package-input";
  }
  return proof;
}

/** @param {string} path */
function validationOnly(path) {
  if (path === ".github/workflows/scheduling-profile.yml") return true;
  const prefix = "scripts/scheduling-profile/";
  if (!path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return (
    !name.includes("/") &&
    (validationHelpers.has(name) || /\.(?:test|spec)\.ts$/.test(name))
  );
}
/** @param {string} path @param {string} pattern */
const matches = (path, pattern) =>
  pattern.endsWith("/**")
    ? path.startsWith(pattern.slice(0, -2))
    : path === pattern;

/** @param {{event:string,baseRevision:string,candidateRevision:string,changedPaths:string[],baselineManifest:unknown,candidateManifest:unknown,baselineLock:unknown,candidateLock:unknown}} input
 * @returns {ApplicabilityReceipt} */
export function inspectApplicability(input) {
  assert.match(
    input.baseRevision,
    immutable,
    "Immutable PR base revision required",
  );
  assert.match(
    input.candidateRevision,
    immutable,
    "Immutable candidate revision required",
  );
  assert.notEqual(
    input.baseRevision,
    input.candidateRevision,
    "A comparison cannot use its candidate as its control",
  );
  assert.ok(
    input.event === "pull_request" || input.event === "workflow_dispatch",
    "Unsupported scheduling scope event",
  );
  const changedPaths = [...new Set(input.changedPaths)].sort();
  const watched = changedPaths.filter(
    (path) =>
      !["package.json", "package-lock.json"].includes(path) &&
      PROFILE_WATCH_PATHS.some((pattern) => matches(path, pattern)),
  );
  const validationOnlyPaths = watched.filter(validationOnly);
  const watchedSourcePaths = watched.filter((path) => !validationOnly(path));
  /** @type {ApplicabilityReceipt} */
  const receipt = {
    schemaVersion: 1,
    policyVersion: 1,
    status: "REQUIRED",
    reason: "manual-dispatch",
    event: input.event,
    baseRevision: input.baseRevision,
    candidateRevision: input.candidateRevision,
    changedPaths,
    watchedSourcePaths,
    validationOnlyPaths,
    dependencyProof: null,
    benchmarkRan: false,
  };
  if (input.event !== "pull_request") return receipt;
  if (watchedSourcePaths.length) {
    receipt.reason = "watched-measurement-source-changed";
    return receipt;
  }
  receipt.dependencyProof = inspectDependencyAddition(
    input.baselineManifest,
    input.candidateManifest,
    input.baselineLock,
    input.candidateLock,
  );
  if (!receipt.dependencyProof.eligible) {
    receipt.reason = "dependency-change-requires-profile";
    return receipt;
  }
  receipt.status = "NOT_APPLICABLE";
  receipt.reason =
    "outside-watched-measurement-source-with-additive-dependency-proof";
  return receipt;
}

/** Inspect immutable Git objects rather than mutable checkout files or a moving
 * branch. A deletion or mode change remains in the complete changed-path set.
 * @param {string} root @param {string} revision */
function snapshot(root, revision) {
  const git = (/** @type {string[]} */ args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
  assert.equal(
    git(["rev-parse", "HEAD"]).trim(),
    revision,
    "Checkout does not match the declared immutable revision",
  );
  const files = new Map(
    git(["ls-tree", "-r", "-z", "--full-tree", revision])
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf("\t");
        assert.ok(tab > 0, "Invalid Git tree inventory");
        return /** @type {[string, string]} */ ([
          line.slice(tab + 1),
          line.slice(0, tab),
        ]);
      }),
  );
  const read = (/** @type {string} */ path) =>
    git(["show", `${revision}:${path}`]);
  return { files, read };
}
/** @param {string} baseRoot @param {string} candidateRoot @param {{event:string,baseRevision:string,candidateRevision:string}} binding */
export function inspectGitApplicability(baseRoot, candidateRoot, binding) {
  assert.match(binding.baseRevision, immutable);
  assert.match(binding.candidateRevision, immutable);
  const candidate = snapshot(candidateRoot, binding.candidateRevision);
  if (binding.event === "workflow_dispatch")
    return inspectApplicability({
      ...binding,
      changedPaths: [],
      baselineManifest: null,
      candidateManifest: null,
      baselineLock: null,
      candidateLock: null,
    });
  const baseline = snapshot(baseRoot, binding.baseRevision);
  const changedPaths = [
    ...new Set([...baseline.files.keys(), ...candidate.files.keys()]),
  ].filter((path) => baseline.files.get(path) !== candidate.files.get(path));
  return inspectApplicability({
    ...binding,
    changedPaths,
    baselineManifest: JSON.parse(baseline.read("package.json")),
    candidateManifest: JSON.parse(candidate.read("package.json")),
    baselineLock: JSON.parse(baseline.read("package-lock.json")),
    candidateLock: JSON.parse(candidate.read("package-lock.json")),
  });
}

/** A missing or failed declaration never turns skipped workers into acceptance.
 * @param {{matrixResult:string,status:string,clockStatus:string,preflightResult:string,profileResult:string}} state */
export function requireApplicabilityDeclaration(state) {
  assert.equal(
    state.matrixResult,
    "success",
    "Applicability declaration job did not succeed",
  );
  if (state.status === "NOT_APPLICABLE") {
    assert.equal(
      state.preflightResult,
      "skipped",
      "Unmeasured applicability requires skipped preflight",
    );
    assert.equal(
      state.profileResult,
      "skipped",
      "Unmeasured applicability requires skipped measurements",
    );
  } else {
    assert.equal(
      state.status,
      "REQUIRED",
      "Missing or invalid applicability proof",
    );
    assert.equal(
      state.clockStatus,
      "ADMITTED",
      "Required measurements were not admitted",
    );
  }
}

function main() {
  if (process.argv[2] === "gate") {
    assert.equal(process.argv.length, 3, "Usage: applicability.mjs gate");
    requireApplicabilityDeclaration({
      matrixResult: process.env.PROFILE_MATRIX_RESULT ?? "",
      status: process.env.PROFILE_SCOPE_STATUS ?? "",
      clockStatus: process.env.PROFILE_CLOCK_STATUS ?? "",
      preflightResult: process.env.PREFLIGHT_RESULT ?? "",
      profileResult: process.env.PROFILE_RESULT ?? "",
    });
    return;
  }
  const [mode, baseRoot, candidateRoot, receiptPath] = process.argv.slice(2);
  assert.ok(
    (mode === "inspect" || mode === "verify") &&
      baseRoot &&
      candidateRoot &&
      receiptPath &&
      process.argv.length === 6,
    "Usage: applicability.mjs inspect|verify BASE_ROOT CANDIDATE_ROOT RECEIPT",
  );
  const binding = {
    event: process.env.PROFILE_SCOPE_EVENT ?? "",
    baseRevision: process.env.PROFILE_SCOPE_BASE_SHA ?? "",
    candidateRevision: process.env.PROFILE_SCOPE_CANDIDATE_SHA ?? "",
  };
  const receipt = inspectGitApplicability(baseRoot, candidateRoot, binding);
  const bytes = JSON.stringify(receipt, null, 2) + "\n";
  if (mode === "verify") {
    const saved = readFileSync(receiptPath);
    assert.equal(
      digest(saved),
      process.env.PROFILE_SCOPE_PROOF_SHA256,
      "Applicability artifact bytes do not match matrix output",
    );
    assert.deepEqual(
      JSON.parse(saved.toString("utf8")),
      receipt,
      "Applicability proof differs from the immutable source comparison",
    );
    assert.equal(
      receipt.status,
      "NOT_APPLICABLE",
      "Only a proved NOT_APPLICABLE result can bypass measurement aggregation",
    );
  } else writeFileSync(receiptPath, bytes);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `status=${receipt.status}\nproof_sha256=${digest(bytes)}\nartifact_attempt=${process.env.GITHUB_RUN_ATTEMPT ?? "1"}\n`,
    );
  if (process.env.GITHUB_STEP_SUMMARY && receipt.status === "NOT_APPLICABLE")
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Scheduling profile: NOT_APPLICABLE\n\nNo scheduling benchmark ran and no measured PASS is claimed. The immutable PR base/head diff changes no watched measurement source; additive package proof preserved every existing production dependency/optional/peer resolution. Validation-only helper changes still run their bounded regressions.\n\nBase: \`${receipt.baseRevision}\`  \nCandidate: \`${receipt.candidateRevision}\`  \nAdded package paths: ${receipt.dependencyProof?.addedPackages.length ?? 0}; recorded development-only optional peer changes: ${receipt.dependencyProof?.developmentOptionalPeerChanges.length ?? 0}.\n`,
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
