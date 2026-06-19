/**
 * Service-hour computation. Pure, dependency-free, and unit-tested — the single source of
 * truth for how attendance turns into service hours. Always computed server-side at submit
 * time and stored on the Session row.
 */

export type AttendanceStatus =
  | "PRESENT"
  | "RESCHEDULED"
  | "EXTRA_SESSION"
  | "TUTOR_ABSENT"
  | "TUTEE_ABSENT_EXCUSED"
  | "TUTEE_ABSENT_UNEXCUSED";

/**
 * Multiplier applied to the rounded hours.
 * - Unexcused tutee absence: 1 (tutor still showed up, credited as if solo).
 * - Excused tutee absence or tutor absent: 0 (no credit).
 * - Otherwise: tuteeCount + 1 (1 tutee -> 2, group of 2 -> 3, ...).
 */
export function shFactor(status: AttendanceStatus, tuteeCount: number): number {
  if (status === "TUTEE_ABSENT_UNEXCUSED") return 1;
  if (status === "TUTEE_ABSENT_EXCUSED" || status === "TUTOR_ABSENT") return 0;
  return tuteeCount + 1; // 1 tutee → 2, group of 2 → 3
}

/**
 * Rounds duration to the nearest half-hour (a <=10 min leftover rounds down, otherwise up)
 * and multiplies by the factor.
 */
export function shCount(durationMin: number, factor: number): number {
  const hours = durationMin / 60;
  const leftover = durationMin % 60;
  const rounded =
    leftover <= 10 ? Math.floor(hours * 2) / 2 : Math.ceil(hours * 2) / 2;
  return rounded * factor;
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
 * raw submission inputs.
 */
export function computeSessionHours(args: {
  status: AttendanceStatus;
  tuteeCount: number;
  startMin: number;
  endMin: number;
  date: Date;
}): ComputedHours {
  const durationMin = args.endMin - args.startMin;
  const factor = shFactor(args.status, args.tuteeCount);
  return {
    durationMin,
    shFactor: factor,
    shCount: shCount(durationMin, factor),
    month: monthKey(args.date),
  };
}
