import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

it("backfills exact submitted names and keeps originals after source correction/deletion", async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Rehearse shipped DDL against old rows in a rollback-only schema. Null,
    // blank and Unicode inputs must survive without guessed name boundaries.
    await client.query(`BEGIN;
      CREATE SCHEMA application_identity_migration_test;
      SET LOCAL search_path TO application_identity_migration_test;
      CREATE TABLE "TutorApplication" (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, "firstName" TEXT,
        "lastName" TEXT, "preferredName" TEXT, "alternativeNames" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL, "policySnapshot" JSONB,
        "policyAcceptedAt" TIMESTAMP(3), email TEXT
      );
      INSERT INTO "TutorApplication" VALUES
        ('legacy','王小明',null,null,null,null,'2026-09-01','{"signed":"原文"}','2026-09-01','original@example.test'),
        ('explicit','Madonna','Madonna','',null,'','2026-09-02','{"signed":"Original"}','2026-09-02','single@example.test');`);
    const before = (await client.query('SELECT * FROM "TutorApplication" ORDER BY id')).rows;
    await client.query(readFileSync(
      "prisma/migrations/20261024090000_application_identity_corrections/migration.sql", "utf8",
    ));
    expect((await client.query('SELECT * FROM "TutorApplication" ORDER BY id')).rows)
      .toEqual(before.map((row: Record<string, unknown>) => ({ ...row, identityRevision: 0 })));
    const originals = (await client.query('SELECT * FROM "ApplicationIdentityOriginal" ORDER BY "applicationId"')).rows;
    expect(originals).toEqual([
      { applicationId: "explicit", submittedAt: before[0].createdAt,
        original: { name: "Madonna", firstName: "Madonna", lastName: "", preferredName: null, alternativeNames: "" } },
      { applicationId: "legacy", submittedAt: before[1].createdAt,
        original: { name: "王小明", firstName: null, lastName: null, preferredName: null, alternativeNames: null } },
    ]);
    await client.query(`UPDATE "TutorApplication" SET name='Xiaoming Wang', "firstName"='Xiaoming', "lastName"='Wang' WHERE id='legacy';
      DELETE FROM "TutorApplication" WHERE id='legacy';`);
    expect((await client.query('SELECT * FROM "ApplicationIdentityOriginal" ORDER BY "applicationId"')).rows).toEqual(originals);
    await client.query(`INSERT INTO "TutorApplication" (id,name,"createdAt") VALUES ('new','Мария','2026-10-24');`);
    expect((await client.query('SELECT original FROM "ApplicationIdentityOriginal" WHERE "applicationId"=\'new\'')).rows[0].original)
      .toEqual({ name: "Мария", firstName: null, lastName: null, preferredName: null, alternativeNames: null });
    await client.query("SAVEPOINT immutable_original");
    await expect(client.query('UPDATE "ApplicationIdentityOriginal" SET original=\'{}\''))
      .rejects.toThrow("Application identity evidence is immutable");
    await client.query("ROLLBACK TO SAVEPOINT immutable_original");
    expect((await client.query('SELECT COUNT(*)::int AS count FROM "ApplicationIdentityCorrection"')).rows[0].count).toBe(0);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
