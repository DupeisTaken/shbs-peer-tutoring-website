import { describe, expect, it, vi } from "vitest";
import { rankRoomCandidates } from "~/lib/room-allocation";
import {
  allocateRoom,
  assertRoomVersion,
  notifyRoomShortage,
} from "./room-allocation";
import type { TransactionDb } from "./transactions";

const schedule = {
  id: "changed",
  termId: "period",
  tutorId: "tutor",
  tuteeIds: ["student-a", "student-b"],
  scheduleConfirmed: true,
  dayOfWeek: 1,
  startMin: 600,
  endMin: 660,
};
const current = {
  roomMode: "AUTO" as const,
  roomId: null,
  roomNeedsAssignment: false,
  roomShortageKey: null,
  roomVersion: 2,
};
type Booking = {
  id: string;
  groupId?: string | null;
  roomId: string;
  tutorId: string;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  tutees: { tuteeId: string }[];
};
function booking(
  id: string,
  roomId: string,
  tutorId = "other",
  tutees: string[] = [],
  duration = 60,
): Booking {
  return {
    id,
    roomId,
    tutorId,
    dayOfWeek: 2,
    startMin: 600,
    endMin: 600 + duration,
    tutees: tutees.map((tuteeId) => ({ tuteeId })),
  };
}
/** Small evidence fixtures exercise selection; real database constraint/race tests live in routers. */
function fixture(
  bookings: Booking[] = [],
  options: {
    enabled?: boolean;
    blocks?: string[];
    users?: { id: string; tutorId: string | null; studentId: string | null }[];
    ownership?: { tuteeId: string; userId: string }[];
  } = {},
) {
  const db = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    schoolCalendarDay: { findMany: vi.fn().mockResolvedValue([]) },
    programSettings: {
      findUnique: vi.fn().mockResolvedValue({ timeZone: "Asia/Shanghai" }),
    },
    term: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ startDate: null, endDate: null }),
    },
    sessionPlanCohort: { findMany: vi.fn().mockResolvedValue([]) },
    sessionPlanningRequest: { findMany: vi.fn().mockResolvedValue([]) },
    programFeature: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { key: "AUTO_ASSIGN_ROOMS", enabled: options.enabled ?? true },
        ]),
    },
    room: {
      findMany: vi.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]),
      count: vi.fn().mockResolvedValue(1),
    },
    pairing: {
      findMany: vi.fn().mockResolvedValue(bookings),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    roomUnavailability: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          (options.blocks ?? []).map((roomId) => ({ roomId })),
        ),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    user: { findMany: vi.fn().mockResolvedValue(options.users ?? []) },
    tutorProfileOwnership: { findMany: vi.fn().mockResolvedValue([]) },
    studentProfileOwnership: {
      findMany: vi.fn().mockResolvedValue(options.ownership ?? []),
    },
    notification: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  return { raw: db, db: db as unknown as TransactionDb };
}

