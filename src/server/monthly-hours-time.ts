import { programDateTimeInput } from "~/lib/program-time";

export function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, number! - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function localMonth(now: Date, zone: string) {
  return programDateTimeInput(now, zone).slice(0, 7);
}

/** Resolve local calendar time without the host zone. Repeated times use the earlier
 * occurrence; gaps advance to the next real minute. Stored UTC accounting buckets
 * must also be closed, so positive-offset day-one schedules wait until UTC month-end. */
export function monthlyHoursDueAt(
  reportMonth: string,
  dayOfMonth: number,
  localTime: string,
  zone: string,
) {
  const sendMonth = shiftMonth(reportMonth, 1);
  const target = `${sendMonth}-${String(dayOfMonth).padStart(2, "0")}T${localTime}`;
  const wall = Date.parse(`${target}:00Z`);
  const offsets = new Set<number>();
  for (const hours of [-48, -24, 0, 24, 48]) {
    const instant = wall + hours * 3_600_000;
    offsets.add(
      Date.parse(`${programDateTimeInput(new Date(instant), zone)}:00Z`) -
        instant,
    );
  }
  for (let minute = 0; minute <= 24 * 60; minute++) {
    const desired = new Date(wall + minute * 60_000).toISOString().slice(0, 16);
    const candidates = [...offsets]
      .map((offset) => wall + minute * 60_000 - offset)
      .filter(
        (instant) => programDateTimeInput(new Date(instant), zone) === desired,
      );
    if (candidates.length)
      return new Date(
        Math.max(
          Math.min(...candidates),
          Date.parse(`${sendMonth}-01T00:00:00Z`),
        ),
      );
  }
  throw new Error("Cannot resolve monthly report calendar time.");
}

/** Activation always chooses a future send. Historical reports require an explicit
 * manual generation; an off interval is never interpreted as a delivery backlog. */
export function firstMonthlyHoursOccurrence(
  now: Date,
  config: { dayOfMonth: number; localTime: string; timeZone: string },
) {
  let month = shiftMonth(localMonth(now, config.timeZone), -1);
  let dueAt = monthlyHoursDueAt(
    month,
    config.dayOfMonth,
    config.localTime,
    config.timeZone,
  );
  if (dueAt <= now) {
    month = shiftMonth(month, 1);
    dueAt = monthlyHoursDueAt(
      month,
      config.dayOfMonth,
      config.localTime,
      config.timeZone,
    );
  }
  return { month, dueAt };
}
