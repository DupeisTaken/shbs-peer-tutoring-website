import { z } from "zod";
import { programCalendarDate } from "./program-calendar";

/** Calendar facts shared with dated-session planning; dates always remain actual date labels. */
export type SchoolCalendarOverride = {
  date: string;
  isSchoolDay: boolean;
  timetableWeekday?: number | null;
  active?: boolean;
  version?: number;
  scheduleRevision?: number;
};

export const schoolCalendarWrite = z
  .object({
    date: programCalendarDate,
    isSchoolDay: z.boolean(),
    timetableWeekday: z.number().int().min(1).max(7).nullable().optional(),
    note: z.string().trim().max(300),
    // Old create-only callers remain valid; omission cannot overwrite a stored row/tombstone.
    expectedVersion: z.number().int().nonnegative().default(0),
  })
  .strict()
  .refine((day) => day.isSchoolDay || day.timetableWeekday == null, {
    message: "A no-school date cannot also follow a timetable weekday.",
    path: ["timetableWeekday"],
  })
  .transform((day) => ({
    ...day,
    timetableWeekday: day.timetableWeekday ?? null,
  }));

export const schoolCalendarReset = z
  .object({
    date: programCalendarDate,
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export function resolveSchoolCalendarDay(
  date: string,
  overrides: readonly SchoolCalendarOverride[] = [],
) {
  programCalendarDate.parse(date);
  const civilWeekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  const override = overrides.find((day) => day.date === date);
  const active = override?.active !== false ? override : undefined;
  const isSchoolDay = active?.isSchoolDay ?? civilWeekday <= 5;
  return {
    date,
    isSchoolDay,
    effectiveTimetableWeekday: isSchoolDay
      ? (active?.timetableWeekday ?? civilWeekday)
      : null,
    // A reset restores defaults, while retaining the revision for stale delivery/editor fences.
    calendarRevision: override?.scheduleRevision ?? override?.version ?? 0,
  };
}
