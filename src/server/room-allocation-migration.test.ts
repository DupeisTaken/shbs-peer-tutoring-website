import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

it("preserves assigned legacy IDs as fixed and never backfills roomless records", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Exercise the exact migration against a transaction-local legacy schema, then discard it.
    await client.query("BEGIN");
    const schema = `room_rollout_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`
      CREATE TYPE "ProgramFeatureKey" AS ENUM ('CREW');
      CREATE TABLE "Pairing" (id text PRIMARY KEY, "roomId" text, "scheduleConfirmed" boolean NOT NULL);
      CREATE TABLE "PairingTutee" ("pairingId" text, "tuteeId" text);
      INSERT INTO "Pairing" VALUES ('opaque-existing', 'room-legacy-uuid', true), ('roomless-confirmed', NULL, true), ('awaiting', NULL, false);
    `);
    await client.query(
      readFileSync(
        "prisma/migrations/20261016010000_automatic_room_allocation/migration.sql",
        "utf8",
      ),
    );
    expect(
      (
        await client.query(
          'SELECT id, "roomId", "roomMode", "roomNeedsAssignment", "roomVersion", "roomShortageKey" FROM "Pairing" ORDER BY id',
        )
      ).rows,
    ).toEqual([
      {
        id: "awaiting",
        roomId: null,
        roomMode: "LEGACY",
        roomNeedsAssignment: false,
        roomVersion: 0,
        roomShortageKey: null,
      },
      {
        id: "opaque-existing",
        roomId: "room-legacy-uuid",
        roomMode: "FIXED",
        roomNeedsAssignment: false,
        roomVersion: 0,
        roomShortageKey: null,
      },
      {
        id: "roomless-confirmed",
        roomId: null,
        roomMode: "LEGACY",
        roomNeedsAssignment: false,
        roomVersion: 0,
        roomShortageKey: null,
      },
    ]);
    const inserted = await client.query(
      'INSERT INTO "Pairing" (id, "roomId", "scheduleConfirmed") VALUES (\'older-import\', \'opaque-room\', true) RETURNING "roomMode"',
    );
    expect(inserted.rows).toEqual([{ roomMode: "FIXED" }]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
