import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

it("widens request checks for cancellation and refusal while retaining existing request history", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const schema = `cancellation_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    // Exercise the additive migration against its original constraint contract,
    // in an isolated rollback-only schema rather than resetting fixture tables.
    await client.query(`CREATE TABLE "SessionPlanningRequest" (
      id text PRIMARY KEY, kind text NOT NULL, status text NOT NULL,
      CONSTRAINT "SessionPlanningRequest_kind_check" CHECK (kind IN ('RESCHEDULE','EXTRA')),
      CONSTRAINT "SessionPlanningRequest_status_check" CHECK (status IN ('PENDING','ACCEPTED','CANCELLED','EXPIRED','STALE','SPLIT_REQUESTED','SPLIT'))
    );
    INSERT INTO "SessionPlanningRequest" VALUES ('existing','EXTRA','ACCEPTED');`);
    await client.query(
      readFileSync(
        "prisma/migrations/20261115080000_extra_session_cancellation/migration.sql",
        "utf8",
      ),
    );
    await client.query(
      `INSERT INTO "SessionPlanningRequest" VALUES ('cancelled','CANCEL','ACCEPTED'), ('declined','CANCEL','REJECTED')`,
    );
    expect(
      (await client.query('SELECT * FROM "SessionPlanningRequest" ORDER BY id'))
        .rows,
    ).toEqual([
      { id: "cancelled", kind: "CANCEL", status: "ACCEPTED" },
      { id: "declined", kind: "CANCEL", status: "REJECTED" },
      { id: "existing", kind: "EXTRA", status: "ACCEPTED" },
    ]);
    await client.query("SAVEPOINT invalid_kind");
    await expect(
      client.query(
        `INSERT INTO "SessionPlanningRequest" VALUES ('invalid','UNKNOWN','PENDING')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await client.query("ROLLBACK TO SAVEPOINT invalid_kind");
    await expect(
      client.query(
        `INSERT INTO "SessionPlanningRequest" VALUES ('invalid','CANCEL','UNKNOWN')`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
