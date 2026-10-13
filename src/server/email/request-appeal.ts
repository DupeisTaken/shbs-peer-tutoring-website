import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db } from "~/server/db";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";
import { recordAudit } from "~/server/audit/log";
import { notifyAdmins } from "~/server/notifications/create";
import {
  currentRequestNotice,
  lockRequestNoticeSource,
  assertRequestNoticeManager,
  requestNoticeSource,
} from "./request-notice";
import { verifyRequestAppealToken } from "./request-appeal-token";
import { requestStaffDestination } from "~/lib/request-notification-destination";

export const appealBody = z.string().trim().min(10).max(2000);
export const declineRequestAppealInput = requestNoticeSource.extend({
  appealId: z.string().min(1).max(128),
  expectedReviewVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(1000),
});

async function eligibleNotice(client: DomainDb, token: string) {
  const id = verifyRequestAppealToken(token);
  if (!id) return null;
  const notice = await client.emailDelivery.findUnique({
    where: { id },
    include: { requestAppeal: true },
  });
  if (
    !notice ||
    notice.category !== "request_service" ||
    !notice.requestInvalid ||
    ["SUPERSEDED", "CANCELLED", "SKIPPED", "BLOCKED"].includes(notice.status) ||
    !(await currentRequestNotice(client, notice)).current
  )
    return null;
  return notice;
}

/** GET reveals only safe source kind/time and review state, never reason, original
 * answers, contact information, identities or participant/staff appeal text. */
export async function requestAppealStatus(
  token: string,
  client: DomainDb = db,
) {
  const notice = await eligibleNotice(client, token);
  if (!notice) return { status: "invalid" as const };
  return {
    status: "ready" as const,
    kind:
      notice.requestKind === "application"
        ? ("tutor" as const)
        : ("tutee" as const),
    recordedTime: notice.requestSubmittedAt?.toISOString() ?? null,
    timeZone: notice.requestTimeZone ?? "Asia/Shanghai",
    appealStatus: notice.requestAppeal?.status ?? null,
  };
}

/** One immutable appeal per flag is a durable cross-replica submission limit.
 * The source lock orders submit/clear/reflag; retries never replace evidence. */
export async function submitRequestAppeal(
  token: string,
  text: string,
  client: DomainDb = db,
) {
  const body = appealBody.parse(text);
  const observed = await eligibleNotice(client, token);
  if (!observed || !observed.requestKind || !observed.requestId)
    return { status: "invalid" as const };
  const source = requestNoticeSource.parse({
    kind: observed.requestKind,
    id: observed.requestId,
  });
  return inTransaction(client, async (tx) => {
    await lockRequestNoticeSource(tx, source);
    await lockEntity(tx, `request-notice:${source.kind}:${source.id}`);
    const notice = await eligibleNotice(tx, token);
    if (!notice) return { status: "invalid" as const };
    if (notice.requestAppeal) {
      if (notice.requestAppeal.body !== body)
        return { status: "already-submitted" as const };
      return {
        status: "submitted" as const,
        appealStatus: notice.requestAppeal.status,
      };
    }
    await tx.requestInvalidityAppeal.create({
      data: { noticeId: notice.id, body },
    });
    // Existing management recipients/destination; free text never enters the event.
    await notifyAdmins(
      {
        title: "Invalid request appeal awaiting review",
        event: "request_invalidity_appeal_pending",
        link: requestStaffDestination(source),
      },
      undefined,
      tx,
    );
    return { status: "submitted" as const, appealStatus: "PENDING" };
  });
}

/** Declining preserves the original flag and immutable appeal. Clearing remains
 * the existing authorized, versioned operation (including Coordinator proposals). */
export async function declineRequestAppeal(
  client: DomainDb,
  input: z.infer<typeof declineRequestAppealInput>,
  actor: { id: string; name?: string | null },
) {
  return inTransaction(client, async (tx) => {
    await lockRequestNoticeSource(tx, input);
    await lockEntity(tx, `request-notice:${input.kind}:${input.id}`);
    await assertRequestNoticeManager(tx, actor.id);
    const appeal = await tx.requestInvalidityAppeal.findUnique({
      where: { id: input.appealId },
      include: { notice: true },
    });
    if (
      !appeal ||
      appeal.notice.requestKind !== input.kind ||
      appeal.notice.requestId !== input.id
    )
      throw new TRPCError({ code: "NOT_FOUND" });
    if (
      appeal.status !== "PENDING" ||
      appeal.reviewVersion !== input.expectedReviewVersion ||
      !(await currentRequestNotice(tx, appeal.notice)).current
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "This appeal changed. Reload before reviewing it.",
      });
    const updated = await tx.requestInvalidityAppeal.update({
      where: { id: appeal.id },
      data: {
        status: "DECLINED",
        reviewVersion: { increment: 1 },
        resolvedAt: new Date(),
        reviewedById: actor.id,
        decisionReason: input.reason,
      },
    });
    // Audit the receipt/outcome, never the participant's free-text body.
    await recordAudit(
      {
        userId: actor.id,
        userName: actor.name,
        operation: "notification.declineRequestAppeal",
        action: "Declined invalid request appeal",
        entity: "RequestInvalidityAppeal",
        entityId: appeal.id,
        details: {
          reviewVersion: updated.reviewVersion,
          status: updated.status,
        },
      },
      tx,
    );
    return { ok: true };
  });
}
