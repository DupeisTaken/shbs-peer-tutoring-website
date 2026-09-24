import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("~/server/auth", () => ({ auth: async () => null }));

import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { currentPolicy } from "~/server/policy-acceptance";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { lockAttendanceSchedule } from "~/server/attendance-schedule";
import { lockPlannedRoomSchedule } from "~/server/room-bookings";
import * as flags from "~/server/crew/flags";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const date = new Date("2026-01-05T00:00:00Z");
const slotId = "integrity-slot";
const otherSlotId = "integrity-other-slot";
const tutorId = "integrity-tutor";
const pairingId = "integrity-pairing";
const tuteeId = "integrity-student";

function caller(role: Session["role"] = "HEAD") {
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: {
        id: role === "HEAD" ? "integrity-head" : "integrity-user",
        name: "Integrity actor",
      },
      role,
      tutorId: role === "TUTOR" ? tutorId : null,
      expires: new Date(Date.now() + 60_000).toISOString(),
    },
  });
}
const editSlot = (startMin = 900, endMin = 990) =>
  caller().admin.updateTimeSlot({
    id: slotId,
    label: "Updated slot",
    dayOfWeek: 1,
    startMin,
    endMin,
    active: true,
  });
const sessionData = (
  id: string,
  startMin = 900,
  endMin = 960,
  stampedSlot: string | null = slotId,
) => ({
  id,
  tutorId,
  pairingId,
  timeSlotId: stampedSlot,
  date,
  month: "2026-01",
  schoolYear: "26-27",
  quarter: "Q1" as const,
  startMin,
  endMin,
  durationMin: endMin - startMin,
  shFactor: 2,
  shCount: (endMin - startMin) / 30,
  tutorStatus: "PRESENT" as const,
  comments: "Original evidence",
  online: true,
  tutees: { create: { tuteeId, status: "PRESENT" as const } },
});
async function session(
  id = "primary",
  startMin = 900,
  endMin = 960,
  stampedSlot: string | null = slotId,
) {
  return db.session.create({
    data: sessionData(id, startMin, endMin, stampedSlot),
  });
}
async function snapshot() {
  return {
    slot: await db.timeSlot.findUnique({ where: { id: slotId } }),
    pairing: await db.pairing.findUnique({ where: { id: pairingId } }),
    sessions: await db.session.findMany({ orderBy: { id: "asc" } }),
    flags: await db.sessionFlag.findMany(),
    adjustments: await db.serviceHourAdjustment.findMany(),
    audits: await db.auditLog.count(),
    notifications: await db.notification.count(),
  };
}

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
  await db.term.create({
    data: {
      id: "integrity-term",
      schoolYear: "26-27",
      quarter: "Q1",
      name: "Integrity term",
      active: true,
    },
  });
  await db.tutor.create({
    data: { id: tutorId, englishName: "Integrity tutor", status: "ACTIVE" },
  });
  await db.user.createMany({
    data: [
      {
        id: "integrity-head",
        email: "integrity-head@example.test",
        role: "HEAD",
      },
      {
        id: "integrity-user",
        email: "integrity-user@example.test",
        role: "TUTOR",
        tutorId,
      },
    ],
  });
  await db.tutee.create({
    data: { id: tuteeId, englishName: "Integrity student", status: "ACTIVE" },
  });
  await db.timeSlot.createMany({
    data: [
      {
        id: slotId,
        label: "Original slot",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
      },
      {
        id: otherSlotId,
        label: "Other slot",
        dayOfWeek: 1,
        startMin: 960,
        endMin: 1020,
      },
    ],
  });
  await db.pairing.create({
    data: {
      scheduleConfirmed: true,
      id: pairingId,
      tutorId,
      termId: "integrity-term",
      subject: "Integrity subject",
      timeSlotId: slotId,
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
      title: "Test",
      body: "Test policy",
      version: "1",
    },
  });
  const policy = await currentPolicy(db, "tutor-policy");
  await db.policyAcceptance.create({
    data: {
      userId: "integrity-user",
      slug: "tutor-policy",
      revision: policy.revision,
      snapshot: policy.documents,
      signature: "Integrity tutor",
    },
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.$disconnect();
});

