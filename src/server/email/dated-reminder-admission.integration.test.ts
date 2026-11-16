import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./sender", () => ({
  emailSender: { send: vi.fn() },
  isEmailDeliveryAvailable: () => true,
  isEmailConfigured: () => false,
  verifyEmailTransport: vi.fn(),
}));
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { saveProgramCalendar } from "~/server/program/calendar";
import { queueEventReminders, validateEventReminder } from "./event-reminders";
import {
  admitReminderNotice,
  finishIdentityNotice,
} from "./identity-notice-admission";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const date = "2096-10-29";
const startsAt = new Date(`${date}T07:30:00.000Z`);
const now = new Date(startsAt.getTime() - 3_600_000);
const lease = new Date(now.getTime() + 300_000);
const cleanupTasks: Array<() => Promise<void>> = [];
function signal<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanupTasks.splice(0).reverse()) await cleanup();
});
afterAll(() => db.$disconnect());

async function fixture() {
  await db.programCalendarDay.deleteMany({ where: { date } });
  await db.schoolCalendarDay.deleteMany({ where: { date } });
  await db.programSettings.upsert({
    where: { id: "program" },
    create: {
      id: "program",
      emailNotificationsEnabled: true,
      timeZone: "Asia/Shanghai",
    },
    update: {
      emailNotificationsEnabled: true,
      timeZone: "Asia/Shanghai",
      notificationLocks: {},
    },
  });
  const tutor = await db.tutor.create({
    data: { englishName: "Synthetic dated tutor", status: "ACTIVE" },
  });
  const learner = await db.tutee.create({
    data: { englishName: "Synthetic dated learner", status: "ACTIVE" },
  });
  const user = await db.user.create({
    data: {
      email: `dated-fence-${randomUUID()}@example.test`,
      role: "TUTOR",
      tutorId: tutor.id,
      emailVerifiedAt: now,
      emailEventReminders: true,
    },
  });
  const term = await db.term.create({
    data: {
      schoolYear: randomUUID(),
      name: "Synthetic dated fence",
      quarter: "Q1",
      active: true,
    },
  });
  const pairing = await db.pairing.create({
    data: {
      tutorId: tutor.id,
      termId: term.id,
      subject: "Mathematics",
      scheduleConfirmed: true,
      dayOfWeek: new Date(`${date}T12:00:00Z`).getUTCDay(),
      startMin: 930,
      endMin: 975,
      tutees: { create: { tuteeId: learner.id } },
    },
  });
  const plan = await db.sessionPlan.create({
    data: {
      generationKey: randomUUID(),
      tutorId: tutor.id,
      termId: term.id,
      originalDate: date,
      timeZone: "Asia/Shanghai",
      kind: "REGULAR",
      sourceFingerprint: "fixture",
      assignments: {
        create: {
          pairingId: pairing.id,
          subject: pairing.subject,
          tuteeIds: [learner.id],
          primary: true,
        },
      },
    },
  });
  const cohort = await db.sessionPlanCohort.create({
    data: {
      planId: plan.id,
      date,
      startMin: 930,
      endMin: 975,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 45 * 60_000),
    },
  });
  await db.sessionPlanParticipant.create({
    data: { planId: plan.id, cohortId: cohort.id, tuteeId: learner.id },
  });
  cleanupTasks.push(async () => {
    await db.emailDelivery.deleteMany({ where: { userId: user.id } });
    await db.notification.deleteMany({ where: { userId: user.id } });
    await db.sessionNotice.deleteMany({ where: { recipientUserId: user.id } });
    const plans = await db.sessionPlan.findMany({
      where: { tutorId: tutor.id },
      select: { id: true },
    });
    const planIds = plans.map((item) => item.id);
    await db.sessionPlanParticipant.deleteMany({
      where: { planId: { in: planIds } },
    });
    await db.sessionPlanContinuationMember.deleteMany({
      where: { planId: { in: planIds } },
    });
    await db.sessionPlanCohort.deleteMany({
      where: { planId: { in: planIds } },
    });
    await db.sessionPlanAssignment.deleteMany({
      where: { planId: { in: planIds } },
    });
    await db.sessionPlan.deleteMany({ where: { tutorId: tutor.id } });
    await db.pairingTutee.deleteMany({ where: { pairingId: pairing.id } });
    await db.pairing.delete({ where: { id: pairing.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.tutee.delete({ where: { id: learner.id } });
    await db.tutor.delete({ where: { id: tutor.id } });
    await db.term.delete({ where: { id: term.id } });
    await db.programCalendarDay.deleteMany({ where: { date } });
  });
  await queueEventReminders(db, now);
  const row = await db.emailDelivery.findFirstOrThrow({
    where: { userId: user.id, category: "reminder" },
  });
  expect(await validateEventReminder(db, row, now)).toBe(true);
  await db.emailDelivery.update({
    where: { id: row.id },
    data: { leaseUntil: lease },
  });
  const pause = () =>
    saveProgramCalendar(db, {
      date,
      endDate: date,
      reason: "Synthetic reminder admission pause",
      expectedVersion: 0,
      schedulingEffect: "PAUSE_REGULAR",
    });
  return {
    cohort,
    row,
    pause,
    read: () => db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } }),
  };
}

