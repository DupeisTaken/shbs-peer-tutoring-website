import { isProgramTimeZone, programDateTimeInput } from "~/lib/program-time";

export type SchoolHoursDateOverrides = Record<string, string>;
const validMonth = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;

export function shiftMonth(month: string, delta: number) {
  if (!validMonth.test(month) || !Number.isInteger(delta))
    throw new Error("Invalid report month.");
  const [year, number] = month.split("-").map(Number);
  const result = new Date(Date.UTC(year!, number! - 1 + delta, 1))
    .toISOString()
    .slice(0, 7);
  if (!validMonth.test(result))
    throw new Error("Report month is outside the supported calendar.");
  return result;
}

/** Local noon belongs to this occurrence, without a UTC-month closing wait:
 * later submissions remain eligible for the next issue of unreported changes. */
export function schoolHoursDueAt(
  month: string,
  timeZone: string,
  overrides: SchoolHoursDateOverrides = {},
) {
  if (!validMonth.test(month) || !isProgramTimeZone(timeZone))
    throw new Error("Invalid report calendar.");
  const [year, number] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year!, number, 0)).getUTCDate();
  const target =
    overrides[month] ?? `${month}-${String(lastDay).padStart(2, "0")}T12:00`;
  if (target.slice(0, 7) !== month)
    throw new Error("Choose a send date within the report month.");
  if (!/^[1-9]\d{3}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(target))
    throw new Error("Invalid report send date.");
  const wall = Date.parse(`${target}:00Z`);
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 16) !== target
  )
    throw new Error("Invalid report send date.");
  const offsets = new Set<number>();
  for (const hours of [-48, -24, 0, 24, 48]) {
    const instant = wall + hours * 3_600_000;
    offsets.add(
      Date.parse(`${programDateTimeInput(new Date(instant), timeZone)}:00Z`) -
        instant,
    );
  }
  // Repeated times choose the earlier instant; skipped local times advance to
  // the next real minute, including zones with a calendar-day transition.
  for (let minute = 0; minute <= 24 * 60; minute++) {
    const desired = new Date(wall + minute * 60_000).toISOString().slice(0, 16);
    const candidates = [...offsets]
      .map((offset) => wall + minute * 60_000 - offset)
      .filter(
        (instant) =>
          programDateTimeInput(new Date(instant), timeZone) === desired,
      );
    if (candidates.length) return new Date(Math.min(...candidates));
  }
  throw new Error("Cannot resolve report send date.");
}

/** Activation chooses a future occurrence from this local month onward. Existing
 * cursors retain their month through rescheduling; this helper never backfills. */
export function nextSchoolHoursOccurrence(
  now: Date,
  config: { timeZone: string; dateOverrides?: SchoolHoursDateOverrides },
) {
  let month = programDateTimeInput(now, config.timeZone).slice(0, 7);
  for (let count = 0; count < 1200; count++) {
    const dueAt = schoolHoursDueAt(
      month,
      config.timeZone,
      config.dateOverrides,
    );
    if (dueAt > now) return { month, dueAt };
    month = shiftMonth(month, 1);
  }
  throw new Error("No future report occurrence is configured.");
}
