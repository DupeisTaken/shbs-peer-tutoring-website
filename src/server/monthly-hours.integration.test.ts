import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  generateMonthlyHours,
  getMonthlyHoursReport,
  monthlyHoursCsv,
  previewMonthlyHours,
  retryMonthlyHoursReport,
  saveMonthlyHoursSettings,
  sweepMonthlyHours,
} from "./monthly-hours";
import {
  admitMonthlyHoursDelivery,
  finishMonthlyHoursDelivery,
} from "./monthly-hours-delivery";
import type {
  MonthlyHoursSchedule,
  ProgramSettings,
} from "../../generated/prisma";
const transport = vi.hoisted(() => ({ available: true }));
vi.mock("~/server/email/sender", () => ({
  isEmailDeliveryAvailable: () => transport.available,
}));

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const prefix = "monthly-hours-domain-";
const actorId = `${prefix}admin`;
const recipientId = `${prefix}recipient`;
const month = "2014-09";
let previousSchedule: MonthlyHoursSchedule | null;
let previousSettings: ProgramSettings | null;
let previousFeature: {
  enabled: boolean;
  pendingEnabled: boolean | null;
} | null;
const preservedReports = new Set<string>();
const settingsInput = (expectedVersion = 0) => ({
  enabled: true,
  recipientUserIds: [actorId, recipientId],
  dayOfMonth: 3,
  localTime: "09:00",
  timeZone: "Asia/Shanghai",
  expectedVersion,
});

