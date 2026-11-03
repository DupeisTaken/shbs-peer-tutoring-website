import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectComparisonInputs } from "./comparison-inputs.mjs";

void test("comparison overlay accepts only appended metadata and unchanged historical migrations", () => {
  const root = mkdtempSync(join(tmpdir(), "scheduling-comparison-test-"));
  const baseline = join(root, "baseline"), candidate = join(root, "candidate");
  const write = (directory: string, path: string, value: string) => {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, value);
  };
  try {
    const original = "model Domain {\n  id String @id\n}\n";
    const changed = original + "\n// Rebuildable metadata only.\nmodel SchedulingMaintenanceState {\n  id String @id\n}\nmodel SchedulingDirtyEvent {\n  id BigInt @id\n}\n";
    for (const directory of [baseline, candidate]) {
      write(directory, "package-lock.json", "{}");
      write(directory, "prisma/schema.prisma", original);
      write(directory, "prisma/migrations/20260101000000_original/migration.sql", "CREATE TABLE original ();\n");
    }
    write(candidate, "prisma/schema.prisma", changed);
    write(candidate, "prisma/migrations/20261103030000_scheduling_maintenance/migration.sql", "CREATE TABLE metadata ();\n");
    const manifest = inspectComparisonInputs(baseline, candidate);
    assert.equal(manifest.mode, "additive");
    assert.equal(manifest.requiresNativeSchemaControl, true);
    assert.equal(manifest.overlayPaths.length, 2);
    assert.notEqual(manifest.originalSchemaSha256, manifest.candidateSchemaSha256);
    write(candidate, "prisma/schema.prisma", changed.replace("id String @id", "id String @id @default(cuid())"));
    assert.throws(() => inspectComparisonInputs(baseline, candidate), /existing schema/);
    write(candidate, "prisma/schema.prisma", changed);
    write(candidate, "prisma/migrations/20260101000000_original/migration.sql", "ALTER TABLE original DROP COLUMN evidence;\n");
    assert.throws(() => inspectComparisonInputs(baseline, candidate), /Historical migration/);
  } finally {
    // This path is the unique temporary directory created by this test.
    rmSync(root, { recursive: true, force: true });
  }
});

type ComparisonFixture = {
  baseline: string;
  candidate: string;
  schema: string;
  write: (directory: string, path: string, value: string) => void;
};

function withIdenticalMetadataInputs(work: (fixture: ComparisonFixture) => void) {
  const root = mkdtempSync(join(tmpdir(), "scheduling-identical-inputs-test-"));
  const baseline = join(root, "baseline"), candidate = join(root, "candidate");
  const schema = "model Domain {\n  id String @id\n}\n\nmodel SchedulingMaintenanceState {\n  id String @id\n}\nmodel SchedulingDirtyEvent {\n  id BigInt @id\n}\n";
  const write = (directory: string, path: string, value: string) => {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, value);
  };
  try {
    for (const directory of [baseline, candidate]) {
      write(directory, "package-lock.json", "{}");
      write(directory, "prisma/schema.prisma", schema);
      write(directory, "prisma/migrations/20260101000000_original/migration.sql", "CREATE TABLE original ();\n");
      write(directory, "prisma/migrations/20261103030000_scheduling_maintenance/migration.sql", "CREATE TABLE metadata ();\n");
    }
    work({ baseline, candidate, schema, write });
  } finally {
    // Delete only this helper's unique, freshly created fixture directory.
    rmSync(root, { recursive: true, force: true });
  }
}

void test("post-merge identical metadata schemas need no overlay or native-schema control", () => {
  withIdenticalMetadataInputs(({ baseline, candidate }) => {
    const first = inspectComparisonInputs(baseline, candidate);
    assert.equal(first.mode, "identical");
    assert.equal(first.requiresNativeSchemaControl, false);
    assert.deepEqual(first.overlayPaths, []);
    assert.deepEqual(first.overlayHashes, {});
    assert.equal(first.originalSchemaSha256, first.candidateSchemaSha256);
    assert.equal(first.originalLockfileSha256, first.candidateLockfileSha256);
    assert.equal(Object.keys(first.historicalMigrations).length, 2);
    assert.deepEqual(first.historicalMigrations, first.candidateMigrationHashes);
    assert.deepEqual(inspectComparisonInputs(baseline, candidate), first,
      "Reading already-identical inputs remains idempotent");
  });
});

void test("identical-schema mode rejects edits to historical or already-present metadata migrations", () => {
  for (const name of ["20260101000000_original", "20261103030000_scheduling_maintenance"]) {
    withIdenticalMetadataInputs(({ baseline, candidate, write }) => {
      write(candidate, `prisma/migrations/${name}/migration.sql`, "DROP TABLE original;\n");
      assert.throws(() => inspectComparisonInputs(baseline, candidate), /Historical migration changed/);
    });
  }
});

void test("identical-schema mode refuses domain and metadata schema drift", () => {
  for (const field of ["id String @id", "id BigInt @id"]) {
    withIdenticalMetadataInputs(({ baseline, candidate, schema, write }) => {
      write(candidate, "prisma/schema.prisma", schema.replace(field, `${field} @default(autoincrement())`));
      assert.throws(() => inspectComparisonInputs(baseline, candidate), /existing schema/);
    });
  }
});

