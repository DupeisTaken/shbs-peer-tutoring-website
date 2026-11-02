import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { EmailMessage } from "~/server/email/sender";
import type * as DatabaseModule from "~/server/db";
import type {
  MonthlyHoursSchedule,
  ProgramSettings,
} from "../../generated/prisma";

const fixture = vi.hoisted(() => ({
  prefix: "monthly-hours-dispatch-",
  actorId: "monthly-hours-dispatch-admin",
  recipientId: "monthly-hours-dispatch-recipient",
  month: "2013-09",
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: fixture.send },
  isEmailDeliveryAvailable: () => true,
  isEmailConfigured: () => false,
  verifyEmailTransport: vi.fn(async () => false),
}));
vi.mock("~/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof DatabaseModule>();
  const database = new Proxy(original.db, {
    get(target, key) {
      const value = Reflect.get(target, key) as unknown;
      if (key === "$queryRaw") {
        return (query: TemplateStringsArray, ...parameters: unknown[]) => {
          // Run the production lease query, restricted only to these synthetic
          // accounts. Other integration suites' queue rows are never claimed,
          // postponed or delivered by this test's mocked transport.
          let scoped = query;
          const fragments: readonly string[] = query;
          if (
            Array.isArray(query) &&
            fragments
              .join("")
              .includes(
                'WITH candidates AS MATERIALIZED (SELECT id FROM "EmailDelivery" WHERE',
              )
          ) {
            const parts = [...fragments];
            parts[0] = parts[0]!.replace(
              'FROM "EmailDelivery" WHERE',
              `FROM "EmailDelivery" WHERE "userId" LIKE '${fixture.prefix}%' AND`,
            );
            Object.defineProperty(parts, "raw", { value: parts });
            scoped = parts as unknown as TemplateStringsArray;
          }
          return Reflect.apply(
            value as (...args: unknown[]) => unknown,
            target,
            [scoped, ...parameters],
          ) as Promise<unknown>;
        };
      }
      return typeof value === "function"
        ? (value.bind(target) as unknown)
        : value;
    },
  });
  return { ...original, db: database };
});

import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { deliverNotifications } from "~/server/email/notification-delivery";
import { createUnsubscribeToken } from "~/server/email/unsubscribe-token";
import {
  getUnsubscribeStatus,
  optionalEmailCategory,
  unsubscribeFromEmail,
} from "~/server/email/unsubscribe";
import {
  generateMonthlyHours,
  getMonthlyHoursReport,
  previewMonthlyHours,
  retryMonthlyHoursReport,
  saveMonthlyHoursSettings,
} from "./monthly-hours";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
let savedSchedule: MonthlyHoursSchedule | null;
let savedSettings: ProgramSettings | null;
let savedFeature: { enabled: boolean; pendingEnabled: boolean | null } | null;
const mailbox = (id: string) => `${id}@example.test`;

async function removeOwnedReports() {
  const reports = await db.monthlyHoursReport.findMany({
    where: { generatedById: fixture.actorId },
    select: { id: true },
  });
  const ids = reports.map((report) => report.id);
  await db.emailDelivery.deleteMany({
    where: {
      OR: [
        { monthlyHoursReportId: { in: ids } },
        { userId: { in: [fixture.actorId, fixture.recipientId] } },
      ],
    },
  });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { userId: { in: [fixture.actorId, fixture.recipientId] } },
        { entity: "MonthlyHoursReport", entityId: { in: ids } },
      ],
    },
  });
  await db.monthlyHoursReport.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  savedSchedule = await db.monthlyHoursSchedule.findUnique({
    where: { id: "program" },
  });
  savedSettings = await db.programSettings.findUnique({
    where: { id: "program" },
  });
  savedFeature = await db.programFeature.findUnique({
    where: { key: "SERVICE_HOURS" },
    select: { enabled: true, pendingEnabled: true },
  });
  vi.stubEnv("AUTH_URL", "https://reports.example.test");
  vi.stubEnv("AUTH_SECRET", "synthetic-monthly-dispatch-test-secret");
  await db.user.createMany({
    data: [fixture.actorId, fixture.recipientId].map((id) => ({
      id,
      name: "Synthetic report staff",
      email: mailbox(id),
      role: "ADMIN" as const,
      emailVerifiedAt: new Date(),
      emailInfo: true,
    })),
  });
  await db.tutor.create({
    data: {
      id: `${fixture.prefix}tutor`,
      englishName: "Synthetic <Tutor>",
      status: "ARCHIVED",
    },
  });
  await db.serviceHourAdjustment.create({
    data: {
      id: `${fixture.prefix}adjustment`,
      tutorId: `${fixture.prefix}tutor`,
      month: fixture.month,
      schoolYear: "13-14",
      quarter: "Q1",
      type: "EXTRA",
      amount: 0.75,
      reason: "Synthetic private adjustment reason must stay out of email",
    },
  });
});

