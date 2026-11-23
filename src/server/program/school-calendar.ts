import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { Prisma, SchoolCalendarDay } from "../../../generated/prisma";
import {
  resolveSchoolCalendarDay,
  schoolCalendarHolidayUnionDates,
  schoolCalendarRangeDates,
  type schoolCalendarHoliday,
  type schoolCalendarHolidayReset,
  type schoolCalendarHolidayUpdate,
  type schoolCalendarReset,
  type schoolCalendarWrite,
} from "~/lib/school-calendar";
import { notifySchoolCalendarChange } from "~/server/school-calendar-notifications";
import {
  ensureSessionPlanningWindow,
  lockSessionPlanning,
} from "~/server/session-planning";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
  type TransactionDb,
} from "~/server/transactions";

export async function saveSchoolCalendar(
  db: DomainDb,
  input: z.infer<typeof schoolCalendarWrite>,
  actorId: string,
) {
  return inTransaction(db, async (tx) => {
    // A pre-start calendar decision and its dated commitments publish atomically.
    // The order matches planning/attendance: period → room → session → calendar date.
    await lockEntity(tx, "program:period");
    await lockSessionPlanning(tx);
    await lockEntity(tx, `school-calendar:${input.date}`);
    const current = await tx.schoolCalendarDay.findUnique({
      where: { date: input.date },
    });
    if ((current?.version ?? 0) !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The school calendar changed. Reload before saving.",
      });
    const changedAt = new Date();
    const change = await persistSchoolCalendar(tx, input, current, actorId);
    if (change.scheduleChanged) {
      await ensureSessionPlanningWindow(tx, changedAt);
      await notifySchoolCalendarChange(tx, {
        before: current,
        after: change.saved,
      });
    }
    return change.saved;
  });
}

/** Persist one day without publishing a partial range to the dated scheduler. */
async function persistSchoolCalendar(
  tx: TransactionDb,
  input: z.infer<typeof schoolCalendarWrite>,
  current: SchoolCalendarDay | null,
  actorId: string,
) {
  if (
    current?.active &&
    current.isSchoolDay === input.isSchoolDay &&
    current.timetableWeekday === input.timetableWeekday &&
    (current.note ?? "") === input.note
  )
    return { saved: current, scheduleChanged: false };
  const data = {
    isSchoolDay: input.isSchoolDay,
    timetableWeekday: input.timetableWeekday,
    note: input.note,
  };
  const before = resolveSchoolCalendarDay(input.date, current ? [current] : []);
  const next = resolveSchoolCalendarDay(input.date, [
    { date: input.date, ...data },
  ]);
  // Notes preserve the semantic fence; reset/reactivation always advances it.
  const scheduleChanged =
    !current?.active ||
    before.isSchoolDay !== next.isSchoolDay ||
    before.effectiveTimetableWeekday !== next.effectiveTimetableWeekday;
  const saved = await tx.schoolCalendarDay.upsert({
    where: { date: input.date },
    create: { date: input.date, ...data },
    update: {
      ...data,
      active: true,
      version: { increment: 1 },
      ...(scheduleChanged ? { scheduleRevision: { increment: 1 } } : {}),
    },
  });
  await tx.auditLog.create({
    data: {
      userId: actorId,
      entity: "SchoolCalendarDay",
      entityId: input.date,
      action: `School calendar: ${input.isSchoolDay ? "school day" : "holiday"}`,
      details: JSON.parse(
        JSON.stringify({ before: current, after: saved }),
      ) as Prisma.InputJsonValue,
    },
  });
  return { saved, scheduleChanged };
}

/** Shared by direct writes and proposal capture/replay so all dates use one fence. */
export async function lockSchoolCalendarHoliday(
  tx: TransactionDb,
  input: z.infer<typeof schoolCalendarHoliday>,
) {
  await lockEntity(tx, "program:period");
  await lockSessionPlanning(tx);
  const dates = schoolCalendarRangeDates(input.from, input.to);
  for (const date of dates) await lockEntity(tx, `school-calendar:${date}`);
  const current = await tx.schoolCalendarDay.findMany({
    where: { date: { gte: input.from, lte: input.to } },
    orderBy: { date: "asc" },
  });
  const byDate = new Map(current.map((day) => [day.date, day]));
  for (const expected of input.expectedVersions)
    if ((byDate.get(expected.date)?.version ?? 0) !== expected.version)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The school calendar changed. Reload the holiday range before saving.",
      });
  return { dates, current, byDate };
}

