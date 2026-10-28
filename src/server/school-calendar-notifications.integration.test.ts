import { afterAll, beforeEach, expect, it } from "vitest";
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { lockEntity } from "./transactions";
import {
  notifySchoolCalendarChange,
  remindUpcomingSchoolCalendar,
  schoolCalendarEmailEligible,
  schoolCalendarNotificationId,
} from "./school-calendar-notifications";

// Guard at module evaluation: every fixture is synthetic and isolated from demo/production.
assertIsolatedTestDatabase(process.env.DATABASE_URL);
const prefix = "school-calendar-notice-fixture-";
const date = "2026-11-02"; // Civil Monday; Tuesday/Wednesday mappings exercise both cohorts.
const now = new Date("2026-11-01T10:00:00Z"); // Prior day 18:00 in school time.
const noticeWhere = {
  userId: { startsWith: prefix },
  event: { startsWith: "school_calendar_" },
};
async function cleanup() {
  // Match person-combine.test.ts: the serialized isolated test database resets
  // complete fixtures; production retirement/deletion guards remain enabled.
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables.map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"').join(",") +
      " CASCADE",
  );
}
beforeEach(async () => {
  await cleanup();
  await db.programSettings.upsert({
    where: { id: "program" },
    create: { id: "program", emailNotificationsEnabled: true },
    update: { emailNotificationsEnabled: true, timeZone: "Asia/Shanghai" },
  });
  await db.term.create({
    data: {
      id: `${prefix}term`,
      name: "Synthetic calendar term",
      schoolYear: "96-97",
      quarter: "Q1",
      active: true,
    },
  });
  for (const weekday of [1, 2, 3]) {
    const tutorId = `${prefix}tutor-${weekday}`;
    const studentId = `${prefix}student-${weekday}`;
    await db.tutor.create({
      data: { id: tutorId, englishName: "Synthetic tutor" },
    });
    await db.tutee.create({
      data: { id: studentId, englishName: "Synthetic tutee" },
    });
    await db.user.create({
      data: {
        id: `${prefix}tutor-user-${weekday}`,
        email: `${prefix}tutor-${weekday}@example.test`,
        role: weekday === 3 ? "HEAD" : "TUTOR",
        tutorId,
        emailInfo: true,
        emailVerifiedAt: now,
      },
    });
    await db.user.create({
      data: {
        id: `${prefix}student-user-${weekday}`,
        email: `${prefix}student-${weekday}@example.test`,
        role: "STUDENT",
        studentId: weekday === 3 ? null : studentId,
        tuteeMember: true,
        emailInfo: true,
        emailVerifiedAt: now,
      },
    });
    if (weekday === 3)
      await db.studentProfileOwnership.create({
        data: {
          tuteeId: studentId,
          userId: `${prefix}student-user-${weekday}`,
        },
      });
    await db.pairing.create({
      data: {
        id: `${prefix}pairing-${weekday}`,
        tutorId,
        termId: `${prefix}term`,
        subject: "Synthetic subject",
        dayOfWeek: weekday,
        startMin: 900,
        endMin: 960,
        scheduleConfirmed: true,
        tutees: { create: { tuteeId: studentId } },
      },
    });
  }
});
afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

async function applyMapping(
  weekday = 2,
  announcedAt = new Date("2026-10-31T10:00:00Z"),
) {
  return db.$transaction(async (tx) => {
    await lockEntity(tx, `school-calendar:${date}`);
    const before = await tx.schoolCalendarDay.findUnique({ where: { date } });
    const after = await tx.schoolCalendarDay.upsert({
      where: { date },
      create: { date, isSchoolDay: true, timetableWeekday: weekday },
      update: {
        timetableWeekday: weekday,
        version: { increment: 1 },
        scheduleRevision: { increment: 1 },
      },
    });
    await notifySchoolCalendarChange(tx, { before, after }, announcedAt);
    return after;
  });
}

it("commits one notice per affected linked tutor/tutee and rolls back source, in-app and outbox together", async () => {
  await expect(
    db.$transaction(async (tx) => {
      const after = await tx.schoolCalendarDay.create({
        data: { date, isSchoolDay: true, timetableWeekday: 2 },
      });
      await notifySchoolCalendarChange(tx, { before: null, after }, now);
      throw new Error("Synthetic source rollback");
    }),
  ).rejects.toThrow("Synthetic source rollback");
  expect(await db.schoolCalendarDay.findUnique({ where: { date } })).toBeNull();
  expect(await db.notification.count({ where: noticeWhere })).toBe(0);
  expect(await db.emailDelivery.count({ where: noticeWhere })).toBe(0);

  await applyMapping();
  expect(await db.notification.count({ where: noticeWhere })).toBe(4);
  expect(await db.emailDelivery.count({ where: noticeWhere })).toBe(4);
});

