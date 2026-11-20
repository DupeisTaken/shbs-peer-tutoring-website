import { createHash } from "node:crypto";
import { z } from "zod";
import { parseProgramDateTime } from "~/lib/program-time";
import { lockUsernameNamespace } from "~/server/auth/username-namespace";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "./transactions";
import { publicSchoolHoursReport } from "./school-hours-public";
import {
  parseSchoolHoursRecipientToken,
  schoolHoursRecipientTokenMatches,
} from "./school-hours-recipient-token";

export type SchoolHoursRecipientFaultCode =
  | "unavailable"
  | "retired"
  | "recipientRemoved"
  | "invalidTime"
  | "alreadyScheduled"
  | "limit"
  | "sending"
  | "writeFailed";
export class SchoolHoursRecipientFault extends Error {
  constructor(public readonly code: SchoolHoursRecipientFaultCode) {
    super(code);
  }
}
const fault = (code: SchoolHoursRecipientFaultCode): never => {
  throw new SchoolHoursRecipientFault(code);
};
export const schoolHoursReminderInput = z
  .object({
    requestId: z.uuid(),
    localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  })
  .strict();
const unfinished = ["PENDING", "SENDING", "BLOCKED", "FAILED"];

/** A personal link resolves its mailbox from the signed receipt. Neither a form
 * field, a site login nor possession of the shared report link chooses a target. */
async function recipient(db: DomainDb, token: string) {
  const parsed = parseSchoolHoursRecipientToken(token);
  if (!parsed) return fault("unavailable");
  const delivery = await db.emailDelivery.findUnique({
    where: { id: parsed.deliveryId },
    include: { schoolHoursReport: true },
  });
  const report = delivery?.schoolHoursReport;
  if (
    delivery?.category !== "school_hours" ||
    !report ||
    !schoolHoursRecipientTokenMatches(
      token,
      { ...delivery, schoolHoursReportId: report.id },
      report.linkVersion,
    ) ||
    !report.intendedRecipients.includes(delivery.recipient)
  )
    return fault("unavailable");
  if (report.linkRevokedAt || report.supersededById) return fault("retired");
  const rootId = delivery.schoolHoursReminderSourceId ?? delivery.id;
  const root =
    rootId === delivery.id
      ? delivery
      : await db.emailDelivery.findUnique({ where: { id: rootId } });
  if (
    !root ||
    root.schoolHoursReminderSourceId ||
    root.category !== "school_hours" ||
    root.schoolHoursReportId !== report.id ||
    root.recipient !== delivery.recipient
  )
    return fault("unavailable");
  return { delivery, report, rootId };
}

async function fence(tx: TransactionDb) {
  // Match report/link writers and transport admission before changing the outbox.
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
  await lockEntity(tx, "email-notifications-setting");
  await lockEntity(tx, "school-hours-chain");
}

export function schoolHoursReminderTime(
  localTime: string,
  timeZone: string,
  now = new Date(),
) {
  let value: Date;
  try {
    value = parseProgramDateTime(localTime, timeZone);
  } catch {
    return fault("invalidTime");
  }
  if (value.getTime() <= now.getTime()) return fault("invalidTime");
  return value;
}

export async function getSchoolHoursRecipientState(
  db: DomainDb,
  token: string,
  recordOpen = false,
) {
  const scope = await recipient(db, token);
  const report = publicSchoolHoursReport(scope.report.snapshot);
  const [config, reminders] = await Promise.all([
    db.schoolHoursSchedule.findUnique({
      where: { id: "program" },
      select: { recipientEmails: true },
    }),
    db.emailDelivery.findMany({
      where: { schoolHoursReminderSourceId: scope.rootId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, status: true, schoolHoursScheduledFor: true },
    }),
  ]);
  if (recordOpen) {
    // One first-request timestamp, without pixels, IP/UA, identity claims or
    // writes to report accounting. HEAD/prefetch/CSV callers never opt in.
    try {
      await db.emailDelivery.updateMany({
        where: { id: scope.delivery.id, schoolHoursLinkOpenedAt: null },
        data: { schoolHoursLinkOpenedAt: new Date() },
      });
    } catch {
      console.error("[school-report] Link visit could not be recorded.");
    }
  }
  const [name, domain] = scope.delivery.recipient.split("@");
  return {
    report,
    mailbox: `${name?.slice(0, 1) ?? ""}•••@${domain ?? ""}`,
    eligible:
      config?.recipientEmails.includes(scope.delivery.recipient) ?? false,
    reminders: reminders.map((row) => ({
      id: row.id,
      status: row.status,
      scheduledFor: row.schoolHoursScheduledFor!,
    })),
  };
}
export type SchoolHoursRecipientState = Awaited<
  ReturnType<typeof getSchoolHoursRecipientState>
