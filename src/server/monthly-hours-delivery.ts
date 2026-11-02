import { randomUUID } from "node:crypto";
import { lockUsernameNamespace } from "~/server/auth/username";
import { lockAccountProfile } from "~/server/account-profile";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { getFeatures } from "~/server/program/features";
import {
  monthlyHoursCategory,
  monthlyHoursLock,
  monthlyHoursSnapshotSchema,
} from "./monthly-hours";
import { monthlyHoursEmailCopy } from "./monthly-hours-email";
import { notificationUnsubscribeUrl } from "~/server/email/unsubscribe-token";
import { emailUrl } from "~/server/email/urls";

async function admissionReason(
  tx: TransactionDb,
  row: { userId: string | null; recipient: string },
) {
  const [config, settings, features, user] = await Promise.all([
    tx.monthlyHoursSchedule.findUnique({ where: { id: "program" } }),
    tx.programSettings.findUnique({ where: { id: "program" } }),
    getFeatures(tx),
    row.userId
      ? tx.user.findUnique({
          where: { id: row.userId },
          include: { emails: true },
        })
      : null,
  ]);
  if (!config?.enabled) return "SCHEDULE_OFF";
  if (!features.SERVICE_HOURS) return "FEATURE_OFF";
  if (!settings?.emailNotificationsEnabled) return "EMAIL_OFF";
  if (!user || user.suspendedAt || user.mergedIntoId)
    return "UNAVAILABLE_ACCOUNT";
  if (!["ADMIN", "HEAD"].includes(user.role)) return "ROLE_CHANGED";
  if (!config.recipientUserIds.includes(user.id)) return "NOT_SELECTED";
  if (!user.emailInfo) return "OPTED_OUT";
  if (
    !user.emails.some(
      (address) =>
        address.email === row.recipient &&
        address.verifiedAt &&
        (address.email === user.email || user.emailSecondaryRecipients),
    )
  )
    return "NO_VERIFIED_ADDRESS";
  return null;
}

/** Period, namespace and optional-mail fences precede account, schedule and outbox
 * locks. This matches refresh, identity edits and preference updates. The claimed lease and
 * previous attempt are inputs, so a paused worker cannot borrow a newer lease. */
export async function admitMonthlyHoursDelivery(
  db: DomainDb,
  id: string,
  leaseUntil: Date | null,
  expectedAttemptId: string | null,
) {
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
    const reason = await admissionReason(tx, row);
    if (reason || row.attempts >= 5) {
      await tx.emailDelivery.update({
        where: { id },
        data: {
          status: reason ? "SKIPPED" : "FAILED",
          completedAt: new Date(),
          leaseUntil: null,
          lastError: reason ?? "Email delivery exhausted its retry budget.",
        },
      });
      return null;
    }
    const report = await tx.monthlyHoursReport.findUniqueOrThrow({
      where: { id: row.monthlyHoursReportId! },
    });
    const admitted = await tx.emailDelivery.update({
      where: { id },
      data: {
        status: "SENDING",
        attemptId: randomUUID(),
        attemptStartedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    return { row: admitted, report };
  });
}

/** Rendering is inside the dispatcher's failure boundary after the admitted
 * attempt commits, so bad origin/configuration failures remain bounded retries. */
export function monthlyHoursDeliveryCopy(
  admitted: NonNullable<Awaited<ReturnType<typeof admitMonthlyHoursDelivery>>>,
) {
  const { row, report } = admitted;
  return monthlyHoursEmailCopy({
    snapshot: monthlyHoursSnapshotSchema.parse(report.snapshot),
    revision: report.revision,
    generatedAt: report.generatedAt,
    timeZone: report.timeZone,
    reason: report.reason,
    reportUrl: emailUrl(`/admin/service-hours/reports/${report.id}`),
    unsubscribeUrl: notificationUnsubscribeUrl(row.id),
  });
}

/** SMTP acceptance is retained even after later cancellation. Stale completions
 * cannot overwrite a newer attempt; failures recheck current authorization. */
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
    const reason = sent ? null : await admissionReason(tx, row);
    await tx.emailDelivery.update({
      where: { id },
      data: {
        status: sent
          ? "SENT"
          : reason
            ? "SKIPPED"
            : row.attempts >= 5
              ? "FAILED"
              : "PENDING",
        completedAt: sent || reason || row.attempts >= 5 ? new Date() : null,
        leaseUntil: null,
        availableAt: new Date(Date.now() + 60_000 * 2 ** row.attempts),
        lastError: sent
          ? null
          : (reason ??
            "Email delivery failed; check the configured transport."),
      },
    });
  });
}
