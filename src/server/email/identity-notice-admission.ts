import { randomUUID } from "node:crypto";
import { notificationOwnershipWhere } from "../history-row-ownership";
import { inTransaction, type DomainDb } from "../transactions";

/** No SMTP is performed while locks are held. Correction and this exact
 * pre-transport admission serialize; admitted/sent mail cannot be recalled. */
export async function admitIdentityNotice(db: DomainDb, id: string, leaseUntil: Date, priorAttemptId: string | null) {
  return inTransaction(db, async (tx) => {
    await tx.$executeRaw`LOCK TABLE "RetiredHistoryOwnership", "HistoryRowOwnership" IN SHARE MODE`;
    const row = await tx.emailDelivery.findUnique({ where: { id } });
    if (row?.status !== "PENDING" || row.attemptStartedAt || row.leaseUntil?.getTime() !== leaseUntil.getTime() || row.attemptId !== priorAttemptId) return null;
    const decision = await tx.historyRowOwnership.findUnique({ where: { entity_recordId: { entity: "EmailDelivery", recordId: id } } });
    const withheld = decision?.readerUserId === null || (!!row.sourceNotificationId && (!row.userId || !(await tx.notification.count({ where: { id: row.sourceNotificationId, AND: [await notificationOwnershipWhere(tx, row.userId)] } }))));
    if (withheld) {
      await tx.emailDelivery.updateMany({ where: { id, status: "PENDING", leaseUntil, attemptId: priorAttemptId }, data: { status: "CANCELLED", completedAt: new Date(), leaseUntil: null } });
      return null;
    }
    const attemptId = randomUUID();
    const changed = await tx.emailDelivery.updateMany({ where: { id, status: "PENDING", leaseUntil, attemptId: priorAttemptId, attemptStartedAt: null }, data: { status: "SENDING", attemptId, attemptStartedAt: new Date() } });
    return changed.count === 1 ? attemptId : null;
  });
}

/** A provider/database failure after admission is uncertain, not permission to
 * replay an old private notice. Its exact attempt remains inspectable. */
export async function finishIdentityNotice(db: DomainDb, id: string, attemptId: string, accepted: boolean) {
  await db.emailDelivery.updateMany({ where: { id, attemptId, status: "SENDING" }, data: {
    status: accepted ? "SENT" : "UNCERTAIN", completedAt: new Date(), leaseUntil: null,
    attempts: { increment: 1 }, lastError: accepted ? null : "Transport was admitted; delivery outcome needs review before any retry.",
  } });
}
