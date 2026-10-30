import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type {
  MonthlyHoursReport,
  MonthlyHoursSchedule,
} from "../../generated/prisma";
import { serviceHoursSummary } from "~/server/service-hours-summary";
import { getProgramTimeZone } from "~/server/program/time-zone";
import { getFeatures } from "~/server/program/features";
import { isEmailDeliveryAvailable } from "~/server/email/sender";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";
import {
  monthlyHoursGenerateInput,
  monthlyHoursMonth,
  monthlyHoursSettingsInput,
  type MonthlyHoursGenerateInput,
  type MonthlyHoursSettingsInput,
} from "./monthly-hours-input";
import {
  firstMonthlyHoursOccurrence,
  localMonth,
  monthlyHoursDueAt,
  shiftMonth,
} from "./monthly-hours-time";
import { isSerializationFailure } from "~/server/auth/username-snapshot";
import { databaseScope } from "~/server/db-scope";
import { lockUsernameNamespace } from "~/server/auth/username-namespace";
import { monthlyHoursEmailCopy } from "./monthly-hours-email";

export const monthlyHoursCategory = "monthly_hours";
export const monthlyHoursLock = "monthly-hours-schedule";
/** Outbox insertion takes recipient User foreign-key locks. Take the same period
 * and namespace fences as admission before any actor/account or schedule lock. */
async function lockMonthlyHoursGeneration(tx: TransactionDb) {
  await lockEntity(tx, "program:period");
  await lockUsernameNamespace(tx);
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "The monthly report changed. Reload and review it again.",
  });

/** No transport runs in snapshot transactions. Retrying a rolled-back database
 * conflict is safe and gives a waiter a fresh view of a winning occurrence. */
async function snapshotTransaction<T>(
  db: DomainDb,
  work: (tx: TransactionDb) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await inTransaction(db, work, {
        isolationLevel: "RepeatableRead",
      });
    } catch (error) {
      const unique =
        !!error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002";
      if (
        attempt >= 2 ||
        databaseScope.getStore() ||
        !(isSerializationFailure(error) || unique)
      )
        throw error;
    }
  }
}
export const monthlyHoursRowSchema = z.object({
  tutorId: z.string(),
  englishName: z.string(),
  active: z.boolean(),
  sessions: z.number(),
  adjustmentCount: z.number(),
  earned: z.number(),
  extras: z.number(),
  punishments: z.number(),
  total: z.number(),
});
export const monthlyHoursSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  month: monthlyHoursMonth,
  rows: z.array(monthlyHoursRowSchema),
  totals: z.object({
    tutors: z.number(),
    sessions: z.number(),
    earned: z.number(),
    extras: z.number(),
    punishments: z.number(),
    total: z.number(),
  }),
});
export type MonthlyHoursSnapshot = z.infer<typeof monthlyHoursSnapshotSchema>;
export type MonthlyHoursRecipient = {
  userId: string;
  name: string | null;
  role: string;
  email: string | null;
  status: "QUEUED" | "BLOCKED" | "SKIPPED";
  reason: string | null;
};
const recipientSchema = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  role: z.string(),
  email: z.string().nullable(),
  status: z.enum(["QUEUED", "BLOCKED", "SKIPPED"]),
  reason: z.string().nullable(),
});

export function monthlyHoursConfig(
  row: MonthlyHoursSchedule | null,
  timeZone: string,
) {
  return {
    enabled: row?.enabled ?? false,
    recipientUserIds: row?.recipientUserIds ?? [],
    dayOfMonth: row?.dayOfMonth ?? 3,
    localTime: row?.localTime ?? "09:00",
    timeZone: row?.timeZone ?? timeZone,
    version: row?.version ?? 0,
    firstReportMonth: row?.firstReportMonth ?? null,
    nextDueAt: row?.nextDueAt ?? null,
  };
}

type MonthlyHoursStaff = {
  userId: string;
  name: string | null;
  role: string;
  emailInfo: boolean;
  addresses: { email: string; primary: boolean }[];
  eligible: boolean;
  reason: string | null;
};

