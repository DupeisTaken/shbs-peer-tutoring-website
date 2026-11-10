import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type {
  ProgramSettings,
  SchoolHoursSchedule,
} from "../../generated/prisma";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  cancelSchoolHoursRecipientReminder,
  getSchoolHoursRecipientState,
  scheduleSchoolHoursRecipientReminder,
} from "./school-hours-recipient";
import {
  admitSchoolHoursDelivery,
  finishSchoolHoursDelivery,
} from "./school-hours-delivery";
import {
  issueSchoolHoursToken,
  schoolHoursTokenHash,
} from "./school-hours-link";
import { issueSchoolHoursRecipientToken } from "./school-hours-recipient-token";
import { schoolHoursTestSnapshot } from "./school-hours-test-fixture";
import { changeSchoolHoursLink } from "./school-hours";

vi.mock("~/server/email/sender", () => ({
  isEmailDeliveryAvailable: () => true,
}));

assertIsolatedTestDatabase(process.env.DATABASE_URL);

const prefix = "school-recipient-reminder-test-";
const reportId = `${prefix}report`;
const firstId = `${prefix}first-delivery`;
const secondId = `${prefix}second-delivery`;
const firstMailbox = "synthetic-first-office@example.test";
const secondMailbox = "synthetic-second-office@example.test";
const secret = "synthetic-recipient-reminder-secret";
let savedSchedule: Pick<
  SchoolHoursSchedule,
  "enabled" | "recipientEmails"
> | null;
let savedSettings: Pick<ProgramSettings, "emailNotificationsEnabled"> | null;
let savedFeature: { enabled: boolean; pendingEnabled: boolean | null } | null;

function personalToken(id = firstId, mailbox = firstMailbox, version = 1) {
  return issueSchoolHoursRecipientToken(
    { id, recipient: mailbox, schoolHoursReportId: reportId },
    version,
  );
}

function input(localTime = "2099-11-12T09:30") {
  return { requestId: randomUUID(), localTime };
}

async function reminderRows(sourceId = firstId) {
  return db.emailDelivery.findMany({
    where: { schoolHoursReminderSourceId: sourceId },
    orderBy: { id: "asc" },
  });
}

async function cleanup() {
  // Child reminders reference original receipts. Delete only this fixture's
  // children first; unrelated outbox rows and financial chains are untouched.
  await db.emailDelivery.deleteMany({
    where: {
      schoolHoursReportId: reportId,
      schoolHoursReminderSourceId: { not: null },
    },
  });
  await db.emailDelivery.deleteMany({
    where: { schoolHoursReportId: reportId },
  });
  await db.schoolHoursReport.deleteMany({ where: { id: reportId } });
}

beforeAll(async () => {
  savedSchedule = await db.schoolHoursSchedule.findUnique({
    where: { id: "program" },
    select: { enabled: true, recipientEmails: true },
  });
  savedSettings = await db.programSettings.findUnique({
    where: { id: "program" },
    select: { emailNotificationsEnabled: true },
  });
  savedFeature = await db.programFeature.findUnique({
    where: { key: "SERVICE_HOURS" },
    select: { enabled: true, pendingEnabled: true },
  });
});

beforeEach(async () => {
  vi.stubEnv("AUTH_SECRET", secret);
  vi.stubEnv("AUTH_URL", "https://reports.example.test");
  await cleanup();
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
      enabled: false,
      recipientEmails: [firstMailbox, secondMailbox],
    },
    update: { enabled: false, recipientEmails: [firstMailbox, secondMailbox] },
  });
  const snapshot = { ...schoolHoursTestSnapshot(), month: "1987-02" };
  await db.schoolHoursReport.create({
    data: {
      id: reportId,
      scheduleId: "program",
      month: snapshot.month,
      revision: 1,
      configVersion: 1,
      baselineVersion: 1,
      timeZone: snapshot.timeZone,
      snapshot,
      sourceBaseline: { privateSource: "synthetic-unpublished-accounting" },
      intendedRecipients: [firstMailbox, secondMailbox],
      contentHash: "synthetic-recipient-report-content",
      generationKey: `${prefix}issue`,
      generationHash: "synthetic-recipient-report-intent",
      linkTokenHash: schoolHoursTokenHash(issueSchoolHoursToken(reportId, 1)),
    },
  });
  await db.emailDelivery.createMany({
    data: [
      { id: firstId, recipient: firstMailbox },
      { id: secondId, recipient: secondMailbox },
    ].map((row) => ({
      ...row,
      category: "school_hours",
      event: "school_hours_report",
      schoolHoursReportId: reportId,
      status: "SENT",
      attempts: 1,
      completedAt: new Date("2026-10-31T04:00:00Z"),
    })),
  });
});

