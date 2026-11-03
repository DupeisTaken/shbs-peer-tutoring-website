import { createHash, randomUUID } from "node:crypto";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";

export type RecoveryDeliverySource = {
  entity: string;
  recordId: string;
  actionId?: string;
};
export type RecoveryDeliveryScope = {
  actionId: string;
  eventIds?: readonly string[];
};
type EffectRow = {
  id: string;
  actionId: string;
  eventId: string;
  notificationId: string | null;
  deliveryId: string | null;
  status: string | null;
  category: string | null;
  attempts: number | null;
  leaseUntil: Date | null;
  attemptId: string | null;
  attemptStartedAt: Date | null;
  readAt: Date | null;
  notificationExists: boolean;
  withdrawnAt: Date | null;
  cancellation: string | null;
};
export type RecoveryDeliveryDisposition =
  | "PENDING"
  | "LEASED"
  | "PRIOR_ATTEMPT_UNKNOWN"
  | "IN_FLIGHT_OR_UNKNOWN"
  | "SENT"
  | "STOPPED"
  | "IN_APP_VISIBLE"
  | "OBSERVED_NOTICE"
  | "UNKNOWN";
export type RecoveryDeliveryInventory = {
  version: 1;
  coverage: "COMPLETE" | "UNKNOWN";
  blockers: string[];
  fingerprint: string;
  effects: Array<{
    id: string;
    eventId: string;
    deliveryId: string | null;
    notificationId: string | null;
    disposition: RecoveryDeliveryDisposition;
    cancellation: string | null;
  }>;
};
const sourceEntities = new Set([
  "TutorApplication",
  "Pairing",
  "PairingCreationRequest",
  "AccountInvitation",
  "User",
  "Tutor",
  "Tutee",
  "StudentSurvey",
  "Session",
  "DisciplinaryCard",
  "ScheduledProgramRefresh",
  "CrewApplication",
  "TutorStatusRequest",
  "CrewStatusRequest",
  "StudentRequestReview",
  "TuteeRemovalRequest",
  "SchoolDepartureEvent",
]);
const specialized = new Set([
  "request_service",
  "monthly_hours",
  "school_hours",
]);
const validId = (value: string) => value.length > 0 && value.length <= 200;

/** Identity policy joins this engine's transaction, taking its table fence
 * before causal-root locks and never performing another admission. */
export type RecoveryGenericDeliveryGuard = {
  lock: (tx: TransactionDb) => Promise<void>;
  withheld: (tx: TransactionDb, row: { id: string; userId: string | null; sourceNotificationId?: string | null }) => Promise<boolean>;
};

/** Trusted writers opt in around only the exact derived notification/enqueue.
 * The source is not an HTTP option and never authorizes matching by recipient. */
export async function withRecoveryDeliverySource<T>(
  tx: TransactionDb,
  source: RecoveryDeliverySource,
  work: () => Promise<T>,
): Promise<T> {
  if (
    !sourceEntities.has(source.entity) ||
    !validId(source.recordId) ||
    (source.actionId !== undefined && !validId(source.actionId))
  )
    throw new Error("INVALID_RECOVERY_DELIVERY_SOURCE");
  const [previous] = await tx.$queryRaw<Array<{ value: string | null }>>`
    SELECT current_setting('shbs.recovery_delivery_source',true) AS value`;
  // An ordinary writer may share its source with an older admission root. Only
  // its trusted active action, tracking this exact typed source, disambiguates it.
  const [active] =
    source.actionId === undefined
      ? await tx.$queryRaw<Array<{ actionId: string }>>`
        SELECT t."actionId" FROM "RecoveryTrackedEntity" t
        JOIN "RecoveryAction" a ON a.id=t."actionId"
        WHERE t."actionId"=NULLIF(current_setting('shbs.recovery_action',true),'')
          AND t.entity=${source.entity} AND t."recordId"=${source.recordId}
          AND a.kind IN ('INITIAL_ADMISSION','DOMAIN_CHECKPOINT')
          AND NOT EXISTS(SELECT 1 FROM "RecoveryReceipt" r WHERE r."actionId"=a.id)`
      : [];
  const boundSource = active
    ? { ...source, actionId: active.actionId }
    : source;
  await tx.$queryRaw`SELECT set_config('shbs.recovery_delivery_source',${JSON.stringify(boundSource)},true)`;
  try {
    return await work();
  } finally {
    await tx.$queryRaw`SELECT set_config('shbs.recovery_delivery_source',${previous?.value ?? ""},true)`;
  }
}

