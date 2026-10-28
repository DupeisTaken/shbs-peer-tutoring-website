/** Opt-in staging rehearsal. The caller owns two already running isolated clusters. */
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";
import { databaseIdentity } from "../src/server/recovery/operator-plan";
import {
  createSitePlan,
  executeRecoveryTool,
  stageSitePlan,
  type SiteDependencies,
} from "../src/server/recovery/operator-site";

const sourceAdminUrl = process.env.SHBS_RECOVERY_TEST_SOURCE_ADMIN_URL;
const stagingAdminUrl = process.env.SHBS_RECOVERY_TEST_STAGING_ADMIN_URL;

void test(
  "real isolated PostgreSQL staging preserves source and seals restored checkpoint",
  { skip: !sourceAdminUrl || !stagingAdminUrl, timeout: 120_000 },
  async (t) => {
    assert.ok(sourceAdminUrl && stagingAdminUrl);
    const sourceIdentity = databaseIdentity(sourceAdminUrl);
    const stageIdentity = databaseIdentity(stagingAdminUrl);
    for (const identity of [sourceIdentity, stageIdentity]) {
      assert.ok(
        ["localhost", "127.0.0.1", "[::1]", "::1"].includes(identity.host),
      );
      assert.match(identity.database, /^shbs_[a-z0-9_]+_test$/);
    }
    assert.notEqual(
      sourceIdentity.port,
      stageIdentity.port,
      "Two separately owned PostgreSQL instances are required.",
    );
    const suffix = randomBytes(6).toString("hex");
    const role = `shbs_recovery_owner_${suffix}`;
    const sourceName = `shbs_recovery_source_${suffix}_test`;
    const targetName = `shbs_recovery_stage_${suffix}_test`;
    const password = randomBytes(24).toString("hex");
    const dir = await mkdtemp(join(tmpdir(), "shbs-recovery-pg-"));
    const sourceAdmin = new Client({ connectionString: sourceAdminUrl });
    const stageAdmin = new Client({ connectionString: stagingAdminUrl });
    await sourceAdmin.connect();
    try {
      await stageAdmin.connect();
    } catch (error) {
      await sourceAdmin.end();
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    const clients: Client[] = [];
    let sourceRole = false;
    let targetRole = false;
    let sourceCreated = false;
    t.after(async () => {
      // Only fresh random fixture identifiers are ever dropped. No supplied database is reset.
      for (const client of clients) await client.end().catch(() => undefined);
      assert.match(sourceName, /^shbs_recovery_source_[a-f0-9]{12}_test$/);
      assert.match(targetName, /^shbs_recovery_stage_[a-f0-9]{12}_test$/);
      const failures: string[] = [];
      try {
        await stageAdmin
          .query(`DROP DATABASE IF EXISTS "${targetName}"`)
          .catch(() => {
            failures.push("target database");
          });
        if (sourceCreated)
          await sourceAdmin.query(`DROP DATABASE "${sourceName}"`).catch(() => {
            failures.push("source fixture database");
          });
        if (targetRole)
          await stageAdmin.query(`DROP ROLE "${role}"`).catch(() => {
            failures.push("target fixture role");
          });
        if (sourceRole)
          await sourceAdmin.query(`DROP ROLE "${role}"`).catch(() => {
            failures.push("source fixture role");
          });
      } finally {
        await sourceAdmin.end();
        await stageAdmin.end();
        await rm(dir, { recursive: true, force: true });
      }
      assert.deepEqual(
        failures,
        [],
        "Owned integration fixture cleanup must complete.",
      );
    });
    // Random hex password and strictly generated identifiers cannot introduce SQL syntax.
    await sourceAdmin.query(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
    );
    sourceRole = true;
    await stageAdmin.query(
      `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    targetRole = true;
    await sourceAdmin.query(
      `CREATE DATABASE "${sourceName}" OWNER "${role}" TEMPLATE template0`,
    );
    sourceCreated = true;
    const sourceUrl = new URL(sourceAdminUrl);
    sourceUrl.pathname = `/${sourceName}`;
    sourceUrl.username = role;
    sourceUrl.password = password;
    const app = new Client({ connectionString: sourceUrl.toString() });
    clients.push(app);
    await app.connect();
    await app.query(
      'CREATE TABLE "User" (id text PRIMARY KEY, name text NOT NULL)',
    );
    await app.query('INSERT INTO "User" VALUES ($1,$2)', [
      "checkpoint",
      "Synthetic checkpoint",
    ]);
    const plain = join(dir, "checkpoint.sql");
    await executeRecoveryTool({
      tool: "pg_dump",
      args: ["--no-password"],
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        PGHOST: sourceIdentity.host,
        PGPORT: sourceIdentity.port,
        PGDATABASE: sourceName,
        PGUSER: role,
        PGPASSWORD: password,
        PGCONNECT_TIMEOUT: "10",
      },
      outputPath: plain,
    });
    const backup = join(dir, "checkpoint.sql.gz");
    await pipeline(
      createReadStream(plain),
      createGzip(),
      createWriteStream(backup, { flags: "wx", mode: 0o600 }),
    );
    await app.query('INSERT INTO "User" VALUES ($1,$2)', [
      "later",
      "Independent later record",
    ]);
    const evidenceDir = join(dir, "evidence");
    await mkdir(evidenceDir, { mode: 0o700 });
    const dependencies: SiteDependencies = {
      execute: executeRecoveryTool,
      async connect(connectionString) {
        const client = new Client({
          connectionString,
          connectionTimeoutMillis: 10_000,
        });
        await client.connect();
        return {
          async query(sql, values) {
            const result = await client.query<Record<string, unknown>>(
              sql,
              values,
            );
            return { rows: result.rows };
          },
          async close() {
            await client.end();
          },
        };
      },
    };
    const plan = await createSitePlan(
      { backup, targetName, evidenceDir },
      sourceUrl.toString(),
      stagingAdminUrl,
      dependencies,
    );
    const receipt = await stageSitePlan(
      plan,
      sourceUrl.toString(),
      stagingAdminUrl,
      "Synthetic isolated integration rehearsal",
      dependencies,
    );
    assert.equal(receipt.state, "SEALED_STAGING_ONLY");
    assert.deepEqual(receipt.comparison, [
      { table: "User", before: "2", restored: "1", changed: true },
    ]);
    const live = await app.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM "User"',
    );
    assert.equal(
      live.rows[0]?.count,
      "2",
      "The source site must retain its independent later record.",
    );
    const target = await stageAdmin.query<{ datallowconn: boolean }>(
      "SELECT datallowconn FROM pg_database WHERE datname=$1",
      [targetName],
    );
    assert.equal(target.rows[0]?.datallowconn, false);
    const currentEvidence = await readFile(
      join(receipt.evidenceDirectory, "current-site.dump"),
    );
    assert.equal(currentEvidence.subarray(0, 5).toString("ascii"), "PGDMP");
  },
);