afterAll(async () => {
  await cleanup();
  if (savedSchedule) {
    await db.schoolHoursSchedule.update({
      where: { id: "program" },
      data: savedSchedule,
    });
  } else await db.schoolHoursSchedule.deleteMany({ where: { id: "program" } });
  if (savedSettings) {
    await db.programSettings.update({
      where: { id: "program" },
      data: savedSettings,
    });
  } else await db.programSettings.deleteMany({ where: { id: "program" } });
  if (savedFeature) {
    await db.programFeature.update({
      where: { key: "SERVICE_HOURS" },
      data: savedFeature,
    });
  } else
    await db.programFeature.deleteMany({ where: { key: "SERVICE_HOURS" } });
  vi.unstubAllEnvs();
});

it("creates a timezone-bound own-mailbox reminder without a site actor or automatic schedule", async () => {
  const before = await db.schoolHoursReport.findUniqueOrThrow({
    where: { id: reportId },
  });
  const originals = await db.emailDelivery.findMany({
    where: { schoolHoursReportId: reportId },
    orderBy: { id: "asc" },
  });
  const result = await scheduleSchoolHoursRecipientReminder(
    db,
    personalToken(),
    input(),
  );
  expect(result.scheduledFor.toISOString()).toBe("2099-11-12T01:30:00.000Z");
  const rows = await reminderRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: result.id,
    userId: null,
    category: "school_hours",
    event: "school_hours_reminder",
    recipient: firstMailbox,
    schoolHoursReportId: reportId,
    schoolHoursReminderSourceId: firstId,
    schoolHoursReminderLinkVersion: 1,
    availableAt: result.scheduledFor,
    status: "PENDING",
    attempts: 0,
    context: null,
  });
  expect(
    await db.emailDelivery.findMany({
      where: { id: { in: [firstId, secondId] } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(originals);
  expect(
    await db.schoolHoursReport.findUniqueOrThrow({ where: { id: reportId } }),
  ).toEqual(before);
  expect(
    (
      await db.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      })
    ).enabled,
  ).toBe(false);
});

it("deduplicates concurrent exact retries and recovers an accepted request after its selected time", async () => {
  const request = input();
  const token = personalToken();
  const results = await Promise.all([
    scheduleSchoolHoursRecipientReminder(db, token, request),
    scheduleSchoolHoursRecipientReminder(db, token, request),
    scheduleSchoolHoursRecipientReminder(db, token, request),
  ]);
  expect(results[1]).toEqual(results[0]);
  expect(results[2]).toEqual(results[0]);
  expect(await reminderRows()).toHaveLength(1);
  expect(
    await scheduleSchoolHoursRecipientReminder(
      db,
      token,
      request,
      new Date("2100-01-01"),
    ),
  ).toEqual(results[0]);
  await expect(
    scheduleSchoolHoursRecipientReminder(db, token, {
      ...request,
      localTime: "2099-11-13T09:30",
    }),
  ).rejects.toMatchObject({ code: "unavailable" });
  expect(await reminderRows()).toHaveLength(1);
});

it.each(["2000-01-01T09:30", "2099-02-30T09:30"])(
  "rejects invalid or past time %s without adding a delivery",
  async (localTime) => {
    await expect(
      scheduleSchoolHoursRecipientReminder(
        db,
        personalToken(),
        input(localTime),
      ),
    ).rejects.toMatchObject({ code: "invalidTime" });
    expect(await reminderRows()).toEqual([]);
  },
);

it("rejects a destination override before staging any reminder", async () => {
  const request = { ...input(), recipient: secondMailbox };
  await expect(
    scheduleSchoolHoursRecipientReminder(db, personalToken(), request),
  ).rejects.toMatchObject({ name: "ZodError" });
  expect(await reminderRows()).toEqual([]);
  expect(await reminderRows(secondId)).toEqual([]);
});

