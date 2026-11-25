import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import type { PrismaClient } from "../../generated/prisma";
import { getActiveSemesterPatrolScope } from "./period";

function mockDb(activeTerm: {
  id: string;
  schoolYear: string;
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  name: string;
} | null, semesterTerms: { id: string }[]) {
  const patrolAggregate = vi.fn().mockResolvedValue({
    _sum: { hours: 1.5 },
    _count: { _all: 3 },
  });
  const patrolGroupBy = vi.fn().mockResolvedValue([
    { crewUserId: "crew-1", _sum: { hours: 1 }, _count: { _all: 2 } },
    { crewUserId: "crew-retired", _sum: { hours: 0.5 }, _count: { _all: 1 } },
  ]);
  const termFindMany = vi.fn().mockResolvedValue(semesterTerms);

  const db = {
    term: {
      findFirst: vi.fn().mockResolvedValue(
        activeTerm
          ? {
              ...activeTerm,
              active: true,
              signupEnabled: true,
              signupClosesAt: null,
              signupOpensAt: null,
              signupPreviewUrl: null,
              tutorSignupEnabled: true,
              tutorSignupOpensAt: null,
              tutorSignupClosesAt: null,
              tutorSignupPreviewUrl: null,
            }
          : null,
      ),
      findMany: termFindMany,
    },
    programFeature: {
      findMany: vi.fn().mockResolvedValue([{ key: "CREW", enabled: true }]),
    },
    room: {
      findMany: vi.fn().mockResolvedValue([{ id: "room-1", name: "A101" }]),
    },
    user: {
      findUnique: vi.fn().mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === "head-1") {
            return Promise.resolve({
              id: "head-1",
              role: "HEAD",
              tutorId: null,
              tutorAccessRevoked: false,
              crewStatus: "ACTIVE",
              canTranslate: false,
              tuteeMember: false,
              suspendedAt: null,
              mergedIntoId: null,
              recoveryVoidedAt: null,
              sessionVersion: 0,
              historyAccessRevision: 0,
            });
          }
          return Promise.resolve({
            id: "crew-1",
            role: "TUTOR",
            tutorId: "tutor-1",
            tutorAccessRevoked: false,
            crewStatus: "ACTIVE",
            canTranslate: false,
            tuteeMember: false,
            suspendedAt: null,
            mergedIntoId: null,
            recoveryVoidedAt: null,
            sessionVersion: 0,
            historyAccessRevision: 0,
          });
        },
      ),
      findMany: vi.fn().mockImplementation(
        ({ where }: { where?: Record<string, unknown> }) => {
          if (where && "mergedIntoId" in where) {
            if (typeof where.mergedIntoId === "string")
              return Promise.resolve([{ id: "crew-retired" }]);
            if (where.mergedIntoId === null) {
              return Promise.resolve([
                {
                  id: "crew-1",
                  name: "Crew One",
                  username: "crew1",
                  role: "TUTOR",
                  crewStatus: "ACTIVE",
                  tutor: { englishName: "Crew One" },
                },
              ]);
            }
            return Promise.resolve([
              { id: "crew-retired", mergedIntoId: "crew-1" },
            ]);
          }
          return Promise.resolve([]);
        },
      ),
      count: vi.fn().mockResolvedValue(1),
    },
    patrol: {
      aggregate: patrolAggregate,
      groupBy: patrolGroupBy,
    },
    sessionFlag: { count: vi.fn().mockResolvedValue(0) },
    crewApplication: { count: vi.fn().mockResolvedValue(0) },
    crewStatusRequest: { count: vi.fn().mockResolvedValue(0) },
    schoolDeparture: { findUnique: vi.fn().mockResolvedValue(null) },
    retiredHistoryOwnership: {
      findMany: vi.fn().mockResolvedValue([{ sourceUserId: "crew-retired" }]),
    },
  } as unknown as PrismaClient;

  return { db, patrolAggregate, patrolGroupBy, termFindMany };
}

function callerFor(
  db: PrismaClient,
  id: string,
  role: Session["role"],
  tutorId: string | null = null,
) {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: id },
      role,
      tutorId,
      sessionVersion: 0,
      historyAccessRevision: 0,
      expires: "2099-01-01",
    },
  });
}

