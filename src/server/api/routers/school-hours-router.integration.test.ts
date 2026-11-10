import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
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
import type { Session } from "next-auth";
import type * as SenderModule from "~/server/email/sender";
import {
  Prisma,
  type ProgramFeature,
  type ProgramSettings,
  type SchoolHoursSchedule,
} from "../../../../generated/prisma";
import type { SchoolHoursSettingsInput } from "~/server/school-hours-input";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

const mail = vi.hoisted(() => ({ send: vi.fn<() => Promise<void>>() }));
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", async (original) => ({
  ...(await original<typeof SenderModule>()),
  emailSender: { send: mail.send },
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { ApprovalQueued } from "~/server/approvals";
import { schoolHoursTestSnapshot } from "~/server/school-hours-test-fixture";
import {
  issueSchoolHoursToken,
  schoolHoursTokenHash,
} from "~/server/school-hours-link";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const prefix = "school-hours-router-";
const id = (value: string) => prefix + value;
const reportId = id("saved-report");
const roles = [
  "HEAD",
  "ADMIN",
  "COORDINATOR",
  "VIEWER",
  "TUTOR",
  "OBSERVER",
] as const;
type Actor = (typeof roles)[number];
const role = (value: Actor): Session["role"] =>
  value === "OBSERVER" ? "STUDENT" : value;
const caller = (value: Actor = "HEAD") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: id(value), email: `${id(value)}@example.test` },
      role: role(value),
      tutorId: value === "TUTOR" ? id("tutor") : null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
let originalSchedule: SchoolHoursSchedule | null;
let originalSettings: ProgramSettings | null;
let originalFeature: ProgramFeature | null;
const originalSecret = process.env.AUTH_SECRET;

