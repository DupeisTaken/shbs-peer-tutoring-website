import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { currentPolicy } from "~/server/policy-acceptance";
import { requireExistingRooms } from "~/server/room-references";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const legacyRoom = "legacy-room-2";
const userId = "room-reference-user";
const tutorId = "room-reference-tutor";
const tuteeId = "room-reference-tutee";
const pairingId = "room-reference-pairing";
let generatedRoom: string;

function caller(id = userId, role: Session["role"] = "TUTOR") {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, name: "Synthetic actor" },
      role,
      tutorId,
      expires: new Date(Date.now() + 60_000).toISOString(),
    },
  });
}
function attendance() {
  return {
    pairingId,
    date: new Date("2026-01-05T00:00:00Z"),
    tutorStatus: "PRESENT" as const,
    tutees: [{ tuteeId, status: "PRESENT" as const }],
    startMin: 900,
    endMin: 960,
    actualRoomId: legacyRoom as string | null | undefined,
    comments: "Synthetic attendance evidence",
    ratingPreparedness: 5,
    ratingParticipation: 5,
    ratingUnderstanding: 5,
    ratingBehavior: 5,
    ratingProgress: 5,
  };
}
function patrol(roomIds = [legacyRoom]) {
  return {
    submissionKey: randomUUID(),
    observations: roomIds.map((roomId) => ({
      roomId,
      headcount: "ONE" as const,
      observedAt: new Date(),
    })),
  };
}
// Failed attempts may be audited, but no applied write, evidence or credit may
// escape a rejection. Compare durable domain effects rather than mocking writes.
async function writes() {
  return {
    sessions: await db.session.count(),
    attendance: await db.sessionTutee.count(),
    patrols: await db.patrol.count(),
    observations: await db.patrolObservation.count(),
    claims: await db.patrolCreditWindow.count(),
    hours: await db.serviceHourAdjustment.count(),
    flags: await db.sessionFlag.count(),
    cards: await db.disciplinaryCard.count(),
    notifications: await db.notification.count(),
    // Successful retries legitimately add NO_CHANGE audit receipts.
    audits: await db.auditLog.count({
      where: { details: { path: ["outcome"], equals: "APPLIED" } },
    }),
  };
}

beforeEach(async () => {
  // This file owns only the guarded disposable database. Files run serially.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.room.createMany({
    data: [
      { id: legacyRoom, name: "Legacy room" },
      { id: "2", name: "Numeric-key room" },
      { id: "00000000-0000-4000-8000-000000000002", name: "UUID-key room" },
    ],
  });
  generatedRoom = (
    await db.room.create({ data: { name: "Generated-key room" } })
  ).id;
  await db.term.create({
    data: {
      id: "room-reference-term",
      name: "Synthetic term",
      schoolYear: "26-27",
      quarter: "Q1",
      active: true,
    },
  });
  await db.tutor.create({
    data: { id: tutorId, englishName: "Synthetic tutor", status: "ACTIVE" },
  });
  await db.user.create({
    data: {
      id: userId,
      email: "room-reference@example.test",
      role: "TUTOR",
      tutorId,
      crewStatus: "ACTIVE",
    },
  });
  await db.tutee.create({
    data: { id: tuteeId, englishName: "Synthetic tutee", status: "ACTIVE" },
  });
  await db.pairing.create({
    data: {
      id: pairingId,
      tutorId,
      termId: "room-reference-term",
      subject: "Synthetic subject",
      scheduleConfirmed: true,
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      tutees: { create: { tuteeId } },
    },
  });
  await db.policyDocument.create({
    data: {
      slug: "tutor-policy",
      locale: "en",
      title: "Synthetic policy",
      body: "Synthetic policy",
      version: "1",
    },
  });
  const policy = await currentPolicy(db, "tutor-policy");
  await db.policyAcceptance.create({
    data: {
      userId,
      slug: "tutor-policy",
      revision: policy.revision,
      snapshot: policy.documents,
      signature: "Synthetic tutor",
    },
  });
});
afterAll(async () => {
  await db.$disconnect();
});

it.each([legacyRoom, "2", "00000000-0000-4000-8000-000000000002", "generated"])(
  "records attendance and patrol with an existing opaque room ID: %s",
  async (key) => {
    const roomId = key === "generated" ? generatedRoom : key;
    expect(
      (await caller().tutor.rooms()).some((room) => room.id === roomId),
    ).toBe(true);
    expect(
      (await caller().crew.patrolConfig()).rooms.some(
        (room) => room.id === roomId,
      ),
    ).toBe(true);
    const saved = await caller().tutor.submitAttendance({
      ...attendance(),
      actualRoomId: roomId,
    });
    expect(
      await db.session.findUniqueOrThrow({ where: { id: saved.id } }),
    ).toMatchObject({
      actualRoomId: roomId,
      online: false,
      shCount: 2,
    });
    const observed = await caller().crew.submitPatrol(patrol([roomId]));
    expect(observed.hours).toBe(0.5);
    expect(await db.patrolObservation.findFirstOrThrow()).toMatchObject({
      roomId,
      patrolId: observed.id,
    });
    expect(
      (await db.room.findUniqueOrThrow({ where: { id: roomId } })).id,
    ).toBe(roomId);
  },
);

it.each([null, undefined])(
  "retains a legacy assigned-room default for override %s",
  async (override) => {
    await db.pairing.update({
      where: { id: pairingId },
      data: { roomId: legacyRoom },
    });
    const result = await caller().tutor.submitAttendance({
      ...attendance(),
      actualRoomId: override,
    });
    expect(
      await db.session.findUniqueOrThrow({ where: { id: result.id } }),
    ).toMatchObject({ actualRoomId: legacyRoom });
  },
);