it("deduplicates concurrent advance sweeps and preserves receipts through note-only editor changes", async () => {
  await applyMapping();
  await Promise.all([
    remindUpcomingSchoolCalendar(db, now),
    remindUpcomingSchoolCalendar(db, now),
  ]);
  const upcoming = { ...noticeWhere, event: "school_calendar_upcoming" };
  expect(await db.notification.count({ where: upcoming })).toBe(4);
  expect(await db.emailDelivery.count({ where: upcoming })).toBe(4);
  await db.schoolCalendarDay.update({
    where: { date },
    data: { note: "Synthetic note-only edit", version: { increment: 1 } },
  });
  await remindUpcomingSchoolCalendar(db, now);
  expect(await db.notification.count({ where: upcoming })).toBe(4);
  expect(await db.emailDelivery.count({ where: upcoming })).toBe(4);
});

it("preserves migrated advance receipts after account combination without duplicating notice or outbox", async () => {
  await applyMapping();
  await remindUpcomingSchoolCalendar(db, now);
  const retiredId = `${prefix}tutor-user-1`;
  const survivorId = `${prefix}merged-user`;
  const original = await db.notification.findFirstOrThrow({ where: {
    userId: retiredId, event: "school_calendar_upcoming",
    context: { path: ["schoolDate"], equals: date },
  } });
  await db.user.create({ data: {
    id: survivorId, email: `${prefix}merged@example.test`, role: "TUTOR",
    emailInfo: true, emailVerifiedAt: now,
  } });
  // Match the existing combination contract: direct access and receipt ownership
  // move to the survivor; immutable receipt IDs/context remain unchanged.
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: retiredId }, data: { tutorId: null, mergedIntoId: survivorId } });
    await tx.user.update({ where: { id: survivorId }, data: { tutorId: `${prefix}tutor-1` } });
    await tx.notification.updateMany({ where: { userId: retiredId }, data: { userId: survivorId } });
  });
  const beforeMail = await db.emailDelivery.count({ where: noticeWhere });
  await Promise.all([remindUpcomingSchoolCalendar(db, now), remindUpcomingSchoolCalendar(db, now)]);
  expect(await db.notification.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({ userId: survivorId, context: original.context, createdAt: original.createdAt });
  expect(await db.notification.count({ where: { userId: survivorId, event: "school_calendar_upcoming" } })).toBe(1);
  expect(await db.notification.findUnique({ where: { id: schoolCalendarNotificationId(date, 1, "upcoming", survivorId) } })).toBeNull();
  expect(await db.emailDelivery.count({ where: noticeWhere })).toBe(beforeMail);
});

