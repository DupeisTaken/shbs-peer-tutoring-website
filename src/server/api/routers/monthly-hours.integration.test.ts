import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
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
  MonthlyHoursSchedule,
  ProgramFeature,
  ProgramSettings,
} from "../../../../generated/prisma";
import type { MonthlyHoursSettingsInput } from "~/server/monthly-hours-input";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { ApprovalQueued } from "~/server/approvals";
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

async function generationInput() {
  const preview = await actor().monthlyHours.preview({ month });
  return {
    month,
    expectedVersion: preview.configVersion,
    expectedContentHash: preview.contentHash,
    expectedLatestRevision: preview.latestRevision,
    requestId: randomUUID(),
    reason: "Synthetic reviewed revision",
  };
}

async function queued(input: MonthlyHoursSettingsInput) {
  const failure: unknown = await actor("COORDINATOR")
    .monthlyHours.save(input)
    .catch((error: unknown) => error);
  expect((failure as { cause?: unknown }).cause).toBeInstanceOf(ApprovalQueued);
  return db.approvalRequest.findUniqueOrThrow({
    where: { id: (failure as { cause: ApprovalQueued }).cause.approvalId },
  });
}

async function expectRefusal(
  work: Promise<unknown>,
  allowedCodes: readonly string[],
) {
  const failure: unknown = await work.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(TRPCError);
  expect(allowedCodes).toContain(
    failure instanceof TRPCError ? failure.code : undefined,
  );
}

it.each(["VIEWER", "TUTOR"] as const)(
  "denies %s all monthly-report reads",
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

it("lets a Coordinator inspect settings, preview and saved evidence without applying or sending", async () => {
  const api = actor("COORDINATOR").monthlyHours;
  const settings = await api.settings();
  expect(settings).toMatchObject({
    canEdit: true,
    canApply: false,
    canGenerate: false,
  });
  expect(settings.recentReports.some((report) => report.id === reportId)).toBe(
    true,
  );
  expect(await api.preview({ month })).toMatchObject({
    month,
    configVersion: 0,
  });
  expect(await api.report({ id: reportId })).toMatchObject({
    month,
    revision: 1,
    rows: [
      { englishName: "Synthetic Historical Tutor", active: false, total: 0.5 },
    ],
  });
  expect((await api.csv({ id: reportId })).content).toContain(
    "Synthetic Historical Tutor",
  );
  expect(
    (
      await db.monthlyHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      })
    ).version,
  ).toBe(0);
});

it.each(["ADMIN", "HEAD"] as const)(
  "lets %s apply configuration directly with no approval proposal",
  async (role) => {
    const result = await actor(role).monthlyHours.save(await settingsInput());
    expect(result.config).toMatchObject({
      enabled: true,
      version: 1,
      recipientUserIds: [id("HEAD")],
    });
    expect(
      await db.approvalRequest.count({ where: { requesterId: id(role) } }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: { userId: id(role), operation: "monthlyHours.save" },
      }),
    ).toBeGreaterThan(0);
  },
);