/** Check the actual observer/stop triggers, including predicates and column
 * filters. A historical marker cannot attest today's disabled insert coverage. */
export async function recoveryDeliveryCoverageInstalled(
  tx: TransactionDb,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<Array<{ complete: boolean }>>`
    WITH expected(table_name,trigger_name,function_name,event_mask) AS (VALUES
      ('Notification','aa_recovery_delivery_start','recovery_delivery_start_v2',5),
      ('Notification','zz_recovery_delivery_end','recovery_delivery_end',5),
      ('EmailDelivery','recovery_delivery_mail','recovery_delivery_mail_v2',5),
      ('EmailDelivery','recovery_delivery_retry_guard','recovery_delivery_retry_guard',19),
      ('RecoveryEvent','recovery_delivery_event_coverage','recovery_delivery_event_coverage_v2',5),
      ('RecoveryDeliveryCoverage','recovery_delivery_coverage_guard','recovery_delivery_coverage_guard',27),
      ('RecoveryDeliveryEffect','recovery_delivery_effect_immutable','recovery_immutable_evidence',27),
      ('RecoveryDeliveryCancellation','recovery_delivery_cancellation_immutable','recovery_immutable_evidence',27))
    SELECT NOT EXISTS(SELECT 1 FROM expected e WHERE NOT EXISTS(
      SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid=t.tgfoid JOIN pg_namespace n ON n.oid=f.pronamespace
      WHERE t.tgrelid=to_regclass(format('public.%I',e.table_name)) AND t.tgname=e.trigger_name
        AND f.proname=e.function_name AND n.nspname='public' AND t.tgtype=e.event_mask
        AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0
        AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
    )) AND NOT EXISTS(SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('public."Notification"') AND t.tgname='recovery_delivery_start')
      AND current_setting('session_replication_role')='origin' AS complete`;
  return row?.complete === true;
}

async function effectRows(tx: TransactionDb, scope: RecoveryDeliveryScope) {
  const eventIds = scope.eventIds ? [...scope.eventIds] : null;
  return tx.$queryRaw<EffectRow[]>`
    SELECT e.id,e."actionId",e."eventId",e."notificationId",e."deliveryId",
      d.status,d.category,d.attempts,d."leaseUntil",d."attemptId",d."attemptStartedAt",n."readAt",
      n.id IS NOT NULL AS "notificationExists",n."recoveryWithdrawnAt" AS "withdrawnAt",c.disposition AS cancellation
    FROM "RecoveryDeliveryEffect" e
    LEFT JOIN "EmailDelivery" d ON d.id=e."deliveryId"
    LEFT JOIN "Notification" n ON n.id=e."notificationId"
    LEFT JOIN LATERAL (
      SELECT stop.disposition FROM "RecoveryDeliveryCancellation" stop
      JOIN "RecoveryDeliveryEffect" stopped ON stopped.id=stop."effectId"
      WHERE (e."deliveryId" IS NOT NULL AND stopped."deliveryId"=e."deliveryId")
        OR (e."deliveryId" IS NULL AND stopped."deliveryId" IS NULL AND stopped."notificationId"=e."notificationId")
      ORDER BY stop."createdAt",stop."effectId" LIMIT 1
    ) c ON true
    WHERE e."actionId"=${scope.actionId} AND (${eventIds}::text[] IS NULL OR e."eventId"=ANY(${eventIds}::text[]))
    ORDER BY e.id LIMIT 1001`;
}
export function recoveryDeliveryDisposition(
  effect: EffectRow,
): RecoveryDeliveryDisposition {
  if (effect.deliveryId) {
    if (effect.status === "SENT") return "SENT";
    if (["SENDING", "UNCERTAIN", "UNCERTAIN_RECOVERY"].includes(effect.status ?? "") || effect.attemptStartedAt)
      return "IN_FLIGHT_OR_UNKNOWN";
    if (
      ["CANCELLED", "SKIPPED", "SUPERSEDED", "BLOCKED"].includes(
        effect.status ?? "",
      )
    )
      return effect.attempts ? "PRIOR_ATTEMPT_UNKNOWN" : "STOPPED";
    if (effect.status === "PENDING" || effect.status === "FAILED") {
      if (effect.attempts) return "PRIOR_ATTEMPT_UNKNOWN";
      return effect.leaseUntil ? "LEASED" : "PENDING";
    }
    return "UNKNOWN";
  }
  if (!effect.notificationExists) return "UNKNOWN";
  if (effect.readAt) return "OBSERVED_NOTICE";
  return effect.withdrawnAt ? "STOPPED" : "IN_APP_VISIBLE";
}
function projection(rows: EffectRow[]) {
  return rows.map((effect) => ({
    id: effect.id,
    eventId: effect.eventId,
    deliveryId: effect.deliveryId,
    notificationId: effect.notificationId,
    disposition: recoveryDeliveryDisposition(effect),
    cancellation: effect.cancellation,
  }));
}

