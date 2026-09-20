import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import pg from "pg";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

it("adds field defaults without fabricating historical application consent or changing answers", async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const url = new URL(process.env.DATABASE_URL!);
  if (url.pathname !== "/shbs_shipping_test") throw new Error("Use shbs_shipping_test");
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    // Transaction-scoped scratch schema: application fixtures and migration ledger remain intact.
    await client.query('BEGIN; CREATE SCHEMA signup_fields_migration_test; SET LOCAL search_path TO signup_fields_migration_test');
    await client.query(`
      CREATE TABLE "ProgramSettings" (id text PRIMARY KEY);
      CREATE TABLE "TutorApplication" (id text PRIMARY KEY, "preferredContact" text);
      INSERT INTO "ProgramSettings" VALUES ('program');
      INSERT INTO "TutorApplication" VALUES ('historical', 'Keep original answer');
    `);
    await client.query(readFileSync(new URL("../../prisma/migrations/20260919040000_signup_field_settings/migration.sql", import.meta.url), "utf8"));
    expect((await client.query('SELECT "signupFields" FROM "ProgramSettings"')).rows).toEqual([{ signupFields: {} }]);
    expect((await client.query('SELECT * FROM "TutorApplication"')).rows).toEqual([{ id: "historical", preferredContact: "Keep original answer", policyRevision: null, policySnapshot: null, policyAcceptedAt: null }]);
    await client.query("SAVEPOINT invalid_config");
    await expect(client.query('UPDATE "ProgramSettings" SET "signupFields" = \'[]\'')).rejects.toMatchObject({ code: "23514" });
    await client.query("ROLLBACK TO SAVEPOINT invalid_config");
    await expect(client.query('UPDATE "TutorApplication" SET "policyRevision" = \'invented\'')).rejects.toMatchObject({ code: "23514" });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
