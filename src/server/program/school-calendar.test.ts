import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/school-calendar-notifications", () => ({
  notifySchoolCalendarChange: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: vi.fn().mockResolvedValue(undefined) },
  isEmailDeliveryAvailable: () => true,
  isEmailConfigured: () => true,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { appealDeadline } from "~/server/api/routers/student";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import {
  schoolCalendarWrite,
  resolveSchoolCalendarDay,
} from "~/lib/school-calendar";
import { notifySchoolCalendarChange } from "~/server/school-calendar-notifications";
import { saveSchoolCalendar } from "./school-calendar";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const caller = (role: Session["role"] = "HEAD") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id: `calendar-${role}`, name: role },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });
const mapping = {
  date: "2026-11-01",
  isSchoolDay: true,
  timetableWeekday: 1,
  note: "Monday timetable",
  expectedVersion: 0,
};
beforeEach(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  for (const role of [
    "HEAD",
    "ADMIN",
    "COORDINATOR",
    "TUTOR",
    "STUDENT",
  ] as const)
    await db.user.create({
      data: {
        id: `calendar-${role}`,
        role,
        name: role,
        email: `${role}@example.test`,
      },
    });
  await db.term.create({
    data: {
      id: "calendar-term",
      active: true,
      schoolYear: "26-27",
      quarter: "Q1",
      name: "Calendar fixture",
    },
  });
  vi.mocked(notifySchoolCalendarChange)
    .mockReset()
    .mockResolvedValue(undefined);
});
afterAll(() => db.$disconnect());