/** Read-only, bounded prospective evidence. No rows are inferred for old events,
 * and the public projection never contains recipients, message bodies or tokens. */
export async function inspectRecoveryDeliveryEffects(
  tx: TransactionDb,
  scope: RecoveryDeliveryScope,
): Promise<RecoveryDeliveryInventory> {
  const blockers: string[] = [];
  if (
    !validId(scope.actionId) ||
    (scope.eventIds &&
      (scope.eventIds.length > 100 || !scope.eventIds.every(validId)))
  )
    throw new Error("INVALID_RECOVERY_DELIVERY_SCOPE");
  const events = await tx.recoveryEvent.findMany({
    where: {
      actionId: scope.actionId,
      ...(scope.eventIds ? { id: { in: [...scope.eventIds] } } : {}),
    },
    select: { id: true },
    take: 101,
    orderBy: { id: "asc" },
  });
  if (
    events.length > 100 ||
    (scope.eventIds && events.length !== new Set(scope.eventIds).size)
  )
    blockers.push("Recovery delivery event scope is incomplete.");
  if (!scope.eventIds && !events.length)
    blockers.push("Recovery delivery event provenance is missing.");
  const coverage = await tx.$queryRaw<
    Array<{ eventId: string; version: number }>
  >`
    SELECT "eventId",version FROM "RecoveryDeliveryCoverage" WHERE "actionId"=${scope.actionId}
      AND "eventId"=ANY(${events.map((event) => event.id)}::text[]) ORDER BY "eventId"`;
  if (
    coverage.length !== events.length ||
    coverage.some((entry) => entry.version !== 2)
  )
    blockers.push(
      "Recovery delivery origin is unknown for this event; legacy effects cannot be invented.",
    );
  if (!(await recoveryDeliveryCoverageInstalled(tx)))
    blockers.push("Recovery delivery insert/transport coverage is incomplete.");
  const rows = await effectRows(tx, scope);
  if (rows.length > 1000)
    blockers.push("Recovery delivery scope exceeds the supported limit.");
  if (rows.some((effect) => recoveryDeliveryDisposition(effect) === "UNKNOWN"))
    blockers.push("A captured delivery effect has an unknown outcome.");
  if (rows.some((effect) => specialized.has(effect.category ?? "")))
    blockers.push(
      "A captured delivery needs its owning request/report recovery adapter.",
    );
  const effects = projection(rows);
  return {
    version: 1,
    coverage: blockers.length ? "UNKNOWN" : "COMPLETE",
    blockers,
    fingerprint: createHash("sha256")
      .update(JSON.stringify({ coverage, rows, blockers }))
      .digest("hex"),
    effects,
  };
}

/** Read before acquiring any individual root. Exact physical references only
 * expand the lock set; causal attribution remains the immutable source journal. */
