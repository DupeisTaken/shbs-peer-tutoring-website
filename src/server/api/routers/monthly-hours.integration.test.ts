import { randomUUID } from "node:crypto";
import superjson from "superjson";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import type { MockInstance } from "vitest";
import type { Session } from "next-auth";
import type {
  Prisma,
  MonthlyHoursSchedule,
  ProgramFeature,
  ProgramSettings,
} from "../../../../generated/prisma";
import type { MonthlyHoursSettingsInput } from "~/server/monthly-hours-input";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { queueProposal } from "~/server/approvals";
import { emailSender, type EmailSender } from "~/server/email/sender";

// These API/approval regressions own prefixed fixtures and temporarily configure
// the singleton only inside the guarded, serial integration database slot.
assertIsolatedTestDatabase(process.env.DATABASE_URL);
const prefix = "monthly-hours-router-regression-";
const id = (value: string) => prefix + value;
const month = "1991-09";
const reportId = id("saved-report");
const roles = ["HEAD", "ADMIN", "COORDINATOR", "VIEWER", "TUTOR"] as const;
type Role = (typeof roles)[number];
const mailbox = (role: Role) => `${id(role.toLowerCase())}@example.test`;
let originalSchedule: MonthlyHoursSchedule | null;
let originalSettings: ProgramSettings | null;
let originalFeature: ProgramFeature | null;
let sendSpy: MockInstance<EmailSender["send"]>;

const actor = (role: Role = "HEAD") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: id(role), name: `Synthetic ${role}`, email: mailbox(role) },
      role: role as Session["role"],
      tutorId: role === "TUTOR" ? id("tutor") : null,
      expires: "2099-01-01T00:00:00Z",
    },
  });

async function cleanup() {
  const proposals = await db.approvalRequest.findMany({
    where: { requesterId: { startsWith: prefix } },
    select: { id: true },
  });
  const links = proposals.map(
    (proposal) => `/admin/approvals?request=${proposal.id}`,
  );
  const ownedReports = {
    OR: [
      { id: { startsWith: prefix } },
      { generatedById: { startsWith: prefix } },
    ],
  };
  await db.emailDelivery.deleteMany({
    where: {
      OR: [
        { userId: { startsWith: prefix } },
        { destination: { in: links } },
        { monthlyHoursReport: ownedReports },
      ],
    },
  });
  await db.notification.deleteMany({
    where: {
      OR: [{ userId: { startsWith: prefix } }, { link: { in: links } }],
    },
  });
  await db.monthlyHoursReport.deleteMany({ where: ownedReports });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { userId: { startsWith: prefix } },
        { entityId: { startsWith: prefix } },
        { approvalId: { in: proposals.map((proposal) => proposal.id) } },
      ],
    },
  });
  await db.approvalRequest.deleteMany({
    where: { requesterId: { startsWith: prefix } },
  });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.tutor.deleteMany({ where: { id: id("tutor") } });
}

beforeAll(async () => {
  [originalSchedule, originalSettings, originalFeature] = await Promise.all([
    db.monthlyHoursSchedule.findUnique({ where: { id: "program" } }),
    db.programSettings.findUnique({ where: { id: "program" } }),
    db.programFeature.findUnique({ where: { key: "SERVICE_HOURS" } }),
  ]);
});

