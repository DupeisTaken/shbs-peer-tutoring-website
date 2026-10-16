import type { Session } from "next-auth";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { databaseScope } from "~/server/db-scope";
import { ApprovalQueued } from "~/server/approvals";
import { applyPendingFeatures } from "~/server/program/features";
import {
  allocateRoom,
  allocationData,
  notifyRoomShortage,
} from "~/server/room-allocation";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

// These fixtures reset a dedicated, local integration database before each case.
// Guard during module evaluation so even teardown cannot reach another database.
assertIsolatedTestDatabase(process.env.DATABASE_URL);
if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
  throw new Error("Room allocation integration requires shbs_shipping_test.");

let termId: string;
let tutorId: string;
let otherTutorId: string;
let subjectId: string;
let rooms: string[];
let slotId: string;
let overlapId: string;
let adjacentId: string;
let otherSlotId: string;
let learners: string[];
const subject = "Allocation Integration Mathematics";

function actor(role: Session["role"] = "ADMIN") {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: `allocation-${role}`, name: `Allocation ${role}` },
      role,
      tutorId: role === "TUTOR" ? tutorId : null,
      expires: "2099-01-01T00:00:00Z",
    },
  });
}

const create = (
  extra: Partial<
    Parameters<ReturnType<typeof actor>["admin"]["createPairing"]>[0]
  > = {},
) =>
  actor().admin.createPairing({
    tutorId,
    subject,
    subjectId,
    timeSlotId: slotId,
    tuteeIds: [],
    roomMode: "AUTO",
    ...extra,
  });

const update = (
  id: string,
  extra: Partial<
    Parameters<ReturnType<typeof actor>["admin"]["updatePairing"]>[0]
  > = {},
) =>
  actor().admin.updatePairing({
    id,
    tutorId,
    subject,
    subjectId,
    timeSlotId: slotId,
    tuteeIds: [],
    ...extra,
  });

/** Direct evidence setup keeps ranking assertions independent of the allocator being tested. */
async function evidence(
  roomId: string,
  extras: {
    tutorId?: string;
    tuteeIds?: string[];
    dayOfWeek?: number;
    startMin?: number;
    endMin?: number;
    termId?: string;
    scheduleConfirmed?: boolean;
  } = {},
) {
  const { tuteeIds = [], ...rest } = extras;
  return db.pairing.create({
    data: {
      termId,
      tutorId: otherTutorId,
      subject,
      roomId,
      roomMode: "FIXED",
      scheduleConfirmed: true,
      dayOfWeek: 2,
      startMin: 600,
      endMin: 660,
      ...rest,
      tutees: { create: tuteeIds.map((tuteeId) => ({ tuteeId })) },
    },
  });
}

async function blockAll(except: string[] = []) {
  await db.roomUnavailability.createMany({
    data: rooms
      .filter((id) => !except.includes(id))
      .map((roomId) => ({ roomId, dayOfWeek: 7, startMin: 600, endMin: 660 })),
  });
}

const shortages = () =>
  db.notification.findMany({ where: { title: "Pairing needs a room" } });

