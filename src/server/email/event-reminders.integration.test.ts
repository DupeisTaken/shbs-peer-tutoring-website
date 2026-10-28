import { afterAll, beforeEach, expect, it } from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { queueEventReminders, validateEventReminder } from "./event-reminders";

const prefix = "reminder-integration-";
const tutorId = `${prefix}tutor`;
const userId = `${prefix}user`;
const studentId = `${prefix}student`;
const studentUserId = `${prefix}student-user`;
const termId = `${prefix}term`;
const pairingId = `${prefix}pairing`;
const groupId = `${prefix}group`;
const start = new Date("2096-10-29T07:30:00.000Z");
const now = new Date(start.getTime() - 3_600_000);
const schoolDate = "2096-10-29";

async function cleanup() {
  await db.interviewAssignment.deleteMany({
    where: { applicationId: { startsWith: prefix } },
  });
  await db.tutorApplication.deleteMany({
    where: { id: { startsWith: prefix } },
  });
  await db.sessionTutee.deleteMany({
    where: { session: { id: { startsWith: prefix } } },
  });
  await db.session.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.emailDelivery.deleteMany({
    where: { userId: { in: [userId, studentUserId] } },
  });
  await db.pairingTutee.deleteMany({
    where: { pairingId: { startsWith: prefix } },
  });
  await db.pairing.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.pairingGroup.deleteMany({ where: { id: groupId } });
  await db.meetingAttendance.deleteMany({
    where: { meetingId: { startsWith: prefix } },
  });
  await db.tutorMeeting.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.studentProfileOwnership.deleteMany({
    where: { userId: studentUserId },
  });
  await db.user.deleteMany({ where: { id: { in: [userId, studentUserId] } } });
  await db.tutee.deleteMany({ where: { id: studentId } });
  await db.tutor.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.term.deleteMany({ where: { id: termId } });
  await db.schoolCalendarDay.deleteMany({ where: { date: schoolDate } });
  await db.programCalendarDay.deleteMany({ where: { date: schoolDate } });
}

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  await cleanup();
  for (const key of ["MEETINGS", "INTERVIEWS"] as const) {
    await db.programFeature.upsert({
      where: { key },
      create: { key, enabled: true },
      update: { enabled: true, pendingEnabled: null },
    });
  }
  await db.programSettings.upsert({
    where: { id: "program" },
    create: {
      id: "program",
      emailNotificationsEnabled: true,
      timeZone: "Asia/Shanghai",
    },
    update: { emailNotificationsEnabled: true, timeZone: "Asia/Shanghai" },
  });
  await db.tutor.create({
    data: { id: tutorId, englishName: "Alice Synthetic", status: "ACTIVE" },
  });
  await db.user.create({
    data: {
      id: userId,
      email: "reminder-tutor@example.test",
      role: "TUTOR",
      tutorId,
      emailVerifiedAt: now,
      emailEventReminders: true,
    },
  });
  await db.tutee.create({
    data: { id: studentId, englishName: "Emma Synthetic", status: "ACTIVE" },
  });
  await db.user.create({
    data: {
      id: studentUserId,
      email: "reminder-student@example.test",
      role: "STUDENT",
      studentId,
      tuteeMember: true,
      emailVerifiedAt: now,
      emailEventReminders: true,
    },
  });
  await db.studentProfileOwnership.create({
    data: { userId: studentUserId, tuteeId: studentId },
  });
  await db.term.create({
    data: {
      id: termId,
      schoolYear: "96-97",
      quarter: "Q1",
      name: "Synthetic reminder term",
      active: true,
    },
  });
});
afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

async function createPairing() {
  return db.pairing.create({
    data: {
      id: pairingId,
      tutorId,
      termId,
      subject: "Mathematics",
      dayOfWeek: new Date(`${schoolDate}T12:00:00Z`).getUTCDay(),
      startMin: 930,
      endMin: 990,
      scheduleConfirmed: true,
      tutees: { create: { tuteeId: studentId } },
    },
  });
}
async function queued() {
  return db.emailDelivery.findMany({
    where: { category: "reminder", userId: { in: [userId, studentUserId] } },
    orderBy: { userId: "asc" },
  });
}

