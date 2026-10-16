import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "~/server/audit/log";
import {
  lockEntity,
  inTransaction,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import {
  lockApplicationReview,
  lockStudentRequestReview,
  lockLegacySignupReview,
} from "~/server/request-invalidity";
import { lockUsernameNamespace } from "~/server/auth/username";

export const requestNoticeSource = z.object({
  kind: z.enum(["application", "survey", "signup"]),
  id: z.string().min(1).max(128),
});
export type RequestNoticeSource = z.infer<typeof requestNoticeSource>;
type SourceSnapshot = RequestNoticeSource & {
  version: number;
  invalid: boolean;
  reason: string;
  recipient: string | null;
  submittedAt: Date | null;
  actorId: string;
};
export const requestServiceCategory = "request_service";
/** Keep the exact flag writer's ordering. The imports form a lazy service cycle:
 * no lock or database work executes during module initialization. */
export async function lockRequestNoticeSource(
  tx: TransactionDb,
  source: RequestNoticeSource,
  missingEmail?: string,
) {
  if (source.kind === "application") {
    await lockUsernameNamespace(tx);
    await lockApplicationReview(tx, source.id);
  } else if (source.kind === "survey") {
    const row = await tx.studentSurvey.findUnique({
      where: { id: source.id },
      select: { id: true, email: true },
    });
    if (!row && !missingEmail) throw new TRPCError({ code: "NOT_FOUND" });
    await lockStudentRequestReview(
      tx,
      row ?? { id: source.id, email: missingEmail! },
    );
  } else await lockLegacySignupReview(tx, source.id);
}
export async function assertRequestNoticeManager(
  tx: TransactionDb,
  id: string,
) {
  const user = await tx.user.findUnique({
    where: { id },
    select: { role: true, suspendedAt: true, mergedIntoId: true },
  });
  if (
    !user ||
    !["ADMIN", "HEAD"].includes(user.role) ||
    user.suspendedAt ||
    user.mergedIntoId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "An active administrator is required.",
    });
}
const mailbox = z.string().email().max(254);
export function validRequestMailbox(value: string | null | undefined) {
  return !!value && mailbox.safeParse(value).success;
}

/** Persist the send intent with the applied flag/clear and audit. Source+revision is
 * the receipt key; external SMTP only runs after commit in the existing worker. */
export async function queueRequestNotice(
  tx: TransactionDb,
  source: SourceSnapshot,
) {
  await lockEntity(tx, `request-notice:${source.kind}:${source.id}`);
  if (!source.invalid)
    await tx.requestInvalidityAppeal.updateMany({
      where: {
        status: "PENDING",
        notice: { requestKind: source.kind, requestId: source.id },
      },
      data: {
        status: "CLEARED",
        resolvedAt: new Date(),
        reviewedById: source.actorId,
        decisionReason: source.reason,
        reviewVersion: { increment: 1 },
      },
    });
  await tx.emailDelivery.updateMany({
    where: {
      requestKind: source.kind,
      requestId: source.id,
      status: { in: ["PENDING", "FAILED", "BLOCKED"] },
    },
    data: { status: "SUPERSEDED", completedAt: new Date(), leaseUntil: null },
  });
  await tx.emailDelivery.create({
    data: {
      category: requestServiceCategory,
      event: source.invalid ? "request_invalid" : "request_cleared",
      recipient: source.recipient ?? "",
      requestKind: source.kind,
      requestId: source.id,
      requestVersion: source.version,
      requestInvalid: source.invalid,
      requestReason: source.reason,
      requestSubmittedAt: source.submittedAt,
      requestTimeZone:
        (
          await tx.programSettings.findUnique({
            where: { id: "program" },
            select: { timeZone: true },
          })
        )?.timeZone ?? "Asia/Shanghai",
      status: validRequestMailbox(source.recipient) ? "PENDING" : "BLOCKED",
      lastError: validRequestMailbox(source.recipient)
        ? null
        : "The submitted email address is missing or invalid.",
    },
  });
}

