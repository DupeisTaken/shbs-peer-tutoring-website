import { describe, expect, it, vi } from "vitest";
import { allocateRoom } from "./room-allocation";
import {
  assertPairingGroupsRemainEligible,
  assertTutorScheduleAvailable,
  assertTutorScheduleCohortAvailable,
} from "./tutor-scheduling";
import type { TransactionDb } from "./transactions";

const candidate = {
  termId: "current",
  tutorId: "tutor",
  scheduleConfirmed: true,
  dayOfWeek: 1,
  startMin: 600,
  endMin: 660,
};
type Row = typeof candidate & {
  id: string;
  groupId?: string | null;
  subject?: string;
  tutees?: { tuteeId: string }[];
};

/** Query-aware fixture verifies the server predicate, rather than returning an
 * unconditional conflict that could hide wrong term/weekday/exclusion logic. */
function fixture(rows: Row[] = []) {
  const findFirst = vi.fn(
    async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((row) => {
        const excluded = where.id as { notIn: string[] } | undefined;
        return (
          row.termId === where.termId &&
          row.tutorId === where.tutorId &&
          row.scheduleConfirmed &&
          row.dayOfWeek === where.dayOfWeek &&
          row.startMin < (where.startMin as { lt: number }).lt &&
          row.endMin > (where.endMin as { gt: number }).gt &&
          !excluded?.notIn.includes(row.id)
        );
      }) ?? null,
  );
  const raw = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    pairing: { findFirst, findMany: vi.fn() },
    room: { count: vi.fn().mockResolvedValue(1) },
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
    user: { findMany: vi.fn().mockResolvedValue([]) },
    tutorProfileOwnership: { findMany: vi.fn().mockResolvedValue([]) },
    studentProfileOwnership: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { raw, db: raw as unknown as TransactionDb };
}