it.each(["2099-03-08T02:30", "2099-11-01T01:30"])(
  "rejects nonexistent or repeated New York wall time %s",
  async (localTime) => {
    await db.schoolHoursReport.update({
      where: { id: reportId },
      data: { timeZone: "America/New_York" },
    });
    await expect(
      scheduleSchoolHoursRecipientReminder(
        db,
        personalToken(),
        input(localTime),
      ),
    ).rejects.toMatchObject({ code: "invalidTime" });
    expect(await reminderRows()).toEqual([]);
  },
);

it("allows only one unfinished reminder per original receipt while keeping recipients independent", async () => {
  await scheduleSchoolHoursRecipientReminder(db, personalToken(), input());
  await expect(
    scheduleSchoolHoursRecipientReminder(db, personalToken(), input()),
  ).rejects.toMatchObject({ code: "alreadyScheduled" });
  const other = await scheduleSchoolHoursRecipientReminder(
    db,
    personalToken(secondId, secondMailbox),
    input(),
  );
  expect((await reminderRows(secondId)).map((row) => row.id)).toEqual([
    other.id,
  ]);
  expect((await reminderRows(secondId))[0]!.recipient).toBe(secondMailbox);
});

it("counts cancelled reminders toward a durable daily limit", async () => {
  const token = personalToken();
  for (let attempt = 0; attempt < 5; attempt++) {
    const reminder = await scheduleSchoolHoursRecipientReminder(
      db,
      token,
      input(),
    );
    expect(
      await cancelSchoolHoursRecipientReminder(db, token, reminder.id),
    ).toEqual({ count: 1 });
  }
  expect(await reminderRows()).toHaveLength(5);
  await expect(
    scheduleSchoolHoursRecipientReminder(db, token, input()),
  ).rejects.toMatchObject({ code: "limit" });
  expect(
    (await reminderRows()).every((row) => row.status === "CANCELLED"),
  ).toBe(true);
});

it("a reminder's own emailed link retains the original mailbox and daily-limit owner", async () => {
  const first = await scheduleSchoolHoursRecipientReminder(
    db,
    personalToken(),
    input(),
  );
  const delivered = await db.emailDelivery.update({
    where: { id: first.id },
    data: { status: "SENT", completedAt: new Date() },
  });
  const token = personalToken(delivered.id);
  const next = await scheduleSchoolHoursRecipientReminder(db, token, input());
  const nextRow = await db.emailDelivery.findUniqueOrThrow({
    where: { id: next.id },
  });
  expect(nextRow.schoolHoursReminderSourceId).toBe(firstId);
  expect(nextRow.recipient).toBe(firstMailbox);
  expect(
    (await getSchoolHoursRecipientState(db, token)).reminders,
  ).toHaveLength(2);
});

it("cancellation cannot target another recipient or the original email", async () => {
  const first = await scheduleSchoolHoursRecipientReminder(
    db,
    personalToken(),
    input(),
  );
  await expect(
    cancelSchoolHoursRecipientReminder(
      db,
      personalToken(secondId, secondMailbox),
      first.id,
    ),
  ).rejects.toMatchObject({ code: "unavailable" });
  await expect(
    cancelSchoolHoursRecipientReminder(db, personalToken(), firstId),
  ).rejects.toMatchObject({ code: "unavailable" });
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: first.id } }))
      .status,
  ).toBe("PENDING");
  expect(
    await cancelSchoolHoursRecipientReminder(db, personalToken(), first.id),
  ).toEqual({ count: 1 });
  expect(
    await cancelSchoolHoursRecipientReminder(db, personalToken(), first.id),
  ).toEqual({ count: 0 });
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: firstId } }))
      .status,
  ).toBe("SENT");
});