export async function recoveryDeliveryRootIds(tx: TransactionDb, actionId: string) {
  if (!validId(actionId)) throw new Error("INVALID_RECOVERY_DELIVERY_SCOPE");
  const rows = await tx.$queryRaw<Array<{ actionId: string }>>`
    WITH shared_physical AS (
      SELECT "notificationId","deliveryId" FROM "RecoveryDeliveryEffect" WHERE "actionId"=${actionId}
    )
    SELECT DISTINCT roots."actionId" FROM (
      SELECT ${actionId}::text AS "actionId"
      UNION ALL SELECT other."actionId" FROM "RecoveryDeliveryEffect" other JOIN shared_physical selected
        ON (selected."deliveryId" IS NOT NULL AND other."deliveryId"=selected."deliveryId")
        OR (selected."notificationId" IS NOT NULL AND other."notificationId"=selected."notificationId")
    ) roots ORDER BY roots."actionId" LIMIT 101`;
  if (rows.length > 100) throw new Error("RECOVERY_DELIVERY_ROOT_LIMIT");
  return rows.map((row) => row.actionId).sort();
}
export async function lockRecoveryDeliveryRoots(tx: TransactionDb, actionId: string) {
  const roots = await recoveryDeliveryRootIds(tx, actionId);
  for (const root of roots) await lockEntity(tx, `recovery:${root}`);
}
async function lockDeliveryOrigins(tx: TransactionDb, deliveryId: string) {
  const origins = await tx.$queryRaw<Array<{ actionId: string }>>`
    SELECT DISTINCT "actionId" FROM "RecoveryDeliveryEffect" WHERE "deliveryId"=${deliveryId}
    ORDER BY "actionId" LIMIT 101`;
  if (origins.length > 100) throw new Error("RECOVERY_DELIVERY_ROOT_LIMIT");
  for (const root of origins.map((row) => row.actionId).sort()) await lockEntity(tx, `recovery:${root}`);
  return origins.length > 0;
}

/** Caller holds its domain/recovery fence before this operation. Row locks are
 * sorted by delivery ID and never held during SMTP. Commit this with its receipt. */