it("slot propagation rejects overlap with another block and rolls back every changed record", async () => {
  await session();
  await session("other", 960, 1020, null);
  const before = await snapshot();
  await expect(editSlot(900, 990)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await snapshot()).toEqual(before);
});

it("slot propagation checks collisions between two separately submitted blocks linked to the same slot", async () => {
  await session();
  await session("extra", 1020, 1080);
  const before = await snapshot();
  await expect(editSlot(900, 990)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await snapshot()).toEqual(before);
});

it.each(["primary", "sibling"])(
  "editing the slot linked only by a merged %s updates the entire block and credits once",
  async (linkedRow) => {
    await db.session.create({
      data: {
        ...sessionData(
          "primary",
          900,
          960,
          linkedRow === "primary" ? slotId : otherSlotId,
        ),
        mergeGroupId: "primary",
      },
    });
    await db.session.create({
      data: {
        ...sessionData(
          "sibling",
          900,
          960,
          linkedRow === "sibling" ? slotId : otherSlotId,
        ),
        mergeGroupId: "primary",
        shFactor: 0,
        shCount: 0,
      },
    });
    await session("adjacent", 990, 1050, null);
    expect(await editSlot()).toMatchObject({
      updatedSessions: 2,
      updatedPairings: 1,
    });
    const rows = await db.session.findMany({
      where: { mergeGroupId: "primary" },
      orderBy: { id: "asc" },
    });
    expect(
      rows.every(
        (row) =>
          row.startMin === 900 && row.endMin === 990 && row.durationMin === 90,
      ),
    ).toBe(true);
    expect(rows.map((row) => row.shCount)).toEqual([3, 0]);
    expect(rows.map((row) => row.timeSlotId)).toEqual(
      linkedRow === "primary" ? [slotId, otherSlotId] : [otherSlotId, slotId],
    );
    expect(
      await db.session.findUniqueOrThrow({ where: { id: "adjacent" } }),
    ).toMatchObject({ startMin: 990, endMin: 1050 });
  },
);

it("historical propagation retains dates and permits the same interval on different days or tutors", async () => {
  await session();
  await db.term.update({
    where: { id: "integrity-term" },
    data: { active: false },
  });
  await db.session.create({
    data: {
      ...sessionData("another-day", 930, 990, null),
      date: new Date("2026-01-06T00:00:00Z"),
    },
  });
  await db.tutor.create({ data: { id: "other-tutor", englishName: "Other" } });
  await db.session.create({
    data: {
      ...sessionData("another-tutor", 930, 990, null),
      tutorId: "other-tutor",
    },
  });
  await editSlot(930, 990);
  expect(
    await db.session.findUniqueOrThrow({ where: { id: "primary" } }),
  ).toMatchObject({ date, startMin: 930, endMin: 990 });
});

async function reviewedFlag(state: "PENALIZED" | "DISMISSED" = "PENALIZED") {
  const room = await db.room.create({ data: { name: "Observed room" } });
  await db.session.create({
    data: { ...sessionData("primary"), online: false, actualRoomId: room.id },
  });
  await db.patrol.create({
    data: {
      crewUserId: "integrity-head",
      hours: 0.5,
      observations: {
        create: {
          roomId: room.id,
          headcount: "ZERO",
          observedAt: new Date("2026-01-05T15:30:00+08:00"),
        },
      },
    },
  });
  const flag = await db.sessionFlag.create({
    data: {
      sessionId: "primary",
      tutorId,
      expected: 1,
      observed: 0,
      state,
      resolvedAt: new Date(),
      resolvedById: "integrity-head",
      decisionNote: "Reviewed old window",
    },
  });
  if (state === "PENALIZED")
    await db.serviceHourAdjustment.create({
      data: {
        id: `flag:${flag.id}`,
        tutorId,
        type: "PUNISHMENT",
        amount: 0.5,
        month: "2026-01",
        schoolYear: "26-27",
        quarter: "Q1",
        reason: "Old flag deduction",
      },
    });
  return flag;
}

