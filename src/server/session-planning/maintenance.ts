import { inTransaction, type DomainDb, type TransactionDb } from "~/server/transactions";
import { databaseScope } from "~/server/db-scope";

/** This is an accelerator version, never a version of scheduling authority. */
export const SCHEDULING_MAINTENANCE_VERSION = 1;
export const SCHEDULING_MAINTENANCE_EVENT_LIMIT = 1000;
export const SCHEDULING_INVALIDATION_PAGE_SIZE = 200;

/** Driver-adapter errors can wrap SQLSTATE in cause/meta. Inspect only bounded
 * known containers; arbitrary/cyclic provider objects cannot loop this classifier.
 */
function abortedSchedulingTransaction(error: unknown) {
  const visited = new Set<object>();
  function inspect(value: unknown, depth: number): boolean {
    if (!value || typeof value !== "object" || depth > 8 || visited.has(value))
      return false;
    visited.add(value);
    const item = value as {
      code?: unknown;
      originalCode?: unknown;
      cause?: unknown;
      meta?: unknown;
      driverAdapterError?: unknown;
    };
    return item.code === "40P01" || item.code === "P2034" ||
      item.originalCode === "40P01" || inspect(item.cause, depth + 1) ||
      inspect(item.meta, depth + 1) || inspect(item.driverAdapterError, depth + 1);
  }
  return inspect(error, 0);
}

/** Only for these DB-only maintenance decisions and transactional notice writes.
 * A metadata reset can deadlock in the opposite row order; PostgreSQL rolls back
 * the entire victim before a fresh transaction retries. Existing transactions
 * belong to their caller and must propagate the abort to that outer boundary.
 */
export async function inSchedulingMaintenanceTransaction<T>(
  db: DomainDb,
  work: (tx: TransactionDb) => Promise<T>,
): Promise<T> {
  const ownsTransaction = "$transaction" in db && !databaseScope.getStore();
  for (let attempt = 0; ; attempt++) {
    try {
      return await inTransaction(db, work);
    } catch (error) {
      if (!ownsTransaction || attempt >= 2 || !abortedSchedulingTransaction(error))
        throw error;
    }
  }
}

type MaintenanceState = {
  valid: boolean;
  id: string | null;
  publicationVersion: number | null;
  settlementVersion: number | null;
  windowStart: string | null;
  prepareEnd: string | null;
  timeZone: string | null;
  unavailable: number | null;
  normalized: number | null;
  settlementBatchActive: boolean | null;
  stateRevision: string | null;
  eventIds: bigint[];
  retryPending: boolean;
};

async function verifiedState(
  tx: TransactionDb,
  consumer: "publication" | "settlement",
) {
  // TRUNCATE is not MVCC-safe. Take both relation locks before the SELECT's
  // snapshot, so an old state snapshot cannot meet a newly truncated event log.
  // ACCESS SHARE remains compatible with every source trigger's append-only INSERT.
  await tx.$executeRaw`
    LOCK TABLE public."SchedulingMaintenanceState", public."SchedulingDirtyEvent"
    IN ACCESS SHARE MODE`;
  const [state] = await tx.$queryRaw<MaintenanceState[]>`
    SELECT public.scheduling_verify_maintenance_triggers() AS valid, s.*,
      s.xmin::text AS "stateRevision", ARRAY(
        SELECT e.id FROM public."SchedulingDirtyEvent" e
        WHERE (${consumer === "publication"} AND e."publicationPending")
          OR (${consumer === "settlement"} AND e."settlementPending"
            AND e."requestId" IS NULL)
        ORDER BY e.id LIMIT ${SCHEDULING_MAINTENANCE_EVENT_LIMIT}) AS "eventIds",
      EXISTS (SELECT 1 FROM public."SchedulingDirtyEvent" retry
        WHERE retry."requestId" IS NOT NULL AND retry."settlementPending") AS "retryPending"
    FROM (SELECT 1) seed
    LEFT JOIN public."SchedulingMaintenanceState" s ON s.id='program'`;
  if (!state?.valid)
    throw new Error("Scheduling maintenance source triggers are unavailable.");
  return state;
}

