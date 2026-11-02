import { TRPCError } from "@trpc/server";
import { z } from "zod";
import superjson from "superjson";
import type {
  Prisma,
  ScheduledProgramRefresh,
} from "../../../generated/prisma";
import { nextRecruitmentRefreshEvidenceSchema } from "~/lib/next-recruitment";
import { notificationEvent } from "~/lib/notification-events";
import { recordAudit } from "~/server/audit/log";
import { recordDomainAudit } from "~/server/audit/evidence";
import { lockUsernameNamespace } from "~/server/auth/username";
import { isSerializationFailure } from "~/server/auth/username-snapshot";
import { notifyAdmins } from "~/server/notifications/create";
import {
  inTransaction,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import {
  assertNextRecruitmentActor,
  lockNextRecruitment,
  validateNextRecruitmentRefresh,
} from "./next-recruitment";
import { applyProgramRefresh, refreshProgramInput } from "./refresh";

export const scheduleRefreshInput = refreshProgramInput.extend({
  executeAt: z.date(),
  expectedScheduleVersion: z.number().int().nonnegative(),
});
export const cancelRefreshInput = z.object({
  id: z.string().min(1),
  expectedVersion: z.number().int().positive(),
});
type ScheduleInput = z.infer<typeof scheduleRefreshInput>;
type CancelInput = z.infer<typeof cancelRefreshInput>;
type Actor = { id: string; name?: string | null };

async function databaseNow(tx: TransactionDb) {
  // clock_timestamp, unlike transaction CURRENT_TIMESTAMP, advances while a lock waits.
  const [row] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS "now"`;
  return row!.now;
}
function changed(): never {
  throw new TRPCError({
    code: "CONFLICT",
    message: "SCHEDULED_REFRESH_CHANGED",
  });
}
function publicRow(row: ScheduledProgramRefresh) {
  return {
    id: row.id,
    version: row.version,
    state: row.state,
    executeAt: row.executeAt,
    sourceTermId: row.sourceTermId,
    sourceSchoolYear: row.sourceSchoolYear,
    sourceQuarter: row.sourceQuarter,
    destinationSchoolYear: row.destinationSchoolYear,
    destinationQuarter: row.destinationQuarter,
    semesterMode: row.semesterMode,
    timeZone: row.timeZone,
    blockedReason: row.blockedReason,
    completedAt: row.completedAt,
    attempts: row.attempts,
  };
}
function evidence(row: ScheduledProgramRefresh) {
  return nextRecruitmentRefreshEvidenceSchema.parse(
    superjson.deserialize(
      row.expectedPreparation as unknown as Parameters<
        typeof superjson.deserialize
      >[0],
    ),
  );
}

/** A deterministic invalid review may be blocked; infrastructure/serialization errors
 * must roll back and remain retryable rather than being mislabeled as a policy decision. */
function blockingReason(error: unknown): string | null {
  if (!(error instanceof TRPCError) || isSerializationFailure(error.cause))
    return null;
  if (error.code === "FORBIDDEN") return "SCHEDULED_REFRESH_HEAD_CHANGED";
  if (["CONFLICT", "PRECONDITION_FAILED", "BAD_REQUEST"].includes(error.code))
    return "SCHEDULED_REFRESH_REVIEW_CHANGED";
  return null;
}

async function validateAuthorization(
  tx: TransactionDb,
  row: ScheduledProgramRefresh,
) {
  const expected = evidence(row);
  // Row identity is duplicated for bounded public reads; never trust it independently
  // of the immutable private authorization when admitting the destructive execution.
  if (
    expected.target.sourceTermId !== row.sourceTermId ||
    expected.target.destinationSchoolYear !== row.destinationSchoolYear ||
    expected.target.destinationQuarter !== row.destinationQuarter
  )
    changed();
  await validateNextRecruitmentRefresh(tx, expected);
  const head = await assertNextRecruitmentActor(tx, row.authorizedById);
  if (head.refreshAuthorityRevision !== row.authorityRevision)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "SCHEDULED_REFRESH_HEAD_CHANGED",
    });
  return expected;
}

export async function validateScheduleRefresh(
  tx: TransactionDb,
  input: ScheduleInput,
) {
  const snapshot = await validateNextRecruitmentRefresh(
    tx,
    input.expectedPreparation,
  );
  if (snapshot.target.sourceTermId !== input.expectedTermId) changed();
  const row = await tx.scheduledProgramRefresh.findUnique({
    where: { sourceTermId: input.expectedTermId },
  });
  if (
    (row?.version ?? 0) !== input.expectedScheduleVersion ||
    row?.state === "COMPLETED"
  )
    changed();
  const now = await databaseNow(tx);
  if (input.executeAt <= now)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "SCHEDULED_REFRESH_TIME_INVALID",
    });
  const opening = snapshot.preparations.tutee
    ? snapshot.preparations.tutee.opensAt
    : snapshot.refreshEvidence.destination?.tutee.opensAt;
  if (opening && opening > now && input.executeAt > opening)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "SCHEDULED_REFRESH_AFTER_OPENING",
    });
  return { snapshot, row };
}

export async function validateCancelRefresh(
  tx: TransactionDb,
  input: CancelInput,
) {
  await lockNextRecruitment(tx);
  const row = await tx.scheduledProgramRefresh.findUnique({
    where: { id: input.id },
  });
  if (
    row?.version !== input.expectedVersion ||
    !["SCHEDULED", "BLOCKED", "FAILED"].includes(row.state)
  )
    changed();
  return row;
}

export async function scheduleProgramRefresh(
  db: DomainDb,
  input: ScheduleInput,
  actor: Actor,
) {
  return inTransaction(db, async (tx) => {
    const { snapshot, row: previous } = await validateScheduleRefresh(
      tx,
      input,
    );
    const head = await assertNextRecruitmentActor(tx, actor.id);
    const { target } = snapshot;
    const data = {
      sourceSchoolYear: target.sourceSchoolYear,
      sourceQuarter: target.sourceQuarter,
      destinationSchoolYear: target.destinationSchoolYear,
      destinationQuarter: target.destinationQuarter,
      semesterMode: target.semesterMode,
      executeAt: input.executeAt,
      timeZone: snapshot.timeZone,
      state: "SCHEDULED" as const,
      blockedReason: null,
      completedAt: null,
      attempts: 0,
      authorizedById: head.id,
      authorizedByName: head.name ?? head.username ?? actor.name,
      authorityRevision: head.refreshAuthorityRevision,
      expectedPreparation: superjson.serialize(
        snapshot.refreshEvidence,
      ) as unknown as Prisma.InputJsonValue,
    };
    const row = await tx.scheduledProgramRefresh.upsert({
      where: { sourceTermId: input.expectedTermId },
      create: { sourceTermId: input.expectedTermId, ...data },
      update: { ...data, version: { increment: 1 } },
    });
    await recordAudit(
      {
        userId: head.id,
        userName: data.authorizedByName,
        operation: "admin.scheduleRefresh",
        entity: "ScheduledProgramRefresh",
        entityId: row.id,
        action: `Scheduled program refresh to ${snapshot.nextName}`,
        effects: JSON.parse(
          JSON.stringify({ before: previous, after: row }),
        ) as Prisma.InputJsonValue,
      },
      tx,
    );
    return publicRow(row);
  });
}

export async function cancelProgramRefresh(
  db: DomainDb,
  input: CancelInput,
  actor: Actor,
) {
  return inTransaction(db, async (tx) => {
    const previous = await validateCancelRefresh(tx, input);
    const head = await assertNextRecruitmentActor(tx, actor.id);
    const row = await tx.scheduledProgramRefresh.update({
      where: { id: previous.id },
      data: {
        state: "CANCELLED",
        version: { increment: 1 },
        blockedReason: null,
      },
    });
    await recordAudit(
      {
        userId: head.id,
        userName: head.name ?? actor.name,
        operation: "admin.cancelRefresh",
        entity: "ScheduledProgramRefresh",
        entityId: row.id,
        action: "Cancelled scheduled program refresh",
        effects: JSON.parse(
          JSON.stringify({
            before: publicRow(previous),
            after: publicRow(row),
          }),
        ) as Prisma.InputJsonValue,
      },
      tx,
    );
    return publicRow(row);
  });
}

async function projectedRow(tx: TransactionDb, row: ScheduledProgramRefresh) {
  const projected = publicRow(row);
  if (row.state !== "SCHEDULED") return projected;
  try {
    await validateAuthorization(tx, row);
  } catch (error) {
    const reason = blockingReason(error);
    if (!reason) throw error;
    return { ...projected, state: "BLOCKED" as const, blockedReason: reason };
  }
  return projected;
}

/** Reads never mutate a schedule. A stale authorization is presented as blocked
 * immediately, including before its due time or the worker's next sweep. */
export async function readRefreshSchedule(db: DomainDb, id?: string) {
  return inTransaction(db, async (tx) => {
    await lockNextRecruitment(tx);
    const active = await tx.term.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const row = id
      ? await tx.scheduledProgramRefresh.findUnique({ where: { id } })
      : active
        ? await tx.scheduledProgramRefresh.findUnique({
            where: { sourceTermId: active.id },
          })
        : null;
    return {
      schedule: row ? await projectedRow(tx, row) : null,
      activeSourceTermId: active?.id ?? null,
      serverNow: await databaseNow(tx),
    };
  });
}

/** Public consumers receive only period/time/state. Private evidence and identities
 * remain on the server; a pending Admin proposal never creates an approved schedule. */
export async function readPublicRefreshSchedule(
  db: DomainDb,
  sourceTermId: string,
) {
  return inTransaction(db, async (tx) => {
    await lockNextRecruitment(tx);
    const row = await tx.scheduledProgramRefresh.findUnique({
      where: { sourceTermId },
    });
    if (!row) return null;
    const value = await projectedRow(tx, row);
    return {
      sourceTermId: value.sourceTermId,
      sourceSchoolYear: value.sourceSchoolYear,
      sourceQuarter: value.sourceQuarter,
      destinationSchoolYear: value.destinationSchoolYear,
      destinationQuarter: value.destinationQuarter,
      semesterMode: value.semesterMode,
      executeAt: value.executeAt,
      timeZone: value.timeZone,
      state: value.state,
      valid: value.state === "SCHEDULED",
    };
  });
}

async function terminalNotice(tx: TransactionDb, row: ScheduledProgramRefresh) {
  // This call shares the terminal state transaction. Only SCHEDULED can enter it,
  // so repeated ticks, lost responses and other instances cannot duplicate notices.
  await notifyAdmins(
    {
      title:
        row.state === "COMPLETED"
          ? "Scheduled program refresh completed"
          : "Scheduled program refresh needs review",
      body: `${row.destinationSchoolYear} ${row.destinationQuarter}`,
      link: "/admin/program?panel=period",
      ...notificationEvent(
        row.state === "COMPLETED"
          ? "scheduled_refresh_completed"
          : "scheduled_refresh_blocked",
      ),
    },
    undefined,
    tx,
  );
}

/** Catch up after downtime using authoritative database time. The period barrier
 * serializes execution with manual refresh, rescheduling and cancellation. */
export async function processScheduledRefresh(db: DomainDb, id: string) {
  return inTransaction(db, async (tx) => {
    await lockNextRecruitment(tx);
    const row = await tx.scheduledProgramRefresh.findUnique({ where: { id } });
    if (row?.state !== "SCHEDULED") return null;
    const now = await databaseNow(tx);
    if (row.executeAt > now) return null;
    // Preserve period -> namespace -> actor ordering before any authority row lock.
    await lockUsernameNamespace(tx);
    let expected;
    try {
      expected = await validateAuthorization(tx, row);
    } catch (error) {
      const reason = blockingReason(error);
      if (!reason) throw error;
      const blocked = await tx.scheduledProgramRefresh.update({
        where: { id },
        data: {
          state: "BLOCKED",
          blockedReason: reason,
          version: { increment: 1 },
        },
      });
      await recordDomainAudit(tx, {
        system: true,
        operation: "program.scheduledRefreshBlocked",
        entity: "ScheduledProgramRefresh",
        entityId: id,
        action: "Scheduled program refresh requires renewed Head review",
        effects: {
          reason,
          authorizedById: row.authorizedById,
          version: row.version,
        },
      });
      await terminalNotice(tx, blocked);
      return publicRow(blocked);
    }
    const result = await applyProgramRefresh(
      tx,
      {
        confirm: "REFRESH",
        expectedTermId: row.sourceTermId,
        expectedPreparation: expected,
      },
      { id: row.authorizedById, name: row.authorizedByName },
    );
    const completed = await tx.scheduledProgramRefresh.update({
      where: { id },
      data: {
        state: "COMPLETED",
        completedAt: await databaseNow(tx),
        blockedReason: null,
        version: { increment: 1 },
      },
    });
    await recordDomainAudit(tx, {
      system: true,
      operation: "program.scheduledRefreshCompleted",
      entity: "ScheduledProgramRefresh",
      entityId: id,
      action: "Executed approved scheduled program refresh",
      effects: JSON.parse(
        JSON.stringify({
          authorizedById: row.authorizedById,
          scheduledAt: row.executeAt,
          authorizationVersion: row.version,
          result,
        }),
      ) as Prisma.InputJsonValue,
    });
    await terminalNotice(tx, completed);
    return publicRow(completed);
  });
}

export async function processDueScheduledRefreshes(db: DomainDb) {
  const due = await db.$queryRaw<{ id: string; version: number }[]>`
    SELECT "id", "version" FROM "ScheduledProgramRefresh"
    WHERE "state" = 'SCHEDULED' AND "executeAt" <= clock_timestamp()
    ORDER BY "executeAt", "id" LIMIT 10`;
  const results = [];
  for (const row of due) {
    try {
      results.push(await processScheduledRefresh(db, row.id));
    } catch {
      // Failed activation rolled back completely. Record only a safe retry count in
      // a new transaction, and never overwrite a concurrent edit or successful run.
      results.push(
        await recordScheduledRefreshFailure(db, row.id, row.version),
      );
    }
  }
  return results;
}

export async function recordScheduledRefreshFailure(
  db: DomainDb,
  id: string,
  expectedVersion: number,
) {
  return inTransaction(db, async (tx) => {
    await lockNextRecruitment(tx);
    const previous = await tx.scheduledProgramRefresh.findUnique({
      where: { id },
    });
    if (previous?.state !== "SCHEDULED" || previous.version !== expectedVersion)
      return null;
    const attempts = previous.attempts + 1;
    const failed = attempts >= 5;
    const row = await tx.scheduledProgramRefresh.update({
      where: { id },
      data: {
        attempts,
        version: { increment: 1 },
        state: failed ? "FAILED" : "SCHEDULED",
        blockedReason: "SCHEDULED_REFRESH_EXECUTION_FAILED",
      },
    });
    await recordDomainAudit(tx, {
      system: true,
      operation: "program.scheduledRefreshAttemptFailed",
      entity: "ScheduledProgramRefresh",
      entityId: id,
      action: failed
        ? "Scheduled program refresh stopped after repeated failures"
        : "Scheduled program refresh will retry",
      effects: { attempts, retrying: !failed },
    });
    if (failed) await terminalNotice(tx, row);
    return publicRow(row);
  });
}
