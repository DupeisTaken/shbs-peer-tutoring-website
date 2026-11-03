import { notificationOwnershipWhere } from "../history-row-ownership";
import type { DomainDb } from "../transactions";
import {
  admitRecoveryGenericDelivery,
  finishRecoveryGenericDelivery,
  type RecoveryGenericDeliveryGuard,
} from "../recovery/delivery-effects";

const identityGuard: RecoveryGenericDeliveryGuard = {
  async lock(tx) {
    await tx.$executeRaw`LOCK TABLE "RetiredHistoryOwnership", "HistoryRowOwnership" IN SHARE MODE`;
  },
  async withheld(tx, row) {
    if (!row.userId) return true;
    const account = await tx.user.findUnique({ where: { id: row.userId }, select: {
      mergedIntoId: true, recoveryVoidedAt: true, suspendedAt: true,
    } });
    if (!account || account.mergedIntoId || account.recoveryVoidedAt || account.suspendedAt) return true;
    const decision = await tx.historyRowOwnership.findUnique({
      where: { entity_recordId: { entity: "EmailDelivery", recordId: row.id } },
    });
    if (decision && decision.readerUserId !== row.userId) return true;
    if (!row.sourceNotificationId) return false; // Legacy provenance is not invented.
    return !(await tx.notification.count({ where: {
      id: row.sourceNotificationId, recoveryWithdrawnAt: null,
      AND: [await notificationOwnershipWhere(tx, row.userId)],
    } }));
  },
};

/** One transaction and attempt: ownership tables, all exact causal roots, then
 * the delivery row. Independent notices receive the same identity check. */
export async function admitIdentityNotice(db: DomainDb, id: string, leaseUntil: Date, priorAttemptId: string | null) {
  const admitted = await admitRecoveryGenericDelivery(db, id, leaseUntil, priorAttemptId, identityGuard);
  return admitted && !admitted.independent ? admitted.attemptId : null;
}

/** Exact late acceptance can settle uncertainty after ownership changed; no
 * completion authorizes another send or copies content to the new reader. */
export async function finishIdentityNotice(db: DomainDb, id: string, attemptId: string, accepted: boolean) {
  return finishRecoveryGenericDelivery(db, id, attemptId, accepted, identityGuard);
}
