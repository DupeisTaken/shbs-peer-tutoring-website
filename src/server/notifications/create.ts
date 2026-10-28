/**
 * Helper to fan out in-app notifications. Node runtime only (uses the Prisma singleton).
 */
import { db } from "~/server/db";
import type { TransactionDb } from "~/server/transactions";
import type {
  NotificationEvent,
  NotificationContext,
} from "~/lib/notification-events";
import { notificationInAppEvent } from "~/lib/notification-details";
import enMessages from "../../../messages/en.json";
import zhMessages from "../../../messages/zh.json";

/** Name only the affected record; free-text reasons stay in their authorized workflow. */
export function namedNotificationDetail(
  event: NotificationEvent,
  name: string,
) {
  return {
    en: `${name}: ${enMessages.notificationEvents[event].body}`,
    zh: `${name}：${zhMessages.notificationEvents[event].body}`,
  };
}

/** Retain a readable English text snapshot for older readers without inferring event
 * identity from free text. Current UI and mail localize the explicit event. */
export function notificationData(
  event: NotificationEvent,
  context?: NotificationContext,
  detail?: { en: string; zh: string },
) {
  return {
    title: enMessages.notificationEvents[event].title,
    ...notificationInAppEvent(event, context, detail),
  };
}

export interface NotificationInput {
  title: string;
  body?: string;
  link?: string;
  /** Explicitly suppress optional email copies for a workflow with an in-app-only contract. */
  inAppOnly?: boolean;
  event?: NotificationEvent;
  context?: NotificationContext & { inAppDetail?: { en: string; zh: string } };
}

/** Create the same notification for each of the given user ids (de-duplicated, skips empty). */
export async function notifyUsers(
  userIds: readonly string[],
  data: NotificationInput,
  client: TransactionDb = db,
): Promise<void> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return;
  await client.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      title: data.title,
      body: data.body ?? null,
      link: data.link ?? null,
      ...(data.inAppOnly ? { inAppOnly: true } : {}),
      ...(data.event ? notificationInAppEvent(data.event, data.context) : {}),
    })),
  });
}

/**
 * Notify every eligible active reviewer. Badge/access grants use the Head-only queue;
 * ordinary review queues can be actioned by either Admin or Head. Optionally exclude one
 * user id — e.g. the actor who triggered the event and is already looking at the page.
 */
export async function notifyAdmins(
  data: NotificationInput,
  opts?: { exclude?: string; headOnly?: boolean },
  client: TransactionDb = db,
): Promise<void> {
  const admins = await client.user.findMany({
    where: {
      role: { in: opts?.headOnly ? ["HEAD"] : ["HEAD", "ADMIN"] },
      suspendedAt: null,
      mergedIntoId: null,
      ...(opts?.exclude ? { id: { not: opts.exclude } } : {}),
    },
    select: { id: true },
  });
  await notifyUsers(
    admins.map((u) => u.id),
    data,
    client,
  );
}

/** Notify the User accounts linked to the given Tutor ids (tutors without a login are skipped). */
export async function notifyTutors(
  tutorIds: readonly string[],
  data: NotificationInput,
  client: TransactionDb = db,
): Promise<void> {
  const ids = [...new Set(tutorIds)].filter(Boolean);
  if (ids.length === 0) return;
  const users = await client.user.findMany({
    where: { tutorId: { in: ids } },
    select: { id: true },
  });
  await notifyUsers(
    users.map((u) => u.id),
    data,
    client,
  );
}