it("records one first-link-request timestamp without exposing another mailbox or accounting source", async () => {
  const token = personalToken();
  const initial = await getSchoolHoursRecipientState(db, token);
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: firstId } }))
      .schoolHoursLinkOpenedAt,
  ).toBeNull();
  expect(initial.mailbox).not.toBe(firstMailbox);
  expect(JSON.stringify(initial)).not.toContain(secondMailbox);
  expect(JSON.stringify(initial)).not.toContain(
    "synthetic-unpublished-accounting",
  );
  await getSchoolHoursRecipientState(db, token, true);
  const firstOpen = (
    await db.emailDelivery.findUniqueOrThrow({ where: { id: firstId } })
  ).schoolHoursLinkOpenedAt;
  expect(firstOpen).toBeInstanceOf(Date);
  await getSchoolHoursRecipientState(db, token, true);
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: firstId } }))
      .schoolHoursLinkOpenedAt,
  ).toEqual(firstOpen);
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: secondId } }))
      .schoolHoursLinkOpenedAt,
  ).toBeNull();
  expect(await reminderRows()).toEqual([]);
});

it("shared report links and altered personal identities cannot schedule or record opens", async () => {
  const shared = issueSchoolHoursToken(reportId, 1);
  await expect(
    getSchoolHoursRecipientState(db, shared, true),
  ).rejects.toMatchObject({ code: "unavailable" });
  await expect(
    scheduleSchoolHoursRecipientReminder(db, shared, input()),
  ).rejects.toMatchObject({ code: "unavailable" });
  const substituted = personalToken().replace(firstId, secondId);
  await expect(
    getSchoolHoursRecipientState(db, substituted, true),
  ).rejects.toMatchObject({ code: "unavailable" });
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: firstId } }))
      .schoolHoursLinkOpenedAt,
  ).toBeNull();
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: secondId } }))
      .schoolHoursLinkOpenedAt,
  ).toBeNull();
  expect(await reminderRows()).toEqual([]);
});

it("removing the mailbox disables reminders while preserving the report read", async () => {
  const token = personalToken();
  await db.schoolHoursSchedule.update({
    where: { id: "program" },
    data: { recipientEmails: [secondMailbox] },
  });
  expect((await getSchoolHoursRecipientState(db, token)).eligible).toBe(false);
  await expect(
    scheduleSchoolHoursRecipientReminder(db, token, input()),
  ).rejects.toMatchObject({ code: "recipientRemoved" });
  expect(await reminderRows()).toEqual([]);
});

it.each(["revoked", "superseded", "reissued", "secret-rotated"])(
  "rejects a %s personal link before recovering or cancelling a reminder",
  async (state) => {
    const token = personalToken();
    const request = input();
    const reminder = await scheduleSchoolHoursRecipientReminder(
      db,
      token,
      request,
    );
    if (state === "revoked")
      await db.schoolHoursReport.update({
        where: { id: reportId },
        data: { linkRevokedAt: new Date() },
      });
    if (state === "superseded")
      await db.schoolHoursReport.update({
        where: { id: reportId },
        data: { supersededById: `${prefix}replacement` },
      });
    if (state === "reissued")
      await db.schoolHoursReport.update({
        where: { id: reportId },
        data: {
          linkVersion: 2,
          linkTokenHash: schoolHoursTokenHash(
            issueSchoolHoursToken(reportId, 2),
          ),
        },
      });
    if (state === "secret-rotated")
      vi.stubEnv("AUTH_SECRET", "synthetic-rotated-recipient-secret");
    const code = ["revoked", "superseded"].includes(state)
      ? "retired"
      : "unavailable";
    await expect(getSchoolHoursRecipientState(db, token)).rejects.toMatchObject(
      { code },
    );
    await expect(
      scheduleSchoolHoursRecipientReminder(db, token, request),
    ).rejects.toMatchObject({ code });
    await expect(
      cancelSchoolHoursRecipientReminder(db, token, reminder.id),
    ).rejects.toMatchObject({ code });
    expect(
      (await db.emailDelivery.findUniqueOrThrow({ where: { id: reminder.id } }))
        .status,
    ).toBe("PENDING");
  },
);

async function claim(id: string) {
  const row = await db.emailDelivery.findUniqueOrThrow({ where: { id } });
  const leaseUntil = new Date(Date.now() + 300_000);
  await db.emailDelivery.update({ where: { id }, data: { leaseUntil } });
  return admitSchoolHoursDelivery(db, id, leaseUntil, row.attemptId);
}

