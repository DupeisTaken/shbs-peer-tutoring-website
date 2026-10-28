import { z } from "zod";
import {
  resolveSchoolCalendarDay,
  type SchoolCalendarOverride,
} from "./school-calendar";
import {
  parseProgramDateTime,
  programDateKey,
  programDayStart,
} from "./program-time";

export const PLANNED_SESSION_MINUTES = 45;
export const RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const planningTimeInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMin: z.number().int().min(0).max(1395),
  roomId: z.string().min(1).max(200).nullable().optional(),
  online: z.boolean().default(false),
});
export type PlanningTime = z.infer<typeof planningTimeInput>;

export function addPlanningDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Dates, weekly clocks and instants are deliberately separate. DST never invents a clock. */
export function plannedWindow(input: PlanningTime, timeZone: string) {
  const parsed = planningTimeInput.parse(input);
  const date = new Date(`${parsed.date}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== parsed.date
  )
    throw new Error("Choose a valid session date.");
  const clock = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const endMin = parsed.startMin + PLANNED_SESSION_MINUTES;
  const startsAt = parseProgramDateTime(
    `${parsed.date}T${clock(parsed.startMin)}`,
    timeZone,
  );
  const endsAt =
    endMin === 1440
      ? programDayStart(addPlanningDays(parsed.date, 1), timeZone)
      : parseProgramDateTime(`${parsed.date}T${clock(endMin)}`, timeZone);
  if (endsAt <= startsAt) throw new Error("Choose an increasing session time.");
  if (
    endsAt.getTime() - startsAt.getTime() !==
    PLANNED_SESSION_MINUTES * 60_000
  )
    throw new Error(
      "A planned session must be 45 elapsed minutes as well as 45 clock minutes.",
    );
  return {
    ...parsed,
    roomId: parsed.online ? null : (parsed.roomId ?? null),
    endMin,
    startsAt,
    endsAt,
  };
}

export function resolvePlanningCalendarDay(
  date: string,
  overrides: readonly SchoolCalendarOverride[],
) {
  return resolveSchoolCalendarDay(date, overrides);
}

/** Sunday prepares the coming Monday window; visible dates advance only on Monday. */
export function planningWeeks(now: Date, timeZone: string) {
  const today = programDateKey(now, timeZone);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
  const start = addPlanningDays(today, 1 - weekday);
  return {
    today,
    start,
    end: addPlanningDays(start, 13),
    prepareEnd: addPlanningDays(start, weekday === 7 ? 20 : 13),
  };
}

export function responseDeadline(deliveredAt: Date, cutoffAt: Date) {
  const deadline = new Date(deliveredAt.getTime() + RESPONSE_WINDOW_MS);
  return deadline < cutoffAt ? deadline : null;
}

export function oneNegotiationAction(
  stage: number,
  decision: "ACCEPT" | "REJECT",
) {
  if (decision === "ACCEPT") return "AGREE" as const;
  return stage >= 3 ? ("CANCEL" as const) : ("COUNTER" as const);
}
