/**
 * Service-hour computation. Pure, dependency-free, and unit-tested — the single source of
 * truth for how attendance turns into service hours. Always computed server-side at submit
 * time and stored on the Session row.
 */

/** The tutor's own status for a session (did it happen?). */
export type SessionTutorStatus = "PRESENT" | "RESCHEDULED" | "TUTOR_ABSENT";
/** A single tutee's attendance at a held session. */
export type TuteeAttendanceStatus = "PRESENT" | "EXCUSED_ABSENT" | "UNEXCUSED_ABSENT";

/**
 * Multiplier applied to the rounded hours, from the split tutor/tutee statuses (policy §III).
 * - Tutor not present (rescheduled or absent): 0 — the session didn't happen.
 * - All tutees excused-absent: 0 — no session effectively ran.
 * - Otherwise: 1 (prep + the tutor's own time) + the number of PRESENT tutees. Unexcused
 *   absences don't add to the count but still leave the tutor the baseline credit.
 */
export function sessionFactor(
  tutorStatus: SessionTutorStatus,
  tuteeStatuses: readonly TuteeAttendanceStatus[],
): number {
  if (tutorStatus !== "PRESENT") return 0;
  const present = tuteeStatuses.filter((s) => s === "PRESENT").length;
  const unexcused = tuteeStatuses.filter((s) => s === "UNEXCUSED_ABSENT").length;
  if (present === 0 && unexcused === 0) return 0; // everyone excused -> no credit
  return 1 + present;
}

/**
 * Rounds a duration (minutes) to the nearest half-hour: a <=10 min leftover within the hour
 * rounds down, otherwise up. Shared by session and interview hour math.
 */
export function roundToHalfHour(durationMin: number): number {
  const hours = durationMin / 60;
  const leftover = durationMin % 60;
  return leftover <= 10 ? Math.floor(hours * 2) / 2 : Math.ceil(hours * 2) / 2;
}

/**
 * Rounds duration to the nearest half-hour (a <=10 min leftover rounds down, otherwise up)
 * and multiplies by the factor.
 */
export function shCount(durationMin: number, factor: number): number {
  return roundToHalfHour(durationMin) * factor;
}

/**
 * Service hours a tutor earns for interviewing a tutor applicant: equal to the interview
 * duration (rounded to the nearest half-hour), per the tutor policy.
 */
export function interviewServiceHours(durationMin: number): number {
  return roundToHalfHour(durationMin);
}

/**
 * Service-hour deduction amounts from the tutor policy (Section IV).
 * These reduce a tutor's accrued total; surfaced as PUNISHMENT-type adjustments in the recap.
 */
export const DEDUCTION = {
  /** Per tutor absence beyond the per-semester limit. */
  OVER_LIMIT_ABSENCE: 0.25,
  /** Per unexcused tutor absence from a session. */
  UNEXCUSED_TUTOR_ABSENCE: 1,
  /** Per unexcused weekly-meeting absence. */
  MISSED_MEETING_UNEXCUSED: 0.125,
} as const;

/** Tutors may not exceed this many total absences per semester before deductions apply. */
export const ABSENCE_LIMIT_PER_SEMESTER = 3;

/** Deduction for total absences beyond the per-semester limit. */
export function overLimitAbsenceDeduction(totalAbsences: number): number {
  const over = Math.max(0, totalAbsences - ABSENCE_LIMIT_PER_SEMESTER);
  return over * DEDUCTION.OVER_LIMIT_ABSENCE;
}

/** "YYYY-MM" bucket for a date, used to group monthly totals. */
export function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export interface ComputedHours {
  durationMin: number;
  shFactor: number;
  shCount: number;
  month: string;
}

/**
 * Convenience helper used by the attendance mutation: derives every stored field from the
 * raw submission inputs (the tutor's status + each tutee's attendance).
 */
export function computeSessionHours(args: {
  tutorStatus: SessionTutorStatus;
  tuteeStatuses: readonly TuteeAttendanceStatus[];
  startMin: number;
  endMin: number;
  date: Date;
}): ComputedHours {
  const durationMin = args.endMin - args.startMin;
  const factor = sessionFactor(args.tutorStatus, args.tuteeStatuses);
  return {
    durationMin,
    shFactor: factor,
    shCount: shCount(durationMin, factor),
    month: monthKey(args.date),
  };
}
