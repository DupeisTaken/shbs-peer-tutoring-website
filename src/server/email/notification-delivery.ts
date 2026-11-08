import { db } from "~/server/db";
import { admitIdentityNotice, finishIdentityNotice } from "./identity-notice-admission";
import { deferUntilCommit } from "~/server/db-scope";
import { emailSender, isEmailDeliveryAvailable } from "./sender";
import { emailUrl, notificationDestination } from "./urls";
import { notificationUnsubscribeUrl } from "./unsubscribe-token";
import { notificationEmailContent } from "./notification-copy";
import { requestNoticeEmailCopy } from "./request-notice-copy";
import {
  effectiveNotificationPreference,
  isNotificationCategory,
} from "~/lib/notification-categories";
import {
  eligibleReviewRecipient,
  notificationEmailDetail,
} from "./notification-policy";
import { queueEventReminders, validateEventReminder } from "./event-reminders";
import {
  remindUpcomingSchoolCalendar,
  schoolCalendarEmailEligible,
} from "../school-calendar-notifications";
import { monthlyHoursCategory } from "~/server/monthly-hours";
import {
  admitMonthlyHoursDelivery,
  finishMonthlyHoursDelivery,
  monthlyHoursDeliveryCopy,
} from "~/server/monthly-hours-delivery";
import {
  schoolHoursCategory,
  admitSchoolHoursDelivery,
  finishSchoolHoursDelivery,
  schoolHoursDeliveryCopy,
} from "~/server/school-hours-delivery";
import {
  admitRequestDelivery,
  finishRequestDelivery,
  requestServiceCategory,
} from "./request-notice";

/** SKIP LOCKED gives concurrent workers disjoint leases. Generic transport has
 * one admitted attempt; abandoned sends remain uncertain instead of replaying.
 * Request/report categories retain their owning admission protocol. */
