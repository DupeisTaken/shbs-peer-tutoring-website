import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { recordAudit } from "~/server/audit/log";
import { staleConflict } from "~/server/concurrency";
import { lockUsernameNamespace } from "~/server/auth/username";
import { queueRequestNotice } from "~/server/email/request-notice";
import {
  enqueueSignupNotice,
  deliverSignupNotice,
} from "./student-signup-appeals";
import { databaseScope } from "./db-scope";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";

import { emptyRequestInvalidity, type requestInvalidityInput, lockApplicationReview, lockStudentRequestReview, lockLegacySignupReview, type Invalidity } from "./request-review";
export { requestInvalidityInput, emptyRequestInvalidity, requestInvalidity, assertRequestProcessable, lockApplicationReview, lockStudentRequestReview, lockLegacySignupReview, assertTuteeInvalidityCleared } from "./request-review";

type Input = z.infer<typeof requestInvalidityInput>;
type Actor = { id: string; name?: string | null };
async function canonicalActor(tx: TransactionDb, actor: Actor): Promise<Actor> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { name: true, username: true },
  });
  return { id: actor.id, name: user.name ?? user.username ?? actor.id };
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
    // Only applied state transitions create email receipts; re-reading the same
    // flag is not a new notification or a way to replace its immutable reason.
    if (!!row.invalidatedAt === input.invalid)
      return { ok: true, invalidityVersion: row.invalidityVersion };
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
    await queueRequestNotice(tx, {
      kind: "application",
      id: row.id,
      version: after.invalidityVersion,
      invalid: input.invalid,
      reason: input.reason,
      actorId: author.id,
      recipient: row.email,
      submittedAt: row.createdAt,
    });
    return { ok: true, invalidityVersion: after.invalidityVersion };
  });
}

/** Lifecycle state and original submission time remain unchanged in either direction. */
export async function setStudentRequestInvalidity(
  db: DomainDb,
  input: Input,
  actor: Actor,
) {
  const result = await inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
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
    if (!!row.invalidatedAt === input.invalid)
      return { ok: true, invalidityVersion: row.invalidityVersion };
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
    const saved = await tx.studentSurvey.findUniqueOrThrow({
      where: { id: row.id },
    });
    const noticeId = input.invalid
      ? await enqueueSignupNotice(tx, saved, "INVALID_FLAGGED")
      : null;

    await queueRequestNotice(tx, {
      kind: "survey",
      id: row.id,
      version: after.invalidityVersion,
      invalid: input.invalid,
      reason: input.reason,
      actorId: author.id,
      recipient: row.email,
      submittedAt: row.submittedAt,
    });

    return { ok: true, invalidityVersion: after.invalidityVersion, noticeId };
  });
  if (result.noticeId && !databaseScope.getStore())
    await deliverSignupNotice(db, result.noticeId);
  return { ok: true, invalidityVersion: result.invalidityVersion };
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
    if (!!before.invalidatedAt === input.invalid)
      return { ok: true, invalidityVersion: before.invalidityVersion };
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
    await queueRequestNotice(tx, {
      kind: "signup",
      id: row.id,
      version: after.invalidityVersion,
      invalid: input.invalid,
      reason: input.reason,
      actorId: author.id,
      recipient: row.email,
      submittedAt: row.signupSubmittedAt,
    });
    return { ok: true, invalidityVersion: after.invalidityVersion };
  });
}
