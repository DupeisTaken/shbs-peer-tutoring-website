import { releasePairingsInOrder } from "~/server/ordered-pairing-release";
import type { Session } from "next-auth";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { databaseScope } from "~/server/db-scope";
import { ApprovalQueued } from "~/server/approvals";
import { applyPendingFeatures } from "~/server/program/features";
import * as roomAllocationOperations from "~/server/room-allocation";
import {
  allocateRoom,
  allocationData,
  notifyRoomShortage,
} from "~/server/room-allocation";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

// These fixtures reset a dedicated, local integration database before each case.
// Guard during module evaluation so even teardown cannot reach another database.
assertIsolatedTestDatabase(process.env.DATABASE_URL);
// The shared guard permits only explicit loopback *_test namespaces, including
// this review's exclusively created database; never inherit the synthetic demo.

let termId: string;
let tutorId: string;
let otherTutorId: string;
let thirdTutorId: string;
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
  thirdTutorId = (await db.tutor.create({ data: { englishName: "Independent blocker tutor", status: "ACTIVE" } })).id;
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
  for (const id of [tutorId, otherTutorId, thirdTutorId])
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

async function combineRoomUnit(ids: string[], selectedSlot = slotId) {
  const state = await actor("TUTOR").pairingGroups.mine();
  return actor("TUTOR").pairingGroups.save({ snapshot: state.snapshot,
    groups: [{ id: state.groups[0]?.id, pairingIds: ids, slotId: selectedSlot }] });
}
const unitRows = (ids: string[]) => db.pairing.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });

const bulkTargets = (rows: { id: string; roomVersion: number }[]) => ({
  targets: rows.map((row) => ({ id: row.id, expectedRoomVersion: row.roomVersion })),
});
async function roomless(mode: "AUTO" | "LEGACY" = "AUTO") {
  // Bulk room capacity uses independent tutors; one tutor cannot reserve two
  // independent lessons at the same time merely because both need a room.
  const independentTutor = await db.tutor.create({ data: { englishName: "Bulk room fixture tutor", status: "ACTIVE" } });
  return db.pairing.create({ data: {
    termId, tutorId: independentTutor.id, subject, timeSlotId: slotId, roomMode: mode,
    scheduleConfirmed: true, dayOfWeek: 7, startMin: 600, endMin: 660,
    tutees: { create: learners.map((tuteeId) => ({ tuteeId })) },
  } });
}

it("bulk room allocation includes legacy and non-shortage automatic rows without moving reservations", async () => {
  const reserved = await create({ roomMode: "FIXED", roomId: rooms[0] });
  const reservedBefore = await db.pairing.findUniqueOrThrow({ where: { id: reserved.id } });
  const automatic = await roomless();
  const legacy = await roomless("LEGACY");
  const beforeRoster = await db.pairingTutee.findMany({ orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }] });
  expect(await actor().admin.autoAssignUnassignedRooms(bulkTargets([automatic, legacy])))
    .toEqual({ assigned: 2, unassigned: 0, total: 2 });
  const rows = await unitRows([automatic.id, legacy.id]);
  expect(rows.every((row) => row.roomMode === "AUTO" && row.roomId && row.roomId !== rooms[0])).toBe(true);
  expect(new Set(rows.map((row) => row.roomId)).size).toBe(2);
  expect(await db.pairing.findUniqueOrThrow({ where: { id: reserved.id } })).toEqual(reservedBefore);
  expect(await db.pairingTutee.findMany({ orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }] })).toEqual(beforeRoster);
});

it("bulk room allocation counts shared groups once and requires all reviewed siblings", async () => {
  await blockAll();
  const first = await create({ tuteeIds: learners });
  const second = await create({ tuteeIds: learners, timeSlotId: otherSlotId });
  await combineRoomUnit([first.id, second.id]);
  const rows = await unitRows([first.id, second.id]);
  await expect(actor().admin.autoAssignUnassignedRooms(bulkTargets([rows[0]!]))).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await unitRows([first.id, second.id])).toEqual(rows);
  await db.roomUnavailability.deleteMany({ where: { roomId: rooms[0] } });
  expect(await actor().admin.autoAssignUnassignedRooms(bulkTargets(rows)))
    .toEqual({ assigned: 1, unassigned: 0, total: 1 });
  expect((await unitRows([first.id, second.id])).every((row) => row.roomId === rooms[0] && row.groupId === rows[0]!.groupId)).toBe(true);
});

it("bulk room allocation validates every version before any reservation is written", async () => {
  const first = await roomless();
  const second = await roomless("LEGACY");
  const before = await unitRows([first.id, second.id]);
  await expect(actor().admin.autoAssignUnassignedRooms(bulkTargets([first, { ...second, roomVersion: second.roomVersion + 1 }]))).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await unitRows([first.id, second.id])).toEqual(before);
  expect(await shortages()).toHaveLength(0);
});

