import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { Prisma } from "../../../generated/prisma";
import {
  resolveSchoolCalendarDay,
  type schoolCalendarReset,
  type schoolCalendarWrite,
} from "~/lib/school-calendar";
import { notifySchoolCalendarChange } from "~/server/school-calendar-notifications";
import {
  inTransaction,
  lockEntity,
  type DomainDb,
} from "~/server/transactions";

export async function saveSchoolCalendar(
  db: DomainDb,
  input: z.infer<typeof schoolCalendarWrite>,
  actorId: string,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, `school-calendar:${input.date}`);
    const current = await tx.schoolCalendarDay.findUnique({
      where: { date: input.date },
    });
    if ((current?.version ?? 0) !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The school calendar changed. Reload before saving.",
      });
    if (
      current?.active &&
      current.isSchoolDay === input.isSchoolDay &&
      current.timetableWeekday === input.timetableWeekday &&
      (current.note ?? "") === input.note
    )
      return current;
    const data = {
      isSchoolDay: input.isSchoolDay,
      timetableWeekday: input.timetableWeekday,
      note: input.note,
    };
    const before = resolveSchoolCalendarDay(
      input.date,
      current ? [current] : [],
    );
    const next = resolveSchoolCalendarDay(input.date, [
      { date: input.date, ...data },
    ]);
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
    // Semantic revisions survive note-only edits; reset/reactivation always advances the fence.
    if (scheduleChanged)
      await notifySchoolCalendarChange(tx, { before: current, after: saved });
    return saved;
  });
}

export async function resetSchoolCalendar(
  db: DomainDb,
  input: z.infer<typeof schoolCalendarReset>,
  actorId: string,
) {
  return inTransaction(db, async (tx) => {
    await lockEntity(tx, `school-calendar:${input.date}`);
    const current = await tx.schoolCalendarDay.findUnique({
      where: { date: input.date },
    });
    if (current?.version !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The school calendar changed. Reload before resetting.",
      });
    if (!current.active) return current;
    const saved = await tx.schoolCalendarDay.update({
      where: { date: input.date },
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
        entityId: input.date,
        action: "School calendar: reset to default",
        details: JSON.parse(
          JSON.stringify({ before: current, after: saved }),
        ) as Prisma.InputJsonValue,
      },
    });
    await notifySchoolCalendarChange(tx, { before: current, after: saved });
    return saved;
  });
}
