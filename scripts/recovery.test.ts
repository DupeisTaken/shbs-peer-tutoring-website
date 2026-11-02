/** No application bootstrap, credentials, PostgreSQL, Docker or integration fixtures. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { Readable } from "node:stream";
import {
  parseRecoveryCommand,
  parseRecordKey,
} from "../src/server/recovery/operator-cli";
import {
  databaseIdentity,
  planHash,
  readOperatorPlan,
  writeOperatorJson,
} from "../src/server/recovery/operator-plan";
import {
  createSitePlan,
  stageSitePlan,
  executeRecoveryTool,
  inspectLogicalBackup,
  compareCheckpoints,
  type SiteDependencies,
  type ToolRequest,
} from "../src/server/recovery/operator-site";

const hash = "a".repeat(64);
const sourceUrl = "postgresql://site:secret-source@127.0.0.1:5432/current_site";
const maintenanceUrl =
  "postgresql://operator:secret-stage@127.0.0.1:5544/postgres";
const sql =
  "--\n-- PostgreSQL database dump\n--\nCREATE TABLE example (id int);\n";
async function temporary(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "shbs-recovery-"));
  t.after(async () => {
    await rm(dir, { force: true, recursive: true });
  });
  return dir;
}

void test("strict parser supports bounded inspection, checkpoints, compare, restore and receipt reads", () => {
  assert.deepEqual(parseRecoveryCommand([]), { kind: "help" });
  assert.deepEqual(parseRecoveryCommand(["records", "tables"]), {
    kind: "records.tables",
  });
  assert.deepEqual(
    parseRecoveryCommand([
      "records",
      "inspect",
      "--table",
      "User",
      "--key",
      '{"id":"x"}',
      "--limit",
      "100",
    ]),
    { kind: "records.inspect", table: "User", key: { id: "x" }, limit: 100 },
  );
  assert.equal(
    parseRecoveryCommand([
      "admission",
      "checkpoint",
      "--action-id",
      "a",
      "--actor-id",
      "u",
      "--out",
      "plan.json",
    ]).kind,
    "admission.inspect",
  );
  assert.equal(
    parseRecoveryCommand([
      "admission",
      "restore",
      "--plan",
      "p",
      "--plan-hash",
      hash,
      "--actor-id",
      "u",
      "--reason",
      "Correction",
      "--client-key",
      "dd2fb7bb-268a-4d7e-aeea-c81b7b534888",
    ]).kind,
    "admission.apply",
  );
  assert.equal(
    parseRecoveryCommand([
      "admission",
      "compare",
      "--plan",
      "p",
      "--plan-hash",
      hash,
      "--actor-id",
      "u",
    ]).kind,
    "admission.compare",
  );
  assert.equal(
    parseRecoveryCommand([
      "admission",
      "receipt",
      "--receipt-id",
      "r",
      "--actor-id",
      "u",
    ]).kind,
    "admission.receipt",
  );
});
void test("parser refuses role impersonation, SQL, missing values, repeated flags and unbounded requests", () => {
  const invalid = [
    ["sql", "execute"],
    ["records", "inspect"],
    ["records", "tables", "--role", "HEAD"],
    ["records", "inspect", "--table", "User", "--table", "Tutor"],
    ["records", "inspect", "--table", "User", "--limit", "0"],
    ["records", "inspect", "--table", "User", "--limit", "101"],
    ["records", "inspect", "--table", "User", "--limit", "1.5"],
    ["records", "inspect", "--table", "User", "--limit", "1e2"],
    ["records", "inspect", "--table", "User;DROP TABLE User"],
    ["records", "inspect", "--table", "User", "--cursor"],
    [
      "admission",
      "apply",
      "--plan",
      "p",
      "--plan-hash",
      hash,
      "--actor-id",
      "u",
      "--reason",
      "test",
      "--client-key",
      "invalid",
    ],
    ["site", "stage", "--plan", "p", "--reason", "test"],
    [
      "site",
      "plan",
      "--backup",
      "b",
      "--target-name",
      "current_site",
      "--evidence-dir",
      "d",
      "--out",
      "p",
    ],
    ["records", "inspect", "--table", "User\nPassword"],
  ];
  for (const args of invalid)
    assert.throws(
      () => parseRecoveryCommand(args),
      { name: "OperatorError" },
      args.join(" "),
    );
  for (const key of [
    "null",
    "[]",
    "{}",
    '{"id":{}}',
    '{"id":null}',
    '{"constructor":"x"}',
    '{"__proto__":"x"}',
    '{"id":1e999}',
    '{"id":"' + "x".repeat(9000) + '"}',
  ])
    assert.throws(() => parseRecordKey(key));
  assert.deepEqual(
    parseRecordKey('{"id":"a;$(x)","revision":2,"active":true}'),
    { id: "a;$(x)", revision: 2, active: true },
  );
});
void test("plan hashes are canonical, files are exclusive, changed plans and oversized plans are refused", async (t) => {
  const dir = await temporary(t);
  const file = join(dir, "plan.json");
  const plan = { version: 1, data: { b: 2, a: 1 } };
  assert.equal(planHash(plan), planHash({ data: { a: 1, b: 2 }, version: 1 }));
  await writeOperatorJson(file, plan);
  assert.deepEqual(await readOperatorPlan(file, planHash(plan)), plan);
  await assert.rejects(writeOperatorJson(file, {}));
  await writeFile(file, JSON.stringify({ ...plan, version: 2 }));
  await assert.rejects(
    readOperatorPlan(file, planHash(plan)),
    /PLAN_HASH_MISMATCH/,
  );
  await writeFile(file, "x".repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(readOperatorPlan(file, hash), /INVALID_PLAN_FILE/);
});
void test("database identity excludes passwords and rejects redirect options", () => {
  assert.deepEqual(databaseIdentity(sourceUrl), {
    host: "127.0.0.1",
    port: "5432",
    database: "current_site",
    user: "site",
  });
  for (const url of [
    "file:///db",
    "postgresql://u:p@host/db?host=other",
    "postgresql://u:p@host/db?options=-csearch_path=bad",
    "postgresql://u:p@host/",
  ])
    assert.throws(() => databaseIdentity(url));
});

function fixture(
  overrides: {
    targetExists?: boolean;
    failRestore?: boolean;
    failFence?: boolean;
    unsafeRole?: boolean;
    invalidEvidence?: boolean;
  } = {},
) {
  const queries: string[] = [];
  const tools: ToolRequest[] = [];
  const dependencies: SiteDependencies = {
    async connect(url) {
      const database = decodeURIComponent(new URL(url).pathname.slice(1));
      return {
        async query(query) {
          queries.push(query);
          if (query.includes("pg_database"))
            return { rows: overrides.targetExists ? [{ exists: 1 }] : [] };
          if (query.includes("pg_roles"))
            return {
              rows: [
                {
                  rolcanlogin: !!overrides.unsafeRole,
                  rolsuper: false,
                  rolcreaterole: false,
                  rolcreatedb: false,
                  rolreplication: false,
                  rolbypassrls: false,
                },
              ],
            };
          if (query.includes("ALLOW_CONNECTIONS") && overrides.failFence)
            throw new Error("secret fence detail");
          if (query.includes("current_database"))
            return { rows: [{ database, version: "18.0" }] };
          if (query.includes("pg_catalog.pg_tables"))
            return { rows: [{ name: "User" }] };
          if (query.startsWith("SELECT count"))
            return {
              rows: [
                { count: database.startsWith("shbs_recovery_") ? "2" : "3" },
              ],
            };
          return { rows: [] };
        },
        async close() {
          queries.push(`CLOSE:${database}`);
        },
      };
    },
    async execute(request) {
      tools.push(request);
      if (request.outputPath)
        await writeFile(
          request.outputPath,
          overrides.invalidEvidence
            ? "invalid-evidence"
            : "PGDMP-synthetic-current-site-evidence",
          { flag: "wx", mode: 0o600 },
        );
      if (request.input) {
        let restored = "";
        for await (const chunk of request.input) restored += String(chunk);
        assert.equal(restored, sql);
      }
      if (request.tool === "psql" && overrides.failRestore)
        throw new Error("private SQL and secret password");
    },
  };
  return { dependencies, queries, tools };
}
async function planned(
  t: TestContext,
  overrides: Parameters<typeof fixture>[0] = {},
) {
  const dir = await temporary(t);
  const backup = join(dir, "backup.sql.gz");
  const evidenceDir = join(dir, "evidence");
  await mkdir(evidenceDir);
  await writeFile(backup, gzipSync(sql));
  const fake = fixture(overrides);
  const plan = await createSitePlan(
    { backup, targetName: "shbs_recovery_test", evidenceDir },
    sourceUrl,
    maintenanceUrl,
    fake.dependencies,
  );
  return { dir, backup, plan, ...fake };
}
void test("logical-backup preflight hashes and validates gzip and PostgreSQL dump headers", async (t) => {
  const { dir, backup, plan } = await planned(t);
  assert.equal(plan.backup.sqlBytes, Buffer.byteLength(sql));
  assert.deepEqual(await inspectLogicalBackup(backup), plan.backup);
  const broken = join(dir, "broken.sql.gz");
  await writeFile(broken, "not gzip");
  await assert.rejects(
    inspectLogicalBackup(broken),
    /INVALID_OR_OVERSIZED_GZIP_BACKUP/,
  );
  await writeFile(broken, gzipSync("not a pg_dump file"));
  await assert.rejects(
    inspectLogicalBackup(broken),
    /UNSUPPORTED_BACKUP_FORMAT/,
  );
});
void test("site plan does not create databases or run tools and rejects existing/remote/wrong targets", async (t) => {
  const { backup, plan, dependencies, queries, tools } = await planned(t);
  assert.equal(tools.length, 0);
  assert.ok(!queries.some((query) => query.startsWith("CREATE DATABASE")));
  assert.ok(
    queries.includes("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"),
  );
  await assert.rejects(
    createSitePlan(
      { ...plan, backup, targetName: "current_site" },
      sourceUrl,
      maintenanceUrl,
      dependencies,
    ),
    /INVALID_TARGET_NAME/,
  );
  await assert.rejects(
    createSitePlan(
      { ...plan, backup },
      sourceUrl,
      maintenanceUrl.replace("127.0.0.1", "remote.example"),
      dependencies,
    ),
    /RECOVERY_REQUIRES_LOOPBACK_MAINTENANCE/,
  );
  await assert.rejects(
    createSitePlan(
      { ...plan, backup },
      sourceUrl,
      maintenanceUrl.replace("5544", "5432"),
      dependencies,
    ),
    /RECOVERY_REQUIRES_SEPARATE_POSTGRES_INSTANCE/,
  );
  await assert.rejects(
    createSitePlan(
      { ...plan, backup },
      sourceUrl,
      maintenanceUrl.replace("operator:", "site:"),
      dependencies,
    ),
    /RECOVERY_REQUIRES_SEPARATE_OPERATOR_ROLE/,
  );
  await assert.rejects(
    createSitePlan(
      { ...plan, backup },
      sourceUrl,
      maintenanceUrl,
      fixture({ targetExists: true }).dependencies,
    ),
    /TARGET_DATABASE_ALREADY_EXISTS/,
  );
  await assert.rejects(
    createSitePlan(
      { ...plan, backup },
      sourceUrl,
      maintenanceUrl,
      fixture({ unsafeRole: true }).dependencies,
    ),
    /STAGING_SOURCE_ROLE_MUST_BE_NOLOGIN_AND_UNPRIVILEGED/,
  );
});
void test("invalid current evidence prevents even isolated target creation", async (t) => {
  const { plan, dependencies, queries } = await planned(t, {
    invalidEvidence: true,
  });
  await assert.rejects(
    stageSitePlan(
      plan,
      sourceUrl,
      maintenanceUrl,
      "Recovery rehearsal",
      dependencies,
    ),
    /SITE_STAGE_FAILED_REVIEW_EVIDENCE/,
  );
  assert.ok(!queries.some((query) => query.startsWith("CREATE DATABASE")));
});
void test("staging captures external current evidence, restores only fresh database and fences connections", async (t) => {
  const { plan, dependencies, queries, tools } = await planned(t);
  const receipt = await stageSitePlan(
    plan,
    sourceUrl,
    maintenanceUrl,
    "Recovery rehearsal",
    dependencies,
  );
  assert.equal(receipt.state, "SEALED_STAGING_ONLY");
  assert.equal(
    receipt.cutover,
    "BLOCKED_SECURITY_RECONCILIATION_AND_MANUAL_REVIEW",
  );
  assert.equal(receipt.comparison[0]?.changed, true);
  assert.equal(tools[0]?.tool, "pg_dump");
  assert.equal(tools[0]?.env.PGDATABASE, "current_site");
  assert.equal(tools[1]?.tool, "psql");
  assert.equal(tools[1]?.env.PGDATABASE, "shbs_recovery_test");
  assert.ok(tools[1]?.args.includes("--single-transaction"));
  assert.ok(!JSON.stringify(tools.map((tool) => tool.args)).includes("secret"));
  assert.ok(
    queries.includes(
      'REVOKE CONNECT ON DATABASE "shbs_recovery_test" FROM PUBLIC',
    ),
  );
  assert.ok(
    queries.includes(
      'ALTER DATABASE "shbs_recovery_test" ALLOW_CONNECTIONS false',
    ),
  );
  assert.ok(
    !queries.some((query) => /DROP DATABASE|ALTER ROLE|PASSWORD/.test(query)),
  );
  assert.ok(
    await readFile(
      join(receipt.evidenceDirectory, "current-site.dump"),
      "utf8",
    ),
  );
  assert.equal(
    (
      JSON.parse(
        await readFile(join(receipt.evidenceDirectory, "receipt.json"), "utf8"),
      ) as { state: string }
    ).state,
    "SEALED_STAGING_ONLY",
  );
  // The external intent directory is a durable replay lock even with a stub DB.
  await assert.rejects(
    stageSitePlan(plan, sourceUrl, maintenanceUrl, "Retry", dependencies),
    /SITE_STAGE_FAILED_REVIEW_EVIDENCE/,
  );
  assert.equal(tools.length, 2);
});
void test("changed backup, edited input and wrong source database fail before tools or target creation", async (t) => {
  const { plan, backup, dependencies, tools } = await planned(t);
  await assert.rejects(
    stageSitePlan(
      plan,
      sourceUrl.replace("current_site", "other_site"),
      maintenanceUrl,
      "test",
      dependencies,
    ),
    /WRONG_DATABASE/,
  );
  await assert.rejects(
    stageSitePlan(
      { ...plan, targetName: 'x"; DROP DATABASE current_site;' },
      sourceUrl,
      maintenanceUrl,
      "test",
      dependencies,
    ),
    /INVALID_SITE_PLAN/,
  );
  await writeFile(backup, gzipSync(sql + "-- changed\n"));
  await assert.rejects(
    stageSitePlan(plan, sourceUrl, maintenanceUrl, "test", dependencies),
    /BACKUP_CHANGED/,
  );
  assert.equal(tools.length, 0);
});
void test("failed restore fences and records failure without exposing driver details", async (t) => {
  const { plan, dependencies, queries } = await planned(t, {
    failRestore: true,
  });
  await assert.rejects(
    stageSitePlan(plan, sourceUrl, maintenanceUrl, "test", dependencies),
    /SITE_STAGE_FAILED_REVIEW_EVIDENCE/,
  );
  assert.ok(
    queries.includes(
      'ALTER DATABASE "shbs_recovery_test" ALLOW_CONNECTIONS false',
    ),
  );
  const data = await readFile(
    join(plan.evidenceDir, plan.id, "failure.json"),
    "utf8",
  );
  assert.equal((JSON.parse(data) as { state: string }).state, "FAILED_SEALED");
  assert.ok(!data.includes("secret"));
});
void test("failed connection fence emits an actionable separate failure state", async (t) => {
  const { plan, dependencies } = await planned(t, {
    failRestore: true,
    failFence: true,
  });
  await assert.rejects(
    stageSitePlan(plan, sourceUrl, maintenanceUrl, "test", dependencies),
    /STAGE_FAILED_FENCE_REQUIRES_MANUAL_INTERVENTION/,
  );
  assert.equal(
    (
      JSON.parse(
        await readFile(join(plan.evidenceDir, plan.id, "failure.json"), "utf8"),
      ) as { state: string }
    ).state,
    "FAILED_FENCE_REQUIRES_MANUAL_INTERVENTION",
  );
});
void test("checkpoint comparison reports missing, added and changed tables without returning records", () => {
  const base = {
    database: "db",
    serverVersion: "18",
    tables: [
      { table: "A", count: "1" },
      { table: "B", count: "3" },
    ],
  };
  assert.deepEqual(
    compareCheckpoints(base, {
      ...base,
      tables: [
        { table: "B", count: "3" },
        { table: "C", count: "4" },
      ],
    }),
    [
      { table: "A", before: "1", restored: null, changed: true },
      { table: "B", before: "3", restored: "3", changed: false },
      { table: "C", before: null, restored: "4", changed: true },
    ],
  );
});
void test("real subprocess adapter executes a fake pg tool with literal argv and streams, sanitizes stderr", async (t) => {
  const dir = await temporary(t);
  const executable = join(dir, "fake-pg.mjs");
  const outputPath = join(dir, "evidence.dump");
  await writeFile(
    executable,
    'let input=""; for await (const chunk of process.stdin) input+=chunk; process.stdout.write(JSON.stringify({args:process.argv.slice(2),input})); if(process.argv.includes("fail")){process.stderr.write("secret-password private SQL");process.exitCode=9;}',
  );
  const args = [executable, "--no-password", "$(touch forbidden); & echo no"];
  await executeRecoveryTool(
    {
      tool: "psql",
      args,
      env: { NODE_ENV: "test" },
      input: Readable.from(["synthetic dump"]),
      outputPath,
    },
    process.execPath,
  );
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), {
    args: args.slice(1),
    input: "synthetic dump",
  });
  await assert.rejects(
    executeRecoveryTool(
      { tool: "psql", args: [executable, "fail"], env: { NODE_ENV: "test" } },
      process.execPath,
    ),
    (error) =>
      error instanceof Error && error.message === "POSTGRES_TOOL_FAILED",
  );
});
