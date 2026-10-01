import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

it("backfills interval reservations without rewriting legacy evidence, hours or update timestamps", async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Run the actual migration in a rollback-only schema, leaving the application untouched.
    await client.query(`BEGIN; CREATE SCHEMA patrol_credit_migration_test;
      SET LOCAL search_path TO patrol_credit_migration_test;
      CREATE TABLE "User" (id TEXT PRIMARY KEY);
      CREATE TABLE "Patrol" (id TEXT PRIMARY KEY, "crewUserId" TEXT, hours DOUBLE PRECISION,
        "createdAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3), note TEXT);
      CREATE TABLE "PatrolObservation" (id TEXT PRIMARY KEY, "patrolId" TEXT, "observedAt" TIMESTAMP(3));
      INSERT INTO "User" VALUES ('crew'), ('other');
      INSERT INTO "Patrol" VALUES
        ('first', 'crew', 0.5, '2026-09-01 08:10', '2026-09-01 09:00', 'retained'),
        ('duplicate', 'crew', 0.5, '2026-09-01 08:11', '2026-09-01 08:11', 'retained duplicate'),
        ('empty', 'crew', 1.5, '2026-09-01 09:45', '2026-09-01 09:45', null),
        ('zero', 'other', 0, '2026-09-01 09:00', '2026-09-01 09:00', null);
      INSERT INTO "PatrolObservation" VALUES
        ('o1','first','2026-09-01 08:00'), ('o2','first','2026-09-01 08:20'),
        ('o3','duplicate','2026-09-01 08:19:59.999'), ('o4','zero','2026-09-01 09:00');`);
    const before = (await client.query('SELECT * FROM "Patrol" ORDER BY id')).rows as Record<string, unknown>[];
    const observations = (await client.query('SELECT * FROM "PatrolObservation" ORDER BY id')).rows as Record<string, unknown>[];
    await client.query(readFileSync("prisma/migrations/20261002010000_patrol_credit_budget/migration.sql", "utf8"));
    expect((await client.query('SELECT id, "crewUserId", hours, "createdAt", "updatedAt", note FROM "Patrol" ORDER BY id')).rows).toEqual(before);
    expect((await client.query('SELECT * FROM "PatrolObservation" ORDER BY id')).rows).toEqual(observations);
    expect((await client.query('SELECT "patrolId", to_char("windowStart", \'HH24:MI\') AS slot FROM "PatrolCreditWindow" ORDER BY "windowStart"')).rows).toEqual([
      { patrolId: "first", slot: "08:00" }, { patrolId: "first", slot: "08:20" }, { patrolId: "empty", slot: "09:40" },
    ]);
    expect((await client.query('SELECT id FROM "Patrol" WHERE "creditAwardedAt" IS NULL')).rows).toEqual([{ id: "zero" }]);
    await client.query("SAVEPOINT invalid_claim");
    await expect(client.query(`INSERT INTO "PatrolCreditWindow" VALUES ('crew','2026-09-01 08:00','duplicate')`)).rejects.toMatchObject({ code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT invalid_claim");
    await expect(client.query(`INSERT INTO "PatrolCreditWindow" VALUES ('crew','2026-09-01 08:01','duplicate')`)).rejects.toMatchObject({ code: "23514" });
  } finally {
    await client.query("ROLLBACK"); await client.end();
  }
});
