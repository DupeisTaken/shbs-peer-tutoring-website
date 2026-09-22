import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";
import { finalizeDueOptOuts } from "~/server/discipline/removal";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { currentPolicy } from "~/server/policy-acceptance";
import { hashPassword } from "~/server/auth/password";
import * as reauthentication from "~/server/auth/reauth";

// These destructive fixtures run only against the operator-selected disposable test database.
assertIsolatedTestDatabase(process.env.DATABASE_URL);

let tutorId: string;
let tuteeId: string;
let userId: string;
let headId: string;
let currentTermId: string;
let priorTermId: string;
let pairingId: string;
let historicalPairingId: string;
let slotId: string;

function caller(role: Session["role"], id: string) {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id },
      role,
      tutorId: role === "TUTOR" ? tutorId : null,
      expires: new Date(Date.now() + 60_000).toISOString(),
    },
  });
}
const tutor = () => caller("TUTOR", userId);
const head = () => caller("HEAD", headId);

beforeEach(async () => {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  priorTermId = (
    await db.term.create({
      data: {
        schoolYear: "26-27",
        quarter: "Q1",
        name: "Prior",
        active: false,
      },
    })
  ).id;
  currentTermId = (
    await db.term.create({
      data: {
        schoolYear: "26-27",
        quarter: "Q2",
        name: "Current",
        active: true,
      },
    })
  ).id;
  tutorId = (
    await db.tutor.create({
      data: { englishName: "Audit tutor", status: "ACTIVE" },
    })
  ).id;
  tuteeId = (
    await db.tutee.create({
      data: { englishName: "Audit student", status: "ACTIVE" },
    })
  ).id;
  userId = (
    await db.user.create({
      data: {
        name: "Audit tutor",
        email: "workflow-tutor@example.test",
        role: "TUTOR",
        tutorId,
      },
    })
  ).id;
  headId = (
    await db.user.create({
      data: {
        name: "Audit head",
        email: "workflow-head@example.test",
        role: "HEAD",
      },
    })
  ).id;
  slotId = (
    await db.timeSlot.create({
      data: { label: "New slot", dayOfWeek: 2, startMin: 900, endMin: 960 },
    })
  ).id;
  const pairing = {
    tutorId,
    subject: "Audit math",
    dayOfWeek: 1,
    startMin: 900,
    endMin: 960,
    tutees: { create: { tuteeId } },
  };
  pairingId = (
    await db.pairing.create({ data: { ...pairing, termId: currentTermId } })
  ).id;
  historicalPairingId = (
    await db.pairing.create({ data: { ...pairing, termId: priorTermId } })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it.each(["PENDING", "OPTED_OUT", "GRADUATED", "ARCHIVED"] as const)(
  "audit: %s tutor cannot set or clear a pairing slot",
  async (status) => {
    await db.tutor.update({ where: { id: tutorId }, data: { status } });
    for (const value of [slotId, null])
      await expect(
        tutor().tutor.setPairingSlot({ pairingId, slotId: value }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await db.pairing.findUniqueOrThrow({ where: { id: pairingId } }),
    ).toMatchObject({ dayOfWeek: 1, timeSlotId: null });
  },
);

it("audit: active tutor cannot edit historical schedules or another tutor's pairing", async () => {
  await expect(
    tutor().tutor.setPairingSlot({ pairingId: historicalPairingId, slotId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    tutor().tutor.setPairingSlot({
      pairingId: historicalPairingId,
      slotId: null,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const other = await db.tutor.create({ data: { englishName: "Other tutor" } });
  await db.pairing.update({
    where: { id: pairingId },
    data: { tutorId: other.id },
  });
  await expect(
    tutor().tutor.setPairingSlot({ pairingId, slotId }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("audit: active tutor can set a current slot and clearing it preserves copied times", async () => {
  await tutor().tutor.setPairingSlot({ pairingId, slotId });
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: pairingId } }),
  ).toMatchObject({
    timeSlotId: slotId,
    dayOfWeek: 2,
    startMin: 900,
    endMin: 960,
  });
  await tutor().tutor.setPairingSlot({ pairingId, slotId: null });
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: pairingId } }),
  ).toMatchObject({
    timeSlotId: null,
    dayOfWeek: 2,
    startMin: 900,
    endMin: 960,
  });
});

it("audit: setting a student inactive preserves historical assignment evidence", async () => {
  const before = await db.tutee.findUniqueOrThrow({ where: { id: tuteeId } });
  await head().admin.setTuteeStatus({
    id: tuteeId,
    expectedUpdatedAt: before.updatedAt,
    status: "INACTIVE",
  });
  expect(await db.pairingTutee.findMany({ where: { tuteeId } })).toEqual([
    expect.objectContaining({ pairingId: historicalPairingId }),
  ]);
  expect(await db.auditLog.count({ where: { entityId: tuteeId } })).toBe(1);
});

it("audit: tutor cannot relay withdrawals against historical or inactive participation", async () => {
  await expect(
    tutor().tutor.requestTuteeRemoval({
      pairingId: historicalPairingId,
      tuteeId,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await db.tutee.update({
    where: { id: tuteeId },
    data: { status: "INACTIVE" },
  });
  await expect(
    tutor().tutor.requestTuteeRemoval({ pairingId, tuteeId }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.tuteeRemovalRequest.count()).toBe(0);
});

it("audit: a due historical withdrawal cannot remove current-period participation", async () => {
  const request = await db.tuteeRemovalRequest.create({
    data: {
      tuteeId,
      pairingId: historicalPairingId,
      requestedByTutorId: tutorId,
      kind: "VOLUNTARY",
      eligibleAt: new Date(Date.now() - 1000),
    },
  });
  expect(await finalizeDueOptOuts(db)).toBe(0);
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: tuteeId } }),
  ).toMatchObject({ status: "ACTIVE" });
  expect(await db.pairingTutee.count({ where: { tuteeId } })).toBe(2);
  expect(
    await db.tuteeRemovalRequest.findUniqueOrThrow({
      where: { id: request.id },
    }),
  ).toMatchObject({ state: "DENIED" });
});

it("audit: removed originating assignment invalidates a pending relay", async () => {
  const request = await tutor().tutor.requestTuteeRemoval({
    pairingId,
    tuteeId,
  });
  await db.tuteeRemovalRequest.update({
    where: { id: request.id },
    data: { eligibleAt: new Date(Date.now() - 1000) },
  });
  await db.pairingTutee.deleteMany({ where: { pairingId, tuteeId } });
  expect(await finalizeDueOptOuts(db)).toBe(0);
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: tuteeId } }),
  ).toMatchObject({ status: "ACTIVE" });
});

it("audit: valid due relay removes current participation once and retains history", async () => {
  const results = await Promise.allSettled([
    tutor().tutor.requestTuteeRemoval({ pairingId, tuteeId }),
    tutor().tutor.requestTuteeRemoval({ pairingId, tuteeId }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const request = await db.tuteeRemovalRequest.findFirstOrThrow();
  await db.tuteeRemovalRequest.update({
    where: { id: request.id },
    data: { eligibleAt: new Date(Date.now() - 1000) },
  });
  expect(await finalizeDueOptOuts(db)).toBe(1);
  expect(await finalizeDueOptOuts(db)).toBe(0);
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: tuteeId } }),
  ).toMatchObject({ status: "INACTIVE" });
  expect(await db.pairingTutee.findMany({ where: { tuteeId } })).toEqual([
    expect.objectContaining({ pairingId: historicalPairingId }),
  ]);
});

