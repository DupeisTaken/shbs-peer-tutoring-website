/**
 * Helper to fan out in-app notifications. Node runtime only (uses the Prisma singleton).
 */
import { db } from "~/server/db";
import { inTransaction, lockEntity, type DomainDb, type TransactionDb } from "~/server/transactions";
import type { Prisma } from "../../../generated/prisma";
import { APPROVAL_OPERATIONS, classifyApproval, humanizeOperation } from "~/lib/approval-policy";
import { approvalNotificationDetail } from "~/lib/approval-notification-detail";
import superjson from "superjson";
import type {
  NotificationEvent,
} from "~/lib/notification-events";
import { notificationInAppEvent } from "~/lib/notification-details";
import {
  notifyUsers as notifyUsersWithClient,
  notifyAdmins as notifyAdminsWithClient,
  notifyTutors as notifyTutorsWithClient,
  notificationData,
  namedNotificationDetail,
  managementNotificationRecipients,
  managementReviewers,
  managementReviewSourceLink,
  selectManagementReviewers,
  type NotificationInput,
} from "./core";
export { notificationData, namedNotificationDetail, managementNotificationRecipients, managementReviewers, managementReviewSourceLink };
export type { NotificationInput } from "./core";

/** Create the same notification for each of the given user ids (de-duplicated, skips empty). */
export async function notifyUsers(
  userIds: readonly string[],
  data: NotificationInput,
  client: TransactionDb = db,
): Promise<void> {
  return notifyUsersWithClient(userIds, data, client);
}

/** Fan out to the event's current active management audience, with optional actor exclusion. */
export async function notifyAdmins(
  data: NotificationInput,
  opts?: { exclude?: string; headOnly?: boolean },
  client: TransactionDb = db,
): Promise<void> {
  return notifyAdminsWithClient(data, opts, client);
}

type DomainReviewNotice = {
  event: NotificationEvent;
  link: string;
  body: string;
  detail: { en: string; zh: string };
};

/** All three formerly Head-owned domain queues retain their own decisions and
 * eligibility. This read only identifies missing delivery; it grants no access. */
async function reconcileDomainReviewNotifications(
  tx: TransactionDb,
  candidates: { id: string; role: string }[],
) {
  const reviewers = selectManagementReviewers(candidates);
  const readers = [
    async (cursor?: string) => {
      const rows = await tx.tutorStatusRequest.findMany({
        where: { state: "PENDING" }, orderBy: { id: "asc" }, take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, kind: true, tutor: { select: {
          englishName: true, status: true,
          user: { select: { suspendedAt: true, mergedIntoId: true, tutorAccessRevoked: true } },
        } } },
      });
      return { cursor: rows.at(-1)?.id, pending: rows.length, notices: rows.flatMap((row): DomainReviewNotice[] => {
        const owner = row.tutor.user;
        if (!owner || owner.suspendedAt || owner.mergedIntoId || owner.tutorAccessRevoked ||
          row.tutor.status !== (row.kind === "OPT_OUT" ? "ACTIVE" : "OPTED_OUT")) return [];
        return [{ event: row.kind === "OPT_OUT" ? "tutor_optout_requested" : "tutor_reentry_requested",
          link: managementReviewSourceLink("TutorStatusRequest", row.id),
          detail: { en: `${row.tutor.englishName}: ${row.kind === "OPT_OUT" ? "tutor opt-out" : "tutor reentry"} awaiting review.`,
            zh: `${row.tutor.englishName}：${row.kind === "OPT_OUT" ? "退出辅导伙伴" : "重新加入辅导伙伴"}申请待审核。` },
          body: `${row.tutor.englishName}: ${row.kind === "OPT_OUT" ? "opt-out" : "reentry"} awaiting review.` }];
      }) };
    },
    async (cursor?: string) => {
      const rows = await tx.crewStatusRequest.findMany({
        where: { state: "PENDING" }, orderBy: { id: "asc" }, take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, kind: true, user: { select: {
          name: true, username: true, crewStatus: true, suspendedAt: true, mergedIntoId: true,
        } } },
      });
      return { cursor: rows.at(-1)?.id, pending: rows.length, notices: rows.flatMap((row): DomainReviewNotice[] => {
        if (row.user.suspendedAt || row.user.mergedIntoId ||
          row.user.crewStatus !== (row.kind === "OPT_OUT" ? "ACTIVE" : "OPTED_OUT")) return [];
        return [{ event: row.kind === "OPT_OUT" ? "crew_optout_requested" : "crew_reentry_requested",
          link: managementReviewSourceLink("CrewStatusRequest", row.id),
          detail: { en: `${row.user.name ?? row.user.username ?? "Crew member"}: ${row.kind === "OPT_OUT" ? "crew opt-out" : "crew reentry"} awaiting review.`,
            zh: `${row.user.name ?? row.user.username ?? "工作组成员"}：${row.kind === "OPT_OUT" ? "退出工作组" : "重新加入工作组"}申请待审核。` },
          body: `${row.user.name ?? row.user.username ?? "Crew member"}: ${row.kind === "OPT_OUT" ? "opt-out" : "reentry"} awaiting review.` }];
      }) };
    },
    async (cursor?: string) => {
      const rows = await tx.crewApplication.findMany({
        where: { status: "PENDING" }, orderBy: { id: "asc" }, take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, name: true },
      });
      return { cursor: rows.at(-1)?.id, pending: rows.length, notices: rows.map((row): DomainReviewNotice => ({
        event: "crew_application_pending", link: managementReviewSourceLink("CrewApplication", row.id),
        body: `${row.name} applied to join the crew.`,
        detail: { en: `${row.name} applied to join the crew.`, zh: `${row.name} 已申请加入工作组。` },
      })) };
    },
  ];
  let pending = 0;
  let created = 0;
  for (const read of readers) {
    let cursor: string | undefined;
    while (true) {
      const page = await read(cursor);
      if (!page.pending) break;
      pending += page.pending;
      const existing = page.notices.length && reviewers.length ? await tx.notification.findMany({
        where: { userId: { in: reviewers.map((user) => user.id) },
          link: { in: page.notices.map((notice) => notice.link) },
          event: { in: page.notices.map((notice) => notice.event) } },
        select: { userId: true, event: true, link: true },
      }) : [];
      const delivered = new Set(existing.map((notice) => `${notice.userId}:${notice.event}:${notice.link}`));
      const data = page.notices.flatMap((notice) => reviewers.flatMap((reviewer) =>
        delivered.has(`${reviewer.id}:${notice.event}:${notice.link}`) ? [] : [{
          userId: reviewer.id, link: notice.link, body: notice.body, ...notificationData(notice.event, {}, notice.detail),
        }],
      ));
      if (data.length) created += (await tx.notification.createMany({ data })).count;
      cursor = page.cursor;
    }
  }
  return { pending, created };
}

