import { db } from "~/server/db";
import { lockAccountProfile } from "~/server/account-profile";
import { inTransaction, type DomainDb } from "~/server/transactions";
import { verifyUnsubscribeToken } from "./unsubscribe-token";

export type UnsubscribeCategory = "messages" | "info";
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
  return category === "messages"
    ? "messages"
    : ["info", "information"].includes(category)
      ? "info"
      : null;
}

async function eligibleDelivery(client: DomainDb, deliveryId: string) {
  const row = await client.emailDelivery.findUnique({
    where: { id: deliveryId },
    include: { user: { include: { emails: true } } },
  });
  if (!row || row.user.mergedIntoId || row.previousPrimary) return null;
  const category = optionalEmailCategory(row.category);
  // Retired accounts and removed/unverified addresses cannot control current preferences.
  // A still-owned secondary address remains valid even if secondary delivery was disabled.
  const owned = row.user.emails.some(
    (address) => address.email === row.recipient && address.verifiedAt !== null,
  );
  return category && owned ? { row, category } : null;
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
    delivery.category === "messages"
      ? delivery.row.user.emailMessages
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
    if (!initial) return { status: "invalid" };
    // Match email removal/merge lock order, then re-check ownership under that lock.
    await lockAccountProfile(tx, initial.userId);
    const delivery = await eligibleDelivery(tx, id);
    if (delivery?.row.userId !== initial.userId)
      return { status: "invalid" };
    const stopMessages = scope === "all" || delivery.category === "messages";
    const stopInfo = scope === "all" || delivery.category === "info";
    await tx.user.update({
      where: { id: initial.userId },
      data: {
        ...(stopMessages ? { emailMessages: false } : {}),
        ...(stopInfo ? { emailInfo: false } : {}),
      },
    });
    // Include all verified recipient copies, including leased rows not yet sent. SMTP already
    // in flight cannot be recalled; future worker reads and enqueue triggers honor preferences.
    await tx.emailDelivery.updateMany({
      where: {
        userId: initial.userId,
        status: "PENDING",
        category: {
          in: [
            ...(stopMessages ? ["messages"] : []),
            ...(stopInfo ? ["info", "information"] : []),
          ],
        },
      },
      data: { status: "SKIPPED", completedAt: new Date(), leaseUntil: null },
    });
    return { status: "unsubscribed", category: delivery.category };
  });
}
