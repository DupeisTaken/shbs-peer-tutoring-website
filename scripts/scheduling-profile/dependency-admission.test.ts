import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateDependencyAdmission,
  parseAdmissionManifest,
} from "./dependency-admission.mjs";

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

function writeFile(root: string, rel: string, contents: string) {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function makeBasePackageJson(extra: Record<string, unknown> = {}) {
  return JSON.stringify(
    {
      name: "fixture-app",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: { build: "next build" },
      dependencies: {
        "@prisma/adapter-pg": "^7.8.0",
        "@prisma/client": "^7.8.0",
        dotenv: "^17.4.2",
        pg: "^8.22.0",
        prisma: "^7.8.0",
        "server-only": "^0.0.1",
        tsx: "^4.23.0",
        zod: "^4.6.7",
        ...(extra.dependencies as Record<string, string> | undefined),
      },
      devDependencies: {
        eslint: "^9.39.4",
        "js-yaml": "^4.3.2",
        typescript: "^6.0.3",
        vite: "^8.1.6",
        ...(extra.devDependencies as Record<string, string> | undefined),
      },
      ...(extra.overrides ? { overrides: extra.overrides } : {}),
      ...(extra.scripts ? { scripts: extra.scripts } : {}),
    },
    null,
    2,
  ) + "\n";
}

function makeBaseLockfile(extraPackages: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const packages: Record<string, unknown> = {
    "": {
      name: "fixture-app",
      version: "0.1.0",
    },
    "node_modules/@prisma/adapter-pg": { version: "7.8.0", dependencies: { pg: "^8.22.0" } },
    "node_modules/@prisma/client": { version: "7.8.0" },
    "node_modules/dotenv": { version: "17.4.2" },
    "node_modules/esbuild": { version: "0.25.0" },
    "node_modules/eslint": { version: "9.39.4", dev: true },
    "node_modules/js-yaml": { version: "4.3.2", dev: true },
    "node_modules/pg": { version: "8.22.0" },
    "node_modules/prisma": { version: "7.8.0" },
    "node_modules/server-only": { version: "0.0.1" },
    "node_modules/tsx": { version: "4.23.0", dependencies: { esbuild: "^0.25.0" } },
    "node_modules/typescript": { version: "6.0.3", dev: true },
    "node_modules/vite": { version: "8.1.6", dev: true, dependencies: { rollup: "^4.0.0" } },
    "node_modules/rollup": { version: "4.0.0", dev: true },
    "node_modules/zod": { version: "4.6.7" },
    ...extraPackages,
    ...overrides,
  };
  return JSON.stringify({ name: "fixture-app", lockfileVersion: 3, packages }, null, 2) + "\n";
}

function createRepoFixture() {
  const root = mkdtempSync(join(tmpdir(), "scheduling-dep-admission-"));
  const baselineRoot = join(root, ".profile-baseline");
  const candidateRoot = join(root, "candidate");
  mkdirSync(baselineRoot, { recursive: true });
  mkdirSync(candidateRoot, { recursive: true });

  const seedCommon = (dir: string) => {
    writeFile(dir, "package.json", makeBasePackageJson());
    writeFile(dir, "package-lock.json", makeBaseLockfile());
    writeFile(dir, "prisma/schema.prisma", "model Term { id String @id }\n");
    writeFile(dir, "prisma/migrations/0_init/migration.sql", "SELECT 1;\n");
    writeFile(
      dir,
      "scripts/profile-scheduling-requests.ts",
      'import { z } from "zod";\nimport { helper } from "../src/server/scheduling-helper";\nexport const run = () => [z, helper];\n',
    );
    writeFile(dir, "src/server/scheduling-helper.ts", "export const helper = 1;\n");
    writeFile(dir, "src/server/help/pdf.ts", "export const renderHelp = () => true;\n");
  };
  seedCommon(baselineRoot);
  seedCommon(candidateRoot);

  const commit = (dir: string, message: string) => {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!readFileSyncSafe(join(dir, ".git/HEAD"))) git("init", "--quiet");
    git("add", "-A");
    git(
      "-c", "user.email=fixture@example.invalid",
      "-c", "user.name=Fixture",
      "-c", "commit.gpgSign=false",
      "commit", "--quiet", "-m", message,
    );
    return git("rev-parse", "HEAD");
  };

  return {
    root,
    baselineRoot,
    candidateRoot,
    writeBase: (rel: string, content: string) => writeFile(baselineRoot, rel, content),
    writeCand: (rel: string, content: string) => writeFile(candidateRoot, rel, content),
    commit,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

function readFileSyncSafe(filePath: string) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function makeManifest(
  baselineRoot: string,
  candidateRoot: string,
  baselineRevision: string,
  changedPackages: string[],
  reason = "Reviewed non-scheduling dependency update",
) {
  return JSON.stringify(
    {
      version: 1,
      disposition: "NOT_APPLICABLE_NON_SCHEDULING_DEPENDENCY",
      baselineRevision,
      baselinePackageJsonSha256: sha256(readFileSync(join(baselineRoot, "package.json"))),
      candidatePackageJsonSha256: sha256(readFileSync(join(candidateRoot, "package.json"))),
      baselineDependencyLockSha256: sha256(readFileSync(join(baselineRoot, "package-lock.json"))),
      candidateDependencyLockSha256: sha256(readFileSync(join(candidateRoot, "package-lock.json"))),
      changedPackages,
      reason,
    },
    null,
    2,
  ) + "\n";
}

void test("admits PR #743-style non-scheduling runtime dependency (pdfkit + help files) with a reviewed manifest as NOT_APPLICABLE", () => {
  const f = createRepoFixture();
  try {
    const baseSha = "a".repeat(40);
    const candSha = "b".repeat(40);
    f.writeCand(
      "package.json",
      makeBasePackageJson({
        dependencies: { pdfkit: "^0.20.2" },
        devDependencies: { "@types/pdfkit": "^0.17.7" },
      }),
    );
    f.writeCand(
      "package-lock.json",
      makeBaseLockfile({
        "node_modules/pdfkit": { version: "0.20.2", dependencies: { fontkit: "^2.0.0" } },
        "node_modules/fontkit": { version: "2.0.0" },
        "node_modules/@types/pdfkit": { version: "0.17.7", dev: true },
      }),
    );
    f.writeCand("src/server/help/pdf.ts", 'import PDFDocument from "pdfkit";\nexport const renderHelp = () => PDFDocument;\n');
    const manifestRel = ".github/scheduling-profile-manifests/pr-743-admission.json";
    f.writeCand(manifestRel, makeManifest(f.baselineRoot, f.candidateRoot, baseSha, ["@types/pdfkit", "pdfkit"]));

    const result = evaluateDependencyAdmission({
      baselineRoot: f.baselineRoot,
      candidateRoot: f.candidateRoot,
      baselineRevision: baseSha,
      candidateRevision: candSha,
      admissionManifestPath: manifestRel,
    });
    assert.equal(result.status, "NOT_APPLICABLE");
    assert.equal(result.disposition, "NOT_APPLICABLE_NON_SCHEDULING_DEPENDENCY");
    assert.equal(result.measured, false);
    assert.equal(result.samplingComplete, false);
    assert.equal(result.latencyComparisonEligible, false);
    assert.equal(result.schedulingClosureUnchanged, true);
    assert.deepEqual(result.changedPackages, ["@types/pdfkit", "pdfkit"]);
  } finally {
    f.close();
  }
});

void test("admits devDependency/tooling updates (vite) with reviewed manifest and blocks when manifest is absent", () => {
  const f = createRepoFixture();
  try {
    const baseSha = "a".repeat(40);
    const candSha = "b".repeat(40);
    f.writeCand("package.json", makeBasePackageJson({ devDependencies: { vite: "^8.1.7" } }));
    f.writeCand("package-lock.json", makeBaseLockfile({}, { "node_modules/vite": { version: "8.1.7", dev: true, dependencies: { rollup: "^4.0.0" } } }));

    // Without a reviewed manifest, fail closed (never auto-bypass).
    const unreviewed = evaluateDependencyAdmission({
      baselineRoot: f.baselineRoot,
      candidateRoot: f.candidateRoot,
      baselineRevision: baseSha,
      candidateRevision: candSha,
      admissionManifestPath: null,
    });
    assert.equal(unreviewed.status, "BLOCKED");
    assert.equal(unreviewed.disposition, "BLOCKED_LOCKFILE_MISMATCH");
    assert.equal(unreviewed.schedulingClosureUnchanged, true);
    assert.deepEqual(unreviewed.changedPackages, ["vite"]);

    const manifestRel = ".github/scheduling-profile-manifests/pr-765-admission.json";
    f.writeCand(manifestRel, makeManifest(f.baselineRoot, f.candidateRoot, baseSha, ["vite"]));
    const reviewed = evaluateDependencyAdmission({
      baselineRoot: f.baselineRoot,
      candidateRoot: f.candidateRoot,
      baselineRevision: baseSha,
      candidateRevision: candSha,
      admissionManifestPath: manifestRel,
    });
    assert.equal(reviewed.status, "NOT_APPLICABLE");
    assert.equal(reviewed.measured, false);
  } finally {
    f.close();
  }
});

void test("blocks shared transitive dependency change (esbuild shared with tsx) even when a reviewed manifest is present", () => {
  const f = createRepoFixture();
  try {
    const baseSha = "a".repeat(40);
    const candSha = "b".repeat(40);
    f.writeCand("package.json", makeBasePackageJson({ devDependencies: { vite: "^8.1.7" } }));
    f.writeCand(
      "package-lock.json",
      makeBaseLockfile(
        {},
        {
          "node_modules/vite": { version: "8.1.7", dev: true },
          "node_modules/esbuild": { version: "0.25.1" },
        },
      ),
    );
    const manifestRel = ".github/scheduling-profile-manifests/pr-800-admission.json";
    f.writeCand(manifestRel, makeManifest(f.baselineRoot, f.candidateRoot, baseSha, ["vite"]));

    const result = evaluateDependencyAdmission({
      baselineRoot: f.baselineRoot,
      candidateRoot: f.candidateRoot,
      baselineRevision: baseSha,
      candidateRevision: candSha,
      admissionManifestPath: manifestRel,
    });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.disposition, "BLOCKED_SCHEDULING_DEPENDENCY_CHANGE");
    assert.equal(result.schedulingClosureUnchanged, false);
    assert.ok(result.blockingPackages.includes("esbuild"));
  } finally {
    f.close();
  }
});

void test("blocks direct scheduling dependency, scheduling import-graph file, schema, and package scripts changes", () => {
  const cases: Array<{ label: string; mutate: (f: ReturnType<typeof createRepoFixture>) => void; expectedPackage?: string; expectedFile?: string }> = [
    {
      label: "direct scheduling dependency (zod)",
      mutate: (f) => {
        f.writeCand("package.json", makeBasePackageJson({ dependencies: { zod: "^4.6.8" } }));
        f.writeCand("package-lock.json", makeBaseLockfile({}, { "node_modules/zod": { version: "4.6.8" } }));
      },
      expectedPackage: "zod",
    },
    {
      label: "file imported transitively by profile-scheduling-requests.ts",
      mutate: (f) => {
        f.writeCand("package.json", makeBasePackageJson({ devDependencies: { vite: "^8.1.7" } }));
        f.writeCand("package-lock.json", makeBaseLockfile({}, { "node_modules/vite": { version: "8.1.7", dev: true } }));
        f.writeCand("src/server/scheduling-helper.ts", "export const helper = 2;\n");
      },
      expectedFile: "src/server/scheduling-helper.ts",
    },
    {
      label: "prisma schema change",
      mutate: (f) => {
        f.writeCand("package.json", makeBasePackageJson({ devDependencies: { vite: "^8.1.7" } }));
        f.writeCand("package-lock.json", makeBaseLockfile({}, { "node_modules/vite": { version: "8.1.7", dev: true } }));
        f.writeCand("prisma/schema.prisma", "model Term { id String @id\n name String }\n");
      },
      expectedFile: "prisma/schema.prisma",
    },
    {
      label: "package.json scripts change",
      mutate: (f) => {
        f.writeCand("package.json", makeBasePackageJson({ devDependencies: { vite: "^8.1.7" }, scripts: { build: "next build", extra: "echo hi" } }));
        f.writeCand("package-lock.json", makeBaseLockfile({}, { "node_modules/vite": { version: "8.1.7", dev: true } }));
      },
      expectedFile: "package.json (scripts)",
    },
  ];

  for (const scenario of cases) {
    const f = createRepoFixture();
    try {
      const baseSha = "a".repeat(40);
      const candSha = "b".repeat(40);
      scenario.mutate(f);
      const manifestRel = ".github/scheduling-profile-manifests/pr-801-admission.json";
      f.writeCand(manifestRel, makeManifest(f.baselineRoot, f.candidateRoot, baseSha, ["vite"]));
      const result = evaluateDependencyAdmission({
        baselineRoot: f.baselineRoot,
        candidateRoot: f.candidateRoot,
        baselineRevision: baseSha,
        candidateRevision: candSha,
        admissionManifestPath: manifestRel,
      });
      assert.equal(result.status, "BLOCKED", scenario.label);
      assert.equal(result.disposition, "BLOCKED_SCHEDULING_DEPENDENCY_CHANGE", scenario.label);
      if (scenario.expectedPackage) assert.ok(result.blockingPackages.includes(scenario.expectedPackage), scenario.label);
      if (scenario.expectedFile) assert.ok(result.blockingFiles.includes(scenario.expectedFile), scenario.label);
    } finally {
      f.close();
    }
  }
});

void test("rejects self-control, identical lockfiles with manifest, and tampered/invalid admission manifests", () => {
  const f = createRepoFixture();
  try {
    const baseSha = "a".repeat(40);
    const candSha = "b".repeat(40);
    const selfControl = evaluateDependencyAdmission({
      baselineRoot: f.baselineRoot,
      candidateRoot: f.candidateRoot,
      baselineRevision: baseSha,
      candidateRevision: baseSha,
      admissionManifestPath: null,
    });
    assert.equal(selfControl.status, "BLOCKED");
    assert.equal(selfControl.disposition, "BLOCKED_SELF_CONTROL");

    const manifestRel = ".github/scheduling-profile-manifests/pr-802-admission.json";
    f.writeCand(manifestRel, makeManifest(f.baselineRoot, f.candidateRoot, baseSha, ["vite"]));
    const identicalWithManifest = evaluateDependencyAdmission({
      baselineRoot: f.baselineRoot,
      candidateRoot: f.candidateRoot,
      baselineRevision: baseSha,
      candidateRevision: candSha,
      admissionManifestPath: manifestRel,
    });
    assert.equal(identicalWithManifest.status, "BLOCKED");
    assert.equal(identicalWithManifest.disposition, "BLOCKED_INVALID_ADMISSION_MANIFEST");

    f.writeCand("package.json", makeBasePackageJson({ devDependencies: { vite: "^8.1.7" } }));
    f.writeCand("package-lock.json", makeBaseLockfile({}, { "node_modules/vite": { version: "8.1.7", dev: true } }));
    // Stale manifest hashes from before package.json/lockfile changed
    const staleManifest = evaluateDependencyAdmission({
      baselineRoot: f.baselineRoot,
      candidateRoot: f.candidateRoot,
      baselineRevision: baseSha,
      candidateRevision: candSha,
      admissionManifestPath: manifestRel,
    });
    assert.equal(staleManifest.status, "BLOCKED");
    assert.equal(staleManifest.disposition, "BLOCKED_INVALID_ADMISSION_MANIFEST");

    assert.throws(() => parseAdmissionManifest({ version: 1, extra: true }), /missing or unrecognized/);
  } finally {
    f.close();
  }
});

void test("evaluate-admission CLI writes distinct NOT_APPLICABLE and BLOCKED receipts and summaries", () => {
  const f = createRepoFixture();
  const cli = fileURLToPath(new URL("./evaluate-admission.mjs", import.meta.url));
  try {
    const baseSha = f.commit(f.baselineRoot, "baseline");
    f.writeCand("package.json", makeBasePackageJson({ devDependencies: { vite: "^8.1.7" } }));
    f.writeCand("package-lock.json", makeBaseLockfile({}, { "node_modules/vite": { version: "8.1.7", dev: true } }));
    const manifestRel = ".github/scheduling-profile-manifests/pr-744-admission.json";
    f.writeCand(manifestRel, makeManifest(f.baselineRoot, f.candidateRoot, baseSha, ["vite"], "Tooling-only vite bump"));
    const candSha = f.commit(f.candidateRoot, "candidate");

    // Place baseline at candidate/.profile-baseline matching workflow layout
    const nestedBase = join(f.candidateRoot, ".profile-baseline");
    execFileSync("git", ["clone", "--quiet", "-c", "core.autocrlf=false", f.baselineRoot, nestedBase]);

    const outputPath = join(f.root, "gh-output.txt");
    const summaryPath = join(f.root, "gh-summary.md");
    const receiptPath = join(f.root, "admission.json");
    const okRun = spawnSync(process.execPath, [cli], {
      cwd: f.candidateRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CANDIDATE_SHA: candSha,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        ADMISSION_RECEIPT_PATH: receiptPath,
        SELECTION: JSON.stringify({
          baseline: baseSha,
          catalogBaseline: baseSha,
          manifest: "",
          admissionManifest: manifestRel,
          admissionManifestFileSha256: sha256(readFileSync(join(f.candidateRoot, manifestRel))),
          baselineSelectionSource: "default-baseline",
        }),
      },
    });
    assert.equal(okRun.status, 0, okRun.stderr);
    assert.match(readFileSync(outputPath, "utf8"), /^status=NOT_APPLICABLE$/m);
    assert.match(readFileSync(summaryPath, "utf8"), /NOT a measured PASS/);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as { status: string; measured: boolean };
    assert.equal(receipt.status, "NOT_APPLICABLE");
    assert.equal(receipt.measured, false);

    // Without any admission manifest committed, CLI exits 1 with concise early BLOCKED_LOCKFILE_MISMATCH diagnostic
    rmSync(join(f.candidateRoot, manifestRel));
    const candShaNoManifest = f.commit(f.candidateRoot, "candidate without admission manifest");
    const blockedOutput = join(f.root, "gh-output-blocked.txt");
    const blockedSummary = join(f.root, "gh-summary-blocked.md");
    const blockedReceipt = join(f.root, "admission-blocked.json");
    const failRun = spawnSync(process.execPath, [cli], {
      cwd: f.candidateRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CANDIDATE_SHA: candShaNoManifest,
        GITHUB_OUTPUT: blockedOutput,
        GITHUB_STEP_SUMMARY: blockedSummary,
        ADMISSION_RECEIPT_PATH: blockedReceipt,
        SELECTION: JSON.stringify({
          baseline: baseSha,
          catalogBaseline: baseSha,
          manifest: "",
          admissionManifest: "",
          baselineSelectionSource: "default-baseline",
        }),
      },
    });
    assert.equal(failRun.status, 1);
    assert.match(readFileSync(blockedOutput, "utf8"), /^status=BLOCKED$/m);
    assert.match(failRun.stderr, /BLOCKED_LOCKFILE_MISMATCH/);
    assert.match(readFileSync(blockedSummary, "utf8"), /Expected manifest hashes/);
  } finally {
    f.close();
  }
});
