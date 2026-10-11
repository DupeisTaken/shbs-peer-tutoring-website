import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { recordAudit } from "~/server/audit/log";
import { staleConflict } from "~/server/concurrency";
import { lockUsernameNamespace } from "~/server/auth/username";
import { isSerializationFailure } from "~/server/auth/username-snapshot";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";

/** Reasons are required even when clearing a flag, so both directions remain explainable. */
export const requestInvalidityInput = z.object({
  id: z.string().min(1).max(128),
  invalid: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
  expectedInvalidityVersion: z.number().int().nonnegative(),
});
type Input = z.infer<typeof requestInvalidityInput>;
type Actor = { id: string; name?: string | null };
async function canonicalActor(tx: TransactionDb, actor: Actor): Promise<Actor> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { name: true, username: true },
  });
  return { id: actor.id, name: user.name ?? user.username ?? actor.id };
}
export const emptyRequestInvalidity = {
  isInvalid: false,
  invalidReason: null,
  invalidatedAt: null,
  invalidatedById: null,
  invalidatedByName: null,
  invalidityVersion: 0,
};
type Invalidity = {
  invalidReason: string | null;
  invalidatedAt: Date | null;
  invalidatedById: string | null;
  invalidatedByName: string | null;
  invalidityVersion: number;
};

/** Return review text only to authorized staff; a badge alone is safe for read-only lists. */
export function requestInvalidity(row: Invalidity, privateDetails = true) {
  return {
    isInvalid: !!row.invalidatedAt,
    invalidReason: privateDetails ? row.invalidReason : null,
    invalidatedAt: privateDetails ? row.invalidatedAt : null,
    invalidatedById: privateDetails ? row.invalidatedById : null,
    invalidatedByName: privateDetails ? row.invalidatedByName : null,
    invalidityVersion: privateDetails ? row.invalidityVersion : 0,
  };
}

export function assertRequestProcessable(row: { invalidatedAt: Date | null }) {
  if (row.invalidatedAt)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This request is flagged as invalid. Clear its flag before processing it.",
    });
}

/** Advisory locks order requests, but cannot refresh an existing Serializable snapshot.
 * Locking the source row afterwards makes PostgreSQL reject stale approval/processing
 * snapshots when a flag committed while the caller waited. Keep the lock through writes. */
async function lockCurrentReviewRow(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    if (isSerializationFailure(error)) staleConflict();
    throw error;
  }
}

export async function lockApplicationReview(tx: TransactionDb, id: string) {
  await lockEntity(tx, `interview:${id}`);
  await lockCurrentReviewRow(
    () =>
      tx.$queryRaw`SELECT id FROM "TutorApplication" WHERE id = ${id} FOR UPDATE`,
  );
}

export async function lockStudentRequestReview(
  tx: TransactionDb,
  row: { id: string; email: string },
) {
  await lockEntity(tx, `student-survey:${row.email}`);
  await lockCurrentReviewRow(
    () =>
      tx.$queryRaw`SELECT id FROM "StudentSurvey" WHERE id = ${row.id} FOR UPDATE`,
  );
}

export async function lockLegacySignupReview(tx: TransactionDb, id: string) {
  await lockEntity(tx, `tutee:${id}`);
  await lockCurrentReviewRow(
    () => tx.$queryRaw`SELECT id FROM "Tutee" WHERE id = ${id} FOR UPDATE`,
  );
}

/** Deletion is not a way around a flagged public request's retained review evidence. */
export async function assertTuteeInvalidityCleared(
  tx: TransactionDb,
  tuteeId: string,
) {
  const survey = await tx.studentSurvey.findUnique({
    where: { tuteeId },
    select: { id: true, email: true },
  });
  if (survey) {
    await lockStudentRequestReview(tx, survey);
    assertRequestProcessable(
      await tx.studentSurvey.findUniqueOrThrow({ where: { id: survey.id } }),
    );
  } else {
    await lockLegacySignupReview(tx, tuteeId);
    const review = await tx.tuteeRequestInvalidity.findUnique({
      where: { tuteeId },
    });
    if (review) assertRequestProcessable(review);
  }
}

function nextInvalidity(input: Input, actor: Actor): Invalidity {
  return {
    invalidReason: input.invalid ? input.reason : null,
    invalidatedAt: input.invalid ? new Date() : null,
    invalidatedById: input.invalid ? actor.id : null,
    invalidatedByName: input.invalid ? (actor.name ?? null) : null,
    invalidityVersion: input.expectedInvalidityVersion + 1,
  };
}

