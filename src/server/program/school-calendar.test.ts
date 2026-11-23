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
  schoolCalendarRangeDates,
} from "~/lib/school-calendar";
import { notifySchoolCalendarChange } from "~/server/school-calendar-notifications";
import { saveSchoolCalendar } from "./school-calendar";
import * as transactionHelpers from "~/server/transactions";
import * as sessionPlanning from "~/server/session-planning";

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

it("serializes calendar approval behind a direct writer before the date lock and rejects stale evidence", async () => {
  await expect(
    caller("COORDINATOR").student.setCalendarDay(mapping),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "student.setCalendarDay" },
  });
  const signal = () => {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const directHeld = signal(),
    releaseDirect = signal(),
    approvalReached = signal();
  let directTx: Parameters<typeof transactionHelpers.lockEntity>[0] | undefined;
  let approvalRequestedPeriod = false;
  const originalLock = transactionHelpers.lockEntity;
  const locks = vi
    .spyOn(transactionHelpers, "lockEntity")
    .mockImplementation(async (client, key) => {
      if (key === "program:period" && !directTx) {
        directTx = client;
        await originalLock(client, key);
        directHeld.resolve();
        await releaseDirect.promise;
        return;
      }
      if (client !== directTx && key === "program:period") {
        approvalRequestedPeriod = true;
        approvalReached.resolve();
      }
      if (
        client !== directTx &&
        key === `school-calendar:${mapping.date}` &&
        !approvalRequestedPeriod
      ) {
        approvalReached.resolve();
        // Fail before acquiring an inverted date lock instead of hanging the test
        // until PostgreSQL's deadlock detector aborts one of the real transactions.
        throw new Error("CALENDAR_DATE_LOCK_BEFORE_PERIOD");
      }
      await originalLock(client, key);
    });
  try {
    const direct = saveSchoolCalendar(
      db,
      schoolCalendarWrite.parse({
        ...mapping,
        note: "Concurrent direct decision",
      }),
      "calendar-HEAD",
    );
    await directHeld.promise;
    const approval = caller("ADMIN")
      .approval.decide({
        id: proposal.id,
        approve: true,
        note: "Review the pending mapping",
      })
      .then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
    await approvalReached.promise;
    releaseDirect.resolve();
    const [saved, reviewed] = await Promise.all([direct, approval]);
    expect(approvalRequestedPeriod).toBe(true);
    expect(saved).toMatchObject({
      version: 1,
      note: "Concurrent direct decision",
    });
    expect(reviewed.error).toMatchObject({ code: "CONFLICT" });
    expect(
      await db.schoolCalendarDay.findUniqueOrThrow({
        where: { date: mapping.date },
      }),
    ).toMatchObject({ version: 1, note: "Concurrent direct decision" });
    expect(
      (
        await db.approvalRequest.findUniqueOrThrow({
          where: { id: proposal.id },
        })
      ).state,
    ).toBe("PENDING");
    expect(
      await db.auditLog.count({ where: { entity: "SchoolCalendarDay" } }),
    ).toBe(1);
  } finally {
    releaseDirect.resolve();
    locks.mockRestore();
  }
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

const holidayInput = (from = "2026-11-01", to = "2026-11-03") => ({
  from,
  to,
  note: "Synthetic school holiday",
  expectedVersions: schoolCalendarRangeDates(from, to).map((date) => ({
    date,
    version: 0,
  })),
});

it.each(["HEAD", "ADMIN"] as const)(
  "lets %s close every date inclusively, reconciling only the final range once",
  async (role) => {
    const originalPlanning = sessionPlanning.ensureSessionPlanningWindow;
    const planning = vi
      .spyOn(sessionPlanning, "ensureSessionPlanningWindow")
      .mockImplementation(async (client, now) => {
        const days = await client.schoolCalendarDay.findMany({
          orderBy: { date: "asc" },
        });
        expect(days.map((day) => day.date)).toEqual([
          "2026-11-01",
          "2026-11-02",
          "2026-11-03",
        ]);
        expect(days.every((day) => !day.isSchoolDay)).toBe(true);
        return originalPlanning(client, now);
      });
    try {
      vi.mocked(notifySchoolCalendarChange).mockImplementation(async () => {
        // The notification adapter receives the same transaction after all range rows exist.
        expect(planning).toHaveBeenCalledTimes(1);
      });
      const saved =
        await caller(role).student.setCalendarHoliday(holidayInput());
      expect(saved.map(({ date }) => date)).toEqual([
        "2026-11-01",
        "2026-11-02",
        "2026-11-03",
      ]);
      expect(
        saved.every(
          (day) =>
            day.active &&
            !day.isSchoolDay &&
            day.timetableWeekday === null &&
            day.version === 1 &&
            day.scheduleRevision === 1,
        ),
      ).toBe(true);
      expect(planning).toHaveBeenCalledTimes(1);
      expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(3);
      expect(await db.approvalRequest.count()).toBe(0);
      expect(
        await db.auditLog.count({ where: { entity: "SchoolCalendarDay" } }),
      ).toBe(3);
      expect(
        appealDeadline(new Date("2026-10-30T03:00:00Z"), saved).toISOString(),
      ).toBe("2026-11-10T15:59:59.999Z");
      const repeat = await caller(role).student.setCalendarHoliday({
        ...holidayInput(),
        expectedVersions: saved.map((day) => ({
          date: day.date,
          version: day.version,
        })),
      });
      expect(repeat).toEqual(saved);
      expect(planning).toHaveBeenCalledTimes(1);
      expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(3);
      expect(
        await db.auditLog.count({ where: { entity: "SchoolCalendarDay" } }),
      ).toBe(3);
    } finally {
      planning.mockRestore();
    }
  },
);

it("rejects a stale middle date before any range write and reactivates only captured tombstone versions", async () => {
  const existing = await caller().student.setCalendarDay({
    ...mapping,
    date: "2026-11-02",
  });
  const reset = await caller().student.resetCalendarDay({
    date: existing.date,
    expectedVersion: existing.version,
  });
  vi.mocked(notifySchoolCalendarChange).mockClear();
  const input = holidayInput();
  const auditCount = await db.auditLog.count({
    where: { entity: "SchoolCalendarDay" },
  });
  await expect(
    caller().student.setCalendarHoliday(input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.schoolCalendarDay.findMany()).toEqual([reset]);
  expect(
    await db.auditLog.count({ where: { entity: "SchoolCalendarDay" } }),
  ).toBe(auditCount);
  expect(notifySchoolCalendarChange).not.toHaveBeenCalled();
  const saved = await caller().student.setCalendarHoliday({
    ...input,
    expectedVersions: input.expectedVersions.map((entry) =>
      entry.date === reset.date ? { ...entry, version: reset.version } : entry,
    ),
  });
  expect(saved[1]).toMatchObject({
    active: true,
    isSchoolDay: false,
    version: reset.version + 1,
    scheduleRevision: reset.scheduleRevision + 1,
  });
});

it("replaces captured make-up mappings and retains semantic revisions on a holiday note-only edit", async () => {
  const existing = await caller().student.setCalendarDay(mapping);
  const input = holidayInput(mapping.date, mapping.date);
  const [saved] = await caller().student.setCalendarHoliday({
    ...input,
    expectedVersions: [{ date: existing.date, version: existing.version }],
  });
  expect(saved).toMatchObject({
    active: true,
    isSchoolDay: false,
    timetableWeekday: null,
    version: 2,
    scheduleRevision: 2,
  });
  vi.mocked(notifySchoolCalendarChange).mockClear();
  const edited = await caller().student.setCalendarHoliday({
    ...input,
    note: "Updated private note",
    expectedVersions: [{ date: existing.date, version: saved!.version }],
  });
  expect(edited[0]).toMatchObject({ version: 3, scheduleRevision: 2 });
  expect(notifySchoolCalendarChange).not.toHaveBeenCalled();
});

it("queues one Coordinator holiday proposal and refuses the whole approval after a formerly absent middle date changes", async () => {
  const input = holidayInput();
  for (const role of ["TUTOR", "STUDENT"] as const)
    await expect(
      caller(role).student.setCalendarHoliday(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    caller("COORDINATOR").student.setCalendarHoliday(input),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.schoolCalendarDay.count()).toBe(0);
  expect(notifySchoolCalendarChange).not.toHaveBeenCalled();
  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "student.setCalendarHoliday" },
  });
  expect(proposal.targets).toMatchObject({ calendar: [] });
  expect(await db.approvalRequest.count()).toBe(1);
  const intervening = await caller().student.setCalendarDay({
    ...mapping,
    date: "2026-11-02",
  });
  await expect(
    caller("ADMIN").approval.decide({
      id: proposal.id,
      approve: true,
      note: "Stale holiday review",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.schoolCalendarDay.findMany()).toEqual([intervening]);
  const current = {
    ...input,
    expectedVersions: input.expectedVersions.map((entry) =>
      entry.date === intervening.date
        ? { ...entry, version: intervening.version }
        : entry,
    ),
  };
  await expect(
    caller("COORDINATOR").student.setCalendarHoliday(current),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const replacement = await db.approvalRequest.findFirstOrThrow({
    where: {
      operation: "student.setCalendarHoliday",
      id: { not: proposal.id },
    },
  });
  expect(replacement.targets).toMatchObject({
    calendar: [
      {
        date: intervening.date,
        version: intervening.version,
        timetableWeekday: 1,
      },
    ],
  });
  await caller("ADMIN").approval.decide({
    id: replacement.id,
    approve: true,
    note: "Reviewed all holiday dates",
  });
  expect(
    await db.schoolCalendarDay.count({
      where: { active: true, isSchoolDay: false },
    }),
  ).toBe(3);
});

it("rolls back the entire holiday range and audit if a later notification intent fails", async () => {
  vi.mocked(notifySchoolCalendarChange)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Synthetic range intent failure"));
  await expect(
    caller().student.setCalendarHoliday(holidayInput()),
  ).rejects.toThrow("Synthetic range intent failure");
  expect(await db.schoolCalendarDay.count()).toBe(0);
  expect(
    await db.auditLog.count({ where: { entity: "SchoolCalendarDay" } }),
  ).toBe(0);
});

it("keeps an approved holiday proposal pending if transactional publication fails", async () => {
  await expect(
    caller("COORDINATOR").student.setCalendarHoliday(holidayInput()),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const proposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "student.setCalendarHoliday" },
  });
  vi.mocked(notifySchoolCalendarChange)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Synthetic approved-range failure"));
  await expect(
    caller("ADMIN").approval.decide({
      id: proposal.id,
      approve: true,
      note: "Reviewed holiday",
    }),
  ).rejects.toThrow("Synthetic approved-range failure");
  expect(await db.schoolCalendarDay.count()).toBe(0);
  expect(
    await db.auditLog.count({ where: { entity: "SchoolCalendarDay" } }),
  ).toBe(0);
  expect(
    await db.approvalRequest.findUnique({ where: { id: proposal.id } }),
  ).toMatchObject({ state: "PENDING" });
});

it.each(["HEAD", "ADMIN"] as const)(
  "lets %s mass-edit a grouped holiday (extend, shrink, shift, note-only) atomically with one planning reconciliation",
  async (role) => {
    const initial = await caller(role).student.setCalendarHoliday(
      holidayInput("2026-11-26", "2026-11-28"),
    );
    vi.mocked(notifySchoolCalendarChange).mockClear();

    // Note-only edit preserves scheduleRevision and emits no operational notices.
    const noteOnly = await caller(role).student.updateCalendarHoliday({
      originalFrom: "2026-11-26",
      originalTo: "2026-11-28",
      from: "2026-11-26",
      to: "2026-11-28",
      note: "Updated Thanksgiving note",
      expectedVersions: initial.map((day) => ({
        date: day.date,
        version: day.version,
      })),
    });
    expect(
      noteOnly.every(
        (day) =>
          day.active &&
          !day.isSchoolDay &&
          day.note === "Updated Thanksgiving note" &&
          day.version === 2 &&
          day.scheduleRevision === 1,
      ),
    ).toBe(true);
    expect(notifySchoolCalendarChange).not.toHaveBeenCalled();

    // Shift & shrink: 2026-11-26 is reset, 2026-11-27..28 stay closed, 2026-11-29 is newly closed.
    const planning = vi.spyOn(sessionPlanning, "ensureSessionPlanningWindow");
    try {
      const shifted = await caller(role).student.updateCalendarHoliday({
        originalFrom: "2026-11-26",
        originalTo: "2026-11-28",
        from: "2026-11-27",
        to: "2026-11-29",
        note: "Shifted Thanksgiving",
        expectedVersions: [
          ...noteOnly.map((day) => ({ date: day.date, version: day.version })),
          { date: "2026-11-29", version: 0 },
        ],
      });
      expect(planning).toHaveBeenCalledTimes(1);
      // Only removed 2026-11-26 and newly closed 2026-11-29 changed schedule meaning.
      expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(2);
      const byDate = new Map(shifted.map((day) => [day.date, day]));
      expect(byDate.get("2026-11-26")).toMatchObject({
        active: false,
        version: 3,
        scheduleRevision: 2,
      });
      expect(byDate.get("2026-11-27")).toMatchObject({
        active: true,
        isSchoolDay: false,
        note: "Shifted Thanksgiving",
        version: 3,
        scheduleRevision: 1,
      });
      expect(byDate.get("2026-11-28")).toMatchObject({
        active: true,
        isSchoolDay: false,
        note: "Shifted Thanksgiving",
        version: 3,
        scheduleRevision: 1,
      });
      expect(byDate.get("2026-11-29")).toMatchObject({
        active: true,
        isSchoolDay: false,
        note: "Shifted Thanksgiving",
        version: 1,
        scheduleRevision: 1,
      });
    } finally {
      planning.mockRestore();
    }
  },
);

it("rejects stale versions and non-holiday original dates in updateCalendarHoliday without partial writes", async () => {
  const closed = await caller().student.setCalendarHoliday(
    holidayInput("2026-11-26", "2026-11-27"),
  );
  const schoolDay = await caller().student.setCalendarDay({
    ...mapping,
    date: "2026-11-28",
  });
  vi.mocked(notifySchoolCalendarChange).mockClear();

  // Attempting to include an active school day inside originalFrom..originalTo fails with BAD_REQUEST.
  await expect(
    caller().student.updateCalendarHoliday({
      originalFrom: "2026-11-26",
      originalTo: "2026-11-28",
      from: "2026-11-26",
      to: "2026-11-27",
      note: "Cannot reset make-up day as holiday",
      expectedVersions: [
        ...closed.map((day) => ({ date: day.date, version: day.version })),
        { date: schoolDay.date, version: schoolDay.version },
      ],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });

  // Stale version on newly covered date fails with CONFLICT and changes nothing.
  await expect(
    caller().student.updateCalendarHoliday({
      originalFrom: "2026-11-26",
      originalTo: "2026-11-27",
      from: "2026-11-26",
      to: "2026-11-28",
      note: "Stale replacement",
      expectedVersions: [
        ...closed.map((day) => ({ date: day.date, version: day.version })),
        { date: "2026-11-28", version: 0 },
      ],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    await db.schoolCalendarDay.findUniqueOrThrow({
      where: { date: "2026-11-28" },
    }),
  ).toEqual(schoolDay);
  expect(notifySchoolCalendarChange).not.toHaveBeenCalled();

  // Capturing the real version allows replacing the make-up day intentionally.
  const replaced = await caller().student.updateCalendarHoliday({
    originalFrom: "2026-11-26",
    originalTo: "2026-11-27",
    from: "2026-11-26",
    to: "2026-11-28",
    note: "Replaced with holiday",
    expectedVersions: [
      ...closed.map((day) => ({ date: day.date, version: day.version })),
      { date: schoolDay.date, version: schoolDay.version },
    ],
  });
  expect(replaced.find((day) => day.date === "2026-11-28")).toMatchObject({
    active: true,
    isSchoolDay: false,
    timetableWeekday: null,
    version: schoolDay.version + 1,
    scheduleRevision: schoolDay.scheduleRevision + 1,
  });
});

it("mass-resets a holiday atomically, refuses active school days, and queues Coordinator proposals", async () => {
  const closed = await caller().student.setCalendarHoliday(
    holidayInput("2026-11-26", "2026-11-28"),
  );
  const schoolDay = await caller().student.setCalendarDay({
    ...mapping,
    date: "2026-11-29",
  });
  vi.mocked(notifySchoolCalendarChange).mockClear();

  // Active school day cannot be reset through resetCalendarHoliday.
  await expect(
    caller().student.resetCalendarHoliday({
      from: "2026-11-28",
      to: "2026-11-29",
      expectedVersions: [
        { date: "2026-11-28", version: closed[2]!.version },
        { date: "2026-11-29", version: schoolDay.version },
      ],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });

  // Coordinator update proposal captures full union evidence and rejects stale replay.
  await expect(
    caller("COORDINATOR").student.updateCalendarHoliday({
      originalFrom: "2026-11-26",
      originalTo: "2026-11-28",
      from: "2026-11-26",
      to: "2026-11-27",
      note: "Coordinator shortened holiday",
      expectedVersions: closed.map((day) => ({
        date: day.date,
        version: day.version,
      })),
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const editProposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "student.updateCalendarHoliday" },
  });
  expect(editProposal.targets).toMatchObject({
    calendar: closed.map(({ date, version }) => ({ date, version })),
  });
  await caller("ADMIN").approval.decide({
    id: editProposal.id,
    approve: true,
    note: "Approved shortened holiday",
  });
  expect(
    await db.schoolCalendarDay.findUniqueOrThrow({
      where: { date: "2026-11-28" },
    }),
  ).toMatchObject({ active: false, version: 2, scheduleRevision: 2 });

  // Coordinator reset proposal resets remaining holiday dates atomically on approval.
  const remaining = await db.schoolCalendarDay.findMany({
    where: { date: { gte: "2026-11-26", lte: "2026-11-27" } },
    orderBy: { date: "asc" },
  });
  await expect(
    caller("COORDINATOR").student.resetCalendarHoliday({
      from: "2026-11-26",
      to: "2026-11-27",
      expectedVersions: remaining.map((day) => ({
        date: day.date,
        version: day.version,
      })),
    }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  const resetProposal = await db.approvalRequest.findFirstOrThrow({
    where: { operation: "student.resetCalendarHoliday" },
  });
  vi.mocked(notifySchoolCalendarChange).mockClear();
  await caller("ADMIN").approval.decide({
    id: resetProposal.id,
    approve: true,
    note: "Approved holiday reset",
  });
  expect(notifySchoolCalendarChange).toHaveBeenCalledTimes(2);
  expect(
    await db.schoolCalendarDay.count({
      where: { active: true, isSchoolDay: false },
    }),
  ).toBe(0);
});
