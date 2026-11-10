import type { Session } from "next-auth";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
  throw new Error("Use shbs_shipping_test");

const targetId = "captured-patrol";
const crewId = "private-crew-account-id";
const termId = "private-patrol-term-id";
const submissionKey = "54c5c472-c7e6-4dd0-bd33-a242124f4732";
const submissionPayloadHash = "b".repeat(64);
const privateEmail = "private-patrol-login@example.test";
const privateCredential = "private-credential-sentinel";
const createdAt = new Date("2026-01-01T08:00:00Z");
const updatedAt = new Date("2026-01-02T08:00:00Z");
const observedAt = new Date("2026-01-01T07:59:00Z");
const actorId = (role: string) => `reader-${role.toLowerCase()}`;

/** Capture actual fresh login generations before the query, never infer them
 * from a later authorization result. The normal router middleware stays real. */
async function callerFor(id: string) {
  const account = await db.user.findUniqueOrThrow({
    where: { id },
    select: {
      role: true,
      tutorId: true,
      sessionVersion: true,
      historyAccessRevision: true,
    },
  });
  const session: Session = {
    user: { id, name: "Synthetic patrol reader" },
    ...account,
    expires: "2099-01-01T00:00:00Z",
  };
  return createCaller({ db, headers: new Headers(), session });
}

async function evidenceSnapshot() {
  return {
    patrols: await db.patrol.findMany({
      orderBy: { id: "asc" },
      include: { observations: { orderBy: { id: "asc" } } },
    }),
    windows: await db.patrolCreditWindow.findMany({
      orderBy: [{ crewUserId: "asc" }, { windowStart: "asc" }],
    }),
    flags: await db.sessionFlag.findMany({ orderBy: { id: "asc" } }),
    adjustments: await db.serviceHourAdjustment.findMany({
      orderBy: { id: "asc" },
    }),
    audit: await db.auditLog.findMany({ orderBy: { id: "asc" } }),
    notices: await db.notification.findMany({ orderBy: { id: "asc" } }),
    approvals: await db.approvalRequest.findMany({ orderBy: { id: "asc" } }),
  };
}

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.createMany({
    data: [
      "HEAD",
      "ADMIN",
      "COORDINATOR",
      "VIEWER",
      "STUDENT",
      "CREW",
      "TUTOR",
    ].map((role) => ({
      id: actorId(role),
      email: `${role.toLowerCase()}@patrol-reader.example.test`,
      role: role as Session["role"],
      name: "Synthetic patrol reader",
    })),
  });
  await db.user.create({
    data: {
      id: crewId,
      role: "CREW",
      crewStatus: "ACTIVE",
      name: "Synthetic crew display name",
      email: privateEmail,
      passwordHash: privateCredential,
    },
  });
  await db.schoolDeparture.create({
    data: {
      userId: actorId("TUTOR"),
      reason: "GRADUATED",
      source: "SYNTHETIC_TEST",
      observerRevoked: false,
    },
  });
  await db.term.create({
    data: {
      id: termId,
      schoolYear: "25-26",
      quarter: "Q1",
      name: "Synthetic patrol term",
    },
  });
  await db.room.createMany({
    data: [
      { id: "room-a", name: "Synthetic room A" },
      { id: "room-b", name: "Synthetic room B" },
    ],
  });
  await db.patrol.create({
    data: {
      id: targetId,
      crewUserId: crewId,
      termId,
      submissionKey,
      submissionPayloadHash,
      createdAt,
      updatedAt,
      creditAwardedAt: createdAt,
      hours: 0.5,
      note: "Synthetic captured note",
      observations: {
        create: [
          {
            id: "observation-z",
            roomId: "room-b",
            headcount: "TWO",
            observedAt,
          },
          {
            id: "observation-a",
            roomId: "room-a",
            headcount: "ONE",
            observedAt,
          },
          {
            id: "observation-early",
            roomId: "room-a",
            headcount: "ZERO",
            observedAt: new Date(observedAt.getTime() - 60_000),
          },
        ],
      },
      creditWindows: {
        create: {
          crewUserId: crewId,
          windowStart: new Date("2026-01-01T07:40:00Z"),
        },
      },
    },
  });
  await db.auditLog.create({
    data: {
      id: "existing-audit",
      entity: "Patrol",
      entityId: targetId,
      action: "Existing synthetic evidence",
    },
  });
  await db.notification.create({
    data: {
      id: "existing-notice",
      userId: actorId("HEAD"),
      title: "Existing synthetic notice",
      body: "Retained unchanged",
    },
  });
});

afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$disconnect());

