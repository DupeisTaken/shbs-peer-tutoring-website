import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../generated/prisma";
import type { DomainDb, TransactionDb } from "./transactions";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("./school-calendar-session-audience", () => ({
  getSchoolCalendarDatedSessionUserIds: vi.fn(async () => ["dated-tutor"]),
}));
import {
  notifySchoolCalendarChange,
  remindUpcomingSchoolCalendar,
  schoolCalendarEmailEligible,
  schoolCalendarNotificationId,
  schoolCalendarReminderDue,
  type SchoolCalendarNotificationSource,
} from "./school-calendar-notifications";

const source: SchoolCalendarNotificationSource = {
  date: "2026-11-02",
  isSchoolDay: true,
  timetableWeekday: 2,
  active: true,
  version: 2,
  scheduleRevision: 2,
};
const tutor = {
  id: "tutor",
  tutorId: "tutor-profile",
  tutorAccessRevoked: false,
  tutor: { status: "ACTIVE" },
  student: null,
  tuteeMember: false,
};
const student = {
  id: "student",
  tutorId: null,
  tutor: null,
  student: { status: "ACTIVE" },
  tuteeMember: true,
};
function fixture() {
  const mock = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    programSettings: {
      findUnique: vi.fn().mockResolvedValue({ timeZone: "Asia/Shanghai" }),
    },
    schoolCalendarDay: {
      findUnique: vi.fn().mockResolvedValue(source),
      findMany: vi.fn().mockResolvedValue([source]),
    },
    pairing: {
      findMany: vi
        .fn<
          (
            input: Prisma.PairingFindManyArgs,
          ) => Promise<{ tutorId: string; tutees: { tuteeId: string }[] }[]>
        >()
        .mockResolvedValue([
          {
            tutorId: "tutor-profile",
            tutees: [{ tuteeId: "student-profile" }],
          },
        ]),
    },
    user: { findMany: vi.fn().mockResolvedValue([tutor, student]) },
    studentProfileOwnership: { findMany: vi.fn().mockResolvedValue([]) },
    tutee: { findMany: vi.fn().mockResolvedValue([]) },
    notification: {
      findMany: vi
        .fn<
          (
            input: Prisma.NotificationFindManyArgs,
          ) => Promise<{ userId: string; createdAt: Date }[]>
        >()
        .mockImplementation(async (input) =>
          input.select?.createdAt || typeof input.where?.event !== "string"
            ? [{ userId: "earlier-recipient", createdAt: new Date("2026-10-31T00:00:00Z") }]
            : [],
        ),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    emailDelivery: {
      updateMany: vi
        .fn<
          (
            input: Prisma.EmailDeliveryUpdateManyArgs,
          ) => Promise<{ count: number }>
        >()
        .mockResolvedValue({ count: 0 }),
    },
  };
  return {
    mock,
    tx: mock as unknown as TransactionDb,
    db: mock as unknown as DomainDb,
  };
}
const context = {
  schoolDate: source.date,
  isSchoolDay: true,
  timetableWeekday: 2,
  calendarRevision: 2,
  timeZone: "Asia/Shanghai",
};

describe("calendar reminder wall-clock window", () => {
  it.each([
    ["2026-11-01T09:59:00Z", false],
    ["2026-11-01T10:00:00Z", true],
    ["2026-11-02T03:59:00Z", true],
    ["2026-11-02T04:00:00Z", false],
    ["2026-11-03T01:00:00Z", false],
  ])(
    "checks prior 18:00 through actual noon in the school timezone (%s)",
    (instant, expected) => {
      expect(
        schoolCalendarReminderDue(
          source.date,
          new Date(instant),
          "Asia/Shanghai",
        ),
      ).toBe(expected);
    },
  );
  it("keeps the same local window across a 25-hour DST day", () => {
    expect(
      schoolCalendarReminderDue(
        "2026-11-01",
        new Date("2026-10-31T22:00:00Z"),
        "America/New_York",
      ),
    ).toBe(true);
    expect(
      schoolCalendarReminderDue(
        "2026-11-01",
        new Date("2026-11-01T16:59:00Z"),
        "America/New_York",
      ),
    ).toBe(true);
    expect(
      schoolCalendarReminderDue(
        "2026-11-01",
        new Date("2026-11-01T17:00:00Z"),
        "America/New_York",
      ),
    ).toBe(false);
  });
});

