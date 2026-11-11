import { randomUUID } from "node:crypto";
import { APP_TITLE } from "~/lib/branding";
import { DEFAULT_EMAIL_LOCALE, type EmailLocale } from "~/lib/email-locale";
import { z } from "zod";
import { lockUsernameNamespace } from "~/server/auth/username-namespace";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import { getFeatures } from "~/server/program/features";
import { isEmailDeliveryAvailable } from "~/server/email/sender";
import { emailOrigin } from "~/server/email/urls";
import {
  issueSchoolHoursToken,
  schoolHoursTokenMatches,
} from "./school-hours-link";
import { publicSchoolHoursReport } from "./school-hours-public";
import { schoolHoursRecipientEmailCopy } from "./school-hours-recipient-email";
import { issueSchoolHoursRecipientToken } from "./school-hours-recipient-token";

export const schoolHoursCategory = "school_hours";
const chainLock = "school-hours-chain";
const mailbox = z.string().email().max(254);

/** Global mail-off is a recoverable block for school instructions, not an opt-out
 * account notification. External recipients need no site account or emailInfo flag. */
async function deliveryState(
  tx: TransactionDb,
  row: {
    recipient: string;
    schoolHoursReportId: string | null;
    schoolHoursReminderSourceId: string | null;
    schoolHoursReminderLinkVersion: number | null;
  },
) {
  const [config, settings, features, report] = await Promise.all([
    tx.schoolHoursSchedule.findUnique({ where: { id: "program" } }),
    tx.programSettings.findUnique({ where: { id: "program" } }),
    getFeatures(tx),
    row.schoolHoursReportId
      ? tx.schoolHoursReport.findUnique({
          where: { id: row.schoolHoursReportId },
        })
      : null,
  ]);
  const skipped = (reason: string) => ({ status: "SKIPPED" as const, reason });
  const blocked = (reason: string) => ({ status: "BLOCKED" as const, reason });
  if (!report) return { report, failure: skipped("REPORT_UNAVAILABLE") };
  if (report.supersededById)
    return { report, failure: skipped("REPORT_SUPERSEDED") };
  if (report.linkRevokedAt) return { report, failure: skipped("LINK_REVOKED") };
  if (!config || (!row.schoolHoursReminderSourceId && !config.enabled))
    return { report, failure: skipped("SCHEDULE_OFF") };
  if (
    row.schoolHoursReminderSourceId &&
    row.schoolHoursReminderLinkVersion !== report.linkVersion
  )
    return { report, failure: skipped("LINK_CHANGED") };
  if (!mailbox.safeParse(row.recipient).success)
    return { report, failure: blocked("INVALID_RECIPIENT") };
  if (
    !config.recipientEmails.includes(row.recipient) ||
    !report.intendedRecipients.includes(row.recipient)
  )
    return { report, failure: skipped("RECIPIENT_REMOVED") };
  if (!settings?.emailNotificationsEnabled)
    return { report, failure: blocked("EMAIL_OFF") };
  if (!features.SERVICE_HOURS)
    return { report, failure: blocked("FEATURE_OFF") };
  if (!isEmailDeliveryAvailable("PROGRAM"))
    return { report, failure: blocked("TRANSPORT_UNAVAILABLE") };
  try {
    const token = issueSchoolHoursToken(report.id, report.linkVersion);
    if (!schoolHoursTokenMatches(token, report.linkTokenHash))
      return { report, failure: blocked("LINK_REISSUE_REQUIRED") };
  } catch {
    return { report, failure: blocked("LINK_REISSUE_REQUIRED") };
  }
  return { report, failure: null };
}

async function lockSchoolHoursDelivery(tx: TransactionDb, id: string) {
  // Match generation, refresh and source-identity writers before the chain and
  // outbox row; no SMTP operation holds these database locks.
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
  await lockEntity(tx, "email-notifications-setting");
  await lockEntity(tx, chainLock);
  await tx.$queryRaw`SELECT id FROM "EmailDelivery" WHERE id = ${id} FOR UPDATE`;
}

export async function admitSchoolHoursDelivery(
  db: DomainDb,
  id: string,
  leaseUntil: Date | null,
  expectedAttemptId: string | null,
) {
  return inTransaction(db, async (tx) => {
    const observed = await tx.emailDelivery.findUnique({ where: { id } });
    if (
      observed?.category !== schoolHoursCategory ||
      !observed.schoolHoursReportId
    )
      return null;
    await lockSchoolHoursDelivery(tx, id);
    const row = await tx.emailDelivery.findUniqueOrThrow({ where: { id } });
    if (
      !["PENDING", "SENDING"].includes(row.status) ||
      (row.schoolHoursScheduledFor &&
        row.schoolHoursScheduledFor.getTime() > Date.now()) ||
      !leaseUntil ||
      leaseUntil.getTime() <= Date.now() ||
      row.leaseUntil?.getTime() !== leaseUntil.getTime() ||
      row.attemptId !== expectedAttemptId
    )
      return null;
    const { report, failure } = await deliveryState(tx, row);
    if (failure || !report || row.attempts >= 5) {
      await tx.emailDelivery.update({
        where: { id },
        data: {
          status: failure?.status ?? "FAILED",
          completedAt: new Date(),
          leaseUntil: null,
          lastError:
            failure?.reason ?? "Email delivery exhausted its retry budget.",
        },
      });
      return null;
    }
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

export function schoolHoursDeliveryCopy(
  admitted: NonNullable<Awaited<ReturnType<typeof admitSchoolHoursDelivery>>>,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
) {
  const { report } = admitted;
  const token = issueSchoolHoursToken(report.id, report.linkVersion);
  // A secret rotation between admission and rendering must not send a broken
  // replacement capability. The existing issued link remains hash-authorized.
  if (!schoolHoursTokenMatches(token, report.linkTokenHash))
    throw new Error("School report link requires reissue.");
  return schoolHoursRecipientEmailCopy({
    brand: APP_TITLE,
    iconUrl: `${emailOrigin()}/icon.png`,
    locale,
    report: publicSchoolHoursReport(report.snapshot),
    reportUrl: `${emailOrigin()}/reports/service-hours/${encodeURIComponent(issueSchoolHoursRecipientToken({ ...admitted.row, schoolHoursReportId: report.id }, report.linkVersion))}`,
    reminder: !!admitted.row.schoolHoursReminderSourceId,
  });
}

export async function finishSchoolHoursDelivery(
  db: DomainDb,
  id: string,
  attemptId: string,
  sent: boolean,
) {
  return inTransaction(db, async (tx) => {
    const observed = await tx.emailDelivery.findUnique({ where: { id } });
    if (observed?.category !== schoolHoursCategory) return;
    await lockSchoolHoursDelivery(tx, id);
    const row = await tx.emailDelivery.findUniqueOrThrow({ where: { id } });
    if (row.status !== "SENDING" || row.attemptId !== attemptId) return;
    const failure = sent ? null : (await deliveryState(tx, row)).failure;
    await tx.emailDelivery.update({
      where: { id },
      data: {
        status: sent
          ? "SENT"
          : failure
            ? failure.status
            : row.attempts >= 5
              ? "FAILED"
              : "PENDING",
        completedAt: sent || failure || row.attempts >= 5 ? new Date() : null,
        availableAt: new Date(Date.now() + 60_000 * 2 ** row.attempts),
        leaseUntil: null,
        lastError: sent
          ? null
          : (failure?.reason ??
            "Email delivery failed; check the configured transport."),
      },
    });
  });
}