it.each(["HEAD", "ADMIN", "COORDINATOR"] as const)(
  "returns only the correction baseline for current %s without changing evidence",
  async (role) => {
    const caller = await callerFor(actorId(role));
    const before = await evidenceSnapshot();
    const row = await caller.corrections.patrolById({ id: targetId });
    expect(Object.keys(row).sort()).toEqual([
      "createdAt",
      "crewUser",
      "hours",
      "id",
      "note",
      "observations",
      "updatedAt",
    ]);
    expect(row).toMatchObject({
      id: targetId,
      createdAt,
      updatedAt,
      hours: 0.5,
      note: "Synthetic captured note",
    });
    expect(row.crewUser).toEqual({ name: "Synthetic crew display name" });
    expect(row.observations.map((observation) => observation.id)).toEqual([
      "observation-early",
      "observation-a",
      "observation-z",
    ]);
    for (const observation of row.observations) {
      expect(Object.keys(observation).sort()).toEqual([
        "headcount",
        "id",
        "observedAt",
        "room",
        "roomId",
      ]);
      expect(Object.keys(observation.room)).toEqual(["name"]);
    }
    expect(row.observations[1]).toEqual({
      id: "observation-a",
      roomId: "room-a",
      headcount: "ONE",
      observedAt,
      room: { name: "Synthetic room A" },
    });
    const serialized = JSON.stringify(row);
    for (const secret of [
      submissionKey,
      submissionPayloadHash,
      crewId,
      termId,
      privateEmail,
      privateCredential,
    ])
      expect(serialized).not.toContain(secret);
    for (const key of [
      "submissionKey",
      "submissionPayloadHash",
      "crewUserId",
      "termId",
      "creditAwardedAt",
      "creditWindows",
      "patrolId",
      "passwordHash",
      "email",
      "sessionVersion",
    ])
      expect(serialized).not.toContain(`"${key}"`);
    expect(await evidenceSnapshot()).toEqual(before);
  },
);

it("reads an existing captured target after a legitimate new arrival moves it from list position 50 to 51", async () => {
  const caller = await callerFor(actorId("HEAD"));
  await db.patrol.createMany({
    data: Array.from({ length: 49 }, (_, index) => ({
      id: `newer-${String(index).padStart(2, "0")}`,
      crewUserId: crewId,
      createdAt: new Date(createdAt.getTime() + (index + 1) * 1_000),
      hours: 0,
    })),
  });
  const firstPage = await caller.corrections.patrols();
  expect(firstPage).toHaveLength(50);
  expect(firstPage[49]!.id).toBe(targetId);
  await db.patrol.create({
    data: {
      id: "legitimate-new-arrival",
      crewUserId: crewId,
      createdAt: new Date(createdAt.getTime() + 100_000),
      hours: 0,
    },
  });
  const shiftedPage = await caller.corrections.patrols();
  expect(shiftedPage).toHaveLength(50);
  expect(shiftedPage.some((row) => row.id === targetId)).toBe(false);
  const before = await evidenceSnapshot();
  expect(await caller.corrections.patrolById({ id: targetId })).toMatchObject({
    id: targetId,
    updatedAt,
  });
  expect(await evidenceSnapshot()).toEqual(before);
});

it.each(["VIEWER", "STUDENT", "CREW", "TUTOR"] as const)(
  "refuses current %s, including the departed observer, before reading a protected patrol",
  async (role) => {
    const caller = await callerFor(actorId(role));
    // Observation access remains valid; it does not authorize the editing baseline.
    if (role === "VIEWER" || role === "TUTOR")
      expect(await caller.corrections.patrols()).toHaveLength(1);
    const before = await evidenceSnapshot();
    const lookup = vi.spyOn(db.patrol, "findUnique");
    await expect(
      caller.corrections.patrolById({ id: targetId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.corrections.patrolById({ id: "missing-patrol" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(lookup).not.toHaveBeenCalled();
    expect(await evidenceSnapshot()).toEqual(before);
  },
);

it("refuses a suspended manager before reading a protected patrol", async () => {
  await db.user.update({
    where: { id: actorId("ADMIN") },
    data: { suspendedAt: new Date("2026-01-03T00:00:00Z") },
  });
  const caller = await callerFor(actorId("ADMIN"));
  const before = await evidenceSnapshot();
  const lookup = vi.spyOn(db.patrol, "findUnique");
  await expect(
    caller.corrections.patrolById({ id: targetId }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(lookup).not.toHaveBeenCalled();
  expect(await evidenceSnapshot()).toEqual(before);
});

it.each(["HEAD", "ADMIN", "COORDINATOR"] as const)(
  "uses current authority after a session's %s role is demoted",
  async (role) => {
    const caller = await callerFor(actorId(role));
    await db.user.update({
      where: { id: actorId(role) },
      data: { role: "VIEWER" },
    });
    const before = await evidenceSnapshot();
    const lookup = vi.spyOn(db.patrol, "findUnique");
    await expect(
      caller.corrections.patrolById({ id: targetId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.corrections.patrolById({ id: "missing-patrol" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(lookup).not.toHaveBeenCalled();
    expect(await evidenceSnapshot()).toEqual(before);
  },
);

it("refuses an unauthenticated caller before reading a protected patrol", async () => {
  const caller = createCaller({ db, headers: new Headers(), session: null });
  const before = await evidenceSnapshot();
  const lookup = vi.spyOn(db.patrol, "findUnique");
  await expect(
    caller.corrections.patrolById({ id: targetId }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(lookup).not.toHaveBeenCalled();
  expect(await evidenceSnapshot()).toEqual(before);
});

it("returns NOT_FOUND for an authorized missing target without creating audit, notices or replacement evidence", async () => {
  const caller = await callerFor(actorId("HEAD"));
  const before = await evidenceSnapshot();
  await expect(
    caller.corrections.patrolById({ id: "missing-patrol" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await evidenceSnapshot()).toEqual(before);
});

it("rejects an empty target ID before reading a protected patrol", async () => {
  const caller = await callerFor(actorId("HEAD"));
  const before = await evidenceSnapshot();
  const lookup = vi.spyOn(db.patrol, "findUnique");
  await expect(caller.corrections.patrolById({ id: "" })).rejects.toMatchObject(
    { code: "BAD_REQUEST" },
  );
  expect(lookup).not.toHaveBeenCalled();
  expect(await evidenceSnapshot()).toEqual(before);
});