async function cleanReports() {
  const candidates = await db.monthlyHoursReport.findMany({
    where: { month: { startsWith: "2014-" } },
    select: { id: true },
  });
  const reports = candidates.filter((row) => !preservedReports.has(row.id));
  await db.emailDelivery.deleteMany({
    where: { monthlyHoursReportId: { in: reports.map((row) => row.id) } },
  });
  await db.auditLog.deleteMany({
    where: {
      entity: "MonthlyHoursReport",
      entityId: { in: reports.map((row) => row.id) },
    },
  });
  await db.monthlyHoursReport.deleteMany({
    where: { id: { in: reports.map((row) => row.id) } },
  });
}
beforeAll(async () => {
  for (const report of await db.monthlyHoursReport.findMany({
    where: { month: { startsWith: "2014-" } },
    select: { id: true },
  }))
    preservedReports.add(report.id);
  previousSchedule = await db.monthlyHoursSchedule.findUnique({
    where: { id: "program" },
  });
  previousSettings = await db.programSettings.findUnique({
    where: { id: "program" },
  });
  previousFeature = await db.programFeature.findUnique({
    where: { key: "SERVICE_HOURS" },
    select: { enabled: true, pendingEnabled: true },
  });
  vi.stubEnv("AUTH_URL", "https://monthly.example.test");
  await db.user.createMany({
    data: [actorId, recipientId].map((id) => ({
      id,
      role: "ADMIN" as const,
      name: "Synthetic staff",
      email: `${id}@example.test`,
      emailVerifiedAt: new Date(),
      emailInfo: true,
    })),
  });
  await db.tutor.createMany({
    data: [
      {
        id: `${prefix}active`,
        englishName: "Duplicate synthetic name",
        status: "ACTIVE",
      },
      {
        id: `${prefix}inactive`,
        englishName: "Duplicate synthetic name",
        status: "ARCHIVED",
      },
      { id: `${prefix}zero`, englishName: "=SUM(1,2)", status: "OPTED_OUT" },
      { id: `${prefix}empty`, englishName: "No evidence", status: "ACTIVE" },
    ],
  });
  await db.term.create({
    data: {
      id: `${prefix}term`,
      name: "Synthetic historical term",
      schoolYear: "14-15",
      quarter: "Q1",
      active: false,
    },
  });
  await db.pairing.create({
    data: {
      id: `${prefix}pairing`,
      tutorId: `${prefix}zero`,
      termId: `${prefix}term`,
      subject: "Synthetic",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
  await db.session.create({
    data: {
      id: `${prefix}session`,
      tutorId: `${prefix}zero`,
      pairingId: `${prefix}pairing`,
      date: new Date("2014-09-01T00:00:00Z"),
      month,
      schoolYear: "14-15",
      quarter: "Q1",
      startMin: 900,
      endMin: 960,
      durationMin: 60,
      shFactor: 0,
      shCount: 0,
    },
  });
  await db.serviceHourAdjustment.createMany({
    data: [
      {
        id: `${prefix}extra`,
        tutorId: `${prefix}active`,
        month,
        schoolYear: "14-15",
        quarter: "Q1",
        type: "EXTRA",
        amount: 1 / 60,
      },
      {
        id: `${prefix}penalty`,
        tutorId: `${prefix}inactive`,
        month,
        schoolYear: "14-15",
        quarter: "Q1",
        type: "PUNISHMENT",
        amount: 0.25,
        reason: "Never emailed synthetic private reason",
      },
    ],
  });
});
beforeEach(async () => {
  transport.available = true;
  await cleanReports();
  // Only this suite's singleton fields are reset. Other program configuration stays intact.
  await db.monthlyHoursSchedule.upsert({
    where: { id: "program" },
    create: { id: "program" },
    update: {
      enabled: false,
      version: 0,
      recipientUserIds: [],
      firstReportMonth: null,
      nextReportMonth: null,
      nextDueAt: null,
      lastGenerationError: null,
    },
  });
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
    where: { id: { in: [actorId, recipientId] } },
    data: {
      role: "ADMIN",
      emailInfo: true,
      suspendedAt: null,
      mergedIntoId: null,
    },
  });
  await db.accountEmail.updateMany({
    where: { userId: { in: [actorId, recipientId] } },
    data: { verifiedAt: new Date() },
  });
  await db.serviceHourAdjustment.update({
    where: { id: `${prefix}extra` },
    data: { amount: 1 / 60 },
  });
  await saveMonthlyHoursSettings(db, settingsInput(), actorId);
});
afterAll(async () => {
  await cleanReports();
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { userId: { in: [actorId, recipientId] } },
        { operation: "monthlyHours.sweep", entityId: { startsWith: prefix } },
      ],
    },
  });
  await db.session.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.serviceHourAdjustment.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await db.pairing.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.tutor.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.term.deleteMany({ where: { id: `${prefix}term` } });
  await db.user.deleteMany({ where: { id: { in: [actorId, recipientId] } } });
  if (previousSchedule)
    await db.monthlyHoursSchedule.update({
      where: { id: "program" },
      data: previousSchedule,
    });
  else await db.monthlyHoursSchedule.delete({ where: { id: "program" } });
  if (previousSettings)
    await db.programSettings.update({
      where: { id: "program" },
      data: {
        emailNotificationsEnabled: previousSettings.emailNotificationsEnabled,
      },
    });
  else await db.programSettings.delete({ where: { id: "program" } });
  if (previousFeature)
    await db.programFeature.update({
      where: { key: "SERVICE_HOURS" },
      data: previousFeature,
    });
  else await db.programFeature.delete({ where: { key: "SERVICE_HOURS" } });
  vi.unstubAllEnvs();
});

async function generate(targetMonth = month, reason?: string) {
  const preview = await previewMonthlyHours(db, targetMonth);
  return generateMonthlyHours(
    db,
    {
      month: targetMonth,
      expectedVersion: preview.configVersion,
      expectedContentHash: preview.contentHash,
      expectedLatestRevision: preview.latestRevision,
      requestId: randomUUID(),
      ...(reason ? { reason } : {}),
    },
    actorId,
  );
}
async function claim(id: string) {
  const candidate = await db.emailDelivery.findUniqueOrThrow({ where: { id } });
  // The dispatcher never leases terminal rows. Preserve that constraint while
  // allowing individual tests to simulate an expired/replaced active lease.
  if (!["PENDING", "SENDING"].includes(candidate.status)) return null;
  const leaseUntil = new Date(Date.now() + 300_000);
  const row = await db.emailDelivery.update({
    where: { id },
    data: { leaseUntil },
  });
  return admitMonthlyHoursDelivery(db, id, leaseUntil, row.attemptId);
}

