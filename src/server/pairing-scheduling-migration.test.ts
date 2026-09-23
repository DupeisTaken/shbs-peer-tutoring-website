import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

it("preserves legacy copied schedules and defaults only new rows to awaiting scheduling", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Exercise the real migration in a transaction-local schema without altering shared fixtures.
    await client.query("BEGIN");
    const schema = `scheduling_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "Term" (id text PRIMARY KEY, active boolean);
      CREATE TABLE "Pairing" (id text PRIMARY KEY, "roomId" text, "termId" text,
        "timeSlotId" text, "dayOfWeek" integer, "startMin" integer, "endMin" integer);
      CREATE TABLE "RoomUnavailability" (id text PRIMARY KEY, "roomId" text,
        "dayOfWeek" integer, "startMin" integer, "endMin" integer);
      CREATE FUNCTION enforce_pairing_room() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RETURN NEW; END; $$;
      CREATE TRIGGER pairing_room_guard BEFORE INSERT ON "Pairing"
        FOR EACH ROW EXECUTE FUNCTION enforce_pairing_room();
      INSERT INTO "Pairing" VALUES
        ('legacy-detached', NULL, 'old', NULL, 1, 930, 990),
        ('legacy-linked', NULL, 'old', 'slot', 3, 780, 840);
    `);
    await client.query(readFileSync("prisma/migrations/20260922200100_pairing_scheduling/migration.sql", "utf8"));
    const legacy = await client.query('SELECT * FROM "Pairing" ORDER BY id');
    expect(legacy.rows).toEqual([
      { id: "legacy-detached", roomId: null, termId: "old", timeSlotId: null, dayOfWeek: 1, startMin: 930, endMin: 990, scheduleConfirmed: true },
      { id: "legacy-linked", roomId: null, termId: "old", timeSlotId: "slot", dayOfWeek: 3, startMin: 780, endMin: 840, scheduleConfirmed: true },
    ]);
    const added = await client.query('INSERT INTO "Pairing" (id, "dayOfWeek", "startMin", "endMin") VALUES (\'new\', 1, 930, 990) RETURNING "scheduleConfirmed"');
    expect(added.rows).toEqual([{ scheduleConfirmed: false }]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
