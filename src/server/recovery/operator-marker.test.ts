import { describe, expect, it } from "vitest";
import type { OperatorSql } from "./operator-site";
import { readDatabaseRecoveryMarker } from "./operator-marker";

describe("shared PostgreSQL database recovery markers", () => {
  it.each([undefined, "shbs_recovery_named_test"])("uses the shared catalog for %s, never a database-local description", async (database) => {
    const shared = { kind: "synthetic-shared-receipt", planHash: "reviewed-hash" };
    const local = { kind: "unrelated-local-description" };
    const queries: string[] = [];
    const db: OperatorSql = {
      async query(sql, values) {
        queries.push(sql);
        const condition = database === undefined ? "current_database()" : "$1";
        expect(values ?? []).toEqual(database === undefined ? [] : [database]);
        // Distinct results make a wrong function a failing assertion. Broad
        // includes('obj_description') would also match shobj_description.
        if (sql === `SELECT pg_catalog.shobj_description(oid,'pg_database') AS marker FROM pg_catalog.pg_database WHERE datname=${condition}`)
          return { rows: [{ marker: JSON.stringify(shared) }] };
        if (sql === `SELECT pg_catalog.obj_description(oid,'pg_database') AS marker FROM pg_catalog.pg_database WHERE datname=${condition}` ||
            sql === `SELECT obj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=${condition}`)
          return { rows: [{ marker: JSON.stringify(local) }] };
        throw new Error("Unexpected recovery marker query");
      },
      async close() { throw new Error("Marker reader must not close caller connections"); },
    };
    expect(await readDatabaseRecoveryMarker(db, database)).toEqual(shared);
    expect(queries).toHaveLength(1);
  });

  it.each([null, "malformed JSON"])("does not turn %s into a successful receipt", async (marker) => {
    const db: OperatorSql = {
      async query(sql) {
        expect(sql).toBe("SELECT pg_catalog.shobj_description(oid,'pg_database') AS marker FROM pg_catalog.pg_database WHERE datname=current_database()");
        return { rows: [{ marker }] };
      },
      async close() { throw new Error("Marker reader must not close caller connections"); },
    };
    expect(await readDatabaseRecoveryMarker(db)).toBeNull();
  });
});