export type PublicationMaintenance = {
  current: boolean;
  eventIds: bigint[];
  stateRevision: string | null;
  unavailable: number;
  normalized: number;
};

/** Called under period → room → planning. An exact visible ID set matters:
 * sequence allocation is not commit order, so MAX(id) can erase a late writer.
 * Dirty metadata never substitutes for the source checks in a scheduling write.
 */
export async function readSchedulingMaintenance(
  tx: TransactionDb,
  window: { start: string; prepareEnd: string; timeZone: string },
): Promise<PublicationMaintenance> {
  const state = await verifiedState(tx, "publication");
  return {
    current:
      state.id !== null &&
      state.publicationVersion === SCHEDULING_MAINTENANCE_VERSION &&
      state.windowStart === window.start &&
      state.prepareEnd === window.prepareEnd &&
      state.timeZone === window.timeZone &&
      state.eventIds.length === 0,
    eventIds: state.eventIds,
    stateRevision: state.stateRevision,
    unavailable: state.unavailable ?? 0,
    normalized: state.normalized ?? 0,
  };
}

export async function acknowledgeSchedulingPublication(
  tx: TransactionDb,
  input: {
    eventIds: bigint[];
    stateRevision: string | null;
    start: string;
    prepareEnd: string;
    timeZone: string;
    unavailable: number;
    normalized: number;
  },
) {
  if (input.stateRevision === null) {
    // A reset cannot see an uncommitted new state row. Publish this first pass
    // with an obsolete watermark; only a later pass against the committed row
    // can certify it. Never recreate a clean row after concurrent deletion.
    await tx.$executeRaw`
      INSERT INTO public."SchedulingMaintenanceState" (id) VALUES ('program')
      ON CONFLICT (id) DO NOTHING`;
  } else {
    // The bounded operation's xmin token detects resets and delete/recreate,
    // including a reset committed after source enumeration but before this ACK.
    await tx.$executeRaw`
      UPDATE public."SchedulingMaintenanceState" SET
        "publicationVersion"=${SCHEDULING_MAINTENANCE_VERSION},
        "windowStart"=${input.start}, "prepareEnd"=${input.prepareEnd},
        "timeZone"=${input.timeZone}, unavailable=${input.unavailable},
        normalized=${input.normalized}, "updatedAt"=clock_timestamp()
      WHERE id='program' AND xmin::text=${input.stateRevision}`;
  }
  if (input.eventIds.length)
    await tx.$executeRaw`
      UPDATE public."SchedulingDirtyEvent" SET "publicationPending"=false
      WHERE id=ANY(${input.eventIds}::bigint[])`;
  await deleteConsumedEvents(tx);
}

async function deleteConsumedEvents(tx: TransactionDb) {
  await tx.$executeRaw`
    DELETE FROM public."SchedulingDirtyEvent"
    WHERE NOT "publicationPending" AND NOT "settlementPending"`;
}

/** One rebuildable queue per consumer batch avoids duplicating every open
 * request for every source event. Queue membership only schedules a fresh check;
 * it cannot accept, expire or invalidate a request by itself.
 */