it("changed attendance windows withdraw obsolete flags and deductions while preserving review evidence", async () => {
  const flag = await reviewedFlag();
  await db.serviceHourAdjustment.create({
    data: {
      id: "unrelated-adjustment",
      tutorId,
      type: "PUNISHMENT",
      amount: 1,
      month: "2026-01",
      schoolYear: "26-27",
      quarter: "Q1",
      reason: "Separate reviewed incident",
    },
  });
  await editSlot(1020, 1080);
  expect(await db.sessionFlag.count()).toBe(0);
  expect(
    await db.serviceHourAdjustment.findMany({
      select: { id: true, amount: true },
    }),
  ).toEqual([{ id: "unrelated-adjustment", amount: 1 }]);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { entity: "TimeSlot", entityId: slotId },
  });
  expect(audit.details).toMatchObject({
    previousFlags: [
      expect.objectContaining({
        id: flag.id,
        state: "PENALIZED",
        decisionNote: "Reviewed old window",
      }),
    ],
    removedFlagAdjustments: [
      expect.objectContaining({ id: `flag:${flag.id}`, amount: 0.5 }),
    ],
  });
  expect(
    await db.notification.count({
      where: { userId: "integrity-head", link: "/admin/audit" },
    }),
  ).toBe(1);
});

it("a changed window with continuing crew discrepancy reopens an earlier dismissal", async () => {
  const flag = await reviewedFlag("DISMISSED");
  await editSlot(900, 990);
  expect(
    await db.sessionFlag.findUniqueOrThrow({ where: { id: flag.id } }),
  ).toMatchObject({ state: "PENDING", resolvedAt: null, decisionNote: null });
});

it("weekday-only and label edits preserve actual attendance and reviewed penalties", async () => {
  await reviewedFlag();
  const before = await snapshot();
  const result = await caller().admin.updateTimeSlot({
    id: slotId,
    label: "Thursday slot",
    dayOfWeek: 4,
    startMin: 900,
    endMin: 960,
    active: true,
  });
  expect(result.updatedSessions).toBe(0);
  const after = await snapshot();
  expect(after.sessions).toEqual(before.sessions);
  expect(after.flags).toEqual(before.flags);
  expect(after.adjustments).toEqual(before.adjustments);
});

it("planned room conflicts still roll back catalogue, pairing and historical updates", async () => {
  await session();
  const room = await db.room.create({ data: { name: "Shared room" } });
  await db.pairing.update({
    where: { id: pairingId },
    data: { roomId: room.id },
  });
  await db.roomUnavailability.create({
    data: { roomId: room.id, dayOfWeek: 1, startMin: 960, endMin: 1020 },
  });
  const before = await snapshot();
  await expect(editSlot()).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await snapshot()).toEqual(before);
});