it("keeps physical attendance without an assigned room valid", async () => {
  const result = await caller().tutor.submitAttendance({
    ...attendance(),
    actualRoomId: null,
  });
  expect(
    await db.session.findUniqueOrThrow({ where: { id: result.id } }),
  ).toMatchObject({ actualRoomId: null, online: false });
});

it("online attendance ignores a stale physical-room override and the assigned room", async () => {
  await db.pairing.update({
    where: { id: pairingId },
    data: { roomId: legacyRoom },
  });
  const result = await caller().tutor.submitAttendance({
    ...attendance(),
    online: true,
    actualRoomId: "deleted-room",
  });
  expect(
    await db.session.findUniqueOrThrow({ where: { id: result.id } }),
  ).toMatchObject({ actualRoomId: null, online: true });
});

it.each(["attendance", "patrol"] as const)(
  "rejects blank %s room IDs without partial writes",
  async (kind) => {
    const before = await writes();
    const request =
      kind === "attendance"
        ? caller().tutor.submitAttendance({ ...attendance(), actualRoomId: "" })
        : caller().crew.submitPatrol(patrol([""]));
    await expect(request).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await writes()).toEqual(before);
  },
);

it.each(["attendance", "patrol"] as const)(
  "rejects a deleted %s room with a useful error and no partial writes",
  async (kind) => {
    await db.room.delete({ where: { id: legacyRoom } });
    const before = await writes();
    const request =
      kind === "attendance"
        ? caller().tutor.submitAttendance(attendance())
        : caller().crew.submitPatrol(patrol([generatedRoom, legacyRoom]));
    await expect(request).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "A selected room no longer exists. Refresh the room list and select the room used.",
    });
    expect(await writes()).toEqual(before);
  },
);

it("validates room existence for a tutor-absent record too", async () => {
  const before = await writes();
  await expect(
    caller().tutor.submitAttendance({
      ...attendance(),
      tutorStatus: "TUTOR_ABSENT",
      tutorAbsentReason: "Synthetic reason",
      actualRoomId: "unknown-room",
    }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message:
      "A selected room no longer exists. Refresh the room list and select the room used.",
  });
  expect(await writes()).toEqual(before);
});

it("merges legacy-room attendance, credits once, and replays without duplicate records", async () => {
  await db.pairing.create({
    data: {
      id: "room-reference-merged",
      tutorId,
      termId: "room-reference-term",
      subject: "Second subject",
      scheduleConfirmed: true,
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      tutees: { create: { tuteeId } },
    },
  });
  const input = { ...attendance(), mergePairingIds: ["room-reference-merged"] };
  const first = await caller().tutor.submitAttendance(input);
  const before = await writes();
  expect(await caller().tutor.submitAttendance(input)).toEqual(first);
  expect(
    await db.session.findMany({
      select: { actualRoomId: true, shCount: true },
    }),
  ).toEqual(
    expect.arrayContaining([
      { actualRoomId: legacyRoom, shCount: 2 },
      { actualRoomId: legacyRoom, shCount: 0 },
    ]),
  );
  expect(await writes()).toMatchObject({
    ...before,
    sessions: 2,
    attendance: 2,
  });
});

it("preserves attendance replay after its original room was deleted", async () => {
  const input = attendance();
  const saved = await caller().tutor.submitAttendance(input);
  await db.room.delete({ where: { id: legacyRoom } });
  expect(await caller().tutor.submitAttendance(input)).toEqual(saved);
  expect(await db.session.count()).toBe(1);
});

it("preserves patrol replay and cooldown across room catalogue changes", async () => {
  const input = patrol();
  const saved = await caller().crew.submitPatrol(input);
  // ON UPDATE CASCADE retains observations; the original receipt still uses the
  // submitted payload hash. Never rerun its room validation or award its credit.
  await db.room.update({
    where: { id: legacyRoom },
    data: { id: "renamed-legacy-room" },
  });
  const before = await writes();
  expect(await caller().crew.submitPatrol(input)).toEqual(saved);
  expect(await writes()).toEqual(before);
  const next = await caller().crew.submitPatrol(
    patrol(["renamed-legacy-room"]),
  );
  expect(next.hours).toBe(0);
  expect(await db.patrol.aggregate({ _sum: { hours: true } })).toMatchObject({
    _sum: { hours: 0.5 },
  });
});

it("retains roster, policy and crew authorization with legacy room IDs", async () => {
  const before = await writes();
  await expect(
    caller().tutor.submitAttendance({
      ...attendance(),
      tutees: [{ tuteeId: "outside-roster", status: "PRESENT" }],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await db.policyAcceptance.deleteMany();
  await expect(
    caller().tutor.submitAttendance(attendance()),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await db.user.update({
    where: { id: userId },
    data: { crewStatus: "INACTIVE" },
  });
  await expect(caller().crew.submitPatrol(patrol())).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(await writes()).toEqual(before);
});

it("locks referenced rooms until the write transaction ends", async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locked = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const writer = db.$transaction(async (tx) => {
    await requireExistingRooms(tx, [legacyRoom, generatedRoom, legacyRoom]);
    entered();
    await gate;
  });
  await locked;
  const deleting = db.room
    .delete({ where: { id: legacyRoom } })
    .then(() => undefined);
  try {
    await vi.waitFor(
      async () => {
        const waiting = await db.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM pg_locks WHERE locktype='transactionid' AND granted=false
      `;
        expect(Number(waiting[0]?.count)).toBeGreaterThan(0);
      },
      { timeout: 3000, interval: 20 },
    );
  } finally {
    release();
    await writer;
    await deleting;
  }
  expect(await db.room.findUnique({ where: { id: legacyRoom } })).toBeNull();
});