void test("identical schema alone cannot allow an added migration or changed dependency lock", () => {
  withIdenticalMetadataInputs(({ baseline, candidate, write }) => {
    write(candidate, "prisma/migrations/20261104010000_unreviewed/migration.sql", "CREATE TABLE unreviewed ();\n");
    assert.throws(() => inspectComparisonInputs(baseline, candidate), /exact same migration list/);
  });
  withIdenticalMetadataInputs(({ baseline, candidate, write }) => {
    write(candidate, "package-lock.json", '{"lockfileVersion":99}');
    assert.throws(() => inspectComparisonInputs(baseline, candidate), /Dependency lockfiles differ/);
  });
});

void test("identical mode uses exact migration bytes including line endings", () => {
  withIdenticalMetadataInputs(({ baseline, candidate, write }) => {
    write(candidate, "prisma/migrations/20260101000000_original/migration.sql", "CREATE TABLE original ();\r\n");
    assert.throws(() => inspectComparisonInputs(baseline, candidate), /Historical migration changed/);
  });
});

type ReviewedManifest = {
  version: 1;
  baselineSchemaSha256: string;
  candidateSchemaSha256: string;
  dependencyLockSha256: string;
  addedMigrations: { path: string; sha256: string }[];
  historicalMigrations: Record<string, string>;
};
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const addedPath = "prisma/migrations/20261201010000_reviewed_delta/migration.sql";
const originalPath = "prisma/migrations/20260101000000_original/migration.sql";

function withReviewedInputs(work: (fixture: ComparisonFixture & { manifest: ReviewedManifest }) => void) {
  withIdenticalMetadataInputs((fixture) => {
    const { baseline, candidate, schema, write } = fixture;
    write(candidate, "prisma/schema.prisma", schema.replace("id String @id", 'id String @id\n  label String @default("")'));
    write(candidate, addedPath, "ALTER TABLE original ADD COLUMN label TEXT;\n");
    for (const directory of [baseline, candidate])
      write(directory, "prisma/migrations/migration_lock.toml", 'provider = "postgresql"\n');
    const read = (directory: string, path: string) => readFileSync(join(directory, path));
    const manifest: ReviewedManifest = {
      version: 1,
      baselineSchemaSha256: hash(read(baseline, "prisma/schema.prisma")),
      candidateSchemaSha256: hash(read(candidate, "prisma/schema.prisma")),
      dependencyLockSha256: hash(read(baseline, "package-lock.json")),
      addedMigrations: [{ path: addedPath, sha256: hash(read(candidate, addedPath)) }],
      historicalMigrations: Object.fromEntries([
        originalPath,
        "prisma/migrations/20261103030000_scheduling_maintenance/migration.sql",
      ].map((path) => [path, hash(read(baseline, path))])),
    };
    work({ ...fixture, manifest });
  });
}

void test("an explicit reviewed manifest pins the exact shared-schema control and immutable evidence", () => {
  withReviewedInputs(({ baseline, candidate, manifest }) => {
    assert.throws(() => inspectComparisonInputs(baseline, candidate), /existing schema/);
    const result = inspectComparisonInputs(baseline, candidate, manifest);
    assert.equal(result.mode, "reviewed");
    assert.equal(result.requiresNativeSchemaControl, true);
    assert.deepEqual(result.overlayPaths, ["prisma/schema.prisma", addedPath]);
    assert.equal(result.reviewedManifestSha256, hash(JSON.stringify(result.reviewedManifest)));
    assert.equal(result.migrationLockSha256, hash('provider = "postgresql"\n'));
    assert.ok(Object.isFrozen(result.reviewedManifest));
    assert.ok(Object.isFrozen(result.reviewedManifest?.addedMigrations));
    assert.ok(Object.isFrozen(result.reviewedManifest?.historicalMigrations));
    manifest.addedMigrations[0]!.sha256 = "0".repeat(64);
    assert.notEqual(result.reviewedManifest?.addedMigrations[0]?.sha256, manifest.addedMigrations[0]!.sha256,
      "Validated evidence is copied rather than retaining a caller-owned object");
  });
});

void test("a candidate-local manifest never grants automatic review or permits unknown trust fields", () => {
  withReviewedInputs(({ baseline, candidate, manifest, write }) => {
    write(candidate, "scripts/scheduling-profile/reviewed-manifest.json", JSON.stringify(manifest));
    assert.throws(() => inspectComparisonInputs(baseline, candidate), /existing schema/);
    assert.throws(() => inspectComparisonInputs(baseline, candidate, { ...manifest, approved: true }), /unrecognized fields/);
    assert.throws(() => inspectComparisonInputs(baseline, candidate, { ...manifest, version: 2 }), /Unsupported/);
    assert.throws(() => inspectComparisonInputs(baseline, candidate, null), /must be an object/);
  });
});