describe("automatic room ranking", () => {
  it("excludes an otherwise preferred room occupied by another tutor's dated exception", async () => {
    const { db, raw } = fixture();
    raw.sessionPlanCohort.findMany.mockResolvedValue([
      {
        id: "dated",
        date: "2026-11-02",
        startMin: 610,
        endMin: 655,
        roomId: "a",
        plan: {
          tutorId: "other",
          originalDate: "2026-11-01",
          assignments: [{ pairingId: "other-pairing" }],
        },
        participants: [{ id: "other-commitment", tuteeId: "other-student" }],
      },
    ]);
    expect((await allocateRoom(db, schedule, {}, current)).roomId).toBe("b");
    await expect(
      allocateRoom(db, schedule, { roomMode: "FIXED", roomId: "a" }, current),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("counts an explicit combined reservation once for usage instead of once per subject", async () => {
    const { db } = fixture([
      { ...booking("group-a", "a"), groupId: "one-explicit-group" },
      { ...booking("group-b", "a"), groupId: "one-explicit-group" },
      booking("independent", "b", "other", [], 90),
    ]);
    expect((await allocateRoom(db, schedule, {}, current)).roomId).toBe("a");
  });
  it.each([
    { firstMinutes: 120, lastMinutes: 30, expectedRoom: "a" },
    { firstMinutes: 30, lastMinutes: 120, expectedRoom: "b" },
  ])(
    "uses the last subject row's minutes for interleaved reservation evidence ($firstMinutes then $lastMinutes)",
    async ({ firstMinutes, lastMinutes, expectedRoom }) => {
      const { db } = fixture([
        {
          ...booking("first-subject", "a", "other", [], firstMinutes),
          groupId: "combined",
        },
        booking("other-room", "b", "other", [], 90),
        {
          ...booking("last-subject", "a", "other", [], lastMinutes),
          groupId: "combined",
        },
      ]);
      expect(await allocateRoom(db, schedule, {}, current)).toEqual({
        roomId: expectedRoom,
        roomMode: "AUTO",
        roomOutcome: "ASSIGNED",
        roomNeedsAssignment: false,
        roomShortageKey: null,
      });
    },
  );
  it("keeps reservation usage scoped to its room even when group evidence spans rooms", async () => {
    const { db } = fixture([
      {
        ...booking("first-room", "a", "other", [], 120),
        groupId: "combined",
      },
      {
        ...booking("second-room", "b", "other", [], 30),
        groupId: "combined",
      },
    ]);
    expect((await allocateRoom(db, schedule, {}, current)).roomId).toBe("b");
  });
  it("refuses a conflict from the final room check after candidate selection", async () => {
    const { db, raw } = fixture();
    raw.pairing.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "room-conflict" });
    await expect(allocateRoom(db, schedule, {}, current)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That room is already booked during the selected time.",
    });
    expect(raw.pairing.findFirst.mock.lastCall).toMatchObject([
      { where: { roomId: "a", termId: schedule.termId } },
    ]);
  });
  it("ranks participant count ahead of tutor preference and occupied minutes", () => {
    expect(
      rankRoomCandidates([
        {
          id: "tutor",
          familiarParticipants: 1,
          familiarTutor: true,
          occupiedMinutes: 0,
        },
        {
          id: "students",
          familiarParticipants: 2,
          familiarTutor: false,
          occupiedMinutes: 500,
        },
      ])[0]?.id,
    ).toBe("students");
  });
  it("uses tutor familiarity on equal counts, then minutes and stable ID", () => {
    const candidate = {
      familiarParticipants: 2,
      familiarTutor: true,
      occupiedMinutes: 90,
    };
    expect(
      rankRoomCandidates([
        { id: "z", ...candidate },
        { id: "a", ...candidate },
        { id: "b", ...candidate, occupiedMinutes: 10 },
        { id: "c", ...candidate, familiarTutor: false, occupiedMinutes: 0 },
      ]).map((row) => row.id),
    ).toEqual(["b", "a", "z", "c"]);
  });
  it("selects the room familiar to more students even when the tutor knows the alternative", async () => {
    const { db } = fixture([
      booking("1", "a", "tutor"),
      booking("2", "b", "other", ["student-a", "student-b"]),
    ]);
    expect((await allocateRoom(db, schedule, {}, current)).roomId).toBe("b");
  });
  it("repeated bookings and duplicate roster evidence give each participant one vote", async () => {
    const { db } = fixture([
      booking("1", "a", "other", ["student-a", "student-a"]),
      booking("2", "a", "other", ["student-a"]),
      booking("3", "b", "tutor"),
    ]);
    expect(
      (
        await allocateRoom(
          db,
          { ...schedule, tuteeIds: ["student-a", "student-a"] },
          {},
          current,
        )
      ).roomId,
    ).toBe("b");
  });
  it("canonical linked identity connects historical aliases and deduplicates current tutees", async () => {
    const { db } = fixture(
      [booking("1", "a", "other", ["old-a"]), booking("2", "b", "tutor")],
      {
        users: [{ id: "account", tutorId: null, studentId: "student-a" }],
        ownership: [
          { tuteeId: "old-a", userId: "account" },
          { tuteeId: "student-b", userId: "account" },
        ],
      },
    );
    expect((await allocateRoom(db, schedule, {}, current)).roomId).toBe("b");
  });
  it("retains an eligible automatic room before considering better scoring alternatives", async () => {
    const { db } = fixture([
      booking("1", "b", "tutor", ["student-a", "student-b"]),
    ]);
    expect(
      await allocateRoom(db, schedule, {}, { ...current, roomId: "a" }),
    ).toMatchObject({ roomId: "a", roomOutcome: "RETAINED" });
  });
  it("recognizes the same person across roles while counting tutor and tutee votes separately", async () => {
    const { db } = fixture(
      [
        booking("1", "a", "other", ["former-student"]),
        booking("2", "b", "other", ["student-b"]),
      ],
      {
        users: [
          { id: "same-person", tutorId: "tutor", studentId: "student-a" },
        ],
        ownership: [{ tuteeId: "former-student", userId: "same-person" }],
      },
    );
    expect((await allocateRoom(db, schedule, {}, current)).roomId).toBe("a");
  });
  it("filters blackouts before continuity and balances only when continuity ties", async () => {
    const { db } = fixture(
      [booking("1", "a", "tutor", ["student-a", "student-b"])],
      { blocks: ["a"] },
    );
    expect((await allocateRoom(db, schedule, {}, current)).roomId).toBe("b");
    const balanced = fixture([booking("1", "a", "other", [], 120)]);
    expect(
      (await allocateRoom(balanced.db, schedule, {}, current)).roomId,
    ).toBe("b");
  });
  it("rejects overlapping copied intervals but permits adjacency and different weekdays", async () => {
    const overlap = {
      ...booking("1", "a"),
      dayOfWeek: 1,
      startMin: 650,
      endMin: 700,
    };
    const adjacent = {
      ...booking("2", "b"),
      dayOfWeek: 1,
      startMin: 660,
      endMin: 700,
    };
    const { db } = fixture([overlap, adjacent]);
    expect((await allocateRoom(db, schedule, {}, current)).roomId).toBe("b");
  });
  it("returns visible shortage with a stable material-change signature", async () => {
    const { db } = fixture([], { blocks: ["a", "b"] });
    const first = await allocateRoom(db, schedule, {}, current);
    const same = await allocateRoom(
      db,
      { ...schedule, tuteeIds: [...schedule.tuteeIds].reverse() },
      {},
      current,
    );
    expect(first).toMatchObject({
      roomId: null,
      roomNeedsAssignment: true,
      roomOutcome: "UNAVAILABLE",
    });
    expect(first.roomShortageKey).toBe(same.roomShortageKey);
  });
  it("requires explicit fixed-room release, and preserves intentional no-room on tutor scheduling", async () => {
    const { db } = fixture();
    await expect(
      allocateRoom(
        db,
        schedule,
        { roomMode: "AUTO" },
        { ...current, roomMode: "FIXED", roomId: "a" },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await allocateRoom(
        db,
        schedule,
        { roomMode: "AUTO", releaseRoomToAuto: true },
        { ...current, roomMode: "FIXED", roomId: "a" },
      ),
    ).toMatchObject({ roomMode: "AUTO", roomId: "a" });
    expect(
      await allocateRoom(db, schedule, {}, { ...current, roomMode: "NONE" }),
    ).toMatchObject({ roomMode: "NONE", roomId: null, roomOutcome: "NONE" });
  });
  it("disabled automation preserves existing room and still checks its constraints", async () => {
    const { db, raw } = fixture([], { enabled: false });
    expect(
      await allocateRoom(db, schedule, {}, { ...current, roomId: "a" }),
    ).toMatchObject({ roomId: "a", roomOutcome: "DISABLED" });
    expect(raw.pairing.findFirst).toHaveBeenCalled();
    expect(raw.room.findMany).not.toHaveBeenCalled();
    raw.pairing.findFirst.mockResolvedValue({ id: "conflict" });
    await expect(
      allocateRoom(db, schedule, {}, { ...current, roomId: "a" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("unconfirmed schedule never selects a room and legacy changes are explicit", async () => {
    const { db, raw } = fixture();
    expect(
      await allocateRoom(
        db,
        { ...schedule, scheduleConfirmed: false },
        {},
        current,
      ),
    ).toMatchObject({ roomOutcome: "AWAITING" });
    expect(raw.room.findMany).not.toHaveBeenCalled();
    expect(
      await allocateRoom(
        db,
        schedule,
        {},
        { ...current, roomMode: "LEGACY" },
        { preserveLegacy: true },
      ),
    ).toMatchObject({ roomMode: "LEGACY", roomId: null });
    expect(
      await allocateRoom(db, schedule, {}, { ...current, roomMode: "LEGACY" }),
    ).toMatchObject({ roomMode: "AUTO", roomId: "a" });
  });
  it("reads history and utilization only from the scheduled term", async () => {
    const { db, raw } = fixture();
    await allocateRoom(db, schedule, {}, current);
    expect(raw.pairing.findMany.mock.calls[0]).toMatchObject([
      { where: { termId: "period", scheduleConfirmed: true } },
    ]);
  });
  it("refuses a stale independent schedule version", () => {
    expect(() => assertRoomVersion(current, 1)).toThrow("Reload");
    expect(() => assertRoomVersion(current, 2)).not.toThrow();
  });
  it("suppresses unchanged shortage notices and uses the caller transaction", async () => {
    const { db, raw } = fixture([], {
      users: [{ id: "admin", tutorId: null, studentId: null }, { id: "head", tutorId: null, studentId: null }],
      blocks: ["a", "b"],
    });
    const allocation = await allocateRoom(db, schedule, {}, current);
    await notifyRoomShortage(
      db,
      "pairing",
      allocation,
      allocation.roomShortageKey,
    );
    expect(raw.notification.createMany).not.toHaveBeenCalled();
    await notifyRoomShortage(db, "pairing", allocation, null);
    expect(raw.notification.createMany).toHaveBeenCalledTimes(1);
    expect(raw.user.findMany.mock.lastCall).toMatchObject([
      { where: { role: { in: ["ADMIN", "HEAD"] }, suspendedAt: null, mergedIntoId: null } },
    ]);
    expect(raw.notification.createMany).toHaveBeenCalledExactlyOnceWith({ data: [
      expect.objectContaining({ userId: "admin" }) as unknown,
      expect.objectContaining({ userId: "head" }) as unknown,
    ] });
  });
});
