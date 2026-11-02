import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { lockUsernameNamespace } from "~/server/auth/username";

const submittedAt = new Date("2026-10-30T00:00:00Z");
const caller = () =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: "head", name: "Synthetic Head" },
      role: "HEAD",
      tutorId: null,
      expires: "2099-01-01",
    },
  });
const edit = (
  patch: { active?: boolean; startMin?: number; endMin?: number } = {},
) =>
  caller().admin.updateTimeSlot({
    id: "slot",
    label: "Monday",
    dayOfWeek: 1,
    startMin: 900,
    endMin: 960,
    active: true,
    ...patch,
  });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map((x) => '"' + x.tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  await db.term.createMany({
    data: [
      { id: "prior", name: "Prior", schoolYear: "26-27", quarter: "Q1" },
      {
        id: "target",
        name: "Current",
        schoolYear: "26-27",
        quarter: "Q2",
        active: true,
      },
    ],
  });
  await db.timeSlot.create({
    data: {
      id: "slot",
      label: "Monday",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
    },
  });
  await db.tutor.createMany({
    data: [
      {
        id: "continuing-tutor",
        englishName: "Continuing Tutor",
        status: "ACTIVE",
      },
      { id: "ordinary-tutor", englishName: "Ordinary Tutor", status: "ACTIVE" },
    ],
  });
  await db.tutee.createMany({
    data: [
      {
        id: "prior-student",
        englishName: "Prior Student",
        intakeTermId: "prior",
        status: "INACTIVE",
      },
      {
        id: "student",
        englishName: "Continuing Student",
        intakeTermId: "target",
        status: "ACTIVE",
      },
      {
        id: "ordinary-student",
        englishName: "Ordinary Student",
        intakeTermId: "target",
        status: "ACTIVE",
      },
    ],
  });
  await db.user.createMany({
    data: [
      { id: "head", email: "head@example.test", role: "HEAD" },
      {
        id: "tutor-user",
        email: "tutor@example.test",
        role: "TUTOR",
        tutorId: "continuing-tutor",
      },
      {
        id: "student-user",
        email: "student@example.test",
        role: "STUDENT",
        studentId: "student",
        tuteeMember: true,
      },
    ],
  });
  await db.studentProfileOwnership.create({
    data: { userId: "student-user", tuteeId: "student" },
  });
  await db.tutorAvailability.createMany({
    data: [
      { tutorId: "continuing-tutor", slotId: "slot" },
      { tutorId: "ordinary-tutor", slotId: "slot" },
    ],
  });
  const tuple = {
    subject: "Math",
    dayOfWeek: 1,
    startMin: 900,
    endMin: 960,
    timeSlotId: "slot",
    scheduleConfirmed: true,
    roomMode: "NONE" as const,
  };
  await db.pairing.create({
    data: {
      ...tuple,
      id: "source",
      termId: "prior",
      tutorId: "continuing-tutor",
      tutees: { create: { tuteeId: "prior-student" } },
    },
  });
  await db.pairing.create({
    data: {
      ...tuple,
      id: "continued",
      termId: "target",
      tutorId: "continuing-tutor",
      tutees: { create: { tuteeId: "student" } },
    },
  });
  await db.pairing.create({
    data: {
      ...tuple,
      id: "ordinary",
      termId: "target",
      tutorId: "ordinary-tutor",
      tutees: { create: { tuteeId: "ordinary-student" } },
    },
  });
  await db.studentSurvey.create({
    data: {
      id: "request",
      email: "student@example.test",
      intakeTermId: "target",
      tuteeId: "student",
      payload: { firstChoiceId: "math", slotIds: ["slot"] },
      policyRevision: "synthetic",
      policySnapshot: {},
      tokenHash: "synthetic-slot-request",
      expiresAt: submittedAt,
      confirmedAt: submittedAt,
      submittedAt,
    },
  });
  await db.studentContinuationAssignment.create({
    data: {
      id: "continuation",
      surveyId: "request",
      sourcePairingId: "source",
      sourceTuteeId: "prior-student",
      targetTermId: "target",
      targetPairingId: "continued",
      tuteeId: "student",
      tutorId: "continuing-tutor",
      status: "ASSIGNED",
      assignedAt: submittedAt,
      snapshot: {
        tutorId: "continuing-tutor",
        subject: "Math",
        sourceGroupId: null,
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
        timeSlotId: "slot",
      },
    },
  });
});
afterAll(() => db.$disconnect());

