import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "../root";
import { ApprovalQueued } from "~/server/approvals";
import {
  processDueScheduledRefreshes,
  processScheduledRefresh,
  readPublicRefreshSchedule,
} from "~/server/program/scheduled-refresh";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import * as refreshDomain from "~/server/program/refresh";

const source = "scheduled-refresh-source";
const roles = ["HEAD", "ADMIN", "COORDINATOR", "VIEWER"] as const;
type Role = (typeof roles)[number];
const caller = (role: Role) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: `scheduled-refresh-${role}`, name: role },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });
const future = () => new Date(Date.now() + 3_600_000);

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error(
      "Scheduled refresh tests require serial isolated shbs_shipping_test",
    );
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.createMany({
    data: roles.map((role) => ({
      id: `scheduled-refresh-${role}`,
      role,
      email: `${role}@example.test`,
      name: role,
    })),
  });
  await db.term.create({
    data: {
      id: source,
      name: "Scheduled refresh Q1",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
});
afterAll(() => db.$disconnect());
afterEach(() => vi.restoreAllMocks());

async function input(expectedScheduleVersion = 0) {
  const snapshot = await caller("HEAD").program.nextRecruitment();
  return {
    confirm: "REFRESH",
    expectedTermId: source,
    expectedPreparation: snapshot.refreshEvidence,
    executeAt: future(),
    expectedScheduleVersion,
  };
}
async function due(id: string) {
  await db.$executeRaw`UPDATE "ScheduledProgramRefresh" SET "executeAt" = clock_timestamp() - INTERVAL '1 second' WHERE "id" = ${id}`;
}
async function queued(role: Role, value: Awaited<ReturnType<typeof input>>) {
  const result: unknown = await caller(role)
    .admin.scheduleRefresh(value)
    .catch((error: unknown) => error);
  expect((result as { cause?: unknown }).cause).toBeInstanceOf(ApprovalQueued);
  return (result as { cause: ApprovalQueued }).cause.approvalId;
}

it("persists approved scheduling without activating early and excludes private evidence from public metadata", async () => {
  const value = await input();
  const row = await caller("HEAD").admin.scheduleRefresh(value);
  expect(row.state).toBe("SCHEDULED");
  expect(await processScheduledRefresh(db, row.id)).toBeNull();
  expect(await db.term.count()).toBe(1);
  const metadata = await readPublicRefreshSchedule(db, source);
  expect(metadata).toMatchObject({
    state: "SCHEDULED",
    valid: true,
    destinationQuarter: "Q2",
    executeAt: value.executeAt,
  });
  expect(metadata).not.toHaveProperty("expectedPreparation");
  expect(metadata).not.toHaveProperty("authorizedById");
  expect((await caller("HEAD").admin.refreshSchedule()).schedule?.id).toBe(
    row.id,
  );
});

it("queues Admin requests without activation or public promises and requires Head approval", async () => {
  const requestId = await queued("ADMIN", await input());
  expect(await db.scheduledProgramRefresh.count()).toBe(0);
  expect(await readPublicRefreshSchedule(db, source)).toBeNull();
  await expect(
    caller("ADMIN").approval.decide({
      id: requestId,
      approve: true,
      note: "Cannot approve own schedule",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller("HEAD").approval.decide({
    id: requestId,
    approve: true,
    note: "Approve the reviewed future rollover",
  });
  const row = await db.scheduledProgramRefresh.findUniqueOrThrow({
    where: { sourceTermId: source },
  });
  expect(row.authorizedById).toBe("scheduled-refresh-HEAD");
  expect(row.state).toBe("SCHEDULED");
  expect(await db.term.count()).toBe(1);
});

it.each(["COORDINATOR", "VIEWER"] as const)(
  "rejects %s scheduling and cancellation",
  async (role) => {
    const value = await input();
    await expect(
      caller(role).admin.scheduleRefresh(value),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const row = await caller("HEAD").admin.scheduleRefresh(value);
    await expect(
      caller(role).admin.cancelRefresh({
        id: row.id,
        expectedVersion: row.version,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);

it("rejects elapsed scheduling and refresh later than an announced future opening", async () => {
  const value = await input();
  await expect(
    caller("HEAD").admin.scheduleRefresh({ ...value, executeAt: new Date(0) }),
  ).rejects.toThrow("SCHEDULED_REFRESH_TIME_INVALID");
  const snapshot = await caller("HEAD").program.nextRecruitment();
  const opensAt = new Date(Date.now() + 1_800_000);
  await caller("HEAD").program.prepareNextRecruitment({
    audience: "tutee",
    expectedTarget: snapshot.target,
    expectedTimeZone: snapshot.timeZone,
    expectedVersion: 0,
    opensAt,
  });
  await expect(
    caller("HEAD").admin.scheduleRefresh(await input()),
  ).rejects.toThrow("SCHEDULED_REFRESH_AFTER_OPENING");
  expect(await db.scheduledProgramRefresh.count()).toBe(0);
});

it("catches up once after downtime across competing workers and retains its completion receipt", async () => {
  const row = await caller("HEAD").admin.scheduleRefresh(await input());
  await due(row.id);
  await Promise.all([
    processDueScheduledRefreshes(db),
    processDueScheduledRefreshes(db),
  ]);
  await processDueScheduledRefreshes(db);
  expect(
    (await db.term.findFirstOrThrow({ where: { active: true } })).quarter,
  ).toBe("Q2");
  expect(await db.term.count()).toBe(2);
  expect(
    await db.auditLog.count({
      where: { operation: "program.scheduledRefreshCompleted" },
    }),
  ).toBe(1);
  expect(
    await db.notification.count({
      where: { title: "Scheduled program refresh completed" },
    }),
  ).toBe(2);
  expect(
    (await caller("HEAD").admin.refreshSchedule({ id: row.id })).schedule,
  ).toMatchObject({ state: "COMPLETED", version: row.version + 1 });
  expect((await caller("HEAD").admin.refreshSchedule()).schedule).toBeNull();
});

it("versions reschedule and cancellation, rejecting a stale edit and keeping cancelled work inert", async () => {
  const first = await caller("HEAD").admin.scheduleRefresh(await input());
  const second = await caller("HEAD").admin.scheduleRefresh(
    await input(first.version),
  );
  expect(second.version).toBe(first.version + 1);
  await expect(
    caller("HEAD").admin.cancelRefresh({
      id: first.id,
      expectedVersion: first.version,
    }),
  ).rejects.toThrow("SCHEDULED_REFRESH_CHANGED");
  const cancelled = await caller("HEAD").admin.cancelRefresh({
    id: second.id,
    expectedVersion: second.version,
  });
  expect(cancelled.state).toBe("CANCELLED");
  await due(first.id);
  expect(await processScheduledRefresh(db, first.id)).toBeNull();
  expect(await db.term.count()).toBe(1);
});

it("an Admin cancellation remains a proposal until Head reviews its exact schedule version", async () => {
  const row = await caller("HEAD").admin.scheduleRefresh(await input());
  const result: unknown = await caller("ADMIN")
    .admin.cancelRefresh({ id: row.id, expectedVersion: row.version })
    .catch((error: unknown) => error);
  expect((result as { cause?: unknown }).cause).toBeInstanceOf(ApprovalQueued);
  expect(
    (
      await db.scheduledProgramRefresh.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).state,
  ).toBe("SCHEDULED");
  const id = (result as { cause: ApprovalQueued }).cause.approvalId;
  await caller("HEAD").approval.decide({
    id,
    approve: true,
    note: "Cancel the reviewed scheduled activation",
  });
  expect(
    (
      await db.scheduledProgramRefresh.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).state,
  ).toBe("CANCELLED");
});

it("blocks changed feature evidence before due time and emits only one terminal notice when due", async () => {
  const row = await caller("HEAD").admin.scheduleRefresh(await input());
  await caller("ADMIN").program.setFeaturePending({
    key: "QUARTER_SYSTEM",
    enabled: false,
  });
  await caller("ADMIN").program.setFeaturePending({
    key: "QUARTER_SYSTEM",
    enabled: true,
  });
  expect(await readPublicRefreshSchedule(db, source)).toMatchObject({
    state: "BLOCKED",
    valid: false,
  });
  expect(
    (
      await db.scheduledProgramRefresh.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).state,
  ).toBe("SCHEDULED");
  await due(row.id);
  expect(await processScheduledRefresh(db, row.id)).toMatchObject({
    state: "BLOCKED",
  });
  expect(await processScheduledRefresh(db, row.id)).toBeNull();
  expect(
    await db.auditLog.count({
      where: { operation: "program.scheduledRefreshBlocked" },
    }),
  ).toBe(1);
  expect(await db.term.count()).toBe(1);
});

it("blocks execution when the approving Head is no longer authorized", async () => {
  const row = await caller("HEAD").admin.scheduleRefresh(await input());
  await db.user.update({
    where: { id: "scheduled-refresh-HEAD" },
    data: { role: "ADMIN" },
  });
  await due(row.id);
  expect(await processScheduledRefresh(db, row.id)).toMatchObject({
    state: "BLOCKED",
    blockedReason: "SCHEDULED_REFRESH_HEAD_CHANGED",
  });
  expect(await db.term.count()).toBe(1);
});

it.each(["role", "suspension"])(
  "an authority %s change away and back cannot restore the old authorization",
  async (change) => {
    const row = await caller("HEAD").admin.scheduleRefresh(await input());
    const where = { id: "scheduled-refresh-HEAD" };
    if (change === "role") {
      await db.user.update({ where, data: { role: "ADMIN" } });
      await db.user.update({ where, data: { role: "HEAD" } });
    } else {
      await db.user.update({ where, data: { suspendedAt: new Date() } });
      await db.user.update({ where, data: { suspendedAt: null } });
    }
    expect(
      (await db.user.findUniqueOrThrow({ where })).refreshAuthorityRevision,
    ).toBe(2);
    expect(await readPublicRefreshSchedule(db, source)).toMatchObject({
      state: "BLOCKED",
      valid: false,
    });
    await due(row.id);
    expect(await processScheduledRefresh(db, row.id)).toMatchObject({
      state: "BLOCKED",
      blockedReason: "SCHEDULED_REFRESH_HEAD_CHANGED",
    });
  },
);

it("permanent login retirement blocks authorization and cannot be reversed to revive it", async () => {
  const row = await caller("HEAD").admin.scheduleRefresh(await input());
  const where = { id: "scheduled-refresh-HEAD" };
  await db.user.update({
    where,
    data: { mergedIntoId: "scheduled-refresh-ADMIN" },
  });
  await expect(
    db.user.update({ where, data: { mergedIntoId: null } }),
  ).rejects.toThrow("Retired login cannot be restored or reassigned");
  expect(
    (await db.user.findUniqueOrThrow({ where })).refreshAuthorityRevision,
  ).toBe(1);
  expect(await readPublicRefreshSchedule(db, source)).toMatchObject({
    state: "BLOCKED",
    valid: false,
  });
  await due(row.id);
  expect(await processScheduledRefresh(db, row.id)).toMatchObject({
    state: "BLOCKED",
    blockedReason: "SCHEDULED_REFRESH_HEAD_CHANGED",
  });
});

it("ordinary profile writes and identical authority values preserve the approved schedule", async () => {
  const row = await caller("HEAD").admin.scheduleRefresh(await input());
  await db.user.update({
    where: { id: "scheduled-refresh-HEAD" },
    data: {
      name: "Synthetic renamed Head",
      role: "HEAD",
      suspendedAt: null,
      mergedIntoId: null,
    },
  });
  expect(await readPublicRefreshSchedule(db, source)).toMatchObject({
    state: "SCHEDULED",
    valid: true,
  });
  await due(row.id);
  expect(await processScheduledRefresh(db, row.id)).toMatchObject({
    state: "COMPLETED",
  });
});

it("bounds transient retries, exposes safe failed status and requires a new authorization to resume", async () => {
  const row = await caller("HEAD").admin.scheduleRefresh(await input());
  await due(row.id);
  const apply = vi
    .spyOn(refreshDomain, "applyProgramRefresh")
    .mockRejectedValue(new Error("Synthetic private infrastructure details"));
  for (let attempt = 1; attempt <= 5; attempt++) {
    await processDueScheduledRefreshes(db);
    expect(
      (await caller("HEAD").admin.refreshSchedule()).schedule,
    ).toMatchObject({
      attempts: attempt,
      state: attempt < 5 ? "SCHEDULED" : "FAILED",
      blockedReason: "SCHEDULED_REFRESH_EXECUTION_FAILED",
    });
  }
  await processDueScheduledRefreshes(db);
  expect(apply).toHaveBeenCalledTimes(5);
  expect(await db.term.count()).toBe(1);
  expect(await db.notification.count()).toBe(2);
  const audits = await db.auditLog.findMany({
    where: { entity: "ScheduledProgramRefresh" },
  });
  expect(JSON.stringify(audits)).not.toContain(
    "Synthetic private infrastructure details",
  );
  apply.mockRestore();
  const failed = await db.scheduledProgramRefresh.findUniqueOrThrow({
    where: { id: row.id },
  });
  const renewed = await caller("HEAD").admin.scheduleRefresh(
    await input(failed.version),
  );
  expect(renewed).toMatchObject({
    state: "SCHEDULED",
    attempts: 0,
    blockedReason: null,
  });
});

it("serializes cancellation racing with a due execution", async () => {
  const row = await caller("HEAD").admin.scheduleRefresh(await input());
  await due(row.id);
  await Promise.allSettled([
    caller("HEAD").admin.cancelRefresh({
      id: row.id,
      expectedVersion: row.version,
    }),
    processScheduledRefresh(db, row.id),
  ]);
  const final = await db.scheduledProgramRefresh.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(["CANCELLED", "COMPLETED"]).toContain(final.state);
  const active = await db.term.findFirstOrThrow({ where: { active: true } });
  expect(active.quarter).toBe(final.state === "COMPLETED" ? "Q2" : "Q1");
  expect(await db.term.count()).toBe(final.state === "COMPLETED" ? 2 : 1);
});

it("manual and scheduled contenders can activate only one destination", async () => {
  const value = await input();
  const row = await caller("HEAD").admin.scheduleRefresh(value);
  await due(row.id);
  await Promise.allSettled([
    caller("HEAD").admin.refresh(value),
    processScheduledRefresh(db, row.id),
  ]);
  await processDueScheduledRefreshes(db);
  expect(
    (await db.term.findFirstOrThrow({ where: { active: true } })).quarter,
  ).toBe("Q2");
  expect(await db.term.count()).toBe(2);
  // The losing API contender may leave a valid FAILED attempt receipt. Count
  // committed domain effects independently of middleware attempts/summaries.
  expect(
    await db.auditLog.count({
      where: {
        operation: "admin.refresh",
        entity: "Term",
        action: { startsWith: "Refreshed program to " },
      },
    }),
  ).toBe(1);
});

it("a manual refresh supersedes a scheduled source without letting its due worker advance again", async () => {
  const value = await input();
  const row = await caller("HEAD").admin.scheduleRefresh(value);
  await caller("HEAD").admin.refresh(value);
  await due(row.id);
  expect(await processScheduledRefresh(db, row.id)).toMatchObject({
    state: "BLOCKED",
  });
  expect(
    (await db.term.findFirstOrThrow({ where: { active: true } })).quarter,
  ).toBe("Q2");
  expect(await db.term.count()).toBe(2);
});

it("rolls back activation, schedule outcome and notices together after failure, then retries once", async () => {
  const row = await caller("HEAD").admin.scheduleRefresh(await input());
  await due(row.id);
  await expect(
    db.$transaction(async (tx) => {
      await processScheduledRefresh(tx, row.id);
      throw new Error("Synthetic transaction failure before commit");
    }),
  ).rejects.toThrow("Synthetic transaction failure");
  expect(await db.term.count()).toBe(1);
  expect(
    (
      await db.scheduledProgramRefresh.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).state,
  ).toBe("SCHEDULED");
  expect(await db.notification.count()).toBe(0);
  expect(await processScheduledRefresh(db, row.id)).toMatchObject({
    state: "COMPLETED",
  });
});

it("rejects Admin approval after another schedule edit changed the captured version", async () => {
  const row = await caller("HEAD").admin.scheduleRefresh(await input());
  const requestId = await queued("ADMIN", await input(row.version));
  await caller("HEAD").admin.scheduleRefresh(await input(row.version));
  await expect(
    caller("HEAD").approval.decide({
      id: requestId,
      approve: true,
      note: "This old proposal is stale",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (await db.approvalRequest.findUniqueOrThrow({ where: { id: requestId } }))
      .state,
  ).toBe("PENDING");
});

it.each([
  { quarter: "Q4" as const, semester: false, target: "Q1", year: "27-28" },
  { quarter: "Q1" as const, semester: true, target: "Q3", year: "26-27" },
])(
  "uses the reviewed destination for $quarter with semester=$semester",
  async ({ quarter, semester, target, year }) => {
    await db.term.update({ where: { id: source }, data: { quarter } });
    if (semester)
      await caller("HEAD").program.setFeaturePending({
        key: "QUARTER_SYSTEM",
        enabled: false,
      });
    const row = await caller("HEAD").admin.scheduleRefresh(await input());
    await due(row.id);
    await processScheduledRefresh(db, row.id);
    expect(
      await db.term.findFirstOrThrow({ where: { active: true } }),
    ).toMatchObject({ quarter: target, schoolYear: year });
  },
);
