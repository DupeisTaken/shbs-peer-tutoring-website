import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { SessionNotice } from "../../generated/prisma";
import { db } from "~/server/db";
import { afterCommitDatabase, deferUntilCommit } from "~/server/db-scope";
import { inTransaction, type DomainDb, type TransactionDb } from "~/server/transactions";
import { emailSender, isEmailConfigured } from "~/server/email/sender";
import { emailUrl } from "~/server/email/urls";
import { ownedStudentIds } from "~/server/student-ownership";
import { portalAccess } from "~/lib/portal-access";
import { ensureSessionPlanningWindow, lockSessionPlanning, markSessionResponseDelivered, sweepSessionPlanning } from "~/server/session-planning";
import { sessionNoticeContext, sessionPlanningNoticeCopy } from "./session-planning-notice-copy";

const failure = "Essential session email failed. Check PROGRAM delivery and retry this notice.";
const missingOwner = "The recipient no longer owns a verified delivery address. Staff action is required.";
const unavailable = "PROGRAM email delivery is unavailable. Automatic agreement remains blocked.";
const maxAttempts = 5;

async function actionableState(tx: TransactionDb, row: SessionNotice) {
  if (!row.responseId) return { current: false, response: null };
  const response = await tx.sessionPlanningResponse.findUnique({
    where: { id: row.responseId }, include: { offer: { include: { request: true } } },
  });
  return {
    current: !!response && response.state === "PENDING" && response.actorUserId === row.recipientUserId &&
      response.offerId === row.offerId && response.offer.requestId === row.requestId &&
      response.offer.request.status === "PENDING" && response.offer.request.currentOfferId === response.offerId &&
      response.offer.cutoffAt.getTime() > Date.now(),
    response,
  };
}

/** Dispatch authority is current explicit ownership, never an email/name match.
 * Optional information switches are deliberately absent: these are essential PROGRAM notices. */
async function recipientState(tx: TransactionDb, row: SessionNotice, actorKey?: string) {
  const user = await tx.user.findUnique({
    where: { id: row.recipientUserId },
    include: { emails: true, schoolDeparture: true, tutor: { select: { status: true } } },
  });
  const owned = !!user && !user.mergedIntoId && user.emails.some(address =>
    address.email === row.recipientEmail && !!address.verifiedAt);
  if (!user || !owned) return null;
  if (actorKey) {
    if (!portalAccess(user).canParticipate) return null;
    if (actorKey.startsWith("tutor:")) {
      if (user.tutorId !== actorKey.slice(6) || user.tutor?.status !== "ACTIVE" || user.tutorAccessRevoked) return null;
    } else if (actorKey.startsWith("tutee:")) {
      const tuteeId = actorKey.slice(6);
      if (!user.tuteeMember || !(await ownedStudentIds(tx, user.id)).includes(tuteeId)) return null;
      const tutee = await tx.tutee.findUnique({ where: { id: tuteeId }, select: { status: true } });
      if (tutee?.status !== "ACTIVE") return null;
    } else return null;
  }
  return user;
}

/** Claiming is not sending. Admission rechecks the exact lease and current offer under
 * the same domain fence as decisions, then releases all database locks before SMTP. */
