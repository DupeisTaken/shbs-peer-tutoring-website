import { notificationOwnershipWhere } from "../history-row-ownership";
import type { EmailDelivery } from "../../../generated/prisma";
import { inTransaction, type DomainDb } from "../transactions";
import { validateEventReminder } from "./event-reminders";
import {
  isReminderSourceBusy,
  lockEventReminderSource,
} from "./reminder-source-locks";
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
    const account = await tx.user.findUnique({
      where: { id: row.userId },
      select: {
        mergedIntoId: true,
        recoveryVoidedAt: true,
        suspendedAt: true,
      },
    });
    if (
      !account ||
      account.mergedIntoId ||
      account.recoveryVoidedAt ||
      account.suspendedAt
    )
      return true;
    const decision = await tx.historyRowOwnership.findUnique({
      where: { entity_recordId: { entity: "EmailDelivery", recordId: row.id } },
    });
    if (decision && decision.readerUserId !== row.userId) return true;
    if (!row.sourceNotificationId) return false; // Legacy provenance is not invented.
    return !(await tx.notification.count({
      where: {
        id: row.sourceNotificationId,
        recoveryWithdrawnAt: null,
        AND: [await notificationOwnershipWhere(tx, row.userId)],
      },
    }));
  },
};

/** One transaction and attempt: ownership tables, all exact causal roots, then
 * the delivery row. Independent notices receive the same identity check. */
export async function admitIdentityNotice(
  db: DomainDb,
  id: string,
  leaseUntil: Date,
  priorAttemptId: string | null,
) {
  const admitted = await admitRecoveryGenericDelivery(
    db,
    id,
    leaseUntil,
    priorAttemptId,
    identityGuard,
  );
  return admitted && !admitted.independent ? admitted.attemptId : null;
}

/** Reminder source/recipient eligibility and the exact transport stamp share one
 * transaction. The early dispatcher check is only an inexpensive rejection.
 */
type ReminderSelection = Pick<
  EmailDelivery,
  | "userId"
  | "recipient"
  | "event"
  | "reminderKey"
  | "context"
  | "category"
  | "preferenceTopic"
  | "destination"
>;
function reminderSelection(row: ReminderSelection) {
  return JSON.stringify([
    row.userId,
    row.recipient,
    row.event,
    row.reminderKey,
    row.category,
    row.preferenceTopic,
    row.destination,
    row.context,
  ]);
}
export async function admitReminderNotice(
  db: DomainDb,
  id: string,
  leaseUntil: Date,
  priorAttemptId: string | null,
  expected?: ReminderSelection,
) {
  return inTransaction(db, async (tx) => {
    // DomainDb also accepts a caller-owned transaction. A failed NOWAIT statement
    // aborts its current subtransaction; rollback must precede lease recovery.
    // The savepoint also releases a partial source-lock prefix and restores the
    // caller's lock_timeout when a try-lock reports ordinary contention.
    await tx.$executeRaw`SAVEPOINT reminder_admission_scope`;
    try {
      const [previous] = await tx.$queryRaw<Array<{ timeout: string }>>`
        SELECT current_setting('lock_timeout') AS timeout`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '250ms'`;
      let preparedSelection: string | undefined;
      let sourcePresent = false;
      const admitted = await admitRecoveryGenericDelivery(
        tx,
        id,
        leaseUntil,
        priorAttemptId,
        {
          ...identityGuard,
          async prepare(client, deliveryId) {
            const row = await client.emailDelivery.findUnique({
              where: { id: deliveryId },
            });
            if (
              row?.status === "PENDING" &&
              !row.attemptStartedAt &&
              row.leaseUntil?.getTime() === leaseUntil.getTime() &&
              row.attemptId === priorAttemptId &&
              (!expected ||
                reminderSelection(row) === reminderSelection(expected))
            ) {
              preparedSelection = reminderSelection(row);
              sourcePresent = await lockEventReminderSource(client, row);
            }
          },
          eligible: (client, row) =>
            sourcePresent && preparedSelection === reminderSelection(row)
              ? validateEventReminder(client, row)
              : Promise.resolve(false),
        },
      );
      await tx.$queryRaw`SELECT set_config('lock_timeout', ${previous?.timeout ?? "0"}, true)`;
      await tx.$executeRaw`RELEASE SAVEPOINT reminder_admission_scope`;
      return admitted && !admitted.independent ? admitted.attemptId : null;
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT reminder_admission_scope`;
      await tx.$executeRaw`RELEASE SAVEPOINT reminder_admission_scope`;
      if (!isReminderSourceBusy(error)) throw error;
      // A source writer won the fence. Release only this worker's unchanged lease;
      // the next poll revalidates current state without spending an SMTP attempt.
      await tx.emailDelivery.updateMany({
        where: {
          id,
          status: "PENDING",
          leaseUntil,
          attemptId: priorAttemptId,
          attemptStartedAt: null,
        },
        data: { leaseUntil: null, availableAt: new Date(Date.now() + 30_000) },
      });
      return null;
    }
  });
}

/** Exact late acceptance can settle uncertainty after ownership changed; no
 * completion authorizes another send or copies content to the new reader. */
export async function finishIdentityNotice(
  db: DomainDb,
  id: string,
  attemptId: string,
  accepted: boolean,
) {
  return finishRecoveryGenericDelivery(
    db,
    id,
    attemptId,
    accepted,
    identityGuard,
  );
}
