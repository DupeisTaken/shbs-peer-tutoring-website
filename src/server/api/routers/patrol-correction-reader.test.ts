import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test") {
  throw Error("Use shbs_shipping_test");
}

let headId: string;
let adminId: string;
let coordinatorId: string;
let viewerId: string;
let crewId: string;
let roomAId: string;
let roomBId: string;

const caller = (id: string, role: Session["role"]) =>
  createCaller({
    db,
    headers: new Headers(),
    session: { user: { id }, role, tutorId: null, expires: "2099-01-01" },
  });

beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  headId = (
    await db.user.create({
      data: { email: "head@example.test", name: "Head User", role: "HEAD" },
    })
  ).id;
  adminId = (
    await db.user.create({
      data: { email: "admin@example.test", name: "Admin User", role: "ADMIN" },
    })
  ).id;
  coordinatorId = (
    await db.user.create({
      data: {
        email: "coord@example.test",
        name: "Coordinator User",
        role: "COORDINATOR",
      },
    })
  ).id;
  viewerId = (
    await db.user.create({
      data: {
        email: "viewer@example.test",
        name: "Viewer User",
        role: "VIEWER",
      },
    })
  ).id;
  crewId = (
    await db.user.create({
      data: {
        email: "crew@example.test",
        name: "Crew Member",
        role: "CREW",
        crewStatus: "ACTIVE",
      },
    })
  ).id;
  roomAId = (await db.room.create({ data: { name: "Room 101" } })).id;
  roomBId = (await db.room.create({ data: { name: "Room 202" } })).id;
});

afterAll(() => db.$disconnect());

it("reads an exact patrol by id even after 55 newer patrols push it past page 1 and excludes credit/submission metadata", async () => {
  const target = await db.patrol.create({
    data: {
      crewUserId: crewId,
      createdAt: new Date("2026-09-01T08:00:00Z"),
      note: "Original patrol note",
      hours: 0.5,
      submissionKey: "private-submission-key",
      creditAwardedAt: new Date("2026-09-01T08:05:00Z"),
      observations: {
        create: [
          {
            roomId: roomBId,
            headcount: "TWO",
            observedAt: new Date("2026-09-01T08:02:00Z"),
          },
          {
            roomId: roomAId,
            headcount: "ONE",
            observedAt: new Date("2026-09-01T08:01:00Z"),
          },
        ],
      },
    },
  });

  // Create 55 newer patrols so target is no longer on the 50-row page 1.
  for (let i = 0; i < 55; i++) {
    await db.patrol.create({
      data: {
        crewUserId: crewId,
        createdAt: new Date(Date.UTC(2026, 8, 2, 0, i, 0)),
        note: `Newer patrol ${i}`,
        hours: 0,
      },
    });
  }

  const page1 = await caller(adminId, "ADMIN").corrections.patrols();
  expect(page1).toHaveLength(50);
  expect(page1.some((row) => row.id === target.id)).toBe(false);

  const exact = await caller(adminId, "ADMIN").corrections.patrolById({
    id: target.id,
  });
  expect(exact.id).toBe(target.id);
  expect(exact.note).toBe("Original patrol note");
  expect(exact.hours).toBe(0.5);
  expect(exact.crewUser).toEqual({ name: "Crew Member" });
  // Ordered by observedAt asc, id asc.
  expect(exact.observations.map((o) => o.room.name)).toEqual([
    "Room 101",
    "Room 202",
  ]);
  expect(exact.observations.map((o) => o.headcount)).toEqual(["ONE", "TWO"]);
  // Must not expose submission/credit metadata.
  expect("submissionKey" in exact).toBe(false);
  expect("creditAwardedAt" in exact).toBe(false);

  // HEAD and COORDINATOR (non-read-only staff who can submit patrol corrections) can also read the baseline.
  const asHead = await caller(headId, "HEAD").corrections.patrolById({
    id: target.id,
  });
  expect(asHead.id).toBe(target.id);
  const asCoord = await caller(
    coordinatorId,
    "COORDINATOR",
  ).corrections.patrolById({
    id: target.id,
  });
  expect(asCoord.id).toBe(target.id);
});

it("rejects observers, non-staff and missing patrol IDs", async () => {
  const target = await db.patrol.create({
    data: {
      crewUserId: crewId,
      createdAt: new Date("2026-09-01T08:00:00Z"),
      hours: 0,
    },
  });

  await expect(
    caller(viewerId, "VIEWER").corrections.patrolById({ id: target.id }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller(crewId, "CREW").corrections.patrolById({ id: target.id }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller(adminId, "ADMIN").corrections.patrolById({
      id: "nonexistent-patrol-id",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
