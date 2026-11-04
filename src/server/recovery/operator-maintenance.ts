import { operatorAssert } from "./operator-cli";
import type { OperatorSql } from "./operator-site";

export const RECOVERY_SCHEDULING_INVALIDATION_SOURCE =
  "recovery-reconciliation";

export type RecoverySchedulingInvalidation = {
  version: 1;
  mode: "INVALIDATION";
  state: "MISSING" | "OBSOLETE";
  eventId: string;
};

/** Acquire before reconciliation DML, whose source triggers append dirty events.
 * The invalidator may safely reacquire these transaction-scoped locks later. */
export async function acquireRecoverySchedulingFences(
  db: Pick<OperatorSql, "query">,
) {
  for (const fence of [
    "program:period",
    "planned-room-schedule",
    "session-planning",
  ])
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      fence,
    ]);
}

/** Operator-only: the caller owns a sealed, quiescent target transaction. This
 * invalidates rebuildable accelerators; it never clears source/retry events or
 * acknowledges work. Ordinary maintenance retains its exact-ID ACK protocol. */
export async function invalidateReconciledSchedulingMaintenance(
  db: Pick<OperatorSql, "query">,
): Promise<RecoverySchedulingInvalidation> {
  // Match normal publication and settlement before touching metadata. The
  // relation order also matches maintenance's protection against TRUNCATE.
  await acquireRecoverySchedulingFences(db);
  await db.query(`LOCK TABLE public."SchedulingMaintenanceState",
    public."SchedulingDirtyEvent" IN ACCESS SHARE MODE`);
  const verified = await db.query(
    "SELECT public.scheduling_verify_maintenance_triggers() AS valid",
  );
  operatorAssert(
    verified.rows.length === 1 && verified.rows[0]?.valid === true,
    "INVALID_SCHEDULING_MAINTENANCE_TRIGGERS",
  );

  const before = await db.query(`SELECT xmin::text AS revision
    FROM public."SchedulingMaintenanceState" WHERE id='program'`);
  operatorAssert(
    before.rows.length <= 1,
    "INVALID_SCHEDULING_MAINTENANCE_STATE",
  );
  if (before.rows.length) {
    const revision = before.rows[0]?.revision;
    operatorAssert(
      typeof revision === "string" && /^\d+$/.test(revision),
      "INVALID_SCHEDULING_MAINTENANCE_REVISION",
    );
    const invalidated = await db.query(
      `UPDATE public."SchedulingMaintenanceState"
      SET "publicationVersion"=0,"settlementVersion"=0,"updatedAt"=clock_timestamp()
      WHERE id='program' AND xmin::text=$1 RETURNING id`,
      [revision],
    );
    operatorAssert(
      invalidated.rows.length === 1 && invalidated.rows[0]?.id === "program",
      "SCHEDULING_MAINTENANCE_STATE_CHANGED",
    );
  }
  // A missing state stays missing. Its next publication initializes an obsolete
  // row; settlement version zero/missing rebuilds the open-request queue.
  const inserted = await db.query(
    `INSERT INTO public."SchedulingDirtyEvent"
    ("sourceTable","requestId","publicationPending","settlementPending")
    VALUES ($1,NULL,true,true) RETURNING id::text AS id`,
    [RECOVERY_SCHEDULING_INVALIDATION_SOURCE],
  );
  const eventId = inserted.rows[0]?.id;
  operatorAssert(
    inserted.rows.length === 1 &&
      typeof eventId === "string" &&
      /^[1-9]\d*$/.test(eventId),
    "INVALID_RECOVERY_SCHEDULING_MARKER",
  );
  const state = await db.query(`SELECT "publicationVersion","settlementVersion"
    FROM public."SchedulingMaintenanceState" WHERE id='program'`);
  operatorAssert(
    state.rows.length === 0 ||
      (state.rows.length === 1 &&
        state.rows[0]?.publicationVersion === 0 &&
        state.rows[0]?.settlementVersion === 0),
    "SCHEDULING_MAINTENANCE_NOT_INVALIDATED",
  );
  const marker = await db.query(
    `SELECT id::text AS id,"sourceTable","requestId",
      "publicationPending","settlementPending"
    FROM public."SchedulingDirtyEvent" WHERE id=$1::bigint`,
    [eventId],
  );
  operatorAssert(
    marker.rows.length === 1 &&
      marker.rows[0]?.id === eventId &&
      marker.rows[0]?.sourceTable === RECOVERY_SCHEDULING_INVALIDATION_SOURCE &&
      marker.rows[0]?.requestId === null &&
      marker.rows[0]?.publicationPending === true &&
      marker.rows[0]?.settlementPending === true,
    "RECOVERY_SCHEDULING_MARKER_NOT_PENDING",
  );
  return {
    version: 1,
    mode: "INVALIDATION",
    state: state.rows.length ? "OBSOLETE" : "MISSING",
    eventId,
  };
}