it("database uniqueness deduplicates concurrent sweeps at each independent lead threshold", async () => {
  await db.tutorMeeting.create({
    data: {
      id: `${prefix}meeting`,
      title: "Synthetic meeting",
      date: start,
      termId,
    },
  });
  await Promise.all([
    queueEventReminders(db, now),
    queueEventReminders(db, now),
  ]);
  expect(await queued()).toHaveLength(1);
  await queueEventReminders(db, new Date(start.getTime() - 86_400_000));
  const rows = await queued();
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.reminderKey)).size).toBe(2);
});

it("refreshes unsent metadata at one occurrence without duplicating SENT delivery", async () => {
  const id = `${prefix}meeting`;
  await db.tutorMeeting.create({
    data: { id, title: "Original title", date: start, termId },
  });
  await queueEventReminders(db, now);
  const original = (await queued())[0]!;
  await db.tutorMeeting.update({
    where: { id },
    data: { title: "Updated title" },
  });
  expect(await validateEventReminder(db, original, now)).toBe(false);
  await queueEventReminders(db, now);
  const updated = (await queued())[0]!;
  expect(updated.id).toBe(original.id);
  expect(await validateEventReminder(db, updated, now)).toBe(true);
  await db.emailDelivery.update({
    where: { id: updated.id },
    data: { status: "SENT" },
  });
  await db.tutorMeeting.update({
    where: { id },
    data: { title: "Later title" },
  });
  await queueEventReminders(db, now);
  expect(await queued()).toHaveLength(1);
  expect((await queued())[0]!.status).toBe("SENT");
});

it("deduplicates grouped pairings and reveals tutee names only to the assigned tutor", async () => {
  await createPairing();
  await db.pairingGroup.create({
    data: { id: groupId, tutorId, termId, primaryPairingId: pairingId },
  });
  await db.pairing.update({ where: { id: pairingId }, data: { groupId } });
  await db.pairing.create({
    data: {
      id: `${prefix}second`,
      tutorId,
      termId,
      groupId,
      subject: "Physics",
      dayOfWeek: new Date(`${schoolDate}T12:00:00Z`).getUTCDay(),
      startMin: 930,
      endMin: 990,
      scheduleConfirmed: true,
      tutees: { create: { tuteeId: studentId } },
    },
  });
  await queueEventReminders(db, now);
  const rows = await queued();
  expect(rows).toHaveLength(2);
  expect(
    JSON.stringify(rows.find((row) => row.userId === userId)!.context),
  ).toContain("Emma Synthetic");
  expect(
    JSON.stringify(rows.find((row) => row.userId === studentUserId)!.context),
  ).not.toContain("Emma Synthetic");
  expect(
    JSON.stringify(rows.find((row) => row.userId === studentUserId)!.context),
  ).toContain("Alice Synthetic");
  for (const row of rows)
    expect(await validateEventReminder(db, row, now)).toBe(true);
});

it.each([
  "TUTOR_ABSENT",
  "RESCHEDULED",
  "EXCUSED_ABSENT",
  "UNEXCUSED_ABSENT",
] as const)(
  "late %s evidence suppresses all recipients and both thresholds",
  async (status) => {
    await createPairing();
    await queueEventReminders(db, now);
    const rows = await queued();
    expect(rows).toHaveLength(2);
    await db.session.create({
      data: {
        id: `${prefix}session`,
        pairingId,
        tutorId,
        date: new Date(`${schoolDate}T00:00:00Z`),
        startMin: 930,
        endMin: 990,
        tutorStatus:
          status === "TUTOR_ABSENT" || status === "RESCHEDULED"
            ? status
            : "PRESENT",
        month: "2096-10",
        schoolYear: "96-97",
        quarter: "Q1",
        durationMin: 60,
        shFactor: 1,
        shCount: 0,
        tutees: {
          create: {
            tuteeId: studentId,
            status:
              status === "EXCUSED_ABSENT" || status === "UNEXCUSED_ABSENT"
                ? status
                : "PRESENT",
          },
        },
      },
    });
    for (const row of rows)
      expect(await validateEventReminder(db, row, now)).toBe(false);
    await queueEventReminders(db, new Date(start.getTime() - 86_400_000));
    expect(await queued()).toHaveLength(2);
  },
);