beforeEach(async () => {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((t) => '"' + t.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  termId = (
    await db.term.create({
      data: {
        name: "Allocation 26-27 Q1",
        schoolYear: "26-27",
        quarter: "Q1",
        active: true,
      },
    })
  ).id;
  tutorId = (
    await db.tutor.create({
      data: { englishName: "Allocation Tutor", status: "ACTIVE" },
    })
  ).id;
  otherTutorId = (
    await db.tutor.create({
      data: { englishName: "Evidence Tutor", status: "ACTIVE" },
    })
  ).id;
  for (const role of [
    "HEAD",
    "ADMIN",
    "COORDINATOR",
    "TUTOR",
    "VIEWER",
  ] as const)
    await db.user.create({
      data: {
        id: `allocation-${role}`,
        name: `Allocation ${role}`,
        email: `allocation-${role}@example.test`,
        role,
        tutorId: role === "TUTOR" ? tutorId : null,
      },
    });
  subjectId = (await db.subject.create({ data: { name: subject } })).id;
  for (const id of [tutorId, otherTutorId])
    await db.tutorQualification.create({
      data: {
        tutorId: id,
        subjectId,
        approvedById: "allocation-ADMIN",
        grants: { create: { subjectId } },
      },
    });
  rooms = [];
  for (const name of ["Allocation A", "Allocation B", "Allocation C"])
    rooms.push((await db.room.create({ data: { name } })).id);
  rooms.sort();
  slotId = (
    await db.timeSlot.create({
      data: {
        label: "Sunday primary",
        dayOfWeek: 7,
        startMin: 600,
        endMin: 660,
      },
    })
  ).id;
  overlapId = (
    await db.timeSlot.create({
      data: {
        label: "Sunday overlap",
        dayOfWeek: 7,
        startMin: 630,
        endMin: 690,
      },
    })
  ).id;
  adjacentId = (
    await db.timeSlot.create({
      data: {
        label: "Sunday adjacent",
        dayOfWeek: 7,
        startMin: 660,
        endMin: 720,
      },
    })
  ).id;
  otherSlotId = (
    await db.timeSlot.create({
      data: {
        label: "Monday primary",
        dayOfWeek: 1,
        startMin: 600,
        endMin: 660,
      },
    })
  ).id;
  learners = [];
  for (const englishName of ["Allocation Learner A", "Allocation Learner B"])
    learners.push((await db.tutee.create({ data: { englishName } })).id);
});

afterAll(() => db.$disconnect());

it("defaults a missing setting to automatic assignment and deterministic room identity", async () => {
  expect(
    await db.programFeature.count({ where: { key: "AUTO_ASSIGN_ROOMS" } }),
  ).toBe(0);
  expect(await create()).toMatchObject({
    roomId: rooms[0],
    roomMode: "AUTO",
    roomNeedsAssignment: false,
    roomOutcome: "ASSIGNED",
  });
});

it("counts familiar participants once across repeated evidence and favors the larger learner total", async () => {
  await evidence(rooms[0]!, { tutorId, dayOfWeek: 1 });
  await evidence(rooms[0]!, { tutorId, dayOfWeek: 2 });
  await evidence(rooms[0]!, { tutorId, dayOfWeek: 3 });
  await evidence(rooms[1]!, { tuteeIds: learners, dayOfWeek: 1 });
  expect(await create({ tuteeIds: learners })).toMatchObject({
    roomId: rooms[1],
  });
});

it("uses tutor familiarity on tied participant totals before balancing occupied minutes", async () => {
  await evidence(rooms[0]!, { tuteeIds: [learners[0]!], endMin: 620 });
  await evidence(rooms[1]!, { tutorId, endMin: 800 });
  expect(await create({ tuteeIds: [learners[0]!] })).toMatchObject({
    roomId: rooms[1],
  });
});

it("balances planned occupied minutes after equal familiarity and ignores other periods", async () => {
  await evidence(rooms[0]!, { endMin: 720 });
  await evidence(rooms[1]!, { endMin: 630 });
  const previous = await db.term.create({
    data: { name: "Previous", schoolYear: "25-26", quarter: "Q1" },
  });
  await evidence(rooms[2]!, {
    termId: previous.id,
    tutorId,
    tuteeIds: learners,
  });
  expect(await create({ tuteeIds: learners })).toMatchObject({
    roomId: rooms[2],
  });
});

it("retains an eligible automatic room even after a different room gains more familiarity", async () => {
  const pairing = await create();
  await evidence(rooms[1]!, { tutorId, tuteeIds: learners });
  expect(
    await update(pairing.id, {
      tuteeIds: learners,
      expectedRoomVersion: pairing.roomVersion,
    }),
  ).toMatchObject({ roomId: pairing.roomId, roomOutcome: "RETAINED" });
});

it("respects copied interval overlap and recurring blackouts while allowing adjacency", async () => {
  await evidence(rooms[0]!, { dayOfWeek: 7 }); // Detached: no catalog link.
  await db.roomUnavailability.create({
    data: { roomId: rooms[1]!, dayOfWeek: 7, startMin: 630, endMin: 690 },
  });
  expect(await create({ timeSlotId: overlapId })).toMatchObject({
    roomId: rooms[2],
  });
  expect(
    await create({
      roomMode: "FIXED",
      roomId: rooms[0],
      timeSlotId: adjacentId,
    }),
  ).toMatchObject({ roomId: rooms[0] });
});

it("does not treat awaiting placeholders as reservations or familiarity", async () => {
  await evidence(rooms[0]!, { dayOfWeek: 7, scheduleConfirmed: false });
  expect(await create()).toMatchObject({ roomId: rooms[0] });
});

it("saves a shortage, notifies only Head/Admin, and suppresses unchanged retry notices", async () => {
  await blockAll();
  const pairing = await create();
  expect(pairing).toMatchObject({
    scheduleConfirmed: true,
    roomId: null,
    roomNeedsAssignment: true,
    roomOutcome: "UNAVAILABLE",
  });
  expect((await shortages()).map((row) => row.userId).sort()).toEqual([
    "allocation-ADMIN",
    "allocation-HEAD",
  ]);
  const retried = await actor().admin.retryRoomAllocation({
    id: pairing.id,
    expectedRoomVersion: pairing.roomVersion,
  });
  expect(retried.roomOutcome).toBe("UNAVAILABLE");
  expect(await shortages()).toHaveLength(2);
  await update(pairing.id, {
    timeSlotId: overlapId,
    expectedRoomVersion: retried.roomVersion,
  });
  expect(await shortages()).toHaveLength(4);
});

it("retries shortages explicitly after capacity changes without replacing roster or qualifications", async () => {
  await blockAll();
  const pairing = await create({ tuteeIds: learners });
  await db.roomUnavailability.deleteMany({ where: { roomId: rooms[0] } });
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: pairing.id } }),
  ).toMatchObject({ roomId: null, roomNeedsAssignment: true });
  await db.tutorQualification.deleteMany({ where: { tutorId } });
  expect(
    await actor().admin.retryRoomAllocation({
      id: pairing.id,
      expectedRoomVersion: pairing.roomVersion,
    }),
  ).toMatchObject({ roomId: rooms[0], roomNeedsAssignment: false });
  expect(
    (await db.pairingTutee.findMany({ where: { pairingId: pairing.id } }))
      .map((row) => row.tuteeId)
      .sort(),
  ).toEqual([...learners].sort());
});