export async function admitSessionNotice(
  database: DomainDb, id: string, leaseUntil: Date, expectedAttemptId: string | null,
) {
  return inTransaction(database, async tx => {
    await lockSessionPlanning(tx);
    await tx.$queryRaw`SELECT id FROM "SessionNotice" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.sessionNotice.findUnique({ where: { id } });
    if (!row || !["PENDING", "SENDING"].includes(row.status) || row.attemptId !== expectedAttemptId ||
        row.leaseUntil?.getTime() !== leaseUntil.getTime() || leaseUntil.getTime() <= Date.now()) return null;
    if (row.attempts >= maxAttempts) {
      await tx.sessionNotice.update({ where: { id }, data: { status: "FAILED", completedAt: new Date(), leaseUntil: null, lastError: failure } });
      return null;
    }
    const state = await actionableState(tx, row);
    const context = sessionNoticeContext(row.context);
    const actionable = context.isActionable === true && state.current;
    const user = await recipientState(tx, row, actionable ? state.response?.actorKey : undefined);
    if (!user) {
      await tx.sessionNotice.update({ where: { id }, data: { status: "BLOCKED", completedAt: new Date(), leaseUntil: null, lastError: missingOwner } });
      return null;
    }
    // Development console capture is useful for previews, but is not SMTP acceptance
    // and must never create automatic consent when a transport is missing.
    if (!isEmailConfigured("PROGRAM")) {
      await tx.sessionNotice.update({ where: { id }, data: { leaseUntil: null, availableAt: new Date(Date.now() + 60_000), lastError: unavailable } });
      return null;
    }
    const admitted = await tx.sessionNotice.update({
      where: { id }, data: { status: "SENDING", attemptId: randomUUID(), attemptStartedAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
    return { row: admitted, obsolete: context.isActionable === true && !state.current,
      destination: state.response?.actorKey.startsWith("tutor:") || (!state.response && user.tutorId)
        ? "/dashboard#sessions" : "/student?view=schedule#sessions" };
  });
}

/** A provider acceptance may be recorded after an offer changed. Preserve transport
 * evidence, but only the current response hook can start a deadline. Old completions
 * cannot overwrite newer attempts; failure never replays a schedule mutation. */
export async function finishSessionNotice(database: DomainDb, id: string, attemptId: string, acceptedAt: Date | null) {
  return inTransaction(database, async tx => {
    await lockSessionPlanning(tx);
    await tx.$queryRaw`SELECT id FROM "SessionNotice" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.sessionNotice.findUnique({ where: { id } });
    if (row?.status !== "SENDING" || row.attemptId !== attemptId) return;
    if (acceptedAt) {
      await tx.sessionNotice.update({ where: { id }, data: { status: "SENT", acceptedAt, completedAt: new Date(), leaseUntil: null, lastError: null } });
      const state = await actionableState(tx, row);
      if (state.current && row.responseId && sessionNoticeContext(row.context).isActionable &&
          await recipientState(tx, row, state.response?.actorKey)) {
        await markSessionResponseDelivered(tx, row.responseId, acceptedAt);
      }
    } else {
      await tx.sessionNotice.update({ where: { id }, data: {
        status: row.attempts >= maxAttempts ? "FAILED" : "PENDING",
        completedAt: row.attempts >= maxAttempts ? new Date() : null, leaseUntil: null,
        availableAt: new Date(Date.now() + 60_000 * 2 ** row.attempts), lastError: failure,
      } });
    }
  });
}

/** Dedicated bounded high-priority queue; optional mail backlog cannot starve consent.
 * SMTP is at-least-once after crashes. Stable Message-ID identifies retries; it cannot
 * prove inbox receipt or promise provider-side deduplication. */
export async function deliverSessionNotices(limit = 10, database: DomainDb = db) {
  if (deferUntilCommit(() => deliverSessionNotices(limit, afterCommitDatabase(database)))) return;
  const bounded = Math.max(1, Math.min(50, Math.floor(limit) || 10));
  const rows = await database.$queryRaw<{ id: string; leaseUntil: Date; attemptId: string | null }[]>`
    WITH candidates AS MATERIALIZED (
      SELECT id FROM "SessionNotice"
      WHERE status IN ('PENDING', 'SENDING') AND "availableAt" <= NOW()
        AND ("leaseUntil" IS NULL OR "leaseUntil" <= NOW())
      ORDER BY priority DESC, "createdAt", id LIMIT ${bounded} FOR UPDATE SKIP LOCKED
    ) UPDATE "SessionNotice" notice SET "leaseUntil" = NOW() + INTERVAL '5 minutes'
      FROM candidates WHERE notice.id = candidates.id
      RETURNING notice.id, notice."leaseUntil", notice."attemptId"
  `;
  for (const row of rows) {
    const admitted = await admitSessionNotice(database, row.id, row.leaseUntil, row.attemptId);
    if (!admitted?.row.attemptId) continue;
    let acceptedAt: Date | null = null;
    try {
      const copy = sessionPlanningNoticeCopy(admitted.row.event, admitted.row.context, admitted.obsolete);
      const link = emailUrl(admitted.destination);
      await emailSender.send({
        category: "PROGRAM", to: admitted.row.recipientEmail,
        messageId: `<session-notice-${admitted.row.id}@shbs-notifications>`,
        ...copy, text: `${copy.text}\n\n${link}`,
        presentation: { ...copy.presentation, action: { ...copy.presentation.action, url: link } },
      });
      acceptedAt = new Date();
    } catch { /* Keep only a fixed diagnostic; provider exceptions may contain private data. */ }
    // A database completion failure leaves SENDING evidence for lease recovery.
    await finishSessionNotice(database, admitted.row.id, admitted.row.attemptId, acceptedAt);
  }
}

