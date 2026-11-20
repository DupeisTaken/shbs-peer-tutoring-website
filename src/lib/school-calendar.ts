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

/** Enumerate actual date labels inclusively, without local-time/DST arithmetic. */
export function schoolCalendarRangeDates(from: string, to: string): string[] {
  programCalendarDate.parse(from);
  programCalendarDate.parse(to);
  const first = Date.parse(from);
  const last = Date.parse(to);
  if (last < first || last - first > 365 * 86_400_000)
    throw new RangeError(
      "Choose an inclusive holiday range of at most 366 days.",
    );
  return Array.from({ length: (last - first) / 86_400_000 + 1 }, (_, index) =>
    new Date(first + index * 86_400_000).toISOString().slice(0, 10),
  );
}

export const schoolCalendarHoliday = z
  .object({
    from: programCalendarDate,
    to: programCalendarDate,
    note: z.string().trim().max(300),
    expectedVersions: z
      .array(
        z
          .object({
            date: programCalendarDate,
            version: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(366),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      !programCalendarDate.safeParse(input.from).success ||
      !programCalendarDate.safeParse(input.to).success
    )
      return;
    const span = Date.parse(input.to) - Date.parse(input.from);
    if (span < 0 || span > 365 * 86_400_000) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Choose an inclusive holiday range of at most 366 days.",
      });
      return;
    }
    const dates = schoolCalendarRangeDates(input.from, input.to);
    const versions = new Map(
      input.expectedVersions.map((entry) => [entry.date, entry.version]),
    );
    // Missing days and tombstones are evidence too; never silently adopt a newer row.
    if (
      input.expectedVersions.length !== dates.length ||
      versions.size !== dates.length ||
      dates.some((date) => !versions.has(date))
    )
      context.addIssue({
        code: "custom",
        path: ["expectedVersions"],
        message:
          "Capture the current version of every date in the holiday range.",
      });
  });

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

export type SchoolCalendarDay = ReturnType<typeof resolveSchoolCalendarDay>;

/** Own one immutable set of calendar facts per operation, never across calendar writes.
 * Index the first row so duplicate dates retain the direct resolver's find semantics. */
export function createSchoolCalendarSnapshot(
  overrides: readonly SchoolCalendarOverride[] = [],
) {
  const dates: string[] = [];
  const firstByDate = new Map<string, SchoolCalendarOverride>();
  for (const row of overrides) {
    dates.push(row.date);
    if (!firstByDate.has(row.date)) {
      firstByDate.set(row.date, {
        date: row.date,
        isSchoolDay: row.isSchoolDay,
        timetableWeekday: row.timetableWeekday,
        active: row.active,
        version: row.version,
        scheduleRevision: row.scheduleRevision,
      });
    }
  }
  const resolved = new Map<string, SchoolCalendarDay>();
  let semantic: readonly Readonly<SchoolCalendarDay>[] | undefined;

  function resolve(date: string): SchoolCalendarDay {
    let day = resolved.get(date);
    if (!day) {
      const override = firstByDate.get(date);
      // Keep the shared date validation and tombstone/revision rules authoritative.
      day = resolveSchoolCalendarDay(date, override ? [override] : []);
      resolved.set(date, day);
    }
    return { ...day };
  }

  return {
    resolve,
    /** Matches overrides.map(resolve).sort by date, including repeated dates.
     * Freeze the reusable fingerprint input so callers cannot poison later hashes. */
    semanticDays(): readonly Readonly<SchoolCalendarDay>[] {
      semantic ??= Object.freeze(
        dates
          .map(resolve)
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((day) => Object.freeze(day)),
      );
      return semantic;
    },
  };
}
