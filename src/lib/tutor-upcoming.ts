import { pairingEntries, type GroupablePairing } from "./pairing-groups";
import {
  parseProgramDateTime,
  programDateKey,
  programDayStart,
} from "./program-time";

export type UpcomingPairing = GroupablePairing & {
  subject: string;
  room: { name: string } | null;
  tutees: readonly unknown[];
};
export type UpcomingInterview = {
  id: string;
  name: string;
  status: string;
  isInvalid: boolean;
  interviewAt: Date | null;
};
export type UpcomingEvent = {
  id: string;
  kind: "session" | "interview";
  start: Date;
  end: Date | null;
  label: string;
  room: string | null;
  count: number;
};

function dateAfter(date: string, days: number) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
function occurrence(date: string, minute: number, timeZone: string) {
  // 24:00 is the following calendar boundary, not 24 elapsed hours on a DST day.
  if (minute === 1440) return programDayStart(dateAfter(date, 1), timeZone);
  const clock = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return parseProgramDateTime(`${date}T${clock}`, timeZone);
}

/** Read-only projection of authorized current-period plans. Never interpret a
 * default slot as confirmation, infer interview duration or apply calendar closures.
 * Today + six local dates is deliberately different from 168 elapsed hours. */
export function tutorUpcoming({
  pairings,
  interviews,
  now,
  timeZone,
}: {
  pairings: readonly UpcomingPairing[];
  interviews: readonly UpcomingInterview[];
  now: Date;
  timeZone: string;
}) {
  const today = programDateKey(now, timeZone);
  const lastDate = dateAfter(today, 6);
  const events: UpcomingEvent[] = [];
  let unresolvedTimes = 0;
  const confirmed = pairings.filter(
    (p) => p.scheduleConfirmed && p.tutees.length > 0,
  );
  for (const entry of pairingEntries(confirmed)) {
    const primary = entry.primary;
    for (let day = 0; day < 7; day++) {
      const date = dateAfter(today, day);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
      if (primary.dayOfWeek !== weekday) continue;
      try {
        const start = occurrence(date, primary.startMin, timeZone);
        const end = occurrence(date, primary.endMin, timeZone);
        if (end <= start) throw new Error("Invalid recurring time range");
        if (end <= now) continue;
        events.push({
          id: `session:${entry.id}:${date}`,
          kind: "session",
          start,
          end,
          label: [...new Set(entry.pairings.map((p) => p.subject))].join(" / "),
          room: primary.room?.name ?? null,
          count: entry.pairings.length,
        });
      } catch {
        // A repeated/skipped wall time has no unique planned instant. Surface it
        // for review instead of inventing an appointment or hiding the whole list.
        unresolvedTimes++;
      }
    }
  }
  const seen = new Set<string>();
  for (const interview of interviews) {
    if (
      seen.has(interview.id) ||
      interview.isInvalid ||
      !interview.interviewAt ||
      !["PENDING", "INTERVIEW"].includes(interview.status)
    )
      continue;
    seen.add(interview.id);
    const start = interview.interviewAt;
    if (!Number.isFinite(start.getTime()) || start < now) continue;
    const date = programDateKey(start, timeZone);
    if (date < today || date > lastDate) continue;
    events.push({
      id: `interview:${interview.id}`,
      kind: "interview",
      start,
      end: null,
      label: interview.name,
      room: null,
      count: 1,
    });
  }
  // Ties never depend on locale, query arrival order or applicant display names.
  events.sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return { events, unresolvedTimes };
}