it("does not suppress advance reminders using receipts from another event, date or revision", async () => {
  await applyMapping();
  const userId = `${prefix}tutor-user-1`;
  const facts = { schoolDate: date, isSchoolDay: true, timetableWeekday: 2, calendarRevision: 1, timeZone: "Asia/Shanghai" };
  const unrelated = [
    { id: `${prefix}other-date`, event: "school_calendar_upcoming", context: { ...facts, schoolDate: "2026-11-03" } },
    { id: `${prefix}other-revision`, event: "school_calendar_upcoming", context: { ...facts, calendarRevision: 99 } },
    { id: `${prefix}other-phase`, event: "school_calendar_reset", context: facts },
  ];
  await db.notification.createMany({ data: unrelated.map((row) => ({ ...row, userId, title: "Synthetic unrelated receipt", inAppOnly: true })) });
  await remindUpcomingSchoolCalendar(db, now);
  expect(await db.notification.findUniqueOrThrow({ where: { id: schoolCalendarNotificationId(date, 1, "upcoming", userId) } })).toMatchObject({ userId, event: "school_calendar_upcoming", context: facts });
  for (const row of unrelated) {
    expect(await db.notification.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject(row);
  }
});

it("coalesces late applied changes with advance reminders without inventing an upcoming receipt", async () => {
  await applyMapping(2, now);
  await Promise.all([
    remindUpcomingSchoolCalendar(db, now),
    remindUpcomingSchoolCalendar(db, now),
  ]);
  expect(
    await db.notification.count({
      where: { ...noticeWhere, event: "school_calendar_changed" },
    }),
  ).toBe(4);
  expect(
    await db.notification.count({
      where: { ...noticeWhere, event: "school_calendar_upcoming" },
    }),
  ).toBe(0);
  expect(
    await db.emailDelivery.count({
      where: { ...noticeWhere, event: "school_calendar_upcoming" },
    }),
  ).toBe(0);
  await remindUpcomingSchoolCalendar(db, new Date("2026-11-02T01:00:00Z"));
  expect(await db.notification.count({ where: noticeWhere })).toBe(4);
});

it("corrects civil/prior/new cohorts, cancels obsolete unsent mail and retains sent evidence", async () => {
  await applyMapping();
  const old = await db.emailDelivery.findMany({ where: noticeWhere });
  await db.emailDelivery.update({
    where: { id: old[0]!.id },
    data: { status: "SENT", completedAt: now },
  });
  await applyMapping(3);
  expect(
    await db.notification.count({
      where: {
        ...noticeWhere,
        context: { path: ["calendarRevision"], equals: 2 },
      },
    }),
  ).toBe(6);
  expect(
    await db.emailDelivery.findUniqueOrThrow({ where: { id: old[0]!.id } }),
  ).toMatchObject({ status: "SENT" });
  for (const row of old.slice(1)) {
    expect(
      await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({ status: "SKIPPED" });
    expect(await schoolCalendarEmailEligible(db, row, now)).toBe(false);
  }
  const latest = await db.emailDelivery.findMany({
    where: { ...noticeWhere, status: "PENDING" },
  });
  expect(latest).toHaveLength(6);
  expect(await schoolCalendarEmailEligible(db, latest[0]!, now)).toBe(true);
});

it("excludes suspended, departed, unconfirmed and inactive identities using live database state", async () => {
  await db.user.update({
    where: { id: `${prefix}tutor-user-1` },
    data: { suspendedAt: now },
  });
  await db.schoolDeparture.create({
    data: {
      userId: `${prefix}student-user-1`,
      reason: "TRANSFERRED",
      confirmedAt: now,
      source: "HEAD",
    },
  });
  await db.pairing.update({
    where: { id: `${prefix}pairing-2` },
    data: { scheduleConfirmed: false },
  });
  await applyMapping();
  expect(await db.notification.count({ where: noticeWhere })).toBe(0);
});

it("fences stale and same-revision-wrong-state mail, with current eligibility rechecked at dispatch", async () => {
  await applyMapping();
  const row = await db.emailDelivery.findFirstOrThrow({
    where: { ...noticeWhere, userId: `${prefix}tutor-user-1` },
  });
  expect(await schoolCalendarEmailEligible(db, row, now)).toBe(true);
  await db.tutor.update({
    where: { id: `${prefix}tutor-1` },
    data: { status: "OPTED_OUT" },
  });
  expect(await schoolCalendarEmailEligible(db, row, now)).toBe(false);
  await db.tutor.update({
    where: { id: `${prefix}tutor-1` },
    data: { status: "ACTIVE" },
  });
  expect(
    await schoolCalendarEmailEligible(
      db,
      { ...row, context: { ...(row.context as object), timetableWeekday: 3 } },
      now,
    ),
  ).toBe(false);
});

it("enforces the SQL context allowlist independently and keeps calendar mail preference-controlled", async () => {
  await applyMapping();
  const safe = {
    schoolDate: date,
    isSchoolDay: true,
    timetableWeekday: 2,
    calendarRevision: 1,
    timeZone: "Asia/Shanghai",
  };
  await db.notification.create({
    data: {
      id: `${prefix}raw-notice`,
      userId: `${prefix}student-user-1`,
      event: "school_calendar_changed",
      title: "PRIVATE TITLE",
      body: "PRIVATE BODY",
      link: `/student#school-calendar/${date}`,
      context: {
        ...safe,
        note: "PRIVATE NOTE",
        participant: "PRIVATE PARTICIPANT",
        email: "private@example.test",
      },
    },
  });
  const rows = await db.emailDelivery.findMany({
    where: { ...noticeWhere, userId: `${prefix}student-user-1` },
  });
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row.context).toEqual(safe);
  expect(JSON.stringify(rows)).not.toContain("PRIVATE");

  await db.user.update({
    where: { id: `${prefix}tutor-user-1` },
    data: { emailInfo: false },
  });
  await applyMapping(3);
  expect(
    await db.emailDelivery.count({
      where: {
        ...noticeWhere,
        userId: `${prefix}tutor-user-1`,
        context: { path: ["calendarRevision"], equals: 2 },
      },
    }),
  ).toBe(0);
  expect(
    await db.notification.count({
      where: {
        ...noticeWhere,
        userId: `${prefix}tutor-user-1`,
        context: { path: ["calendarRevision"], equals: 2 },
      },
    }),
  ).toBe(1);
  await db.programSettings.update({
    where: { id: "program" },
    data: { emailNotificationsEnabled: false },
  });
  await applyMapping(1);
  expect(
    await db.emailDelivery.count({
      where: {
        ...noticeWhere,
        context: { path: ["calendarRevision"], equals: 3 },
      },
    }),
  ).toBe(0);
  expect(
    await db.notification.count({
      where: {
        ...noticeWhere,
        context: { path: ["calendarRevision"], equals: 3 },
      },
    }),
  ).toBe(6);
});