beforeEach(async () => {
  await cleanup();
  sendSpy = vi.spyOn(emailSender, "send").mockResolvedValue(undefined);
  await db.tutor.create({
    data: { id: id("tutor"), englishName: "Synthetic Participant" },
  });
  await db.user.createMany({
    data: roles.map((role) => ({
      id: id(role),
      role,
      name: `Synthetic ${role}`,
      email: mailbox(role),
      emailInfo: true,
      emailVerifiedAt: new Date("1991-01-01T00:00:00Z"),
      tutorId: role === "TUTOR" ? id("tutor") : null,
    })),
  });
  await db.accountEmail.createMany({
    data: roles.map((role) => ({
      userId: id(role),
      email: mailbox(role),
      verifiedAt: new Date("1991-01-01T00:00:00Z"),
    })),
    skipDuplicates: true,
  });
  await db.programSettings.upsert({
    where: { id: "program" },
    create: {
      id: "program",
      emailNotificationsEnabled: true,
      timeZone: "Asia/Shanghai",
    },
    update: { emailNotificationsEnabled: true, timeZone: "Asia/Shanghai" },
  });
  await db.programFeature.upsert({
    where: { key: "SERVICE_HOURS" },
    create: { key: "SERVICE_HOURS", enabled: true },
    update: { enabled: true },
  });
  const config = {
    enabled: false,
    recipientUserIds: [],
    dayOfMonth: 3,
    localTime: "09:00",
    timeZone: "Asia/Shanghai",
    version: 0,
    firstReportMonth: null,
    nextReportMonth: null,
    nextDueAt: null,
    lastGenerationError: null,
  };
  await db.monthlyHoursSchedule.upsert({
    where: { id: "program" },
    create: { id: "program", ...config },
    update: config,
  });
  await db.monthlyHoursReport.create({
    data: {
      id: reportId,
      scheduleId: "program",
      month,
      revision: 1,
      configVersion: 0,
      timeZone: "Asia/Shanghai",
      contentHash: "a".repeat(64),
      generationKey: id("saved-generation"),
      generationHash: "b".repeat(64),
      generatedById: id("HEAD"),
      intendedRecipients: [],
      snapshot: {
        schemaVersion: 1,
        month,
        rows: [
          {
            tutorId: id("past-tutor"),
            englishName: "Synthetic Historical Tutor",
            active: false,
            sessions: 1,
            adjustmentCount: 1,
            earned: 1,
            extras: 0,
            punishments: 0.5,
            total: 0.5,
          },
        ],
        totals: {
          tutors: 1,
          sessions: 1,
          earned: 1,
          extras: 0,
          punishments: 0.5,
          total: 0.5,
        },
      },
    },
  });
});