it("exposes only bounded active calendar facts to participants without staff notes", async () => {
  await caller().student.setCalendarDay(mapping);
  const closure = await caller().student.setCalendarDay({
    date: "2026-11-02",
    isSchoolDay: false,
    note: "Private operator note",
    expectedVersion: 0,
  });
  await caller().student.resetCalendarDay({
    date: closure.date,
    expectedVersion: closure.version,
  });
  expect(
    await caller("STUDENT").program.schoolCalendar({
      from: "2026-11-01",
      to: "2026-11-14",
    }),
  ).toEqual([
    {
      date: "2026-11-01",
      isSchoolDay: true,
      timetableWeekday: 1,
      version: 1,
      scheduleRevision: 1,
    },
  ]);
  await expect(
    caller("STUDENT").program.schoolCalendar({
      from: "2026-11-01",
      to: "2027-03-01",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller("STUDENT").program.schoolCalendar({
      from: "2026-11-02",
      to: "2026-11-01",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("versions edits independently from semantic revisions and never revives stale reset/recreate editors", async () => {
  const first = await caller().student.setCalendarDay(mapping);
  expect(first).toMatchObject({
    date: mapping.date,
    isSchoolDay: true,
    timetableWeekday: 1,
    active: true,
    version: 1,
    scheduleRevision: 1,
  });
  expect(
    await caller().student.setCalendarDay({
      ...mapping,
      expectedVersion: first.version,
    }),
  ).toEqual(first);
  expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(1);
  const noteEdit = await caller().student.setCalendarDay({
    ...mapping,
    note: "Updated explanation",
    expectedVersion: first.version,
  });
  expect(noteEdit).toMatchObject({ version: 2, scheduleRevision: 1 });
  expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(1);
  const changed = await caller().student.setCalendarDay({
    ...mapping,
    timetableWeekday: 2,
    expectedVersion: noteEdit.version,
  });
  expect(changed).toMatchObject({ version: 3, scheduleRevision: 2 });
  const reset = await caller().student.resetCalendarDay({
    date: first.date,
    expectedVersion: changed.version,
  });
  expect(reset).toMatchObject({
    active: false,
    version: 4,
    scheduleRevision: 3,
    timetableWeekday: 2,
  });
  expect(resolveSchoolCalendarDay(first.date, [reset])).toMatchObject({
    isSchoolDay: false,
    calendarRevision: 3,
  });
  expect(await caller().student.calendar()).toEqual([reset]);
  expect(
    await caller().student.resetCalendarDay({
      date: first.date,
      expectedVersion: reset.version,
    }),
  ).toEqual(reset);
  await expect(caller().student.setCalendarDay(mapping)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const restored = await caller().student.setCalendarDay({
    ...mapping,
    expectedVersion: reset.version,
  });
  expect(restored).toMatchObject({
    active: true,
    version: 5,
    scheduleRevision: 4,
  });
  expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(4);
  expect(
    await db.auditLog.findFirst({
      where: {
        entity: "SchoolCalendarDay",
        action: "School calendar: reset to default",
      },
    }),
  ).toMatchObject({
    details: {
      before: { active: true, version: 3 },
      after: { active: false, version: 4 },
    },
  });
});

it("retains a semantic fence for explicit-default reset/reactivation without repeating equivalent weekday edits", async () => {
  const normal = { ...mapping, date: "2026-11-02", timetableWeekday: null };
  const first = await caller().student.setCalendarDay(normal);
  const equivalent = await caller().student.setCalendarDay({
    ...normal,
    timetableWeekday: 1,
    expectedVersion: first.version,
  });
  expect(equivalent).toMatchObject({ version: 2, scheduleRevision: 1 });
  expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(1);
  const reset = await caller().student.resetCalendarDay({
    date: normal.date,
    expectedVersion: equivalent.version,
  });
  expect(reset.scheduleRevision).toBe(2);
  expect(resolveSchoolCalendarDay(normal.date, [reset])).toMatchObject({
    isSchoolDay: true,
    effectiveTimetableWeekday: 1,
    calendarRevision: 2,
  });
  const restored = await caller().student.setCalendarDay({
    ...normal,
    expectedVersion: reset.version,
  });
  expect(restored.scheduleRevision).toBe(3);
  expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(3);
});

it("serializes competing writes and rejects unversioned overwrites of legacy rows", async () => {
  const results = await Promise.allSettled([
    caller().student.setCalendarDay(mapping),
    caller().student.setCalendarDay({ ...mapping, timetableWeekday: 2 }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  const legacy = await db.schoolCalendarDay.create({
    data: { date: "2026-11-02", isSchoolDay: false, note: "Legacy holiday" },
  });
  await expect(
    caller().student.setCalendarDay({
      date: legacy.date,
      isSchoolDay: true,
      note: "Stale old client",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.schoolCalendarDay.findUnique({ where: { date: legacy.date } }),
  ).toEqual(legacy);
});

it.each(["ADMIN", "HEAD"] as const)(
  "lets %s apply school calendar set/reset directly without a proposal",
  async (role) => {
    const saved = await caller(role).student.setCalendarDay(mapping);
    expect(saved).toMatchObject({
      active: true,
      version: 1,
      scheduleRevision: 1,
    });
    expect(await db.approvalRequest.count()).toBe(0);
    const reset = await caller(role).student.resetCalendarDay({
      date: saved.date,
      expectedVersion: saved.version,
    });
    expect(reset).toMatchObject({
      active: false,
      version: 2,
      scheduleRevision: 2,
    });
    expect(await db.approvalRequest.count()).toBe(0);
    expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(2);
    expect(
      await db.auditLog.findFirst({
        where: {
          entity: "SchoolCalendarDay",
          action: "School calendar: reset to default",
        },
      }),
    ).toMatchObject({ userId: `calendar-${role}` });
  },
);

it("queues Coordinator set/reset for management review, captures current versions and emits only for applied changes", async () => {
  for (const role of ["TUTOR", "STUDENT"] as const)
    await expect(
      caller(role).student.setCalendarDay(mapping),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller("COORDINATOR").student.setCalendarDay(mapping),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.schoolCalendarDay.count()).toBe(0);
  expect(notifySchoolCalendarChange).not.toHaveBeenCalled();
  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "student.setCalendarDay" },
  });
  await caller("ADMIN").approval.decide({
    id: proposal.id,
    approve: true,
    note: "Calendar checked",
  });
  const applied = await db.schoolCalendarDay.findUniqueOrThrow({
    where: { date: mapping.date },
  });
  for (const role of ["TUTOR", "STUDENT"] as const)
    await expect(
      caller(role).student.resetCalendarDay({
        date: applied.date,
        expectedVersion: applied.version,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller("COORDINATOR").student.resetCalendarDay({
      date: applied.date,
      expectedVersion: applied.version,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const resetProposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "student.resetCalendarDay" },
  });
  expect(resetProposal.targets).toMatchObject({
    calendar: [{ date: applied.date, active: true, version: applied.version }],
  });
  await caller("ADMIN").student.setCalendarDay({
    ...mapping,
    note: "Later explanation",
    expectedVersion: applied.version,
  });
  await expect(
    caller("ADMIN").approval.decide({
      id: resetProposal.id,
      approve: true,
      note: "Outdated reset",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (
      await db.schoolCalendarDay.findUniqueOrThrow({
        where: { date: applied.date },
      })
    ).active,
  ).toBe(true);
  expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(1);
  const current = await db.schoolCalendarDay.findUniqueOrThrow({
    where: { date: applied.date },
  });
  await expect(
    caller("COORDINATOR").student.resetCalendarDay({
      date: current.date,
      expectedVersion: current.version,
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const replacement = await db.approvalRequest.findFirstOrThrow({
    where: {
      operation: "student.resetCalendarDay",
      id: { not: resetProposal.id },
    },
  });
  await caller("ADMIN").approval.decide({
    id: replacement.id,
    approve: true,
    note: "Current reset checked",
  });
  expect(
    await db.schoolCalendarDay.findUniqueOrThrow({
      where: { date: current.date },
    }),
  ).toMatchObject({ active: false, version: current.version + 1 });
  expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(2);
});

it("rolls back calendar and audit changes if transactional notification intent fails", async () => {
  vi.mocked(notifySchoolCalendarChange).mockRejectedValueOnce(
    new Error("Synthetic receipt failure"),
  );
  await expect(
    saveSchoolCalendar(db, schoolCalendarWrite.parse(mapping), "calendar-HEAD"),
  ).rejects.toThrow("Synthetic receipt failure");
  expect(await db.schoolCalendarDay.count()).toBe(0);
  expect(
    await db.auditLog.count({ where: { entity: "SchoolCalendarDay" } }),
  ).toBe(0);
});

it("counts school-day status for appeals without consuming timetable mappings, tombstones or tutoring notices", async () => {
  const start = new Date("2026-10-30T03:00:00Z");
  const baseline = appealDeadline(start);
  const mappedMonday = await caller().student.setCalendarDay({
    ...mapping,
    date: "2026-11-02",
    timetableWeekday: 5,
  });
  expect(appealDeadline(start, [mappedMonday])).toEqual(baseline);
  const closure = await caller().student.setCalendarDay({
    ...mapping,
    date: "2026-11-02",
    isSchoolDay: false,
    timetableWeekday: null,
    expectedVersion: mappedMonday.version,
  });
  expect(appealDeadline(start, [closure]).toISOString()).toBe(
    "2026-11-09T15:59:59.999Z",
  );
  const reset = await caller().student.resetCalendarDay({
    date: closure.date,
    expectedVersion: closure.version,
  });
  expect(appealDeadline(start, [reset])).toEqual(baseline);
  const makeUp = await caller().student.setCalendarDay(mapping);
  expect(appealDeadline(start, [makeUp]).toISOString()).toBe(
    "2026-11-05T15:59:59.999Z",
  );
  await db.programCalendarDay.create({
    data: {
      date: "2026-11-03",
      endDate: "2026-11-06",
      reason: "Informational only",
    },
  });
  expect(appealDeadline(start, [reset])).toEqual(baseline);
});