async function expectReleased() {
  expect(
    await db.studentContinuationAssignment.findUniqueOrThrow({
      where: { id: "continuation" },
    }),
  ).toMatchObject({ status: "RELEASED", reason: "SLOT_UNAVAILABLE" });
  expect(
    await db.pairingTutee.count({
      where: { pairingId: "continued", tuteeId: "student" },
    }),
  ).toBe(0);
  expect(
    await db.studentSurvey.findUniqueOrThrow({ where: { id: "request" } }),
  ).toMatchObject({ state: "OPEN", submittedAt, confirmedAt: submittedAt });
  expect(
    await db.pairingTutee.count({ where: { pairingId: "ordinary" } }),
  ).toBe(1);
  expect(await db.pairingTutee.count({ where: { pairingId: "source" } })).toBe(
    1,
  );
  const notices = await db.notification.findMany({
    where: { event: "student_continuation_released" },
  });
  expect(notices.map((x) => x.userId).sort()).toEqual([
    "head",
    "student-user",
    "tutor-user",
  ]);
}

it("releases only continuing memberships immediately on administrative disable and never reattaches on enable", async () => {
  await edit({ active: false });
  await expectReleased();
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: "ordinary" } }),
  ).toMatchObject({ scheduleConfirmed: true, startMin: 900 });
  await edit();
  await expectReleased();
});

it("releases invalid continuation time while preserving ordinary pairing and attendance propagation", async () => {
  await db.session.create({
    data: {
      id: "ordinary-attendance",
      tutorId: "ordinary-tutor",
      pairingId: "ordinary",
      timeSlotId: "slot",
      date: new Date("2026-10-26T00:00:00Z"),
      month: "2026-10",
      schoolYear: "26-27",
      quarter: "Q2",
      startMin: 900,
      endMin: 960,
      durationMin: 60,
      shFactor: 2,
      shCount: 2,
      tutorStatus: "PRESENT",
      online: true,
      tutees: { create: { tuteeId: "ordinary-student", status: "PRESENT" } },
    },
  });
  const result = await edit({ startMin: 930, endMin: 1020 });
  await expectReleased();
  expect(result.updatedSessions).toBe(1);
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: "ordinary" } }),
  ).toMatchObject({ scheduleConfirmed: true, startMin: 930, endMin: 1020 });
  expect(
    await db.session.findUniqueOrThrow({
      where: { id: "ordinary-attendance" },
    }),
  ).toMatchObject({ startMin: 930, endMin: 1020, durationMin: 90, shCount: 3 });
});

it("preserves the original signed interval when widened availability still covers it", async () => {
  await edit({ startMin: 870 });
  expect(
    await db.studentContinuationAssignment.findUniqueOrThrow({
      where: { id: "continuation" },
    }),
  ).toMatchObject({ status: "ASSIGNED" });
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: "continued" } }),
  ).toMatchObject({
    scheduleConfirmed: true,
    timeSlotId: null,
    startMin: 900,
    endMin: 960,
  });
  expect(
    await db.pairingTutee.count({ where: { pairingId: "continued" } }),
  ).toBe(1);
  expect(
    await db.pairing.findUniqueOrThrow({ where: { id: "ordinary" } }),
  ).toMatchObject({ timeSlotId: "slot", startMin: 870, endMin: 960 });
  expect(
    await db.notification.count({
      where: { event: "student_continuation_released" },
    }),
  ).toBe(0);
});

it("retains the referenced-slot deletion guard, then releases commitments when a covering unreferenced slot is deleted", async () => {
  await expect(
    caller().admin.deleteTimeSlot({ id: "slot" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    await db.studentContinuationAssignment.findUniqueOrThrow({
      where: { id: "continuation" },
    }),
  ).toMatchObject({ status: "ASSIGNED" });
  await db.pairing.updateMany({
    where: { timeSlotId: "slot" },
    data: { timeSlotId: null },
  });
  await caller().admin.deleteTimeSlot({ id: "slot" });
  await expectReleased();
  expect(await db.timeSlot.findUnique({ where: { id: "slot" } })).toBeNull();
  expect(await db.tutorAvailability.count()).toBe(0);
});

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("waits for the username fence before sharing the actor row during a real slot mutation", async () => {
  const entered = signal();
  const release = signal();
  const profile = db.$transaction(
    async (tx) => {
      await lockUsernameNamespace(tx);
      entered.resolve();
      await release.promise;
      await tx.user.update({
        where: { id: "head" },
        data: { firstName: "Updated" },
      });
    },
    { timeout: 15_000 },
  );
  await entered.promise;
  const editing = edit({ active: false }).then(
    () => null,
    (error: unknown) => error,
  );
  try {
    await vi.waitFor(
      async () => {
        const blocked = await db.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted=false`;
        expect(Number(blocked[0]?.count)).toBeGreaterThan(0);
      },
      { timeout: 3000, interval: 20 },
    );
  } finally {
    release.resolve();
  }
  await profile;
  expect(await editing).toBeNull();
  await expectReleased();
});