async function cleanup() {
  const proposals = await db.approvalRequest.findMany({
    where: { requesterId: { startsWith: prefix } },
    select: { id: true },
  });
  const proposalIds = proposals.map((row) => row.id),
    links = proposalIds.map((key) => `/admin/approvals?request=${key}`);
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
        { schoolHoursReport: ownedReports },
      ],
    },
  });
  await db.notification.deleteMany({
    where: {
      OR: [{ userId: { startsWith: prefix } }, { link: { in: links } }],
    },
  });
  await db.schoolHoursReport.deleteMany({ where: ownedReports });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { userId: { startsWith: prefix } },
        { entityId: { startsWith: prefix } },
        { approvalId: { in: proposalIds } },
      ],
    },
  });
  await db.approvalRequest.deleteMany({ where: { id: { in: proposalIds } } });
  await db.serviceHourAdjustment.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.tutor.deleteMany({ where: { id: { startsWith: prefix } } });
}
beforeAll(async () => {
  [originalSchedule, originalSettings, originalFeature] = await Promise.all([
    db.schoolHoursSchedule.findUnique({ where: { id: "program" } }),
    db.programSettings.findUnique({ where: { id: "program" } }),
    db.programFeature.findUnique({ where: { key: "SERVICE_HOURS" } }),
  ]);
  process.env.AUTH_SECRET = "synthetic-school-router-link-secret";
});
beforeEach(async () => {
  await cleanup();
  mail.send.mockReset().mockResolvedValue(undefined);
  await db.tutor.create({
    data: { id: id("tutor"), englishName: "Synthetic account" },
  });
  await db.user.createMany({
    data: roles.map((value) => ({
      id: id(value),
      email: `${id(value)}@example.test`,
      name: `Synthetic ${value}`,
      role: role(value),
      tutorId: value === "TUTOR" ? id("tutor") : null,
    })),
  });
  await db.schoolDeparture.create({
    data: { userId: id("OBSERVER"), reason: "GRADUATED", source: "TEST" },
  });
  await db.serviceHourAdjustment.create({
    data: {
      id: id("zero-source"),
      tutorId: id("tutor"),
      month: "2011-01",
      schoolYear: "10-11",
      quarter: "Q2",
      type: "EXTRA",
      amount: 0,
    },
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
  const fields = {
    enabled: false,
    recipientEmails: [],
    recipientLabels: {},
    version: 0,
    baselineVersion: 0,
    openingBaseline: { people: [], sources: [] },
    openingReviewedAt: null,
    headReportId: null,
    nextMonth: null,
    nextDueAt: null,
    dateOverrides: {},
    includeStatistics: false,
    lastGenerationError: null,
    timeZone: "Asia/Shanghai",
  };
  await db.schoolHoursSchedule.upsert({
    where: { id: "program" },
    create: { id: "program", ...fields },
    update: fields,
  });
  await db.schoolHoursReport.create({
    data: {
      id: reportId,
      scheduleId: "program",
      month: "2026-10",
      revision: 1,
      configVersion: 0,
      baselineVersion: 0,
      timeZone: "Asia/Shanghai",
      snapshot: schoolHoursTestSnapshot(),
      sourceBaseline: {
        people: [],
        sources: [],
        privateEvidence: "PRIVATE_ROUTER_BASELINE",
      },
      intendedRecipients: ["private-school-office@example.test"],
      generationKey: id("saved"),
      generationHash: "a".repeat(64),
      contentHash: "b".repeat(64),
      generatedById: id("HEAD"),
      linkTokenHash: schoolHoursTokenHash(issueSchoolHoursToken(reportId, 1)),
    },
  });
});
afterEach(() => {
  expect(mail.send).not.toHaveBeenCalled();
});
afterAll(async () => {
  await cleanup();
  if (originalSchedule) {
    const { openingBaseline, dateOverrides, recipientLabels, ...fields } =
      originalSchedule;
    await db.schoolHoursSchedule.update({
      where: { id: "program" },
      data: {
        ...fields,
        openingBaseline:
          openingBaseline == null
            ? Prisma.DbNull
            : (openingBaseline as Prisma.InputJsonObject),
        dateOverrides: dateOverrides as Prisma.InputJsonObject,
        recipientLabels: recipientLabels as Prisma.InputJsonObject,
      },
    });
  } else await db.schoolHoursSchedule.deleteMany({ where: { id: "program" } });
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
  else await db.programFeature.deleteMany({ where: { key: "SERVICE_HOURS" } });
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

const settings = (
  overrides: Partial<SchoolHoursSettingsInput> = {},
): SchoolHoursSettingsInput => ({
  enabled: false,
  recipientEmails: ["school-office@example.test"],
  timeZone: "Asia/Shanghai",
  includeStatistics: false,
  dateOverrides: {},
  expectedVersion: 0,
  ...overrides,
});
async function queued(input = settings()) {
  const failure: unknown = await caller("COORDINATOR")
    .schoolHours.save(input)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(TRPCError);
  if (
    !(failure instanceof TRPCError) ||
    !(failure.cause instanceof ApprovalQueued)
  )
    throw new Error("Expected a Coordinator approval proposal");
  return db.approvalRequest.findUniqueOrThrow({
    where: { id: failure.cause.approvalId },
  });
}
async function baselineInput() {
  const review = await caller().schoolHours.baselinePreview();
  return {
    expectedContentHash: review.contentHash,
    expectedBaselineVersion: review.baselineVersion,
    acknowledged: true as const,
    reason: "Synthetic opening school-account review",
    participants: review.participants.map((row) => ({
      beneficiaryId: row.beneficiaryId,
      schoolAccountKey: `school:${row.beneficiaryId}`,
      earned: 0,
      extras: 0,
      deductions: 0,
      crew: 0,
      reviewed: true as const,
    })),
  };
}
const generationInput = () => ({
  month: "2011-10",
  expectedVersion: 0,
  expectedBaselineVersion: 0,
  expectedHeadId: null,
  expectedContentHash: "c".repeat(64),
  requestId: randomUUID(),
});

it.each(["VIEWER", "TUTOR", "OBSERVER"] as const)(
  "denies %s every private school-report read, including CSV and link metadata",
  async (value) => {
    const api = caller(value).schoolHours;
    for (const read of [
      () => api.settings(),
      () => api.baselinePreview(),
      () => api.preview({ month: "2011-10" }),
      () => api.report({ id: reportId }),
      () => api.csv({ id: reportId }),
    ])
      await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);
it.each(["HEAD", "ADMIN", "COORDINATOR"] as const)(
  "permits %s staff reads without advancing a baseline or exposing private source evidence",
  async (value) => {
    const api = caller(value).schoolHours;
    const before = await db.schoolHoursSchedule.findUniqueOrThrow({
      where: { id: "program" },
    });
    expect((await api.settings()).canEdit).toBe(true);
    expect((await api.baselinePreview()).participants.length).toBeGreaterThan(
      0,
    );
    expect(await api.preview({ month: "2011-10" })).toMatchObject({
      configVersion: 0,
    });
    const report = await api.report({ id: reportId });
    expect(report.id).toBe(reportId);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_ROUTER_BASELINE");
    expect(JSON.stringify(report)).not.toContain(
      "private-school-office@example.test",
    );
    expect((await api.csv({ id: reportId })).content).toContain("Alexander");
    expect(
      await db.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      }),
    ).toEqual(before);
  },
);
it.each(["ADMIN", "HEAD"] as const)(
  "allows %s direct settings with audited application and no proposal",
  async (value) => {
    expect(
      (await caller(value).schoolHours.save(settings())).config,
    ).toMatchObject({
      version: 1,
      recipientEmails: ["school-office@example.test"],
    });
    expect(
      await db.approvalRequest.count({ where: { requesterId: id(value) } }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: { userId: id(value), operation: "schoolHours.save" },
      }),
    ).toBeGreaterThan(0);
  },
);

it("persists recipient labels, preserves them for old callers and removes cleared or deleted entries", async () => {
  const initial = await caller().schoolHours.save(
    settings({
      recipientEmails: ["school-office@example.test", "principal@example.test"],
      recipientLabels: {
        " School-Office@Example.Test ": "  School office  ",
        "principal@example.test": "校长",
      },
    }),
  );
  expect(initial.config.recipientLabels).toEqual({
    "school-office@example.test": "School office",
    "principal@example.test": "校长",
  });
  expect(
    (await caller("COORDINATOR").schoolHours.settings()).config.recipientLabels,
  ).toEqual(initial.config.recipientLabels);
  expect(
    (
      await db.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      })
    ).recipientLabels,
  ).toEqual(initial.config.recipientLabels);

  const legacySave = await caller().schoolHours.save(
    settings({ expectedVersion: 1 }),
  );
  expect(legacySave.config.recipientLabels).toEqual({
    "school-office@example.test": "School office",
  });
  const cleared = await caller().schoolHours.save(
    settings({ expectedVersion: 2, recipientLabels: {} }),
  );
  expect(cleared.config.recipientLabels).toEqual({});
  expect(
    (await caller().schoolHours.settings()).config.recipientLabels,
  ).toEqual({});
});

