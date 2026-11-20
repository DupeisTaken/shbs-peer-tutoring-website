import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "~/server/db";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { readCurrentSessionReminderCohort } from "~/server/session-planning";
import { saveProgramCalendar, removeProgramCalendar } from "~/server/program/calendar";
import { queueEventReminders, validateEventReminder } from "./event-reminders";

beforeAll(() => assertIsolatedTestDatabase(process.env.DATABASE_URL));
afterAll(() => db.$disconnect());
const startsAt = new Date("2096-10-29T07:30:00.000Z");
const now = new Date(startsAt.getTime() - 3_600_000);
const date = "2096-10-29";

async function seed(tx: TransactionDb) {
  await tx.programSettings.upsert({
    where: { id: "program" },
    create: {
      id: "program",
      emailNotificationsEnabled: true,
      timeZone: "Asia/Shanghai",
    },
    update: { emailNotificationsEnabled: true, timeZone: "Asia/Shanghai" },
  });
  const tutor = await tx.tutor.create({
    data: { englishName: "Taylor Synthetic", status: "ACTIVE" },
  });
  const tutee = await tx.tutee.create({
    data: { englishName: "Morgan Synthetic", status: "ACTIVE" },
  });
  const tutorUser = await tx.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      role: "TUTOR",
      tutorId: tutor.id,
      emailVerifiedAt: now,
      emailEventReminders: true,
    },
  });
  const studentUser = await tx.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      role: "STUDENT",
      studentId: tutee.id,
      tuteeMember: true,
      emailVerifiedAt: now,
      emailEventReminders: true,
    },
  });
  const term = await tx.term.create({
    data: {
      schoolYear: `reminder-${randomUUID()}`,
      quarter: "Q1",
      name: "Reminder integration",
      active: true,
    },
  });
  const pairing = await tx.pairing.create({
    data: {
      tutorId: tutor.id,
      termId: term.id,
      subject: "Mathematics",
      scheduleConfirmed: true,
      dayOfWeek: new Date(`${date}T12:00:00Z`).getUTCDay() || 7,
      startMin: 930,
      endMin: 975,
      tutees: { create: { tuteeId: tutee.id } },
    },
  });
  async function publish(kind = "REGULAR") {
    const plan = await tx.sessionPlan.create({
      data: {
        generationKey: randomUUID(),
        tutorId: tutor.id,
        termId: term.id,
        originalDate: date,
        timeZone: "Asia/Shanghai",
        kind,
        sourceFingerprint: "fixture",
        assignments: {
          create: {
            pairingId: pairing.id,
            subject: pairing.subject,
            tuteeIds: [tutee.id],
            primary: true,
          },
        },
      },
    });
    const cohort = await tx.sessionPlanCohort.create({
      data: {
        planId: plan.id,
        date,
        startMin: 930,
        endMin: 975,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 45 * 60_000),
      },
    });
    await tx.sessionPlanParticipant.create({
      data: { planId: plan.id, cohortId: cohort.id, tuteeId: tutee.id },
    });
    return { plan, cohort };
  }
  const users = [tutorUser.id, studentUser.id];
  const queued = () =>
    tx.emailDelivery.findMany({
      where: { userId: { in: users }, category: "reminder" },
    });
  return {
    tutor,
    tutee,
    tutorUser,
    studentUser,
    pairing,
    publish,
    queued,
    users,
  };
}

async function fixture(
  check: (
    tx: TransactionDb,
    f: Awaited<ReturnType<typeof seed>>,
  ) => Promise<void>,
) {
  const rollback = new Error("rollback dated reminder integration");
  await expect(
    db.$transaction(
      async (tx) => {
        await check(tx, await seed(tx));
        throw rollback;
      },
      { timeout: 30_000 },
    ),
  ).rejects.toBe(rollback);
}

it("uses one published occurrence per lead and rechecks the actual dated source", async () => {
  await fixture(async (tx, f) => {
    const { cohort } = await f.publish();
    expect(
      await readCurrentSessionReminderCohort(tx, cohort.id),
    ).not.toBeNull();
    await queueEventReminders(tx, now);
    await queueEventReminders(tx, now);
    const rows = await f.queued();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.context).toMatchObject({
        kind: "tutoring_cohort",
        sourceId: cohort.id,
      });
      expect(await validateEventReminder(tx, row, now)).toBe(true);
    }
    await queueEventReminders(tx, new Date(startsAt.getTime() - 86_400_000));
    expect(await f.queued()).toHaveLength(4);
    await tx.sessionPlanCohort.update({
      where: { id: cohort.id },
      data: { status: "CANCELLED" },
    });
    expect(await readCurrentSessionReminderCohort(tx, cohort.id)).toBeNull();
    expect(await validateEventReminder(tx, rows[0]!, now)).toBe(false);
    await tx.emailDelivery.deleteMany({
      where: { userId: { in: f.users }, category: "reminder" },
    });
    await queueEventReminders(tx, now);
    expect(await f.queued()).toHaveLength(0);
  });
});

