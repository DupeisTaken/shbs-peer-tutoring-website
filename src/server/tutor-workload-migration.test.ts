import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
assertIsolatedTestDatabase(process.env.DATABASE_URL);
it("migrates inactive tutors to zero and guards every status path, range and stale snapshot", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const schema = `workload_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(
      `CREATE TABLE "Tutor" (id text PRIMARY KEY, status text NOT NULL); INSERT INTO "Tutor" VALUES ('active','ACTIVE'), ('inactive','OPTED_OUT');`,
    );
    await client.query(
      readFileSync(
        "prisma/migrations/20261014010000_tutor_workload_preference/migration.sql",
        "utf8",
      ),
    );
    expect(
      (
        await client.query(
          'SELECT "preferredAssignedBlocks" FROM "Tutor" ORDER BY id',
        )
      ).rows,
    ).toEqual([
      { preferredAssignedBlocks: null },
      { preferredAssignedBlocks: 0 },
    ]);
    // A default changes future inserts only; existing unset and inactive zero survive.
    await client.query(
      readFileSync(
        "prisma/migrations/20261015010000_tutor_preferred_sessions_default/migration.sql",
        "utf8",
      ),
    );
    expect(
      (
        await client.query(
          'SELECT "preferredAssignedBlocks" FROM "Tutor" ORDER BY id',
        )
      ).rows,
    ).toEqual([
      { preferredAssignedBlocks: null },
      { preferredAssignedBlocks: 0 },
    ]);
    await client.query(`INSERT INTO "Tutor" (id,status) VALUES ('new-active','ACTIVE'), ('new-inactive','OPTED_OUT');
      INSERT INTO "Tutor" (id,status,"preferredAssignedBlocks") VALUES ('explicit-unset','ACTIVE',NULL)`);
    expect(
      (
        await client.query(
          `SELECT "preferredAssignedBlocks" FROM "Tutor" WHERE id IN ('new-active','new-inactive','explicit-unset') ORDER BY id`,
        )
      ).rows,
    ).toEqual([
      { preferredAssignedBlocks: null },
      { preferredAssignedBlocks: 1 },
      { preferredAssignedBlocks: 0 },
    ]);
    await client.query(
      'UPDATE "Tutor" SET "preferredAssignedBlocks"=4 WHERE id=\'active\'',
    );
    for (const status of [
      "GRADUATED",
      "PENDING",
      "OPTED_OUT",
      "ARCHIVED",
      "TRANSFERRED",
    ]) {
      await client.query("UPDATE \"Tutor\" SET status=$1 WHERE id='active'", [
        status,
      ]);
      expect(
        (
          await client.query(
            'SELECT "preferredAssignedBlocks" FROM "Tutor" WHERE id=\'active\'',
          )
        ).rows[0],
      ).toEqual({ preferredAssignedBlocks: 0 });
    }
    expect(
      (
        await client.query(
          'SELECT "workloadPreferenceVersion" FROM "Tutor" WHERE id=\'active\'',
        )
      ).rows[0],
    ).toEqual({ workloadPreferenceVersion: 5 });
    await client.query(
      "UPDATE \"Tutor\" SET status='ACTIVE' WHERE id='active'",
    );
    expect(
      (
        await client.query(
          'SELECT "preferredAssignedBlocks" FROM "Tutor" WHERE id=\'active\'',
        )
      ).rows[0],
    ).toEqual({ preferredAssignedBlocks: 0 });
    expect(
      (
        await client.query(
          'UPDATE "Tutor" SET "preferredAssignedBlocks"=3 WHERE id=\'active\' AND "workloadPreferenceVersion"=0',
        )
      ).rowCount,
    ).toBe(0);
    await client.query(
      "INSERT INTO \"Tutor\" (id,status,\"preferredAssignedBlocks\") VALUES ('import','ARCHIVED',4)",
    );
    expect(
      (
        await client.query(
          'SELECT "preferredAssignedBlocks" FROM "Tutor" WHERE id=\'import\'',
        )
      ).rows[0],
    ).toEqual({ preferredAssignedBlocks: 0 });
    await client.query("SAVEPOINT range_guard");
    await expect(
      client.query(
        'UPDATE "Tutor" SET "preferredAssignedBlocks"=5 WHERE id=\'active\'',
      ),
    ).rejects.toThrow("Tutor_preferredAssignedBlocks_range");
    await client.query("ROLLBACK TO SAVEPOINT range_guard");
    await expect(
      client.query(
        'UPDATE "Tutor" SET "preferredAssignedBlocks"=-1 WHERE id=\'active\'',
      ),
    ).rejects.toThrow("Tutor_preferredAssignedBlocks_range");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