/** Recheck exact source/revision, never infer request ownership from a matching
 * address. Staff contactVerified is not a mailbox proof. A request-specific mail
 * confirmation may permit the participant-facing reason in a later delivery. */
export async function currentRequestNotice(
  tx: DomainDb,
  row: {
    requestKind: string | null;
    requestId: string | null;
    requestVersion: number | null;
    requestInvalid: boolean | null;
    recipient: string;
  },
) {
  if (!row.requestId || row.requestVersion === null)
    return { current: false, verified: false };
  if (row.requestKind === "application") {
    const source = await tx.tutorApplication.findUnique({
      where: { id: row.requestId },
    });
    const current =
      !!source &&
      source.type === "INITIAL" &&
      source.email === row.recipient &&
      source.invalidityVersion === row.requestVersion &&
      !!source.invalidatedAt === row.requestInvalid;
    const proof = current
      ? await tx.registrationCode.findFirst({
          where: {
            applicationId: row.requestId,
            pendingEmail: row.recipient,
            emailVerifiedAt: { not: null },
          },
          select: { id: true, usedByUserId: true },
        })
      : null;
    const owned = proof?.usedByUserId
      ? await tx.accountEmail.findUnique({
          where: { email: row.recipient },
          select: { userId: true, verifiedAt: true },
        })
      : null;
    return {
      current,
      verified:
        !!proof &&
        (!proof.usedByUserId ||
          (!!owned?.verifiedAt && owned.userId === proof.usedByUserId)),
    };
  }
  if (row.requestKind === "survey") {
    const source = await tx.studentSurvey.findUnique({
      where: { id: row.requestId },
    });
    const modernCapability = row.requestInvalid
      ? await tx.studentSignupNotice.findUnique({
          where: {
            surveyId_invalidityVersion_kind: {
              surveyId: row.requestId,
              invalidityVersion: row.requestVersion,
              kind: "INVALID_FLAGGED",
            },
          },
          select: { id: true },
        })
      : null;
    const owner = source?.tuteeId
      ? await tx.studentProfileOwnership.findUnique({
          where: { tuteeId: source.tuteeId },
          select: { userId: true },
        })
      : null;
    const owned = owner
      ? await tx.accountEmail.findUnique({
          where: { email: row.recipient },
          select: { userId: true, verifiedAt: true },
        })
      : null;
    return {
      current:
        !!source &&
        (!modernCapability || source.state === "OPEN") &&
        source.email === row.recipient &&
        source.invalidityVersion === row.requestVersion &&
        !!source.invalidatedAt === row.requestInvalid,
      verified:
        !!source?.confirmedAt &&
        (!owner || (!!owned?.verifiedAt && owned.userId === owner.userId)),
    };
  }
  if (row.requestKind === "signup") {
    const source = await tx.tutee.findUnique({ where: { id: row.requestId } });
    const review = await tx.tuteeRequestInvalidity.findUnique({
      where: { tuteeId: row.requestId },
    });
    const current =
      !!source &&
      source.signupSource === "SELF_SERVICE" &&
      source.email === row.recipient &&
      review?.invalidityVersion === row.requestVersion &&
      !!review?.invalidatedAt === row.requestInvalid;
    // Older self-service records lack request-specific mailbox proof. Retain the
    // safe notice even when an unrelated account happens to own the same address.
    return { current, verified: false };
  }
  return { current: false, verified: false };
}

async function assertSourceExists(tx: DomainDb, source: RequestNoticeSource) {
  const found =
    source.kind === "application"
      ? await tx.tutorApplication.count({
          where: { id: source.id, type: "INITIAL" },
        })
      : source.kind === "survey"
        ? await tx.studentSurvey.count({ where: { id: source.id } })
        : await tx.tutee.count({
            where: { id: source.id, signupSource: "SELF_SERVICE" },
          });
  if (!found) throw new TRPCError({ code: "NOT_FOUND" });
}

