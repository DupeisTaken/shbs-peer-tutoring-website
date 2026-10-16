import { createHash, createHmac } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type {
  StudentSurvey,
  StudentSignupNotice,
} from "../../generated/prisma";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import { databaseScope, deferUntilCommit } from "./db-scope";
import { db as sharedDb } from "./db";
import { lockUsernameNamespace } from "./auth/username";
import { lockCatalogue } from "./qualifications";
import { lockStudentRequestReview } from "./request-invalidity";
import { assertSignupEditPeriod } from "./student-signup-editor";
import { ownedStudentIds } from "./student-ownership";
import { consumeStudentAction } from "./student-workflow";
import { closeStudentRequest } from "./student-request-state";
import { studentSignupIntentDigest } from "./student-signup-answers";
import { recordDomainAudit } from "./audit/evidence";
import { emailSender } from "./email/sender";
import { emailOrigin } from "./email/urls";
import { env } from "~/env";
import { queueRequestNotice } from "./email/request-notice";

const id = z.string().min(1).max(128);
const key = z.string().uuid();
const reason = z.string().trim().min(1).max(2000);
export const signupAppealTokenInput = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const signupAppealInput = signupAppealTokenInput.extend({
  reason,
  clientKey: key,
});
export const ownedSignupAppealInput = z
  .object({
    id,
    expectedInvalidityVersion: z.number().int().nonnegative(),
    reason,
    clientKey: key,
  })
  .strict();
export const resolveSignupAppealInput = z
  .object({
    id,
    approve: z.boolean(),
    expectedInvalidityVersion: z.number().int().nonnegative(),
    clientKey: key,
    signedTicket: id,
  })
  .strict();
const invalid = () =>
  new TRPCError({ code: "BAD_REQUEST", message: "INVITATION_INVALID" });
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Resolve delivery from explicit retained ownership. Original submitted email remains
 * evidence; after alias removal it must never become a new person's access capability. */
async function deliveryOwner(tx: DomainDb, row: StudentSurvey) {
  const retained = row.tuteeId
    ? await tx.studentProfileOwnership.findUnique({
        where: { tuteeId: row.tuteeId },
      })
    : null;
  const owner = retained
    ? await tx.user.findUnique({ where: { id: retained.userId } })
    : row.tuteeId
      ? await tx.user.findFirst({
          where: { studentId: row.tuteeId, mergedIntoId: null },
        })
      : null;
  if (owner) {
    if (owner.suspendedAt || owner.mergedIntoId) return null;
    const secondary = owner.emailVerifiedAt
      ? null
      : await tx.accountEmail.findFirst({
          where: { userId: owner.id, verifiedAt: { not: null } },
          orderBy: { createdAt: "asc" },
        });
    const email = owner.emailVerifiedAt ? owner.email : secondary?.email;
    return email
      ? { email, accountId: owner.id, sessionVersion: owner.sessionVersion }
      : null;
  }
  if (row.confirmedAt) return null;
  const candidate = await tx.user.findFirst({
    where: {
      OR: [
        { email: row.email },
        { emails: { some: { email: row.email, verifiedAt: { not: null } } } },
      ],
    },
  });
  const payload = row.payload as Record<string, unknown>;
  // Unverified intake has no owner. Decline a mailbox which has since been transferred.
  if (payload.academicAccountId && candidate?.id !== payload.academicAccountId)
    return null;
  return {
    email: row.email,
    accountId: candidate?.id ?? null,
    sessionVersion: candidate?.sessionVersion ?? null,
  };
}
function noticeToken(
  notice: Pick<
    StudentSignupNotice,
    | "id"
    | "surveyId"
    | "invalidityVersion"
    | "recipientEmail"
    | "accountId"
    | "sessionVersion"
  >,
) {
  if (!env.AUTH_SECRET)
    throw new Error("Configure AUTH_SECRET for signup appeal proofs.");
  return createHmac("sha256", env.AUTH_SECRET)
    .update(
      studentSignupIntentDigest({
        purpose: "signup-invalid-appeal",
        id: notice.id,
        surveyId: notice.surveyId,
        invalidityVersion: notice.invalidityVersion,
        recipientEmail: notice.recipientEmail,
        accountId: notice.accountId,
        sessionVersion: notice.sessionVersion,
      }),
    )
    .digest("hex");
}
async function lockedSource(tx: TransactionDb, sourceId: string) {
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
  await lockCatalogue(tx);
  const initial = await tx.studentSurvey.findUnique({
    where: { id: sourceId },
  });
  if (!initial) throw invalid();
  await lockStudentRequestReview(tx, initial);
  return tx.studentSurvey.findUniqueOrThrow({ where: { id: sourceId } });
}