void test("reviewed mode rejects mismatched schema, dependency and SQL hashes", () => {
  for (const field of ["baselineSchemaSha256", "candidateSchemaSha256", "dependencyLockSha256"] as const) {
    withReviewedInputs(({ baseline, candidate, manifest }) => {
      manifest[field] = "0".repeat(64);
      assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /hash differs/);
    });
  }
  withReviewedInputs(({ baseline, candidate, manifest }) => {
    manifest.addedMigrations[0]!.sha256 = "0".repeat(64);
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /added migration hash differs/);
  });
  withReviewedInputs(({ baseline, candidate, manifest }) => {
    manifest.historicalMigrations[originalPath] = "0".repeat(64);
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /historical baseline hash differs/);
  });
  withReviewedInputs(({ baseline, candidate, manifest, write }) => {
    write(candidate, originalPath, "DROP TABLE original;\n");
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /historical candidate hash differs/);
  });
  withReviewedInputs(({ baseline, candidate, manifest, write }) => {
    write(candidate, addedPath, "DROP TABLE original;\n");
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /added migration hash differs/);
  });
  withReviewedInputs(({ baseline, candidate, manifest, write }) => {
    write(candidate, "package-lock.json", '{"unreviewedDependency":true}');
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /Dependency lockfiles differ/);
  });
});

void test("reviewed paths cannot traverse directories, duplicate entries or replace history", () => {
  for (const path of ["../migration.sql", "/tmp/migration.sql", "prisma/migrations/../../migration.sql", "prisma\\migrations\\20261201010000_reviewed_delta\\migration.sql", "prisma/migrations/0_init/migration.sql"]) {
    withReviewedInputs(({ baseline, candidate, manifest }) => {
      manifest.addedMigrations[0]!.path = path;
      assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /exact normalized/);
    });
  }
  withReviewedInputs(({ baseline, candidate, manifest }) => {
    manifest.addedMigrations.push({ ...manifest.addedMigrations[0]! });
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /Duplicate/);
  });
  withReviewedInputs(({ baseline, candidate, manifest }) => {
    manifest.addedMigrations[0]!.path = originalPath;
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /replace a historical migration/);
  });
});

void test("reviewed inventories preserve the real historical bootstrap without permitting new legacy paths", () => {
  withReviewedInputs(({ baseline, candidate, manifest, write }) => {
    const migrations = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));
    const directories = readdirSync(migrations, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    assert.ok(directories.some((entry) => entry.name === "0_init"), "Exercise the repository's actual legacy migration");
    for (const entry of directories) {
      const path = `prisma/migrations/${entry.name}/migration.sql`;
      const sql = readFileSync(join(migrations, entry.name, "migration.sql"), "utf8");
      for (const directory of [baseline, candidate]) write(directory, path, sql);
      manifest.historicalMigrations[path] = hash(sql);
    }
    assert.equal(inspectComparisonInputs(baseline, candidate, manifest).mode, "reviewed");
    write(candidate, "prisma/migrations/0_init/migration.sql", "-- changed bootstrap\n");
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /historical candidate hash differs/);
  });
  for (const path of ["prisma/migrations/0_other/migration.sql", "prisma/migrations/init/migration.sql", "prisma/migrations/0_init/../migration.sql"]) {
    withReviewedInputs(({ baseline, candidate, manifest }) => {
      manifest.historicalMigrations[path] = "0".repeat(64);
      assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /Historical migration path must be an exact normalized/);
    });
  }
});

void test("reviewed mode requires complete inventories and unchanged migration configuration", () => {
  withReviewedInputs(({ baseline, candidate, manifest }) => {
    delete manifest.historicalMigrations[originalPath];
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /complete baseline/);
  });
  withReviewedInputs(({ baseline, candidate, manifest, write }) => {
    write(candidate, "prisma/migrations/20261202010000_unlisted/migration.sql", "CREATE TABLE unlisted ();\n");
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /candidate inventory differs/);
  });
  withReviewedInputs(({ baseline, candidate, manifest, write }) => {
    write(candidate, "prisma/migrations/20261201010000_reviewed_delta/extra.sql", "DROP TABLE original;\n");
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /directory contents/);
  });
  withReviewedInputs(({ baseline, candidate, manifest }) => {
    rmSync(join(candidate, originalPath));
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /directory contents/);
  });
  withReviewedInputs(({ baseline, candidate, manifest, write }) => {
    write(candidate, "prisma/migrations/migration_lock.toml", 'provider = "sqlite"\n');
    assert.throws(() => inspectComparisonInputs(baseline, candidate, manifest), /Migration lock files differ/);
  });
});

void test("reviewed mode remains explicit when hashes describe otherwise identical schemas", () => {
  withReviewedInputs(({ baseline, candidate, manifest, schema, write }) => {
    write(candidate, "prisma/schema.prisma", schema);
    manifest.candidateSchemaSha256 = manifest.baselineSchemaSha256;
    const result = inspectComparisonInputs(baseline, candidate, manifest);
    assert.equal(result.mode, "reviewed");
    assert.equal(result.requiresNativeSchemaControl, true);
    assert.deepEqual(result.overlayPaths, ["prisma/schema.prisma", addedPath]);
  });
});
