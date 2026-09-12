import { DEFAULT_TIME_ZONE } from "~/i18n/config";

/** Validate real IANA zones, not ambiguous abbreviations or the machine's local default. */
export function isProgramTimeZone(value: string): boolean {
  if (value !== "UTC" && !value.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function programDateTimeInput(
  date: Date,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function programDateKey(
  date: Date,
  timeZone = DEFAULT_TIME_ZONE,
): string {
  return programDateTimeInput(date, timeZone).slice(0, 10);
}

export function programMinuteOfDay(
  date: Date,
  timeZone = DEFAULT_TIME_ZONE,
): number {
  const input = programDateTimeInput(date, timeZone);
  return Number(input.slice(11, 13)) * 60 + Number(input.slice(14, 16));
}

/** Convert a school wall-clock input to an instant without depending on the browser/VM zone.
 * Probe both sides of a potential DST transition: nonexistent and ambiguous times are rejected
 * instead of silently scheduling a different time or arbitrarily choosing a repeated hour.
 */
export function parseProgramDateTime(
  value: string,
  timeZone = DEFAULT_TIME_ZONE,
): Date {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
    !isProgramTimeZone(timeZone)
  )
    throw new Error("Invalid program date or time zone.");
  const wall = Date.parse(`${value}:00Z`);
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 16) !== value
  )
    throw new Error("Invalid calendar date.");
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const instant = wall + hours * 3_600_000;
    const displayed = Date.parse(
      `${programDateTimeInput(new Date(instant), timeZone)}:00Z`,
    );
    offsets.add(displayed - instant);
  }
  const candidates = [...offsets]
    .map((offset) => new Date(wall - offset))
    .filter((date) => programDateTimeInput(date, timeZone) === value);
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "This time occurs twice because of daylight saving. Choose another time."
        : "This time does not exist because of daylight saving. Choose another time.",
    );
  return candidates[0]!;
}

/** Calendar-day arithmetic must not assume that a local day is always 24 hours. */
export function programDayEnd(
  dateKey: string,
  timeZone = DEFAULT_TIME_ZONE,
): Date {
  const next = new Date(`${dateKey}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return new Date(
    programDayStart(next.toISOString().slice(0, 10), timeZone).getTime() - 1,
  );
}

/** Some zones switch at midnight. A calendar boundary uses the first actual instant of
 * that date even if 00:00 is skipped/repeated; interactive appointment inputs stay strict.
 */
export function programDayStart(
  dateKey: string,
  timeZone = DEFAULT_TIME_ZONE,
): Date {
  try {
    return parseProgramDateTime(`${dateKey}T00:00`, timeZone);
  } catch {
    const anchor = Date.parse(`${dateKey}T00:00:00Z`);
    if (!Number.isFinite(anchor) || !isProgramTimeZone(timeZone))
      throw new Error("Invalid calendar boundary.");
    let low = anchor - 36 * 3_600_000;
    let high = anchor + 36 * 3_600_000;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (programDateKey(new Date(middle), timeZone) < dateKey)
        low = middle + 1;
      else high = middle;
    }
    const first = new Date(low);
    if (programDateKey(first, timeZone) !== dateKey)
      throw new Error(
        "This calendar date does not exist in the selected time zone.",
      );
    return first;
  }
}