it("snapshots all scoped evidence, zero-credit and inactive rows without merging duplicate names", async () => {
  const result = await generate();
  const report = await getMonthlyHoursReport(db, result.reportId);
  expect(report.rows.map((row) => row.tutorId)).toEqual(
    expect.arrayContaining([
      `${prefix}active`,
      `${prefix}inactive`,
      `${prefix}zero`,
    ]),
  );
  expect(report.rows.some((row) => row.tutorId === `${prefix}empty`)).toBe(
    false,
  );
  expect(
    report.rows.filter((row) => row.englishName === "Duplicate synthetic name"),
  ).toHaveLength(2);
  expect(report.totals.total).toBeCloseTo(1 / 60 - 0.25);
  expect(
    report.rows.find((row) => row.tutorId === `${prefix}zero`)?.sessions,
  ).toBe(1);
  expect(JSON.stringify(report)).not.toContain(
    "Never emailed synthetic private reason",
  );
  const csv = await monthlyHoursCsv(db, report.id);
  expect(csv.content).toContain("'=SUM(1,2)");
  expect(csv.content).toContain("\uFEFF");
});

it("concurrent idempotent generation creates one report and mailbox set", async () => {
  const preview = await previewMonthlyHours(db, month);
  const input = {
    month,
    expectedVersion: preview.configVersion,
    expectedContentHash: preview.contentHash,
    expectedLatestRevision: 0,
    requestId: randomUUID(),
  };
  const [one, two] = await Promise.all([
    generateMonthlyHours(db, input, actorId),
    generateMonthlyHours(db, input, actorId),
  ]);
  expect(two).toEqual(one);
  expect(await db.monthlyHoursReport.count({ where: { month } })).toBe(1);
  expect(
    await db.emailDelivery.count({
      where: { monthlyHoursReportId: one.reportId },
    }),
  ).toBe(2);
});

it("a rolled-back snapshot transaction leaves no report or partial outbox", async () => {
  const preview = await previewMonthlyHours(db, month);
  await expect(
    db.$transaction(
      async (tx) => {
        await generateMonthlyHours(
          tx,
          {
            month,
            expectedVersion: preview.configVersion,
            expectedContentHash: preview.contentHash,
            expectedLatestRevision: 0,
            requestId: randomUUID(),
          },
          actorId,
        );
        throw new Error("Synthetic transaction rollback");
      },
      { isolationLevel: "RepeatableRead" },
    ),
  ).rejects.toThrow("Synthetic transaction rollback");
  expect(await db.monthlyHoursReport.count({ where: { month } })).toBe(0);
  expect(
    await db.emailDelivery.count({
      where: { category: "monthly_hours", userId: actorId },
    }),
  ).toBe(0);
});

it("late corrections require reviewed revisions and cannot alter the original snapshot", async () => {
  const first = await generate();
  const original = await getMonthlyHoursReport(db, first.reportId);
  await db.serviceHourAdjustment.update({
    where: { id: `${prefix}extra` },
    data: { amount: 2 },
  });
  await expect(generate()).rejects.toThrow("reason");
  const revised = await generate(month, "Synthetic corrected interview credit");
  expect(revised.revision).toBe(2);
  expect((await getMonthlyHoursReport(db, first.reportId)).rows).toEqual(
    original.rows,
  );
  expect((await getMonthlyHoursReport(db, revised.reportId)).totals.total).toBe(
    1.75,
  );
});