describe("crew semester service-hour scoping", () => {
  it("resolves both quarters of the active semester and returns null when no term is active", async () => {
    const s1 = mockDb(
      { id: "t-q2", schoolYear: "26-27", quarter: "Q2", name: "26-27 Q2" },
      [{ id: "t-q1" }, { id: "t-q2" }],
    );
    expect(await getActiveSemesterPatrolScope(s1.db)).toEqual({
      periodLabel: "26-27 S1",
      schoolYear: "26-27",
      semester: "S1",
      termIds: ["t-q1", "t-q2"],
    });
    expect(s1.termFindMany).toHaveBeenCalledWith({
      where: { schoolYear: "26-27", quarter: { in: ["Q1", "Q2"] } },
      select: { id: true },
    });

    const s2 = mockDb(
      { id: "t-q3", schoolYear: "26-27", quarter: "Q3", name: "26-27 Q3" },
      [{ id: "t-q3" }],
    );
    expect(await getActiveSemesterPatrolScope(s2.db)).toEqual({
      periodLabel: "26-27 S2",
      schoolYear: "26-27",
      semester: "S2",
      termIds: ["t-q3"],
    });
    expect(s2.termFindMany).toHaveBeenCalledWith({
      where: { schoolYear: "26-27", quarter: { in: ["Q3", "Q4"] } },
      select: { id: true },
    });

    const none = mockDb(null, []);
    expect(await getActiveSemesterPatrolScope(none.db)).toBeNull();
    expect(none.termFindMany).not.toHaveBeenCalled();
  });

  it("scopes patrolConfig, myCrew, crewRoster and crewSummary to the active semester terms", async () => {
    const { db, patrolAggregate, patrolGroupBy } = mockDb(
      { id: "t-q2", schoolYear: "26-27", quarter: "Q2", name: "26-27 Q2" },
      [{ id: "t-q1" }, { id: "t-q2" }],
    );
    const crew = callerFor(db, "crew-1", "TUTOR", "tutor-1");
    const head = callerFor(db, "head-1", "HEAD");

    expect(await crew.crew.patrolConfig()).toEqual({
      rooms: [{ id: "room-1", name: "A101" }],
      periodLabel: "26-27 S1",
      schoolYear: "26-27",
      semester: "S1",
      myPatrols: 3,
      myHours: 1.5,
    });
    expect(patrolAggregate).toHaveBeenLastCalledWith({
      where: {
        crewUserId: { in: ["crew-1", "crew-retired"] },
        termId: { in: ["t-q1", "t-q2"] },
      },
      _sum: { hours: true },
      _count: { _all: true },
    });

    expect(await crew.tutor.myCrew()).toEqual({
      isCrew: true,
      patrols: 3,
      hours: 1.5,
    });
    expect(patrolAggregate).toHaveBeenLastCalledWith({
      where: {
        crewUserId: { in: ["crew-1", "crew-retired"] },
        termId: { in: ["t-q1", "t-q2"] },
      },
      _sum: { hours: true },
      _count: { _all: true },
    });

    expect(await head.admin.crewRoster()).toEqual([
      expect.objectContaining({ id: "crew-1", patrols: 3, hours: 1.5 }),
    ]);
    expect(patrolGroupBy).toHaveBeenCalledWith({
      by: ["crewUserId"],
      where: { termId: { in: ["t-q1", "t-q2"] } },
      _sum: { hours: true },
      _count: { _all: true },
    });

    expect(await head.admin.crewSummary()).toMatchObject({
      patrols: 3,
      hours: 1.5,
    });
    expect(patrolAggregate).toHaveBeenLastCalledWith({
      where: { termId: { in: ["t-q1", "t-q2"] } },
      _sum: { hours: true },
      _count: { _all: true },
    });
  });

  it("returns zero patrols and hours across all crew endpoints when no active term exists", async () => {
    const { db, patrolAggregate, patrolGroupBy } = mockDb(null, []);
    const crew = callerFor(db, "crew-1", "TUTOR", "tutor-1");
    const head = callerFor(db, "head-1", "HEAD");

    expect(await crew.crew.patrolConfig()).toEqual({
      rooms: [{ id: "room-1", name: "A101" }],
      periodLabel: null,
      schoolYear: null,
      semester: null,
      myPatrols: 0,
      myHours: 0,
    });
    expect(await crew.tutor.myCrew()).toEqual({
      isCrew: true,
      patrols: 0,
      hours: 0,
    });
    expect(await head.admin.crewRoster()).toEqual([
      expect.objectContaining({ id: "crew-1", patrols: 0, hours: 0 }),
    ]);
    expect(await head.admin.crewSummary()).toMatchObject({
      patrols: 0,
      hours: 0,
    });
    expect(patrolAggregate).not.toHaveBeenCalled();
    expect(patrolGroupBy).not.toHaveBeenCalled();
  });
});