it("uses recipient-scoped durable IDs without exposing participant IDs", () => {
  const id = schoolCalendarNotificationId(
    source.date,
    2,
    "changed",
    "private-user-id",
  );
  expect(id).toBe(
    schoolCalendarNotificationId(source.date, 2, "changed", "private-user-id"),
  );
  expect(id).not.toContain("private-user-id");
  expect(id).not.toBe(
    schoolCalendarNotificationId(source.date, 2, "upcoming", "private-user-id"),
  );
  expect(id).not.toBe(
    schoolCalendarNotificationId(source.date, 3, "changed", "private-user-id"),
  );
});

it("unions civil/prior/new weekdays and prior recipients, plus the actual dated cohort", async () => {
  const { tx, mock } = fixture();
  await notifySchoolCalendarChange(
    tx,
    {
      before: { ...source, timetableWeekday: 3, scheduleRevision: 1 },
      after: source,
    },
    new Date("2026-11-01T00:00:00Z"),
  );
  expect(mock.pairing.findMany.mock.calls[0]?.[0]).toMatchObject({
    where: {
      scheduleConfirmed: true,
      term: { active: true },
      dayOfWeek: { in: [1, 3, 2] },
    },
  });
  expect(mock.user.findMany.mock.calls[1]?.[0]).toMatchObject({
    where: {
      id: { in: ["tutor", "student", "dated-tutor", "earlier-recipient"] },
      suspendedAt: null,
      mergedIntoId: null,
    },
  });
  expect(mock.notification.createMany).toHaveBeenCalledWith({
    skipDuplicates: true,
    data: [
      expect.objectContaining({
        userId: "tutor",
        event: "school_calendar_changed",
        link: `/dashboard#school-calendar/${source.date}`,
        context,
      }),
      expect.objectContaining({
        userId: "student",
        event: "school_calendar_changed",
        link: `/student#school-calendar/${source.date}`,
        context,
      }),
    ],
  });
  expect(mock.emailDelivery.updateMany.mock.calls[0]?.[0]).toMatchObject({
    where: { status: { in: ["PENDING", "FAILED"] } },
    data: { status: "SKIPPED" },
  });
});

it("records same-day corrections after the advance reminder cutoff and omits historical changes", async () => {
  const { tx, mock } = fixture();
  await notifySchoolCalendarChange(
    tx,
    {
      before: source,
      after: { ...source, active: false, scheduleRevision: 3 },
    },
    new Date("2026-11-02T10:00:00Z"),
  );
  const resetContext = {
    schoolDate: source.date,
    isSchoolDay: true,
    timetableWeekday: 1,
    calendarRevision: 3,
    timeZone: "Asia/Shanghai",
  };
  expect(mock.notification.createMany.mock.calls[0]?.[0]).toEqual({
    skipDuplicates: true,
    data: [
      expect.objectContaining({
        userId: "tutor",
        event: "school_calendar_reset",
        link: `/dashboard#school-calendar/${source.date}`,
        context: resetContext,
      }),
      expect.objectContaining({
        userId: "student",
        event: "school_calendar_reset",
        link: `/student#school-calendar/${source.date}`,
        context: resetContext,
      }),
    ],
  });
  mock.notification.createMany.mockClear();
  await notifySchoolCalendarChange(
    tx,
    { before: null, after: source },
    new Date("2026-11-03T00:00:00Z"),
  );
  expect(mock.notification.createMany).not.toHaveBeenCalled();
});

it("bounds sweeps to today/tomorrow and re-reads the source under its write lock", async () => {
  const { db, mock } = fixture();
  mock.schoolCalendarDay.findUnique.mockResolvedValue({
    ...source,
    active: false,
  });
  await remindUpcomingSchoolCalendar(db, new Date("2026-11-01T10:00:00Z"));
  expect(mock.schoolCalendarDay.findMany).toHaveBeenCalledWith({
    where: { active: true, date: { in: ["2026-11-01", "2026-11-02"] } },
    orderBy: { date: "asc" },
  });
  expect(mock.$executeRaw).toHaveBeenCalled();
  expect(mock.notification.createMany).not.toHaveBeenCalled();
});

it("uses the semantic revision for upcoming IDs despite editor-only revision changes", async () => {
  const { db, mock } = fixture();
  mock.schoolCalendarDay.findUnique.mockResolvedValue({
    ...source,
    version: 9,
  });
  await remindUpcomingSchoolCalendar(db, new Date("2026-11-01T10:00:00Z"));
  expect(mock.notification.createMany.mock.calls[0]?.[0]).toMatchObject({
    skipDuplicates: true,
    data: [
      expect.objectContaining({
        id: schoolCalendarNotificationId(source.date, 2, "upcoming", "tutor"),
      }),
      expect.objectContaining({
        id: schoolCalendarNotificationId(source.date, 2, "upcoming", "student"),
      }),
    ],
  });
});

