import type { OperatorSql } from "./operator-site";

/** COMMENT ON DATABASE lives in the cluster-shared description catalog, even
 * when read through a connection to that database. Local obj_description cannot
 * recover this transactional resume marker. Names remain bound values. */
export async function readDatabaseRecoveryMarker(db: OperatorSql, database?: string): Promise<unknown> {
  const result = database === undefined
    ? await db.query("SELECT pg_catalog.shobj_description(oid,'pg_database') AS marker FROM pg_catalog.pg_database WHERE datname=current_database()")
    : await db.query("SELECT pg_catalog.shobj_description(oid,'pg_database') AS marker FROM pg_catalog.pg_database WHERE datname=$1", [database]);
  const marker = result.rows[0]?.marker;
  if (typeof marker !== "string") return null;
  try { return JSON.parse(marker) as unknown; }
  catch { return null; }
}