it("queues actual dated-exception reminders through a pause, excludes ordinary peers and respects an overlapping NOTICE", async () => {
  await fixture(async (tx, f) => {
    // Bound this synthetic term to the distant domain date. The real-clock
    // policy writer still reconciles this future publication synchronously.
    await tx.term.update({ where: { id: f.pairing.termId }, data: {
      startDate: new Date("2096-10-01T00:00:00Z"), endDate: new Date("2096-11-30T00:00:00Z"),
    } });
    const { plan, cohort } = await f.publish();
    const peer = await tx.tutee.create({ data: { englishName: "Casey Synthetic", status: "ACTIVE" } });
    const peerUser = await tx.user.create({ data: {
      email: `${randomUUID()}@example.test`, role: "STUDENT", studentId: peer.id,
      tuteeMember: true, emailVerifiedAt: now, emailEventReminders: true,
    } });
    f.users.push(peerUser.id);
    await tx.pairingTutee.create({ data: { pairingId: f.pairing.id, tuteeId: peer.id } });
    await tx.sessionPlanAssignment.update({ where: { planId_pairingId: { planId: plan.id, pairingId: f.pairing.id } }, data: { tuteeIds: [f.tutee.id, peer.id] } });
    await tx.sessionPlanParticipant.create({ data: { planId: plan.id, cohortId: cohort.id, tuteeId: peer.id } });
    await tx.sessionPlanParticipant.update({ where: { planId_tuteeId: { planId: plan.id, tuteeId: f.tutee.id } }, data: { scheduleOverride: true } });
    // Capture durable exact consent, rather than treating scheduleOverride as
    // evidence. Queueing below executes the real optional-mail selection path.
    const request = await tx.sessionPlanningRequest.create({ data: {
      planId: plan.id, cohortId: cohort.id, kind: "RESCHEDULE", scope: "ONE",
      participantIds: [f.tutee.id], status: "ACCEPTED",
    } });
    const offer = await tx.sessionPlanningOffer.create({ data: {
      requestId: request.id, sequence: 1, authorKey: `tutor:${f.tutor.id}`,
      date, startMin: cohort.startMin, endMin: cohort.endMin, startsAt: cohort.startsAt, endsAt: cohort.endsAt,
      roomId: cohort.roomId, online: cohort.online, cutoffAt: cohort.startsAt,
      responses: { create: [
        { actorKey: `tutor:${f.tutor.id}`, actorUserId: f.tutorUser.id, state: "ACCEPTED", acceptedBy: "AUTHOR" },
        { actorKey: `tutee:${f.tutee.id}`, actorUserId: f.studentUser.id, state: "ACCEPTED", acceptedBy: "EXPLICIT" },
      ] },
    } });
    await tx.sessionPlanningRequest.update({ where: { id: request.id }, data: { currentOfferId: offer.id } });
    await queueEventReminders(tx, now);
    const ordinaryReceipt = (await f.queued()).find((row) => row.userId === peerUser.id)!;
    expect(ordinaryReceipt).toBeDefined();
    await saveProgramCalendar(tx, { date, endDate: date, reason: "PRIVATE SYNTHETIC PAUSE REASON", schedulingEffect: "PAUSE_REGULAR", expectedVersion: 0 });
    expect(await tx.sessionPlanParticipant.findUniqueOrThrow({ where: { planId_tuteeId: { planId: plan.id, tuteeId: peer.id } } })).toMatchObject({ status: "CANCELLED", tutoringPauseSuppressed: true });
    expect(await validateEventReminder(tx, ordinaryReceipt, now)).toBe(false);
    await tx.emailDelivery.deleteMany({ where: { userId: { in: f.users }, category: "reminder" } });
    await queueEventReminders(tx, now);
    const retained = await f.queued();
    expect(retained.map((row) => row.userId).sort()).toEqual([f.tutorUser.id, f.studentUser.id].sort());
    for (const row of retained) {
      expect(row.context).toMatchObject({ kind: "tutoring_cohort", sourceId: cohort.id });
      expect(await validateEventReminder(tx, row, now)).toBe(true);
    }
    expect(JSON.stringify(retained.map((row) => row.context))).not.toContain("Casey Synthetic");
    expect(JSON.stringify(retained.map((row) => row.context))).not.toContain("PRIVATE SYNTHETIC PAUSE REASON");
    const notice = await saveProgramCalendar(tx, { date: "2096-10-28", endDate: "2096-10-30", reason: "PRIVATE SYNTHETIC NOTICE REASON", schedulingEffect: "NOTICE", expectedVersion: 0 });
    for (const row of retained) expect(await validateEventReminder(tx, row, now)).toBe(false);
    await tx.emailDelivery.deleteMany({ where: { userId: { in: f.users }, category: "reminder" } });
    await queueEventReminders(tx, now);
    expect(await f.queued()).toHaveLength(0);
    await removeProgramCalendar(tx, { date: notice.date, expectedVersion: notice.version });
    await queueEventReminders(tx, now);
    expect((await f.queued()).map((row) => row.userId).sort()).toEqual([f.tutorUser.id, f.studentUser.id].sort());
    expect(await tx.sessionPlanCohort.findUniqueOrThrow({ where: { id: cohort.id } })).toMatchObject({ status: "SCHEDULED" });
  });
});

