import { programDayStart } from "./program-time";
import { addPlanningDays, planningWeeks } from "./session-planning";
import { z } from "zod";

const scheduleCursor = z.object({
  at: z.date(),
  id: z.string().min(1).max(200),
});

/** Event and unresolved-work pages have independent cursors. A caller cannot
 * select someone else's identity or request an unbounded page. */
export const personalScheduleReadInput = z
  .object({
    view: z.enum(["upcoming", "history", "all"]).default("upcoming"),
    limit: z.number().int().min(1).max(50).default(20),
    includeSummary: z.boolean().default(true),
    cursor: scheduleCursor.optional(),
    taskCursor: scheduleCursor.optional(),
  })
  .default({ view: "upcoming", limit: 20, includeSummary: true });

export type PersonalScheduleCursor = z.infer<typeof scheduleCursor>;

/** Queries fetch one extra row so a bounded response never implies that its
 * final visible record is the end of the source. Cursor values are actual
 * stored timestamps and IDs, independent of names or locale ordering. */
export function personalSchedulePage<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => PersonalScheduleCursor,
) {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = items.at(-1);
  return {
    items,
    pageInfo: {
      hasMore,
      nextCursor: hasMore && last ? cursorOf(last) : null,
    },
  };
}

/** All personal sources use the same two local Monday–Sunday weeks. The final
 * boundary is the next local midnight, rather than fourteen elapsed days. */
export function personalScheduleWindow(now: Date, timeZone: string) {
  const { start, end } = planningWeeks(now, timeZone);
  return {
    window: { start, end, timeZone },
    startsAt: programDayStart(start, timeZone),
    endsBefore: programDayStart(addPlanningDays(end, 1), timeZone),
  };
}

/** Match the source meeting workflow's inclusive sixty-minute excuse cutoff. */
export function canExcusePersonalMeeting(date: Date, now: Date) {
  return now.getTime() <= date.getTime() - 60 * 60_000;
}
