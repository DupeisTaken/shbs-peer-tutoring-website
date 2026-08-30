import type { Session } from "next-auth";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Tests construct an explicit tRPC context, so the real Auth.js request lookup is unnecessary.
vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";

const TERM = "test-slot-term";
const TUTOR = "test-slot-tutor";
const SLOT = "test-slot-primary";
const OTHER_SLOT = "test-slot-other";
const PAIRING = "test-slot-pairing";
const CREDITED_SESSION = "test-slot-session-credited";
const MERGED_SIBLING = "test-slot-session-sibling";
const OTHER_SESSION = "test-slot-session-other";
const SESSION_IDS = [CREDITED_SESSION, MERGED_SIBLING, OTHER_SESSION];

const adminSession: Session = {
  user: {
    id: "test-slot-admin",
    name: "Schedule Admin",
    email: "admin@example.com",
  },
  role: "ADMIN",
  tutorId: null,
  expires: new Date(Date.now() + 3_600_000).toISOString(),
};

const caller = () =>
  createCaller({ db, session: adminSession, headers: new Headers() });

async function cleanup() {
  await db.session.deleteMany({ where: { id: { in: SESSION_IDS } } });
  await db.pairing.deleteMany({ where: { id: PAIRING } });
  await db.timeSlot.deleteMany({ where: { id: { in: [SLOT, OTHER_SLOT] } } });
  await db.tutor.deleteMany({ where: { id: TUTOR } });
  await db.term.deleteMany({ where: { id: TERM } });
}

beforeAll(async () => {
  await cleanup();
  await db.term.create({
    data: {
      id: TERM,
      name: "Slot Test Term",
      schoolYear: "99-00",
      quarter: "Q3",
      active: true,
    },
  });
  await db.tutor.create({
    data: { id: TUTOR, englishName: "Slot Test Tutor" },
  });
  await db.timeSlot.createMany({
    data: [
      { id: SLOT, label: "Monday A", dayOfWeek: 1, startMin: 900, endMin: 960 },
      {
        id: OTHER_SLOT,
        label: "Tuesday B",
        dayOfWeek: 2,
        startMin: 600,
        endMin: 660,
      },
    ],
  });
  await db.pairing.create({
    data: {
      id: PAIRING,
      tutorId: TUTOR,
      termId: TERM,
      timeSlotId: SLOT,
      subject: "Mathematics",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
});

beforeEach(async () => {
  await db.session.deleteMany({ where: { id: { in: SESSION_IDS } } });
  await db.timeSlot.update({
    where: { id: SLOT },
    data: {
      label: "Monday A",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      active: true,
    },
  });
  await db.pairing.update({
    where: { id: PAIRING },
    data: { timeSlotId: SLOT, dayOfWeek: 1, startMin: 900, endMin: 960 },
  });
  const shared = {
    date: new Date("2099-04-06T00:00:00Z"),
    tutorStatus: "PRESENT" as const,
    month: "2099-04",
    schoolYear: "99-00",
    quarter: "Q3" as const,
    pairingId: PAIRING,
    tutorId: TUTOR,
  };
  await db.session.createMany({
    data: [
      {
        ...shared,
        id: CREDITED_SESSION,
        timeSlotId: SLOT,
        startMin: 900,
        endMin: 960,
        durationMin: 60,
        shFactor: 2,
        shCount: 2,
        mergeGroupId: CREDITED_SESSION,
      },
      {
        ...shared,
        id: MERGED_SIBLING,
        timeSlotId: SLOT,
        startMin: 900,
        endMin: 960,
        durationMin: 60,
        shFactor: 0,
        shCount: 0,
        mergeGroupId: CREDITED_SESSION,
      },
      {
        ...shared,
        id: OTHER_SESSION,
        timeSlotId: OTHER_SLOT,
        startMin: 600,
        endMin: 660,
        durationMin: 60,
        shFactor: 2,
        shCount: 2,
      },
    ],
  });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("time-slot schedule propagation", () => {
  it("updates the slot, linked pairing, and every session stamped with that slot", async () => {
    const result = await caller().admin.updateTimeSlot({
      id: SLOT,
      label: "Wednesday Extended",
      dayOfWeek: 3,
      startMin: 810,
      endMin: 900,
      active: true,
    });

    expect(result.updatedPairings).toBe(1);
    expect(result.updatedSessions).toBe(2);
    await expect(
      db.pairing.findUniqueOrThrow({ where: { id: PAIRING } }),
    ).resolves.toMatchObject({
      dayOfWeek: 3,
      startMin: 810,
      endMin: 900,
    });

    const sessions = await db.session.findMany({
      where: { id: { in: SESSION_IDS } },
    });
    const byId = new Map(sessions.map((session) => [session.id, session]));
    expect(byId.get(CREDITED_SESSION)).toMatchObject({
      startMin: 810,
      endMin: 900,
      durationMin: 90,
      shFactor: 2,
      shCount: 3,
    });
    expect(byId.get(MERGED_SIBLING)).toMatchObject({
      startMin: 810,
      endMin: 900,
      durationMin: 90,
      shFactor: 0,
      shCount: 0,
    });
    expect(byId.get(OTHER_SESSION)).toMatchObject({
      startMin: 600,
      endMin: 660,
      durationMin: 60,
      shCount: 2,
    });
  });

  it("moves the recurring weekday without changing historical session dates or clock times", async () => {
    const before = await db.session.findUniqueOrThrow({
      where: { id: CREDITED_SESSION },
    });
    const result = await caller().admin.updateTimeSlot({
      id: SLOT,
      label: "Thursday A",
      dayOfWeek: 4,
      startMin: 900,
      endMin: 960,
      active: true,
    });

    const after = await db.session.findUniqueOrThrow({
      where: { id: CREDITED_SESSION },
    });
    expect(result).toMatchObject({ updatedPairings: 1, updatedSessions: 0 });
    expect(after.date).toEqual(before.date);
    expect(after).toMatchObject({
      startMin: 900,
      endMin: 960,
      durationMin: 60,
      shCount: 2,
    });
  });

  it("rejects an invalid time range before changing any linked records", async () => {
    await expect(
      caller().admin.updateTimeSlot({
        id: SLOT,
        label: "Broken",
        dayOfWeek: 1,
        startMin: 960,
        endMin: 900,
        active: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      db.timeSlot.findUniqueOrThrow({ where: { id: SLOT } }),
    ).resolves.toMatchObject({
      label: "Monday A",
      startMin: 900,
      endMin: 960,
    });
    await expect(
      db.pairing.findUniqueOrThrow({ where: { id: PAIRING } }),
    ).resolves.toMatchObject({
      startMin: 900,
      endMin: 960,
    });
  });
});