it("queues a Coordinator settings change without live writes and lets an Admin replay the reviewed configuration", async () => {
  const before = await db.monthlyHoursSchedule.findUniqueOrThrow({
    where: { id: "program" },
  });
  const proposal = await queued(await settingsInput());
  expect(proposal).toMatchObject({
    operation: "monthlyHours.save",
    state: "PENDING",
  });
  expect(
    await db.monthlyHoursSchedule.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toEqual(before);
  await expect(
    actor("COORDINATOR").approval.decide({
      id: proposal.id,
      approve: true,
      note: "Synthetic self-review refused",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await actor("ADMIN").approval.decide({
    id: proposal.id,
    approve: true,
    note: "Synthetic configuration reviewed",
  });
  expect(
    await db.monthlyHoursSchedule.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toMatchObject({
    enabled: true,
    version: 1,
    recipientUserIds: [id("HEAD")],
  });
  expect(
    await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } }),
  ).toMatchObject({ state: "APPROVED" });
});

it("does not turn Coordinator generation or retry into an approval bypass", async () => {
  await actor().monthlyHours.save(await settingsInput());
  const before = await db.monthlyHoursReport.count({
    where: { generatedById: { startsWith: prefix } },
  });
  await expect(
    actor("COORDINATOR").monthlyHours.generate(await generationInput()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    actor("COORDINATOR").monthlyHours.retry({ id: reportId }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await db.approvalRequest.count({
      where: { requesterId: id("COORDINATOR") },
    }),
  ).toBe(0);
  expect(
    await db.monthlyHoursReport.count({
      where: { generatedById: { startsWith: prefix } },
    }),
  ).toBe(before);
});

it("rejects a stale settings version without overwriting applied configuration", async () => {
  const stale = await settingsInput();
  await actor().monthlyHours.save(stale);
  const applied = await db.monthlyHoursSchedule.findUniqueOrThrow({
    where: { id: "program" },
  });
  await expect(
    actor("ADMIN").monthlyHours.save({ ...stale, dayOfMonth: 4 }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.monthlyHoursSchedule.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toEqual(applied);
});

it("refuses proposal replay after a different configuration has been applied", async () => {
  const proposal = await queued(await settingsInput());
  await actor().monthlyHours.save(
    await settingsInput({ enabled: false, dayOfMonth: 4 }),
  );
  const applied = await db.monthlyHoursSchedule.findUniqueOrThrow({
    where: { id: "program" },
  });
  await expect(
    actor("ADMIN").approval.decide({
      id: proposal.id,
      approve: true,
      note: "Synthetic stale review",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.monthlyHoursSchedule.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toEqual(applied);
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } }))
      .state,
  ).toBe("PENDING");
});

it.each(["role", "unverified", "proof-changed"] as const)(
  "refuses proposal replay when the selected recipient's %s evidence changes",
  async (change) => {
    const proposal = await queued(await settingsInput());
    if (change === "role")
      await db.user.update({
        where: { id: id("HEAD") },
        data: { role: "VIEWER" },
      });
    else
      await db.accountEmail.update({
        where: { email: mailbox("HEAD") },
        data: {
          verifiedAt:
            change === "unverified" ? null : new Date("1991-01-02T00:00:00Z"),
        },
      });
    await expectRefusal(
      actor("ADMIN").approval.decide({
        id: proposal.id,
        approve: true,
        note: "Synthetic recipient evidence changed",
      }),
      ["CONFLICT", "BAD_REQUEST", "PRECONDITION_FAILED"],
    );
    expect(
      await db.monthlyHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      }),
    ).toMatchObject({ enabled: false, version: 0 });
    expect(
      (
        await db.approvalRequest.findUniqueOrThrow({
          where: { id: proposal.id },
        })
      ).state,
    ).toBe("PENDING");
  },
);

it("preserves staff settings and saved history when the feature is off, blocks preview and enabling, and allows disabling", async () => {
  await db.programFeature.update({
    where: { key: "SERVICE_HOURS" },
    data: { enabled: false },
  });
  expect(await actor("COORDINATOR").monthlyHours.settings()).toMatchObject({
    serviceHoursEnabled: false,
  });
  expect(
    await actor("COORDINATOR").monthlyHours.report({ id: reportId }),
  ).toMatchObject({ revision: 1 });
  expect(
    (await actor("COORDINATOR").monthlyHours.csv({ id: reportId })).filename,
  ).toContain(month);
  await expect(actor().monthlyHours.preview({ month })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    actor().monthlyHours.save(await settingsInput()),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(
    (await actor().monthlyHours.save(await settingsInput({ enabled: false })))
      .config,
  ).toMatchObject({ enabled: false, version: 1 });
});

it("refuses a new manual report after service hours is disabled, even with an earlier valid preview", async () => {
  await actor().monthlyHours.save(await settingsInput());
  const input = await generationInput();
  await db.programFeature.update({
    where: { key: "SERVICE_HOURS" },
    data: { enabled: false },
  });
  await expectRefusal(actor().monthlyHours.generate(input), [
    "FORBIDDEN",
    "PRECONDITION_FAILED",
  ]);
  expect(
    await db.monthlyHoursReport.count({
      where: { generatedById: { startsWith: prefix } },
    }),
  ).toBe(1);
});