it("flag reconciliation failure rolls back propagated hours, slot, review and audit", async () => {
  await reviewedFlag();
  const before = await snapshot();
  vi.spyOn(flags, "reconsiderSessionFlag").mockRejectedValueOnce(
    new Error("Synthetic reconciliation failure"),
  );
  await expect(editSlot()).rejects.toThrow("Synthetic reconciliation failure");
  expect(await snapshot()).toEqual(before);
});

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function waitForLock(mode: "ShareLock" | "ExclusiveLock") {
  await vi.waitFor(
    async () => {
      const blocked = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted=false AND mode=${mode}`;
      expect(Number(blocked[0]?.count)).toBeGreaterThan(0);
    },
    { timeout: 3000, interval: 20 },
  );
}

it("slot propagation waits for an in-flight attendance writer and validates its committed session", async () => {
  await session();
  const entered = signal();
  const release = signal();
  const writer = db.$transaction(async (tx) => {
    await lockAttendanceSchedule(tx);
    entered.resolve();
    await release.promise;
    await tx.session.create({
      data: sessionData("new-overlap", 960, 1020, null),
    });
  });
  await entered.promise;
  const editing = editSlot().then(
    () => null,
    (error: unknown) => error,
  );
  try {
    await waitForLock("ExclusiveLock");
  } finally {
    release.resolve();
  }
  await writer;
  expect(await editing).toMatchObject({ code: "CONFLICT" });
  expect(
    await db.timeSlot.findUniqueOrThrow({ where: { id: slotId } }),
  ).toMatchObject({ endMin: 960 });
  expect(await db.session.count()).toBe(2);
});

async function correctionInput() {
  const saved = await db.session.findUniqueOrThrow({
    where: { id: "primary" },
  });
  return {
    id: saved.id,
    expectedUpdatedAt: saved.updatedAt,
    reason: "Correct recorded time",
    date,
    startMin: 900,
    endMin: 960,
    tutorStatus: "PRESENT" as const,
    tutorAbsentReason: null,
    comments: "Correction",
    online: true,
    actualRoomId: null,
    ratingPreparedness: 4,
    ratingParticipation: 4,
    ratingUnderstanding: 4,
    ratingBehavior: 4,
    ratingProgress: 4,
    tutees: [{ tuteeId, status: "PRESENT" as const, absenceReason: null }],
  };
}

it.each(["submit", "correct"] as const)(
  "a concurrent %s waits for catalogue propagation and rechecks saved attendance",
  async (kind) => {
    await session();
    const correction = await correctionInput();
    const entered = signal();
    const release = signal();
    const roomWriter = db.$transaction(async (tx) => {
      await lockPlannedRoomSchedule(tx);
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const editing = editSlot(900, 1020);
    let attempted: Promise<unknown> | undefined;
    try {
      await waitForLock("ExclusiveLock");
      const input = {
        pairingId,
        date,
        tutorStatus: "EXTRA" as const,
        startMin: 960,
        endMin: 1020,
        tutees: [{ tuteeId, status: "PRESENT" as const }],
        comments: "Concurrent actual attendance",
        ratingPreparedness: 4,
        ratingParticipation: 4,
        ratingUnderstanding: 4,
        ratingBehavior: 4,
        ratingProgress: 4,
      };
      attempted = (
        kind === "submit"
          ? caller("TUTOR").tutor.submitAttendance(input)
          : caller().corrections.correctAttendance(correction)
      ).then(
        () => null,
        (error: unknown) => error,
      );
      await waitForLock("ShareLock");
    } finally {
      release.resolve();
    }
    await roomWriter;
    await editing;
    expect(await attempted).toMatchObject({ code: "CONFLICT" });
    expect(await db.session.count()).toBe(1);
    expect(
      await db.session.findUniqueOrThrow({ where: { id: "primary" } }),
    ).toMatchObject({ endMin: 1020, shCount: 4 });
  },
);

it("attendance cannot save stale catalogue defaults read before a waiting slot edit", async () => {
  const entered = signal();
  const release = signal();
  const roomWriter = db.$transaction(async (tx) => {
    await lockPlannedRoomSchedule(tx);
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const editing = editSlot(900, 1020);
  let attempted: Promise<unknown> | undefined;
  try {
    await waitForLock("ExclusiveLock");
    attempted = caller("TUTOR")
      .tutor.submitAttendance({
        pairingId,
        date,
        tutorStatus: "PRESENT",
        tutees: [{ tuteeId, status: "PRESENT" }],
        comments: "Uses scheduled defaults",
        ratingPreparedness: 4,
        ratingParticipation: 4,
        ratingUnderstanding: 4,
        ratingBehavior: 4,
        ratingProgress: 4,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    await waitForLock("ShareLock");
  } finally {
    release.resolve();
  }
  await roomWriter;
  await editing;
  expect(await attempted).toMatchObject({ code: "CONFLICT" });
  expect(await db.session.count()).toBe(0);
});

async function coordinatorCaller() {
  await db.user.create({
    data: {
      id: "integrity-coordinator",
      email: "integrity-coordinator@example.test",
      role: "COORDINATOR",
    },
  });
  return createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: "integrity-coordinator" },
      role: "COORDINATOR",
      tutorId: null,
      expires: new Date(Date.now() + 60_000).toISOString(),
    },
  });
}

it("coordinator slot approval rechecks attendance committed while it waited for propagation access", async () => {
  await session();
  const coordinator = await coordinatorCaller();
  await expect(
    coordinator.admin.updateTimeSlot({
      id: slotId,
      label: "Requested slot",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 990,
      active: true,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "admin.updateTimeSlot" },
  });
  const entered = signal();
  const release = signal();
  const writer = db.$transaction(async (tx) => {
    await lockAttendanceSchedule(tx);
    entered.resolve();
    await release.promise;
    await tx.session.create({
      data: sessionData("new-overlap", 960, 1020, null),
    });
  });
  await entered.promise;
  const approving = caller()
    .approval.decide({
      id: proposal.id,
      approve: true,
      note: "Review current attendance",
    })
    .then(
      () => null,
      (error: unknown) => error,
    );
  try {
    await waitForLock("ExclusiveLock");
  } finally {
    release.resolve();
  }
  await writer;
  expect(await approving).toMatchObject({ code: "CONFLICT" });
  expect(
    await db.approvalRequest.findUniqueOrThrow({ where: { id: proposal.id } }),
  ).toMatchObject({ state: "PENDING" });
  expect(
    await db.timeSlot.findUniqueOrThrow({ where: { id: slotId } }),
  ).toMatchObject({ endMin: 960 });
});

it.each(["slot", "attendance", "patrol"] as const)(
  "a current coordinator %s proposal applies successfully under its attendance locks",
  async (kind) => {
    const coordinator = await coordinatorCaller();
    let requested: Promise<unknown>;
    if (kind === "slot") {
      await session();
      requested = coordinator.admin.updateTimeSlot({
        id: slotId,
        label: "Reviewed clock",
        dayOfWeek: 1,
        startMin: 900,
        endMin: 990,
        active: true,
      });
    } else if (kind === "attendance") {
      await session();
      requested = coordinator.corrections.correctAttendance({
        ...(await correctionInput()),
        endMin: 990,
      });
    } else {
      await reviewedFlag();
      const patrol = await db.patrol.findFirstOrThrow({
        include: { observations: true },
      });
      requested = coordinator.corrections.correctPatrol({
        id: patrol.id,
        expectedUpdatedAt: patrol.updatedAt,
        reason: "Correct observed count",
        note: "One student was present",
        observations: patrol.observations.map((row) => ({
          id: row.id,
          roomId: row.roomId,
          observedAt: row.observedAt,
          headcount: "ONE",
        })),
      });
    }
    await expect(requested).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    const proposal = await db.approvalRequest.findFirstOrThrow();
    await caller().approval.decide({
      id: proposal.id,
      approve: true,
      note: "Verified current evidence",
    });
    expect(
      await db.approvalRequest.findUniqueOrThrow({
        where: { id: proposal.id },
      }),
    ).toMatchObject({ state: "APPROVED" });
    if (kind === "patrol") {
      expect(await db.sessionFlag.count()).toBe(0);
      expect(await db.serviceHourAdjustment.count()).toBe(0);
    } else {
      expect(
        await db.session.findUniqueOrThrow({ where: { id: "primary" } }),
      ).toMatchObject({ endMin: 990 });
    }
  },
);
