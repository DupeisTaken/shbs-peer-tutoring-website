import { db } from "~/server/db";
import { lockAccountProfile } from "~/server/account-profile";
import { inTransaction, type DomainDb } from "~/server/transactions";
import { verifyUnsubscribeToken } from "./unsubscribe-token";
import { effectiveNotificationPreference, informationCategories, isNotificationCategory, notificationCategories, type NotificationCategory } from "~/lib/notification-categories";

export type UnsubscribeCategory = NotificationCategory | "info" | "review" | "reminder";
export type UnsubscribeScope = "category" | "all";
export type UnsubscribeStatus =
  | { status: "invalid" }
  | { status: "ready" | "already-unsubscribed"; category: UnsubscribeCategory };
export type UnsubscribeResult =
  | { status: "invalid" }
  | { status: "unsubscribed"; category: UnsubscribeCategory };

/** Legacy information rows map to the same preference; unknown categories fail closed. */
export function optionalEmailCategory(
  category: string,
): UnsubscribeCategory | null {
  return category === "messages" ||
    category === "review" ||
    category === "reminder"
    ? category
    : ["info", "information"].includes(category)
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
  const enabled =
    delivery.topic ? effectiveNotificationPreference(delivery.row.user, delivery.topic, delivery.row.user.notificationPreferences).emailEnabled :
    delivery.category === "messages"
      ? delivery.row.user.emailMessages
      : delivery.category === "review"
        ? delivery.row.user.emailReviewRequests
        : delivery.category === "reminder"
          ? delivery.row.user.emailEventReminders
          : delivery.row.user.emailInfo;
  return {
    status: enabled ? "ready" : "already-unsubscribed",
    category: delivery.category,
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
    const initial = await tx.emailDelivery.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!initial?.userId) return { status: "invalid" };
    // Match email removal/merge lock order, then re-check ownership under that lock.
    await lockAccountProfile(tx, initial.userId);
    const delivery = await eligibleDelivery(tx, id);
    if (delivery?.row.userId !== initial.userId) return { status: "invalid" };
    const legacy = scope === "all" || !delivery.topic;
    const stopMessages = scope === "all" || (legacy && delivery.category === "messages");
    const stopInfo = scope === "all" || (legacy && delivery.category === "info");
    const stopReview = scope === "all" || (legacy && delivery.category === "review");
    const stopReminders = scope === "all" || (legacy && delivery.category === "reminder");
    const topics: readonly NotificationCategory[] = scope === "all" ? notificationCategories : delivery.topic ? [delivery.topic] :
      stopInfo ? informationCategories : stopMessages ? ["messages"] : stopReview ? ["reviews"] : ["reminders"];
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
        OR: [{ preferenceTopic: { in: [...topics] } }, ...(legacy ? [{ category: {
          in: [
            ...(stopMessages ? ["messages"] : []),
            ...(stopInfo ? ["info", "information"] : []),
            ...(stopReview ? ["review"] : []),
            ...(stopReminders ? ["reminder"] : []),
          ],
        } }] : [])],
      },
      data: { status: "SKIPPED", completedAt: new Date(), leaseUntil: null },
    });
    return { status: "unsubscribed", category: delivery.category };
  });
}