it("bulk room allocation rolls back earlier reservations if a later allocation fails", async () => {
  const first = await roomless();
  const second = await roomless("LEGACY");
  const before = await unitRows([first.id, second.id]);
  const allocate = roomAllocationOperations.allocateAndPersistRoomUnit;
  const spy = vi.spyOn(roomAllocationOperations, "allocateAndPersistRoomUnit")
    .mockImplementationOnce(allocate)
    .mockRejectedValueOnce(new Error("Injected later allocation failure"));
  try {
    await expect(actor().admin.autoAssignUnassignedRooms(bulkTargets(before)))
      .rejects.toThrow("Injected later allocation failure");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await unitRows([first.id, second.id])).toEqual(before);
    expect(await shortages()).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

it.each(["NONE", "AWAITING", "FIXED", "RESERVED", "HISTORICAL"])(
  "bulk room allocation rejects reviewed %s records without changing eligible siblings",
  async (kind) => {
    const first = await roomless();
    const excluded = await roomless();
    if (kind === "HISTORICAL") {
      const past = await db.term.create({ data: { name: "Previous", schoolYear: "25-26", quarter: "Q4", active: false } });
      await db.pairing.update({ where: { id: excluded.id }, data: { termId: past.id } });
    } else {
      await db.pairing.update({ where: { id: excluded.id }, data:
        kind === "NONE" ? { roomMode: "NONE" } :
        kind === "AWAITING" ? { scheduleConfirmed: false } :
        kind === "FIXED" ? { roomMode: "FIXED", roomId: rooms[0] } :
        { roomId: rooms[0] },
      });
    }
    const before = await unitRows([first.id, excluded.id]);
    await expect(actor().admin.autoAssignUnassignedRooms(bulkTargets(before))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await unitRows([first.id, excluded.id])).toEqual(before);
  },
);

it("bulk room allocation reports remaining shortages and suppresses duplicate notices", async () => {
  await blockAll(rooms.slice(0, 1));
  const first = await roomless();
  const second = await roomless("LEGACY");
  expect(await actor().admin.autoAssignUnassignedRooms(bulkTargets([first, second])))
    .toEqual({ assigned: 1, unassigned: 1, total: 2 });
  const shortage = await db.pairing.findFirstOrThrow({ where: { roomNeedsAssignment: true } });
  expect(await shortages()).toHaveLength(2);
  expect(await actor().admin.autoAssignUnassignedRooms(bulkTargets([shortage])))
    .toEqual({ assigned: 0, unassigned: 1, total: 1 });
  expect(await shortages()).toHaveLength(2);
});

it("bulk room allocation rejects disabled automation and unauthorized viewers without writes", async () => {
  const row = await roomless("LEGACY");
  await expect(actor("VIEWER").admin.autoAssignUnassignedRooms(bulkTargets([row]))).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.programFeature.create({ data: { key: "AUTO_ASSIGN_ROOMS", enabled: false } });
  await expect(actor().admin.autoAssignUnassignedRooms(bulkTargets([row]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.pairing.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
});

it("bulk room allocation queues one coordinator review and chooses rooms at approval time", async () => {
  const first = await roomless();
  const second = await roomless("LEGACY");
  await expect(actor("COORDINATOR").admin.autoAssignUnassignedRooms(bulkTargets([first, second]))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const request = await db.approvalRequest.findFirstOrThrow({ where: { operation: "admin.autoAssignUnassignedRooms" } });
  expect(await db.approvalRequest.count()).toBe(1);
  expect((await unitRows([first.id, second.id])).every((row) => row.roomId === null)).toBe(true);
  await evidence(rooms[0]!, { dayOfWeek: 7 });
  await actor().approval.decide({ id: request.id, approve: true, note: "Reviewed bulk automatic allocation" });
  expect((await unitRows([first.id, second.id])).every((row) => row.roomId && row.roomId !== rooms[0])).toBe(true);
});

it("bulk room approval captures group primary and rejects primary drift", async () => {
  await blockAll();
  const first = await create({ tuteeIds: learners });
  const second = await create({ tuteeIds: learners, timeSlotId: otherSlotId });
  await combineRoomUnit([first.id, second.id]);
  const rows = await unitRows([first.id, second.id]);
  await expect(actor("COORDINATOR").admin.autoAssignUnassignedRooms(bulkTargets(rows))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const request = await db.approvalRequest.findFirstOrThrow({ where: { operation: "admin.autoAssignUnassignedRooms" } });
  expect(request.targets).toHaveProperty("PairingGroup");
  const group = await db.pairingGroup.findUniqueOrThrow({ where: { id: rows[0]!.groupId! } });
  await db.pairingGroup.update({ where: { id: group.id }, data: { primaryPairingId: rows.find((row) => row.id !== group.primaryPairingId)!.id } });
  const before = await unitRows([first.id, second.id]);
  await expect(actor().approval.decide({ id: request.id, approve: true, note: "Stale group primary" })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await unitRows([first.id, second.id])).toEqual(before);
});

it("bulk room allocation rejects duplicate IDs and serializes simultaneous retries", async () => {
  const row = await roomless();
  await expect(actor().admin.autoAssignUnassignedRooms(bulkTargets([row, row]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(actor().admin.autoAssignUnassignedRooms({ targets: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(actor().admin.autoAssignUnassignedRooms(bulkTargets(Array.from({ length: 501 }, (_, index) => ({ ...row, id: `bounded-${index}` }))))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(actor().admin.autoAssignUnassignedRooms(bulkTargets([{ ...row, id: "x".repeat(129) }]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const results = await Promise.allSettled([
    actor().admin.autoAssignUnassignedRooms(bulkTargets([row])),
    actor().admin.autoAssignUnassignedRooms(bulkTargets([row])),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  // A caller that lost the accepted response cannot replay this reviewed batch.
  await expect(actor().admin.autoAssignUnassignedRooms(bulkTargets([row]))).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await db.pairing.findUniqueOrThrow({ where: { id: row.id } })).roomVersion).toBe(row.roomVersion + 1);
});

it("explicitly combines one reservation, atomically changes its slot, and keeps unrelated entries separate", async () => {
  const first = await create({ tuteeIds: learners });
  const second = await create({ tuteeIds: [learners[0]!], timeSlotId: otherSlotId });
  await combineRoomUnit([first.id, second.id]);
  const rows = await unitRows([first.id, second.id]);
  expect(new Set(rows.map(row => row.groupId)).size).toBe(1);
  expect(rows.every(row => row.roomMode === "AUTO" && row.roomId === first.roomId)).toBe(true);
  const independent = await create({ tutorId: otherTutorId });
  expect(independent.roomId).not.toBe(first.roomId);
  const current = rows.find(row => row.id === second.id)!;
  await actor("TUTOR").tutor.setPairingSlot({ pairingId: second.id, slotId: otherSlotId, expectedRoomVersion: current.roomVersion });
  expect((await unitRows([first.id, second.id])).every(row => row.timeSlotId === otherSlotId && row.roomId === first.roomId && row.groupId === current.groupId)).toBe(true);
  await actor("HEAD").admin.updateTimeSlot({ id: otherSlotId, label: "Shared Monday", dayOfWeek: 1, startMin: 720, endMin: 780, active: true });
  expect((await unitRows([first.id, second.id])).every(row => row.startMin === 720 && row.groupId === current.groupId && row.roomId === first.roomId)).toBe(true);
  await actor("TUTOR").tutor.setPairingSlot({ pairingId: first.id, slotId: null });
  expect((await unitRows([first.id, second.id])).every(row => row.timeSlotId === null && row.scheduleConfirmed && row.roomId === first.roomId)).toBe(true);
  expect(await db.session.count()).toBe(0);
});

it("shares fixed and intentional no-room choices from any member and accepts an existing opaque room ID", async () => {
  const first = await create({ tuteeIds: learners, roomMode: "FIXED", roomId: rooms[0] });
  const second = await create({ tuteeIds: learners, timeSlotId: otherSlotId });
  await combineRoomUnit([first.id, second.id]);
  let current = await db.pairing.findUniqueOrThrow({ where: { id: second.id } });
  await actor().admin.setPairingRoom({ id: second.id, roomMode: "NONE", expectedRoomVersion: current.roomVersion });
  expect((await unitRows([first.id, second.id])).every(row => row.roomMode === "NONE" && row.roomId === null && !!row.groupId)).toBe(true);
  await actor("TUTOR").tutor.setPairingSlot({ pairingId: first.id, slotId: otherSlotId });
  expect((await unitRows([first.id, second.id])).every(row => row.roomMode === "NONE" && row.roomId === null)).toBe(true);
  await db.room.create({ data: { id: "legacy-room-uuid", name: "Existing imported room" } });
  current = await db.pairing.findUniqueOrThrow({ where: { id: second.id } });
  await actor().admin.setPairingRoom({ id: second.id, roomMode: "FIXED", roomId: "legacy-room-uuid", expectedRoomVersion: current.roomVersion });
  expect((await unitRows([first.id, second.id])).every(row => row.roomMode === "FIXED" && row.roomId === "legacy-room-uuid")).toBe(true);
  const before = await unitRows([first.id, second.id]);
  await db.roomUnavailability.create({ data: { roomId: "legacy-room-uuid", dayOfWeek: 7, startMin: 600, endMin: 660 } });
  await expect(actor("TUTOR").tutor.setPairingSlot({ pairingId: first.id, slotId })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await unitRows([first.id, second.id])).toEqual(before);
});

it("deduplicates group shortage effects and explicitly retries the complete unit", async () => {
  await blockAll();
  const first = await create({ tuteeIds: [learners[0]!] });
  const second = await create({ tuteeIds: [learners[1]!], timeSlotId: otherSlotId });
  const initialNotices = await shortages();
  await combineRoomUnit([first.id, second.id]);
  let rows = await unitRows([first.id, second.id]);
  expect(rows.every(row => row.roomNeedsAssignment && row.roomMode === "AUTO" && row.roomId === null)).toBe(true);
  expect(new Set(rows.map(row => row.roomShortageKey)).size).toBe(1);
  expect(await shortages()).toHaveLength(initialNotices.length + 2); // One per Head/Admin, not per subject.
  let current = rows.find(row => row.id === second.id)!;
  await actor().admin.retryRoomAllocation({ id: second.id, expectedRoomVersion: current.roomVersion });
  expect(await shortages()).toHaveLength(initialNotices.length + 2);
  await db.roomUnavailability.deleteMany({ where: { roomId: rooms[0] } });
  current = await db.pairing.findUniqueOrThrow({ where: { id: second.id } });
  await actor().admin.retryRoomAllocation({ id: second.id, expectedRoomVersion: current.roomVersion });
  rows = await unitRows([first.id, second.id]);
  expect(rows.every(row => row.roomId === rooms[0] && !row.roomNeedsAssignment && row.roomShortageKey === null && !!row.groupId)).toBe(true);
});

it("invalidates sibling room editors on roster, membership and member deletion", async () => {
  const first = await create({ tuteeIds: learners });
  const second = await create({ tuteeIds: learners, timeSlotId: otherSlotId });
  await combineRoomUnit([first.id, second.id]);
  const current = await db.pairing.findUniqueOrThrow({ where: { id: first.id } });
  await db.pairingTutee.delete({ where: { pairingId_tuteeId: { pairingId: second.id, tuteeId: learners[0]! } } });
  await expect(actor().admin.setPairingRoom({ id: first.id, roomMode: "NONE", expectedRoomVersion: current.roomVersion })).rejects.toMatchObject({ code: "CONFLICT" });
  const beforeDetach = await db.pairing.findUniqueOrThrow({ where: { id: first.id } });
  // Independent detachment must release the shared reservation, not create a
  // second standalone booking in its siblings' occupied room.
  await db.pairing.update({ where: { id: second.id }, data: { groupId: null, roomMode: "NONE", roomId: null } });
  expect((await db.pairing.findUniqueOrThrow({ where: { id: first.id } })).roomVersion).toBeGreaterThan(beforeDetach.roomVersion);
  await combineRoomUnit([first.id, second.id]);
  const beforeDelete = await db.pairing.findUniqueOrThrow({ where: { id: first.id } });
  await db.pairing.delete({ where: { id: second.id } });
  expect((await db.pairing.findUniqueOrThrow({ where: { id: first.id } })).roomVersion).toBeGreaterThan(beforeDelete.roomVersion);
});

it("preserves shared manual reservations while automation is off and splits without shortage constraint failures", async () => {
  const first = await create({ tuteeIds: learners });
  const second = await create({ tuteeIds: learners, timeSlotId: otherSlotId });
  await db.programFeature.create({ data: { key: "AUTO_ASSIGN_ROOMS", enabled: false } });
  const grouped = await combineRoomUnit([first.id, second.id]);
  expect((await unitRows([first.id, second.id])).every(row => row.roomId === first.roomId && row.roomMode === "AUTO")).toBe(true);
  await actor("TUTOR").pairingGroups.save({ snapshot: grouped.snapshot, groups: [] });
  expect((await unitRows([first.id, second.id])).every(row => !row.scheduleConfirmed && !row.roomNeedsAssignment && row.groupId === null)).toBe(true);
  await db.pairing.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { roomId: null } });
  await db.programFeature.update({ where: { key: "AUTO_ASSIGN_ROOMS" }, data: { enabled: true } });
  await blockAll();
  const shortage = await combineRoomUnit([first.id, second.id]);
  await actor("TUTOR").pairingGroups.save({ snapshot: shortage.snapshot, groups: [] });
  expect((await unitRows([first.id, second.id])).every(row => !row.scheduleConfirmed && !row.roomNeedsAssignment && row.roomShortageKey === null)).toBe(true);
});

it("serializes competing member room saves and retains a subject edit in its group", async () => {
  const first = await create({ tuteeIds: learners });
  const second = await create({ tuteeIds: learners, timeSlotId: otherSlotId });
  await combineRoomUnit([first.id, second.id]);
  let current = await db.pairing.findUniqueOrThrow({ where: { id: first.id } });
  await update(first.id, { tuteeIds: learners, expectedRoomVersion: current.roomVersion, roomMode: "AUTO" });
  const before = await unitRows([first.id, second.id]);
  expect(new Set(before.map(row => row.groupId)).size).toBe(1);
  expect(before.every(row => !!row.groupId && row.roomId === first.roomId)).toBe(true);
  current = before.find(row => row.id === first.id)!;
  const sibling = before.find(row => row.id === second.id)!;
  const results = await Promise.allSettled([
    actor().admin.setPairingRoom({ id: first.id, roomMode: "NONE", expectedRoomVersion: current.roomVersion }),
    actor().admin.setPairingRoom({ id: second.id, roomMode: "FIXED", roomId: rooms[2], expectedRoomVersion: sibling.roomVersion }),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  const after = await unitRows([first.id, second.id]);
  expect(new Set(after.map(row => row.roomId)).size).toBe(1);
  expect(new Set(after.map(row => row.roomMode)).size).toBe(1);
});

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
      tutorId: otherTutorId,
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
  expect((await create({ timeSlotId: otherSlotId, tutorId: otherTutorId })).roomOutcome).toBe(
    "DISABLED",
  );
  await applyPendingFeatures(db);
  expect((await create({ timeSlotId: adjacentId })).roomId).not.toBeNull();
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
    tutorId: thirdTutorId,
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

it.each(["forward", "reverse"] as const)(
  "keeps audited catalog detach/restore and recovery row order stable with %s heap insertion",
  async (insertionOrder) => {
    const ids = {
      autoA: "catalog-order-auto-a", autoZ: "catalog-order-auto-z",
      secondary: "catalog-order-fixed-a", primary: "catalog-order-fixed-z",
    };
    // The explicit primary deliberately sorts after its sibling. Both members
    // must remain independently visible in audit and recovery record keys.
    const group = await db.pairingGroup.create({ data: {
      id: "catalog-order-fixed-group", tutorId: thirdTutorId, termId, primaryPairingId: ids.primary,
    } });
    const rows = [
      { id: ids.autoA, tutorId, subject, roomId: rooms[0]!, roomMode: "AUTO" as const, groupId: null },
      { id: ids.autoZ, tutorId: otherTutorId, subject, roomId: rooms[1]!, roomMode: "AUTO" as const, groupId: null },
      { id: ids.secondary, tutorId: thirdTutorId, subject: "Fixed Science", roomId: rooms[2]!, roomMode: "FIXED" as const, groupId: group.id },
      { id: ids.primary, tutorId: thirdTutorId, subject: "Fixed Mathematics", roomId: rooms[2]!, roomMode: "FIXED" as const, groupId: group.id },
    ];
    for (const row of insertionOrder === "forward" ? rows : [...rows].reverse()) {
      await db.pairing.create({ data: {
        ...row, termId, timeSlotId: slotId, dayOfWeek: 7, startMin: 600, endMin: 660, scheduleConfirmed: true,
        tutees: { create: row.groupId ? learners.map((tuteeId) => ({ tuteeId })) : [] },
      } });
    }
    const before = await unitRows(Object.values(ids));
    const roster = await db.pairingTutee.findMany({ orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }] });
    const count = async () => ({
      pairings: await db.pairing.count(), groups: await db.pairingGroup.count(),
      sessions: await db.session.count(), notifications: await db.notification.count(),
      notices: await db.sessionNotice.count(), email: await db.emailDelivery.count(),
    });
    const counts = await count();
    const rootId = "catalog-order-recovery-root";
    await db.recoveryAction.create({ data: {
      id: rootId, kind: "INITIAL_ADMISSION", applicationId: "catalog-order-synthetic-admission", before: {},
    } });
    await db.recoveryTrackedEntity.createMany({ data: Object.values(ids).map((recordId) => ({
      actionId: rootId, entity: "Pairing", recordId,
    })) });

    const result = await actor("HEAD").admin.updateTimeSlot({
      id: slotId, label: "Ordered catalog propagation", dayOfWeek: 6, startMin: 600, endMin: 660, active: true,
    });
    expect(result).toMatchObject({ updatedPairings: 4, updatedSessions: 0, dayOfWeek: 6 });
    const restored = await unitRows(Object.values(ids));
    for (const row of restored) {
      const prior = before.find((entry) => entry.id === row.id)!;
      expect(row).toMatchObject({
        groupId: prior.groupId, roomId: prior.roomId, roomMode: prior.roomMode,
        scheduleConfirmed: true, roomNeedsAssignment: false, roomShortageKey: null,
        timeSlotId: slotId, dayOfWeek: 6, startMin: 600, endMin: 660,
        roomVersion: prior.roomVersion + (row.id === ids.primary ? 2 : 1),
      });
      // Apart from the corrected weekday, original scalar domain values stay
      // exact. The existing sequential restore bumps the primary once more
      // when its sibling rejoins; the batched detach must add no sibling bump.
      expect(row).toEqual({
        ...prior, dayOfWeek: 6, roomVersion: prior.roomVersion + (row.id === ids.primary ? 2 : 1),
      });
    }
    expect(await db.pairingGroup.findUniqueOrThrow({ where: { id: group.id } })).toEqual(group);
    expect(await db.pairingTutee.findMany({ orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }] })).toEqual(roster);
    expect(await count()).toEqual(counts);

    const record = (value: unknown): Record<string, unknown> => {
      expect(value !== null && typeof value === "object" && !Array.isArray(value)).toBe(true);
      return value as Record<string, unknown>;
    };
    const array = (value: unknown): unknown[] => {
      expect(Array.isArray(value)).toBe(true);
      return value as unknown[];
    };
    const labels = new Map<string, string>(Object.entries(ids).map(([name, id]) => [id, name]));
    const label = (id: unknown) => {
      expect(typeof id).toBe("string");
      const name = labels.get(id as string);
      expect(name).toBeDefined();
      return name!;
    };
    const phase = (old: Record<string, unknown>, next: Record<string, unknown>) => {
      if (old.groupId === next.groupId && old.roomId === next.roomId &&
        old.scheduleConfirmed === next.scheduleConfirmed && old.dayOfWeek === next.dayOfWeek &&
        old.roomVersion !== next.roomVersion) return "sibling-version";
      if (next.groupId === null && next.roomId === null) return "movable-detach";
      if (next.groupId === null && next.scheduleConfirmed === false) return "group-detach";
      return next.groupId === group.id ? "group-restore" : "movable-restore";
    };
    const expectedDirect = [
      ["movable-detach", "autoA"], ["movable-detach", "autoZ"],
      ["group-detach", "primary"], ["group-detach", "secondary"],
      ["group-restore", "primary"], ["group-restore", "secondary"],
      ["movable-restore", "autoA"], ["movable-restore", "autoZ"],
    ];
    const audit = await db.auditLog.findFirstOrThrow({ where: { operation: "admin.updateTimeSlot" } });
    const changes = array(record(audit.details).changes).map(record).filter((change) => change.entity === "Pairing");
    expect(changes).toHaveLength(6);
    const expectedAuditMembers = [
      ["autoA", "autoZ"], ["secondary", "primary"],
      ["primary"], ["secondary"], ["autoA"], ["autoZ"],
    ];
    const auditOrder = changes.flatMap((change, index) => {
      // Both original bulk changes keep their complete audit grouping. Their
      // arrays sort by ID even when the group's write order is primary-first.
      expect(change.write).toBe(index < 2 ? "updateMany" : "update");
      expect(change.affectedCount).toBe(index < 2 ? 2 : 1);
      const previous = array(change.before), next = array(change.after);
      expect(previous.map((row) => label(record(row).id))).toEqual(expectedAuditMembers[index]);
      expect(next.map((row) => label(record(row).id))).toEqual(expectedAuditMembers[index]);
      return previous.map((value, member) => {
        const old = record(value), updated = record(next[member]);
        expect(updated.id).toBe(old.id);
        const prior = before.find((row) => row.id === old.id)!;
        const stage = phase(old, updated);
        expect(old.roomVersion).toBe(prior.roomVersion);
        expect(updated.roomVersion).toBe(prior.roomVersion + (index < 2 ? 0 : 1));
        if (stage === "movable-detach") {
          expect(old.roomId).toBe(prior.roomId);
          expect(updated).toMatchObject({ groupId: null, roomId: null, scheduleConfirmed: true, dayOfWeek: 7 });
        } else if (stage === "group-detach") {
          expect(old.groupId).toBe(group.id);
          expect(updated).toMatchObject({ groupId: null, scheduleConfirmed: false, roomId: rooms[2], dayOfWeek: 7 });
        } else {
          expect(updated).toMatchObject({
            dayOfWeek: 6, timeSlotId: slotId, startMin: 600, endMin: 660,
            scheduleConfirmed: true, roomId: prior.roomId,
            groupId: stage === "group-restore" ? group.id : null,
          });
        }
        return [stage, label(updated.id)];
      });
    });
    expect(auditOrder).toEqual([
      ...expectedDirect.slice(0, 2), ["group-detach", "secondary"], ["group-detach", "primary"],
      ...expectedDirect.slice(4),
    ]);

    const journal = await db.recoveryChange.findMany({ where: { actionId: rootId }, orderBy: { id: "asc" } });
    expect(journal).toHaveLength(9);
    expect(new Set(journal.map((change) => change.eventId)).size).toBe(1);
    const journalOrder = journal.map((change) => {
      expect(change.entity).toBe("Pairing"); expect(change.operation).toBe("UPDATE");
      const old = record(change.before), updated = record(change.after), key = record(change.recordKey);
      expect(key.id).toBe(updated.id); expect(updated.id).toBe(old.id);
      return [phase(old, updated), label(key.id)];
    });
    // Every AFTER trigger sees the entire group detached. Only the original
    // sequential restore adds a sibling-version row before secondary's update.
    expect(journalOrder).toEqual([
      ...expectedDirect.slice(0, 5), ["sibling-version", "primary"],
      ...expectedDirect.slice(5),
    ]);
    expect((await db.recoveryFence.findUniqueOrThrow({ where: { actionId: rootId } })).revision).toBe(9);
    expect(await db.auditLog.count({ where: { operation: "admin.updateTimeSlot" } })).toBe(1);
  },
);

it("invalidates the original sibling sets on group moves and deletes", async () => {
  const groups = ["version-left", "version-right"];
  await db.pairingGroup.createMany({ data: groups.map((id, index) => ({
    id, tutorId, termId, primaryPairingId: index === 0 ? "version-z" : "version-c",
  })) });
  const ids = ["version-z", "version-p", "version-c", "version-a", "version-free"];
  await db.pairing.createMany({ data: ids.map((id, i) => ({
    id, tutorId, termId, subject, dayOfWeek: 2, startMin: 600, endMin: 645,
    groupId: i < 2 ? groups[0] : i < 4 ? groups[1] : null,
  })) });
  const values = async () => Object.fromEntries((await unitRows(ids)).map((r) => [r.id, r.roomVersion]));
  const original = await values();
  await db.pairing.update({ where: { id: "version-p" }, data: { groupId: groups[1] } });
  const moved = await values();
  for (const id of ids)
    expect(moved[id]).toBe(original[id]! + (["version-z", "version-c", "version-a"].includes(id) ? 1 : 0));
  await db.pairing.delete({ where: { id: "version-p" } });
  const deleted = await values();
  for (const id of ids.filter((id) => id !== "version-p"))
    expect(deleted[id]).toBe(moved[id]! + (["version-c", "version-a"].includes(id) ? 1 : 0));
});

it("rolls back ordered releases when a reviewed pairing is missing or duplicated", async () => {
  const pairing = await evidence(rooms[0]!);
  const before = await db.pairing.findUniqueOrThrow({ where: { id: pairing.id } });
  for (const units of [[["catalog-missing"]], [[pairing.id], ["catalog-missing"]], [[pairing.id], [pairing.id]]]) {
    await expect(db.$transaction((tx) => releasePairingsInOrder(tx, units, "rooms")))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.pairing.findUniqueOrThrow({ where: { id: pairing.id } })).toEqual(before);
  }
});

it.each(["forward", "reverse"] as const)("propagates 100 linked rows without splitting a six-member automatic group across a release boundary with %s heap insertion", async (insertionOrder) => {
  const groupStart = 30, groupSize = 6;
  const pairingIds = Array.from({ length: 100 }, (_, index) => `catalog-capacity-pair-${String(index).padStart(3, "0")}`);
  const tutorIds = Array.from({ length: 95 }, (_, index) => `catalog-capacity-tutor-${String(index).padStart(3, "0")}`);
  const roomIds = tutorIds.map((_, index) => `catalog-capacity-room-${String(index).padStart(3, "0")}`);
  const groupIds = pairingIds.slice(groupStart, groupStart + groupSize);
  // Positions 30/31 and 32..35 fall on opposite sides of naive 32-row chunks.
  // Choose the last member as primary so restore order also exercises that rule.
  const primaryId = groupIds.at(-1)!;
  const memberOrder = [primaryId, ...groupIds.filter((id) => id !== primaryId)];
  const unitIndex = (index: number) => index < groupStart ? index
    : index < groupStart + groupSize ? groupStart : index - groupSize + 1;
  await db.tutor.createMany({ data: tutorIds.map((id, index) => ({
    id, englishName: `Synthetic capacity tutor ${index}`, status: "ACTIVE" as const,
  })) });
  await db.room.createMany({ data: roomIds.map((id, index) => ({ id, name: `Synthetic capacity room ${index}` })) });
  const subjects = Array.from({ length: groupSize }, (_, index) => ({
    id: `catalog-capacity-subject-${index}`, name: `Synthetic capacity subject ${index}`,
  }));
  await db.subject.createMany({ data: subjects });
  const qualifications = tutorIds.flatMap((id, index) => (index === groupStart ? subjects.map((row) => row.id) : [subjectId])
    .map((subjectId) => ({ tutorId: id, subjectId, approvedById: "allocation-ADMIN" })));
  await db.tutorQualification.createMany({ data: qualifications });
  await db.qualificationGrant.createMany({ data: qualifications.map((row) => ({
    tutorId: row.tutorId, sourceSubjectId: row.subjectId, subjectId: row.subjectId,
  })) });
  const group = await db.pairingGroup.create({ data: {
    id: "catalog-capacity-group", tutorId: tutorIds[groupStart]!, termId, primaryPairingId: primaryId,
  } });
  const pairingData = pairingIds.map((id, index) => ({
    id, tutorId: tutorIds[unitIndex(index)]!, termId, timeSlotId: slotId,
    subject: index >= groupStart && index < groupStart + groupSize ? subjects[index - groupStart]!.name : subject,
    groupId: groupIds.includes(id) ? group.id : null,
    roomId: roomIds[unitIndex(index)]!, roomMode: "AUTO" as const,
    scheduleConfirmed: true, dayOfWeek: 7, startMin: 600, endMin: 660,
  }));
  await db.pairing.createMany({ data: insertionOrder === "forward" ? pairingData : [...pairingData].reverse() });
  const rosterData = groupIds.flatMap((pairingId) => learners.map((tuteeId) => ({ pairingId, tuteeId })));
  await db.pairingTutee.createMany({ data: insertionOrder === "forward" ? rosterData : [...rosterData].reverse() });
  const before = await unitRows(pairingIds);
  expect(before).toHaveLength(100);
  expect(before.slice(30, 36).map((row) => row.id)).toEqual(groupIds);
  const versions = new Map(before.map((row) => [row.id, row.roomVersion]));
  const roster = await db.pairingTutee.findMany({ orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }] });
  const counts = async () => ({
    pairings: await db.pairing.count(), groups: await db.pairingGroup.count(), sessions: await db.session.count(),
    notifications: await db.notification.count(), notices: await db.sessionNotice.count(), email: await db.emailDelivery.count(),
  });
  const originalCounts = await counts();
  const rootId = "catalog-capacity-recovery-root";
  await db.recoveryAction.create({ data: {
    id: rootId, kind: "INITIAL_ADMISSION", applicationId: "catalog-capacity-synthetic-admission", before: {},
  } });
  await db.recoveryTrackedEntity.createMany({ data: groupIds.map((recordId) => ({
    actionId: rootId, entity: "Pairing", recordId,
  })) });
  const result = await (async () => {
    const started = performance.now();
    let outcome = "failed";
    try {
      const result = await actor("HEAD").admin.updateTimeSlot({
        id: slotId, label: "Synthetic capacity catalog move", dayOfWeek: 6, startMin: 600, endMin: 660, active: true,
      });
      outcome = "completed";
      return result;
    } finally {
      // One synthetic createCaller observation, including real permission and
      // audit work. The production transaction's existing 20s cap is unchanged.
      console.info("[catalog-capacity-request]", JSON.stringify({
        rows: 100, groupSize, groupStart, groupEndExclusive: groupStart + groupSize, insertionOrder,
        outcome, elapsedMs: performance.now() - started, transport: "procedure", includesHttp: false,
      }));
    }
  })();
  expect(result).toMatchObject({ updatedPairings: 100, updatedSessions: 0, dayOfWeek: 6 });
  const restored = await unitRows(pairingIds);
  expect(restored).toHaveLength(100);
  for (const [index, row] of restored.entries()) {
    const original = before[index]!;
    const position = memberOrder.indexOf(row.id);
    // Whole-statement release adds no sibling bump. The unchanged original
    // restore increments each member once and each earlier restored sibling
    // once again for every subsequent member that rejoins the group.
    const increment = position < 0 ? 1 : groupSize - position;
    expect(row).toEqual({ ...original, dayOfWeek: 6, roomVersion: original.roomVersion + increment });
  }
  expect(await db.pairingGroup.findUniqueOrThrow({ where: { id: group.id } })).toEqual(group);
  expect(await db.pairingTutee.findMany({ orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }] })).toEqual(roster);
  expect(await counts()).toEqual(originalCounts);
  expect(await db.timeSlot.findUniqueOrThrow({ where: { id: slotId } })).toMatchObject({ dayOfWeek: 6, startMin: 600, endMin: 660 });

  const record = (value: unknown): Record<string, unknown> => {
    expect(value !== null && typeof value === "object" && !Array.isArray(value)).toBe(true);
    return value as Record<string, unknown>;
  };
  const array = (value: unknown): unknown[] => {
    expect(Array.isArray(value)).toBe(true);
    return value as unknown[];
  };
  const rowId = (row: Record<string, unknown>) => {
    expect(typeof row.id).toBe("string");
    return row.id as string;
  };
  const audit = await db.auditLog.findFirstOrThrow({ where: { operation: "admin.updateTimeSlot" } });
  const changes = array(record(audit.details).changes).map(record).filter((change) => change.entity === "Pairing");
  const release = changes[0]!;
  expect(release).toMatchObject({ write: "updateMany", affectedCount: 100 });
  const releaseBefore = array(release.before).map(record), releaseAfter = array(release.after).map(record);
  expect(releaseBefore).toHaveLength(100); expect(releaseAfter).toHaveLength(100);
  expect(releaseBefore.map(rowId).sort()).toEqual(pairingIds);
  expect(releaseAfter.map(rowId).sort()).toEqual(pairingIds);
  for (const row of releaseAfter) {
    expect(row).toMatchObject({ groupId: null, roomId: null, scheduleConfirmed: true, dayOfWeek: 7 });
    expect(row.roomVersion).toBe(versions.get(rowId(row)));
  }
  const groupRelease = changes.find((change) => change.write === "updateMany" && change.affectedCount === groupSize)!;
  expect(groupRelease).toBeDefined();
  const groupBefore = array(groupRelease.before).map(record);
  expect(groupBefore.map(rowId).sort()).toEqual(groupIds);
  for (const row of groupBefore) {
    expect(row).toMatchObject({ groupId: null, roomId: null, scheduleConfirmed: true });
    expect(row.roomVersion).toBe(versions.get(rowId(row)));
  }
  const detached = array(groupRelease.after).map(record);
  expect(detached.map(rowId).sort()).toEqual(groupIds);
  for (const row of detached) {
    expect(row).toMatchObject({ groupId: null, roomId: null, scheduleConfirmed: false });
    expect(row.roomVersion).toBe(versions.get(rowId(row)));
  }
  const journal = await db.recoveryChange.findMany({ where: { actionId: rootId }, orderBy: { id: "asc" } });
  const restorationOrder = memberOrder.flatMap((member, index) => [
    ...memberOrder.slice(0, index).sort(), member,
  ]);
  expect(restorationOrder).toHaveLength(21);
  expect(journal).toHaveLength(33);
  const journalIds = journal.map((change) => {
    expect(change.entity).toBe("Pairing"); expect(change.operation).toBe("UPDATE");
    const key = record(change.recordKey), old = record(change.before), next = record(change.after);
    expect(key.id).toBe(old.id); expect(next.id).toBe(old.id);
    return rowId(key);
  });
  // Release is ID-ordered, group detach follows its primary-first member list,
  // and every restore first journals prior siblings in ID order, then itself.
  expect(journalIds).toEqual([...groupIds, ...memberOrder, ...restorationOrder]);
  for (const [index, change] of journal.entries()) {
    const old = record(change.before), next = record(change.after);
    if (index < 12) expect(next.roomVersion).toBe(old.roomVersion);
    else expect(next.roomVersion).toBe((old.roomVersion as number) + 1);
  }
  const events = await db.recoveryEvent.findMany({ where: { actionId: rootId } });
  expect(events).toHaveLength(1);
  expect(new Set(journal.map((change) => change.eventId))).toEqual(new Set([events[0]!.id]));
  expect((await db.recoveryFence.findUniqueOrThrow({ where: { actionId: rootId } })).revision).toBe(33);
  expect(await db.auditLog.count({ where: { operation: "admin.updateTimeSlot" } })).toBe(1);
}, 60_000);

it("a fixed-room catalog conflict rolls back the entire cohort and slot", async () => {
  const fixed = await create({ roomMode: "FIXED", roomId: rooms[0] });
  const automatic = await create({ tutorId: otherTutorId });
  await create({
    tutorId: thirdTutorId,
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
    data: { emailInfo: true, emailReviewRequests: true },
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
  await db.notification.create({ data: {
    userId: "allocation-ADMIN", title: "Typed attendance notification",
    event: "attendance_cards_pending", context: { count: 3, reason: "must not enter transport" },
    link: "/admin/attendance",
  } });
  expect(await db.emailDelivery.findFirst({ where: { event: "attendance_cards_pending" } })).toMatchObject({
    context: { count: 3 }, destination: "/admin/attendance",
  });
  await blockAll();
  await create();
  expect(await shortages()).toHaveLength(2);
  expect((await shortages()).every((row) => row.inAppOnly)).toBe(true);
  expect(await db.emailDelivery.count()).toBe(2);
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

it("propagates a catalog weekday correction through an archived group with departed students without changing attendance", async () => {
  await blockAll();
  const first = await create({ tuteeIds: learners });
  const second = await create({ tuteeIds: learners, timeSlotId: otherSlotId });
  await combineRoomUnit([first.id, second.id]);
  const grouped = await unitRows([first.id, second.id]);
  const originalGroupId = grouped[0]!.groupId;
  await db.session.create({ data: {
    pairingId: first.id, tutorId, timeSlotId: slotId,
    date: new Date("2026-10-11T00:00:00Z"), month: "2026-10",
    schoolYear: "26-27", quarter: "Q1", tutorStatus: "PRESENT",
    startMin: 600, endMin: 660, durationMin: 60, shFactor: 2, shCount: 2,
    tutees: { create: learners.map(tuteeId => ({ tuteeId, status: "PRESENT" as const })) },
  } });
  await db.term.update({ where: { id: termId }, data: { active: false } });
  await db.term.create({ data: { name: "Current after archived group", schoolYear: "26-27", quarter: "Q2", active: true } });
  // Historical enrollment links survive participant departure. They are evidence,
  // rather than a live group that can be repaired from the current dashboard.
  await db.tutee.updateMany({ where: { id: { in: learners } }, data: { status: "INACTIVE" } });
  const roster = await db.pairingTutee.findMany({ orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }] });
  const sessions = await db.session.findMany({ include: { tutees: true }, orderBy: { id: "asc" } });
  const notices = await shortages();
  const result = await actor("HEAD").admin.updateTimeSlot({ id: slotId,
    label: "Archived group weekday correction", dayOfWeek: 6, startMin: 600, endMin: 660, active: true });
  expect(result.updatedPairings).toBe(2);
  expect((await unitRows([first.id, second.id])).every(row =>
    row.groupId === originalGroupId && row.dayOfWeek === 6 && row.scheduleConfirmed && row.roomNeedsAssignment)).toBe(true);
  expect(await db.pairingTutee.findMany({ orderBy: [{ pairingId: "asc" }, { tuteeId: "asc" }] })).toEqual(roster);
  expect(await db.session.findMany({ include: { tutees: true }, orderBy: { id: "asc" } })).toEqual(sessions);
  expect(await shortages()).toEqual(notices);
});

it.each(["NONE", "AUTO", "FIXED"] as const)(
  "rejects overlapping independent tutor plans before %s room allocation, including shortages", async roomMode => {
    await blockAll();
    await create({ roomMode: "NONE" });
    const before = await db.pairing.findMany();
    const attempt = create({ timeSlotId: overlapId, roomMode,
      ...(roomMode === "FIXED" ? { roomId: rooms[0] } : {}) });
    await expect(attempt).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(attempt).rejects.toThrow("This tutor already");
    expect(await db.pairing.findMany()).toEqual(before);
    expect(await shortages()).toHaveLength(0);
  },
);

it.each(["NONE", "AUTO", "FIXED"] as const)(
  "protects copied unlinked tutor intervals when moving a %s plan", async roomMode => {
    const occupied = await create({ roomMode: "NONE" });
    await actor("TUTOR").tutor.setPairingSlot({ pairingId: occupied.id, slotId: null });
    await db.timeSlot.update({ where: { id: slotId }, data: { active: false } });
    const moving = await create({ timeSlotId: otherSlotId, roomMode,
      ...(roomMode === "FIXED" ? { roomId: rooms[0] } : {}) });
    const before = await unitRows([occupied.id, moving.id]);
    await expect(actor("TUTOR").tutor.setPairingSlot({ pairingId: moving.id,
      slotId: overlapId, expectedRoomVersion: moving.roomVersion }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await unitRows([occupied.id, moving.id])).toEqual(before);
  },
);

it("allows adjacent tutor plans, other weekdays, tutors and historical periods", async () => {
  const first = await create({ roomMode: "NONE" });
  await create({ timeSlotId: adjacentId, roomMode: "NONE" });
  await create({ timeSlotId: otherSlotId, roomMode: "NONE" });
  await create({ tutorId: otherTutorId, roomMode: "NONE" });
  const past = await db.term.create({ data: { name: "Historical scheduling scope", schoolYear: "25-26", quarter: "Q4" } });
  await db.pairing.update({ where: { id: first.id }, data: { termId: past.id } });
  await create({ roomMode: "NONE" });
  expect(await db.pairing.count()).toBe(5);
});

it("rejects management reassignment into another tutor's occupied time atomically", async () => {
  await create({ roomMode: "NONE" });
  const moving = await create({ tutorId: otherTutorId, roomMode: "NONE" });
  const before = await db.pairing.findMany({ orderBy: { id: "asc" } });
  await expect(update(moving.id, { tutorId, roomMode: "NONE", expectedRoomVersion: moving.roomVersion }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.pairing.findMany({ orderBy: { id: "asc" } })).toEqual(before);
});

it("schedules eligible unscheduled groups together and blocks overlap with a different explicit group", async () => {
  const ids: string[] = [];
  for (let index = 0; index < 4; index++) {
    const row = await db.pairing.create({ data: { tutorId, termId, subject, roomMode: "NONE",
      dayOfWeek: 1, startMin: 600, endMin: 660, scheduleConfirmed: false,
      tutees: { create: learners.map(tuteeId => ({ tuteeId })) } } });
    ids.push(row.id);
  }
  const state = await actor("TUTOR").pairingGroups.mine();
  await actor("TUTOR").pairingGroups.save({ snapshot: state.snapshot, groups: [
    { pairingIds: ids.slice(0, 2), slotId: null }, { pairingIds: ids.slice(2), slotId: null },
  ] });
  await actor("TUTOR").tutor.setPairingSlot({ pairingId: ids[0]!, slotId });
  const before = await unitRows(ids);
  await expect(actor("TUTOR").tutor.setPairingSlot({ pairingId: ids[2]!, slotId: overlapId }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(await unitRows(ids)).toEqual(before);
  await actor("TUTOR").tutor.setPairingSlot({ pairingId: ids[2]!, slotId: adjacentId });
  const saved = await unitRows(ids);
  expect(saved.every(row => row.scheduleConfirmed)).toBe(true);
  expect(new Set(saved.map(row => row.groupId)).size).toBe(2);
});

it("rejects catalog propagation against an external copied tutor interval and rolls back the slot", async () => {
  const first = await create({ roomMode: "NONE" });
  await actor("TUTOR").tutor.setPairingSlot({ pairingId: first.id, slotId: null });
  await create({ roomMode: "NONE", timeSlotId: otherSlotId });
  const before = await db.pairing.findMany({ orderBy: { id: "asc" } });
  const beforeSlot = await db.timeSlot.findUniqueOrThrow({ where: { id: otherSlotId } });
  await expect(actor("HEAD").admin.updateTimeSlot({ id: otherSlotId,
    label: "Conflicting catalog move", dayOfWeek: 7, startMin: 630, endMin: 690, active: true }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.timeSlot.findUniqueOrThrow({ where: { id: otherSlotId } })).toEqual(beforeSlot);
  expect(await db.pairing.findMany({ orderBy: { id: "asc" } })).toEqual(before);
});

it("validates independent legacy reservations inside the final catalog cohort", async () => {
  await create({ roomMode: "NONE" });
  await db.pairing.create({ data: { tutorId, termId, subject, timeSlotId: slotId,
    roomMode: "NONE", scheduleConfirmed: true, dayOfWeek: 2, startMin: 900, endMin: 960 } });
  const before = await db.pairing.findMany({ orderBy: { id: "asc" } });
  await expect(actor("HEAD").admin.updateTimeSlot({ id: slotId,
    label: "Final cohort conflict", dayOfWeek: 7, startMin: 610, endMin: 670, active: true }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.pairing.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  expect(await db.timeSlot.findUniqueOrThrow({ where: { id: slotId } })).toMatchObject({ startMin: 600, endMin: 660 });
});

it("catalog propagation preserves unconfirmed linked placeholders without promoting or allocating them", async () => {
  const confirmed = await create({ roomMode: "NONE" });
  const awaiting = await db.pairing.create({ data: { tutorId, termId, subject, timeSlotId: slotId,
    roomMode: "AUTO", scheduleConfirmed: false, dayOfWeek: 2, startMin: 900, endMin: 960 } });
  const result = await actor("HEAD").admin.updateTimeSlot({ id: slotId,
    label: "Confirmed reservations only", dayOfWeek: 7, startMin: 610, endMin: 670, active: true });
  expect(result.updatedPairings).toBe(1);
  expect(await db.pairing.findUniqueOrThrow({ where: { id: awaiting.id } })).toEqual(awaiting);
  expect(await db.pairing.findUniqueOrThrow({ where: { id: confirmed.id } })).toMatchObject({ scheduleConfirmed: true, startMin: 610, endMin: 670 });
  expect(await shortages()).toHaveLength(0);
});

it("reruns the tutor conflict rule at approval execution instead of reserving proposal time", async () => {
  await expect(actor("COORDINATOR").admin.createPairing({ tutorId, subject, subjectId,
    timeSlotId: overlapId, roomMode: "NONE", tuteeIds: [] }))
    .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const request = await db.approvalRequest.findFirstOrThrow({ where: { operation: "admin.createPairing" } });
  const occupied = await create({ roomMode: "NONE" });
  await expect(actor("HEAD").approval.decide({ id: request.id, approve: true, note: "Review live tutor occupancy" }))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.pairing.findMany()).toMatchObject([{ id: occupied.id }]);
  expect(await db.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ state: "PENDING" });
});

it("serializes simultaneous roomless plans for the same tutor so only one commits", async () => {
  const results = await Promise.allSettled([create({ roomMode: "NONE" }), create({ roomMode: "NONE", timeSlotId: overlapId })]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(await db.pairing.count()).toBe(1);
  expect(await shortages()).toHaveLength(0);
});

it("rejects incomplete management group edits and permits explicit repair without changing history", async () => {
  const physics = await db.subject.create({ data: { name: "Allocation Integration Physics" } });
  await db.tutorQualification.create({ data: { tutorId, subjectId: physics.id, approvedById: "allocation-ADMIN",
    grants: { create: { subjectId: physics.id } } } });
  const first = await create({ tuteeIds: learners, roomMode: "NONE" });
  const second = await create({ subject: physics.name, subjectId: physics.id,
    tuteeIds: learners, timeSlotId: otherSlotId, roomMode: "NONE" });
  await combineRoomUnit([first.id, second.id]);
  const before = await unitRows([first.id, second.id]);
  const current = before.find(row => row.id === first.id)!;
  await expect(update(first.id, { tuteeIds: [learners[0]!], roomMode: "NONE", expectedRoomVersion: current.roomVersion }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await unitRows([first.id, second.id])).toEqual(before);
  await expect(actor().admin.deletePairing({ id: first.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  // Existing invalid groups remain explicitly repairable; no missing assignment
  // is invented, and completed attendance is never recalculated by this path.
  await db.pairingTutee.delete({ where: { pairingId_tuteeId: { pairingId: first.id, tuteeId: learners[1]! } } });
  await expect(actor("TUTOR").tutor.setPairingSlot({ pairingId: second.id, slotId: otherSlotId }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  const repair = await db.pairing.findUniqueOrThrow({ where: { id: first.id } });
  await update(first.id, { tuteeIds: learners, roomMode: "NONE", expectedRoomVersion: repair.roomVersion });
  expect((await unitRows([first.id, second.id])).every(row => row.groupId === current.groupId)).toBe(true);
  expect(await db.session.count()).toBe(0);
});

it("keeps a complete remaining group schedulable after management removes its original primary", async () => {
  const first = await create({ tuteeIds: learners, roomMode: "NONE" });
  const second = await create({ tuteeIds: learners, roomMode: "NONE", timeSlotId: otherSlotId });
  const third = await create({ tuteeIds: learners, roomMode: "NONE", timeSlotId: adjacentId });
  await combineRoomUnit([first.id, second.id, third.id]);
  await actor().admin.deletePairing({ id: first.id });
  await actor("TUTOR").tutor.setPairingSlot({ pairingId: second.id, slotId: otherSlotId });
  const remaining = await unitRows([second.id, third.id]);
  expect(remaining).toHaveLength(2);
  expect(remaining.every(row => row.scheduleConfirmed && row.timeSlotId === otherSlotId && !!row.groupId)).toBe(true);
  expect(await db.session.count()).toBe(0);
});

it("validates reactivated retained group coverage but allows unrelated edits to already-inactive students", async () => {
  const physics = await db.subject.create({ data: { name: "Retained Coverage Physics" } });
  await db.tutorQualification.create({ data: { tutorId, subjectId: physics.id, approvedById: "allocation-ADMIN",
    grants: { create: { subjectId: physics.id } } } });
  const first = await create({ tuteeIds: learners, roomMode: "NONE" });
  const second = await create({ subject: physics.name, subjectId: physics.id,
    tuteeIds: learners, timeSlotId: otherSlotId, roomMode: "NONE" });
  await combineRoomUnit([first.id, second.id]);
  const inactiveId = learners[1]!;
  // Legacy retained links are deliberately synthetic here: ordinary inactivation
  // removes them. Reactivation must still validate the prospective active roster.
  await db.tutee.update({ where: { id: inactiveId }, data: { status: "INACTIVE" } });
  await db.pairingTutee.delete({ where: { pairingId_tuteeId: { pairingId: second.id, tuteeId: inactiveId } } });
  let inactive = await db.tutee.findUniqueOrThrow({ where: { id: inactiveId } });
  await expect(actor("HEAD").admin.updateTutee({ id: inactive.id, englishName: inactive.englishName,
    expectedUpdatedAt: inactive.updatedAt, status: "ACTIVE" }))
    .rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.tutee.findUniqueOrThrow({ where: { id: inactiveId } })).toEqual(inactive);
  // Make the group visibly invalid without changing the inactive student. A
  // notes-only update must not be mistaken for another inactivation transition.
  await db.pairingTutee.delete({ where: { pairingId_tuteeId: { pairingId: second.id, tuteeId: learners[0]! } } });
  inactive = await db.tutee.findUniqueOrThrow({ where: { id: inactiveId } });
  await actor("HEAD").admin.updateTutee({ id: inactive.id, englishName: inactive.englishName,
    expectedUpdatedAt: inactive.updatedAt, status: "INACTIVE", notes: "Unrelated profile correction" });
  expect(await db.tutee.findUniqueOrThrow({ where: { id: inactiveId } })).toMatchObject({
    status: "INACTIVE", notes: "Unrelated profile correction",
  });
});
