import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, it } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

it("indexes exact-offer sticky consent lookups without a partial-history predicate", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const index = await client.query<{ valid: boolean; ready: boolean; method: string; columns: string[]; plain: boolean }>(`
      SELECT definition.indisvalid AS valid,definition.indisready AS ready,method.amname AS method,
        ARRAY(SELECT attribute.attname::text FROM unnest(definition.indkey) WITH ORDINALITY indexed_column(attnum,sort_order)
          JOIN pg_attribute attribute ON attribute.attrelid=definition.indrelid AND attribute.attnum=indexed_column.attnum
          ORDER BY indexed_column.sort_order) AS columns,
        definition.indpred IS NULL AND definition.indexprs IS NULL AS plain
      FROM pg_index definition JOIN pg_class relation ON relation.oid=definition.indexrelid
      JOIN pg_am method ON method.oid=relation.relam
      WHERE definition.indexrelid=to_regclass('public."SessionNotice_offerId_idx"')`);
    expect(index.rows).toEqual([{ valid: true, ready: true, method: "btree", columns: ["offerId"], plain: true }]);
  } finally { await client.end(); }
});

it("pins migration helpers and trigger references to public even with pg_catalog first", async () => {
  for (const migration of [
    "20261108010000_tutoring_pause_policy", "20261108011000_tutoring_pause_recovery", "20261108012000_tutoring_policy_history", "20261108013000_tutoring_consent_lookup",
  ]) {
    const sql = readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8");
    for (const match of sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+([^\s(]+)/g))
      expect(match[1]).toMatch(/^public\./);
    for (const match of sql.matchAll(/EXECUTE FUNCTION\s+([^\s(]+)/g))
      expect(match[1]).toMatch(/^public\./);
  }
  const names = [
    "scheduling_mark_dirty", "scheduling_verify_maintenance_triggers", "recovery_planning_safe_row", "recovery_safe_row",
    "capture_tutoring_policy_revision", "recovery_calendar_policy_safe_row", "recovery_capture_change", "tutoring_policy_history_integrity",
  ];
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const helpers = await client.query<{ schema: string; name: string }>(`
      SELECT namespace.nspname AS schema,helper.proname AS name
      FROM pg_proc helper JOIN pg_namespace namespace ON namespace.oid=helper.pronamespace
      WHERE helper.proname=ANY($1::text[]) AND namespace.nspname IN ('public','pg_catalog')
      ORDER BY helper.proname,namespace.nspname`, [names]);
    expect(helpers.rows).toEqual(names.sort().map((name) => ({ schema: "public", name })));
  } finally { await client.end(); }
});

it("backfills legacy notices and participant suppression without activating tutoring pauses", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const schema = `tutoring_policy_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`CREATE TABLE "${schema}"."ProgramCalendarDay" (date text PRIMARY KEY, active boolean, version int);
      CREATE TABLE "${schema}"."SessionPlanParticipant" (id text PRIMARY KEY);
      INSERT INTO "${schema}"."ProgramCalendarDay" VALUES ('2026-11-09',true,7),('2026-11-10',false,9);
      INSERT INTO "${schema}"."SessionPlanParticipant" VALUES ('legacy');`);
    // Exercise the additive DDL exactly; trigger installation is checked against
    // the complete migrated dependency graph in the separate transaction below.
    const ddl = readFileSync("prisma/migrations/20261108010000_tutoring_pause_policy/migration.sql", "utf8")
      .split("CREATE OR REPLACE FUNCTION")[0]!
      .replace("BEGIN;", "")
      .replace("SET LOCAL search_path=pg_catalog,public;", "")
      .replaceAll("public.", `"${schema}".`);
    await client.query(ddl);
    expect((await client.query(`SELECT * FROM "${schema}"."ProgramCalendarDay" ORDER BY date`)).rows).toEqual([
      { date: "2026-11-09", active: true, version: 7, schedulingEffect: "NOTICE" },
      { date: "2026-11-10", active: false, version: 9, schedulingEffect: "NOTICE" },
    ]);
    expect((await client.query(`SELECT * FROM "${schema}"."SessionPlanParticipant"`)).rows)
      .toEqual([{ id: "legacy", tutoringPauseSuppressed: false }]);
    await expect(client.query(`UPDATE "${schema}"."ProgramCalendarDay" SET "schedulingEffect"='CANCEL_ALL'`))
      .rejects.toMatchObject({ code: "23514" });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

it("invalidates semantic pause changes, verifies both unconditional triggers and ignores informational edits", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const date = "2098-11-09";
    await client.query('DELETE FROM "ProgramCalendarDay" WHERE date=$1', [date]);
    await client.query('INSERT INTO "ProgramCalendarDay" (date,"endDate",reason) VALUES ($1,$1,$2)', [date, "Synthetic legacy notice"]);
    const events = async () => Number((await client.query<{ count: string }>('SELECT count(*) AS count FROM "SchedulingDirtyEvent" WHERE "sourceTable"=$1', ["ProgramCalendarDay"])).rows[0]!.count);
    const before = await events();
    await client.query('UPDATE "ProgramCalendarDay" SET reason=$2,version=version+1,"endDate"=$3 WHERE date=$1', [date, "Reason only", "2098-11-13"]);
    expect(await events()).toBe(before);
    await client.query('UPDATE "ProgramCalendarDay" SET "schedulingEffect"=$2 WHERE date=$1', [date, "PAUSE_REGULAR"]);
    expect(await events()).toBe(before + 1);
    await client.query('UPDATE "ProgramCalendarDay" SET reason=$2,version=version+1 WHERE date=$1', [date, "Pause reason only"]);
    expect(await events()).toBe(before + 1);
    await client.query('UPDATE "ProgramCalendarDay" SET "endDate"=$2 WHERE date=$1', [date, "2098-11-14"]);
    expect(await events()).toBe(before + 2);
    expect((await client.query<{ valid: boolean }>("SELECT scheduling_verify_maintenance_triggers() AS valid")).rows[0]!.valid).toBe(true);
    await client.query("SAVEPOINT intact_policy_triggers");
    await client.query('ALTER TABLE "ProgramCalendarDay" DISABLE TRIGGER scheduling_source_dirty');
    expect((await client.query<{ valid: boolean }>("SELECT scheduling_verify_maintenance_triggers() AS valid")).rows[0]!.valid).toBe(false);
    await client.query("ROLLBACK TO SAVEPOINT intact_policy_triggers");
    await client.query('ALTER TABLE "ProgramCalendarDay" DISABLE TRIGGER scheduling_source_truncated');
    expect((await client.query<{ valid: boolean }>("SELECT scheduling_verify_maintenance_triggers() AS valid")).rows[0]!.valid).toBe(false);
    await client.query("ROLLBACK TO SAVEPOINT intact_policy_triggers");
    await client.query('TRUNCATE "ProgramCalendarDay"');
    expect(await events()).toBe(before + 3);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
