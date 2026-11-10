import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { lockUsernameNamespace } from "~/server/auth/username-namespace";
import { lockAccountProfile } from "~/server/account-profile-lock";
import { lockAttendanceSchedule } from "~/server/attendance-schedule-lock";
import { auditActorScope, databaseScope } from "~/server/db-scope";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { recoveryHash, recoveryJson } from "./capture";
import {
  checkpointAdapterIds,
  UnsupportedCheckpointSnapshot,
  type CheckpointActor,
  type CheckpointAdapter,
  type CheckpointAdapterId,
  type CheckpointCapture,
  type CheckpointContext,
  type CheckpointPlan,
  type CheckpointScopeEntity,
} from "./checkpoint-contract";
import { attendanceCheckpointAdapter } from "./adapters/attendance";
import { cardCheckpointAdapter } from "./adapters/card";
import {
  tutorCheckpointAdapter,
  tuteeCheckpointAdapter,
} from "./adapters/participant";
import { studentWorkflowCheckpointAdapter } from "./adapters/student-workflow";
import { programRefreshCheckpointAdapter } from "./adapters/program-refresh";
import { preservedCheckpointChange } from "./adapters/shared";
import {
  cancelRecoveryDeliveryEffects,
  inspectRecoveryDeliveryEffects,
  recoveryDeliveryRootIds,
} from "./delivery-effects";

const adapters: Record<CheckpointAdapterId, CheckpointAdapter> = {
  PARTICIPANT_TUTOR: tutorCheckpointAdapter,
  PARTICIPANT_TUTEE: tuteeCheckpointAdapter,
  STUDENT_WORKFLOW: studentWorkflowCheckpointAdapter,
  ATTENDANCE: attendanceCheckpointAdapter,
  CARD: cardCheckpointAdapter,
  PROGRAM_REFRESH: programRefreshCheckpointAdapter,
};
const id = z.string().trim().min(1).max(200);
export const captureCheckpointInput = z
  .object({ adapter: z.enum(checkpointAdapterIds), sourceId: id })
  .strict();
export const restoreCheckpointInput = z
  .object({
    checkpointId: id,
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    clientKey: z.string().uuid(),
    reason: z.string().trim().min(5).max(2000),
  })
  .strict();
const scopeSchema = z
  .array(
    z
      .object({
        entity: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
        recordId: id,
      })
      .strict(),
  )
  .max(1000);

