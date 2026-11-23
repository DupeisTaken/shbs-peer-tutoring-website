import type { EmailDelivery, MonthlyHoursReport } from "../../generated/prisma";
import { lockUsernameNamespace } from "~/server/auth/username";
import { lockAccountProfile } from "~/server/account-profile";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";
import { monthlyHoursCategory, monthlyHoursLock } from "./monthly-hours";

/** Period, namespace and optional-mail fences precede account, schedule and outbox
 * locks. This matches refresh, identity edits and preference updates. The claimed lease and
 * previous attempt are inputs, so a paused worker cannot borrow a newer lease.
 * Retired overview mail is never admitted, even if a stale schedule was enabled.
 * Keep the historical admission shape while the dispatcher drains old receipts. */
export async function admitMonthlyHoursDelivery(
  db: DomainDb,
  id: string,
  leaseUntil: Date | null,
  expectedAttemptId: string | null,
): Promise<{ row: EmailDelivery; report: MonthlyHoursReport } | null> {
  return inTransaction(db, async (tx) => {
    const observed = await tx.emailDelivery.findUnique({ where: { id } });
    if (
      observed?.category !== monthlyHoursCategory ||
      !observed.monthlyHoursReportId
    )
      return null;
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockEntity(tx, "email-notifications-setting");
    if (observed.userId) await lockAccountProfile(tx, observed.userId);
    await lockEntity(tx, monthlyHoursLock);
    await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.emailDelivery.findUniqueOrThrow({ where: { id } });
    if (
      !["PENDING", "SENDING"].includes(row.status) ||
      !leaseUntil ||
      leaseUntil.getTime() <= Date.now() ||
      row.leaseUntil?.getTime() !== leaseUntil.getTime() ||
      row.attemptId !== expectedAttemptId
    )
      return null;
    await tx.emailDelivery.update({
      where: { id },
      data: {
        status: "SKIPPED",
        completedAt: new Date(),
        leaseUntil: null,
        lastError: "WORKFLOW_REPLACED",
      },
    });
    return null;
  });
}

/** Preserve acceptance evidence from an already admitted pre-upgrade send.
 * Stale completions cannot overwrite a newer attempt or a retired receipt;
 * failed old sends become retired evidence and can never schedule a retry. */
export async function finishMonthlyHoursDelivery(
  db: DomainDb,
  id: string,
  attemptId: string,
  sent: boolean,
) {
  return inTransaction(db, async (tx) => {
    const observed = await tx.emailDelivery.findUnique({ where: { id } });
    if (observed?.category !== monthlyHoursCategory) return;
    await lockEntity(tx, "program:period");
    await lockUsernameNamespace(tx);
    await lockEntity(tx, "email-notifications-setting");
    if (observed.userId) await lockAccountProfile(tx, observed.userId);
    await lockEntity(tx, monthlyHoursLock);
    await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id = ${id} FOR UPDATE`;
    const row = await tx.emailDelivery.findUniqueOrThrow({ where: { id } });
    if (row.status !== "SENDING" || row.attemptId !== attemptId) return;
    await tx.emailDelivery.update({
      where: { id },
      data: {
        status: sent ? "SENT" : "SKIPPED",
        completedAt: new Date(),
        leaseUntil: null,
        lastError: sent ? null : "WORKFLOW_REPLACED",
      },
    });
  });
}