async function staffAccounts(db: DomainDb, selected: string[]) {
  const users = await db.user.findMany({
    where: {
      OR: [{ role: { in: ["ADMIN", "HEAD"] } }, { id: { in: selected } }],
    },
    include: { emails: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const staff: MonthlyHoursStaff[] = users.map((user) => {
    const addresses = user.emails
      .filter(
        (email) =>
          email.verifiedAt &&
          (email.email === user.email || user.emailSecondaryRecipients),
      )
      .map((email) => ({
        email: email.email,
        primary: email.email === user.email,
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
    const reason =
      user.suspendedAt || user.mergedIntoId
        ? "UNAVAILABLE_ACCOUNT"
        : !["ADMIN", "HEAD"].includes(user.role)
          ? "ROLE_CHANGED"
          : !addresses.length
            ? "NO_VERIFIED_ADDRESS"
            : !user.emailInfo
              ? "OPTED_OUT"
              : null;
    return {
      userId: user.id,
      name: user.name,
      role: user.role,
      emailInfo: user.emailInfo,
      addresses,
      eligible: !reason,
      reason,
    };
  });
  for (const userId of selected)
    if (!staff.some((user) => user.userId === userId))
      staff.push({
        userId,
        name: null,
        role: "",
        emailInfo: false,
        addresses: [],
        eligible: false,
        reason: "UNAVAILABLE_ACCOUNT",
      });
  return staff;
}

export async function monthlyHoursRecipients(
  db: DomainDb,
  config: ReturnType<typeof monthlyHoursConfig>,
) {
  const [staff, settings, features] = await Promise.all([
    staffAccounts(db, config.recipientUserIds),
    db.programSettings.findUnique({ where: { id: "program" } }),
    getFeatures(db),
  ]);
  const recipients: MonthlyHoursRecipient[] = [];
  const mailboxes = new Set<string>();
  for (const userId of config.recipientUserIds) {
    const user = staff.find((person) => person.userId === userId)!;
    const reason = !config.enabled
      ? "SCHEDULE_OFF"
      : !features.SERVICE_HOURS
        ? "FEATURE_OFF"
        : !settings?.emailNotificationsEnabled
          ? "EMAIL_OFF"
          : (user.reason ??
            (!isEmailDeliveryAvailable("PROGRAM")
              ? "TRANSPORT_UNAVAILABLE"
              : null));
    for (const email of user.addresses.length
      ? user.addresses.map((address) => address.email)
      : [null]) {
      if (email && mailboxes.has(email.toLowerCase())) continue;
      if (email) mailboxes.add(email.toLowerCase());
      const blocked = !email || reason === "TRANSPORT_UNAVAILABLE";
      recipients.push({
        userId,
        name: user.name,
        role: user.role,
        email,
        status: reason ? (blocked ? "BLOCKED" : "SKIPPED") : "QUEUED",
        reason,
      });
    }
  }
  return recipients;
}

async function assertActor(tx: TransactionDb, actorId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actorId} FOR SHARE`;
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (
    !actor ||
    actor.suspendedAt ||
    actor.mergedIntoId ||
    !["ADMIN", "HEAD"].includes(actor.role)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Administrator access required.",
    });
  return actor;
}

/** Read-only validation also serves proposal admission; version and authority are
 * checked again by the saving transaction when a reviewed proposal is applied. */
export async function validateMonthlyHoursSettings(
  db: DomainDb,
  raw: MonthlyHoursSettingsInput,
) {
  const input = monthlyHoursSettingsInput.parse(raw);
  const staff = await staffAccounts(db, input.recipientUserIds);
  if (
    input.enabled &&
    input.recipientUserIds.some((id) => {
      const person = staff.find((user) => user.userId === id);
      return (
        !person ||
        ["ROLE_CHANGED", "UNAVAILABLE_ACCOUNT"].includes(person.reason ?? "")
      );
    })
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select current Admin or Head accounts.",
    });
  if (input.enabled) {
    const features = await getFeatures(db);
    const settings = await db.programSettings.findUnique({
      where: { id: "program" },
    });
    if (
      !features.SERVICE_HOURS ||
      !settings?.emailNotificationsEnabled ||
      !isEmailDeliveryAvailable("PROGRAM")
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Enable service hours and optional email, and configure PROGRAM delivery first.",
      });
    if (
      !input.recipientUserIds.length ||
      !input.recipientUserIds.every(
        (id) => staff.find((user) => user.userId === id)?.eligible,
      )
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Every selected recipient needs a verified mailbox and information-email consent.",
      });
  }
  return input;
}

export async function saveMonthlyHoursSettings(
  db: DomainDb,
  raw: MonthlyHoursSettingsInput,
  actorId: string,
) {
  return inTransaction(db, async (tx) => {
    const actor = await assertActor(tx, actorId);
    await lockEntity(tx, monthlyHoursLock);
    const before = await tx.monthlyHoursSchedule.findUnique({
      where: { id: "program" },
    });
    const input = await validateMonthlyHoursSettings(tx, raw);
    if ((before?.version ?? 0) !== input.expectedVersion) throw conflict();
    const changedClock =
      before?.dayOfMonth !== input.dayOfMonth ||
      before?.localTime !== input.localTime ||
      before?.timeZone !== input.timeZone;
    const first =
      input.enabled && (!before?.enabled || changedClock)
        ? firstMonthlyHoursOccurrence(new Date(), input)
        : null;
    // A future clock edit keeps the existing report-month cursor. Overdue occurrences
    // are retained too; editing recipients never discards a restart backlog.
    const nextMonth = !input.enabled
      ? null
      : before?.enabled && before.nextReportMonth
        ? before.nextReportMonth
        : first!.month;
    const nextDueAt = nextMonth
      ? monthlyHoursDueAt(
          nextMonth,
          input.dayOfMonth,
          input.localTime,
          input.timeZone,
        )
      : null;
    const fields = {
      enabled: input.enabled,
      recipientUserIds: input.recipientUserIds,
      dayOfMonth: input.dayOfMonth,
      localTime: input.localTime,
      timeZone: input.timeZone,
    };
    const row = await tx.monthlyHoursSchedule.upsert({
      where: { id: "program" },
      create: {
        id: "program",
        ...fields,
        version: 1,
        firstReportMonth: nextMonth,
        nextReportMonth: nextMonth,
        nextDueAt,
      },
      update: {
        ...fields,
        version: { increment: 1 },
        firstReportMonth: before?.enabled ? before.firstReportMonth : nextMonth,
        nextReportMonth: nextMonth,
        nextDueAt,
        lastGenerationError: null,
      },
    });
    if (!input.enabled || before) {
      // Already admitted SMTP is in progress. Only future admission can be cancelled.
      await tx.emailDelivery.updateMany({
        where: {
          category: monthlyHoursCategory,
          status: "PENDING",
          ...(!input.enabled
            ? {}
            : { userId: { notIn: input.recipientUserIds } }),
        },
        data: { status: "SKIPPED", leaseUntil: null, completedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        userName: actor.name,
        operation: "monthlyHours.save",
        entity: "MonthlyHoursSchedule",
        entityId: "program",
        action: "Changed monthly service-hours reporting",
        details: {
          beforeVersion: before?.version ?? 0,
          version: row.version,
          enabled: row.enabled,
          recipientCount: input.recipientUserIds.length,
          dayOfMonth: row.dayOfMonth,
          localTime: row.localTime,
          timeZone: row.timeZone,
        },
      },
    });
    return { config: monthlyHoursConfig(row, row.timeZone) };
  });
}

export async function buildMonthlyHoursSnapshot(
  db: DomainDb,
  month: string,
): Promise<MonthlyHoursSnapshot> {
  const summary = await serviceHoursSummary(db, { month });
  const rows = summary.rows
    .filter((row) => row.sessions > 0 || row.adjustmentCount > 0)
    .sort((a, b) =>
      a.englishName < b.englishName
        ? -1
        : a.englishName > b.englishName
          ? 1
          : a.tutorId.localeCompare(b.tutorId),
    );
  const totals = rows.reduce(
    (sum, row) => ({
      tutors: sum.tutors + 1,
      sessions: sum.sessions + row.sessions,
      earned: sum.earned + row.earned,
      extras: sum.extras + row.extras,
      punishments: sum.punishments + row.punishments,
      total: sum.total + row.total,
    }),
    { tutors: 0, sessions: 0, earned: 0, extras: 0, punishments: 0, total: 0 },
  );
  return { schemaVersion: 1, month, rows, totals };
}

function assertClosedMonth(month: string, zone: string, now = new Date()) {
  monthlyHoursMonth.parse(month);
  if (month >= localMonth(now, zone) || month >= now.toISOString().slice(0, 7))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a completed reporting month.",
    });
}

export async function previewMonthlyHours(db: DomainDb, month: string) {
  return inTransaction(
    db,
    async (tx) => {
      const zone = await getProgramTimeZone(tx);
      const config = monthlyHoursConfig(
        await tx.monthlyHoursSchedule.findUnique({ where: { id: "program" } }),
        zone,
      );
      assertClosedMonth(month, config.timeZone);
      const snapshot = await buildMonthlyHoursSnapshot(tx, month);
      const latest = await tx.monthlyHoursReport.findFirst({
        where: { scheduleId: "program", month },
        orderBy: { revision: "desc" },
      });
      const recipients = await monthlyHoursRecipients(tx, config);
      const generatedAt = new Date();
      // Preview uses the delivery renderer without creating a report, mailbox
      // receipt or live account capability. Preview controls are labels, not links.
      const email = monthlyHoursEmailCopy({
        snapshot,
        revision: (latest?.revision ?? 0) + 1,
        generatedAt,
        timeZone: config.timeZone,
        reason: null,
        reportUrl: "#report-preview",
        unsubscribeUrl: "#unsubscribe-preview",
        preview: true,
      });
      return {
        month,
        generatedAt,
        timeZone: config.timeZone,
        configVersion: config.version,
        latestRevision: latest?.revision ?? 0,
        contentHash: hash({ snapshot, recipients }),
        rows: snapshot.rows,
        totals: snapshot.totals,
        recipients,
        email,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

async function createReport(
  tx: TransactionDb,
  config: MonthlyHoursSchedule,
  month: string,
  generationKey: string,
  generationHash: string,
  actorId: string | null,
  reason: string | null,
  dueAt: Date | null,
  expected?: MonthlyHoursGenerateInput,
) {
  const latest = await tx.monthlyHoursReport.findFirst({
    where: { scheduleId: "program", month },
    orderBy: { revision: "desc" },
  });
  if (!expected && latest) return null;
  if (expected && (latest?.revision ?? 0) !== expected.expectedLatestRevision)
    throw conflict();
  if (latest && !reason)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Give a reason for the revised report.",
    });
  const snapshot = await buildMonthlyHoursSnapshot(tx, month);
  const recipients = await monthlyHoursRecipients(
    tx,
    monthlyHoursConfig(config, config.timeZone),
  );
  const contentHash = hash({ snapshot, recipients });
  if (expected && expected.expectedContentHash !== contentHash)
    throw conflict();
  const report = await tx.monthlyHoursReport.create({
    data: {
      scheduleId: "program",
      month,
      revision: (latest?.revision ?? 0) + 1,
      configVersion: config.version,
      timeZone: config.timeZone,
      dueAt,
      contentHash,
      snapshot,
      intendedRecipients: recipients,
      generatedById: actorId,
      reason,
      generationKey,
      generationHash,
    },
  });
  // Missing mailboxes get a non-mail sentinel so each intended account retains a
  // distinct blocked receipt. Such a receipt can never pass transport admission.
  await tx.emailDelivery.createMany({
    data: recipients.map((recipient) => ({
      monthlyHoursReportId: report.id,
      userId: recipient.role ? recipient.userId : null,
      category: monthlyHoursCategory,
      event: "monthly_hours_report",
      recipient: recipient.email ?? `unavailable:${recipient.userId}`,
      status: recipient.status === "QUEUED" ? "PENDING" : recipient.status,
      completedAt: recipient.status === "QUEUED" ? null : new Date(),
      lastError: recipient.reason,
      destination: `/admin/service-hours/reports/${report.id}`,
    })),
  });
  await tx.auditLog.create({
    data: {
      userId: actorId,
      operation: actorId ? "monthlyHours.generate" : "monthlyHours.sweep",
      entity: "MonthlyHoursReport",
      entityId: report.id,
      action: "Generated monthly service-hours report",
      details: {
        month,
        revision: report.revision,
        configVersion: config.version,
        tutors: snapshot.totals.tutors,
        recipientCount: recipients.length,
        automatic: !actorId,
      },
    },
  });
  return report;
}

function generationReceipt(report: MonthlyHoursReport) {
  const recipients = z.array(recipientSchema).parse(report.intendedRecipients);
  return {
    reportId: report.id,
    revision: report.revision,
    queued: recipients.filter((recipient) => recipient.status === "QUEUED")
      .length,
    blocked: recipients.filter((recipient) => recipient.status === "BLOCKED")
      .length,
    skipped: recipients.filter((recipient) => recipient.status === "SKIPPED")
      .length,
  };
}

export async function generateMonthlyHours(
  db: DomainDb,
  raw: MonthlyHoursGenerateInput,
  actorId: string,
) {
  const input = monthlyHoursGenerateInput.parse(raw);
  const generationKey = `manual:${actorId}:${input.requestId}`;
  const generationHash = hash(input);
  return snapshotTransaction(db, async (tx) => {
    await lockMonthlyHoursGeneration(tx);
    await assertActor(tx, actorId);
    await lockEntity(tx, monthlyHoursLock);
    const prior = await tx.monthlyHoursReport.findUnique({
      where: { generationKey },
    });
    if (prior) {
      if (prior.generationHash !== generationHash) throw conflict();
      return generationReceipt(prior);
    }
    if (!(await getFeatures(tx)).SERVICE_HOURS)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Service hours are currently turned off.",
      });
    const config = await tx.monthlyHoursSchedule.findUnique({
      where: { id: "program" },
    });
    if (!config?.enabled)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Enable and save monthly reporting first.",
      });
    if (config.version !== input.expectedVersion) throw conflict();
    assertClosedMonth(input.month, config.timeZone);
    const report = await createReport(
      tx,
      config,
      input.month,
      generationKey,
      generationHash,
      actorId,
      input.reason ?? null,
      null,
      input,
    );
    return generationReceipt(report!);
  });
}

export function monthlyHoursDeliveryCounts(
  deliveries: { status: string; attempts: number }[],
) {
  const counts = {
    queued: 0,
    retrying: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
  };
  for (const row of deliveries) {
    if (row.status === "PENDING")
      counts[row.attempts ? "retrying" : "queued"]++;
    else if (row.status === "SENDING") counts.sending++;
    else if (row.status === "SENT") counts.sent++;
    else if (row.status === "FAILED") counts.failed++;
    else if (row.status === "BLOCKED") counts.blocked++;
    else counts.skipped++;
  }
  return counts;
}
function reportSummary(
  row: MonthlyHoursReport & {
    deliveries: { status: string; attempts: number }[];
  },
) {
  const deliveryCounts = monthlyHoursDeliveryCounts(row.deliveries);
  const kinds = Object.values(deliveryCounts).filter(Boolean).length;
  const status =
    kinds > 1
      ? "PARTIAL"
      : deliveryCounts.sending
        ? "SENDING"
        : deliveryCounts.retrying
          ? "RETRYING"
          : deliveryCounts.queued
            ? "QUEUED"
            : deliveryCounts.sent
              ? "SENT"
              : deliveryCounts.failed
                ? "FAILED"
                : deliveryCounts.blocked
                  ? "BLOCKED"
                  : "SKIPPED";
  return {
    id: row.id,
    month: row.month,
    revision: row.revision,
    generatedAt: row.generatedAt,
    dueAt: row.dueAt,
    timeZone: row.timeZone,
    configVersion: row.configVersion,
    reason: row.reason,
    status,
    deliveryCounts,
  };
}

export async function getMonthlyHoursSettings(db: DomainDb, actorRole: string) {
  const [row, zone, settings, features, reports] = await Promise.all([
    db.monthlyHoursSchedule.findUnique({ where: { id: "program" } }),
    getProgramTimeZone(db),
    db.programSettings.findUnique({ where: { id: "program" } }),
    getFeatures(db),
    db.monthlyHoursReport.findMany({
      orderBy: { generatedAt: "desc" },
      take: 12,
      include: { deliveries: { select: { status: true, attempts: true } } },
    }),
  ]);
  const config = monthlyHoursConfig(row, zone);
  return {
    config,
    staff: await staffAccounts(db, config.recipientUserIds),
    programTimeZone: zone,
    serviceHoursEnabled: features.SERVICE_HOURS,
    optionalEmailEnabled: settings?.emailNotificationsEnabled ?? false,
    transportAvailable: isEmailDeliveryAvailable("PROGRAM"),
    canEdit: ["ADMIN", "HEAD", "COORDINATOR"].includes(actorRole),
    canApply: ["ADMIN", "HEAD"].includes(actorRole),
    canGenerate: ["ADMIN", "HEAD"].includes(actorRole),
    recentReports: reports.map(reportSummary),
    lastGenerationError: row?.lastGenerationError ?? null,
  };
}

export async function getMonthlyHoursReport(db: DomainDb, id: string) {
  const report = await db.monthlyHoursReport.findUnique({
    where: { id },
    include: { deliveries: { orderBy: { createdAt: "asc" } } },
  });
  if (!report)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This report was not found.",
    });
  const snapshot = monthlyHoursSnapshotSchema.parse(report.snapshot);
  return {
    ...reportSummary(report),
    contentHash: report.contentHash,
    rows: snapshot.rows,
    totals: snapshot.totals,
    intendedRecipients: z
      .array(recipientSchema)
      .parse(report.intendedRecipients),
    deliveries: report.deliveries.map((row) => ({
      id: row.id,
      userId: row.userId,
      recipient: row.recipient.startsWith("unavailable:") ? "" : row.recipient,
      status: row.status,
      attempts: row.attempts,
      lastError: row.lastError,
      completedAt: row.completedAt,
      availableAt: row.availableAt,
    })),
  };
}

/** The cursor is durable, bounded to one occurrence per sweep, and advances atomically
 * with its snapshot/outbox. A failed transaction leaves the due occurrence recoverable. */
export async function sweepMonthlyHours(db: DomainDb, now = new Date()) {
  try {
    // An off/future schedule needs only a read; avoid touching the shared identity
    // fence on every idle timer tick. The transaction rechecks this candidate.
    const candidate = await db.monthlyHoursSchedule.findUnique({
      where: { id: "program" },
    });
    if (
      !candidate?.enabled ||
      !candidate.nextDueAt ||
      candidate.nextDueAt > now
    )
      return { generated: 0 };
    return await snapshotTransaction(db, async (tx) => {
      await lockMonthlyHoursGeneration(tx);
      await lockEntity(tx, monthlyHoursLock);
      const config = await tx.monthlyHoursSchedule.findUnique({
        where: { id: "program" },
      });
      if (
        !config?.enabled ||
        !config.nextDueAt ||
        !config.nextReportMonth ||
        config.nextDueAt > now
      )
        return { generated: 0 };
      if (!(await getFeatures(tx)).SERVICE_HOURS) return { generated: 0 };
      const month = config.nextReportMonth;
      const report = await createReport(
        tx,
        config,
        month,
        `automatic:${month}`,
        hash({ month }),
        null,
        null,
        config.nextDueAt,
      );
      const nextReportMonth = shiftMonth(month, 1);
      await tx.monthlyHoursSchedule.update({
        where: { id: "program" },
        data: {
          nextReportMonth,
          nextDueAt: monthlyHoursDueAt(
            nextReportMonth,
            config.dayOfMonth,
            config.localTime,
            config.timeZone,
          ),
          lastGenerationError: null,
        },
      });
      return { generated: report ? 1 : 0 };
    });
  } catch {
    await db.monthlyHoursSchedule.updateMany({
      where: { id: "program" },
      data: {
        lastGenerationError:
          "Monthly report generation failed; the due report will retry.",
      },
    });
    return { generated: 0 };
  }
}

export async function retryMonthlyHoursReport(
  db: DomainDb,
  id: string,
  actorId: string,
) {
  return inTransaction(db, async (tx) => {
    const actor = await assertActor(tx, actorId);
    await lockEntity(tx, monthlyHoursLock);
    const report = await tx.monthlyHoursReport.findUnique({ where: { id } });
    if (!report) throw new TRPCError({ code: "NOT_FOUND" });
    const row = await tx.monthlyHoursSchedule.findUnique({
      where: { id: "program" },
    });
    const recipients = row
      ? await monthlyHoursRecipients(tx, monthlyHoursConfig(row, row.timeZone))
      : [];
    let queued = 0;
    for (const recipient of recipients.filter(
      (person) => person.status === "QUEUED" && person.email,
    )) {
      const result = await tx.emailDelivery.updateMany({
        where: {
          monthlyHoursReportId: id,
          userId: recipient.userId,
          recipient: recipient.email!,
          OR: [
            { status: { in: ["FAILED", "BLOCKED"] } },
            { status: "PENDING", attempts: { gt: 0 } },
          ],
          AND: [
            { OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
          ],
        },
        data: {
          status: "PENDING",
          attempts: 0,
          leaseUntil: null,
          attemptId: null,
          attemptStartedAt: null,
          availableAt: new Date(),
          completedAt: null,
          lastError: null,
        },
      });
      queued += result.count;
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        userName: actor.name,
        operation: "monthlyHours.retry",
        entity: "MonthlyHoursReport",
        entityId: id,
        action: "Queued saved monthly report for retry",
        details: { queued, month: report.month, revision: report.revision },
      },
    });
    return { queued };
  });
}

const csvCell = (value: string | number) => {
  const text = String(value);
  const safe =
    typeof value === "string" && /^[\s]*[=+\-@\t\r\n]/.test(text)
      ? `'${text}`
      : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
export async function monthlyHoursCsv(db: DomainDb, id: string) {
  const report = await getMonthlyHoursReport(db, id);
  const rows: (string | number)[][] = [
    [
      "Month",
      "Revision",
      "Tutor ID",
      "Tutor",
      "Status",
      "Session rows",
      "Earned",
      "Extras",
      "Deductions",
      "Net",
    ],
  ];
  for (const row of report.rows)
    rows.push([
      report.month,
      report.revision,
      row.tutorId,
      row.englishName,
      row.active ? "Active" : "Inactive",
      row.sessions,
      row.earned,
      row.extras,
      row.punishments,
      row.total,
    ]);
  rows.push([
    report.month,
    report.revision,
    "",
    "TOTAL",
    "",
    report.totals.sessions,
    report.totals.earned,
    report.totals.extras,
    report.totals.punishments,
    report.totals.total,
  ]);
  return {
    filename: `service-hours-${report.month}-r${report.revision}.csv`,
    content: `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`,
  };
}
