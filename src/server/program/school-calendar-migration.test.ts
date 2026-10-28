import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

it("backfills legacy school dates and constrains timetable mappings without changing their school-day meaning", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Roll back the entire schema: this exercises the actual migration without application fixtures.
    await client.query("BEGIN");
    const schema = `school_calendar_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "SchoolCalendarDay" (
        date TEXT PRIMARY KEY,
        "isSchoolDay" BOOLEAN NOT NULL,
        note TEXT
      );
      INSERT INTO "SchoolCalendarDay" VALUES
        ('2026-11-01', true, 'Legacy make-up day'),
        ('2026-11-02', false, 'Legacy holiday');
    `);
    await client.query(
      readFileSync(
        "prisma/migrations/20261029010000_school_calendar_mapping/migration.sql",
        "utf8",
      ),
    );
    const rows = await client.query(
      'SELECT date, "isSchoolDay", note, "timetableWeekday", active, version, "scheduleRevision" FROM "SchoolCalendarDay" ORDER BY date',
    );
    expect(rows.rows).toEqual([
      {
        date: "2026-11-01",
        isSchoolDay: true,
        note: "Legacy make-up day",
        timetableWeekday: null,
        active: true,
        version: 1,
        scheduleRevision: 1,
      },
      {
        date: "2026-11-02",
        isSchoolDay: false,
        note: "Legacy holiday",
        timetableWeekday: null,
        active: true,
        version: 1,
        scheduleRevision: 1,
      },
    ]);
    for (const [isSchoolDay, timetableWeekday, version, scheduleRevision] of [
      [true, 0, 1, 1],
      [true, 8, 1, 1],
      [false, 1, 1, 1],
      [true, null, 0, 1],
      [true, null, 1, 0],
    ]) {
      await client.query("SAVEPOINT invalid_calendar");
      await expect(
        client.query(
          'INSERT INTO "SchoolCalendarDay" (date, "isSchoolDay", "timetableWeekday", version, "scheduleRevision") VALUES ($1,$2,$3,$4,$5)',
          [
            "2026-11-03",
            isSchoolDay,
            timetableWeekday,
            version,
            scheduleRevision,
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT invalid_calendar");
    }
    await client.query(
      'UPDATE "SchoolCalendarDay" SET "timetableWeekday"=1 WHERE date=$1',
      ["2026-11-01"],
    );
    expect(
      (
        await client.query(
          'SELECT "timetableWeekday" FROM "SchoolCalendarDay" WHERE date=$1',
          ["2026-11-01"],
        )
      ).rows,
    ).toEqual([{ timetableWeekday: 1 }]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