beforeEach(async () => {
  await removeOwnedReports();
  fixture.send.mockReset().mockResolvedValue(undefined);
  await db.programSettings.upsert({
    where: { id: "program" },
    create: { id: "program", emailNotificationsEnabled: true },
    update: { emailNotificationsEnabled: true },
  });
  await db.programFeature.upsert({
    where: { key: "SERVICE_HOURS" },
    create: { key: "SERVICE_HOURS", enabled: true },
    update: { enabled: true },
  });
  await db.user.updateMany({
    where: { id: { in: [fixture.actorId, fixture.recipientId] } },
    data: { emailInfo: true },
  });
  await db.serviceHourAdjustment.update({
    where: { id: `${fixture.prefix}adjustment` },
    data: { amount: 0.75 },
  });
  await db.monthlyHoursSchedule.upsert({
    where: { id: "program" },
    create: { id: "program" },
    update: {
      enabled: false,
      recipientUserIds: [],
      version: 0,
      firstReportMonth: null,
      nextReportMonth: null,
      nextDueAt: null,
      lastGenerationError: null,
    },
  });
  await saveMonthlyHoursSettings(
    db,
    {
      enabled: true,
      recipientUserIds: [fixture.actorId, fixture.recipientId],
      dayOfMonth: 3,
      localTime: "09:00",
      timeZone: "Asia/Shanghai",
      expectedVersion: 0,
    },
    fixture.actorId,
  );
});

afterAll(async () => {
  await removeOwnedReports();
  await db.serviceHourAdjustment.deleteMany({
    where: { id: `${fixture.prefix}adjustment` },
  });
  await db.tutor.deleteMany({ where: { id: `${fixture.prefix}tutor` } });
  await db.user.deleteMany({
    where: { id: { in: [fixture.actorId, fixture.recipientId] } },
  });
  if (savedSchedule)
    await db.monthlyHoursSchedule.update({
      where: { id: "program" },
      data: savedSchedule,
    });
  else await db.monthlyHoursSchedule.delete({ where: { id: "program" } });
  if (savedSettings)
    await db.programSettings.update({
      where: { id: "program" },
      data: {
        emailNotificationsEnabled: savedSettings.emailNotificationsEnabled,
      },
    });
  else await db.programSettings.delete({ where: { id: "program" } });
  if (savedFeature)
    await db.programFeature.update({
      where: { key: "SERVICE_HOURS" },
      data: savedFeature,
    });
  else await db.programFeature.delete({ where: { key: "SERVICE_HOURS" } });
  vi.unstubAllEnvs();
});

async function generate() {
  const preview = await previewMonthlyHours(db, fixture.month);
  return generateMonthlyHours(
    db,
    {
      month: fixture.month,
      expectedVersion: preview.configVersion,
      expectedContentHash: preview.contentHash,
      expectedLatestRevision: preview.latestRevision,
      requestId: randomUUID(),
    },
    fixture.actorId,
  );
}