/** Staff receive delivery state only: reading never sends and exposes no recipient,
 * copied reason, account identity or provider exception. */
export async function requestNoticeStatus(
  tx: DomainDb,
  source: RequestNoticeSource,
) {
  await assertSourceExists(tx, source);
  const row = await tx.emailDelivery.findFirst({
    where: { requestKind: source.kind, requestId: source.id },
    orderBy: { requestVersion: "desc" },
    select: {
      requestVersion: true,
      status: true,
      attempts: true,
      createdAt: true,
      completedAt: true,
      leaseUntil: true,
      lastError: true,
    },
  });
  const appeal = await tx.requestInvalidityAppeal.findFirst({
    where: { notice: { requestKind: source.kind, requestId: source.id } },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
      body: true,
      submittedAt: true,
      status: true,
      reviewVersion: true,
      resolvedAt: true,
      reviewedById: true,
      decisionReason: true,
      notice: { select: { requestVersion: true } },
    },
  });
  return row
    ? {
        ...row,
        requestAppeal: appeal,
        // Lease expiry is evaluated by the authoritative read, not an impure client
        // render clock. The actual retry rechecks current source/lease under locks.
        retryEligible:
          (row.status === "FAILED" ||
            (row.status === "PENDING" && row.attempts > 0)) &&
          (!row.leaseUntil || row.leaseUntil.getTime() <= Date.now()),
      }
    : null;
}

/** Reset a failed attempt's budget, not its immutable receipt/payload. Concurrent
 * retries become a no-op once queued, and an active SMTP lease cannot be reset. */