it("never admits a future reminder even when its mutable retry time is accidentally early", async () => {
  const reminder = await scheduleSchoolHoursRecipientReminder(
    db,
    personalToken(),
    input(),
  );
  await db.emailDelivery.update({
    where: { id: reminder.id },
    data: { availableAt: new Date(0) },
  });
  expect(await claim(reminder.id)).toBeNull();
  const row = await db.emailDelivery.findUniqueOrThrow({
    where: { id: reminder.id },
  });
  expect(row.status).toBe("PENDING");
  expect(row.attempts).toBe(0);
  expect(row.schoolHoursScheduledFor).toEqual(reminder.scheduledFor);
});

it("a due personal reminder can send with automatic issuance off, and an admitted send cannot be cancelled", async () => {
  const reminder = await scheduleSchoolHoursRecipientReminder(
    db,
    personalToken(),
    input("2001-02-03T09:30"),
    new Date("2001-02-02T00:00:00Z"),
  );
  const admitted = await claim(reminder.id);
  expect(admitted?.row.status).toBe("SENDING");
  expect(
    (
      await db.schoolHoursSchedule.findUniqueOrThrow({
        where: { id: "program" },
      })
    ).enabled,
  ).toBe(false);
  await expect(
    cancelSchoolHoursRecipientReminder(db, personalToken(), reminder.id),
  ).rejects.toMatchObject({ code: "sending" });
  expect(admitted?.row.attemptId).toBeTruthy();
  await finishSchoolHoursDelivery(
    db,
    reminder.id,
    admitted!.row.attemptId!,
    false,
  );
  const row = await db.emailDelivery.findUniqueOrThrow({
    where: { id: reminder.id },
  });
  expect(row.status).toBe("PENDING");
  expect(row.attempts).toBe(1);
  expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
  expect(row.schoolHoursScheduledFor).toEqual(reminder.scheduledFor);
  expect(
    (await db.emailDelivery.findUniqueOrThrow({ where: { id: firstId } }))
      .status,
  ).toBe("SENT");
});

it("does not send a reminder after its report link version changes", async () => {
  const reminder = await scheduleSchoolHoursRecipientReminder(
    db,
    personalToken(),
    input("2001-02-03T09:30"),
    new Date("2001-02-02T00:00:00Z"),
  );
  await db.schoolHoursReport.update({
    where: { id: reportId },
    data: {
      linkVersion: 2,
      linkTokenHash: schoolHoursTokenHash(issueSchoolHoursToken(reportId, 2)),
    },
  });
  expect(await claim(reminder.id)).toBeNull();
  expect(
    await db.emailDelivery.findUniqueOrThrow({ where: { id: reminder.id } }),
  ).toMatchObject({
    status: "SKIPPED",
    lastError: "LINK_CHANGED",
    attempts: 0,
  });
});

it.each([
  ["mail-off", "BLOCKED", "EMAIL_OFF"],
  ["feature-off", "BLOCKED", "FEATURE_OFF"],
  ["recipient-removed", "SKIPPED", "RECIPIENT_REMOVED"],
] as const)(
  "rechecks %s when admitting a due reminder",
  async (setting, status, reason) => {
    const reminder = await scheduleSchoolHoursRecipientReminder(
      db,
      personalToken(),
      input("2001-02-03T09:30"),
      new Date("2001-02-02T00:00:00Z"),
    );
    if (setting === "mail-off")
      await db.programSettings.update({
        where: { id: "program" },
        data: { emailNotificationsEnabled: false },
      });
    if (setting === "feature-off")
      await db.programFeature.update({
        where: { key: "SERVICE_HOURS" },
        data: { enabled: false },
      });
    if (setting === "recipient-removed")
      await db.schoolHoursSchedule.update({
        where: { id: "program" },
        data: { recipientEmails: [secondMailbox] },
      });
    expect(await claim(reminder.id)).toBeNull();
    expect(
      await db.emailDelivery.findUniqueOrThrow({ where: { id: reminder.id } }),
    ).toMatchObject({ status, lastError: reason, attempts: 0 });
  },
);

async function withLinkAdmin(work: (actorId: string) => Promise<void>) {
  const actorId = `${prefix}link-admin`;
  try {
    await db.user.create({
      data: {
        id: actorId,
        email: `${actorId}@example.test`,
        name: "Synthetic report link administrator",
        role: "ADMIN",
      },
    });
    await work(actorId);
  } finally {
    await db.auditLog.deleteMany({ where: { userId: actorId } });
    await db.user.deleteMany({ where: { id: actorId } });
  }
}