/** Durable source-specific outbox, also used inside Coordinator approval transactions.
 * SMTP runs only after commit. Failed delivery never asks callers to repeat the flag. */
export async function enqueueSignupNotice(
  tx: TransactionDb,
  row: StudentSurvey,
  kind: "INVALID_FLAGGED" | "APPEAL_ACCEPTED" | "APPEAL_REJECTED",
) {
  const recipient = await deliveryOwner(tx, row);
  const notice = await tx.studentSignupNotice.upsert({
    where: {
      surveyId_invalidityVersion_kind: {
        surveyId: row.id,
        invalidityVersion: row.invalidityVersion,
        kind,
      },
    },
    update: {},
    create: {
      surveyId: row.id,
      invalidityVersion: row.invalidityVersion,
      kind,
      recipientEmail: recipient?.email,
      accountId: recipient?.accountId,
      sessionVersion: recipient?.sessionVersion,
      state: recipient ? "PENDING" : "BLOCKED",
    },
  });
  if (recipient && !notice.tokenHash)
    await tx.studentSignupNotice.update({
      where: { id: notice.id },
      data: { tokenHash: digest(noticeToken(notice)) },
    });
  // Flag dispatch delegates to the shared request-service transport exclusively.
  deferUntilCommit(() =>
    databaseScope.exit(() =>
      deliverSignupNotice(sharedDb, notice.id).then(() => undefined),
    ),
  );
  return notice.id;
}

export async function deliverSignupNotice(db: DomainDb, noticeId: string) {
  if (databaseScope.getStore())
    throw new Error("Signup notices require a committed transaction.");
  const capability = await db.studentSignupNotice.findUnique({
    where: { id: noticeId },
  });
  if (capability?.kind === "INVALID_FLAGGED") {
    const where = {
      requestKind_requestId_requestVersion: {
        requestKind: "survey",
        requestId: capability.surveyId,
        requestVersion: capability.invalidityVersion,
      },
    };
    const before = await db.emailDelivery.findUnique({ where });
    if (!before || before.status === "SENT") return false;
    await (
      await import("./email/notification-delivery")
    ).deliverNotifications();
    return (await db.emailDelivery.findUnique({ where }))?.status === "SENT";
  }
  const notice = await inTransaction(db, async (tx) => {
    const first = await tx.studentSignupNotice.findUnique({
      where: { id: noticeId },
    });
    if (!first || first.kind === "INVALID_FLAGGED" || first.state === "SENT")
      return null;
    const row = await lockedSource(tx, first.surveyId);
    await lockEntity(tx, `signup-notice:${noticeId}`);
    const current = await tx.studentSignupNotice.findUniqueOrThrow({
      where: { id: noticeId },
    });
    if (
      current.state === "SENT" ||
      (current.lastAttemptAt &&
        Date.now() - current.lastAttemptAt.getTime() < 5 * 60_000)
    )
      return null;
    const recipient = await deliveryOwner(tx, row);
    if (
      recipient?.email !== current.recipientEmail ||
      recipient?.accountId !== current.accountId ||
      recipient?.sessionVersion !== current.sessionVersion ||
      (current.kind === "INVALID_FLAGGED" &&
        (!row.invalidatedAt ||
          row.invalidityVersion !== current.invalidityVersion ||
          row.state !== "OPEN"))
    ) {
      await tx.studentSignupNotice.update({
        where: { id: current.id },
        data: { state: "BLOCKED" },
      });
      return null;
    }
    return tx.studentSignupNotice.update({
      where: { id: current.id },
      data: {
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
        state: "PENDING",
      },
    });
  });
  if (!notice?.recipientEmail) return false;
  const flagged = notice.kind === "INVALID_FLAGGED";
  const text = flagged
    ? `Please confirm whether your peer tutoring request is genuine. If it is, explain why it should be reviewed again. Processing stays paused until staff review your appeal. Appeals are available until the current intake period ends. / 请确认您的同伴辅导申请是否真实。如需重新审核，请填写申诉理由。审核期间申请暂不处理。\n${emailOrigin()}/tutee-signup/appeal#token=${noticeToken({ id: notice.id, surveyId: notice.surveyId, invalidityVersion: notice.invalidityVersion, recipientEmail: notice.recipientEmail, accountId: notice.accountId, sessionVersion: notice.sessionVersion })}`
    : notice.kind === "APPEAL_ACCEPTED"
      ? "Your appeal was accepted. Your request keeps its original priority. / 您的申诉已通过，原申请优先顺序保持不变。"
      : "Your appeal was rejected. This request is closed. Submit a fresh request to rejoin the queue with new priority. / 您的申诉被驳回，原申请已关闭。重新申请将获得新的排队顺序。";
  try {
    await emailSender.send({
      category: "PROGRAM",
      to: notice.recipientEmail,
      subject: flagged
        ? "Confirm your peer tutoring request / 确认辅导申请"
        : "Peer tutoring appeal reviewed / 辅导申请申诉结果",
      text,
      messageId: `<signup-notice-${notice.id}@shbs-notifications>`,
    });
    await db.studentSignupNotice.updateMany({
      where: { id: notice.id, attempts: notice.attempts },
      data: { state: "SENT", sentAt: new Date() },
    });
    return true;
  } catch {
    await db.studentSignupNotice.updateMany({
      where: { id: notice.id, attempts: notice.attempts },
      data: { state: "FAILED" },
    });
    return false;
  }
}
async function sourceFromToken(tx: TransactionDb, token: string) {
  const notice = await tx.studentSignupNotice.findUnique({
    where: { tokenHash: digest(token) },
  });
  if (notice?.kind !== "INVALID_FLAGGED") throw invalid();
  const row = await lockedSource(tx, notice.surveyId);
  const recipient = await deliveryOwner(tx, row);
  if (
    recipient?.email !== notice.recipientEmail ||
    recipient?.accountId !== notice.accountId ||
    recipient?.sessionVersion !== notice.sessionVersion ||
    row.invalidityVersion !== notice.invalidityVersion
  )
    throw invalid();
  return row;
}