/** Explicit policy-cutover/role-change repair appends missing notices only. Original
 * deliveries and request evidence remain historical facts; reads never perform this write. */
export async function reconcileManagementReviewNotifications(database: DomainDb) {
  return inTransaction(database, async (tx) => {
    await lockEntity(tx, "management-review-notifications");
    // Import only at execution: approvals uses this module for ordinary submission
    // delivery. Its pure admission helper does not acquire source locks here.
    const { canRequestProposal, parseProposal } = await import("~/server/approvals");
    const candidates = await tx.user.findMany({
      where: { role: { in: ["ADMIN", "HEAD"] }, suspendedAt: null, mergedIntoId: null },
      select: { id: true, role: true },
    });
    let cursor: string | undefined;
    let pending = 0;
    let created = 0;
    while (true) {
      const requests = await tx.approvalRequest.findMany({
        where: { state: "PENDING" },
        select: { id: true, operation: true, payload: true, targets: true, requesterId: true, requesterName: true },
        orderBy: { id: "asc" }, take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!requests.length) break;
      pending += requests.length;
      const deliveries: Prisma.NotificationCreateManyInput[] = [];
      const existing = await tx.notification.findMany({
        where: {
          link: { in: requests.map((request) => `/admin/approvals?request=${request.id}`) },
          event: { in: ["management_review_pending", "management_head_review_pending"] },
        }, select: { userId: true, link: true },
      });
      const delivered = new Set(existing.map((notice) => `${notice.userId}:${notice.link}`));
      const requesters = new Map((await tx.user.findMany({
        where: { id: { in: requests.map((request) => request.requesterId) }, suspendedAt: null, mergedIntoId: null },
        select: { id: true, role: true },
      })).map((user) => [user.id, user]));
      for (const request of requests) {
        if (!Object.hasOwn(APPROVAL_OPERATIONS, request.operation)) continue;
        const requester = requesters.get(request.requesterId);
        if (!requester) continue;
        let value: unknown;
        try {
          value = superjson.deserialize(request.payload as unknown as Parameters<typeof superjson.deserialize>[0]);
          await parseProposal(request.operation, value);
        } catch {
          // Incompatible historical payloads need fresh submission, never a new actionable notice.
          continue;
        }
        const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
        // These are the current-policy contexts that can remove requester eligibility.
        // Other effect contexts alter category only and remain checked by the decision.
        const authority = classifyApproval(request.operation, value, {
          currentAccountRole: request.operation === "admin.setMemberships" && typeof input.userId === "string"
            ? (await tx.user.findUnique({ where: { id: input.userId }, select: { role: true } }))?.role : undefined,
          currentRegistrationKind: request.operation === "admin.revokeRegistrationCode" && typeof input.id === "string"
            ? (await tx.registrationCode.findUnique({ where: { id: input.id }, select: { kind: true } }))?.kind : undefined,
        });
        const evidence = request.targets as Record<string, unknown>;
        const participantSelfService = evidence?.participantSelfService === true ||
          !evidence || !Object.hasOwn(evidence, "authorityContext");
        if (!authority || !canRequestProposal(authority, requester.role, requester.id,
          request.operation, value, participantSelfService)) continue;
        const headOnly = !authority.reviewerRoles.includes("ADMIN");
        const reviewers = selectManagementReviewers(candidates, {
          headOnly, exclude: request.requesterId, allowHeadSelfReview: true,
        });
        const link = `/admin/approvals?request=${request.id}`;
        for (const reviewer of reviewers) {
          if (delivered.has(`${reviewer.id}:${link}`)) continue;
          deliveries.push({
            userId: reviewer.id, link,
            title: headOnly ? "Management change awaiting Head approval" : "Management change awaiting approval",
            ...notificationInAppEvent(headOnly ? "management_head_review_pending" : "management_review_pending", {},
              approvalNotificationDetail(request.operation, value, request.targets, "pending")),
            body: `${request.requesterName}: ${humanizeOperation(request.operation)}`,
          });
        }
      }
      if (deliveries.length) created += (await tx.notification.createMany({ data: deliveries })).count;
      cursor = requests.at(-1)!.id;
    }
    const domains = await reconcileDomainReviewNotifications(tx, candidates);
    return { pending: pending + domains.pending, created: created + domains.created };
  });
}

/** Notify the User accounts linked to the given Tutor ids (tutors without a login are skipped). */
export async function notifyTutors(
  tutorIds: readonly string[],
  data: NotificationInput,
  client: TransactionDb = db,
): Promise<void> {
  return notifyTutorsWithClient(tutorIds, data, client);
}