it("withdraws the original weekly occurrence after a move and reminds at the agreed time", async () => {
  await fixture(async (tx, f) => {
    await queueEventReminders(tx, now);
    const old = (await f.queued())[0]!;
    const { cohort } = await f.publish();
    const moved = new Date(startsAt.getTime() + 2 * 3_600_000);
    await tx.sessionPlanCohort.update({
      where: { id: cohort.id },
      data: {
        startsAt: moved,
        endsAt: new Date(moved.getTime() + 45 * 60_000),
        startMin: 1050,
        endMin: 1095,
        rescheduled: true,
      },
    });
    expect(await validateEventReminder(tx, old, now)).toBe(false);
    await tx.emailDelivery.deleteMany({
      where: { userId: { in: f.users }, category: "reminder" },
    });
    await queueEventReminders(tx, now);
    expect(await f.queued()).toHaveLength(0);
    await queueEventReminders(tx, new Date(moved.getTime() - 3_600_000));
    expect(await f.queued()).toHaveLength(2);
    expect((await f.queued())[0]?.context).toMatchObject({
      startsAt: moved.toISOString(),
      kind: "tutoring_cohort",
    });
  });
});

it("does not resend an accepted weekly reminder when the same occurrence is published", async () => {
  await fixture(async (tx, f) => {
    await queueEventReminders(tx, now);
    await tx.emailDelivery.updateMany({
      where: { userId: { in: f.users }, category: "reminder" },
      data: { status: "SENT" },
    });
    await f.publish();
    await queueEventReminders(tx, now);
    expect(await f.queued()).toHaveLength(2);
    expect((await f.queued()).every((row) => row.status === "SENT")).toBe(true);
  });
});

