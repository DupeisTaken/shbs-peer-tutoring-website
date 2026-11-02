import { db } from "~/server/db";
import { deferUntilCommit } from "~/server/db-scope";
import { emailSender, isEmailDeliveryAvailable } from "./sender";
import { emailUrl, notificationDestination } from "./urls";
import { notificationUnsubscribeUrl } from "./unsubscribe-token";
import { notificationEmailCopy } from "./notification-copy";
import { requestNoticeEmailCopy } from "./request-notice-copy";
import {
  remindUpcomingSchoolCalendar,
  schoolCalendarEmailEligible,
} from "../school-calendar-notifications";
import {
  admitRequestDelivery,
  finishRequestDelivery,
  requestServiceCategory,
} from "./request-notice";

/** Leased batches survive restarts and SKIP LOCKED keeps concurrent application workers independent.
 * SMTP has no exactly-once guarantee: a crash after acceptance may retry, but ordinary concurrent
 * dispatches cannot send the same row. A stable Message-ID further identifies retries. */
export async function deliverNotifications(limit = 10) {
  // Defer the entire lease/send/status workflow, otherwise a deferred SMTP call would
  // mark an outbox row SENT before transport actually accepted it.
  if (deferUntilCommit(() => deliverNotifications(limit))) return;
  const settings = await db.programSettings.findUnique({
    where: { id: "program" },
  });
  if (!settings?.emailNotificationsEnabled) {
    await db.emailDelivery.updateMany({
      where: {
        status: "PENDING",
        category: { notIn: ["security", requestServiceCategory] },
      },
      data: { status: "SKIPPED", completedAt: new Date() },
    });
  }
  if (
    !isEmailDeliveryAvailable("SECURITY") &&
    !isEmailDeliveryAvailable("PROGRAM")
  )
    return;
  // Freeze the candidate set before updating leases so eligibility changes do
  // not expand a bounded sweep; row locks still give concurrent workers disjoint rows.
  const rows = await db.$queryRaw<
    { id: string; leaseUntil: Date; attemptId: string | null }[]
  >`
    WITH candidates AS MATERIALIZED (SELECT id FROM "EmailDelivery" WHERE (status = 'PENDING'
      OR (status = 'SENDING' AND category = 'request_service')) AND "availableAt" <= NOW()
      AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW()) ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    UPDATE "EmailDelivery" delivery SET "leaseUntil" = NOW() + INTERVAL '5 minutes'
    FROM candidates WHERE delivery.id = candidates.id
    RETURNING delivery.id, delivery."leaseUntil", delivery."attemptId"`;
  for (const { id, leaseUntil, attemptId } of rows) {
    const row = await db.emailDelivery.findUniqueOrThrow({
      where: { id },
      include: { user: { include: { emails: true } } },
    });
    if (
      row.status !== "PENDING" &&
      !(row.category === requestServiceCategory && row.status === "SENDING")
    )
      continue;
    // Account security notices are essential; other notifications are program mail.
    const category = row.category === "security" ? "SECURITY" : "PROGRAM";
    if (!isEmailDeliveryAvailable(category)) {
      // Defer unavailable-category notices without consuming a delivery attempt.
      await db.emailDelivery.updateMany({
        where: {
          id,
          leaseUntil,
          attemptId: attemptId ?? null,
          status: { in: ["PENDING", "SENDING"] },
        },
        data: { leaseUntil: null, availableAt: new Date(Date.now() + 60_000) },
      });
      continue;
    }
    const current = await db.programSettings.findUnique({
      where: { id: "program" },
    });
    if (row.category === requestServiceCategory) {
      // Preserve the lease/fence from the UPDATE itself. A paused older candidate
      // must not borrow a newer worker's lease from this later row read.
      const admitted = await admitRequestDelivery(
        db,
        id,
        leaseUntil,
        attemptId,
      );
      if (!admitted?.row.attemptId) continue;
      let accepted = false;
      try {
        await emailSender.send({
          category: "PROGRAM",
          to: admitted.row.recipient,
          messageId: `<account-notice-${id}@shbs-notifications>`,
          ...requestNoticeEmailCopy(
            admitted.row,
            admitted.verified,
            admitted.appealUrl,
          ),
        });
        accepted = true;
      } catch {
        // The provider outcome is recorded separately from a database-completion
        // failure. If recording fails after acceptance, retain SENDING evidence.
      }
      await finishRequestDelivery(db, id, admitted.row.attemptId, accepted);
      continue;
    }
    try {
      // Security notices are essential, including legacy emailSecurity=false. An
      // ordinary row with no account fails closed rather than taking a request path.
      const essential = row.category === "security";
      const user = row.user;
      const preference = essential
        ? true
        : row.category === "messages"
          ? user?.emailMessages
          : user?.emailInfo;
      const owned = user?.emails.some(
        (address) =>
          address.email === row.recipient &&
          address.verifiedAt &&
          (address.email === user.email || user.emailSecondaryRecipients),
      );
      if (
        !user ||
        user.mergedIntoId ||
        (!essential && !current?.emailNotificationsEnabled) ||
        !preference ||
        (!owned && !row.previousPrimary) ||
        !(await schoolCalendarEmailEligible(db, row))
      ) {
        await db.emailDelivery.updateMany({
          where: { id, status: "PENDING" },
          data: {
            status: "SKIPPED",
            completedAt: new Date(),
            leaseUntil: null,
          },
        });
        continue;
      }
      // Build inside the retry boundary: bad origin configuration releases the lease.
      const link = emailUrl(
        notificationDestination(
          row.category,
          row.event,
          row.destination,
          user.role,
        ),
      );
      const timeZone = current?.timeZone ?? "Asia/Shanghai";
      const time = new Intl.DateTimeFormat("en", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone,
      }).format(row.createdAt);
      const copy = notificationEmailCopy(row.event, row.context);
      const footer = essential
        ? "If you do not recognize this activity, contact the program team through private support.\n如非本人操作，请通过私密支持联系项目团队。"
        : "Sign in to review the update. You can manage optional email notifications in account settings.\n请登录查看通知。您可在账户设置中管理可选邮件通知。";
      // Only optional notification classes receive this narrowly scoped account capability.
      const unsubscribeUrl = ["messages", "info", "information"].includes(
        row.category,
      )
        ? notificationUnsubscribeUrl(id)
        : undefined;
      await emailSender.send({
        category,
        to: row.recipient,
        subject: copy.subject,
        messageId: `<account-notice-${id}@shbs-notifications>`,
        text: `${copy.description}\n\nNotice issued: ${time} (${timeZone}) / 通知发出时间\n\n${footer}\n\n${link}${unsubscribeUrl ? `\n\nUnsubscribe / 取消订阅: ${unsubscribeUrl}` : ""}`,
        presentation: {
          ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
          eyebrow: essential
            ? "ACCOUNT SECURITY"
            : row.category === "messages"
              ? "PRIVATE MESSAGES"
              : "PROGRAM UPDATE",
          action: {
            label: copy.action,
            url: link,
          },
        },
      });
      // Opt-out can cancel a leased row while SMTP is in flight. Do not resurrect
      // that cancellation when this attempt eventually completes or fails.
      await db.emailDelivery.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "SENT",
          completedAt: new Date(),
          leaseUntil: null,
          attempts: { increment: 1 },
          lastError: null,
        },
      });
    } catch {
      // Store a safe diagnostic, never provider exceptions containing addresses or credentials.
      const attempts = row.attempts + 1;
      await db.emailDelivery.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: attempts >= 5 ? "FAILED" : "PENDING",
          attempts,
          leaseUntil: null,
          availableAt: new Date(Date.now() + 60_000 * 2 ** attempts),
          lastError: "Email delivery failed; check the configured transport.",
        },
      });
    }
  }
}

const state = globalThis as typeof globalThis & {
  notificationWorker?: ReturnType<typeof setInterval>;
};
export function startNotificationWorker() {
  if (state.notificationWorker) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      // Calendar receipts are durable and idempotent; the existing bounded worker
      // owns this small sweep rather than creating a second process-local timer.
      try {
        await remindUpcomingSchoolCalendar(db);
      } catch {
        console.error(
          "[school-calendar] Reminder sweep failed; retrying on the next delivery sweep.",
        );
      }
      await deliverNotifications();
    } catch {
      console.error(
        "[email-notifications] Delivery sweep failed; check database and transport availability.",
      );
    } finally {
      running = false;
    }
  };
  state.notificationWorker = setInterval(() => void run(), 30_000);
  state.notificationWorker.unref();
  void run();
}
