/**
 * Helper to fan out in-app notifications. Node runtime only (uses the Prisma singleton).
 */
import { db } from "~/server/db";
import type { TransactionDb } from "~/server/transactions";

export interface NotificationInput {
  title: string;
  body?: string;
  link?: string;
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
    })),
  });
}

/**
 * Notify every admin/coordinator (the people who action admin queues). Optionally exclude one
 * user id — e.g. the actor who triggered the event and is already looking at the page.
 */
export async function notifyAdmins(
  data: NotificationInput,
  opts?: { exclude?: string },
  client: TransactionDb = db,
): Promise<void> {
  const admins = await client.user.findMany({
    where: {
      role: { in: ["HEAD", "ADMIN", "COORDINATOR"] },
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