afterEach(() => {
  // Preview, configuration, report reads and approval must never start SMTP.
  expect(sendSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

afterAll(async () => {
  try {
    await cleanup();
    if (originalSchedule)
      await db.monthlyHoursSchedule.update({
        where: { id: "program" },
        data: originalSchedule,
      });
    else await db.monthlyHoursSchedule.deleteMany({ where: { id: "program" } });
    if (originalSettings)
      await db.programSettings.update({
        where: { id: "program" },
        data: {
          emailNotificationsEnabled: originalSettings.emailNotificationsEnabled,
          timeZone: originalSettings.timeZone,
        },
      });
    else await db.programSettings.deleteMany({ where: { id: "program" } });
    if (originalFeature)
      await db.programFeature.update({
        where: { key: "SERVICE_HOURS" },
        data: originalFeature,
      });
    else
      await db.programFeature.deleteMany({ where: { key: "SERVICE_HOURS" } });
  } finally {
    await db.$disconnect();
  }
});

async function settingsInput(
  overrides: Partial<MonthlyHoursSettingsInput> = {},
): Promise<MonthlyHoursSettingsInput> {
  const current = await actor().monthlyHours.settings();
  return {
    enabled: true,
    recipientUserIds: [id("HEAD")],
    dayOfMonth: 3,
    localTime: "09:00",
    timeZone: "Asia/Shanghai",
    expectedVersion: current.config.version,
    ...overrides,
  };
}

function generationInput() {
  return {
    month,
    expectedVersion: 0,
    expectedContentHash: "a".repeat(64),
    expectedLatestRevision: 1,
    requestId: randomUUID(),
    reason: "Synthetic stale-tab issue",
  };
}

async function retainedState() {
  return {
    schedule: await db.monthlyHoursSchedule.findUniqueOrThrow({
      where: { id: "program" },
    }),
    report: await db.monthlyHoursReport.findUniqueOrThrow({
      where: { id: reportId },
    }),
    reports: await db.monthlyHoursReport.count(),
    deliveries: await db.emailDelivery.count(),
    proposals: await db.approvalRequest.count(),
  };
}

it.each(["VIEWER", "TUTOR"] as const)(
  "denies %s all legacy monthly-report reads",
  async (role) => {
    const api = actor(role).monthlyHours;
    for (const read of [
      () => api.settings(),
      () => api.preview({ month }),
      () => api.report({ id: reportId }),
      () => api.csv({ id: reportId }),
    ])
      await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);

it.each(["HEAD", "ADMIN", "COORDINATOR"] as const)(
  "lets %s inspect read-only settings and saved evidence without applying or sending",
  async (role) => {
    const before = await retainedState();
    const api = actor(role).monthlyHours;
    const settings = await api.settings();
    expect(settings).toMatchObject({
      canEdit: false,
      canApply: false,
      canGenerate: false,
    });
    expect(
      settings.recentReports.some((report) => report.id === reportId),
    ).toBe(true);
    expect(await api.report({ id: reportId })).toMatchObject({
      month,
      revision: 1,
      rows: [
        {
          englishName: "Synthetic Historical Tutor",
          active: false,
          total: 0.5,
        },
      ],
    });
    expect((await api.csv({ id: reportId })).content).toContain(
      "Synthetic Historical Tutor",
    );
    expect(await retainedState()).toEqual(before);
  },
);

it.each(["HEAD", "ADMIN", "COORDINATOR"] as const)(
  "refuses every retired overview action from a stale %s tab without source, delivery or proposal writes",
  async (role) => {
    // A stale/deployed schedule state cannot weaken the permanent API retirement.
    await db.monthlyHoursSchedule.update({
      where: { id: "program" },
      data: { enabled: true, recipientUserIds: [id("HEAD")] },
    });
    const before = await retainedState();
    const api = actor(role).monthlyHours;
    for (const attempt of [
      () => api.preview({ month }),
      async () => api.save(await settingsInput()),
      () => api.generate(generationInput()),
      () => api.retry({ id: reportId }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message:
          "Monthly overviews have been retired. Use School Month Reports.",
      });
      expect(await retainedState()).toEqual(before);
    }
  },
);

it("refuses direct proposal queuing for the retired configuration", async () => {
  const before = await retainedState();
  await expect(
    queueProposal(
      {
        user: { id: id("COORDINATOR"), name: "Synthetic Coordinator" },
        role: "COORDINATOR",
        tutorId: null,
        expires: "2099-01-01T00:00:00Z",
      },
      "monthlyHours.save",
      await settingsInput(),
    ),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await retainedState()).toEqual(before);
});

it.each(["ADMIN", "HEAD"] as const)(
  "refuses %s replay of a pending legacy proposal even with captured review authority",
  async (role) => {
    const proposal = await db.approvalRequest.create({
      data: {
        requesterId: id("COORDINATOR"),
        requesterName: "Synthetic Coordinator",
        operation: "monthlyHours.save",
        payload: superjson.serialize(
          await settingsInput(),
        ) as unknown as Prisma.InputJsonObject,
        targets: {
          reviewAuthority: {
            category: "SIGNIFICANT_SETTING",
            directRoles: ["ADMIN", "HEAD"],
            requesterRoles: ["COORDINATOR", "ADMIN", "HEAD"],
            reviewerRoles: ["ADMIN", "HEAD"],
          },
        },
        fingerprint: "c".repeat(64),
      },
    });
    const before = await retainedState();
    await expect(
      actor(role).approval.decide({
        id: proposal.id,
        approve: true,
        note: "A saved old approval must not restart the workflow",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await retainedState()).toEqual(before);
    expect(
      await db.approvalRequest.findUniqueOrThrow({
        where: { id: proposal.id },
      }),
    ).toEqual(proposal);
  },
);

it("preserves saved evidence with the feature off while all legacy live actions remain retired", async () => {
  await db.programFeature.update({
    where: { key: "SERVICE_HOURS" },
    data: { enabled: false },
  });
  const before = await retainedState();
  expect(await actor("COORDINATOR").monthlyHours.settings()).toMatchObject({
    serviceHoursEnabled: false,
    canEdit: false,
    canApply: false,
    canGenerate: false,
  });
  expect(
    await actor("COORDINATOR").monthlyHours.report({ id: reportId }),
  ).toMatchObject({ revision: 1 });
  expect(
    (await actor("COORDINATOR").monthlyHours.csv({ id: reportId })).filename,
  ).toContain(month);
  await expect(actor().monthlyHours.preview({ month })).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  await expect(
    actor().monthlyHours.save(await settingsInput({ enabled: false })),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await retainedState()).toEqual(before);
});
