import { db } from "~/server/db";
import { lockAccountProfile } from "~/server/account-profile";
import { inTransaction, lockEntity, type DomainDb } from "~/server/transactions";
import { verifyUnsubscribeToken } from "./unsubscribe-token";
import { effectiveNotificationPreference, informationCategories, isNotificationCategory, notificationCategories, notificationLockCategories, type NotificationCategory } from "~/lib/notification-categories";

export type UnsubscribeCategory = NotificationCategory | "info" | "review" | "reminder";
export type UnsubscribeScope = "category" | "all";
export type UnsubscribeStatus =
  | { status: "invalid" }
  | { status: "locked"; category: UnsubscribeCategory }
  | { status: "ready" | "already-unsubscribed"; category: UnsubscribeCategory; requiredRemaining?: boolean };
export type UnsubscribeResult =
  | { status: "invalid" }
  | { status: "locked"; category: UnsubscribeCategory }
  | { status: "unsubscribed"; category: UnsubscribeCategory; requiredRemaining?: boolean };

function deliveryTopics(delivery: { topic: NotificationCategory | null; category: UnsubscribeCategory }): readonly NotificationCategory[] {
  return delivery.topic ? [delivery.topic] : delivery.category === "messages" ? ["messages"]
    : delivery.category === "review" ? ["reviews"] : delivery.category === "reminder" ? ["reminders"] : informationCategories;
}

/** Legacy information rows map to the same preference; unknown categories fail closed. */
export function optionalEmailCategory(
  category: string,
): UnsubscribeCategory | null {
  return category === "messages" ||
    category === "review" ||
    category === "reminder"
    ? category
    : ["info", "information", "monthly_hours"].includes(category)
      ? "info"
      : null;
}

async function eligibleDelivery(client: DomainDb, deliveryId: string) {
  const row = await client.emailDelivery.findUnique({
    where: { id: deliveryId },
    include: { user: { include: { emails: true, notificationPreferences: true } } },
  });
  if (!row?.user || row.user.mergedIntoId || row.previousPrimary) return null;
  const legacyCategory = optionalEmailCategory(row.category);
  const topic = isNotificationCategory(row.preferenceTopic) ? row.preferenceTopic : null;
  const category = legacyCategory ? topic ?? legacyCategory : null;
  // Retired accounts and removed/unverified addresses cannot control current preferences.
  // A still-owned secondary address remains valid even if secondary delivery was disabled.
  const owned = row.user.emails.some(
    (address) => address.email === row.recipient && address.verifiedAt !== null,
  );
  return category && owned
    ? { row: { ...row, user: row.user }, category, topic }
    : null;
}

/** Link scanners and page previews perform only reads. No account identity is returned. */
export async function getUnsubscribeStatus(
  token: string,
  client: DomainDb = db,
): Promise<UnsubscribeStatus> {
  const id = verifyUnsubscribeToken(token);
  if (!id) return { status: "invalid" };
  const delivery = await eligibleDelivery(client, id);
  if (!delivery) return { status: "invalid" };
  const settings = await client.programSettings.findUnique({ where: { id: "program" }, select: { notificationLocks: true } });
  const locked = new Set(notificationLockCategories(settings?.notificationLocks).filter((row) => row.emailLocked).map((row) => row.category));
  const topics = deliveryTopics(delivery).filter((topic) => !locked.has(topic));
  if (!topics.length) return { status: "locked", category: delivery.category };
  const enabled = topics.some((topic) => effectiveNotificationPreference(delivery.row.user, topic, delivery.row.user.notificationPreferences).emailEnabled);
  return {
    status: enabled ? "ready" : "already-unsubscribed",
    category: delivery.category,
    ...(locked.size ? { requiredRemaining: true } : {}),
  };
}

/** The signed delivery grants only disabling optional mail for its current owner. */
export async function unsubscribeFromEmail(
  token: string,
  scope: UnsubscribeScope,
  client: DomainDb = db,
): Promise<UnsubscribeResult> {
  if (scope !== "category" && scope !== "all") return { status: "invalid" };
  const id = verifyUnsubscribeToken(token);
  if (!id) return { status: "invalid" };
  return inTransaction<UnsubscribeResult>(client, async (tx) => {
    // Match personal preference writers before taking the account-ownership lock.
    await lockEntity(tx, "email-notifications-setting");
    const initial = await tx.emailDelivery.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!initial?.userId) return { status: "invalid" };
    // Match email removal/merge lock order, then re-check ownership under that lock.
    await lockAccountProfile(tx, initial.userId);
    const delivery = await eligibleDelivery(tx, id);
    if (delivery?.row.userId !== initial.userId) return { status: "invalid" };
    const settings = await tx.programSettings.findUnique({ where: { id: "program" }, select: { notificationLocks: true } });
    const locked = new Set(notificationLockCategories(settings?.notificationLocks).filter((row) => row.emailLocked).map((row) => row.category));
    const topics = (scope === "all" ? notificationCategories : deliveryTopics(delivery)).filter((topic) => !locked.has(topic));
    if (!topics.length && scope === "category") return { status: "locked", category: delivery.category };
    const legacy = scope === "all" || !delivery.topic;
    const stopMessages = !locked.has("messages") && (scope === "all" || (legacy && delivery.category === "messages"));
    const stopInfo = scope === "all" || (legacy && delivery.category === "info");
    const stopReview = !locked.has("reviews") && (scope === "all" || (legacy && delivery.category === "review"));
    const stopReminders = !locked.has("reminders") && (scope === "all" || (legacy && delivery.category === "reminder"));
    // Freeze required topics before changing a broad legacy fallback. Other legacy
    // information mail can then stop without losing the choices restored on unlock.
    if (stopInfo) for (const category of informationCategories.filter((topic) => locked.has(topic))) {
      const original = effectiveNotificationPreference(delivery.row.user, category, delivery.row.user.notificationPreferences);
      await tx.notificationPreference.upsert({ where: { userId_category: { userId: initial.userId, category } }, create: { userId: initial.userId, ...original }, update: {} });
    }
    if (legacy) await tx.user.update({
      where: { id: initial.userId },
      data: {
        ...(stopMessages ? { emailMessages: false } : {}),
        ...(stopInfo ? { emailInfo: false } : {}),
        ...(stopReview ? { emailReviewRequests: false } : {}),
        ...(stopReminders ? { emailEventReminders: false } : {}),
      },
    });
    for (const category of topics) await tx.notificationPreference.upsert({
      where: { userId_category: { userId: initial.userId, category } },
      create: { userId: initial.userId, category, emailEnabled: false }, update: { emailEnabled: false },
    });
    // Include all verified recipient copies, including leased rows not yet sent. SMTP already
    // in flight cannot be recalled; future worker reads and enqueue triggers honor preferences.
    await tx.emailDelivery.updateMany({
      where: {
        userId: initial.userId,
        status: "PENDING",
        OR: [{ preferenceTopic: { in: [...topics] } }, ...(legacy ? [{ preferenceTopic: null, category: {
          in: [
            ...(stopMessages ? ["messages"] : []),
            ...(stopInfo && !informationCategories.some((category) => locked.has(category)) ? ["info", "information", "monthly_hours"] : []),
            ...(stopReview ? ["review"] : []),
            ...(stopReminders ? ["reminder"] : []),
          ],
        } }] : [])],
      },
      data: { status: "SKIPPED", completedAt: new Date(), leaseUntil: null },
    });
    return { status: "unsubscribed", category: delivery.category, ...(locked.size ? { requiredRemaining: true } : {}) };
  });
}
