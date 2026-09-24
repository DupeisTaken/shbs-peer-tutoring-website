import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";

it("backfills only explicit survey provenance without changing historical priority or links", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  )
    throw Error("Migration tests require an isolated local test database");
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    // Exercise the shipped DDL in a rollback-only schema, never the program tables.
    await client.query(`BEGIN; CREATE SCHEMA provenance_migration_test;
      SET LOCAL search_path TO provenance_migration_test;
      CREATE TABLE "Tutee" (id TEXT PRIMARY KEY, "signupSubmittedAt" TIMESTAMP(3), "signatureName" TEXT);
      CREATE TABLE "StudentSurvey" (id TEXT PRIMARY KEY, "tuteeId" TEXT);
      INSERT INTO "Tutee" VALUES ('linked-survey','2026-09-01','Student signature'), ('old-public-form','2026-09-02','Signed before migration'), ('old-staff-or-unknown','2026-09-03',null);
      INSERT INTO "StudentSurvey" VALUES ('survey','linked-survey');`);
    const before = (
      await client.query(
        'SELECT id, "signupSubmittedAt", "signatureName" FROM "Tutee" ORDER BY id',
      )
    ).rows;
    await client.query(
      readFileSync(
        "prisma/migrations/20260913030000_signup_provenance/migration.sql",
        "utf8",
      ),
    );
    expect(
      (await client.query('SELECT id, "signupSource" FROM "Tutee" ORDER BY id'))
        .rows,
    ).toEqual([
      { id: "linked-survey", signupSource: "SELF_SERVICE" },
      { id: "old-public-form", signupSource: "UNKNOWN" },
      { id: "old-staff-or-unknown", signupSource: "UNKNOWN" },
    ]);
    expect(
      (
        await client.query(
          'SELECT id, "signupSubmittedAt", "signatureName" FROM "Tutee" ORDER BY id',
        )
      ).rows,
    ).toEqual(before);
    expect(
      (await client.query('SELECT "tuteeId" FROM "StudentSurvey"')).rows,
    ).toEqual([{ tuteeId: "linked-survey" }]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