it("coalesces only recipients with an actual same-revision change receipt inside the advance window", async () => {
  const { db, mock } = fixture();
  mock.notification.findMany.mockImplementation(async (input) => input.select?.createdAt ? [
    { userId: "tutor", createdAt: new Date("2026-11-01T10:00:00Z") },
    { userId: "student", createdAt: new Date("2026-10-31T10:00:00Z") },
  ] : []);
  await remindUpcomingSchoolCalendar(db, new Date("2026-11-01T11:00:00Z"));
  expect(mock.notification.findMany.mock.calls[0]?.[0]).toMatchObject({
    where: {
      event: "school_calendar_changed",
      AND: [
        { context: { path: ["schoolDate"], equals: source.date } },
        { context: { path: ["calendarRevision"], equals: 2 } },
      ],
    },
  });
  expect(mock.notification.createMany.mock.calls[0]?.[0]).toMatchObject({
    data: [
      expect.objectContaining({
        userId: "student",
        event: "school_calendar_upcoming",
      }),
    ],
  });
});

it("preserves a reparented phase receipt and checks exact event/date/revision before suppressing a notice", async () => {
  const { db, mock } = fixture();
  const earlier = new Date("2026-10-31T00:00:00Z");
  mock.notification.findMany.mockImplementation(async (input) => input.select?.createdAt
    ? [{ userId: "earlier-recipient", createdAt: earlier }]
    : [{ userId: "tutor", createdAt: earlier }],
  );
  await remindUpcomingSchoolCalendar(db, new Date("2026-11-01T10:00:00Z"));
  expect(mock.notification.findMany.mock.calls[1]?.[0]).toEqual({
    where: {
      userId: { in: ["tutor", "student"] }, event: "school_calendar_upcoming",
      AND: [
        { context: { path: ["schoolDate"], equals: source.date } },
        { context: { path: ["calendarRevision"], equals: 2 } },
      ],
    },
    select: { userId: true },
  });
  expect(mock.notification.createMany.mock.calls[0]?.[0]).toMatchObject({ data: [
    expect.objectContaining({ userId: "student", event: "school_calendar_upcoming" }),
  ] });
});

describe("calendar mail admission", () => {
  it("rejects obsolete source revision and active/reset mismatches before identity lookup", async () => {
    const { db, mock } = fixture();
    expect(
      await schoolCalendarEmailEligible(
        db,
        {
          userId: "tutor",
          event: "school_calendar_changed",
          context: { ...context, calendarRevision: 1 },
        },
        new Date("2026-11-01T10:00:00Z"),
      ),
    ).toBe(false);
    expect(
      await schoolCalendarEmailEligible(
        db,
        { userId: "tutor", event: "school_calendar_reset", context },
        new Date("2026-11-01T10:00:00Z"),
      ),
    ).toBe(false);
    expect(mock.user.findMany).not.toHaveBeenCalled();
  });
  it("accepts note-only editor changes, but rejects inactive participants and expired reminders", async () => {
    const { db, mock } = fixture();
    mock.schoolCalendarDay.findUnique.mockResolvedValue({
      ...source,
      version: 9,
    });
    mock.user.findMany.mockResolvedValue([tutor]);
    const row = { userId: "tutor", event: "school_calendar_upcoming", context };
    expect(
      await schoolCalendarEmailEligible(
        db,
        row,
        new Date("2026-11-01T10:00:00Z"),
      ),
    ).toBe(true);
    mock.user.findMany.mockResolvedValue([
      { ...tutor, tutor: { status: "OPTED_OUT" } },
    ]);
    expect(
      await schoolCalendarEmailEligible(
        db,
        row,
        new Date("2026-11-01T10:00:00Z"),
      ),
    ).toBe(false);
    expect(
      await schoolCalendarEmailEligible(
        db,
        row,
        new Date("2026-11-02T04:00:00Z"),
      ),
    ).toBe(false);
  });
  it("fails closed for missing/unsafe source context without querying participants", async () => {
    const { db, mock } = fixture();
    expect(
      await schoolCalendarEmailEligible(db, {
        userId: "tutor",
        event: "school_calendar_changed",
        context: { ...context, schoolDate: "2026-02-30" },
      }),
    ).toBe(false);
    expect(mock.user.findMany).not.toHaveBeenCalled();
    expect(
      await schoolCalendarEmailEligible(db, {
        userId: null,
        event: "program_update",
        context: null,
      }),
    ).toBe(true);
  });
});
