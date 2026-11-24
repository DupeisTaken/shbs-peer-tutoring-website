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
let coordinatorId: string;
let roomAId: string;
let roomBId: string;
let roomCId: string;

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
  coordinatorId = (
    await db.user.create({
      data: {
        email: "coord@example.test",
        name: "Coordinator User",
        role: "COORDINATOR",
      },
    })
  ).id;
  roomAId = (await db.room.create({ data: { name: "Room A", patrolOrder: 0 } }))
    .id;
  roomBId = (await db.room.create({ data: { name: "Room B", patrolOrder: 1 } }))
    .id;
  roomCId = (await db.room.create({ data: { name: "Room C", patrolOrder: 2 } }))
    .id;
});

afterAll(() => db.$disconnect());

it("retains exact before/after patrolOrder values including zero in stored audit comparisons for admin.setPatrolOrder", async () => {
  await caller(headId, "HEAD").admin.setPatrolOrder({
    roomIds: [roomCId, roomAId, roomBId],
  });

  const audits = await db.auditLog.findMany({
    where: { operation: "admin.setPatrolOrder" },
    orderBy: { createdAt: "desc" },
  });
  expect(audits).toHaveLength(1);
  const details = audits[0]!.details as {
    outcome?: string;
    changes?: Array<{
      entity?: string;
      before?: Array<Record<string, unknown>>;
      after?: Array<Record<string, unknown>>;
      submittedSafeFields?: Record<string, unknown>;
    }>;
  };
  expect(details.outcome).toBe("APPLIED");
  const roomChanges = (details.changes ?? []).filter(
    (change) => change.entity === "Room",
  );
  expect(roomChanges).toHaveLength(3);

  const byId = new Map(
    roomChanges.map((change) => [
      String(change.before?.[0]?.id ?? change.after?.[0]?.id),
      {
        beforeOrder: change.before?.[0]?.patrolOrder,
        afterOrder: change.after?.[0]?.patrolOrder,
        submittedOrder: change.submittedSafeFields?.patrolOrder,
      },
    ]),
  );

  // Room C moved 2 -> 0 (numeric zero must be preserved explicitly).
  expect(byId.get(roomCId)).toEqual({
    beforeOrder: 2,
    afterOrder: 0,
    submittedOrder: 0,
  });
  // Room A moved 0 -> 1 (original numeric zero must be preserved explicitly).
  expect(byId.get(roomAId)).toEqual({
    beforeOrder: 0,
    afterOrder: 1,
    submittedOrder: 1,
  });
  // Room B moved 1 -> 2.
  expect(byId.get(roomBId)).toEqual({
    beforeOrder: 1,
    afterOrder: 2,
    submittedOrder: 2,
  });

  // Coordinator proposal (if queued) also preserves patrolOrder evidence without leaking private fields.
  try {
    await caller(coordinatorId, "COORDINATOR").admin.setPatrolOrder({
      roomIds: [roomBId, roomCId, roomAId],
    });
  } catch (error) {
    expect(
      (error as { data?: { approvalId?: string } }).data?.approvalId,
    ).toBeTruthy();
  }
  const roomsNow = await db.room.findMany({
    orderBy: { patrolOrder: "asc" },
    select: { id: true, patrolOrder: true },
  });
  expect(roomsNow).toEqual([
    { id: roomCId, patrolOrder: 0 },
    { id: roomAId, patrolOrder: 1 },
    { id: roomBId, patrolOrder: 2 },
  ]);
});
