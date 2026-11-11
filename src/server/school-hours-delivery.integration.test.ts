import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type * as DatabaseModule from "~/server/db";
import type * as SenderModule from "~/server/email/sender";
import type { EmailMessage } from "~/server/email/sender";
import type {
  ProgramSettings,
  SchoolHoursSchedule,
  Prisma,
} from "../../generated/prisma";

const fixture = vi.hoisted(() => ({
  prefix: "school-hours-delivery-test-",
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
  staleGlobalOffOnce: false,
}));
vi.mock("~/server/email/sender", async (importOriginal) => ({
  ...(await importOriginal<typeof SenderModule>()),
  emailSender: { send: fixture.send },
}));
vi.mock("~/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof DatabaseModule>();
  const database = new Proxy(original.db, {
    get(target, key) {
      const value = Reflect.get(target, key) as unknown;
      if (key === "programSettings")
        return new Proxy(target.programSettings, {
          get(delegate, method) {
            if (method === "findUnique")
              return async (input: Prisma.ProgramSettingsFindUniqueArgs) => {
                const current: unknown = await delegate.findUnique(input);
                // Simulate only the dispatcher's stale preflight snapshot. The
                // actual database and subsequent locked admission stay enabled.
                if (fixture.staleGlobalOffOnce && current && typeof current === "object") {
                  fixture.staleGlobalOffOnce = false;
                  return { ...current, emailNotificationsEnabled: false };
                }
                return current;
              };
            const callable = Reflect.get(delegate, method) as unknown;
            return typeof callable === "function"
              ? (callable.bind(delegate) as unknown)
              : callable;
          },
        });
      if (key === "emailDelivery")
        return new Proxy(target.emailDelivery, {
          get(delegate, method) {
            if (method === "updateMany")
              return (input: Prisma.EmailDeliveryUpdateManyArgs) =>
                delegate.updateMany({
                  ...input,
                  where: {
                    AND: [
                      input.where ?? {},
                      { schoolHoursReportId: { startsWith: fixture.prefix } },
                    ],
                  },
                });
            const callable = Reflect.get(delegate, method) as unknown;
            return typeof callable === "function"
              ? (callable.bind(delegate) as unknown)
              : callable;
          },
        });
      if (key === "$queryRaw")
        return (query: TemplateStringsArray, ...parameters: unknown[]) => {
          const fragments: readonly string[] = query;
          let scoped = query;
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
              `FROM "EmailDelivery" WHERE "schoolHoursReportId" LIKE '${fixture.prefix}%' AND`,
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
import {
  admitSchoolHoursDelivery,
  finishSchoolHoursDelivery,
  schoolHoursDeliveryCopy,
} from "./school-hours-delivery";
import {
  issueSchoolHoursToken,
  schoolHoursTokenHash,
} from "./school-hours-link";
import {
  retrieveSchoolHoursReport,
  publicSchoolHoursReport,
  schoolHoursCsv,
} from "./school-hours-public";
import { schoolHoursTestSnapshot } from "./school-hours-test-fixture";
import { retrySchoolHoursReport } from "./school-hours";
import { GET as getHtml } from "~/app/reports/service-hours/[token]/route";
import { GET as getCsv } from "~/app/reports/service-hours/[token]/csv/route";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const reportId = `${fixture.prefix}report`,
  actorId = `${fixture.prefix}actor`;
const recipient = "synthetic-school-office@example.test",
  secondRecipient = "synthetic-second-office@example.test";
let savedSchedule: SchoolHoursSchedule | null;
let savedSettings: ProgramSettings | null;
let savedFeature: { enabled: boolean; pendingEnabled: boolean | null } | null;
let token: string;

async function cleanupReport() {
  await db.emailDelivery.deleteMany({
    where: { schoolHoursReportId: reportId },
  });
  await db.auditLog.deleteMany({
    where: { OR: [{ entityId: reportId }, { userId: actorId }] },
  });
  await db.schoolHoursReport.deleteMany({ where: { id: reportId } });
}
beforeAll(async () => {
  savedSchedule = await db.schoolHoursSchedule.findUnique({
    where: { id: "program" },
  });
  savedSettings = await db.programSettings.findUnique({
    where: { id: "program" },
  });
  savedFeature = await db.programFeature.findUnique({
    where: { key: "SERVICE_HOURS" },
    select: { enabled: true, pendingEnabled: true },
  });
  vi.stubEnv("AUTH_SECRET", "synthetic-school-delivery-secret");
  vi.stubEnv("AUTH_URL", "https://reports.example.test");
  await db.user.create({
    data: {
      id: actorId,
      name: "Synthetic report administrator",
      role: "ADMIN",
      email: `${actorId}@example.test`,
    },
  });
});
beforeEach(async () => {
  await cleanupReport();
  fixture.send.mockReset().mockResolvedValue(undefined);
  fixture.staleGlobalOffOnce = false;
  vi.stubEnv("AUTH_SECRET", "synthetic-school-delivery-secret");
  token = issueSchoolHoursToken(reportId, 1);
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
  await db.schoolHoursSchedule.upsert({
    where: { id: "program" },
    create: {
      id: "program",
      enabled: true,
      recipientEmails: [recipient, secondRecipient],
    },
    update: { enabled: true, recipientEmails: [recipient, secondRecipient] },
  });
  await db.schoolHoursReport.create({
    data: {
      id: reportId,
      scheduleId: "program",
      month: "2026-10",
      revision: 1,
      configVersion: 1,
      baselineVersion: 1,
      timeZone: "Asia/Shanghai",
      snapshot: schoolHoursTestSnapshot(),
      sourceBaseline: {
        privateEvidence: "synthetic-private-baseline",
        recipientEmail: "never-public@example.test",
      },
      intendedRecipients: [recipient, secondRecipient],
      contentHash: "synthetic-only-hash",
      generationKey: `${fixture.prefix}issue`,
      generationHash: "synthetic-request",
      linkTokenHash: schoolHoursTokenHash(token),
    },
  });
  await db.emailDelivery.create({
    data: {
      userId: null,
      category: "school_hours",
      event: "school_hours_report",
      schoolHoursReportId: reportId,
      recipient,
    },
  });
});
afterAll(async () => {
  await cleanupReport();
  await db.user.deleteMany({ where: { id: actorId } });
  if (savedSchedule)
    await db.schoolHoursSchedule.update({
      where: { id: "program" },
      data: {
        enabled: savedSchedule.enabled,
        recipientEmails: savedSchedule.recipientEmails,
      },
    });
  else await db.schoolHoursSchedule.delete({ where: { id: "program" } });
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

async function delivery() {
  return db.emailDelivery.findFirstOrThrow({
    where: { schoolHoursReportId: reportId, recipient },
  });
}
async function claim() {
  const row = await delivery();
  if (!["PENDING", "SENDING"].includes(row.status)) return null;
  const leaseUntil = new Date(Date.now() + 300_000);
  await db.emailDelivery.update({
    where: { id: row.id },
    data: { leaseUntil },
  });
  return admitSchoolHoursDelivery(db, row.id, leaseUntil, row.attemptId);
}

it("dispatches a notification with one scoped link while keeping individual instructions in the report", async () => {
  await deliverNotifications();
  expect(fixture.send).toHaveBeenCalledTimes(1);
  const message = fixture.send.mock.calls[0]![0];
  expect(message.to).toBe(recipient);
  expect(message.subject).toBe("October 2026 school-hours report · Revision 1");
  expect(message.html).toContain(">View Month Report</a>");
  expect(message.html).toContain('class="canvas"');
  expect(message.html).toContain('class="footer-icon"');
  expect(message.html).toContain('src="https://reports.example.test/icon.png"');
  expect(message.html).toContain("Copy this link into your browser:");
  expect(message.text).not.toContain("+7 h");
  expect(message.text).not.toContain("-0.5 h");
  expect(message.html).not.toContain('class="person"');
  expect(message.text).not.toContain("Carry in");
  for (const person of schoolHoursTestSnapshot().rows) {
    expect(`${message.html}${message.text}`).not.toContain(person.exportName);
    expect(`${message.html}${message.text}`).not.toContain(person.schoolAccountKey);
  }
  expect(message.text).toContain(
    `https://reports.example.test/reports/service-hours/${token}`,
  );
  expect(message.messageId).toMatch(/^<school-hours-.+@shbs-notifications>$/);
  expect(`${message.html}${message.text}`).not.toContain(secondRecipient);
  expect(`${message.html}${message.text}`).not.toContain(
    "synthetic-private-baseline",
  );
  expect(`${message.html}${message.text}`).not.toContain("private-person-a");
  expect(await delivery()).toMatchObject({
    status: "SENT",
    userId: null,
    attempts: 1,
  });
});

it.each(["primary", "verified secondary"] as const)("uses the current account language for an already-configured %s recipient without binding report ownership", async (kind) => {
  const id = `${fixture.prefix}language-recipient`;
  const before = await db.schoolHoursReport.findUniqueOrThrow({ where: { id: reportId } });
  await db.user.create({ data: {
    id, email: kind === "primary" ? recipient : `${id}@example.test`,
    emailLocale: "zh", emailVerifiedAt: new Date(),
  } });
  try {
    if (kind === "verified secondary")
      await db.accountEmail.create({ data: { userId: id, email: recipient, verifiedAt: new Date() } });
    await deliverNotifications();
    expect(fixture.send).toHaveBeenCalledTimes(1);
    const message = fixture.send.mock.lastCall![0];
    expect(message.to).toBe(recipient);
    expect(message.html).toContain('lang="zh"');
    expect(message.subject).toContain("学校时数报告");
    expect(message.text).not.toContain("View Month Report");
    expect(await delivery()).toMatchObject({ status: "SENT", userId: null });
    const after = await db.schoolHoursReport.findUniqueOrThrow({ where: { id: reportId } });
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.intendedRecipients).toEqual(before.intendedRecipients);
  } finally {
    await db.user.delete({ where: { id } });
  }
});

it("reads a changed account preference after the report was queued", async () => {
  const id = `${fixture.prefix}changed-language`;
  const queued = await delivery();
  await db.user.create({ data: { id, email: recipient, emailLocale: "zh", emailVerifiedAt: new Date() } });
  try {
    await db.user.update({ where: { id }, data: { emailLocale: "en" } });
    await deliverNotifications();
    expect(fixture.send).toHaveBeenCalledTimes(1);
    const message = fixture.send.mock.lastCall![0];
    expect(message.subject).toBe("October 2026 school-hours report · Revision 1");
    expect(message.html).toContain('lang="en"');
    expect(await delivery()).toMatchObject({ id: queued.id, userId: null, status: "SENT" });
  } finally {
    await db.user.delete({ where: { id } });
  }
});

it.each(["unverified primary", "pending secondary", "unrelated account"] as const)("uses English for a configured recipient with only an %s language association", async (kind) => {
  const id = `${fixture.prefix}unproven-language`;
  await db.user.create({ data: {
    id, name: "Synthetic School Office", emailLocale: "zh",
    email: kind === "unverified primary" ? recipient : `${id}@example.test`,
    emailVerifiedAt: kind === "unverified primary" ? null : new Date(),
  } });
  try {
    if (kind === "pending secondary")
      await db.emailVerificationCode.create({ data: {
        userId: id, purpose: "SECONDARY_EMAIL", targetEmail: recipient,
        codeHash: "synthetic-pending-language-proof", expiresAt: new Date(Date.now() + 600_000),
      } });
    await deliverNotifications();
    expect(fixture.send).toHaveBeenCalledTimes(1);
    const message = fixture.send.mock.lastCall![0];
    expect(message.to).toBe(recipient);
    expect(message.subject).toBe("October 2026 school-hours report · Revision 1");
    expect(message.html).toContain('lang="en"');
    expect(await delivery()).toMatchObject({ status: "SENT", userId: null });
  } finally {
    await db.user.delete({ where: { id } });
  }
});

it("a stale global-off preflight cannot block a fresh receipt after mail was enabled", async () => {
  expect((await db.programSettings.findUniqueOrThrow({ where: { id: "program" } })).emailNotificationsEnabled).toBe(true);
  const receipt = await delivery();
  fixture.staleGlobalOffOnce = true;
  await deliverNotifications();
  expect(fixture.staleGlobalOffOnce).toBe(false);
  expect(fixture.send).toHaveBeenCalledTimes(1);
  expect(await delivery()).toMatchObject({ id: receipt.id, status: "SENT", attempts: 1, lastError: null });
  expect((await db.programSettings.findUniqueOrThrow({ where: { id: "program" } })).emailNotificationsEnabled).toBe(true);
});

it("blocks global mail-off instead of skipping a school instruction and retries the same receipt", async () => {
  const row = await delivery();
  await db.programSettings.update({
    where: { id: "program" },
    data: { emailNotificationsEnabled: false },
  });
  await deliverNotifications();
  expect(fixture.send).not.toHaveBeenCalled();
  expect(await delivery()).toMatchObject({
    id: row.id,
    status: "BLOCKED",
    lastError: "EMAIL_OFF",
    attempts: 0,
  });
  await db.programSettings.update({
    where: { id: "program" },
    data: { emailNotificationsEnabled: true },
  });
  expect(await retrySchoolHoursReport(db, reportId, actorId)).toEqual({
    retried: 1,
  });
  await deliverNotifications();
  expect(fixture.send).toHaveBeenCalledTimes(1);
  expect(await delivery()).toMatchObject({ id: row.id, status: "SENT" });
});

it("keeps successful recipients sent and retries a failed mailbox with the same ID, link and edition", async () => {
  await db.emailDelivery.create({
    data: {
      schoolHoursReportId: reportId,
      category: "school_hours",
      event: "school_hours_report",
      recipient: secondRecipient,
    },
  });
  fixture.send.mockImplementation(async (message) => {
    if (message.to === recipient)
      throw new Error("Synthetic provider failure with private token");
  });
  await deliverNotifications();
  const first = fixture.send.mock.calls
    .map(([message]) => message)
    .find((message) => message.to === recipient)!;
  const failed = await delivery();
  expect(failed).toMatchObject({ status: "PENDING", attempts: 1 });
  expect(failed.lastError).not.toContain("private token");
  expect(
    await db.emailDelivery.findFirstOrThrow({
      where: { schoolHoursReportId: reportId, recipient: secondRecipient },
    }),
  ).toMatchObject({ status: "SENT" });
  // Simulate its exhausted transport budget, then use the actual operator retry.
  await db.emailDelivery.update({
    where: { id: failed.id },
    data: { status: "FAILED", attempts: 5 },
  });
  fixture.send.mockResolvedValue(undefined);
  expect(await retrySchoolHoursReport(db, reportId, actorId)).toEqual({
    retried: 1,
  });
  await deliverNotifications();
  expect(fixture.send).toHaveBeenCalledTimes(3);
  expect(fixture.send.mock.calls[2]![0]).toEqual(first);
  expect(await db.schoolHoursReport.count({ where: { id: reportId } })).toBe(1);
});

it("fences stale claimed leases and completions after an expired SENDING recovery", async () => {
  const first = await claim();
  expect(first?.row.attemptId).toBeTruthy();
  const row = first!.row;
  await db.emailDelivery.update({
    where: { id: row.id },
    data: { leaseUntil: new Date(Date.now() + 600_000) },
  });
  expect(
    await admitSchoolHoursDelivery(db, row.id, row.leaseUntil, row.attemptId),
  ).toBeNull();
  await db.emailDelivery.update({
    where: { id: row.id },
    data: { leaseUntil: new Date(Date.now() - 1000) },
  });
  await deliverNotifications();
  expect(fixture.send).toHaveBeenCalledTimes(1);
  await finishSchoolHoursDelivery(db, row.id, row.attemptId!, false);
  expect(await delivery()).toMatchObject({ status: "SENT", attempts: 2 });
});

it.each(["revoked", "superseded", "removed", "disabled", "feature"])(
  "rechecks %s report eligibility before sending",
  async (reason) => {
    if (reason === "revoked")
      await db.schoolHoursReport.update({
        where: { id: reportId },
        data: { linkRevokedAt: new Date() },
      });
    if (reason === "superseded")
      await db.schoolHoursReport.update({
        where: { id: reportId },
        data: { supersededById: "private-new-report" },
      });
    if (reason === "removed")
      await db.schoolHoursSchedule.update({
        where: { id: "program" },
        data: { recipientEmails: [] },
      });
    if (reason === "disabled")
      await db.schoolHoursSchedule.update({
        where: { id: "program" },
        data: { enabled: false },
      });
    if (reason === "feature")
      await db.programFeature.update({
        where: { key: "SERVICE_HOURS" },
        data: { enabled: false },
      });
    expect(await claim()).toBeNull();
    expect((await delivery()).status).toBe(
      reason === "feature" ? "BLOCKED" : "SKIPPED",
    );
    expect(fixture.send).not.toHaveBeenCalled();
  },
);

it("blocks token reproduction after secret rotation while previously issued links still retrieve", async () => {
  vi.stubEnv("AUTH_SECRET", "synthetic-rotated-delivery-secret");
  expect((await retrieveSchoolHoursReport(db, token)).status).toBe("ready");
  expect(await claim()).toBeNull();
  expect(await delivery()).toMatchObject({
    status: "BLOCKED",
    lastError: "LINK_REISSUE_REQUIRED",
  });
  const replacement = issueSchoolHoursToken(reportId, 2);
  await db.schoolHoursReport.update({
    where: { id: reportId },
    data: { linkVersion: 2, linkTokenHash: schoolHoursTokenHash(replacement) },
  });
  expect((await retrieveSchoolHoursReport(db, token)).status).toBe(
    "unavailable",
  );
  expect((await retrieveSchoolHoursReport(db, replacement)).status).toBe(
    "ready",
  );
  expect(await retrySchoolHoursReport(db, reportId, actorId)).toEqual({
    retried: 1,
  });
  const admitted = await claim();
  expect(schoolHoursDeliveryCopy(admitted!).text).toContain(replacement);
});

it("public HTML and CSV GETs require only the scoped bearer link and never mutate reporting or delivery", async () => {
  const before = await delivery();
  const request = new Request(
    `https://reports.example.test/reports/service-hours/${token}`,
    { headers: { cookie: "authjs.session-token=invalid" } },
  );
  const html = await getHtml(request, { params: Promise.resolve({ token }) });
  expect(html.status).toBe(200);
  expect(html.headers.get("cache-control")).toContain("no-store");
  expect(html.headers.get("referrer-policy")).toBe("no-referrer");
  expect(html.headers.get("x-robots-tag")).toContain("noindex");
  expect(html.headers.get("content-security-policy")).toContain(
    "default-src 'none'",
  );
  const body = await html.text();
  expect(body).toContain("+7 h");
  expect(body).toContain("-0.5 h");
  expect(body).not.toContain("synthetic-private-baseline");
  expect(body).not.toContain(recipient);
  expect(body).not.toContain("private-person-a");
  expect(body).not.toMatch(/<script\b|<iframe\b/);
  const csv = await getCsv(request, { params: Promise.resolve({ token }) });
  expect(csv.status).toBe(200);
  expect(csv.headers.get("content-type")).toContain("text/csv");
  expect(csv.headers.get("referrer-policy")).toBe("no-referrer");
  const expected = schoolHoursCsv(
    publicSchoolHoursReport(schoolHoursTestSnapshot()),
  ).content;
  // Fetch decodes UTF-8 BOM; compare the exact remaining CSV bytes/content.
  expect(await csv.text()).toBe(expected.replace(/^\uFEFF/, ""));
  expect(await delivery()).toEqual(before);
});

it.each(["invalid", "revoked", "superseded"])(
  "public HTML and CSV safely refuse %s links",
  async (state) => {
    const raw = state === "invalid" ? token.replace("v1.", "v9.") : token;
    if (state === "revoked")
      await db.schoolHoursReport.update({
        where: { id: reportId },
        data: { linkRevokedAt: new Date() },
      });
    if (state === "superseded")
      await db.schoolHoursReport.update({
        where: { id: reportId },
        data: { supersededById: "private-replacement" },
      });
    for (const handler of [getHtml, getCsv]) {
      const response = await handler(
        new Request("https://reports.example.test/"),
        { params: Promise.resolve({ token: raw }) },
      );
      expect(response.status).toBe(state === "invalid" ? 404 : 410);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.text()).not.toContain("Alexander");
    }
  },
);
