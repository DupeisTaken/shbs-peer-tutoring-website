import { describe, expect, it, vi } from "vitest";
import type { db as database } from "~/server/db";
import type { Prisma } from "../../generated/prisma";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/db", () => ({ db: {} }));

import { createCaller } from "~/server/api/root";
import {
  activePairingRosterWhere,
  releaseDisbandedPairingReservations,
} from "~/server/participant-execution";
import { readPairingGroups } from "~/server/pairing-groups";
import type { TransactionDb } from "~/server/transactions";

type MockPairing = {
  id: string;
  termActive: boolean;
  groupId: string | null;
  tutees: { status: "ACTIVE" | "PENDING" | "INACTIVE" }[];
};

function matchesPairingWhere(
  row: MockPairing,
  allRows: readonly MockPairing[],
  where: Prisma.PairingWhereInput,
): boolean {
  if (where.id && typeof where.id === "object" && "notIn" in where.id) {
    const excluded = Array.isArray(where.id.notIn) ? where.id.notIn : [];
    if (excluded.includes(row.id)) return false;
  }
  if (where.term && typeof where.term === "object" && "active" in where.term) {
    if (where.term.active !== row.termActive) return false;
  }
  if (where.tutees?.some?.tutee?.status) {
    const statusFilter = where.tutees.some.tutee.status;
    if (
      typeof statusFilter === "object" &&
      "not" in statusFilter &&
      !row.tutees.some((student) => student.status !== statusFilter.not)
    ) {
      return false;
    }
  }
  if (where.group?.pairings?.some) {
    if (!row.groupId) return false;
    const siblingFilter = where.group.pairings.some;
    const siblings = allRows.filter((other) => other.groupId === row.groupId);
    if (!siblings.some((sibling) => matchesPairingWhere(sibling, allRows, siblingFilter))) {
      return false;
    }
  }
  if (where.OR) {
    const clauses = Array.isArray(where.OR) ? where.OR : [where.OR];
    if (!clauses.some((clause) => matchesPairingWhere(row, allRows, clause))) {
      return false;
    }
  }
  if (where.AND) {
    const clauses = Array.isArray(where.AND) ? where.AND : [where.AND];
    if (!clauses.every((clause) => matchesPairingWhere(row, allRows, clause))) {
      return false;
    }
  }
  return true;
}

describe("activePairingRosterWhere", () => {
  it("hides disbanded standalone and completely empty groups while retaining active and repairable groups", () => {
    const rows: MockPairing[] = [
      { id: "active", termActive: true, groupId: null, tutees: [{ status: "ACTIVE" }] },
      { id: "pending", termActive: true, groupId: null, tutees: [{ status: "PENDING" }] },
      { id: "disbanded", termActive: true, groupId: null, tutees: [] },
      { id: "inactive-only", termActive: true, groupId: null, tutees: [{ status: "INACTIVE" }] },
      { id: "repair-populated", termActive: true, groupId: "g-repair", tutees: [{ status: "ACTIVE" }] },
      { id: "repair-empty", termActive: true, groupId: "g-repair", tutees: [] },
      { id: "group-empty-a", termActive: true, groupId: "g-disbanded", tutees: [] },
      { id: "group-empty-b", termActive: true, groupId: "g-disbanded", tutees: [{ status: "INACTIVE" }] },
      { id: "superseded-populated", termActive: true, groupId: "g-superseded", tutees: [{ status: "ACTIVE" }] },
      { id: "superseded-empty-sibling", termActive: true, groupId: "g-superseded", tutees: [] },
      { id: "past-populated", termActive: false, groupId: "g-cross-term", tutees: [{ status: "ACTIVE" }] },
      { id: "current-empty-cross-term", termActive: true, groupId: "g-cross-term", tutees: [] },
    ];
    const superseded = ["superseded-populated"];
    const where: Prisma.PairingWhereInput = {
      id: { notIn: superseded },
      term: { active: true },
      ...activePairingRosterWhere(superseded),
    };

    const visible = rows
      .filter((row) => matchesPairingWhere(row, rows, where))
      .map((row) => row.id);

    expect(visible).toEqual([
      "active",
      "pending",
      "repair-populated",
      "repair-empty",
    ]);
  });
});