it("dispatches one complete bilingual snapshot per selected mailbox with protected links and no private fields", async () => {
  const generated = await generate();
  expect(fixture.send).not.toHaveBeenCalled();
  await deliverNotifications();
  expect(fixture.send).toHaveBeenCalledTimes(2);
  const messages = fixture.send.mock.calls.map(([message]) => message);
  expect(messages.map((message) => message.to).sort()).toEqual(
    [mailbox(fixture.actorId), mailbox(fixture.recipientId)].sort(),
  );
  for (const message of messages) {
    expect(message.category).toBe("PROGRAM");
    expect(message.subject).toContain(fixture.month);
    expect(message.subject).toContain("服务时数报告");
    expect(message.text).toContain("Synthetic <Tutor>");
    expect(message.html).toContain("Synthetic &lt;Tutor&gt;");
    expect(message.text).toContain("Inactive / 非活跃");
    expect(message.text).toContain("0.75");
    expect(message.text).toContain(
      `https://reports.example.test/signin?callbackUrl=${encodeURIComponent(`/admin/service-hours/reports/${generated.reportId}`)}`,
    );
    expect(message.html).toContain("Unsubscribe / 取消订阅");
    expect(`${message.text}${message.html}`).not.toContain(
      "Synthetic private adjustment reason",
    );
    expect(`${message.text}${message.html}`).not.toContain(
      mailbox(fixture.actorId),
    );
    expect(`${message.text}${message.html}`).not.toContain(
      mailbox(fixture.recipientId),
    );
    expect(message.messageId).toMatch(
      /^<monthly-hours-.+@shbs-notifications>$/,
    );
  }
  const report = await getMonthlyHoursReport(db, generated.reportId);
  expect(report.status).toBe("SENT");
  expect(report.deliveryCounts.sent).toBe(2);
});

it("retries only the unsuccessful mailbox with its stable ID and original saved content", async () => {
  const generated = await generate();
  fixture.send.mockImplementation(async (message) => {
    if (message.to === mailbox(fixture.recipientId))
      throw new Error("Synthetic SMTP rejection");
  });
  await deliverNotifications();
  const firstMessages = fixture.send.mock.calls.map(([message]) => message);
  expect(firstMessages).toHaveLength(2);
  const failedMessage = firstMessages.find(
    (message) => message.to === mailbox(fixture.recipientId),
  )!;
  const partial = await getMonthlyHoursReport(db, generated.reportId);
  expect(partial.status).toBe("PARTIAL");
  expect(partial.deliveryCounts.sent).toBe(1);
  expect(partial.deliveryCounts.retrying).toBe(1);
  await db.serviceHourAdjustment.update({
    where: { id: `${fixture.prefix}adjustment` },
    data: { amount: 99 },
  });
  fixture.send.mockResolvedValue(undefined);
  expect(
    await retryMonthlyHoursReport(db, generated.reportId, fixture.actorId),
  ).toEqual({ queued: 1 });
  await deliverNotifications();
  expect(fixture.send).toHaveBeenCalledTimes(3);
  const retryMessage = fixture.send.mock.calls[2]![0];
  expect(retryMessage.to).toBe(failedMessage.to);
  expect(retryMessage.messageId).toBe(failedMessage.messageId);
  // Unsubscribe capability expiry may refresh; saved report content stays fixed.
  expect(retryMessage.text.split("Unsubscribe / 取消订阅:")[0]).toBe(
    failedMessage.text.split("Unsubscribe / 取消订阅:")[0],
  );
  const withoutCapability = (html: string | undefined) =>
    html?.replace(/token=[^"&<>]+/g, "token=SYNTHETIC_CAPABILITY");
  expect(withoutCapability(retryMessage.html)).toBe(
    withoutCapability(failedMessage.html),
  );
  const complete = await getMonthlyHoursReport(db, generated.reportId);
  expect(complete.status).toBe("SENT");
  expect(complete.totals.extras).toBe(0.75);
  expect(complete.rows).toEqual(partial.rows);
});

it("the existing unsubscribe capability cancels monthly information mail before dispatcher admission", async () => {
  const generated = await generate();
  const row = await db.emailDelivery.findFirstOrThrow({
    where: {
      monthlyHoursReportId: generated.reportId,
      userId: fixture.recipientId,
    },
  });
  const token = createUnsubscribeToken(row.id);
  expect(optionalEmailCategory("monthly_hours")).toBe("info");
  expect(await getUnsubscribeStatus(token)).toEqual({
    status: "ready",
    category: "info",
  });
  expect(await unsubscribeFromEmail(token, "category")).toEqual({
    status: "unsubscribed",
    category: "info",
  });
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } }))
      .status,
  ).toBe("SKIPPED");
  await deliverNotifications();
  expect(fixture.send).toHaveBeenCalledTimes(1);
  expect(fixture.send.mock.calls[0]![0].to).toBe(mailbox(fixture.actorId));
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: fixture.recipientId } }))
      .email,
  ).toBe(mailbox(fixture.recipientId));
});