const financialEvidence = {
  snapshot: true,
  sourceBaseline: true,
  contentHash: true,
  predecessorId: true,
  supersedesId: true,
  month: true,
  revision: true,
} as const;

it("reissuing the real report link settles obsolete reminders and immediately permits a new personal reminder", async () => {
  await withLinkAdmin(async (actorId) => {
    const oldToken = personalToken();
    const reminder = await scheduleSchoolHoursRecipientReminder(
      db,
      oldToken,
      input(),
    );
    const before = await db.schoolHoursReport.findUniqueOrThrow({
      where: { id: reportId },
      select: financialEvidence,
    });
    const originals = await db.emailDelivery.findMany({
      where: { id: { in: [firstId, secondId] } },
      orderBy: { id: "asc" },
    });

    expect(
      await changeSchoolHoursLink(db, reportId, actorId, true, 1),
    ).toMatchObject({ linkVersion: 2 });
    await expect(
      getSchoolHoursRecipientState(db, oldToken),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(
      await db.emailDelivery.findUniqueOrThrow({
        where: { id: reminder.id },
      }),
    ).toMatchObject({
      status: "SKIPPED",
      lastError: "LINK_CHANGED",
      attempts: 0,
      leaseUntil: null,
    });

    const freshToken = personalToken(firstId, firstMailbox, 2);
    const replacement = await scheduleSchoolHoursRecipientReminder(
      db,
      freshToken,
      input(),
    );
    expect(replacement.id).not.toBe(reminder.id);
    expect(
      await db.emailDelivery.findUniqueOrThrow({
        where: { id: replacement.id },
      }),
    ).toMatchObject({
      status: "PENDING",
      recipient: firstMailbox,
      schoolHoursReminderSourceId: firstId,
      schoolHoursReminderLinkVersion: 2,
    });
    expect(
      await db.emailDelivery.findMany({
        where: { id: { in: [firstId, secondId] } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(originals);
    expect(
      await db.schoolHoursReport.findUniqueOrThrow({
        where: { id: reportId },
        select: financialEvidence,
      }),
    ).toEqual(before);
  });
});

it("revoking the real report link settles pending reminders without interrupting an admitted send or changing financial evidence", async () => {
  await withLinkAdmin(async (actorId) => {
    const oldToken = personalToken();
    const reminder = await scheduleSchoolHoursRecipientReminder(
      db,
      oldToken,
      input(),
    );
    const sending = await scheduleSchoolHoursRecipientReminder(
      db,
      personalToken(secondId, secondMailbox),
      input("2001-02-03T09:30"),
      new Date("2001-02-02T00:00:00Z"),
    );
    expect((await claim(sending.id))?.row.status).toBe("SENDING");
    const admitted = await db.emailDelivery.findUniqueOrThrow({
      where: { id: sending.id },
    });
    const before = await db.schoolHoursReport.findUniqueOrThrow({
      where: { id: reportId },
      select: financialEvidence,
    });
    const originals = await db.emailDelivery.findMany({
      where: { id: { in: [firstId, secondId] } },
      orderBy: { id: "asc" },
    });

    expect(
      await changeSchoolHoursLink(db, reportId, actorId, false, 1),
    ).toEqual({ revoked: true });
    await expect(
      getSchoolHoursRecipientState(db, oldToken),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      getSchoolHoursRecipientState(db, personalToken(firstId, firstMailbox, 2)),
    ).rejects.toMatchObject({ code: "retired" });
    expect(
      await db.emailDelivery.findUniqueOrThrow({
        where: { id: reminder.id },
      }),
    ).toMatchObject({
      status: "SKIPPED",
      lastError: "LINK_REVOKED",
      attempts: 0,
      leaseUntil: null,
    });
    expect(
      await db.emailDelivery.findUniqueOrThrow({
        where: { id: sending.id },
      }),
    ).toEqual(admitted);
    expect(
      await db.emailDelivery.findMany({
        where: { id: { in: [firstId, secondId] } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(originals);
    expect(
      await db.schoolHoursReport.findUniqueOrThrow({
        where: { id: reportId },
        select: financialEvidence,
      }),
    ).toEqual(before);
  });
});