describe("active pairings queries apply activePairingRosterWhere", () => {
  function mockDb(superseded: string[] = ["old-pairing"]) {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "u1",
          role: "ADMIN",
          name: "Staff",
          username: "staff",
          tutorId: "t1",
          suspendedAt: null,
          mergedIntoId: null,
          recoveryVoidedAt: null,
          tutorAccessRevoked: false,
          historyAccessRevision: 0,
          schoolDeparture: null,
        }),
      },
      term: {
        findFirst: vi.fn().mockResolvedValue({ id: "term-1" }),
      },
      pairingExecutionSuccessor: {
        findMany: vi
          .fn()
          .mockResolvedValue(superseded.map((sourcePairingId) => ({ sourcePairingId }))),
      },
      pairing: { findMany },
      room: { findMany: vi.fn().mockResolvedValue([]) },
      timeSlot: { findMany: vi.fn().mockResolvedValue([]) },
      roomUnavailability: { findMany: vi.fn().mockResolvedValue([]) },
    };
    return { db: db as unknown as typeof database, findMany };
  }

  it("filters disbanded pairings out of admin.pairings, tutor.myPairings, tutor.schedule, and readPairingGroups", async () => {
    const superseded = ["old-pairing"];
    const expectedRoster = activePairingRosterWhere(superseded);

    const adminFixture = mockDb(superseded);
    const adminCaller = createCaller({
      db: adminFixture.db,
      headers: new Headers(),
      session: {
        user: { id: "u1", name: "Staff", email: "staff@example.test" },
        role: "ADMIN",
        tutorId: "t1",
        expires: "2099-01-01T00:00:00Z",
      },
    });
    await adminCaller.admin.pairings();
    expect(adminFixture.findMany.mock.calls.at(-1)?.[0]).toMatchObject({
      where: {
        id: { notIn: superseded },
        term: { active: true },
        ...expectedRoster,
      },
    });

    const tutorFixture = mockDb(superseded);
    const tutorCaller = createCaller({
      db: tutorFixture.db,
      headers: new Headers(),
      session: {
        user: { id: "u1", name: "Staff", email: "staff@example.test" },
        role: "TUTOR",
        tutorId: "t1",
        expires: "2099-01-01T00:00:00Z",
      },
    });
    await tutorCaller.tutor.myPairings();
    expect(tutorFixture.findMany.mock.calls.at(-1)?.[0]).toMatchObject({
      where: {
        id: { notIn: superseded },
        tutorId: "t1",
        term: { active: true },
        ...expectedRoster,
      },
    });

    await tutorCaller.tutor.schedule();
    expect(tutorFixture.findMany.mock.calls.at(-1)?.[0]).toMatchObject({
      where: {
        id: { notIn: superseded },
        term: { active: true },
        scheduleConfirmed: true,
        ...expectedRoster,
      },
    });

    const groupFixture = mockDb(superseded);
    await readPairingGroups(groupFixture.db, "t1");
    expect(groupFixture.findMany.mock.calls.at(-1)?.[0]).toMatchObject({
      where: {
        AND: [{ id: { notIn: superseded } }],
        tutorId: "t1",
        termId: "term-1",
        ...expectedRoster,
      },
    });
  });
});

describe("releaseDisbandedPairingReservations", () => {
  it("releases empty standalone pairings and completely empty groups while keeping partially-empty groups intact", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "p-still-active",
          groupId: null,
          scheduleConfirmed: true,
          roomId: "r1",
          roomNeedsAssignment: false,
          roomShortageKey: null,
          tutees: [{ tuteeId: "s1" }],
        },
        {
          id: "p-standalone-empty",
          groupId: null,
          scheduleConfirmed: true,
          roomId: "r2",
          roomNeedsAssignment: false,
          roomShortageKey: null,
          tutees: [],
        },
        {
          id: "p-partial-empty",
          groupId: "g-partial",
          scheduleConfirmed: true,
          roomId: "r3",
          roomNeedsAssignment: false,
          roomShortageKey: null,
          tutees: [],
        },
        {
          id: "p-group-empty-a",
          groupId: "g-empty",
          scheduleConfirmed: true,
          roomId: "r4",
          roomNeedsAssignment: false,
          roomShortageKey: null,
          tutees: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "p-partial-empty",
          groupId: "g-partial",
          scheduleConfirmed: true,
          roomId: "r3",
          roomNeedsAssignment: false,
          roomShortageKey: null,
          tutees: [],
        },
        {
          id: "p-partial-populated",
          groupId: "g-partial",
          scheduleConfirmed: true,
          roomId: "r3",
          roomNeedsAssignment: false,
          roomShortageKey: null,
          tutees: [{ tuteeId: "s2" }],
        },
        {
          id: "p-group-empty-a",
          groupId: "g-empty",
          scheduleConfirmed: true,
          roomId: "r4",
          roomNeedsAssignment: false,
          roomShortageKey: null,
          tutees: [],
        },
        {
          id: "p-group-empty-b",
          groupId: "g-empty",
          scheduleConfirmed: true,
          roomId: "r4",
          roomNeedsAssignment: false,
          roomShortageKey: null,
          tutees: [],
        },
      ]);
    const tx = {
      pairingExecutionSuccessor: { findMany: vi.fn().mockResolvedValue([]) },
      pairing: { findMany, updateMany },
      pairingGroup: { deleteMany },
    } as unknown as TransactionDb;

    const released = await releaseDisbandedPairingReservations(tx, [
      "p-still-active",
      "p-standalone-empty",
      "p-partial-empty",
      "p-group-empty-a",
    ]);

    expect(released).toEqual([
      "p-group-empty-a",
      "p-group-empty-b",
      "p-standalone-empty",
    ]);
    expect(updateMany.mock.calls.at(-1)?.[0]).toEqual({
      where: {
        id: {
          in: ["p-group-empty-a", "p-group-empty-b", "p-standalone-empty"],
        },
      },
      data: {
        groupId: null,
        scheduleConfirmed: false,
        roomId: null,
        roomNeedsAssignment: false,
        roomShortageKey: null,
        roomVersion: { increment: 1 },
      },
    });
    expect(deleteMany.mock.calls.at(-1)?.[0]).toEqual({
      where: { id: { in: ["g-empty"] }, pairings: { none: {} } },
    });
  });
});