export async function prepareSchedulingInvalidationBatch(tx: TransactionDb): Promise<boolean> {
  let state = await verifiedState(tx, "settlement");
  const missingState = !state.id;
  if (
    !state.id ||
    state.settlementVersion !== SCHEDULING_MAINTENANCE_VERSION
  ) {
    const initialized = await tx.$executeRaw`
      INSERT INTO public."SchedulingMaintenanceState" (id,"settlementVersion")
      VALUES ('program',${SCHEDULING_MAINTENANCE_VERSION})
      ON CONFLICT (id) DO UPDATE SET
        "settlementVersion"=EXCLUDED."settlementVersion",
        "settlementBatchActive"=false,
        "settlementEventIds"=ARRAY[]::bigint[],
        "settlementRequestIds"=ARRAY[]::text[],
        "settlementCursor"='', "settlementBatchExhausted"=false,
        "updatedAt"=clock_timestamp()
      WHERE "SchedulingMaintenanceState".xmin::text=${state.stateRevision}`;
    if (!initialized) return false;
    // Missing or obsolete metadata must discover all current open requests even
    // when there are no source rows/events (for example after causal recovery).
    await tx.$executeRaw`
      INSERT INTO public."SchedulingDirtyEvent" ("sourceTable","publicationPending")
      VALUES ('maintenance-bootstrap',false)`;
    state = await verifiedState(tx, "settlement");
  }
  if (state.settlementVersion !== SCHEDULING_MAINTENANCE_VERSION) return false;
  if (state.settlementBatchActive) {
    await finishSchedulingInvalidationBatch(tx);
    state = await verifiedState(tx, "settlement");
    if (state.settlementVersion !== SCHEDULING_MAINTENANCE_VERSION) return false;
  }
  if (!state.settlementBatchActive && state.eventIds.length)
    await tx.$executeRaw`
      UPDATE public."SchedulingMaintenanceState" SET
        "settlementBatchActive"=true,
        "settlementEventIds"=${state.eventIds}::bigint[],
        "settlementRequestIds"=ARRAY[]::text[],
        "settlementCursor"='', "settlementBatchExhausted"=false,
        "updatedAt"=clock_timestamp()
      WHERE id='program' AND NOT "settlementBatchActive"
        AND "settlementVersion"=${SCHEDULING_MAINTENANCE_VERSION}
        AND xmin::text=${state.stateRevision}`;
  else if (!state.settlementBatchActive) return state.retryPending;
  // Keep only one bounded page in durable state. A lexical cursor advances only
  // after every request in that page committed a check (or became terminal).
  // New/changed requests behind the cursor append another event for the next
  // batch, so paging never suppresses a concurrent source write.
  const [page] = await tx.$queryRaw<{
    requestIds: string[];
    stateRevision: string;
  }[]>`
    SELECT s.xmin::text AS "stateRevision", ARRAY(
      SELECT r.id FROM public."SessionPlanningRequest" r
      WHERE r.status IN ('PENDING','SPLIT_REQUESTED')
        AND NOT EXISTS (SELECT 1 FROM public."SchedulingDirtyEvent" retry
          WHERE retry."requestId"=r.id AND retry."settlementPending")
        AND r.id>s."settlementCursor" ORDER BY r.id
      LIMIT ${SCHEDULING_INVALIDATION_PAGE_SIZE}) AS "requestIds"
    FROM public."SchedulingMaintenanceState" s
    WHERE s.id='program' AND s."settlementBatchActive"
      AND s."settlementVersion"=${SCHEDULING_MAINTENANCE_VERSION}
      AND NOT s."settlementBatchExhausted"
      AND cardinality(s."settlementRequestIds")=0`;
  if (page)
    await tx.$executeRaw`
      UPDATE public."SchedulingMaintenanceState" SET
        "settlementRequestIds"=${page.requestIds}::text[],
        "settlementCursor"=COALESCE(${page.requestIds.at(-1) ?? null},"settlementCursor"),
        "settlementBatchExhausted"=${page.requestIds.length < SCHEDULING_INVALIDATION_PAGE_SIZE},
        "updatedAt"=clock_timestamp()
      WHERE id='program' AND "settlementBatchActive"
        AND "settlementVersion"=${SCHEDULING_MAINTENANCE_VERSION}
        AND xmin::text=${page.stateRevision}
        AND NOT "settlementBatchExhausted"
        AND cardinality("settlementRequestIds")=0`;
  await finishSchedulingInvalidationBatch(tx);
  if (missingState)
    // As with publication, an uncommitted first state cannot observe every
    // concurrent reset. Keep it obsolete until a committed generation is read.
    await tx.$executeRaw`
      UPDATE public."SchedulingMaintenanceState" SET "settlementVersion"=0
      WHERE id='program'`;
  return true;
}

