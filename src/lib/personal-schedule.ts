import { programDayStart } from "./program-time";
import { addPlanningDays, planningWeeks } from "./session-planning";

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
