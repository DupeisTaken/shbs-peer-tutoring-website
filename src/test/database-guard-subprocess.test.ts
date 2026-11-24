import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, expect, it } from "vitest";
import { db } from "~/server/db";
import {
  assertIsolatedTestDatabase,
  TEST_DATABASE_GUARD_ERROR,
} from "./database-guard";

// This regression uses an isolated local PostgreSQL server to create a disposable
// non-*_test database with sentinel rows, runs real integration test files against
// it via a Vitest subprocess, and proves zero rows are touched across import, setup
// and afterAll cleanup.
assertIsolatedTestDatabase(process.env.DATABASE_URL);

const execFileAsync = promisify(execFile);
const vitestEntry = path.resolve(
  process.cwd(),
  "node_modules/vitest/vitest.mjs",
);

function databaseUrlWithName(rawUrl: string, databaseName: string): string {
  const url = new URL(rawUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function childVitestEnv(databaseUrl: string): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("VITEST")) continue;
    clean[key] = value;
  }
  clean.DATABASE_URL = databaseUrl;
  return clean;
}

afterAll(() => db.$disconnect());

it(
  "preserves sentinel rows on a rejected non-*_test database across setup and afterAll cleanup while permitted *_test queries succeed",
  async () => {
    const baseUrl = process.env.DATABASE_URL!;
    const adminUrl = databaseUrlWithName(baseUrl, "postgres");
    const rejectedDbName = `shbs_guard_sentinel_${randomBytes(4).toString("hex")}_demo`;
    const rejectedUrl = databaseUrlWithName(baseUrl, rejectedDbName);
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `CREATE DATABASE "${rejectedDbName}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`,
      );

      const sentinelClient = new pg.Client({ connectionString: rejectedUrl });
      await sentinelClient.connect();
      try {
        // Mirror the exact tables targeted by destructive afterAll cleanups in
        // student-survey.test.ts, registration.test.ts, and i18n.test.ts.
        await sentinelClient.query(`
          CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT NOT NULL);
          CREATE TABLE "Language" (code TEXT PRIMARY KEY, label TEXT NOT NULL);
          CREATE TABLE "MessageOverride" (id TEXT PRIMARY KEY, locale TEXT NOT NULL);
          CREATE TABLE "ApprovalRequest" (id TEXT PRIMARY KEY, "requesterId" TEXT NOT NULL);
          INSERT INTO "User" (id, email) VALUES
            ('sentinel-user', 'sentinel@example.test'),
            ('test-language-admin', 'language-admin@example.com');
          INSERT INTO "Language" (code, label) VALUES ('zz', 'Sentinel Language');
          INSERT INTO "MessageOverride" (id, locale) VALUES ('sentinel-msg', 'zz');
          INSERT INTO "ApprovalRequest" (id, "requesterId") VALUES ('sentinel-req', 'test-language-admin');
        `);
      } finally {
        await sentinelClient.end();
      }

      let exitStatus = 0;
      let combinedOutput = "";
      try {
        const result = await execFileAsync(
          process.execPath,
          [
            vitestEntry,
            "run",
            "src/server/student-survey.test.ts",
            "src/server/auth/registration.test.ts",
            "src/server/api/routers/i18n.test.ts",
            "--pool=forks",
            "--maxWorkers=1",
            "--no-file-parallelism",
            "--reporter=dot",
          ],
          {
            cwd: process.cwd(),
            env: childVitestEnv(rejectedUrl),
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024,
            timeout: 90_000,
          },
        );
        combinedOutput = `${result.stdout}\n${result.stderr}`;
      } catch (error) {
        const execError = error as {
          code?: number | string;
          stdout?: string;
          stderr?: string;
        };
        exitStatus = typeof execError.code === "number" ? execError.code : 1;
        combinedOutput = `${execError.stdout ?? ""}\n${execError.stderr ?? ""}`;
      }

      expect(exitStatus).not.toBe(0);
      expect(combinedOutput).toContain(TEST_DATABASE_GUARD_ERROR);

      const verifyClient = new pg.Client({ connectionString: rejectedUrl });
      await verifyClient.connect();
      try {
        const users = await verifyClient.query<{ id: string }>(
          'SELECT id FROM "User" ORDER BY id',
        );
        const languages = await verifyClient.query<{ code: string }>(
          'SELECT code FROM "Language" ORDER BY code',
        );
        const overrides = await verifyClient.query<{ id: string }>(
          'SELECT id FROM "MessageOverride" ORDER BY id',
        );
        const requests = await verifyClient.query<{ id: string }>(
          'SELECT id FROM "ApprovalRequest" ORDER BY id',
        );
        expect(users.rows.map((row) => row.id)).toEqual([
          "sentinel-user",
          "test-language-admin",
        ]);
        expect(languages.rows.map((row) => row.code)).toEqual(["zz"]);
        expect(overrides.rows.map((row) => row.id)).toEqual(["sentinel-msg"]);
        expect(requests.rows.map((row) => row.id)).toEqual(["sentinel-req"]);
      } finally {
        await verifyClient.end();
      }

      // Permitted isolated *_test connection still works normally.
      const ping = await db.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
      expect(ping).toEqual([{ ok: 1 }]);
    } finally {
      await admin
        .query(`DROP DATABASE IF EXISTS "${rejectedDbName}" WITH (FORCE)`)
        .catch(() => undefined);
      await admin.end();
    }
  },
  120_000,
);
