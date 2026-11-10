import { afterAll, beforeEach, expect, it, vi } from "vitest";
import superjson from "superjson";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { ApprovalQueued } from "~/server/approvals";
import { safeAuditSnapshot } from "~/server/audit/evidence";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { createCaller } from "~/server/api/root";

assertIsolatedTestDatabase(process.env.DATABASE_URL);

const headId = "patrol-order-evidence-head";
const coordinatorId = "patrol-order-evidence-coordinator";
type Room = { id: string; name: string; patrolOrder: number };
type Change = {
  entity: string;
  write: string;
  before: Room[];
  after: Room[];
  submittedSafeFields: { patrolOrder: number }[];
};
let rooms: Room[];

function caller(role: "HEAD" | "COORDINATOR") {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: role === "HEAD" ? headId : coordinatorId,
        name: "Synthetic patrol-order manager",
      },
      role,
      tutorId: null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
}

beforeEach(async () => {
  // Reset only the explicitly guarded disposable DB; retained audit rows are immutable.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.user.createMany({
    data: [
      {
        id: headId,
        email: "patrol-evidence-head@example.test",
        role: "HEAD",
        passwordHash: "SYNTHETIC_PASSWORD_HASH_NEVER_AUDIT",
      },
      {
        id: coordinatorId,
        email: "patrol-evidence-coordinator@example.test",
        role: "COORDINATOR",
      },
    ],
  });
  rooms = [];
  for (const [name, patrolOrder] of [
    ["Synthetic A", 20],
    ["Synthetic B", 10],
    ["Synthetic C", 0],
  ] as const) {
    rooms.push(
      await db.room.create({
        data: { name, patrolOrder },
        select: { id: true, name: true, patrolOrder: true },
      }),
    );
  }
});

afterAll(() => db.$disconnect());

it("retains the original and applied numeric patrol sequence in the direct writer's own audit event", async () => {
  const proposed = [rooms[1]!, rooms[0]!, rooms[2]!];
  await expect(
    caller("HEAD").admin.setPatrolOrder({
      roomIds: proposed.map((room) => room.id),
    }),
  ).resolves.toEqual({ ok: true });
  const saved = await db.room.findMany({
    orderBy: [{ patrolOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, patrolOrder: true },
  });
  expect(saved).toEqual(
    proposed.map((room, patrolOrder) => ({ ...room, patrolOrder })),
  );

  const events = await db.auditLog.findMany({
    where: { operation: "admin.setPatrolOrder", userId: headId },
  });
  expect(events).toHaveLength(1);
  const event = events[0]!;
  expect(event.approvalId).toBeNull();
  const details = event.details as unknown as {
    outcome: string;
    changes: Change[];
  };
  expect(details.outcome).toBe("APPLIED");
  const changes = details.changes.filter((change) => change.entity === "Room");
  expect(changes).toHaveLength(3);
  // Changes happen in the submitted order, which can recover AFTER order only.
  // Old ranks must survive here; reading today's rooms cannot recover this before-state.
  for (const [index, change] of changes.entries()) {
    const original = proposed[index]!;
    expect(change.write).toBe("update");
    expect(change.before).toEqual([
      expect.objectContaining({
        id: original.id,
        patrolOrder: original.patrolOrder,
      }),
    ]);
    expect(change.after).toEqual([
      expect.objectContaining({ id: original.id, patrolOrder: index }),
    ]);
    expect(change.submittedSafeFields).toEqual([{ patrolOrder: index }]);
  }
  expect(JSON.stringify(event.details)).not.toContain(
    "SYNTHETIC_PASSWORD_HASH_NEVER_AUDIT",
  );
});

it("already captures original ranks and the ordered requested IDs for a Coordinator proposal", async () => {
  const roomIds = [rooms[1]!.id, rooms[0]!.id, rooms[2]!.id];
  let requestId: string | undefined;
  try {
    await caller("COORDINATOR").admin.setPatrolOrder({ roomIds });
    throw new Error(
      "Expected a queued proposal instead of a direct order write",
    );
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(ApprovalQueued);
    requestId = (cause as ApprovalQueued).approvalId;
  }
  const request = await db.approvalRequest.findUniqueOrThrow({
    where: { id: requestId },
  });
  expect(request.state).toBe("PENDING");
  expect(
    superjson.deserialize(
      request.payload as unknown as Parameters<typeof superjson.deserialize>[0],
    ),
  ).toEqual({ roomIds });
  const captured = (
    request.targets as unknown as { Room: { record: Room }[] }
  ).Room.map(({ record }) => ({
    id: record.id,
    name: record.name,
    patrolOrder: record.patrolOrder,
  }));
  expect(
    captured.sort((left, right) => left.id.localeCompare(right.id)),
  ).toEqual([...rooms].sort((left, right) => left.id.localeCompare(right.id)));
  expect(
    await db.room.findMany({
      orderBy: { id: "asc" },
      select: { id: true, name: true, patrolOrder: true },
    }),
  ).toEqual([...rooms].sort((left, right) => left.id.localeCompare(right.id)));
});

it("keeps credential, invitation, message and retry fields outside Room fallback evidence", () => {
  const safe = safeAuditSnapshot(
    {
      patrolOrder: 0,
      passwordHash: "SYNTHETIC_PRIVATE_PASSWORD",
      code: "SYNTHETIC_PRIVATE_INVITATION",
      tokenHash: "SYNTHETIC_PRIVATE_TOKEN",
      body: "SYNTHETIC_PRIVATE_MESSAGE",
      clientKey: "SYNTHETIC_PRIVATE_RETRY",
      email: "private-room-context@example.test",
    },
    "Room",
  );
  expect(safe).toMatchObject({ patrolOrder: 0 });
  for (const field of [
    "passwordHash",
    "code",
    "tokenHash",
    "body",
    "clientKey",
    "email",
  ]) {
    expect(safe).not.toHaveProperty(field);
  }
  expect(JSON.stringify(safe)).not.toContain("SYNTHETIC_PRIVATE");
});

it("preserves missing legacy patrol ranks as unavailable instead of fabricating a zero or current rank", () => {
  const missing = safeAuditSnapshot(
    { id: "legacy-room", name: "Synthetic legacy room" },
    "Room",
  );
  expect(missing).toEqual({ id: "legacy-room", name: "Synthetic legacy room" });
  expect(missing).not.toHaveProperty("patrolOrder");
  expect(safeAuditSnapshot({ patrolOrder: null }, "Room")).toEqual({
    patrolOrder: null,
  });
  expect(safeAuditSnapshot({ patrolOrder: 0 }, "Room")).toEqual({
    patrolOrder: 0,
  });
  expect(safeAuditSnapshot({ patrolOrder: 20 }, "Room")).toEqual({
    patrolOrder: 20,
  });
});

it("does not broaden patrol rank evidence into nested updates or nonfinite values", () => {
  for (const patrolOrder of [
    { set: 1 },
    [1, 2],
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])
    expect(safeAuditSnapshot({ patrolOrder }, "Room")).not.toHaveProperty(
      "patrolOrder",
    );
});