/** Bounded serial retries survive process restarts. A five-minute persisted claim prevents
 * overlapping workers from sending one notice while SMTP is still completing. */
export async function deliverSignupNotices(
  db: DomainDb,
  surveyId?: string,
  limit = 5,
) {
  const rows = await db.studentSignupNotice.findMany({
    where: {
      ...(surveyId ? { surveyId } : {}),
      kind: { not: "INVALID_FLAGGED" },
      state: { in: ["PENDING", "FAILED"] },
      attempts: { lt: 6 },
      OR: [
        { lastAttemptAt: null },
        { lastAttemptAt: { lte: new Date(Date.now() - 5 * 60_000) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
    take: Math.min(limit, 5),
  });
  let sent = false;
  for (const row of rows)
    sent = (await deliverSignupNotice(db, row.id)) || sent;
  return sent;
}
/** Existing staff resend authority applies only to an already-applied survey flag.
 * Retry shares its original receipt, without rotating any existing capability. */
export async function retrySignupNotices(db: DomainDb, surveyId: string) {
  const result = await inTransaction(db, async (tx) => {
    const row = await lockedSource(tx, surveyId);
    await assertSignupEditPeriod(tx, row);
    if (!row.invalidatedAt) return { queued: false, emailSent: false };
    const capability = await tx.studentSignupNotice.findUnique({
      where: {
        surveyId_invalidityVersion_kind: {
          surveyId,
          invalidityVersion: row.invalidityVersion,
          kind: "INVALID_FLAGGED",
        },
      },
    });
    if (!capability) await enqueueSignupNotice(tx, row, "INVALID_FLAGGED");
    const recipient = await deliveryOwner(tx, row);
    // Preserve the existing reviewed credential-recovery path for the SAME
    // account/mailbox. Never transfer a retained proof to a different owner.
    const rotate =
      !!capability &&
      !!recipient &&
      recipient.email === capability.recipientEmail &&
      recipient.accountId === capability.accountId &&
      recipient.sessionVersion !== capability.sessionVersion;
    if (rotate) {
      const rebound = {
        ...capability,
        sessionVersion: recipient!.sessionVersion,
      };
      await tx.studentSignupNotice.update({
        where: { id: capability.id },
        data: {
          sessionVersion: rebound.sessionVersion,
          tokenHash: digest(noticeToken(rebound)),
        },
      });
    }
    await lockEntity(tx, `request-notice:survey:${row.id}`);
    const receipt = await tx.emailDelivery.findUnique({
      where: {
        requestKind_requestId_requestVersion: {
          requestKind: "survey",
          requestId: row.id,
          requestVersion: row.invalidityVersion,
        },
      },
    });
    if (!receipt) {
      await queueRequestNotice(tx, {
        kind: "survey",
        id: row.id,
        version: row.invalidityVersion,
        invalid: true,
        reason: row.invalidReason ?? "",
        actorId: row.invalidatedById ?? "",
        recipient: row.email,
        submittedAt: row.submittedAt,
      });
      return { queued: true, emailSent: false };
    }
    const updated = await tx.emailDelivery.updateMany({
      where: {
        id: receipt.id,
        OR: [
          { status: "FAILED" },
          { status: "PENDING", attempts: { gt: 0 } },
          ...(rotate ? [{ status: "SENT" }] : []),
        ],
        AND: [
          { OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
        ],
      },
      data: {
        status: "PENDING",
        attempts: 0,
        availableAt: new Date(),
        completedAt: null,
        leaseUntil: null,
        attemptId: null,
        attemptStartedAt: null,
        lastError: null,
      },
    });
    return { queued: updated.count === 1, emailSent: false };
  });
  if (result.queued) {
    const send = async () =>
      (await import("./email/notification-delivery")).deliverNotifications();
    if (!deferUntilCommit(send)) await send();
  }
  return result;
}

/** Only the exact flag's existing modern capability can enter its receipt.
 * Generic historical links/retries cannot acquire a new version or mailbox owner. */
export async function modernSignupAppealUrl(
  db: DomainDb,
  surveyId: string,
  version: number,
  receiptRecipient: string,
) {
  const notice = await db.studentSignupNotice.findUnique({
    where: {
      surveyId_invalidityVersion_kind: {
        surveyId,
        invalidityVersion: version,
        kind: "INVALID_FLAGGED",
      },
    },
  });
  const row = await db.studentSurvey.findUnique({ where: { id: surveyId } });
  if (
    !notice?.tokenHash ||
    !row ||
    row.invalidityVersion !== version ||
    !row.invalidatedAt
  )
    return null;
  try {
    await assertSignupEditPeriod(db, row);
  } catch {
    return null;
  }
  const recipient = await deliveryOwner(db, row);
  if (
    recipient?.email !== notice.recipientEmail ||
    recipient?.accountId !== notice.accountId ||
    recipient?.sessionVersion !== notice.sessionVersion
  )
    return null;
  if (receiptRecipient !== notice.recipientEmail) {
    const address = await db.accountEmail.findUnique({
      where: { email: receiptRecipient },
    });
    // The immutable transport recipient must still be the same owner's verified
    // alias; removed/transferred mailboxes cannot receive a modern capability.
    if (
      !notice.accountId ||
      address?.userId !== notice.accountId ||
      !address.verifiedAt
    )
      return null;
  }
  return `${emailOrigin()}/tutee-signup/appeal#token=${noticeToken(notice)}`;
}

export async function inspectSignupAppeal(db: DomainDb, token: string) {
  return inTransaction(db, async (tx) => {
    const row = await sourceFromToken(tx, token);
    let canAppeal = false;
    try {
      await assertSignupEditPeriod(tx, row);
      canAppeal = !!row.invalidatedAt;
    } catch {
      /* Terminal history is shown read-only. */
    }
    const appeal = await tx.studentSignupAppeal.findUnique({
      where: {
        surveyId_invalidityVersion: {
          surveyId: row.id,
          invalidityVersion: row.invalidityVersion,
        },
      },
      select: { id: true, reason: true, state: true, createdAt: true },
    });
    return {
      id: row.id,
      invalidityVersion: row.invalidityVersion,
      canAppeal: canAppeal && !appeal,
      state: row.state,
      submittedAt: row.submittedAt,
      appeal,
    };
  });
}
export async function appealStudentSignup(
  db: DomainDb,
  input:
    z.infer<typeof signupAppealInput> | z.infer<typeof ownedSignupAppealInput>,
  userId?: string,
) {
  return inTransaction(db, async (tx) => {
    const row =
      "token" in input
        ? await sourceFromToken(tx, input.token)
        : await lockedSource(tx, input.id);
    if (!("token" in input)) {
      const actor = userId
        ? await tx.user.findUnique({ where: { id: userId } })
        : null;
      if (
        !actor ||
        actor.suspendedAt ||
        actor.mergedIntoId ||
        !row.tuteeId ||
        !(await ownedStudentIds(tx, actor.id)).includes(row.tuteeId)
      )
        throw new TRPCError({ code: "FORBIDDEN" });
      if (input.expectedInvalidityVersion !== row.invalidityVersion)
        throw new TRPCError({ code: "CONFLICT" });
    }
    const inputHash = studentSignupIntentDigest({
      surveyId: row.id,
      invalidityVersion: row.invalidityVersion,
      reason: input.reason,
      actor: userId ?? null,
    });
    const prior = await tx.studentSignupAppeal.findUnique({
      where: {
        surveyId_invalidityVersion: {
          surveyId: row.id,
          invalidityVersion: row.invalidityVersion,
        },
      },
    });
    if (prior) {
      if (prior.clientKey !== input.clientKey || prior.inputHash !== inputHash)
        throw new TRPCError({
          code: "CONFLICT",
          message: "An appeal has already been submitted.",
        });
      return { ok: true, appealId: prior.id };
    }
    await assertSignupEditPeriod(tx, row);
    if (!row.invalidatedAt)
      throw new TRPCError({ code: "PRECONDITION_FAILED" });
    const appeal = await tx.studentSignupAppeal.create({
      data: {
        surveyId: row.id,
        invalidityVersion: row.invalidityVersion,
        actorUserId: userId,
        reason: input.reason,
        clientKey: input.clientKey,
        inputHash,
      },
    });
    await recordDomainAudit(tx, {
      operation: "studentWorkflow.appealSignup",
      entity: "StudentSurvey",
      entityId: row.id,
      action: "Submitted signup invalidity appeal",
      effects: { appealId: appeal.id, processingBlocked: true },
    });
    return { ok: true, appealId: appeal.id };
  });
}
export async function resolveStudentSignupAppeal(
  db: DomainDb,
  userId: string,
  input: z.infer<typeof resolveSignupAppealInput>,
) {
  const result = await inTransaction(db, async (tx) => {
    const first = await tx.studentSignupAppeal.findUniqueOrThrow({
      where: { id: input.id },
    });
    const row = await lockedSource(tx, first.surveyId);
    const actor = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (
      !["HEAD", "ADMIN"].includes(actor.role) ||
      actor.suspendedAt ||
      actor.mergedIntoId
    )
      throw new TRPCError({ code: "FORBIDDEN" });
    const appeal = await tx.studentSignupAppeal.findUniqueOrThrow({
      where: { id: input.id },
    });
    const decisionHash = studentSignupIntentDigest({
      id: input.id,
      approve: input.approve,
      expectedInvalidityVersion: input.expectedInvalidityVersion,
      actor: userId,
    });
    if (
      appeal.decisionKey === input.clientKey &&
      appeal.decisionHash === decisionHash
    )
      return { ok: true, noticeId: null };
    await assertSignupEditPeriod(tx, row);
    if (
      appeal.state !== "PENDING" ||
      !row.invalidatedAt ||
      row.invalidityVersion !== input.expectedInvalidityVersion ||
      appeal.invalidityVersion !== row.invalidityVersion
    )
      throw new TRPCError({ code: "CONFLICT" });
    await consumeStudentAction(
      tx,
      input.signedTicket,
      userId,
      "SIGNUP_APPEAL",
      `${appeal.id}:${input.approve}`,
    );
    await tx.studentSignupAppeal.update({
      where: { id: appeal.id },
      data: {
        state: input.approve ? "ACCEPTED" : "REJECTED",
        resolvedAt: new Date(),
        resolvedByUserId: userId,
        decisionKey: input.clientKey,
        decisionHash,
      },
    });
    if (input.approve)
      await tx.studentSurvey.update({
        where: { id: row.id },
        data: {
          invalidReason: null,
          invalidatedAt: null,
          invalidatedById: null,
          invalidatedByName: null,
          invalidityVersion: { increment: 1 },
        },
      });
    else await closeStudentRequest(tx, row, "INVALID_REJECTED");
    const saved = await tx.studentSurvey.findUniqueOrThrow({
      where: { id: row.id },
    });
    const noticeId = await enqueueSignupNotice(
      tx,
      saved,
      input.approve ? "APPEAL_ACCEPTED" : "APPEAL_REJECTED",
    );
    await recordDomainAudit(tx, {
      operation: "studentWorkflow.resolveSignupAppeal",
      entity: "StudentSurvey",
      entityId: row.id,
      action: input.approve
        ? "Accepted signup appeal"
        : "Closed rejected signup appeal",
      effects: {
        appealId: appeal.id,
        originalEvidencePreserved: true,
        priorityRetained: input.approve,
        sessionsPreserved: true,
      },
    });
    return { ok: true, noticeId };
  });
  if (result.noticeId && !databaseScope.getStore())
    await deliverSignupNotice(db, result.noticeId);
  return { ok: true };
}