async function recordChange(
  tx: Parameters<typeof recordAudit>[1],
  entity: string,
  operation: string,
  input: Input,
  actor: Actor,
  before: Invalidity,
  after: Invalidity,
) {
  await recordAudit(
    {
      userId: actor.id,
      userName: actor.name,
      action: input.invalid
        ? "Flagged public request as invalid"
        : "Cleared public request invalid flag",
      entity,
      entityId: input.id,
      operation,
      reason: input.reason,
      before,
      after,
    },
    tx,
  );
}

/** Share the interview lock with every processing write; flags never reconcile a grant. */
export async function setApplicationInvalidity(
  db: DomainDb,
  input: Input,
  actor: Actor,
) {
  return inTransaction(db, async (tx) => {
    // Invitations already own the credential namespace before inspecting their source.
    await lockUsernameNamespace(tx);
    await lockApplicationReview(tx, input.id);
    const row = await tx.tutorApplication.findUnique({
      where: { id: input.id },
    });
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (row.type !== "INITIAL")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only public tutor applications can be flagged here.",
      });
    if (row.invalidityVersion !== input.expectedInvalidityVersion)
      staleConflict();
    const author = await canonicalActor(tx, actor);
    const after = nextInvalidity(input, author);
    await tx.tutorApplication.update({ where: { id: row.id }, data: after });
    await recordChange(
      tx,
      "TutorApplication",
      "admin.setApplicationInvalidity",
      input,
      author,
      row,
      after,
    );
    return { ok: true, invalidityVersion: after.invalidityVersion };
  });
}

/** Lifecycle state and original submission time remain unchanged in either direction. */
export async function setStudentRequestInvalidity(
  db: DomainDb,
  input: Input,
  actor: Actor,
) {
  return inTransaction(db, async (tx) => {
    const initial = await tx.studentSurvey.findUnique({
      where: { id: input.id },
    });
    if (!initial) throw new TRPCError({ code: "NOT_FOUND" });
    await lockStudentRequestReview(tx, initial);
    const row = await tx.studentSurvey.findUniqueOrThrow({
      where: { id: input.id },
    });
    if (input.invalid && row.state !== "OPEN")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Only open signup requests can be flagged.",
      });
    if (row.invalidityVersion !== input.expectedInvalidityVersion)
      staleConflict();
    const author = await canonicalActor(tx, actor);
    const after = nextInvalidity(input, author);
    await tx.studentSurvey.update({ where: { id: row.id }, data: after });
    await recordChange(
      tx,
      "StudentSurvey",
      "studentWorkflow.setRequestInvalidity",
      input,
      author,
      row,
      after,
    );
    return { ok: true, invalidityVersion: after.invalidityVersion };
  });
}

/** Legacy public entries use their own review record, never fabricated survey evidence. */
export async function setSignupInvalidity(
  db: DomainDb,
  input: Input,
  actor: Actor,
) {
  return inTransaction(db, async (tx) => {
    await lockLegacySignupReview(tx, input.id);
    const row = await tx.tutee.findUnique({ where: { id: input.id } });
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (
      row.signupSource !== "SELF_SERVICE" ||
      (await tx.studentSurvey.count({ where: { tuteeId: input.id } }))
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Use the original public signup request's review controls.",
      });
    if (input.invalid && row.status === "INACTIVE")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Only current signup requests can be flagged.",
      });
    const before =
      (await tx.tuteeRequestInvalidity.findUnique({
        where: { tuteeId: row.id },
      })) ?? emptyRequestInvalidity;
    if (before.invalidityVersion !== input.expectedInvalidityVersion)
      staleConflict();
    const author = await canonicalActor(tx, actor);
    const after = nextInvalidity(input, author);
    await tx.tuteeRequestInvalidity.upsert({
      where: { tuteeId: row.id },
      create: { tuteeId: row.id, ...after },
      update: after,
    });
    // The first companion insert has no prior row to lock. Touch the owning roster
    // version so stale snapshots and existing assignment drafts observe that review.
    await tx.tutee.update({
      where: { id: row.id },
      data: { updatedAt: new Date() },
    });
    await recordChange(
      tx,
      "TuteeRequestInvalidity",
      "admin.setSignupInvalidity",
      input,
      author,
      before,
      after,
    );
    return { ok: true, invalidityVersion: after.invalidityVersion };
  });
}
