import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

it("backfills active notices and tombstones without changing legacy identity or concurrency evidence", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // This rollback-only schema isolates the real migration from application fixtures.
    await client.query("BEGIN");
    const schema = `calendar_ranges_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "ProgramCalendarDay" (
        date TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        version INTEGER NOT NULL DEFAULT 1,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO "ProgramCalendarDay" VALUES
        ('2026-10-12', 'Exam preparation', true, 3, '2026-10-01 08:00:00'),
        ('2026-10-13', 'Removed notice', false, 8, '2026-10-02 08:00:00');
    `);
    const before = await client.query<{
      date: string;
      reason: string;
      active: boolean;
      version: number;
      updatedAt: Date;
    }>('SELECT * FROM "ProgramCalendarDay" ORDER BY date');
    await client.query(
      readFileSync(
        "prisma/migrations/20261020010000_program_calendar_ranges/migration.sql",
        "utf8",
      ),
    );
    const after = await client.query<{ date: string; endDate: string }>(
      'SELECT * FROM "ProgramCalendarDay" ORDER BY date',
    );
    expect(after.rows).toEqual(
      before.rows.map((row) => ({ ...row, endDate: row.date })),
    );
    expect(after.rows.map((row) => row.endDate)).toEqual([
      "2026-10-12",
      "2026-10-13",
    ]);
    await client.query("SAVEPOINT missing_endpoint");
    await expect(
      client.query(
        'INSERT INTO "ProgramCalendarDay" (date, reason) VALUES ($1, $2)',
        ["2026-10-14", "Missing endpoint"],
      ),
    ).rejects.toMatchObject({ code: "23502" });
    await client.query("ROLLBACK TO SAVEPOINT missing_endpoint");
    await client.query(
      'INSERT INTO "ProgramCalendarDay" (date, "endDate", reason) VALUES ($1, $2, $3)',
      ["2026-10-14", "2026-10-18", "New inclusive range"],
    );
    expect(
      (
        await client.query(
          'SELECT "endDate" FROM "ProgramCalendarDay" WHERE date=$1',
          ["2026-10-14"],
        )
      ).rows,
    ).toEqual([{ endDate: "2026-10-18" }]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
