import type { TransactionDb } from "~/server/transactions";
import type { NotificationEvent, NotificationContext } from "~/lib/notification-events";
import { notificationInAppEvent } from "~/lib/notification-details";
import enMessages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh.json";

/** Database-injected notification primitives. Importing this module never loads
 * the shared client, environment validation, approval dispatch or API routers. */
export interface NotificationInput {
  title: string;
  body?: string;
  link?: string;
  inAppOnly?: boolean;
  event?: NotificationEvent;
  context?: NotificationContext & { inAppDetail?: { en: string; zh: string } };
}
export type ManagementNotificationOptions = { exclude?: string; headOnly?: boolean };
export type ManagementReviewerOptions = ManagementNotificationOptions & { allowHeadSelfReview?: boolean };
export type DomainReviewSource = "TutorStatusRequest" | "CrewStatusRequest" | "CrewApplication";

/** Name only the affected record; free-text reasons stay in their owning workflow. */
export function namedNotificationDetail(event: NotificationEvent, name: string) {
  return {
    en: `${name}: ${enMessages.notificationEvents[event].body}`,
    zh: `${name}：${zhMessages.notificationEvents[event].body}`,
  };
}

/** Keep the existing readable snapshot and explicit event/context mapping. */
export function notificationData(event: NotificationEvent, context?: NotificationContext, detail?: { en: string; zh: string }) {
  return {
    title: enMessages.notificationEvents[event].title,
    ...notificationInAppEvent(event, context, detail),
  };
}

export async function notifyUsers(userIds: readonly string[], data: NotificationInput, client: TransactionDb): Promise<void> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  await client.notification.createMany({ data: ids.map((userId) => ({
    userId, title: data.title, body: data.body ?? null, link: data.link ?? null,
    ...(data.inAppOnly ? { inAppOnly: true } : {}),
    ...(data.event ? notificationInAppEvent(data.event, data.context) : {}),
  })) });
}

/** Only explicit review events select the review audience. Outcomes and room
 * shortages retain the full management audience, independent of their copy. */
const managementReviewEvents = new Set<NotificationEvent>([
  "account_appeal_requested", "tutor_application_pending", "crew_application_pending", "qualification_requested",
  "request_invalidity_appeal_pending", "attendance_cards_pending", "translation_review_pending",
  "tutor_optout_requested", "tutor_reentry_requested", "crew_optout_requested", "crew_reentry_requested",
  "tutee_card_appeal", "tutee_optout_requested", "student_withdrawal_pending", "student_schedule_review_pending",
]);

export async function managementNotificationRecipients(client: TransactionDb, event?: NotificationEvent, opts?: ManagementNotificationOptions) {
  if ((event && managementReviewEvents.has(event)) || opts?.headOnly)
    return managementReviewers(client, opts);
  return client.user.findMany({
    where: { role: { in: ["ADMIN", "HEAD"] }, suspendedAt: null, mergedIntoId: null,
      ...(opts?.exclude ? { id: { not: opts.exclude } } : {}) },
    select: { id: true, role: true },
  });
}

/** The middle option accepts undefined; the final client is always required. */
export async function notifyAdmins(data: NotificationInput, opts: ManagementNotificationOptions | undefined, client: TransactionDb): Promise<void> {
  const admins = await managementNotificationRecipients(client, data.event, opts);
  await notifyUsers(admins.map((user) => user.id), data, client);
}

export async function managementReviewers(client: TransactionDb, opts?: ManagementReviewerOptions) {
  const candidates = await client.user.findMany({
    where: { role: { in: opts?.headOnly ? ["HEAD"] : ["HEAD", "ADMIN"] }, suspendedAt: null, mergedIntoId: null },
    select: { id: true, role: true },
  });
  return selectManagementReviewers(candidates, opts);
}

/** Exclude the requester before choosing Admin-first/Head-fallback ownership. */
export function selectManagementReviewers<T extends { id: string; role: string }>(candidates: T[], opts?: ManagementReviewerOptions) {
  const eligible = candidates.filter((user) =>
    (!opts?.headOnly || user.role === "HEAD") &&
    (user.id !== opts?.exclude || (opts?.allowHeadSelfReview && user.role === "HEAD")));
  const admins = eligible.filter((user) => user.role === "ADMIN");
  return admins.length ? admins : eligible.filter((user) => user.role === "HEAD");
}

export function managementReviewSourceLink(source: DomainReviewSource, id: string) {
  const page = source === "TutorStatusRequest" ? "/admin/tutor-requests" : "/admin/crew";
  const anchor = source === "CrewApplication" ? "application" : "request";
  return `${page}#${anchor}-${encodeURIComponent(id)}`;
}

export async function notifyTutors(tutorIds: readonly string[], data: NotificationInput, client: TransactionDb): Promise<void> {
  const ids = [...new Set(tutorIds)].filter(Boolean);
  if (!ids.length) return;
  const users = await client.user.findMany({ where: { tutorId: { in: ids } }, select: { id: true } });
  await notifyUsers(users.map((user) => user.id), data, client);
}