export async function saveSchoolCalendarHoliday(
  db: DomainDb,
  input: z.infer<typeof schoolCalendarHoliday>,
  actorId: string,
) {
  return inTransaction(db, async (tx) => {
    const { dates, byDate } = await lockSchoolCalendarHoliday(tx, input);
    const changedAt = new Date();
    const changes = [];
    for (const date of dates) {
      const before = byDate.get(date) ?? null;
      const change = await persistSchoolCalendar(
        tx,
        {
          date,
          isSchoolDay: false,
          timetableWeekday: null,
          note: input.note,
          expectedVersion: before?.version ?? 0,
        },
        before,
        actorId,
      );
      changes.push({ ...change, before });
    }
    // Reconcile only the final range, preserving explicit dated exceptions atomically.
    if (changes.some((change) => change.scheduleChanged)) {
      await ensureSessionPlanningWindow(tx, changedAt);
      for (const change of changes)
        if (change.scheduleChanged)
          await notifySchoolCalendarChange(tx, {
            before: change.before,
            after: change.saved,
          });
    }
    return changes.map((change) => change.saved);
  });
}

/** Persist one reset tombstone without reconciling a partial holiday range. */
async function persistSchoolCalendarReset(
  tx: TransactionDb,
  current: SchoolCalendarDay,
  actorId: string,
) {
  if (!current.active) return { saved: current, scheduleChanged: false };
  const saved = await tx.schoolCalendarDay.update({
    where: { date: current.date },
    data: {
      active: false,
      version: { increment: 1 },
      scheduleRevision: { increment: 1 },
    },
  });
  await tx.auditLog.create({
    data: {
      userId: actorId,
      entity: "SchoolCalendarDay",
      entityId: current.date,
      action: "School calendar: reset to default",
      details: JSON.parse(
        JSON.stringify({ before: current, after: saved }),
      ) as Prisma.InputJsonValue,
    },
  });
  return { saved, scheduleChanged: true };
}

/** Shared by direct writes and proposal capture/replay so all dates use one fence. */
export async function lockSchoolCalendarHolidayUpdate(
  tx: TransactionDb,
  input: z.infer<typeof schoolCalendarHolidayUpdate>,
) {
  await lockEntity(tx, "program:period");
  await lockSessionPlanning(tx);
  const originalDates = schoolCalendarRangeDates(
    input.originalFrom,
    input.originalTo,
  );
  const nextDates = schoolCalendarRangeDates(input.from, input.to);
  const allDates = schoolCalendarHolidayUnionDates(
    input.originalFrom,
    input.originalTo,
    input.from,
    input.to,
  );
  for (const date of allDates) await lockEntity(tx, `school-calendar:${date}`);
  const current = await tx.schoolCalendarDay.findMany({
    where: { date: { in: allDates } },
    orderBy: { date: "asc" },
  });
  const byDate = new Map(current.map((day) => [day.date, day]));
  for (const expected of input.expectedVersions)
    if ((byDate.get(expected.date)?.version ?? 0) !== expected.version)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The school calendar changed. Reload the holiday range before saving.",
      });
  for (const date of originalDates) {
    const row = byDate.get(date);
    if (!row?.active || row.isSchoolDay)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Every original holiday date must currently be an active school closure.",
      });
  }
  return { originalDates, nextDates, allDates, current, byDate };
}