describe("authoritative tutor scheduling", () => {
  it("refuses a recurring write that overlaps an agreed dated exception", async () => {
    const { db, raw } = fixture();
    raw.sessionPlanCohort.findMany.mockResolvedValue([
      {
        id: "dated",
        planId: "dated-plan",
        date: "2026-11-02",
        startMin: 610,
        endMin: 655,
        roomId: null,
        plan: { tutorId: "tutor", originalDate: "2026-11-01", assignments: [] },
        participants: [{ tuteeId: "learner" }],
      },
    ]);
    await expect(
      assertTutorScheduleAvailable(db, candidate),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["NONE", "AUTO", "FIXED"] as const)(
    "rejects an external collision before %s room intent or room shortage work",
    async (roomMode) => {
      const { db, raw } = fixture([{ ...candidate, id: "unlinked" }]);
      await expect(
        allocateRoom(
          db,
          { ...candidate, tuteeIds: [] },
          { roomMode, roomId: roomMode === "FIXED" ? "room" : undefined },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(raw.room.count).not.toHaveBeenCalled();
    },
  );
  it("excludes a complete explicit unit but never an unrelated equal-time row", async () => {
    const rows = ["primary", "sibling", "independent"].map((id) => ({
      ...candidate,
      id,
    }));
    const { db } = fixture(rows);
    await expect(
      assertTutorScheduleAvailable(db, {
        ...candidate,
        id: "primary",
        excludePairingIds: ["sibling"],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      assertTutorScheduleAvailable(fixture(rows.slice(0, 2)).db, {
        ...candidate,
        id: "primary",
        excludePairingIds: ["sibling"],
      }),
    ).resolves.toBeUndefined();
  });
  it("includes confirmed schedules with no slot link and allows adjacency, other terms, tutors and weekdays", async () => {
    const rows = [
      { ...candidate, id: "adjacent", startMin: 660, endMin: 720 },
      { ...candidate, id: "past", termId: "past" },
      { ...candidate, id: "other", tutorId: "other" },
      { ...candidate, id: "day", dayOfWeek: 2 },
      { ...candidate, id: "placeholder", scheduleConfirmed: false },
    ];
    await expect(
      assertTutorScheduleAvailable(fixture(rows).db, candidate),
    ).resolves.toBeUndefined();
    await expect(
      assertTutorScheduleAvailable(
        fixture([{ ...candidate, id: "copied" }]).db,
        candidate,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("ignores unconfirmed candidate placeholders without reading occupancy", async () => {
    const { db, raw } = fixture([{ ...candidate, id: "other" }]);
    await expect(
      assertTutorScheduleAvailable(db, {
        ...candidate,
        scheduleConfirmed: false,
      }),
    ).resolves.toBeUndefined();
    expect(raw.pairing.findFirst).not.toHaveBeenCalled();
  });
  it("rejects independent final-cohort collisions before observing stale source times", async () => {
    const { db, raw } = fixture();
    await expect(
      assertTutorScheduleCohortAvailable(db, [
        { ...candidate, memberIds: ["a", "b"] },
        { ...candidate, memberIds: ["c"] },
      ]),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(raw.pairing.findFirst).not.toHaveBeenCalled();
  });
  it("excludes all old cohort members while checking its distinct final units against external bookings", async () => {
    const { db, raw } = fixture([
      { ...candidate, id: "old-a" },
      { ...candidate, id: "old-b" },
    ]);
    await expect(
      assertTutorScheduleCohortAvailable(db, [
        { ...candidate, memberIds: ["old-a"], dayOfWeek: 2 },
        { ...candidate, memberIds: ["old-b"], tutorId: "other" },
      ]),
    ).resolves.toBeUndefined();
    expect(raw.pairing.findFirst.mock.calls[0]?.[0].where.id).toEqual({
      notIn: ["old-a", "old-b"],
    });
    await expect(
      assertTutorScheduleCohortAvailable(
        fixture([{ ...candidate, id: "external" }]).db,
        [{ ...candidate, memberIds: ["old-a", "old-b"] }],
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("propagates occupancy read failures instead of authorizing the write", async () => {
    const { db, raw } = fixture();
    raw.pairing.findFirst.mockRejectedValueOnce(
      new Error("Occupancy read unavailable"),
    );
    await expect(
      allocateRoom(db, { ...candidate, tuteeIds: [] }, { roomMode: "NONE" }),
    ).rejects.toThrow("Occupancy read unavailable");
  });
});

describe("management group lifecycle validation", () => {
  const member = (id: string, subject: string, students: string[]) => ({
    ...candidate,
    id,
    groupId: "group",
    subject,
    tutees: students.map((tuteeId) => ({ tuteeId })),
  });
  const complete = [
    member("chem", "Chemistry", ["a", "b"]),
    member("math", "Mathematics", ["a", "b"]),
  ];
  function groupFixture(rows = complete) {
    const { db, raw } = fixture();
    raw.pairing.findMany
      .mockResolvedValueOnce([{ groupId: "group" }])
      .mockResolvedValueOnce(rows);
    return { db, raw };
  }
  it("rejects a subject/roster edit that removes one student's coverage", async () => {
    await expect(
      assertPairingGroupsRemainEligible(groupFixture().db, {
        replacement: {
          id: "chem",
          subject: "Chemistry",
          tuteeIds: ["a"],
          detach: false,
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("permits a repair of an already invalid group and consistent shared removal", async () => {
    await expect(
      assertPairingGroupsRemainEligible(
        groupFixture([member("chem", "Chemistry", ["a"]), complete[1]!]).db,
        {
          replacement: {
            id: "chem",
            subject: "Chemistry",
            tuteeIds: ["a", "b"],
            detach: false,
          },
        },
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertPairingGroupsRemainEligible(groupFixture().db, {
        tuteeIds: ["a"],
        removeTuteeIds: ["a"],
      }),
    ).resolves.toBeUndefined();
  });
  it("requires an explicit split before deletion leaves a singleton or all rosters empty", async () => {
    await expect(
      assertPairingGroupsRemainEligible(groupFixture().db, {
        removePairingIds: ["chem"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      assertPairingGroupsRemainEligible(groupFixture().db, {
        removeTuteeIds: ["a", "b"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("includes a prospectively reactivated student's retained links when validating coverage", async () => {
    const { db, raw } = groupFixture([
      member("chem", "Chemistry", ["a", "b"]),
      member("math", "Mathematics", ["a"]),
    ]);
    await expect(
      assertPairingGroupsRemainEligible(db, { activateTuteeIds: ["b"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(raw.pairing.findMany.mock.calls[1]).toMatchObject([
      {
        select: {
          tutees: {
            where: {
              OR: [
                { tutee: { status: { not: "INACTIVE" } } },
                { tuteeId: { in: ["b"] } },
              ],
            },
          },
        },
      },
    ]);
  });
});
