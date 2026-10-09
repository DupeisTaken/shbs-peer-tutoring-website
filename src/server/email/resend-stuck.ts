import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";
import { isEmailDeliveryAvailable } from "./sender";

const batchLimit = 100;

/** Requeue existing evidence; the normal worker owns transport, preferences and recipient checks.
 * Sharing the settings lock makes disabling optional mail authoritative across concurrent requests.
 * Row locks coordinate with worker leases; resetting attempts makes already-requeued rows ineligible. */
export async function resendStuckEmails(
  database: DomainDb,
  actor: { id: string; name?: string | null },
) {
  return inTransaction(database, async (tx) => {
    await lockEntity(tx, "email-notifications-setting");
    const settings = await tx.programSettings.findUnique({
      where: { id: "program" },
      select: { emailNotificationsEnabled: true },
    });
    // Missing production configuration cannot be repaired by resetting retry evidence. A failed
    // cached SMTP check, however, must not prevent a deliberate retry after operators repair SMTP.
    const securityAvailable = isEmailDeliveryAvailable("SECURITY");
    const programAvailable =
      !!settings?.emailNotificationsEnabled &&
      isEmailDeliveryAvailable("PROGRAM");
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "EmailDelivery"
      SET status = 'PENDING', attempts = 0, "availableAt" = NOW(),
          "leaseUntil" = NULL, "completedAt" = NULL, "lastError" = NULL
      WHERE id IN (
        SELECT id FROM "EmailDelivery"
        WHERE (status = 'FAILED' OR (status = 'PENDING' AND attempts > 0))
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= NOW())
          AND ((category = 'security' AND ${securityAvailable})
            OR (category <> 'security' AND ${programAvailable}))
        ORDER BY "createdAt", id
        LIMIT ${batchLimit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;
    const queued = rows.length;
    // Aggregate-only audit evidence commits atomically with the queue change; no recipients,
    // destinations, message contents or provider errors are copied into staff-visible logs.
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        userName: actor.name,
        operation: "program.resendStuckEmails",
        action: "Queued stuck email deliveries for retry",
        entity: "EmailDelivery",
        details: { queued, batchLimit },
      },
    });
    return { queued };
  });
}
