import type { TransactionDb } from "./transactions";

/** Integration seam for the dated-session owner. Include participants in explicit extras,
 * reschedules and dated recurring occurrences on this actual date, including preserved
 * plans on a closure. Attendance-only Session evidence is never a future plan.
 * Until the dated-session schema lands, the calendar's confirmed pairing cohort is used. */
export async function getSchoolCalendarDatedSessionUserIds(
  _tx: TransactionDb,
  _date: string,
): Promise<string[]> {
  return [];
}
