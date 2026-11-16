import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  inspectApplicability,
  inspectDependencyAddition,
  inspectGitApplicability,
  requireApplicabilityDeclaration,
  resolveDependency,
} from "./applicability.mjs";

type Installed = {
  version?: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional: boolean }>;
  dev?: boolean;
  hasInstallScript?: boolean;
  bin?: Record<string, string>;
  link?: boolean;
  [key: string]: unknown;
};
const baseRevision = "1".repeat(40),
  candidateRevision = "2".repeat(40);
const metadata = (name: string): Installed => ({
  version: "1.0.0",
  resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-1.0.0.tgz`,
  integrity: "sha512-YQ==",
});
function fixture() {
  const baselineManifest = {
    name: "synthetic-profile-fixture",
    version: "1.0.0",
    engines: { node: "22" },
    overrides: { existing: "1.0.0" },
    scripts: {
      "docs:check": "node scripts/docs.mjs",
      "db:migrate": "prisma migrate deploy",
      postinstall: "prisma generate",
    } as Record<string, string>,
    dependencies: { existing: "1.0.0" } as Record<string, string>,
    devDependencies: {} as Record<string, string>,
  };
  const baselineLock = {
    name: baselineManifest.name,
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: baselineManifest.name,
        version: "1.0.0",
        hasInstallScript: true,
        dependencies: { ...baselineManifest.dependencies },
        devDependencies: {},
      },
      "node_modules/existing": {
        ...metadata("existing"),
        dependencies: { child: "1.0.0" },
      },
      "node_modules/child": metadata("child"),
    } as Record<string, Installed>,
  };
  return {
    baselineManifest,
    candidateManifest: structuredClone(baselineManifest),
    baselineLock,
    candidateLock: structuredClone(baselineLock),
  };
}
type Fixture = ReturnType<typeof fixture>;
function addUnrelated(f: Fixture) {
  f.candidateManifest.dependencies.pdfkit = "^1.0.0";
  f.candidateManifest.devDependencies["@types/pdfkit"] = "^1.0.0";
  f.candidateManifest.scripts["docs:check"] += " && npm run help:check";
  f.candidateManifest.scripts["help:check"] = "node scripts/help-check.mjs";
  f.candidateLock.packages[""]!.dependencies = {
    ...f.candidateManifest.dependencies,
  };
  f.candidateLock.packages[""]!.devDependencies = {
    ...f.candidateManifest.devDependencies,
  };
  f.candidateLock.packages["node_modules/pdfkit"] = {
    ...metadata("pdfkit"),
    dependencies: { "new-helper": "1.0.0", existing: "1.0.0" },
  };
  f.candidateLock.packages["node_modules/new-helper"] = metadata("new-helper");
  f.candidateLock.packages["node_modules/@types/pdfkit"] = {
    ...metadata("@types/pdfkit"),
    dev: true,
  };
}
const inspect = (f: Fixture) =>
  inspectDependencyAddition(
    f.baselineManifest,
    f.candidateManifest,
    f.baselineLock,
    f.candidateLock,
  );
const scoped = (f: Fixture, changedPaths: string[], event = "pull_request") =>
  inspectApplicability({
    ...f,
    changedPaths,
    event,
    baseRevision,
    candidateRevision,
  });

void test("unrelated additive dependencies retain every original install record and production resolution", () => {
  const f = fixture();
  addUnrelated(f);
  const before = JSON.stringify(f);
  const proof = inspect(f);
  assert.equal(proof.eligible, true);
  assert.deepEqual(proof.addedPackages, [
    "node_modules/@types/pdfkit",
    "node_modules/new-helper",
    "node_modules/pdfkit",
  ]);
  assert.equal(proof.productionResolutionChecks, 2);
  assert.equal(
    JSON.stringify(f),
    before,
    "Inspection cannot rewrite either dependency input",
  );
  const receipt = scoped(f, [
    "package-lock.json",
    "package.json",
    "src/server/help/pdf.ts",
    "next.config.js",
    "src/server/auth/config.ts",
  ]);
  assert.equal(receipt.status, "NOT_APPLICABLE");
  assert.equal(receipt.benchmarkRan, false);
  assert.equal("PASS" in receipt, false);
  assert.equal(receipt.baseRevision, baseRevision);
  assert.equal(receipt.candidateRevision, candidateRevision);
});

void test("property ordering and unrelated docs scripts do not become dependency upgrades", () => {
  const f = fixture();
  f.candidateManifest.scripts["help:export"] = "node scripts/export-help.mjs";
  f.candidateManifest.dependencies = Object.fromEntries(
    Object.entries(f.candidateManifest.dependencies).reverse(),
  );
  assert.equal(inspect(f).eligible, true);
  assert.equal(scoped(f, ["package.json"]).status, "NOT_APPLICABLE");
});

for (const [name, mutate] of [
  [
    "lock v2",
    (f: Fixture) => {
      f.candidateLock.lockfileVersion = 2;
    },
  ],
  [
    "existing install upgrade",
    (f: Fixture) => {
      f.candidateLock.packages["node_modules/child"]!.version = "2.0.0";
    },
  ],
  [
    "existing integrity edit",
    (f: Fixture) => {
      f.candidateLock.packages["node_modules/child"]!.integrity = "sha512-Yg==";
    },
  ],
  [
    "existing install removal",
    (f: Fixture) => {
      delete f.candidateLock.packages["node_modules/child"];
    },
  ],
  [
    "existing root range edit",
    (f: Fixture) => {
      f.candidateManifest.dependencies.existing = "^2.0.0";
      f.candidateLock.packages[""]!.dependencies!.existing = "^2.0.0";
    },
  ],
  [
    "root dependency deletion",
    (f: Fixture) => {
      delete f.candidateManifest.dependencies.existing;
      delete f.candidateLock.packages[""]!.dependencies!.existing;
    },
  ],
  [
    "engine change",
    (f: Fixture) => {
      f.candidateManifest.engines.node = "24";
    },
  ],
  [
    "override change",
    (f: Fixture) => {
      f.candidateManifest.overrides.existing = "2.0.0";
    },
  ],
  [
    "package identity change",
    (f: Fixture) => {
      f.candidateManifest.name = "different-name";
    },
  ],
  [
    "postinstall change",
    (f: Fixture) => {
      f.candidateManifest.scripts.postinstall = "node changed.mjs";
    },
  ],
  [
    "measurement script change",
    (f: Fixture) => {
      f.candidateManifest.scripts["db:migrate"] = "prisma migrate reset";
    },
  ],
  [
    "new pre-measurement hook",
    (f: Fixture) => {
      f.candidateManifest.scripts["predb:migrate"] = "node hook.mjs";
    },
  ],
  [
    "replacement docs gate",
    (f: Fixture) => {
      f.candidateManifest.scripts["docs:check"] = "echo skipped";
    },
  ],
  [
    "new executable",
    (f: Fixture) => {
      f.candidateLock.packages["node_modules/pdfkit"]!.bin = {
        tsx: "replacement.js",
      };
    },
  ],
  [
    "new install hook",
    (f: Fixture) => {
      f.candidateLock.packages["node_modules/pdfkit"]!.hasInstallScript = true;
    },
  ],
  [
    "new link",
    (f: Fixture) => {
      f.candidateLock.packages["node_modules/pdfkit"]!.link = true;
    },
  ],
  [
    "new local source",
    (f: Fixture) => {
      f.candidateManifest.dependencies.pdfkit = "file:../unrelated";
      f.candidateLock.packages[""]!.dependencies!.pdfkit = "file:../unrelated";
    },
  ],
  [
    "unrelated unreferenced package",
    (f: Fixture) => {
      f.candidateLock.packages["node_modules/orphan"] = metadata("orphan");
    },
  ],
] as const)
  void test(`${name} requires a real controlled profile instead of a not-applicable claim`, () => {
    const f = fixture();
    addUnrelated(f);
    mutate(f);
    assert.equal(inspect(f).eligible, false);
    assert.equal(
      scoped(f, ["package.json", "package-lock.json"]).status,
      "REQUIRED",
    );
  });

void test("a newly installed nested package cannot shadow an unchanged production dependency", () => {
  const f = fixture();
  addUnrelated(f);
  f.candidateLock.packages["node_modules/existing/node_modules/child"] =
    metadata("child");
  assert.equal(inspect(f).reason, "existing-production-resolution-changed");
});

for (const kind of ["optionalDependencies", "peerDependencies"] as const)
  void test(`a previously unresolved production ${kind} cannot be newly filled`, () => {
    const f = fixture();
    for (const lock of [f.baselineLock, f.candidateLock]) {
      lock.packages["node_modules/existing"]![kind] = {
        "new-helper": "^1.0.0",
      };
      lock.packages["node_modules/existing"]!.peerDependenciesMeta = {
        "new-helper": { optional: true },
      };
    }
    addUnrelated(f);
    assert.equal(inspect(f).reason, "existing-production-resolution-changed");
  });

void test("a newly satisfied development-only optional peer is disclosed without claiming global dependency inertness", () => {
  const f = fixture();
  for (const lock of [f.baselineLock, f.candidateLock])
    lock.packages["node_modules/dev-only"] = {
      ...metadata("dev-only"),
      dev: true,
      peerDependencies: { "new-helper": "^1.0.0" },
      peerDependenciesMeta: { "new-helper": { optional: true } },
    };
  addUnrelated(f);
  const proof = inspect(f);
  assert.equal(proof.eligible, true);
  assert.deepEqual(proof.developmentOptionalPeerChanges, [
    {
      owner: "node_modules/dev-only",
      kind: "peerDependencies",
      name: "new-helper",
      before: null,
      after: "node_modules/new-helper",
    },
  ]);
  delete f.baselineLock.packages["node_modules/dev-only"]!.peerDependenciesMeta;
  delete f.candidateLock.packages["node_modules/dev-only"]!
    .peerDependenciesMeta;
  assert.equal(inspect(f).reason, "existing-development-resolution-changed");
});

void test("resolver honors scoped and nested installations before ancestor packages", () => {
  const packages = {
    "node_modules/@scope/a": {},
    "node_modules/@scope/a/node_modules/child": {},
    "node_modules/child": {},
  };
  assert.equal(
    resolveDependency(packages, "node_modules/@scope/a", "child"),
    "node_modules/@scope/a/node_modules/child",
  );
  assert.equal(
    resolveDependency(packages, "node_modules/other", "child"),
    "node_modules/child",
  );
  assert.equal(resolveDependency(packages, "", "missing"), null);
  assert.throws(
    () => resolveDependency(packages, "", "../child"),
    /invalid-package-name/,
  );
});

for (const path of [
  "src/server/session-planning/index.ts",
  "src/server/session-planning/new-runtime.ts",
  "src/server/api/routers/tutor.ts",
  "src/server/api/routers/admin.ts",
  "src/server/room-allocation.ts",
  "src/lib/school-calendar.ts",
  "prisma/schema.prisma",
  "prisma/migrations/new/migration.sql",
  ".github/scheduling-profile-manifests/current.json",
  "scripts/profile-scheduling-requests.ts",
  "scripts/run-scheduling-profile-ci.sh",
  "scripts/scheduling-profile/fixtures.ts",
  "scripts/scheduling-profile/metrics.ts",
  "scripts/scheduling-profile/http.ts",
  "scripts/scheduling-profile/scenarios.ts",
  "scripts/scheduling-profile/new-harness.mjs",
  ".github/workflows/scheduling-profile-worker.yml",
  ".github/actions/scheduling-profile-partition/action.yml",
  ".github/actions/scheduling-profile-partition/run.sh",
  "scripts/scheduling-profile/generate-workflow.mjs",
  "scripts/scheduling-profile/group-plan.mjs",
  "scripts/scheduling-profile/clock-admission.mjs",
  "scripts/scheduling-profile/aggregate-partitions.mjs",
  "scripts/scheduling-profile/resume-run.mjs",
])
  void test(`${path} requires measurements even alongside an additive dependency`, () => {
    const f = fixture();
    addUnrelated(f);
    const result = scoped(f, [
      path,
      "package-lock.json",
      "scripts/scheduling-profile/applicability.mjs",
    ]);
    assert.equal(result.status, "REQUIRED");
    assert.equal(result.reason, "watched-measurement-source-changed");
    assert.deepEqual(result.watchedSourcePaths, [path]);
  });

void test("workflow and admission-helper validation alone need regressions but do not invent a benchmark", () => {
  const result = scoped(fixture(), [
    ".github/workflows/scheduling-profile.yml",
    "scripts/scheduling-profile/comparison-inputs.mjs",
    "scripts/scheduling-profile/applicability.mjs",
    "scripts/scheduling-profile/applicability.test.ts",
    "scripts/scheduling-profile/applicability-workflow.spec.ts",
    "scripts/scheduling-profile/group-plan.spec.ts",
  ]);
  assert.equal(result.status, "NOT_APPLICABLE");
  assert.equal(result.validationOnlyPaths.length, 6);
  assert.deepEqual(result.watchedSourcePaths, []);
  assert.equal(
    scoped(
      fixture(),
      ["docs/reference/session-planning.md"],
      "workflow_dispatch",
    ).status,
    "REQUIRED",
  );
  assert.throws(
    () =>
      inspectApplicability({
        ...fixture(),
        event: "pull_request",
        baseRevision,
        candidateRevision: baseRevision,
        changedPaths: [],
      }),
    /candidate as its control/,
  );
});

void test("terminal gate fails closed on missing scope, failed declaration or unexpected worker execution", () => {
  const na = {
    matrixResult: "success",
    status: "NOT_APPLICABLE",
    clockStatus: "",
    preflightResult: "skipped",
    profileResult: "skipped",
  };
  assert.doesNotThrow(() => requireApplicabilityDeclaration(na));
  for (const status of ["", "PASS", "UNKNOWN"])
    assert.throws(() => requireApplicabilityDeclaration({ ...na, status }));
  for (const matrixResult of ["", "failure", "cancelled", "skipped"])
    assert.throws(() =>
      requireApplicabilityDeclaration({ ...na, matrixResult }),
    );
  for (const result of ["", "success", "failure", "cancelled"]) {
    assert.throws(() =>
      requireApplicabilityDeclaration({ ...na, preflightResult: result }),
    );
    assert.throws(() =>
      requireApplicabilityDeclaration({ ...na, profileResult: result }),
    );
  }
  assert.doesNotThrow(() =>
    requireApplicabilityDeclaration({
      ...na,
      status: "REQUIRED",
      clockStatus: "ADMITTED",
    }),
  );
  assert.throws(() =>
    requireApplicabilityDeclaration({
      ...na,
      status: "REQUIRED",
      clockStatus: "DEFERRED",
    }),
  );
});

function gitFixture(measuredDeletion = false) {
  const root = mkdtempSync(join(tmpdir(), "scheduling-applicability-"));
  const repository = join(root, "repository"),
    base = join(root, "base"),
    candidate = join(root, "candidate");
  mkdirSync(repository);
  const hooks = join(root, "empty-hooks");
  mkdirSync(hooks);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.autocrlf=false",
        "-c",
        `core.hooksPath=${hooks}`,
        ...args,
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  git(repository, "init", "-q");
  const f = fixture();
  const save = (manifest: unknown, lock: unknown) => {
    writeFileSync(join(repository, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(repository, "package-lock.json"), JSON.stringify(lock));
  };
  save(f.baselineManifest, f.baselineLock);
  mkdirSync(join(repository, "src/server/session-planning"), {
    recursive: true,
  });
  writeFileSync(
    join(repository, "src/server/session-planning/index.ts"),
    "export const synthetic = 1;\n",
  );
  git(repository, "add", ".");
  git(repository, "commit", "-qm", "Synthetic baseline");
  const original = git(repository, "rev-parse", "HEAD");
  addUnrelated(f);
  save(f.candidateManifest, f.candidateLock);
  if (measuredDeletion)
    rmSync(join(repository, "src/server/session-planning/index.ts"));
  git(repository, "add", "-A");
  git(repository, "commit", "-qm", "Synthetic candidate");
  const head = git(repository, "rev-parse", "HEAD");
  git(root, "clone", "-q", "--no-hardlinks", repository, base);
  git(base, "checkout", "-q", "--detach", original);
  git(root, "clone", "-q", "--no-hardlinks", repository, candidate);
  git(candidate, "checkout", "-q", "--detach", head);
  return {
    root,
    base,
    candidate,
    original,
    head,
    close() {
      assert.equal(dirname(resolve(root)), resolve(tmpdir()));
      assert.ok(basename(root).startsWith("scheduling-applicability-"));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

void test("Git-bound applicability inspects both exact revisions and preserves watched deletions", () => {
  for (const deleted of [false, true]) {
    const f = gitFixture(deleted);
    try {
      const binding = {
        event: "pull_request",
        baseRevision: f.original,
        candidateRevision: f.head,
      };
      const receipt = inspectGitApplicability(f.base, f.candidate, binding);
      assert.equal(
        inspectGitApplicability(join(f.root, "no-base-checkout"), f.candidate, {
          ...binding,
          event: "workflow_dispatch",
        }).status,
        "REQUIRED",
      );
      assert.equal(receipt.status, deleted ? "REQUIRED" : "NOT_APPLICABLE");
      if (deleted)
        assert.ok(
          receipt.watchedSourcePaths.includes(
            "src/server/session-planning/index.ts",
          ),
        );
      writeFileSync(
        join(f.candidate, "package.json"),
        "Uncommitted edits do not replace immutable Git objects",
      );
      assert.deepEqual(
        inspectGitApplicability(f.base, f.candidate, binding),
        receipt,
      );
      assert.throws(
        () =>
          inspectGitApplicability(f.base, f.candidate, {
            ...binding,
            candidateRevision: f.original,
          }),
        /Checkout does not match/,
      );
    } finally {
      f.close();
    }
  }
});

void test("CLI proof replay checks the originating artifact digest and recomputes its immutable content", () => {
  const f = gitFixture();
  try {
    const script = fileURLToPath(
      new URL("./applicability.mjs", import.meta.url),
    );
    const artifact = join(f.root, "scope.json"),
      summary = join(f.root, "summary.md"),
      output = join(f.root, "outputs.txt");
    const env = {
      ...process.env,
      PROFILE_SCOPE_EVENT: "pull_request",
      PROFILE_SCOPE_BASE_SHA: f.original,
      PROFILE_SCOPE_CANDIDATE_SHA: f.head,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
    };
    const run = (mode: string, more: Record<string, string> = {}) =>
      spawnSync(
        process.execPath,
        [script, mode, f.base, f.candidate, artifact],
        { env: { ...env, ...more }, encoding: "utf8" },
      );
    const generated = run("inspect");
    assert.equal(generated.status, 0, generated.stderr);
    const bytes = readFileSync(artifact),
      hash = createHash("sha256").update(bytes).digest("hex");
    assert.match(readFileSync(output, "utf8"), /status=NOT_APPLICABLE/);
    assert.match(
      readFileSync(summary, "utf8"),
      /No scheduling benchmark ran and no measured PASS is claimed/,
    );
    assert.equal(run("verify", { PROFILE_SCOPE_PROOF_SHA256: hash }).status, 0);
    assert.notEqual(
      run("verify", { PROFILE_SCOPE_PROOF_SHA256: "0".repeat(64) }).status,
      0,
    );
    const tampered = JSON.parse(bytes.toString()) as { reason: string };
    tampered.reason = "An untrusted assertion is not an applicability proof";
    writeFileSync(artifact, JSON.stringify(tampered));
    const alteredHash = createHash("sha256")
      .update(readFileSync(artifact))
      .digest("hex");
    const rejected = run("verify", { PROFILE_SCOPE_PROOF_SHA256: alteredHash });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /proof differs/);
  } finally {
    f.close();
  }
});
