import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn().mockResolvedValue(undefined) },
  isEmailConfigured: () => false,
  isEmailDeliveryAvailable: () => false,
}));

import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { hashPassword } from "./auth/password";

let prefix = "";
let serial = 0;
let adminId = "";
let admin2Id = "";
let coordinatorId = "";
let viewerId = "";

const caller = (id: string, role: Session["role"]) =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, email: `${id}@example.test`, name: `User ${id}` },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });

const isSafeTestDb = () => {
  if (!process.env.DATABASE_URL) return false;
  const url = new URL(process.env.DATABASE_URL);
  return (
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname === "/shbs_shipping_test"
  );
};

beforeEach(async () => {
  if (!isSafeTestDb())
    throw new Error("Use the isolated local shbs_shipping_test database.");

  const stamp = Date.now().toString(36);
  prefix = `appeal641-${stamp}-${++serial}`;
  adminId = `${prefix}-admin1`;
  admin2Id = `${prefix}-admin2`;
  coordinatorId = `${prefix}-coord`;
  viewerId = `${prefix}-viewer`;
  const passwordHash = hashPassword("AppealTestPassword123!");

  await db.user.createMany({
    data: [
      {
        id: adminId,
        email: `${adminId}@example.test`,
        username: `adm1${stamp}${serial}`,
        name: "Appeal Admin One",
        role: "ADMIN",
        emailVerifiedAt: new Date(),
        passwordHash,
      },
      {
        id: admin2Id,
        email: `${admin2Id}@example.test`,
        username: `adm2${stamp}${serial}`,
        name: "Appeal Admin Two",
        role: "ADMIN",
        emailVerifiedAt: new Date(),
        passwordHash,
      },
      {
        id: coordinatorId,
        email: `${coordinatorId}@example.test`,
        username: `crd${stamp}${serial}`,
        name: "Appeal Coordinator",
        role: "COORDINATOR",
        emailVerifiedAt: new Date(),
        passwordHash,
      },
      {
        id: viewerId,
        email: `${viewerId}@example.test`,
        username: `vwr${stamp}${serial}`,
        name: "Suspended Viewer",
        role: "VIEWER",
        emailVerifiedAt: new Date(),
        suspendedAt: new Date(),
        suspendedReason: "Initial restriction",
        passwordHash,
      },
    ],
  });
});