it.each(["holiday", "notice"] as const)(
  "rechecks %s suppression after enqueue without changing attendance",
  async (kind) => {
    await createPairing();
    await queueEventReminders(db, now);
    const row = (await queued())[0]!;
    if (kind === "holiday")
      await db.schoolCalendarDay.create({
        data: { date: schoolDate, isSchoolDay: false },
      });
    else
      await db.programCalendarDay.create({
        data: {
          date: schoolDate,
          endDate: schoolDate,
          reason: "Synthetic no tutoring",
          active: true,
        },
      });
    expect(await validateEventReminder(db, row, now)).toBe(false);
    expect(await db.session.count({ where: { pairingId } })).toBe(0);
  },
);

it("withdraws a queued reminder after excuse, opt-out or unlinking", async () => {
  const meetingId = `${prefix}meeting`;
  await db.tutorMeeting.create({
    data: { id: meetingId, title: "Synthetic meeting", date: start },
  });
  await queueEventReminders(db, now);
  const row = (await queued())[0]!;
  await db.meetingAttendance.create({
    data: { meetingId, tutorId, status: "EXCUSED_ABSENT", excusedAt: now },
  });
  expect(await validateEventReminder(db, row, now)).toBe(false);
  await db.meetingAttendance.deleteMany({ where: { meetingId } });
  await db.user.update({
    where: { id: userId },
    data: { emailEventReminders: false },
  });
  expect(await validateEventReminder(db, row, now)).toBe(false);
  await db.user.update({
    where: { id: userId },
    data: { emailEventReminders: true, tutorId: null },
  });
  expect(await validateEventReminder(db, row, now)).toBe(false);
});

it("queues interview reminders for the current panel and linked qualification applicant only", async () => {
  // Qualification history is deliberately undeletable. Roll back this fixture
  // instead of weakening its production retention trigger for test cleanup.
  const rollback = new Error("rollback interview reminder fixture");
  await expect(
    db.$transaction(async (tx) => {
      const applicantTutorId = `${prefix}applicant-tutor`;
      const applicationId = `${prefix}application`;
      const subjectId = `${prefix}subject`;
      await tx.subject.create({
        data: { id: subjectId, name: "Synthetic reminder qualification" },
      });
      await tx.tutor.create({
        data: {
          id: applicantTutorId,
          englishName: "Applicant Synthetic",
          status: "ACTIVE",
        },
      });
      await tx.user.update({
        where: { id: studentUserId },
        data: { tutorId: applicantTutorId },
      });
      await tx.tutorApplication.create({
        data: {
          id: applicationId,
          name: "Applicant Synthetic",
          email: "unlinked-application@example.test",
          type: "ADDITIONAL_SUBJECT",
          status: "INTERVIEW",
          interviewAt: start,
          requestedTutorId: applicantTutorId,
          requestedSubjectId: subjectId,
          qualificationReason: "Synthetic qualification evidence",
          interviewers: { create: { tutorId, isHead: true } },
        },
      });
      await queueEventReminders(tx, now);
      const rows = await tx.emailDelivery.findMany({
        where: {
          category: "reminder",
          userId: { in: [userId, studentUserId] },
        },
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.recipient)).not.toContain(
        "unlinked-application@example.test",
      );
      for (const row of rows)
        expect(await validateEventReminder(tx, row, now)).toBe(true);
      await tx.tutorApplication.update({
        where: { id: applicationId },
        data: {
          status: "ACCEPTED",
          qualificationDecidedById: userId,
          decidedAt: now,
          decisionComment: "Synthetic completed decision",
          qualificationSnapshot: { subjectIds: [subjectId] },
        },
      });
      for (const row of rows)
        expect(await validateEventReminder(tx, row, now)).toBe(false);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