it.each(["revokeLink", "reissueLink"] as const)(
  "refuses %s without the reviewed link version before changing a saved report",
  async (operation) => {
    const api = caller("ADMIN").schoolHours;
    const before = await db.schoolHoursReport.findUniqueOrThrow({
      where: { id: reportId },
    });
    // Exercise an old/raw client payload that omits the now-required guard.
    const unversioned = { id: reportId } as Parameters<
      typeof api.revokeLink
    >[0];
    await expect(api[operation](unversioned)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(
      await db.schoolHoursReport.findUniqueOrThrow({
        where: { id: reportId },
      }),
    ).toEqual(before);
  },
);
it("queues Coordinator settings without live writes and lets Admin apply the exact proposal", async () => {
  const before = await db.schoolHoursSchedule.findUniqueOrThrow({
    where: { id: "program" },
  });
  const proposal = await queued(
    settings({
      recipientLabels: { "school-office@example.test": "School office" },
    }),
  );
  expect(proposal).toMatchObject({
    operation: "schoolHours.save",
    state: "PENDING",
  });
  expect(proposal.targets).toHaveProperty(
    "schoolHoursSchedule.recipientLabels",
    {},
  );
  expect(
    await db.schoolHoursSchedule.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toEqual(before);
  await expect(
    caller("COORDINATOR").approval.decide({
      id: proposal.id,
      approve: true,
      note: "Self-review refused",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller("ADMIN").approval.decide({
    id: proposal.id,
    approve: true,
    note: "Reviewed external school audience and schedule",
  });
  expect(
    await db.schoolHoursSchedule.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toMatchObject({
    version: 1,
    recipientEmails: ["school-office@example.test"],
    recipientLabels: { "school-office@example.test": "School office" },
  });
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } }))
      .state,
  ).toBe("APPROVED");
});
it("preserves pre-label proposal evidence and retains existing labels when replaying an older payload", async () => {
  const recipientLabels = { "school-office@example.test": "School office" };
  await db.schoolHoursSchedule.update({
    where: { id: "program" },
    data: { recipientEmails: ["school-office@example.test"], recipientLabels },
  });
  // Old immutable payloads omit the label map; their captured record shape must
  // remain unchanged at replay rather than acquiring a new fingerprint field.
  const proposal = await queued(settings({ includeStatistics: true }));
  expect(proposal.targets).not.toHaveProperty(
    "schoolHoursSchedule.recipientLabels",
  );
  await caller("ADMIN").approval.decide({
    id: proposal.id,
    approve: true,
    note: "Reviewed the unchanged recipient audience from the older client",
  });
  expect(
    await db.schoolHoursSchedule.findUniqueOrThrow({
      where: { id: "program" },
    }),
  ).toMatchObject({ version: 1, includeStatistics: true, recipientLabels });
});
it.each(["configuration", "opening baseline", "recipient labels"] as const)(
  "refuses stale approval replay after %s changes",
  async (change) => {
    const proposal = await queued();
    if (change === "configuration")
      await caller().schoolHours.save(settings({ includeStatistics: true }));
    else if (change === "recipient labels")
      await caller().schoolHours.save(
        settings({
          recipientLabels: {
            "school-office@example.test": "Updated school office",
          },
        }),
      );
    else await caller().schoolHours.reviewBaseline(await baselineInput());
    const applied = await db.schoolHoursSchedule.findUniqueOrThrow({
      where: { id: "program" },
    });
    await expect(
      caller("ADMIN").approval.decide({
        id: proposal.id,
        approve: true,
        note: "Stale review must reload",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      }),
    ).toEqual(applied);
    expect(
      (
        await db.approvalRequest.findUniqueOrThrow({
          where: { id: proposal.id },
        })
      ).state,
    ).toBe("PENDING");
  },
);
it("does not turn Coordinator baseline, generation, retries or link management into approval bypasses", async () => {
  const api = caller("COORDINATOR").schoolHours;
  const opening = await baselineInput();
  for (const mutation of [
    () => api.reviewBaseline(opening),
    () => api.generate(generationInput()),
    () => api.retry({ id: reportId }),
    () => api.revokeLink({ id: reportId, expectedLinkVersion: 1 }),
    () => api.reissueLink({ id: reportId, expectedLinkVersion: 1 }),
  ])
    await expect(mutation()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await db.approvalRequest.count({
      where: { requesterId: id("COORDINATOR") },
    }),
  ).toBe(0);
  expect(
    await db.schoolHoursReport.count({
      where: { generatedById: id("COORDINATOR") },
    }),
  ).toBe(0);
});
it("refuses replay authority for a forged historical generation proposal", async () => {
  const proposal = await db.approvalRequest.create({
    data: {
      requesterId: id("COORDINATOR"),
      requesterName: "Synthetic Coordinator",
      operation: "schoolHours.generate",
      payload: superjson.serialize(
        generationInput(),
      ) as unknown as Prisma.InputJsonObject,
      targets: {},
      fingerprint: "d".repeat(64),
    },
  });
  const failure: unknown = await caller("ADMIN")
    .approval.decide({
      id: proposal.id,
      approve: true,
      note: "Unsupported operation must not replay",
    })
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(TRPCError);
  expect(failure instanceof TRPCError ? failure.code : null).toMatch(
    /FORBIDDEN|BAD_REQUEST|PRECONDITION_FAILED/,
  );
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } }))
      .state,
  ).toBe("PENDING");
});
it("preserves saved staff evidence when feature off, blocks preview and enabling, but allows disabling", async () => {
  await db.programFeature.update({
    where: { key: "SERVICE_HOURS" },
    data: { enabled: false },
  });
  expect(
    (await caller("COORDINATOR").schoolHours.settings()).serviceHoursEnabled,
  ).toBe(false);
  expect(
    (await caller("COORDINATOR").schoolHours.report({ id: reportId })).id,
  ).toBe(reportId);
  expect(
    (await caller("COORDINATOR").schoolHours.csv({ id: reportId })).content,
  ).toContain("Alexander");
  await expect(
    caller().schoolHours.preview({ month: "2011-10" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller().schoolHours.save(settings({ enabled: true })),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await caller().schoolHours.save(settings({ enabled: false }))).config
      .enabled,
  ).toBe(false);
});
it("rechecks current database authority despite an old staff session", async () => {
  const stale = caller("ADMIN");
  await db.user.update({
    where: { id: id("ADMIN") },
    data: { role: "VIEWER" },
  });
  await expect(
    stale.schoolHours.report({ id: reportId }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(stale.schoolHours.save(settings())).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

it.each(["2026-10-29T12:00", "2026-11-31T12:00"])(
  "refuses an impossible November override %s as a validation error with no write",
  async (date) => {
    const before = await db.schoolHoursSchedule.findUniqueOrThrow({
      where: { id: "program" },
    });
    await expect(
      caller().schoolHours.save(
        settings({ dateOverrides: { "2026-11": date } }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await db.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      }),
    ).toEqual(before);
  },
);