/** Recovery requeues one retained receipt. It never replays the originating action,
 * clears an accepted deadline or lets a second caller reset an active attempt. */
export async function retrySessionNotice(database: DomainDb, id: string, actorId: string) {
  return inTransaction(database, async tx => {
    await lockSessionPlanning(tx);
    await tx.$queryRaw`SELECT id FROM "SessionNotice" WHERE id = ${id} FOR UPDATE`;
    const [row, actor] = await Promise.all([
      tx.sessionNotice.findUnique({ where: { id } }),
      tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, suspendedAt: true, mergedIntoId: true } }),
    ]);
    if (!row || !actor || actor.suspendedAt || actor.mergedIntoId ||
        (row.recipientUserId !== actorId && !["ADMIN", "HEAD"].includes(actor.role))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the recipient or an administrator can retry this notice." });
    }
    if (row.acceptedAt || !["PENDING", "FAILED", "BLOCKED"].includes(row.status) ||
        (row.leaseUntil && row.leaseUntil.getTime() > Date.now()) ||
        (row.status === "PENDING" && !row.lastError && row.attempts === 0)) {
      return { queued: false, status: row.status };
    }
    const owner = await tx.user.findUnique({
      where: { id: row.recipientUserId }, include: { emails: true },
    });
    const destination = owner && !owner.mergedIntoId && owner.emails.find(address =>
      address.email === owner.email && !!address.verifiedAt);
    if (!destination) {
      await tx.sessionNotice.update({ where: { id }, data: { status: "BLOCKED", leaseUntil: null, lastError: missingOwner } });
      return { queued: false, status: "BLOCKED" };
    }
    if (!isEmailConfigured("PROGRAM")) {
      await tx.sessionNotice.update({ where: { id }, data: { lastError: unavailable } });
      return { queued: false, status: row.status };
    }
    await tx.sessionNotice.update({ where: { id }, data: {
      recipientEmail: destination.email, status: "PENDING", attempts: 0, availableAt: new Date(),
      leaseUntil: null, attemptId: null, attemptStartedAt: null, completedAt: null, lastError: null,
    } });
    await tx.auditLog.create({ data: {
      userId: actorId, operation: "sessionPlanning.retryNotice", entity: "SessionNotice", entityId: id,
      action: "Queued essential session notice for retry", details: { queued: true },
    } });
    return { queued: true, status: "PENDING" };
  });
}

const state = globalThis as typeof globalThis & { sessionPlanningWorker?: ReturnType<typeof setInterval> };
export function startSessionPlanningWorker() {
  if (state.sessionPlanningWorker) return;
  let running = false;
  let nextPreparationAt = 0;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      // Sunday preparation also catches a server that was offline on Sunday. The
      // idempotent publisher is bounded in frequency; response timers still sweep every 30s.
      if (Date.now() >= nextPreparationAt) {
        try {
          await ensureSessionPlanningWindow(db);
          nextPreparationAt = Date.now() + 15 * 60_000;
        } catch {
          nextPreparationAt = Date.now() + 60_000;
          console.error("[session-planning] Publication catch-up failed; inspect database and source plans.");
        }
      }
      // Deadline/cutoff catch-up precedes admission, so expired offers never solicit consent.
      try { await sweepSessionPlanning(db); } catch {
        console.error("[session-planning] Deadline sweep failed; inspect database and request state.");
      }
      try { await deliverSessionNotices(); } catch {
        console.error("[session-planning] Delivery sweep failed; inspect session delivery and database status.");
      }
    } finally { running = false; }
  };
  state.sessionPlanningWorker = setInterval(() => void run(), 30_000);
  state.sessionPlanningWorker.unref();
  void run();
}
