import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

it("retains outstanding deterministic codes when adding numeric issuance versions", async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Exercise the shipped additive migration against legacy rows in a rolled-back schema.
    await client.query(`BEGIN;
      CREATE SCHEMA numeric_code_upgrade_test;
      SET LOCAL search_path TO numeric_code_upgrade_test;
      CREATE TABLE "StudentSurvey" (id TEXT PRIMARY KEY, "tokenHash" TEXT);
      CREATE TABLE "StudentSignupIntent" (id TEXT PRIMARY KEY, "tokenHash" TEXT);
      INSERT INTO "StudentSurvey" VALUES ('survey', 'original-survey-proof');
      INSERT INTO "StudentSignupIntent" VALUES ('intent', 'original-intent-proof');`);
    await client.query(
      readFileSync(
        "prisma/migrations/20261020070000_numeric_email_codes/migration.sql",
        "utf8",
      ),
    );
    for (const table of ["StudentSurvey", "StudentSignupIntent"]) {
      const original = await client.query<{
        emailCodeVersion: number;
        tokenHash: string;
      }>(`SELECT "emailCodeVersion", "tokenHash" FROM "${table}"`);
      expect(original.rows[0]?.emailCodeVersion).toBe(0);
      expect(original.rows[0]?.tokenHash).toMatch(/^original-/);
      // Old writers keep their legacy format; only an explicit new issuance changes it.
      await client.query(
        `INSERT INTO "${table}" (id, "tokenHash") VALUES ('old-writer', 'old-proof')`,
      );
      await client.query(
        `INSERT INTO "${table}" (id, "tokenHash", "emailCodeVersion") VALUES ('new-writer', 'new-proof', 1)`,
      );
      const versions = await client.query<{
        id: string;
        emailCodeVersion: number;
      }>(
        `SELECT id, "emailCodeVersion" FROM "${table}" WHERE id LIKE '%writer' ORDER BY id`,
      );
      expect(versions.rows).toEqual([
        { id: "new-writer", emailCodeVersion: 1 },
        { id: "old-writer", emailCodeVersion: 0 },
      ]);
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