>;

/** One unfinished reminder per original recipient receipt, plus a durable daily
 * bound. Exact retries recover the same row even after its selected time passed. */
export async function scheduleSchoolHoursRecipientReminder(
  db: DomainDb,
  token: string,
  raw: z.input<typeof schoolHoursReminderInput>,
  now = new Date(),
) {
  const input = schoolHoursReminderInput.parse(raw);
  return inTransaction(db, async (tx) => {
    await fence(tx);
    const { delivery, report, rootId } = await recipient(tx, token);
    const sendKey = `reminder:${input.requestId}`;
    const intentHash = createHash("sha256")
      .update(
        JSON.stringify({ rootId, ...input, linkVersion: report.linkVersion }),
      )
      .digest("hex");
    const existing = await tx.emailDelivery.findFirst({
      where: {
        schoolHoursReportId: report.id,
        recipient: delivery.recipient,
        schoolHoursSendKey: sendKey,
      },
    });
    if (existing) {
      if (
        existing.schoolHoursReminderSourceId !== rootId ||
        existing.schoolHoursReminderIntentHash !== intentHash
      )
        return fault("unavailable");
      return {
        id: existing.id,
        scheduledFor: existing.schoolHoursScheduledFor!,
      };
    }
    const config = await tx.schoolHoursSchedule.findUnique({
      where: { id: "program" },
    });
    if (!config?.recipientEmails.includes(delivery.recipient))
      return fault("recipientRemoved");
    const scheduledFor = schoolHoursReminderTime(
      input.localTime,
      report.timeZone,
      now,
    );
    if (
      await tx.emailDelivery.count({
        where: {
          schoolHoursReminderSourceId: rootId,
          status: { in: unfinished },
        },
      })
    )
      return fault("alreadyScheduled");
    if (
      (await tx.emailDelivery.count({
        where: {
          schoolHoursReminderSourceId: rootId,
          createdAt: { gte: new Date(now.getTime() - 86_400_000) },
        },
      })) >= 5
    )
      return fault("limit");
    const row = await tx.emailDelivery.create({
      data: {
        category: "school_hours",
        event: "school_hours_reminder",
        recipient: delivery.recipient,
        schoolHoursReportId: report.id,
        schoolHoursSendKey: sendKey,
        schoolHoursReminderSourceId: rootId,
        schoolHoursScheduledFor: scheduledFor,
        schoolHoursReminderLinkVersion: report.linkVersion,
        schoolHoursReminderIntentHash: intentHash,
        availableAt: scheduledFor,
        destination: `/admin/service-hours/school-reports/${report.id}`,
      },
    });
    return { id: row.id, scheduledFor };
  });
}

export async function cancelSchoolHoursRecipientReminder(
  db: DomainDb,
  token: string,
  reminderId: string,
) {
  return inTransaction(db, async (tx) => {
    await fence(tx);
    const { rootId } = await recipient(tx, token);
    const row = await tx.emailDelivery.findFirst({
      where: { id: reminderId, schoolHoursReminderSourceId: rootId },
    });
    if (!row) return fault("unavailable");
    if (row.status === "SENDING") return fault("sending");
    return tx.emailDelivery.updateMany({
      where: {
        id: row.id,
        schoolHoursReminderSourceId: rootId,
        status: { in: ["PENDING", "BLOCKED", "FAILED"] },
      },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
        leaseUntil: null,
        lastError: null,
      },
    });
  });
}