it("refreshes an unsent weekly receipt in place and retains the published time zone", async () => {
  await fixture(async (tx, f) => {
    await queueEventReminders(tx, now);
    const before = await f.queued();
    const { cohort } = await f.publish();
    await tx.programSettings.update({
      where: { id: "program" },
      data: { timeZone: "America/New_York" },
    });
    await queueEventReminders(tx, now);
    const after = await f.queued();
    expect(after.map((row) => row.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );
    for (const row of after) {
      expect(row).toMatchObject({
        status: "PENDING",
        context: {
          kind: "tutoring_cohort",
          sourceId: cohort.id,
          timeZone: "Asia/Shanghai",
        },
      });
      expect(await validateEventReminder(tx, row, now)).toBe(true);
    }
  });
});

it("reminds for an extra cohort and honors category preferences independently", async () => {
  await fixture(async (tx, f) => {
    await f.publish("EXTRA");
    // The extra occurs on a different day from the weekly assignment.
    await tx.pairing.update({
      where: { id: f.pairing.id },
      data: { dayOfWeek: 2 },
    });
    await tx.notificationPreference.create({
      data: {
        userId: f.tutorUser.id,
        category: "reminders",
        emailEnabled: false,
      },
    });
    await queueEventReminders(tx, now);
    const rows = await f.queued();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(f.studentUser.id);
    expect(rows[0]?.preferenceTopic).toBe("reminders");
    await tx.notificationPreference.create({
      data: {
        userId: f.studentUser.id,
        category: "reminders",
        emailEnabled: false,
      },
    });
    expect(await validateEventReminder(tx, rows[0]!, now)).toBe(false);
  });
});

it("uses each split cohort's participants instead of the original whole-group audience", async () => {
  await fixture(async (tx, f) => {
    const { plan } = await f.publish();
    const second = await tx.tutee.create({
      data: { englishName: "Casey Synthetic", status: "ACTIVE" },
    });
    const secondUser = await tx.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        role: "STUDENT",
        studentId: second.id,
        tuteeMember: true,
        emailVerifiedAt: now,
        emailEventReminders: true,
      },
    });
    f.users.push(secondUser.id);
    await tx.pairingTutee.create({
      data: { pairingId: f.pairing.id, tuteeId: second.id },
    });
    await tx.sessionPlanAssignment.update({
      where: { planId_pairingId: { planId: plan.id, pairingId: f.pairing.id } },
      data: { tuteeIds: [f.tutee.id, second.id] },
    });
    const moved = new Date(startsAt.getTime() + 2 * 3_600_000);
    const cohort = await tx.sessionPlanCohort.create({
      data: {
        planId: plan.id,
        date,
        startMin: 1050,
        endMin: 1095,
        startsAt: moved,
        endsAt: new Date(moved.getTime() + 45 * 60_000),
        rescheduled: true,
      },
    });
    await tx.sessionPlanParticipant.create({
      data: {
        planId: plan.id,
        cohortId: cohort.id,
        tuteeId: second.id,
        scheduleOverride: true,
      },
    });
    await queueEventReminders(tx, now);
    const initial = await f.queued();
    expect(initial.map((row) => row.userId).sort()).toEqual(
      [f.tutorUser.id, f.studentUser.id].sort(),
    );
    expect(JSON.stringify(initial.map((row) => row.context))).not.toContain(
      "Casey Synthetic",
    );
    await tx.emailDelivery.deleteMany({
      where: { userId: { in: f.users }, category: "reminder" },
    });
    await queueEventReminders(tx, new Date(moved.getTime() - 3_600_000));
    const later = await f.queued();
    expect(later.map((row) => row.userId).sort()).toEqual(
      [f.tutorUser.id, secondUser.id].sort(),
    );
    expect(JSON.stringify(later.map((row) => row.context))).not.toContain(
      "Morgan Synthetic",
    );
  });
});

it("rechecks current source ownership, closures and tutor or tutee absence", async () => {
  await fixture(async (tx, f) => {
    const { cohort } = await f.publish();
    await queueEventReminders(tx, now);
    const row = (await f.queued())[0]!;
    await tx.schoolCalendarDay.upsert({
      where: { date },
      create: { date, isSchoolDay: false, note: "Synthetic closure" },
      update: { active: true, isSchoolDay: false },
    });
    expect(await validateEventReminder(tx, row, now)).toBe(false);
    await tx.schoolCalendarDay.update({
      where: { date },
      data: { active: false },
    });
    expect(await validateEventReminder(tx, row, now)).toBe(true);
    await tx.programCalendarDay.upsert({
      where: { date },
      create: { date, endDate: date, reason: "Synthetic no tutoring notice" },
      update: { endDate: date, active: true },
    });
    expect(await validateEventReminder(tx, row, now)).toBe(false);
    await tx.programCalendarDay.update({
      where: { date },
      data: { active: false },
    });
    expect(await validateEventReminder(tx, row, now)).toBe(true);
    const session = await tx.session.create({
      data: {
        pairingId: f.pairing.id,
        tutorId: f.tutor.id,
        date: new Date(`${date}T00:00:00Z`),
        startMin: 930,
        endMin: 975,
        durationMin: 45,
        tutorStatus: "TUTOR_ABSENT",
        planningCohortId: cohort.id,
        month: "2096-10",
        schoolYear: "96-97",
        quarter: "Q1",
        shFactor: 1,
        shCount: 0,
      },
    });
    expect(await validateEventReminder(tx, row, now)).toBe(false);
    await tx.session.update({
      where: { id: session.id },
      data: {
        tutorStatus: "PRESENT",
        tutees: { create: { tuteeId: f.tutee.id, status: "EXCUSED_ABSENT" } },
      },
    });
    expect(await validateEventReminder(tx, row, now)).toBe(false);
    await tx.session.delete({ where: { id: session.id } });
    await tx.pairingTutee.deleteMany({ where: { pairingId: f.pairing.id } });
    expect(await readCurrentSessionReminderCohort(tx, cohort.id)).toBeNull();
    expect(await validateEventReminder(tx, row, now)).toBe(false);
  });
});