it("keeps fixed rooms fixed, rejects conflicting slot changes, and requires explicit release", async () => {
  const pairing = await create({
    roomMode: "FIXED",
    roomId: rooms[0],
    timeSlotId: otherSlotId,
  });
  await evidence(rooms[0]!, { dayOfWeek: 7 });
  await expect(
    update(pairing.id, { expectedRoomVersion: pairing.roomVersion }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    update(pairing.id, {
      roomMode: "AUTO",
      expectedRoomVersion: pairing.roomVersion,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    await update(pairing.id, {
      roomMode: "AUTO",
      releaseRoomToAuto: true,
      expectedRoomVersion: pairing.roomVersion,
    }),
  ).toMatchObject({ roomMode: "AUTO", roomId: rooms[1], roomOutcome: "MOVED" });
});

it("preserves intentional no physical room through tutor scheduling", async () => {
  const pairing = await create({ roomMode: "NONE" });
  expect(
    await actor("TUTOR").tutor.setPairingSlot({
      pairingId: pairing.id,
      slotId: otherSlotId,
      expectedRoomVersion: pairing.roomVersion,
    }),
  ).toMatchObject({
    roomMode: "NONE",
    roomId: null,
    roomNeedsAssignment: false,
    roomOutcome: "NONE",
  });
  expect(await shortages()).toHaveLength(0);
});

it("keeps a detached confirmed booking and protects it from a competing allocation", async () => {
  const pairing = await create();
  const detached = await actor("TUTOR").tutor.setPairingSlot({
    pairingId: pairing.id,
    slotId: null,
    expectedRoomVersion: pairing.roomVersion,
  });
  expect(detached).toMatchObject({
    timeSlotId: null,
    roomId: pairing.roomId,
    scheduleConfirmed: true,
    roomOutcome: "RETAINED",
  });
  expect(await create({ tutorId: otherTutorId })).toMatchObject({
    roomId: rooms[1],
  });
});

it("stages OFF and reenable until refresh, permits cancellation, and retains reservations", async () => {
  await actor("HEAD").program.setFeaturePending({
    key: "AUTO_ASSIGN_ROOMS",
    enabled: false,
  });
  const beforeRefresh = await create();
  expect(beforeRefresh.roomId).not.toBeNull();
  await actor("HEAD").program.setFeaturePending({
    key: "AUTO_ASSIGN_ROOMS",
    enabled: true,
  });
  expect(
    await db.programFeature.findUniqueOrThrow({
      where: { key: "AUTO_ASSIGN_ROOMS" },
    }),
  ).toMatchObject({ enabled: true, pendingEnabled: null });
  await actor("HEAD").program.setFeaturePending({
    key: "AUTO_ASSIGN_ROOMS",
    enabled: false,
  });
  await applyPendingFeatures(db);
  const disabled = await create({ timeSlotId: otherSlotId });
  expect(disabled).toMatchObject({
    roomId: null,
    roomNeedsAssignment: false,
    roomOutcome: "DISABLED",
  });
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: beforeRefresh.id } }),
  ).toMatchObject({ roomId: beforeRefresh.roomId });
  await expect(
    create({ roomMode: "FIXED", roomId: beforeRefresh.roomId! }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await actor("HEAD").program.setFeaturePending({
    key: "AUTO_ASSIGN_ROOMS",
    enabled: true,
  });
  expect((await create({ timeSlotId: otherSlotId })).roomOutcome).toBe(
    "DISABLED",
  );
  await applyPendingFeatures(db);
  expect((await create({ timeSlotId: otherSlotId })).roomId).not.toBeNull();
});

it("serializes two automatic saves for one remaining room into one booking and one shortage", async () => {
  await blockAll([rooms[0]!]);
  const results = await Promise.all([
    create(),
    create({ tutorId: otherTutorId }),
  ]);
  expect(results.filter((row) => row.roomId === rooms[0])).toHaveLength(1);
  expect(results.filter((row) => row.roomNeedsAssignment)).toHaveLength(1);
  expect(await shortages()).toHaveLength(2);
});

it("rejects stale edits without partial schedule, roster, or notification changes", async () => {
  const pairing = await create({ tuteeIds: learners });
  await update(pairing.id, {
    tuteeIds: learners,
    expectedRoomVersion: pairing.roomVersion,
  });
  const before = await db.pairing.findUniqueOrThrow({
    where: { id: pairing.id },
    include: { tutees: true },
  });
  await expect(
    update(pairing.id, {
      roomMode: "NONE",
      timeSlotId: otherSlotId,
      expectedRoomVersion: pairing.roomVersion,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.pairing.findUniqueOrThrow({
      where: { id: pairing.id },
      include: { tutees: true },
    }),
  ).toEqual(before);
  expect(await shortages()).toHaveLength(0);
});

it("resolves Coordinator AUTO intent at approval against newly occupied rooms", async () => {
  let approvalId: string | undefined;
  try {
    await actor("COORDINATOR").admin.createPairing({
      tutorId,
      subject,
      subjectId,
      timeSlotId: slotId,
      roomMode: "AUTO",
      tuteeIds: [],
    });
  } catch (error) {
    const cause = (error as { cause: unknown }).cause;
    expect(cause).toBeInstanceOf(ApprovalQueued);
    approvalId = (cause as ApprovalQueued).approvalId;
  }
  expect(approvalId).toBeTruthy();
  expect(await db.pairing.count()).toBe(0);
  await evidence(rooms[0]!, { dayOfWeek: 7 });
  await actor().approval.decide({
    id: approvalId!,
    approve: true,
    note: "Reviewed automatic intent",
  });
  expect(
    await db.pairing.findFirstOrThrow({ where: { tutorId } }),
  ).toMatchObject({ roomId: rooms[1], roomMode: "AUTO" });
});

it("rejects unauthorized allocation recovery and leaves every booking unchanged", async () => {
  await blockAll();
  const pairing = await create();
  await expect(
    actor("VIEWER").admin.retryRoomAllocation({
      id: pairing.id,
      expectedRoomVersion: pairing.roomVersion,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: pairing.id } }),
  ).toMatchObject({ roomVersion: pairing.roomVersion, roomId: null });
});

it("deduplicates verified historical learner aliases and recognizes retained tutor identity", async () => {
  await db.user.create({
    data: {
      id: "allocation-learner",
      email: "allocation-learner@example.test",
      role: "TUTOR",
      studentId: learners[0],
    },
  });
  await db.studentProfileOwnership.create({
    data: { tuteeId: learners[1]!, userId: "allocation-learner" },
  });
  const archivedTutor = await db.tutor.create({
    data: { englishName: "Renamed historical tutor", status: "ARCHIVED" },
  });
  await db.tutorProfileOwnership.create({
    data: { tutorId: archivedTutor.id, userId: "allocation-TUTOR" },
  });
  await evidence(rooms[0]!, { tuteeIds: learners });
  await evidence(rooms[1]!, { tutorId: archivedTutor.id });
  // Two retained learner profiles represent one vote; the equal tutor vote wins the tie.
  expect(await create({ tuteeIds: learners })).toMatchObject({
    roomId: rooms[1],
  });
});

it("room-only changes do not require renewed qualification or replace the roster", async () => {
  const pairing = await create({
    roomMode: "FIXED",
    roomId: rooms[0],
    tuteeIds: learners,
  });
  await db.tutorQualification.deleteMany({ where: { tutorId } });
  const changed = await actor().admin.setPairingRoom({
    id: pairing.id,
    roomMode: "NONE",
    expectedRoomVersion: pairing.roomVersion,
  });
  expect(changed).toMatchObject({
    roomId: null,
    roomMode: "NONE",
    roomNeedsAssignment: false,
  });
  expect(
    (await db.pairingTutee.findMany({ where: { pairingId: pairing.id } }))
      .map((row) => row.tuteeId)
      .sort(),
  ).toEqual([...learners].sort());
});

it("returns the final roster version and invalidates editors after a real roster change only", async () => {
  const pairing = await create({ tuteeIds: learners });
  expect(pairing.roomVersion).toBe(
    (await db.pairing.findUniqueOrThrow({ where: { id: pairing.id } }))
      .roomVersion,
  );
  const member = await db.pairingTutee.findFirstOrThrow({
    where: { pairingId: pairing.id },
  });
  await db.pairingTutee.update({
    where: {
      pairingId_tuteeId: { pairingId: pairing.id, tuteeId: member.tuteeId },
    },
    data: { tuteeId: member.tuteeId },
  });
  expect(
    (await db.pairing.findUniqueOrThrow({ where: { id: pairing.id } }))
      .roomVersion,
  ).toBe(pairing.roomVersion);
  await db.pairingTutee.delete({
    where: {
      pairingId_tuteeId: { pairingId: pairing.id, tuteeId: member.tuteeId },
    },
  });
  await expect(
    actor("TUTOR").tutor.setPairingSlot({
      pairingId: pairing.id,
      slotId: otherSlotId,
      expectedRoomVersion: pairing.roomVersion,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("catalog propagation reserves retained automatic rooms before reallocating displaced cohort members", async () => {
  const first = await create();
  const second = await create({ tutorId: otherTutorId });
  await create({
    tutorId: otherTutorId,
    roomMode: "FIXED",
    roomId: rooms[0],
    timeSlotId: otherSlotId,
  });
  await actor("HEAD").admin.updateTimeSlot({
    id: slotId,
    label: "Moved cohort",
    dayOfWeek: 1,
    startMin: 600,
    endMin: 660,
    active: true,
  });
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: first.id } }),
  ).toMatchObject({ roomId: rooms[2], dayOfWeek: 1 });
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: second.id } }),
  ).toMatchObject({ roomId: rooms[1], dayOfWeek: 1 });
});