afterAll(async () => {
  if (!isSafeTestDb()) return;
  const users = await db.user.findMany({
    where: { id: { startsWith: "appeal641-" } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.notification.deleteMany({ where: { userId: { in: ids } } });
    await db.approvalRequest.deleteMany({
      where: { requesterId: { in: ids } },
    });
    await db.accountAppeal.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
});

it("serializes concurrent submitAppeal calls into one pending appeal and one reviewer notice per eligible admin", async () => {
  const results = await Promise.allSettled([
    caller(viewerId, "VIEWER").account.submitAppeal({
      message: "First tab appeal explanation",
    }),
    caller(viewerId, "VIEWER").account.submitAppeal({
      message: "Second tab appeal explanation",
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]!.reason).toMatchObject({
    code: "BAD_REQUEST",
    message: "You already have a pending appeal.",
  });

  const appeals = await db.accountAppeal.findMany({
    where: { userId: viewerId },
  });
  expect(appeals).toHaveLength(1);
  expect(appeals[0]?.state).toBe("PENDING");

  const noticesForAdmin1 = await db.notification.count({
    where: { userId: adminId, event: "account_appeal_requested" },
  });
  expect(noticesForAdmin1).toBe(1);
});

it("serializes concurrent submitAppeal against reinstateUser without stranding a pending appeal on an active user", async () => {
  await Promise.allSettled([
    caller(viewerId, "VIEWER").account.submitAppeal({
      message: "Concurrent submit vs reinstate",
    }),
    caller(adminId, "ADMIN").admin.reinstateUser({ userId: viewerId }),
  ]);

  const user = await db.user.findUniqueOrThrow({
    where: { id: viewerId },
    select: { suspendedAt: true },
  });
  expect(user.suspendedAt).toBeNull();

  const pendingAppeals = await db.accountAppeal.count({
    where: { userId: viewerId, state: "PENDING" },
  });
  expect(pendingAppeals).toBe(0);
});

it("prevents concurrent APPROVE and DENY from overwriting a terminal decision or contradicting suspension state", async () => {
  await caller(viewerId, "VIEWER").account.submitAppeal({
    message: "Race between approve and deny",
  });
  const [listed] = await caller(adminId, "ADMIN").admin.appeals();
  const mine = (await caller(adminId, "ADMIN").admin.appeals()).find(
    (a) => a.userId === viewerId,
  )!;
  expect(listed).toBeTruthy();

  const [approveRes, denyRes] = await Promise.allSettled([
    caller(adminId, "ADMIN").admin.decideAppeal({
      appealId: mine.id,
      action: "APPROVE",
      expectedAuthorityRevision: mine.restriction.authorityRevision,
    }),
    caller(admin2Id, "ADMIN").admin.decideAppeal({
      appealId: mine.id,
      action: "DENY",
      expectedAuthorityRevision: mine.restriction.authorityRevision,
    }),
  ]);

  const wins = [approveRes, denyRes].filter((r) => r.status === "fulfilled");
  const losses = [approveRes, denyRes].filter((r) => r.status === "rejected");
  expect(wins).toHaveLength(1);
  expect(losses).toHaveLength(1);

  const finalAppeal = await db.accountAppeal.findUniqueOrThrow({
    where: { id: mine.id },
  });
  const finalUser = await db.user.findUniqueOrThrow({
    where: { id: viewerId },
    select: { suspendedAt: true },
  });
  const outcomeNotices = await db.notification.findMany({
    where: {
      userId: viewerId,
      event: { in: ["account_appeal_approved", "account_appeal_declined"] },
    },
  });
  expect(outcomeNotices).toHaveLength(1);

  if (approveRes.status === "fulfilled") {
    expect(finalAppeal.state).toBe("APPROVED");
    expect(finalUser.suspendedAt).toBeNull();
    expect(outcomeNotices[0]?.event).toBe("account_appeal_approved");
  } else {
    expect(finalAppeal.state).toBe("DENIED");
    expect(finalUser.suspendedAt).not.toBeNull();
    expect(outcomeNotices[0]?.event).toBe("account_appeal_declined");
  }
});

it("co-resolves legacy duplicate pending appeals on APPROVE while preserving terminal history, and closes already-active appeals without changing access", async () => {
  const historicalDenied = await db.accountAppeal.create({
    data: {
      userId: viewerId,
      message: "Earlier denied appeal",
      state: "DENIED",
      decidedByName: "Earlier Admin",
      decidedAt: new Date(Date.now() - 86_400_000),
    },
  });
  const legacyOne = await db.accountAppeal.create({
    data: { userId: viewerId, message: "Legacy duplicate one", state: "PENDING" },
  });
  const legacyTwo = await db.accountAppeal.create({
    data: { userId: viewerId, message: "Legacy duplicate two", state: "PENDING" },
  });

  const target = (await caller(adminId, "ADMIN").admin.appeals()).find(
    (a) => a.id === legacyOne.id,
  )!;
  const result = await caller(adminId, "ADMIN").admin.decideAppeal({
    appealId: legacyOne.id,
    action: "APPROVE",
    expectedAuthorityRevision: target.restriction.authorityRevision,
  });

  expect(result.accessRestored).toBe(true);
  expect(result.coResolvedAppealIds.sort()).toEqual(
    [legacyOne.id, legacyTwo.id].sort(),
  );

  const refreshed = await db.accountAppeal.findMany({
    where: { userId: viewerId },
  });
  expect(refreshed.find((a) => a.id === historicalDenied.id)?.state).toBe(
    "DENIED",
  );
  expect(refreshed.find((a) => a.id === legacyOne.id)?.state).toBe("APPROVED");
  expect(refreshed.find((a) => a.id === legacyTwo.id)?.state).toBe("APPROVED");

  // Legacy pending row on an already-active user: DENY conflicts, APPROVE closes with accessRestored: false.
  const activeLegacy = await db.accountAppeal.create({
    data: { userId: viewerId, message: "Orphan pending row", state: "PENDING" },
  });
  const activeReview = (await caller(adminId, "ADMIN").admin.appeals()).find(
    (a) => a.id === activeLegacy.id,
  )!;
  expect(activeReview.restriction.suspendedAt).toBeNull();

  await expect(
    caller(adminId, "ADMIN").admin.decideAppeal({
      appealId: activeLegacy.id,
      action: "DENY",
      expectedAuthorityRevision: activeReview.restriction.authorityRevision,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });

  const closed = await caller(adminId, "ADMIN").admin.decideAppeal({
    appealId: activeLegacy.id,
    action: "APPROVE",
    expectedAuthorityRevision: activeReview.restriction.authorityRevision,
  });
  expect(closed.accessRestored).toBe(false);
  expect(closed.coResolvedAppealIds).toEqual([activeLegacy.id]);
});

it("rejects missing or stale authority revisions and fences Coordinator proposals before queuing", async () => {
  await caller(viewerId, "VIEWER").account.submitAppeal({
    message: "Check revision fence",
  });
  const initial = (await caller(adminId, "ADMIN").admin.appeals()).find(
    (a) => a.userId === viewerId,
  )!;

  // Missing expectedAuthorityRevision fails with PRECONDITION_FAILED for both Admin and Coordinator.
  await expect(
    caller(adminId, "ADMIN").admin.decideAppeal({
      appealId: initial.id,
      action: "APPROVE",
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

  await expect(
    caller(coordinatorId, "COORDINATOR").admin.decideAppeal({
      appealId: initial.id,
      action: "APPROVE",
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

  // Updating suspension reason advances refreshAuthorityRevision even in the same millisecond.
  await caller(adminId, "ADMIN").admin.suspendUser({
    userId: viewerId,
    reason: "Updated restriction reason",
  });

  await expect(
    caller(adminId, "ADMIN").admin.decideAppeal({
      appealId: initial.id,
      action: "APPROVE",
      expectedAuthorityRevision: initial.restriction.authorityRevision,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });

  await expect(
    caller(coordinatorId, "COORDINATOR").admin.decideAppeal({
      appealId: initial.id,
      action: "APPROVE",
      expectedAuthorityRevision: initial.restriction.authorityRevision,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });

  const queuedCount = await db.approvalRequest.count({
    where: { requesterId: coordinatorId },
  });
  expect(queuedCount).toBe(0);

  // Fresh revision allows Coordinator to queue and Admin to approve/replay cleanly.
  const fresh = (await caller(adminId, "ADMIN").admin.appeals()).find(
    (a) => a.userId === viewerId,
  )!;
  await expect(
    caller(coordinatorId, "COORDINATOR").admin.decideAppeal({
      appealId: fresh.id,
      action: "APPROVE",
      expectedAuthorityRevision: fresh.restriction.authorityRevision,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: { requesterId: coordinatorId, operation: "admin.decideAppeal" },
  });
  await caller(adminId, "ADMIN").approval.decide({
    id: proposal.id,
    approve: true,
    note: "Verified appeal approval",
  });

  const userAfter = await db.user.findUniqueOrThrow({
    where: { id: viewerId },
    select: { suspendedAt: true },
  });
  expect(userAfter.suspendedAt).toBeNull();
});