async function attendanceFixture() {
  await db.policyDocument.create({
    data: {
      slug: "tutor-policy",
      locale: "en",
      title: "Audit policy",
      body: "Audit consent",
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
      signature: "Audit tutor",
    },
  });
  const other = await db.pairing.create({
    data: {
      tutorId,
      termId: currentTermId,
      subject: "Second subject",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      tutees: { create: { tuteeId } },
    },
  });
  return {
    otherPairingId: other.id,
    input: {
      pairingId,
      date: new Date("2026-01-05"),
      tutorStatus: "PRESENT" as const,
      tutees: [{ tuteeId, status: "PRESENT" as const }],
      startMin: 900,
      endMin: 960,
      comments: "Audit attendance",
      ratingPreparedness: 4,
      ratingParticipation: 4,
      ratingUnderstanding: 4,
      ratingBehavior: 4,
      ratingProgress: 4,
    },
  };
}

it.each([true, false])(
  "audit: combined/standalone overlap is rejected (combined first: %s)",
  async (combinedFirst) => {
    const { input, otherPairingId } = await attendanceFixture();
    const combined = { ...input, mergePairingIds: [otherPairingId] };
    await tutor().tutor.submitAttendance(combinedFirst ? combined : input);
    const before = await db.session.aggregate({
      _sum: { shCount: true },
      _count: true,
    });
    await expect(
      tutor().tutor.submitAttendance(combinedFirst ? input : combined),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.session.aggregate({ _sum: { shCount: true }, _count: true }),
    ).toEqual(before);
  },
);

