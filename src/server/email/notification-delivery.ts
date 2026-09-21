import { db } from "~/server/db";
import { emailSender, isEmailDeliveryAvailable } from "./sender";

const descriptions: Record<string, string> = {
  primary_changed: "Your primary account email changed",
  secondary_added: "A secondary email was verified on your account",
  secondary_removed: "A secondary email was removed from your account",
  security_changed: "Your account security settings changed",
  information_changed: "Your account information changed",
  message_received: "You have a new private message",
  program_update: "You have a new program notification",
};

/** Leased batches survive restarts and SKIP LOCKED keeps concurrent application workers independent.
 * SMTP has no exactly-once guarantee: a crash after acceptance may retry, but ordinary concurrent
 * dispatches cannot send the same row. A stable Message-ID further identifies retries. */
export async function deliverNotifications(limit = 10) {
  const settings = await db.programSettings.findUnique({
    where: { id: "program" },
  });
  if (!settings?.emailNotificationsEnabled) {
    await db.emailDelivery.updateMany({
      where: { status: "PENDING", category: { not: "security" } },
      data: { status: "SKIPPED", completedAt: new Date() },
    });
  }
  if (!isEmailDeliveryAvailable()) return;
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "EmailDelivery" SET "leaseUntil" = NOW() + INTERVAL '5 minutes'
    WHERE id IN (SELECT id FROM "EmailDelivery" WHERE status = 'PENDING' AND "availableAt" <= NOW()
      AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW()) ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id`;
  for (const { id } of rows) {
    const row = await db.emailDelivery.findUniqueOrThrow({
      where: { id },
      include: { user: { include: { emails: true } } },
    });
    if (row.status !== "PENDING") continue;
    const current = await db.programSettings.findUnique({
      where: { id: "program" },
    });
    // Security notices are essential, including for legacy users with emailSecurity=false.
    const essential = row.category === "security";
    const preference =
      row.category === "security"
        ? true
        : row.category === "messages"
          ? row.user.emailMessages
          : row.user.emailInfo;
    const owned = row.user.emails.some(
      (address) =>
        address.email === row.recipient &&
        address.verifiedAt &&
        (address.email === row.user.email || row.user.emailSecondaryRecipients),
    );
    if (
      (!essential && !current?.emailNotificationsEnabled) ||
      !preference ||
      (!owned && !row.previousPrimary)
    ) {
      await db.emailDelivery.update({
        where: { id },
        data: { status: "SKIPPED", completedAt: new Date(), leaseUntil: null },
      });
      continue;
    }
    const subject = descriptions[row.event] ?? "Your account was updated";
    const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(
      /\/+$/,
      "",
    );
    const path = row.category === "messages" ? "/messages" : "/my-account";
    try {
      await emailSender.send({
        to: row.recipient,
        subject,
        messageId: `<account-notice-${id}@shbs-notifications>`,
        text: `${subject}.\n\nTime: ${row.createdAt.toISOString()}\nReview: ${base}${path}\n\nIf you do not recognize this activity, contact the program team through private support.`,
      });
      await db.emailDelivery.update({
        where: { id },
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
      await db.emailDelivery.update({
        where: { id },
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