it("recipient ownership or consent drift invalidates a reviewed preview", async () => {
  const preview = await previewMonthlyHours(db, month);
  await db.user.update({
    where: { id: recipientId },
    data: { emailInfo: false },
  });
  await expect(
    generateMonthlyHours(
      db,
      {
        month,
        expectedVersion: preview.configVersion,
        expectedContentHash: preview.contentHash,
        expectedLatestRevision: 0,
        requestId: randomUUID(),
      },
      actorId,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.monthlyHoursReport.count({ where: { month } })).toBe(0);
});

it("rejects manual snapshots between local month-end and UTC accounting month-end", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2014-09-30T16:30:00Z"));
  try {
    await expect(previewMonthlyHours(db, month)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  } finally {
    vi.useRealTimers();
  }
});

it("restored transport requeues blocked frozen mailboxes without revising the report", async () => {
  transport.available = false;
  const result = await generate();
  expect(result.blocked).toBe(2);
  expect(await retryMonthlyHoursReport(db, result.reportId, actorId)).toEqual({
    queued: 0,
  });
  const before = await db.monthlyHoursReport.findUniqueOrThrow({
    where: { id: result.reportId },
  });
  transport.available = true;
  expect(await retryMonthlyHoursReport(db, result.reportId, actorId)).toEqual({
    queued: 2,
  });
  expect(
    (
      await db.monthlyHoursReport.findUniqueOrThrow({
        where: { id: result.reportId },
      })
    ).snapshot,
  ).toEqual(before.snapshot);
});

it("disabling remains available after recipient authority or transport is lost", async () => {
  await db.user.update({ where: { id: recipientId }, data: { role: "TUTOR" } });
  transport.available = false;
  const saved = await saveMonthlyHoursSettings(
    db,
    { ...settingsInput(1), enabled: false },
    actorId,
  );
  expect(saved.config.enabled).toBe(false);
  expect(saved.config.nextDueAt).toBeNull();
  transport.available = true;
  await db.user.update({ where: { id: recipientId }, data: { role: "ADMIN" } });
  const enabled = await saveMonthlyHoursSettings(db, settingsInput(2), actorId);
  expect(enabled.config.nextDueAt!.getTime()).toBeGreaterThan(Date.now());
});

it("bounded restart sweeps skip manual first reports and never duplicate a changed configuration month", async () => {
  await generate();
  await db.monthlyHoursSchedule.update({
    where: { id: "program" },
    data: {
      firstReportMonth: month,
      nextReportMonth: month,
      nextDueAt: new Date("2014-10-03T01:00:00Z"),
    },
  });
  await Promise.all([
    sweepMonthlyHours(db, new Date("2014-12-03T01:00:00Z")),
    sweepMonthlyHours(db, new Date("2014-12-03T01:00:00Z")),
  ]);
  expect(await db.monthlyHoursReport.count({ where: { month } })).toBe(1);
  expect(
    await db.monthlyHoursReport.count({ where: { month: "2014-10" } }),
  ).toBeLessThanOrEqual(1);
  await saveMonthlyHoursSettings(
    db,
    { ...settingsInput(1), localTime: "10:00" },
    actorId,
  );
  await sweepMonthlyHours(db, new Date("2014-12-03T01:00:00Z"));
  expect(await db.monthlyHoursReport.count({ where: { month } })).toBe(1);
});

it.each([
  "role",
  "mailbox",
  "consent",
  "suspended",
  "schedule",
  "feature",
  "global",
])("blocks new SMTP admission after %s revocation", async (change) => {
  const result = await generate();
  const row = await db.emailDelivery.findFirstOrThrow({
    where: { monthlyHoursReportId: result.reportId, userId: recipientId },
  });
  if (change === "role")
    await db.user.update({
      where: { id: recipientId },
      data: { role: "TUTOR" },
    });
  if (change === "mailbox")
    await db.accountEmail.updateMany({
      where: { userId: recipientId },
      data: { verifiedAt: null },
    });
  if (change === "consent")
    await db.user.update({
      where: { id: recipientId },
      data: { emailInfo: false },
    });
  if (change === "suspended")
    await db.user.update({
      where: { id: recipientId },
      data: { suspendedAt: new Date() },
    });
  if (change === "schedule")
    await db.monthlyHoursSchedule.update({
      where: { id: "program" },
      data: { enabled: false },
    });
  if (change === "feature")
    await db.programFeature.update({
      where: { key: "SERVICE_HOURS" },
      data: { enabled: false },
    });
  if (change === "global")
    await db.programSettings.update({
      where: { id: "program" },
      data: { emailNotificationsEnabled: false },
    });
  expect(await claim(row.id)).toBeNull();
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } }))
      .status,
  ).toBe("SKIPPED");
});