/** Commit this only with the individual request decision and notices. A failed
 * request stays queued; rotating its existing updatedAt preserves sweep fairness.
 */
export async function completeSchedulingInvalidation(
  tx: TransactionDb,
  requestId: string,
) {
  await tx.$executeRaw`
    UPDATE public."SchedulingMaintenanceState" SET
      "settlementRequestIds"=array_remove("settlementRequestIds",${requestId}),
      "updatedAt"=clock_timestamp()
    WHERE id='program' AND "settlementBatchActive"
      AND ${requestId}=ANY("settlementRequestIds")`;
  await tx.$executeRaw`
    UPDATE public."SchedulingDirtyEvent" SET "settlementPending"=false
    WHERE "requestId"=${requestId}`;
}

/** A broken request cannot pin the current page or delay later dirty batches.
 * This separate work row schedules retries, never records a scheduling outcome.
 */
export async function retrySchedulingInvalidation(
  tx: TransactionDb,
  requestId: string,
) {
  await tx.$executeRaw`
    UPDATE public."SchedulingMaintenanceState" SET
      "settlementRequestIds"=array_remove("settlementRequestIds",${requestId})
    WHERE id='program' AND "settlementBatchActive"`;
  await tx.$executeRaw`
    INSERT INTO public."SchedulingDirtyEvent"
      ("sourceTable","requestId","publicationPending")
    VALUES ('maintenance-retry',${requestId},false)
    ON CONFLICT ("requestId") DO UPDATE SET "settlementPending"=true`;
}

export async function finishSchedulingInvalidationBatch(tx: TransactionDb) {
  // Terminal/deleted rows require no decision. Read their current state instead
  // of leaving an unprocessable queue entry after a concurrent lifecycle write.
  await tx.$executeRaw`
    UPDATE public."SchedulingMaintenanceState" s SET "settlementRequestIds"=ARRAY(
      SELECT r.id FROM public."SessionPlanningRequest" r
      WHERE r.id=ANY(s."settlementRequestIds")
        AND r.status IN ('PENDING','SPLIT_REQUESTED')
        AND NOT EXISTS (SELECT 1 FROM public."SchedulingDirtyEvent" retry
          WHERE retry."requestId"=r.id AND retry."settlementPending")
        ORDER BY r.id)
    WHERE s.id='program' AND s."settlementBatchActive"`;
  await tx.$executeRaw`
    UPDATE public."SchedulingDirtyEvent" e SET "settlementPending"=false
    FROM public."SchedulingMaintenanceState" s
    WHERE s.id='program' AND s."settlementBatchActive"
      AND s."settlementVersion"=${SCHEDULING_MAINTENANCE_VERSION}
      AND s."settlementBatchExhausted"
      AND cardinality(s."settlementRequestIds")=0
      AND e.id=ANY(s."settlementEventIds")`;
  await tx.$executeRaw`
    UPDATE public."SchedulingMaintenanceState" SET
      "settlementBatchActive"=false,
      "settlementEventIds"=ARRAY[]::bigint[], "updatedAt"=clock_timestamp()
    WHERE id='program' AND "settlementBatchActive"
      AND "settlementVersion"=${SCHEDULING_MAINTENANCE_VERSION}
      AND "settlementBatchExhausted"
      AND cardinality("settlementRequestIds")=0`;
  await tx.$executeRaw`
    UPDATE public."SchedulingDirtyEvent" retry SET "settlementPending"=false
    WHERE retry."requestId" IS NOT NULL AND retry."settlementPending"
      AND NOT EXISTS (SELECT 1 FROM public."SessionPlanningRequest" r
        WHERE r.id=retry."requestId" AND r.status IN ('PENDING','SPLIT_REQUESTED'))`;
  await deleteConsumedEvents(tx);
}