it("a fixed-room catalog conflict rolls back the entire cohort and slot", async () => {
  const fixed = await create({ roomMode: "FIXED", roomId: rooms[0] });
  const automatic = await create({ tutorId: otherTutorId });
  await create({
    roomMode: "FIXED",
    roomId: rooms[0],
    timeSlotId: otherSlotId,
  });
  const before = await db.pairing.findMany({
    where: { id: { in: [fixed.id, automatic.id] } },
    orderBy: { id: "asc" },
  });
  await expect(
    actor("HEAD").admin.updateTimeSlot({
      id: slotId,
      label: "Invalid move",
      dayOfWeek: 1,
      startMin: 600,
      endMin: 660,
      active: true,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.pairing.findMany({
      where: { id: { in: [fixed.id, automatic.id] } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(before);
  expect(
    await db.timeSlot.findUniqueOrThrow({ where: { id: slotId } }),
  ).toMatchObject({ dayOfWeek: 7, label: "Sunday primary" });
});

it("a late failure rolls back allocation, roster, and shortage notifications together", async () => {
  await blockAll();
  await expect(
    db.$transaction(async (tx) => {
      const allocation = await allocateRoom(
        tx,
        {
          termId,
          tutorId,
          tuteeIds: learners,
          dayOfWeek: 7,
          startMin: 600,
          endMin: 660,
          scheduleConfirmed: true,
        },
        { roomMode: "AUTO" },
      );
      const pairing = await tx.pairing.create({
        data: {
          termId,
          tutorId,
          subject,
          dayOfWeek: 7,
          startMin: 600,
          endMin: 660,
          scheduleConfirmed: true,
          ...allocationData(allocation),
          tutees: { create: learners.map((tuteeId) => ({ tuteeId })) },
        },
      });
      await notifyRoomShortage(tx, pairing.id, allocation);
      throw new Error("Injected failure after notification rows");
    }),
  ).rejects.toThrow("Injected failure after notification rows");
  expect(await db.pairing.count()).toBe(0);
  expect(await db.pairingTutee.count()).toBe(0);
  expect(await shortages()).toHaveLength(0);
});

it("concurrent edits to one snapshot commit once and reject the stale contender", async () => {
  const pairing = await create();
  const results = await Promise.allSettled([
    actor().admin.setPairingRoom({
      id: pairing.id,
      roomMode: "NONE",
      expectedRoomVersion: pairing.roomVersion,
    }),
    actor().admin.setPairingRoom({
      id: pairing.id,
      roomMode: "FIXED",
      roomId: rooms[1],
      expectedRoomVersion: pairing.roomVersion,
    }),
  ]);
  expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  expect(results.find((row) => row.status === "rejected")).toMatchObject({
    reason: { code: "CONFLICT" },
  });
  expect(
    (await db.pairing.findUniqueOrThrow({ where: { id: pairing.id } }))
      .roomVersion,
  ).toBe(pairing.roomVersion + 1);
});

it("room deletion rejects planned reservations and preserves separately reported actual-room evidence", async () => {
  const pairing = await create({ roomMode: "FIXED", roomId: rooms[0] });
  await expect(
    actor().admin.deleteRoom({ id: rooms[0]! }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const session = await db.session.create({
    data: {
      pairingId: pairing.id,
      tutorId,
      date: new Date("2026-10-12T00:00:00Z"),
      startMin: 600,
      endMin: 660,
      actualRoomId: rooms[1],
      month: "2026-10",
      schoolYear: "26-27",
      quarter: "Q1",
      durationMin: 60,
      shFactor: 1,
      shCount: 1,
    },
  });
  await expect(
    actor().admin.deleteRoom({ id: rooms[1]! }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    await db.session.findUniqueOrThrow({ where: { id: session.id } }),
  ).toMatchObject({ actualRoomId: rooms[1] });
  expect(await db.room.count()).toBe(3);
});

it.each(["submission", "correction", "approved deletion"] as const)(
  "room deletion preserves actual-room evidence committed by a concurrent %s",
  async (scenario) => {
    const pairing = await create({ roomMode: "NONE" });
    const roomId = rooms[1]!;
    const data = {
      pairingId: pairing.id,
      tutorId,
      date: new Date("2026-10-12T00:00:00Z"),
      startMin: 600,
      endMin: 660,
      month: "2026-10",
      schoolYear: "26-27",
      quarter: "Q1" as const,
      durationMin: 60,
      shFactor: 1,
      shCount: 1,
    };
    const existing = scenario === "correction"
      ? await db.session.create({ data: { ...data, actualRoomId: rooms[0] } })
      : null;
    let approvalId: string | undefined;
    if (scenario === "approved deletion") {
      try {
        await actor("COORDINATOR").admin.deleteRoom({ id: roomId });
      } catch (error) {
        const cause = (error as { cause: unknown }).cause;
        expect(cause).toBeInstanceOf(ApprovalQueued);
        approvalId = (cause as ApprovalQueued).approvalId;
      }
      expect(approvalId).toBeDefined();
    }

    let releaseWriter!: () => void;
    let signalWriter!: (pid: number) => void;
    const release = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const ready = new Promise<number>((resolve) => { signalWriter = resolve; });
    const writer = db.$transaction(async (tx) => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const session = existing
        ? await tx.session.update({ where: { id: existing.id }, data: { actualRoomId: roomId } })
        : await tx.session.create({ data: { ...data, actualRoomId: roomId } });
      // Inserting/updating the real FK holds Room key-share until this barrier opens.
      signalWriter(backend!.pid);
      await release;
      return session;
    }, { timeout: 15000 });
    const writerPid = await Promise.race([
      ready,
      writer.then(() => { throw new Error("Writer ended before its barrier"); }),
    ]);
    const deleting = approvalId
      ? actor("HEAD").approval.decide({ id: approvalId, approve: true, note: "Concurrent room deletion" })
      : actor().admin.deleteRoom({ id: roomId });
    const settled = Promise.allSettled([writer, deleting]);
    try {
      // Observe a real database lock wait rather than assume timing from a sleep.
      // Without the pre-count row lock, DELETE waits here only after stale counts.
      await vi.waitUntil(async () => {
        const [row] = await db.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE ${writerPid} = ANY(pg_blocking_pids(pid))
          ) AS waiting`;
        return row?.waiting;
      }, { timeout: 5000, interval: 10 });
    } finally {
      releaseWriter();
      await settled;
    }
    const [written, deleted] = await settled;
    expect(written.status).toBe("fulfilled");
    // Serializable approval replay may reject the changed snapshot instead of
    // reporting BAD_REQUEST; either path must retain the committed evidence.
    expect(deleted.status).toBe("rejected");
    if (!approvalId) expect(deleted).toMatchObject({ reason: { code: "BAD_REQUEST" } });
    expect(await db.room.findUnique({ where: { id: roomId } })).not.toBeNull();
    expect(await db.session.findMany()).toMatchObject([{ actualRoomId: roomId }]);
    if (approvalId) {
      expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } }))
        .toMatchObject({ state: "PENDING" });
    }
  },
  20000,
);

it("rejects a concurrent actual-room write after room deletion wins the row lock", async () => {
  const pairing = await create({ roomMode: "NONE" });
  const roomId = rooms[1]!;
  let releaseDelete!: () => void;
  let signalDelete!: (pid: number) => void;
  const release = new Promise<void>((resolve) => { releaseDelete = resolve; });
  const ready = new Promise<number>((resolve) => { signalDelete = resolve; });
  // Scope the real endpoint into an outer transaction only to hold its commit
  // boundary open while the competing FK writer reaches the database lock.
  const deleting = db.$transaction(async (tx) => {
    const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    const deleted = await databaseScope.run(tx, () => actor().admin.deleteRoom({ id: roomId }));
    signalDelete(backend!.pid);
    await release;
    return deleted;
  }, { timeout: 15000 });
  const deletionPid = await Promise.race([
    ready,
    deleting.then(() => { throw new Error("Deletion ended before its barrier"); }),
  ]);
  const writing = db.session.create({
    data: {
      pairingId: pairing.id,
      tutorId,
      date: new Date("2026-10-12T00:00:00Z"),
      startMin: 600,
      endMin: 660,
      actualRoomId: roomId,
      month: "2026-10",
      schoolYear: "26-27",
      quarter: "Q1",
      durationMin: 60,
      shFactor: 1,
      shCount: 1,
    },
  });
  const settled = Promise.allSettled([deleting, writing]);
  try {
    await vi.waitUntil(async () => {
      const [row] = await db.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE ${deletionPid} = ANY(pg_blocking_pids(pid))
        ) AS waiting`;
      return row?.waiting;
    }, { timeout: 5000, interval: 10 });
  } finally {
    releaseDelete();
    await settled;
  }
  const [deleted, written] = await settled;
  expect(deleted.status).toBe("fulfilled");
  expect(written).toMatchObject({ status: "rejected", reason: { code: "P2003" } });
  expect(await db.room.findUnique({ where: { id: roomId } })).toBeNull();
  expect(await db.session.count()).toBe(0);
});

it("replays the same committed creation without another allocation or shortage notice", async () => {
  await blockAll();
  const clientKey = randomUUID();
  const first = await create({ clientKey, tuteeIds: learners });
  // Lost responses must remain recoverable even after qualification was subsequently revoked.
  await db.tutorQualification.deleteMany({ where: { tutorId } });
  const retry = await create({ clientKey, tuteeIds: [...learners].reverse() });
  expect(retry.id).toBe(first.id);
  expect(await db.pairing.count()).toBe(1);
  expect(await shortages()).toHaveLength(2);
});

it("rejects changed committed payloads and deleted creation retries", async () => {
  const clientKey = randomUUID();
  const first = await create({ clientKey });
  await expect(
    create({ clientKey, timeSlotId: otherSlotId }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await actor().admin.deletePairing({ id: first.id });
  await expect(create({ clientKey })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await db.pairing.count()).toBe(0);
  expect(await db.pairingCreationRequest.count()).toBe(1);
});

it("serializes simultaneous creation retries into a single pairing receipt", async () => {
  const clientKey = randomUUID();
  const rows = await Promise.all([
    create({ clientKey }),
    create({ clientKey }),
  ]);
  expect(rows[0].id).toBe(rows[1].id);
  expect(await db.pairing.count()).toBe(1);
  expect(await db.pairingCreationRequest.count()).toBe(1);
});

it("scopes approved creation replay to its original Coordinator across different reviewers", async () => {
  const clientKey = randomUUID();
  const input = {
    tutorId,
    subject,
    subjectId,
    timeSlotId: slotId,
    roomMode: "AUTO" as const,
    tuteeIds: [],
    clientKey,
  };
  async function queue() {
    try {
      await actor("COORDINATOR").admin.createPairing(input);
    } catch (error) {
      const cause = (error as { cause: unknown }).cause;
      expect(cause).toBeInstanceOf(ApprovalQueued);
      return (cause as ApprovalQueued).approvalId;
    }
    throw new Error("Expected Coordinator approval proposal");
  }
  const first = await queue();
  await actor().approval.decide({
    id: first,
    approve: true,
    note: "Approved original intent",
  });
  const retry = await queue();
  await actor("HEAD").approval.decide({
    id: retry,
    approve: true,
    note: "Recover original request",
  });
  expect(await db.pairing.count()).toBe(1);
  expect(await db.pairingCreationRequest.findFirstOrThrow()).toMatchObject({
    actorId: "allocation-COORDINATOR",
    clientKey,
  });
});

it("keeps shortage delivery in-app even for opted-in email recipients, without disabling ordinary mail", async () => {
  await db.programSettings.create({
    data: { id: "program", emailNotificationsEnabled: true },
  });
  await db.user.updateMany({
    where: { role: { in: ["HEAD", "ADMIN"] } },
    data: { emailInfo: true },
  });
  await db.accountEmail.updateMany({
    where: { userId: { in: ["allocation-HEAD", "allocation-ADMIN"] } },
    data: { verifiedAt: new Date() },
  });
  await db.notification.create({
    data: {
      userId: "allocation-ADMIN",
      title: "Ordinary program update",
      link: "/admin/pairings",
    },
  });
  expect(await db.emailDelivery.count()).toBe(1);
  await blockAll();
  await create();
  expect(await shortages()).toHaveLength(2);
  expect((await shortages()).every((row) => row.inAppOnly)).toBe(true);
  expect(await db.emailDelivery.count()).toBe(1);
  expect(
    await db.programSettings.findUniqueOrThrow({ where: { id: "program" } }),
  ).toMatchObject({ emailNotificationsEnabled: true });
});

it("keeps disabled cohort shortage evidence current without reallocating or repeating unchanged notices", async () => {
  await blockAll();
  const pairing = await create();
  await db.programFeature.create({
    data: { key: "AUTO_ASSIGN_ROOMS", enabled: false },
  });
  const change = {
    id: slotId,
    label: "Adjusted Sunday",
    dayOfWeek: 7,
    startMin: 610,
    endMin: 670,
    active: true,
  };
  await actor().admin.updateTimeSlot(change);
  const updated = await db.pairing.findUniqueOrThrow({
    where: { id: pairing.id },
  });
  expect(updated).toMatchObject({
    roomId: null,
    roomNeedsAssignment: true,
    startMin: 610,
    endMin: 670,
  });
  expect(updated.roomShortageKey).not.toBe(pairing.roomShortageKey);
  expect(await shortages()).toHaveLength(4);
  await actor().admin.updateTimeSlot(change);
  expect(await shortages()).toHaveLength(4);
});

it("updates historical cohort shortage evidence without issuing a new current-period alert", async () => {
  await blockAll();
  const pairing = await create();
  await db.term.update({ where: { id: termId }, data: { active: false } });
  await db.term.create({
    data: {
      name: "Next period",
      schoolYear: "26-27",
      quarter: "Q2",
      active: true,
    },
  });
  await actor().admin.updateTimeSlot({
    id: slotId,
    label: "Adjusted Sunday",
    dayOfWeek: 7,
    startMin: 610,
    endMin: 670,
    active: true,
  });
  const updated = await db.pairing.findUniqueOrThrow({
    where: { id: pairing.id },
  });
  expect(updated).toMatchObject({ roomId: null, roomNeedsAssignment: true });
  expect(updated.roomShortageKey).not.toBe(pairing.roomShortageKey);
  expect(await shortages()).toHaveLength(2);
});