it("rejects a dated cohort rescheduled after initial eligibility without admitting old clocks", async () => {
  const f = await fixture();
  // A raw source edit is also fenced; this control tests database row protection
  // independently of the supported calendar-policy writer exercised below.
  await db.sessionPlanCohort.update({
    where: { id: f.cohort.id },
    data: {
      startsAt: new Date(startsAt.getTime() + 3_600_000),
      endsAt: new Date(startsAt.getTime() + 105 * 60_000),
      startMin: 990,
      endMin: 1035,
      version: { increment: 1 },
    },
  });
  expect(await admitReminderNotice(db, f.row.id, lease, null)).toBeNull();
  expect(await f.read()).toMatchObject({
    status: "SKIPPED",
    attempts: 0,
    attemptStartedAt: null,
  });
});

it("a supported pause cancels a published cohort before source-fenced admission", async () => {
  const f = await fixture();
  await f.pause();
  expect(
    (
      await db.sessionPlanCohort.findUniqueOrThrow({
        where: { id: f.cohort.id },
      })
    ).status,
  ).toBe("CANCELLED");
  expect(await admitReminderNotice(db, f.row.id, lease, null)).toBeNull();
  expect(await f.read()).toMatchObject({
    status: "SKIPPED",
    attempts: 0,
    attemptStartedAt: null,
  });
});

it("a supported pause waits behind dated reminder admission, and acceptance remains recorded", async () => {
  const f = await fixture();
  const admitted = signal<string>(),
    release = signal(),
    writerPid = signal<number>();
  const admission = db.$transaction(
    async (tx) => {
      const attempt = await admitReminderNotice(tx, f.row.id, lease, null);
      if (!attempt)
        throw new Error("Synthetic dated reminder was not admitted");
      admitted.resolve(attempt);
      await release.promise;
      return attempt;
    },
    { timeout: 10_000 },
  );
  let writer: Promise<unknown> | undefined;
  try {
    await Promise.race([
      admitted.promise,
      admission.then(() => {
        throw new Error("No admission signal");
      }),
    ]);
    writer = db.$transaction(
      async (tx) => {
        const [pid] = await tx.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        writerPid.resolve(pid!.pid);
        return saveProgramCalendar(tx, {
          date,
          endDate: date,
          reason: "Synthetic in-flight pause",
          expectedVersion: 0,
          schedulingEffect: "PAUSE_REGULAR",
        });
      },
      { timeout: 10_000 },
    );
    const pid = await writerPid.promise;
    const deadline = performance.now() + 3000;
    let blocked = false;
    while (performance.now() < deadline && !blocked) {
      const [result] = await db.$queryRaw<Array<{ blocked: boolean }>>`
        SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS blocked`;
      blocked = result?.blocked ?? false;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
  } finally {
    release.resolve();
    await admission;
  }
  await writer;
  const attempt = await admitted.promise;
  await finishIdentityNotice(db, f.row.id, attempt, true);
  expect(await f.read()).toMatchObject({ status: "SENT", attempts: 1 });
});