it("fences expired leases/stale completion and retries the same immutable report only", async () => {
  const result = await generate();
  const row = await db.emailDelivery.findFirstOrThrow({
    where: { monthlyHoursReportId: result.reportId, userId: actorId },
  });
  const first = await claim(row.id);
  expect(first?.row.attemptId).toBeTruthy();
  const staleLease = first!.row.leaseUntil!;
  await db.emailDelivery.update({
    where: { id: row.id },
    data: { leaseUntil: new Date(Date.now() + 600_000) },
  });
  expect(
    await admitMonthlyHoursDelivery(
      db,
      row.id,
      staleLease,
      first!.row.attemptId,
    ),
  ).toBeNull();
  const second = await claim(row.id);
  await finishMonthlyHoursDelivery(db, row.id, first!.row.attemptId!, true);
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } }))
      .attemptId,
  ).toBe(second!.row.attemptId);
  await finishMonthlyHoursDelivery(db, row.id, second!.row.attemptId!, false);
  const snapshot = await db.monthlyHoursReport.findUniqueOrThrow({
    where: { id: result.reportId },
  });
  await db.emailDelivery.update({
    where: { id: row.id },
    data: { status: "FAILED", attempts: 5 },
  });
  expect(await retryMonthlyHoursReport(db, result.reportId, actorId)).toEqual({
    queued: 1,
  });
  expect(await retryMonthlyHoursReport(db, result.reportId, actorId)).toEqual({
    queued: 0,
  });
  expect(
    (
      await db.monthlyHoursReport.findUniqueOrThrow({
        where: { id: result.reportId },
      })
    ).snapshot,
  ).toEqual(snapshot.snapshot);
});

it("records partial recipient success and stops failed delivery at the bounded attempt budget", async () => {
  const result = await generate();
  const rows = await db.emailDelivery.findMany({
    where: { monthlyHoursReportId: result.reportId },
    orderBy: { recipient: "asc" },
  });
  const accepted = await claim(rows[0]!.id);
  await finishMonthlyHoursDelivery(
    db,
    rows[0]!.id,
    accepted!.row.attemptId!,
    true,
  );
  await db.emailDelivery.update({
    where: { id: rows[1]!.id },
    data: { attempts: 4 },
  });
  const failed = await claim(rows[1]!.id);
  await finishMonthlyHoursDelivery(
    db,
    rows[1]!.id,
    failed!.row.attemptId!,
    false,
  );
  const report = await getMonthlyHoursReport(db, result.reportId);
  expect(report.status).toBe("PARTIAL");
  expect(report.deliveryCounts.sent).toBe(1);
  expect(report.deliveryCounts.failed).toBe(1);
  expect(await claim(rows[1]!.id)).toBeNull();
  expect(await retryMonthlyHoursReport(db, result.reportId, actorId)).toEqual({
    queued: 1,
  });
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: rows[0]!.id } }))
      .status,
  ).toBe("SENT");
});

it("missing-mailbox recovery never retargets a saved receipt to a newly verified address", async () => {
  await db.accountEmail.updateMany({
    where: { userId: recipientId },
    data: { verifiedAt: null },
  });
  const result = await generate();
  expect(result.blocked).toBe(1);
  await db.accountEmail.updateMany({
    where: { userId: recipientId },
    data: { verifiedAt: new Date() },
  });
  expect(await retryMonthlyHoursReport(db, result.reportId, actorId)).toEqual({
    queued: 0,
  });
  const report = await getMonthlyHoursReport(db, result.reportId);
  expect(
    report.intendedRecipients.find((person) => person.userId === recipientId)
      ?.email,
  ).toBeNull();
});
