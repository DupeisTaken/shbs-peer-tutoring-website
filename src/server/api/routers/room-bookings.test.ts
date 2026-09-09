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

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";

const SCHOOL_YEAR = "97-98";
const ROOM_PREFIX = "Booking Integrity";
const SLOT_PREFIX = "Booking Integrity";
const TUTOR_PREFIX = "Booking Integrity";

let termId: string;
let roomA: string;
let roomB: string;
let roomC: string;
let roomRace: string;
let slotMonday: string;
let slotOverlap: string;
let slotAdjacent: string;
let slotTuesday: string;
let slotWednesday: string;
let tutorA: string;
let tutorB: string;
let tutorC: string;
let updatePairingId: string;
let tutorPairingId: string;
let tutorUserId: string;
let previousActiveTermIds: string[] = [];

const adminSession: Session = {
  user: {
    id: "booking-integrity-admin",
    name: "Booking Integrity Admin",
    email: "booking-integrity-admin@example.test",
  },
  role: "ADMIN",
  tutorId: null,
  expires: new Date(Date.now() + 3_600_000).toISOString(),
};

const admin = () =>
  createCaller({ db, session: adminSession, headers: new Headers() });
const tutor = () =>
  createCaller({
    db,
    session: {
      user: {
        id: tutorUserId,
        name: "Booking Integrity Tutor C",
        email: "booking-integrity-tutor-c@example.test",
      },
      role: "TUTOR",
      tutorId: tutorC,
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
    headers: new Headers(),
  });

async function removeFixture() {
  await db.user.deleteMany({
    where: { email: { contains: "booking-integrity-" } },
  });
  await db.pairing.deleteMany({ where: { term: { schoolYear: SCHOOL_YEAR } } });
  await db.roomUnavailability.deleteMany({
    where: { room: { name: { startsWith: ROOM_PREFIX } } },
  });
  await db.timeSlot.deleteMany({
    where: { label: { startsWith: SLOT_PREFIX } },
  });
  await db.room.deleteMany({
    where: { name: { startsWith: ROOM_PREFIX } },
  });
  await db.tutor.deleteMany({
    where: { englishName: { startsWith: TUTOR_PREFIX } },
  });
  await db.term.deleteMany({ where: { schoolYear: SCHOOL_YEAR } });
}

beforeAll(async () => {
  await removeFixture();
  previousActiveTermIds = (
    await db.term.findMany({ where: { active: true }, select: { id: true } })
  ).map((term) => term.id);
  await db.term.updateMany({
    where: { active: true },
    data: { active: false },
  });

  const [term, firstRoom, secondRoom, thirdRoom, raceRoom] = await Promise.all([
    db.term.create({
      data: {
        schoolYear: SCHOOL_YEAR,
        quarter: "Q1",
        name: `${SCHOOL_YEAR} Q1`,
        active: true,
      },
    }),
    db.room.create({ data: { name: `${ROOM_PREFIX} A` } }),
    db.room.create({ data: { name: `${ROOM_PREFIX} B` } }),
    db.room.create({ data: { name: `${ROOM_PREFIX} C` } }),
    db.room.create({ data: { name: `${ROOM_PREFIX} Race` } }),
  ]);
  termId = term.id;
  roomA = firstRoom.id;
  roomB = secondRoom.id;
  roomC = thirdRoom.id;
  roomRace = raceRoom.id;

  const [monday, overlap, adjacent, tuesday, wednesday] = await Promise.all([
    db.timeSlot.create({
      data: {
        label: `${SLOT_PREFIX} Monday`,
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
      },
    }),
    db.timeSlot.create({
      data: {
        label: `${SLOT_PREFIX} Overlap`,
        dayOfWeek: 1,
        startMin: 930,
        endMin: 990,
      },
    }),
    db.timeSlot.create({
      data: {
        label: `${SLOT_PREFIX} Adjacent`,
        dayOfWeek: 1,
        startMin: 960,
        endMin: 1020,
      },
    }),
    db.timeSlot.create({
      data: {
        label: `${SLOT_PREFIX} Tuesday`,
        dayOfWeek: 2,
        startMin: 900,
        endMin: 960,
      },
    }),
    db.timeSlot.create({
      data: {
        label: `${SLOT_PREFIX} Wednesday`,
        dayOfWeek: 3,
        startMin: 900,
        endMin: 960,
      },
    }),
  ]);
  slotMonday = monday.id;
  slotOverlap = overlap.id;
  slotAdjacent = adjacent.id;
  slotTuesday = tuesday.id;
  slotWednesday = wednesday.id;

  const [firstTutor, secondTutor, thirdTutor] = await Promise.all([
    db.tutor.create({ data: { englishName: `${TUTOR_PREFIX} Tutor A` } }),
    db.tutor.create({ data: { englishName: `${TUTOR_PREFIX} Tutor B` } }),
    db.tutor.create({ data: { englishName: `${TUTOR_PREFIX} Tutor C` } }),
  ]);
  tutorA = firstTutor.id;
  tutorB = secondTutor.id;
  tutorC = thirdTutor.id;
  await db.user.create({
    data: {
      id: adminSession.user.id,
      email: "booking-integrity-admin@example.test",
      name: adminSession.user.name,
      role: "ADMIN",
    },
  });
  const user = await db.user.create({
    data: {
      email: "booking-integrity-tutor-c@example.test",
      name: `${TUTOR_PREFIX} Tutor C`,
      role: "TUTOR",
      tutorId: tutorC,
    },
  });
  tutorUserId = user.id;
});

beforeEach(async () => {
  await db.pairing.deleteMany({ where: { termId } });
  await db.roomUnavailability.deleteMany({
    where: { roomId: { in: [roomA, roomB, roomC, roomRace] } },
  });
  const rows = await Promise.all([
    db.pairing.create({
      data: {
        termId,
        tutorId: tutorA,
        roomId: roomA,
        timeSlotId: slotMonday,
        subject: "Existing A",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
      },
    }),
    db.pairing.create({
      data: {
        termId,
        tutorId: tutorB,
        roomId: roomB,
        timeSlotId: slotMonday,
        subject: "Update target",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
      },
    }),
    db.pairing.create({
      data: {
        termId,
        tutorId: tutorC,
        roomId: roomC,
        timeSlotId: slotWednesday,
        subject: "Tutor target",
        dayOfWeek: 3,
        startMin: 900,
        endMin: 960,
      },
    }),
    db.pairing.create({
      data: {
        termId,
        tutorId: tutorA,
        roomId: roomC,
        timeSlotId: slotMonday,
        subject: "Existing C",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
      },
    }),
  ]);
  updatePairingId = rows[1].id;
  tutorPairingId = rows[2].id;
  await db.roomUnavailability.createMany({
    data: [
      { roomId: roomA, dayOfWeek: 2, startMin: 900, endMin: 960 },
      { roomId: roomC, dayOfWeek: 2, startMin: 900, endMin: 960 },
    ],
  });
});

afterAll(async () => {
  await removeFixture();
  if (previousActiveTermIds.length) {
    await db.term.updateMany({
      where: { id: { in: previousActiveTermIds } },
      data: { active: true },
    });
  }
  await db.$disconnect();
});

describe("planned room booking integrity", () => {
  it("rejects overlapping and blacked-out admin creates but permits adjacency", async () => {
    await expect(
      admin().admin.createPairing({
        tutorId: tutorB,
        roomId: roomA,
        timeSlotId: slotOverlap,
        subject: "Overlap",
        tuteeIds: [],
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That room is already booked during the selected time.",
    });
    await expect(
      admin().admin.createPairing({
        tutorId: tutorB,
        roomId: roomA,
        timeSlotId: slotTuesday,
        subject: "Blackout",
        tuteeIds: [],
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That room is unavailable during the selected time.",
    });

    await expect(
      admin().admin.createPairing({
        tutorId: tutorB,
        roomId: roomA,
        timeSlotId: slotAdjacent,
        subject: "Adjacent",
        tuteeIds: [],
      }),
    ).resolves.toMatchObject({ startMin: 960, endMin: 1020 });
  });

  it("excludes the edited pairing itself and rejects an update into a conflict", async () => {
    await expect(
      admin().admin.updatePairing({
        id: updatePairingId,
        tutorId: tutorB,
        roomId: roomB,
        timeSlotId: slotMonday,
        subject: "Self update",
        tuteeIds: [],
      }),
    ).resolves.toMatchObject({ id: updatePairingId });

    await expect(
      admin().admin.updatePairing({
        id: updatePairingId,
        tutorId: tutorB,
        roomId: roomA,
        timeSlotId: slotOverlap,
        subject: "Conflicting update",
        tuteeIds: [],
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That room is already booked during the selected time.",
    });
  });

  it("rejects tutor slot conflicts and blackouts but permits back-to-back slots", async () => {
    await expect(
      tutor().tutor.setPairingSlot({
        pairingId: tutorPairingId,
        slotId: slotOverlap,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That room is already booked during the selected time.",
    });
    await expect(
      tutor().tutor.setPairingSlot({
        pairingId: tutorPairingId,
        slotId: slotTuesday,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That room is unavailable during the selected time.",
    });
    await expect(
      tutor().tutor.setPairingSlot({
        pairingId: tutorPairingId,
        slotId: slotAdjacent,
      }),
    ).resolves.toMatchObject({ startMin: 960, endMin: 1020 });
  });

  it("prevents a recurring blackout from covering an active booking", async () => {
    await expect(
      admin().admin.createRoomUnavailability({
        roomId: roomA,
        dayOfWeek: 1,
        startMin: 930,
        endMin: 990,
        reason: "Assembly",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That room already has a planned booking during this time.",
    });
    await expect(
      admin().admin.createRoomUnavailability({
        roomId: roomA,
        dayOfWeek: 1,
        startMin: 960,
        endMin: 1020,
        reason: "After tutoring",
      }),
    ).resolves.toMatchObject({ startMin: 960, endMin: 1020 });
  });

  it("rejects a catalog slot edit that would move linked pairings into a conflict", async () => {
    await expect(
      admin().admin.updateTimeSlot({
        id: slotWednesday,
        label: `${SLOT_PREFIX} Conflicting move`,
        dayOfWeek: 1,
        startMin: 930,
        endMin: 990,
        active: true,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That room is already booked during the selected time.",
    });

    await expect(
      db.timeSlot.findUniqueOrThrow({ where: { id: slotWednesday } }),
    ).resolves.toMatchObject({ dayOfWeek: 3, startMin: 900, endMin: 960 });
    await expect(
      db.pairing.findUniqueOrThrow({ where: { id: tutorPairingId } }),
    ).resolves.toMatchObject({ dayOfWeek: 3, startMin: 900, endMin: 960 });
  });

  it("serializes simultaneous writes so only one room booking wins", async () => {
    const results = await Promise.allSettled([
      admin().admin.createPairing({
        tutorId: tutorA,
        roomId: roomRace,
        timeSlotId: slotMonday,
        subject: "Race A",
        tuteeIds: [],
      }),
      admin().admin.createPairing({
        tutorId: tutorB,
        roomId: roomRace,
        timeSlotId: slotMonday,
        subject: "Race B",
        tuteeIds: [],
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: {
        code: "CONFLICT",
        message: "That room is already booked during the selected time.",
      },
    });
    await expect(
      db.pairing.count({ where: { roomId: roomRace, termId } }),
    ).resolves.toBe(1);
  });
});