export async function updateSchoolCalendarHoliday(
  db: DomainDb,
  input: z.infer<typeof schoolCalendarHolidayUpdate>,
  actorId: string,
) {
  return inTransaction(db, async (tx) => {
    const { originalDates, nextDates, byDate } =
      await lockSchoolCalendarHolidayUpdate(tx, input);
    const nextSet = new Set(nextDates);
    const removedDates = originalDates.filter((date) => !nextSet.has(date));
    const changedAt = new Date();
    const changes: Array<{
      saved: SchoolCalendarDay;
      before: SchoolCalendarDay | null;
      scheduleChanged: boolean;
    }> = [];
    for (const date of nextDates) {
      const before = byDate.get(date) ?? null;
      const change = await persistSchoolCalendar(
        tx,
        {
          date,
          isSchoolDay: false,
          timetableWeekday: null,
          note: input.note,
          expectedVersion: before?.version ?? 0,
        },
        before,
        actorId,
      );
      changes.push({ ...change, before });
    }
    for (const date of removedDates) {
      const before = byDate.get(date)!;
      const change = await persistSchoolCalendarReset(tx, before, actorId);
      changes.push({ ...change, before });
    }
    if (changes.some((change) => change.scheduleChanged)) {
      await ensureSessionPlanningWindow(tx, changedAt);
      for (const change of changes)
        if (change.scheduleChanged)
          await notifySchoolCalendarChange(tx, {
            before: change.before,
            after: change.saved,
          });
    }
    return changes
      .map((change) => change.saved)
      .sort((a, b) => a.date.localeCompare(b.date));
  });
}

/** Shared by direct holiday resets and proposal capture/replay. */
export async function lockSchoolCalendarHolidayReset(
  tx: TransactionDb,
  input: z.infer<typeof schoolCalendarHolidayReset>,
) {
  await lockEntity(tx, "program:period");
  await lockSessionPlanning(tx);
  const dates = schoolCalendarRangeDates(input.from, input.to);
  for (const date of dates) await lockEntity(tx, `school-calendar:${date}`);
  const current = await tx.schoolCalendarDay.findMany({
    where: { date: { gte: input.from, lte: input.to } },
    orderBy: { date: "asc" },
  });
  const byDate = new Map(current.map((day) => [day.date, day]));
  for (const expected of input.expectedVersions)
    if (byDate.get(expected.date)?.version !== expected.version)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The school calendar changed. Reload before resetting.",
      });
  for (const date of dates) {
    const row = byDate.get(date);
    if (row?.active && row.isSchoolDay)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Only active school closures can be reset as a holiday.",
      });
  }
  return { dates, current, byDate };
}

export async function resetSchoolCalendarHoliday(
  db: DomainDb,
  input: z.infer<typeof schoolCalendarHolidayReset>,
  actorId: string,
) {
  return inTransaction(db, async (tx) => {
    const { dates, byDate } = await lockSchoolCalendarHolidayReset(tx, input);
    const changedAt = new Date();
    const changes: Array<{
      saved: SchoolCalendarDay;
      before: SchoolCalendarDay;
      scheduleChanged: boolean;
    }> = [];
    for (const date of dates) {
      const before = byDate.get(date)!;
      const change = await persistSchoolCalendarReset(tx, before, actorId);
      changes.push({ ...change, before });
    }
    if (changes.some((change) => change.scheduleChanged)) {
      await ensureSessionPlanningWindow(tx, changedAt);
      for (const change of changes)
        if (change.scheduleChanged)
          await notifySchoolCalendarChange(tx, {
            before: change.before,
            after: change.saved,
          });
    }
    return changes.map((change) => change.saved);
  });
}

export async function resetSchoolCalendar(
  db: DomainDb,
  input: z.infer<typeof schoolCalendarReset>,
  actorId: string,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, "program:period");
    await lockSessionPlanning(tx);
    await lockEntity(tx, `school-calendar:${input.date}`);
    const current = await tx.schoolCalendarDay.findUnique({
      where: { date: input.date },
    });
    if (current?.version !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The school calendar changed. Reload before resetting.",
      });
    const changedAt = new Date();
    const change = await persistSchoolCalendarReset(tx, current, actorId);
    if (change.scheduleChanged) {
      await ensureSessionPlanningWindow(tx, changedAt);
      await notifySchoolCalendarChange(tx, {
        before: current,
        after: change.saved,
      });
    }
    return change.saved;
  });
}