export async function cancelRecoveryDeliveryEffects(
  tx: TransactionDb,
  scope: RecoveryDeliveryScope,
  recoveryKey: string,
) {
  if (!validId(recoveryKey)) throw new Error("INVALID_RECOVERY_DELIVERY_KEY");
  await lockRecoveryDeliveryRoots(tx, scope.actionId);
  const inventory = await inspectRecoveryDeliveryEffects(tx, scope);
  if (inventory.coverage !== "COMPLETE")
    throw new Error("RECOVERY_DELIVERY_COVERAGE_UNKNOWN");
  const rows = await effectRows(tx, scope);
  const deliveryIds = [...new Set(rows
    .flatMap((effect) => (effect.deliveryId ? [effect.deliveryId] : [])))].sort();
  // Acquiring each exact row serially gives the worker and recovery one order.
  for (const deliveryId of deliveryIds)
    await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id=${deliveryId} FOR UPDATE`;
  const current = await effectRows(tx, scope);
  const stoppedDeliveries = new Set<string>();
  const withdrawnNotifications = new Set<string>();
  for (const effect of current) {
    const disposition = recoveryDeliveryDisposition(effect);
    await tx.$executeRaw`INSERT INTO "RecoveryDeliveryCancellation"("effectId","recoveryKey",disposition)
      VALUES(${effect.id},${recoveryKey},${disposition}) ON CONFLICT ("effectId") DO NOTHING`;
    if (
      effect.deliveryId &&
      !stoppedDeliveries.has(effect.deliveryId) &&
      ["PENDING", "FAILED"].includes(effect.status ?? "") &&
      !effect.attemptStartedAt
    ) {
      stoppedDeliveries.add(effect.deliveryId);
      await tx.emailDelivery.updateMany({
        where: { id: effect.deliveryId, status: { in: ["PENDING", "FAILED"] }, attemptStartedAt: null },
        data: {
          status: "CANCELLED",
          leaseUntil: null,
          attemptId: null,
          completedAt: new Date(),
          lastError: null,
        },
      });
    }
    if (!effect.deliveryId && effect.notificationId && !withdrawnNotifications.has(effect.notificationId)) {
      withdrawnNotifications.add(effect.notificationId);
      await tx.$executeRaw`UPDATE "Notification" SET "recoveryWithdrawnAt"=COALESCE("recoveryWithdrawnAt",CURRENT_TIMESTAMP)
        WHERE id=${effect.notificationId}`;
    }
  }
  // Admission happened before these locks or cancellation stopped it. An in-flight
  // disposition remains truthful even if SMTP settles after this receipt commits.
  return { version: 1 as const, effects: projection(current) };
}

/** Generic causal mail alone uses this fence. Existing request/report delivery
 * keeps its own stronger source/consent admission implementation. */
export async function admitRecoveryGenericDelivery(
  db: DomainDb,
  deliveryId: string,
  leaseUntil: Date | null,
  expectedAttemptId: string | null,
  guard?: RecoveryGenericDeliveryGuard,
) {
  return inTransaction(db, async (tx) => {
    await guard?.lock(tx);
    const captured = await lockDeliveryOrigins(tx, deliveryId);
    // Root-only compatibility callers cannot admit independent rows. The
    // ordinary dispatcher supplies identity policy for every generic notice.
    if (!captured && !guard) return { independent: true as const };
    await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id=${deliveryId} FOR UPDATE`;
    const row = await tx.emailDelivery.findUnique({
      where: { id: deliveryId },
    });
    const [cancelled] = await tx.$queryRaw<Array<{ found: boolean }>>`
      SELECT true AS found FROM "RecoveryDeliveryCancellation" c JOIN "RecoveryDeliveryEffect" e ON e.id=c."effectId"
      WHERE e."deliveryId"=${deliveryId} LIMIT 1`;
    if (
      !row ||
      cancelled ||
      row.category === "security" ||
      specialized.has(row.category) ||
      !leaseUntil ||
      leaseUntil.getTime() <= Date.now() ||
      row.leaseUntil?.getTime() !== leaseUntil.getTime() ||
      row.attemptId !== expectedAttemptId ||
      row.status !== "PENDING" ||
      !!row.attemptStartedAt
    )
      return null;
    if (guard && await guard.withheld(tx, row)) {
      await tx.emailDelivery.updateMany({
        where: { id: deliveryId, status: "PENDING", leaseUntil, attemptId: expectedAttemptId, attemptStartedAt: null },
        data: { status: "CANCELLED", completedAt: new Date(), leaseUntil: null },
      });
      return null;
    }
    if (row.attempts >= 5) {
      await tx.emailDelivery.update({
        where: { id: deliveryId },
        data: { status: "FAILED", leaseUntil: null, completedAt: new Date() },
      });
      return null;
    }
    const attemptId = randomUUID();
    const changed = await tx.emailDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "SENDING",
        attemptId,
        attemptStartedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (changed.status !== "SENDING" || changed.attemptId !== attemptId) return null;
    return { independent: false as const, attemptId };
  });
}
export async function finishRecoveryGenericDelivery(
  db: DomainDb,
  deliveryId: string,
  attemptId: string,
  accepted: boolean,
  guard?: RecoveryGenericDeliveryGuard,
) {
  return inTransaction(db, async (tx) => {
    await guard?.lock(tx);
    const captured = await lockDeliveryOrigins(tx, deliveryId);
    if (!captured && !guard) return;
    await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id=${deliveryId} FOR UPDATE`;
    const row = await tx.emailDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!row || specialized.has(row.category) || row.category === "security" || !["SENDING", "UNCERTAIN", "UNCERTAIN_RECOVERY"].includes(row.status) || row.attemptId !== attemptId || !row.attemptStartedAt) return;
    const [cancelled] = await tx.$queryRaw<Array<{ found: boolean }>>`
      SELECT true AS found FROM "RecoveryDeliveryCancellation" c JOIN "RecoveryDeliveryEffect" e ON e.id=c."effectId"
      WHERE e."deliveryId"=${deliveryId} LIMIT 1`;
    await tx.emailDelivery.updateMany({
      where: { id: deliveryId, status: row.status, attemptId },
      data: {
        status: accepted
          ? "SENT"
          : cancelled
            ? "CANCELLED"
            : "UNCERTAIN",
        leaseUntil: null,
        completedAt: new Date(),
        lastError:
          accepted || cancelled
            ? null
            : "Transport was admitted; delivery outcome needs review before any retry.",
      },
    });
  });
}