it("audit: overlapping attendance rejects time changes but accepts an adjacent extra session", async () => {
  const { input } = await attendanceFixture();
  const first = await tutor().tutor.submitAttendance(input);
  expect(await tutor().tutor.submitAttendance(input)).toMatchObject({
    id: first.id,
  });
  await expect(
    tutor().tutor.submitAttendance({ ...input, startMin: 901 }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await tutor().tutor.submitAttendance({
    ...input,
    tutorStatus: "EXTRA",
    startMin: 960,
    endMin: 1020,
  });
  expect(await db.session.count()).toBe(2);
});

it("audit: concurrent changed pairing sets cannot double-credit or duplicate absence cards", async () => {
  const { input, otherPairingId } = await attendanceFixture();
  const absent = {
    ...input,
    tutees: [{ tuteeId, status: "UNEXCUSED_ABSENT" as const }],
  };
  const results = await Promise.allSettled([
    tutor().tutor.submitAttendance(absent),
    tutor().tutor.submitAttendance({
      ...absent,
      mergePairingIds: [otherPairingId],
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    await db.disciplinaryCard.count({ where: { tuteeId, source: "AUTO" } }),
  ).toBe(1);
  expect(
    await db.tutee.findUniqueOrThrow({ where: { id: tuteeId } }),
  ).toMatchObject({ status: "ACTIVE" });
});

it("audit: correction cannot move a session over another saved block", async () => {
  const { input } = await attendanceFixture();
  await tutor().tutor.submitAttendance(input);
  const extra = await tutor().tutor.submitAttendance({
    ...input,
    startMin: 960,
    endMin: 1020,
    tutorStatus: "EXTRA",
  });
  const session = await db.session.findUniqueOrThrow({
    where: { id: extra.id },
  });
  const correction = {
    id: extra.id,
    expectedUpdatedAt: session.updatedAt,
    reason: "Correct the recorded time",
    date: input.date,
    startMin: 930,
    endMin: 990,
    tutorStatus: "EXTRA" as const,
    tutorAbsentReason: null,
    comments: "Corrected extra session",
    online: true,
    actualRoomId: null,
    ratingPreparedness: 4,
    ratingParticipation: 4,
    ratingUnderstanding: 4,
    ratingBehavior: 4,
    ratingProgress: 4,
    tutees: [{ tuteeId, status: "PRESENT" as const, absenceReason: null }],
  };
  await expect(
    head().corrections.correctAttendance(correction),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.session.findUniqueOrThrow({ where: { id: extra.id } }),
  ).toMatchObject({ startMin: 960, endMin: 1020 });
  await head().corrections.correctAttendance({
    ...correction,
    startMin: 960,
    endMin: 1050,
  });
  expect(
    await db.session.findUniqueOrThrow({ where: { id: extra.id } }),
  ).toMatchObject({ startMin: 960, endMin: 1050 });
});

it("audit: future patrol observations cannot earn credit but clock skew and historical visits remain valid", async () => {
  await db.user.update({
    where: { id: userId },
    data: { crewStatus: "ACTIVE" },
  });
  const room = await db.room.create({ data: { name: "Patrol audit room" } });
  const input = {
    submissionKey: crypto.randomUUID(),
    observations: [
      {
        roomId: room.id,
        headcount: "ZERO" as const,
        observedAt: new Date(Date.now() + 86_400_000),
      },
    ],
  };
  await expect(tutor().crew.submitPatrol(input)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(await db.patrol.count()).toBe(0);
  expect(await db.patrolObservation.count()).toBe(0);
  const historical = {
    ...input,
    observations: [
      { ...input.observations[0]!, observedAt: new Date("2026-01-05") },
    ],
  };
  const saved = await tutor().crew.submitPatrol(historical);
  expect(await tutor().crew.submitPatrol(historical)).toMatchObject({
    id: saved.id,
  });
  await tutor().crew.submitPatrol({
    submissionKey: crypto.randomUUID(),
    observations: [
      { ...input.observations[0]!, observedAt: new Date(Date.now() + 30_000) },
    ],
  });
  expect(await db.patrol.aggregate({ _sum: { hours: true } })).toEqual({
    _sum: { hours: 1 },
  });
});

it("audit: patrol correction cannot introduce future observation evidence", async () => {
  const room = await db.room.create({
    data: { name: "Correction audit room" },
  });
  const saved = await head().crew.submitPatrol({
    submissionKey: crypto.randomUUID(),
    observations: [
      { roomId: room.id, headcount: "ONE", observedAt: new Date("2026-01-05") },
    ],
  });
  const patrol = await db.patrol.findUniqueOrThrow({
    where: { id: saved.id },
    include: { observations: true },
  });
  const observations = patrol.observations.map(({ id, roomId, headcount }) => ({
    id,
    roomId,
    headcount,
    observedAt: new Date(Date.now() + 86_400_000),
  }));
  await expect(
    head().corrections.correctPatrol({
      id: patrol.id,
      expectedUpdatedAt: patrol.updatedAt,
      reason: "Fix observation time",
      note: null,
      observations,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    await db.patrolObservation.findMany({ where: { patrolId: patrol.id } }),
  ).toEqual(patrol.observations);
});

const deletionPassword = "AuditDeletionPass123!";
async function passwordForHead() {
  await db.user.update({
    where: { id: headId },
    data: { passwordHash: hashPassword(deletionPassword) },
  });
}

it("audit: only Head can delete an eligible account and linked tutor history survives", async () => {
  await passwordForHead();
  await expect(
    tutor().admin.deleteUser({
      userId: headId,
      confirmPassword: deletionPassword,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    head().admin.deleteUser({
      userId: headId,
      confirmPassword: deletionPassword,
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await head().admin.deleteUser({ userId, confirmPassword: deletionPassword });
  expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
  expect(await db.tutor.findUnique({ where: { id: tutorId } })).not.toBeNull();
  expect(await db.pairing.count({ where: { tutorId } })).toBe(2);
  expect(await db.user.count({ where: { role: "HEAD" } })).toBe(1);
});

it("audit: a deletion already in flight loses authority after leadership transfer", async () => {
  await passwordForHead();
  const successor = await db.user.create({
    data: { name: "Next Head", email: "next-head@example.test", role: "ADMIN" },
  });
  let entered!: () => void;
  let resume!: () => void;
  const atPassword = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const release = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const verify = reauthentication.assertCallerPassword;
  let first = true;
  vi.spyOn(reauthentication, "assertCallerPassword").mockImplementation(
    async (...args) => {
      await verify(...args);
      if (first) {
        first = false;
        entered();
        await release;
      }
    },
  );
  // Pause deletion after its initial role gate, then let another valid request transfer power.
  const deleting = head().admin.deleteUser({
    userId,
    confirmPassword: deletionPassword,
  });
  const result = deleting.then(
    () => null,
    (error: unknown) => error,
  );
  await atPassword;
  try {
    await head().admin.transferHead({
      userId: successor.id,
      confirmPassword: deletionPassword,
    });
  } finally {
    resume();
  }
  expect(await result).toMatchObject({ code: "FORBIDDEN" });
  expect(await db.user.findUnique({ where: { id: userId } })).not.toBeNull();
  expect(
    await db.user.findUniqueOrThrow({ where: { id: successor.id } }),
  ).toMatchObject({ role: "HEAD" });
  expect(await db.user.count({ where: { role: "HEAD" } })).toBe(1);
});

it("audit: notification list, unread counts and read updates stay within the caller's account", async () => {
  const own = await db.notification.create({
    data: { userId, title: "My notice", link: "/dashboard" },
  });
  const foreign = await db.notification.create({
    data: { userId: headId, title: "Private Head notice", link: "/admin" },
  });
  expect((await tutor().notification.list()).map((row) => row.id)).toEqual([
    own.id,
  ]);
  expect(await tutor().notification.unreadCount()).toBe(1);
  expect(await tutor().notification.markRead({ id: foreign.id })).toEqual({
    count: 0,
  });
  expect(await head().notification.unreadCount()).toBe(1);
  await tutor().notification.markAllRead();
  expect(await tutor().notification.unreadCount()).toBe(0);
  expect(await head().notification.unreadCount()).toBe(1);
  expect(
    await db.notification.findUniqueOrThrow({ where: { id: foreign.id } }),
  ).toMatchObject({ readAt: null });
});