async function currentActor(
  tx: TransactionDb,
  actorId: string,
  allowed: readonly string[],
  lock = false,
) {
  if (lock)
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorId} FOR SHARE`;
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: {
      id: true,
      name: true,
      role: true,
      suspendedAt: true,
      mergedIntoId: true,
      recoveryVoidedAt: true,
    },
  });
  if (
    !actor ||
    actor.suspendedAt ||
    actor.mergedIntoId ||
    actor.recoveryVoidedAt ||
    !allowed.includes(actor.role)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Current management authority is required for this checkpoint.",
    });
  return actor;
}
function adapterFor(adapter: string) {
  const key = z.enum(checkpointAdapterIds).safeParse(adapter);
  if (!key.success)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Unsupported checkpoint adapter cannot be restored.",
    });
  return adapters[key.data];
}
function orderedScope(scope: CheckpointScopeEntity[]) {
  const entries = scopeSchema.parse([
    ...new Map(
      scope.map((entry) => [`${entry.entity}:${entry.recordId}`, entry]),
    ).values(),
  ]);
  return entries.sort((a, b) =>
    `${a.entity}:${a.recordId}`.localeCompare(`${b.entity}:${b.recordId}`),
  );
}

/** Capture is prospective metadata under the same domain barriers as mutation.
 * It grants no membership, proves no consent and never reconstructs legacy history. */
export async function captureRecoveryCheckpoint(
  db: DomainDb,
  raw: z.input<typeof captureCheckpointInput>,
  actor: CheckpointActor,
) {
  return captureCheckpoint(db, raw, actor, false);
}
async function captureCheckpoint(
  db: DomainDb,
  raw: z.input<typeof captureCheckpointInput>,
  actor: CheckpointActor | null,
  automatic: boolean,
) {
  const input = captureCheckpointInput.parse(raw);
  const adapter = adapters[input.adapter];
  return inTransaction(
    db,
    async (tx) => {
      if (input.adapter === "ATTENDANCE") await lockAttendanceSchedule(tx);
      await lockEntity(tx, "program:period");
      await lockUsernameNamespace(tx);
      if (actor) {
        await lockAccountProfile(tx, actor.id);
        await currentActor(
          tx,
          actor.id,
          automatic
            ? [
                "STUDENT",
                "VIEWER",
                "CREW",
                "TUTOR",
                "COORDINATOR",
                "ADMIN",
                "HEAD",
              ]
            : input.adapter === "PROGRAM_REFRESH"
              ? ["ADMIN", "HEAD"]
              : ["COORDINATOR", "ADMIN", "HEAD"],
          true,
        );
      } else if (!automatic) throw new TRPCError({ code: "FORBIDDEN" });
      let captured: CheckpointCapture;
      let schemaVersion = 1;
      let scope: CheckpointScopeEntity[];
      try {
        await adapter.lock(tx, input.sourceId);
        captured = await adapter.capture(tx, input.sourceId);
        scope = orderedScope([
          { entity: adapter.sourceEntity, recordId: input.sourceId },
          ...captured.scope,
        ]);
      } catch (error) {
        if (
          !automatic ||
          !(
            error instanceof UnsupportedCheckpointSnapshot ||
            error instanceof z.ZodError
          )
        )
          throw error;
        schemaVersion = 0;
        captured = {
          snapshot: { unsupportedSnapshot: true, adapter: adapter.id },
          scope: [],
        };
        scope = [{ entity: adapter.sourceEntity, recordId: input.sourceId }];
      }
      const [clock] = await tx.$queryRaw<
        Array<{ transactionId: string }>
      >`SELECT txid_current()::text AS "transactionId"`;
      if (!clock)
        throw new Error("Checkpoint transaction identity unavailable");
      const action = await tx.recoveryAction.create({
        data: {
          kind: "DOMAIN_CHECKPOINT",
          applicationId: null,
          before: captured.snapshot,
        },
      });
      const checkpoint = await tx.recoveryCheckpoint.create({
        data: {
          actionId: action.id,
          schemaVersion,
          adapter: adapter.id,
          adapterVersion: adapter.version,
          sourceEntity: adapter.sourceEntity,
          sourceId: input.sourceId,
          capturedById: actor?.id ?? "SYSTEM",
          captureTransactionId: clock.transactionId,
          scope: recoveryJson(scope),
        },
      });
      await tx.recoveryTrackedEntity.createMany({
        data: scope.map((entry) => ({ actionId: action.id, ...entry })),
      });
      await tx.recoveryEvent.create({
        data: {
          id: createHash("md5")
            .update(`${action.id}:${clock.transactionId}`)
            .digest("hex"),
          actionId: action.id,
          transactionId: clock.transactionId,
          kind: "CHECKPOINT_CAPTURE",
        },
      });
      await tx.recoveryAction.update({
        where: { id: action.id },
        data: { after: { checkpointId: checkpoint.id } },
      });
      return { checkpointId: checkpoint.id, actionId: action.id };
    },
    { isolationLevel: "Serializable" },
  );
}

/** The ordinary writer owns authorization. One logical outer action captures
 * nested consequences; a nested source never relabels or duplicates that root.
 * Standalone writes restore their predecessor transaction-local source on return. */
export async function withAutomaticRecoveryCheckpoint<T>(
  tx: TransactionDb,
  input: z.input<typeof captureCheckpointInput>,
  actor: CheckpointActor | null,
  work: () => Promise<T>,
): Promise<T> {
  const parsed = captureCheckpointInput.parse(input);
  const [previous] = await tx.$queryRaw<
    Array<{
      action: string | null;
      kind: string | null;
      compensating: string | null;
    }>
  >`
    SELECT current_setting('shbs.recovery_action',true) AS action,current_setting('shbs.recovery_kind',true) AS kind,
      current_setting('shbs.recovery_compensating',true) AS compensating`;
  if (previous?.compensating) return work();
  if (previous?.action) {
    const selected = await tx.recoveryCheckpoint.findUnique({
      where: { actionId: previous.action },
    });
    if (
      selected?.adapter === parsed.adapter &&
      selected.sourceId === parsed.sourceId
    )
      return work();
    const outer = await tx.recoveryAction.findUnique({
      where: { id: previous.action },
      select: { kind: true },
    });
    if (
      outer &&
      ["INITIAL_ADMISSION", "DOMAIN_CHECKPOINT"].includes(outer.kind)
    )
      return work();
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Unknown outer recovery source cannot authorize nested checkpoint capture.",
    });
  }
  const checkpoint = await captureCheckpoint(tx, parsed, actor, true);
  await tx.$queryRaw`SELECT set_config('shbs.recovery_action',${checkpoint.actionId},true),set_config('shbs.recovery_kind',${parsed.adapter},true)`;
  const restoreSource = () =>
    tx.$queryRaw`SELECT set_config('shbs.recovery_action',${previous?.action ?? ""},true),set_config('shbs.recovery_kind',${previous?.kind ?? ""},true)`;
  let result: T;
  try {
    result = await work();
  } catch (error) {
    // PostgreSQL may already have aborted the transaction. Preserve the original
    // domain/constraint error instead of replacing it with a failed cleanup read.
    try {
      await restoreSource();
    } catch {
      /* the transaction owner rolls back */
    }
    throw error;
  }
  await restoreSource();
  return result;
}

/** Property-only saves retain their ordinary behavior. The shared period and
 * identity barriers make the status preflight stable across supported writers. */
export async function withParticipantLifecycleCheckpoint<T>(
  tx: TransactionDb,
  input: {
    adapter: "PARTICIPANT_TUTOR" | "PARTICIPANT_TUTEE";
    sourceId: string;
    status: string;
  },
  actor: CheckpointActor,
  work: () => Promise<T>,
): Promise<T> {
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
  const current =
    input.adapter === "PARTICIPANT_TUTOR"
      ? await tx.tutor.findUniqueOrThrow({
          where: { id: input.sourceId },
          select: { status: true },
        })
      : await tx.tutee.findUniqueOrThrow({
          where: { id: input.sourceId },
          select: { status: true },
        });
  return current.status === input.status
    ? work()
    : withAutomaticRecoveryCheckpoint(
        tx,
        { adapter: input.adapter, sourceId: input.sourceId },
        actor,
        work,
      );
}

async function graph(tx: TransactionDb, checkpointId: string) {
  const checkpoint = await tx.recoveryCheckpoint.findUniqueOrThrow({
    where: { id: checkpointId },
    include: { action: true },
  });
  const adapterId = z.enum(checkpointAdapterIds).safeParse(checkpoint.adapter);
  const adapter = adapterId.success ? adapters[adapterId.data] : null;
  const events = await tx.recoveryEvent.findMany({
    where: { actionId: checkpoint.actionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 101,
  });
  const changes = await tx.recoveryChange.findMany({
    where: { actionId: checkpoint.actionId },
    orderBy: { id: "asc" },
    take: 2001,
  });
  const tracked = await tx.recoveryTrackedEntity.findMany({
    where: { actionId: checkpoint.actionId },
    orderBy: [{ entity: "asc" }, { recordId: "asc" }],
    take: 1001,
  });
  const receipt = await tx.recoveryReceipt.findUnique({
    where: { actionId: checkpoint.actionId },
    select: { id: true },
  });
  const context: CheckpointContext = {
    actionId: checkpoint.actionId,
    captureTransactionId: checkpoint.captureTransactionId,
    scope: tracked.map(({ entity, recordId }) => ({ entity, recordId })),
    events,
    changes: changes.map((change) => ({ ...change, id: change.id.toString() })),
  };
  // Immutable stops for invitations that never admitted delivery remain effective;
  // they grant no participation and are never checkpoint compensation targets.
  // Translation terminal receipts preserve deny/replay evidence independently
  // of every checkpoint adapter; only this exact metadata table is exempt.
  const coverage = await tx.$queryRaw<Array<{ tableName: string }>>`
    SELECT tablename AS "tableName" FROM pg_tables p WHERE schemaname='public'
    AND tablename NOT IN ('RecoveryAction','RecoveryCheckpoint','RecoveryEvent','RecoveryTrackedEntity','RecoveryFence','RecoveryChange','RecoveryReceipt','RecoveryDeliveryEffect','RecoveryDeliveryCancellation','RecoveryDeliveryCoverage','RecoveryWorkflowDraft','HistoricalInvitationOperationClosure','TranslationIntentReceipt','_prisma_migrations','AuditLog','Notification','EmailDelivery','EmailOutbox','SignupMailAttempt','UsernameNamespaceGuard','SignupQuota','SignupLease','PublicApplicationRateLimit','CaptchaProof','CaptchaGrant','SchedulingMaintenanceState','SchedulingDirtyEvent')
    AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=format('%I.%I',p.schemaname,p.tablename)::regclass
      AND t.tgname='recovery_change_journal' AND t.tgenabled IN ('O','A') AND t.tgtype=29 AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0 AND NOT t.tgisinternal
      AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgfoid=CASE WHEN p.tablename IN ('RetiredHistoryOwnership','HistoryRowOwnership','PersonHistoryCorrectionReceipt','ParticipantConsolidation','PairingExecutionSuccessor','SessionPlanExecution','SessionParticipantExecution','SessionResponseExecution','QualificationTransferGrant','PersonParticipationTransferReceipt','StudentRequestExecutionAssignment') THEN to_regprocedure('recovery_capture_identity_authority()') WHEN p.tablename='PersonPartitionReceipt' THEN to_regprocedure('recovery_capture_person_partition()') WHEN p.tablename IN ('StudentContinuationReceipt','StudentContinuationAssignment','StudentContinuationPairing','SessionPlanContinuationMember') THEN to_regprocedure('recovery_capture_continuation_change()') ELSE to_regprocedure('recovery_capture_change()') END) ORDER BY tablename`;
  const [replication] = await tx.$queryRaw<
    Array<{ mode: string }>
  >`SELECT current_setting('session_replication_role') AS mode`;
  // Unsupported metadata never reaches a current adapter parser or source read.
  // Future/legacy evidence remains inspectable without pretending its JSON has
  // the current format; the same condition independently blocks application.
  const supportedMetadata =
    adapter !== null &&
    checkpoint.schemaVersion === 1 &&
    checkpoint.adapterVersion === adapter.version &&
    checkpoint.sourceEntity === adapter.sourceEntity &&
    checkpoint.action.kind === "DOMAIN_CHECKPOINT";
  const inspection = supportedMetadata
    ? await adapter.inspect(
        tx,
        checkpoint.sourceId,
        checkpoint.action.before,
        context,
      )
    : {
        current: {},
        blockers: [
          checkpoint.schemaVersion === 0
            ? "The ordinary action repaired unsupported legacy data; its old snapshot cannot be restored."
            : "Unsupported checkpoint format, source or adapter version.",
        ],
        warnings: [],
        effects: [],
        preserved: [],
        compensatedEventIds: [],
      };
  const blockers = [...inspection.blockers];
  const compensatedEventIds =
    inspection.compensatedEventIds ??
    events
      .filter((event) =>
        context.changes.some(
          (change) =>
            change.eventId === event.id && !preservedCheckpointChange(change),
        ),
      )
      .map((event) => event.id);
  const deliveryScope = {
    actionId: checkpoint.actionId,
    eventIds: compensatedEventIds,
  };
  const delivery = await inspectRecoveryDeliveryEffects(tx, deliveryScope);
  blockers.push(...delivery.blockers);
  for (const eventId of compensatedEventIds) {
    const rows = context.changes.filter((change) => change.eventId === eventId);
    if (
      rows.some(preservedCheckpointChange) &&
      rows.some((change) => !preservedCheckpointChange(change)) &&
      delivery.effects.some((effect) => effect.eventId === eventId)
    )
      blockers.push(
        "A logical event mixes preserved facts and compensation with indistinguishable delivery effects.",
      );
  }
  if (events.length > 100 || changes.length > 2000 || tracked.length > 1000)
    blockers.push("Checkpoint dependency limits exceeded.");
  if (replication?.mode !== "origin")
    blockers.push("Recovery requires origin replication mode.");
  if (coverage.length)
    blockers.push(
      `Missing recovery coverage: ${coverage.map((row) => row.tableName).join(", ")}.`,
    );
  const later = events.filter(
    (event) => event.transactionId !== checkpoint.captureTransactionId,
  );
  const fingerprint = recoveryHash({
    adapterVersion: adapter?.version ?? null,
    checkpoint,
    context,
    current: inspection.current,
    coverage,
    replication,
    delivery,
    compensatedEventIds,
  });
  const plan: CheckpointPlan = {
    version: 1,
    checkpointId: checkpoint.id,
    actionId: checkpoint.actionId,
    // Unknown adapter text is metadata only. Browser input never chooses an
    // adapter, and apply's registry lookup refuses this value before domain work.
    adapter: checkpoint.adapter as CheckpointAdapterId,
    sourceEntity: checkpoint.sourceEntity,
    sourceId: checkpoint.sourceId,
    createdAt: checkpoint.createdAt,
    fingerprint,
    coverage: blockers.length ? "UNKNOWN" : "COMPLETE",
    dependentEventCount: later.length,
    websiteEligible: !blockers.length && later.length <= 1 && !receipt,
    blockers: [...new Set(blockers)],
    warnings: inspection.warnings,
    effects: inspection.effects,
    preserved: inspection.preserved,
    chronology: events,
    receiptId: receipt?.id ?? null,
    directRoles: adapter?.directRoles ?? [],
    delivery,
  };
  return { checkpoint, adapter, context, plan, deliveryScope };
}

export async function inspectRecoveryCheckpoint(
  db: DomainDb,
  input: { checkpointId: string },
) {
  const checkpointId = id.parse(input.checkpointId);
  const ownsTransaction = "$transaction" in db && !databaseScope.getStore();
  return inTransaction(
    db,
    async (tx) => {
      if (ownsTransaction)
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return (await graph(tx, checkpointId)).plan;
    },
    { isolationLevel: "RepeatableRead" },
  );
}

async function apply(
  db: DomainDb,
  raw: z.input<typeof restoreCheckpointInput>,
  actor: CheckpointActor,
  channel: "WEBSITE" | "OPERATOR",
) {
  const input = restoreCheckpointInput.parse(raw);
  return inTransaction(
    db,
    async (tx) => {
      const checkpoint = await tx.recoveryCheckpoint.findUniqueOrThrow({
        where: { id: input.checkpointId },
        include: { action: true },
      });
      if (checkpoint.adapter === "ATTENDANCE") await lockAttendanceSchedule(tx);
      await lockEntity(tx, "program:period");
      await lockUsernameNamespace(tx);
      await lockAccountProfile(tx, actor.id);
      const adapter = adapterFor(checkpoint.adapter);
      const principal = await currentActor(
        tx,
        actor.id,
        adapter.directRoles,
        true,
      );
      if (
        checkpoint.schemaVersion !== 1 ||
        checkpoint.adapterVersion !== adapter.version
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Unsupported checkpoint format cannot be restored.",
        });
      await adapter.lock(tx, checkpoint.sourceId, checkpoint.action.before);
      // Prelock known overlap in one order. Newly discovered roots remain fenced by
      // triggers; a dynamic lock-set deadlock aborts the whole intent, never coverage.
      const currentScope = await tx.recoveryTrackedEntity.findMany({
        where: { actionId: checkpoint.actionId },
        select: { entity: true, recordId: true },
        take: 1001,
      });
      if (currentScope.length > 1000)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Checkpoint dependency limits exceeded.",
        });
      const scope = orderedScope([
        ...scopeSchema.parse(checkpoint.scope),
        ...currentScope,
      ]);
      const roots = await tx.recoveryTrackedEntity.findMany({
        where: {
          OR: scope.map((entry) => ({
            entity: entry.entity,
            recordId: entry.recordId,
          })),
        },
        select: { actionId: true },
        distinct: ["actionId"],
        take: 101,
      });
      if (roots.length > 100)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Checkpoint overlap limits exceeded.",
        });
      const lockedRoots = new Set([
        checkpoint.actionId,
        ...roots.map((row) => row.actionId),
        ...(await recoveryDeliveryRootIds(tx, checkpoint.actionId)),
      ]);
      if (lockedRoots.size > 100)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Checkpoint overlap limits exceeded.",
        });
      for (const rootId of [...lockedRoots].sort())
        await lockEntity(tx, `recovery:${rootId}`);
      await tx.$executeRaw`INSERT INTO "RecoveryFence"("actionId",revision) VALUES(${checkpoint.actionId},1) ON CONFLICT ("actionId") DO UPDATE SET revision="RecoveryFence".revision+1`;
      const inputHash = recoveryHash(input);
      const previous = await tx.recoveryReceipt.findUnique({
        where: {
          actorId_clientKey: { actorId: actor.id, clientKey: input.clientKey },
        },
      });
      if (previous) {
        if (previous.inputHash !== inputHash)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This retry key belongs to another recovery intent.",
          });
        return {
          checkpointId: input.checkpointId,
          actionId: previous.actionId,
          receiptId: previous.id,
          replayed: true,
        };
      }
      const reviewed = await graph(tx, input.checkpointId);
      if (reviewed.plan.receiptId)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This checkpoint was already restored. Read its immutable receipt.",
        });
      if (reviewed.plan.fingerprint !== input.expectedFingerprint)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Checkpoint consequences changed. Inspect and review them again.",
        });
      if (reviewed.plan.coverage !== "COMPLETE")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: reviewed.plan.blockers.join(" "),
        });
      if (channel === "WEBSITE" && reviewed.plan.dependentEventCount > 1)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Two or more dependent events require the operator CLI.",
        });
      const [settings] = await tx.$queryRaw<
        Array<{ compensating: string | null }>
      >`SELECT current_setting('shbs.recovery_compensating',true) AS compensating`;
      if (settings?.compensating)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Nested recovery compensation is unsupported.",
        });
      await tx.$queryRaw`SELECT set_config('shbs.recovery_compensating',${checkpoint.actionId},true)`;
      const deliveries = await cancelRecoveryDeliveryEffects(
        tx,
        reviewed.deliveryScope,
        input.clientKey,
      );
      const result = await auditActorScope.run(
        { id: principal.id, name: principal.name, role: principal.role },
        () =>
          adapter.apply(
            tx,
            checkpoint.sourceId,
            checkpoint.action.before,
            { id: principal.id, name: principal.name },
            input.reason,
            reviewed.context,
          ),
      );
      await tx.$queryRaw`SELECT set_config('shbs.recovery_compensating','',true)`;
      const receipt = await tx.recoveryReceipt.create({
        data: {
          actionId: checkpoint.actionId,
          actorId: actor.id,
          clientKey: input.clientKey,
          inputHash,
          reason: input.reason,
          channel,
          fingerprint: reviewed.plan.fingerprint,
          evidence: recoveryJson({
            version: 1,
            checkpointId: checkpoint.id,
            adapter: adapter.id,
            adapterVersion: adapter.version,
            effects: reviewed.plan.effects,
            preserved: reviewed.plan.preserved,
            deliveries,
            result,
          }),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: principal.id,
          userName: principal.name,
          kind: "REVERSAL",
          operation: "recovery.restoreCheckpoint",
          entity: adapter.sourceEntity,
          entityId: checkpoint.sourceId,
          action: `Restored reviewed ${adapter.id} checkpoint: ${input.reason}`,
          details: { checkpointId: checkpoint.id, receiptId: receipt.id },
        },
      });
      return {
        checkpointId: checkpoint.id,
        actionId: checkpoint.actionId,
        receiptId: receipt.id,
        replayed: false,
      };
    },
    { isolationLevel: "Serializable" },
  );
}
export const applyRecoveryCheckpoint = (
  db: DomainDb,
  input: z.input<typeof restoreCheckpointInput>,
  actor: CheckpointActor,
) => apply(db, input, actor, "WEBSITE");
export const applyRecoveryCheckpointFromOperator = (
  db: DomainDb,
  input: z.input<typeof restoreCheckpointInput>,
  actor: CheckpointActor,
) => apply(db, input, actor, "OPERATOR");