export async function retryRequestNotice(
  db: DomainDb,
  source: RequestNoticeSource,
  actor: { id: string; name?: string | null },
) {
  return inTransaction(db, async (tx) => {
    await lockRequestNoticeSource(tx, source);
    await lockEntity(tx, `request-notice:${source.kind}:${source.id}`);
    await assertRequestNoticeManager(tx, actor.id);
    await assertSourceExists(tx, source);
    const row = await tx.emailDelivery.findFirst({
      where: { requestKind: source.kind, requestId: source.id },
      orderBy: { requestVersion: "desc" },
    });
    if (
      !row ||
      !validRequestMailbox(row.recipient) ||
      !(await currentRequestNotice(tx, row)).current
    )
      return { queued: false };
    const result = await tx.emailDelivery.updateMany({
      where: {
        id: row.id,
        OR: [{ status: "FAILED" }, { status: "PENDING", attempts: { gt: 0 } }],
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
    if (result.count)
      await recordAudit(
        {
          userId: actor.id,
          userName: actor.name,
          action: "Queued request email for retry",
          operation: "notification.retryRequestEmail",
          entity: "EmailDelivery",
          entityId: row.id,
        },
        tx,
      );
    return { queued: result.count === 1 };
  });
}

/** A leased batch is only a candidate. Serialize actual transport admission with
 * clear/reflag, commit a unique SENDING fence, then release every domain lock before
 * SMTP. Clearing can cancel queued mail; an admitted attempt is already in progress. */
export async function admitRequestDelivery(
  db: DomainDb,
  id: string,
  leaseUntil: Date | null,
  expectedAttemptId: string | null,
) {
  return inTransaction(db, async (tx) => {
    const observed = await tx.emailDelivery.findUnique({ where: { id } });
    if (
      observed?.category !== requestServiceCategory ||
      !observed.requestKind ||
      !observed.requestId
    )
      return null;
    const source = requestNoticeSource.parse({
      kind: observed.requestKind,
      id: observed.requestId,
    });
    await lockRequestNoticeSource(tx, source, observed.recipient);
    await lockEntity(tx, `request-notice:${source.kind}:${source.id}`);
    await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.emailDelivery.findUniqueOrThrow({ where: { id } });
    if (
      !["PENDING", "SENDING"].includes(row.status) ||
      !leaseUntil ||
      leaseUntil.getTime() <= Date.now() ||
      row.leaseUntil?.getTime() !== leaseUntil.getTime() ||
      row.attemptId !== expectedAttemptId
    )
      return null;
    const current = await currentRequestNotice(tx, row);
    if (!current.current || !validRequestMailbox(row.recipient)) {
      await tx.emailDelivery.update({
        where: { id },
        data: {
          status: current.current ? "BLOCKED" : "SUPERSEDED",
          completedAt: new Date(),
          leaseUntil: null,
        },
      });
      return null;
    }
    if (row.attempts >= 5) {
      await tx.emailDelivery.update({
        where: { id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          leaseUntil: null,
          lastError: "Email delivery failed; check the configured transport.",
        },
      });
      return null;
    }
    const admitted = await tx.emailDelivery.update({
      where: { id },
      data: {
        status: "SENDING",
        attemptId: randomUUID(),
        attemptStartedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    // Resolve only this receipt's captured flag version. Historical survey
    // receipts never fall back to a generic appeal with different consequences.
    const appealUrl =
      source.kind === "survey" && row.requestInvalid
        ? await (
            await import("../student-signup-appeals")
          ).modernSignupAppealUrl(
            tx,
            source.id,
            row.requestVersion!,
            row.recipient,
          )
        : undefined;
    return { row: admitted, verified: current.verified, appealUrl };
  });
}

/** Completion is fenced by the admitted attempt, so an expired worker cannot
 * overwrite a newer attempt. SMTP acceptance remains SENT even after a clear;
 * an obsolete failure cannot retry. Crash recovery reuses the original Message-ID. */
export async function finishRequestDelivery(
  db: DomainDb,
  id: string,
  attemptId: string,
  sent: boolean,
) {
  return inTransaction(db, async (tx) => {
    const observed = await tx.emailDelivery.findUnique({ where: { id } });
    if (!observed?.requestKind || !observed.requestId) return;
    const source = requestNoticeSource.parse({
      kind: observed.requestKind,
      id: observed.requestId,
    });
    await lockRequestNoticeSource(tx, source, observed.recipient);
    await lockEntity(tx, `request-notice:${source.kind}:${source.id}`);
    await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.emailDelivery.findUniqueOrThrow({ where: { id } });
    if (row.status !== "SENDING" || row.attemptId !== attemptId) return;
    if (sent)
      await tx.emailDelivery.update({
        where: { id },
        data: {
          status: "SENT",
          completedAt: new Date(),
          leaseUntil: null,
          lastError: null,
        },
      });
    else {
      const current = await currentRequestNotice(tx, row);
      await tx.emailDelivery.update({
        where: { id },
        data: {
          status: !current.current
            ? "SUPERSEDED"
            : row.attempts >= 5
              ? "FAILED"
              : "PENDING",
          completedAt:
            !current.current || row.attempts >= 5 ? new Date() : null,
          availableAt: new Date(Date.now() + 60_000 * 2 ** row.attempts),
          leaseUntil: null,
          lastError: "Email delivery failed; check the configured transport.",
        },
      });
    }
    // Modern capability evidence reflects the admitted shared transport result,
    // never an enqueue or a second SMTP path. The shared receipt remains the
    // authoritative retry/lease state shown to staff.
    if (source.kind === "survey" && row.requestInvalid) {
      await tx.studentSignupNotice.updateMany({
        where: {
          surveyId: source.id,
          invalidityVersion: row.requestVersion!,
          kind: "INVALID_FLAGGED",
        },
        data: {
          state: sent ? "SENT" : "FAILED",
          attempts: row.attempts,
          lastAttemptAt: row.attemptStartedAt,
          sentAt: sent ? new Date() : null,
        },
      });
    }
  });
}
