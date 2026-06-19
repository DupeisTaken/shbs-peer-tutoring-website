import type { Session } from "next-auth";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The router's tRPC context normally calls `auth()` (which pulls in next-auth and, transitively,
// `next/server` — not resolvable under Vitest's node runtime). These tests build the context
// explicitly via `createCaller`, so `auth()` is never used; mock the module to keep it out of
// the import graph.
vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { requireSelfOrAdmin } from "~/server/api/trpc";
import { db } from "~/server/db";

// Fixture ids (prefixed so they never collide with seed data).
const TERM = "test-term";
const TUTOR_A = "test-tutor-a";
const TUTOR_B = "test-tutor-b";
const TUTEE_1 = "test-tutee-1"; // on A's pairing
const TUTEE_2 = "test-tutee-2"; // NOT on A's pairing
const PAIRING_A = "test-pairing-a"; // belongs to tutor A

function session(
  tutorId: string | null,
  role: "TUTOR" | "COORDINATOR" | "ADMIN" = "TUTOR",
): Session {
  return {
    user: { id: `user-${tutorId ?? "none"}`, name: "Test", email: "t@example.com" },
    role,
    tutorId,
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

function caller(s: Session | null) {
  return createCaller({ db, session: s, headers: new Headers() });
}

/** Run a thunk and return the thrown TRPCError-like object (or throw if it didn't throw). */
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return (e as { code?: string }).code ?? "UNKNOWN";
  }
  throw new Error("expected the call to throw");
}

async function cleanup() {
  await db.session.deleteMany({ where: { tutorId: { in: [TUTOR_A, TUTOR_B] } } });
  await db.pairingTutee.deleteMany({ where: { pairingId: PAIRING_A } });
  await db.pairing.deleteMany({ where: { id: PAIRING_A } });
  await db.tutee.deleteMany({ where: { id: { in: [TUTEE_1, TUTEE_2] } } });
  await db.tutor.deleteMany({ where: { id: { in: [TUTOR_A, TUTOR_B] } } });
  await db.term.deleteMany({ where: { id: TERM } });
}

beforeAll(async () => {
  await cleanup();
  await db.term.create({ data: { id: TERM, name: "Test Term", quarter: "Q3" } });
  await db.tutor.createMany({
    data: [
      { id: TUTOR_A, englishName: "Tutor A" },
      { id: TUTOR_B, englishName: "Tutor B" },
    ],
  });
  await db.tutee.createMany({
    data: [
      { id: TUTEE_1, englishName: "Tutee One" },
      { id: TUTEE_2, englishName: "Tutee Two" },
    ],
  });
  await db.pairing.create({
    data: {
      id: PAIRING_A,
      tutorId: TUTOR_A,
      termId: TERM,
      subject: "Math",
      dayOfWeek: 1,
      startMin: 900, // 15:00
      endMin: 960, // 16:00
      tutees: { create: [{ tuteeId: TUTEE_1 }] },
    },
  });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("row-level scoping (the critical rule)", () => {
  it("a tutor sees only their own pairings", async () => {
    const aPairings = await caller(session(TUTOR_A)).tutor.myPairings();
    const bPairings = await caller(session(TUTOR_B)).tutor.myPairings();

    expect(aPairings.map((p) => p.id)).toContain(PAIRING_A);
    expect(bPairings.map((p) => p.id)).not.toContain(PAIRING_A);
  });

  it("a tutor cannot submit attendance for another tutor's pairing", async () => {
    const code = await codeOf(() =>
      caller(session(TUTOR_B)).tutor.submitAttendance({
        pairingId: PAIRING_A, // belongs to A
        date: new Date("2026-06-15T00:00:00Z"),
        status: "PRESENT",
        tuteeIds: [TUTEE_1],
      }),
    );
    expect(code).toBe("NOT_FOUND");
  });

  it("a tutor cannot record a tutee that is not on the pairing roster", async () => {
    const code = await codeOf(() =>
      caller(session(TUTOR_A)).tutor.submitAttendance({
        pairingId: PAIRING_A,
        date: new Date("2026-06-15T00:00:00Z"),
        status: "PRESENT",
        tuteeIds: [TUTEE_2], // not on the roster
      }),
    );
    expect(code).toBe("BAD_REQUEST");
  });

  it("a user without a tutorId is forbidden from tutor procedures", async () => {
    const code = await codeOf(() => caller(session(null)).tutor.myPairings());
    expect(code).toBe("FORBIDDEN");
  });

  it("an unauthenticated caller is unauthorized", async () => {
    const code = await codeOf(() => caller(null).tutor.myPairings());
    expect(code).toBe("UNAUTHORIZED");
  });

  it("a valid submission stores server-computed service hours", async () => {
    const created = await caller(session(TUTOR_A)).tutor.submitAttendance({
      pairingId: PAIRING_A,
      date: new Date("2026-06-15T00:00:00Z"),
      status: "PRESENT",
      tuteeIds: [TUTEE_1],
    });

    const row = await db.session.findUniqueOrThrow({ where: { id: created.id } });
    // 60 min, 1 tutee -> factor 2, 1.0h * 2 = 2.0
    expect(row.durationMin).toBe(60);
    expect(row.shFactor).toBe(2);
    expect(row.shCount).toBe(2);
    expect(row.month).toBe("2026-06");
    expect(row.tutorId).toBe(TUTOR_A);
  });

  it("the monthly total reflects only the caller's own sessions", async () => {
    const aTotal = await caller(session(TUTOR_A)).tutor.myMonthlyTotal({ month: "2026-06" });
    const bTotal = await caller(session(TUTOR_B)).tutor.myMonthlyTotal({ month: "2026-06" });

    expect(aTotal.earned).toBeGreaterThanOrEqual(2);
    expect(bTotal.earned).toBe(0);
  });
});

describe("requireSelfOrAdmin guard", () => {
  it("allows a tutor to act on their own tutorId", () => {
    expect(() =>
      requireSelfOrAdmin({ role: "TUTOR", tutorId: TUTOR_A }, TUTOR_A),
    ).not.toThrow();
  });

  it("blocks a tutor from acting on another tutorId", () => {
    expect(() =>
      requireSelfOrAdmin({ role: "TUTOR", tutorId: TUTOR_A }, TUTOR_B),
    ).toThrow();
  });

  it("allows elevated roles to act on any tutorId", () => {
    expect(() =>
      requireSelfOrAdmin({ role: "COORDINATOR", tutorId: null }, TUTOR_A),
    ).not.toThrow();
    expect(() =>
      requireSelfOrAdmin({ role: "ADMIN", tutorId: null }, TUTOR_B),
    ).not.toThrow();
  });
});