export async function deliverNotifications(limit = 10, deadline?: number) {
  // Defer the entire lease/send/status workflow, otherwise a deferred SMTP call would
  // mark an outbox row SENT before transport actually accepted it.
  if (
    deferUntilCommit(async () => {
      await deliverNotifications(limit);
    })
  )
    return 0;
  // An admitted optional send is never fresh SMTP work, even when an older
  // worker returned it to PENDING after transport or abandoned its lease.
  await db.emailDelivery.updateMany({
    where: {
      category: { notIn: ["security", requestServiceCategory, monthlyHoursCategory, schoolHoursCategory] },
      attemptStartedAt: { not: null },
      OR: [
        { status: "PENDING" },
        { status: "SENDING", OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
      ],
    },
    data: { status: "UNCERTAIN", leaseUntil: null, lastError: "Transport admission ended without a recorded delivery outcome." },
  });
  const settings = await db.programSettings.findUnique({
    where: { id: "program" },
  });
  if (!settings?.emailNotificationsEnabled) {
    await db.emailDelivery.updateMany({
      where: {
        status: "PENDING",
        category: {
          notIn: ["security", requestServiceCategory, schoolHoursCategory],
        },
      },
      data: { status: "SKIPPED", completedAt: new Date() },
    });
  }
  if (
    !isEmailDeliveryAvailable("SECURITY") &&
    !isEmailDeliveryAvailable("PROGRAM")
  )
    return 0;
  // Freeze the candidate set before updating leases so eligibility changes do
  // not expand a bounded sweep; row locks still give concurrent workers disjoint rows.
  const rows = await db.$queryRaw<
    { id: string; leaseUntil: Date; attemptId: string | null }[]
  >`
    WITH candidates AS MATERIALIZED (SELECT id FROM "EmailDelivery" WHERE (status = 'PENDING'
      OR (status = 'SENDING' AND category IN ('request_service', 'monthly_hours', 'school_hours'))) AND "availableAt" <= NOW()
      AND NOT EXISTS(SELECT 1 FROM "RecoveryDeliveryEffect" e JOIN "RecoveryDeliveryCancellation" c ON c."effectId"=e.id WHERE e."deliveryId"="EmailDelivery".id)
      AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW()) ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    UPDATE "EmailDelivery" delivery SET "leaseUntil" = NOW() + INTERVAL '5 minutes'
    FROM candidates WHERE delivery.id = candidates.id
    RETURNING delivery.id, delivery."leaseUntil", delivery."attemptId"`;
  for (const [index, { id, leaseUntil, attemptId }] of rows.entries()) {
    if (deadline !== undefined && performance.now() >= deadline) {
      // The budget stops before another SMTP attempt, never interrupts one in
      // flight. Release only the exact unprocessed leases this batch acquired.
      await db.emailDelivery.updateMany({
        where: {
          status: { in: ["PENDING", "SENDING"] },
          OR: rows.slice(index).map((row) => ({
            id: row.id,
            leaseUntil: row.leaseUntil,
            attemptId: row.attemptId,
          })),
        },
        data: { leaseUntil: null },
      });
      return index;
    }
    const row = await db.emailDelivery.findUniqueOrThrow({
      where: { id },
      include: {
        user: { include: { emails: true, notificationPreferences: true } },
      },
    });
    if (!["PENDING", "SENDING"].includes(row.status)) continue;
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
    if (row.category === schoolHoursCategory) {
      const admitted = await admitSchoolHoursDelivery(
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
          messageId: `<school-hours-${id}@shbs-notifications>`,
          ...schoolHoursDeliveryCopy(admitted),
        });
        accepted = true;
      } catch {
        /* Keep transport diagnostics free of report tokens and addresses. */
      }
      await finishSchoolHoursDelivery(db, id, admitted.row.attemptId, accepted);
      continue;
    }
    if (row.category === monthlyHoursCategory) {
      const admitted = await admitMonthlyHoursDelivery(
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
          messageId: `<monthly-hours-${id}@shbs-notifications>`,
          ...monthlyHoursDeliveryCopy(admitted),
        });
        accepted = true;
      } catch {
        /* Completion retains only safe transport diagnostics. */
      }
      await finishMonthlyHoursDelivery(
        db,
        id,
        admitted.row.attemptId,
        accepted,
      );
      continue;
    }
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
    let transportAttempt: string | null = null;
    try {
      // Security notices are essential, including legacy emailSecurity=false. An
      // ordinary row with no account fails closed rather than taking a request path.
      const essential = row.category === "security";
      const user = row.user;
      const review = row.category === "review";
      const reminder = row.category === "reminder";
      const preference = essential
        ? true
        : user && isNotificationCategory(row.preferenceTopic)
          ? effectiveNotificationPreference(
              user,
              row.preferenceTopic,
              user.notificationPreferences,
            ).emailEnabled
          : review
            ? user?.emailReviewRequests
            : reminder
              ? user?.emailEventReminders
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
        (review && !eligibleReviewRecipient(user, row.event)) ||
        (reminder && !(await validateEventReminder(db, row))) ||
        // Generic historical mail retains its safe home-link fallback. Newly
        // detailed staff facts must not follow an account after staff access ends.
        (!essential &&
          notificationEmailDetail(row.event, row.context) &&
          row.destination?.startsWith("/admin") &&
          (user.suspendedAt ||
            !["HEAD", "ADMIN", "COORDINATOR"].includes(user.role))) ||
        (!owned && !row.previousPrimary) ||
        !(await schoolCalendarEmailEligible(db, row))
      ) {
        await db.emailDelivery.updateMany({
          where: {
            id,
            leaseUntil,
            attemptId,
            status: { in: ["PENDING", "SENDING"] },
          },
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
      // Only optional notification classes receive this narrowly scoped account capability.
      const unsubscribeUrl = [
        "messages",
        "info",
        "information",
        "review",
        "reminder",
      ].includes(row.category)
        ? notificationUnsubscribeUrl(id)
        : undefined;
      const content = notificationEmailContent({
        event: row.event,
        context: row.context,
        createdAt: row.createdAt,
        timeZone,
        category: row.category,
        link,
        unsubscribeUrl,
      });
      if (!essential) {
        transportAttempt = await admitIdentityNotice(db, id, leaseUntil, attemptId);
        if (!transportAttempt) continue;
      }
      const send = () =>
        emailSender.send({
          category,
          to: row.recipient,
          messageId: `<account-notice-${id}@shbs-notifications>`,
          ...content,
        });
      if (transportAttempt) {
        // Record provider acceptance separately from completion failure. A failed
        // database finish retains SENDING evidence and never becomes a false retry.
        let accepted = false;
        try {
          await send();
          accepted = true;
        } catch {
          /* Safe transport outcome only. */
        }
        await finishIdentityNotice(db, id, transportAttempt, accepted);
        continue;
      }
      await send();
      // Opt-out can cancel a leased row while SMTP is in flight. Do not resurrect
      // that cancellation when this attempt eventually completes or fails.
      await db.emailDelivery.updateMany({
        where: { id, leaseUntil, attemptId, status: "PENDING" },
        data: {
          status: "SENT",
          completedAt: new Date(),
          leaseUntil: null,
          attempts: { increment: 1 },
          lastError: null,
        },
      });
    } catch {
      // Completion may fail after provider acceptance. Never finish that exact
      // admitted attempt again as a transport failure or put it back in PENDING.
      if (transportAttempt)
        throw new Error(
          "Email completion failed; retained admitted delivery evidence.",
        );
      // Store a safe diagnostic, never provider exceptions containing addresses or credentials.
      const attempts = row.attempts + 1;
      await db.emailDelivery.updateMany({
        where: { id, leaseUntil, attemptId, status: "PENDING" },
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
  return rows.length;
}

const DRAIN_BUDGET_MS = 20_000;
const DRAIN_BATCH_SIZE = 10;
const DRAIN_MAX_BATCHES = 100;

/** Drain bursts serially in original queue order, preserving security/ordinary
 * fairness. Bound both elapsed admission time and work even with a static clock.
 * An SMTP attempt already in flight may finish after the twenty-second budget. */
export async function drainNotificationQueue(
  sendBatch: (
    limit: number,
    deadline: number,
  ) => Promise<number> = deliverNotifications,
  clock: () => number = () => performance.now(),
) {
  const deadline = clock() + DRAIN_BUDGET_MS;
  let processed = 0;
  for (
    let batch = 0;
    batch < DRAIN_MAX_BATCHES && clock() < deadline;
    batch++
  ) {
    const count = await sendBatch(DRAIN_BATCH_SIZE, deadline);
    processed += count;
    // Empty/unavailable transport and a partially drained final batch stop here.
    if (count < DRAIN_BATCH_SIZE) break;
  }
  return processed;
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
      try {
        await queueEventReminders();
      } catch {
        // A failed source scan must never stall security or already queued delivery.
        console.error(
          "[email-notifications] Reminder sweep failed; existing mail delivery will continue.",
        );
      }
      await drainNotificationQueue();
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
