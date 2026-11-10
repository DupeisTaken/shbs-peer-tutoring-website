import { quarterSemester, type Quarter } from "~/lib/period";
import { DEDUCTION, monthKey } from "~/lib/service-hours";

export type MeetingHoursAttendance = {
  id: string;
  meetingId: string;
  status: string;
  meeting: {
    date: Date;
    term: { schoolYear: string; quarter: Quarter } | null;
  };
};

export type MeetingDeduction = {
  id: string;
  tutorId: string;
  type: "PUNISHMENT";
  amount: number;
  month: string;
  schoolYear: string;
  quarter: Quarter;
  reason: string;
};

export type MeetingDeductionDelta = {
  removed: MeetingDeduction[];
  added: MeetingDeduction[];
  changed: { before: MeetingDeduction; after: MeetingDeduction }[];
};

/** The caller excludes proven archive sources and supplies database ordering by
 * meeting date, then attendance ID. Preserve that sequence: JavaScript sorting
 * could change the database's tie order for retained, nonstandard archive IDs. */
export function calculateMeetingDeductions(
  tutorId: string,
  orderedRows: readonly MeetingHoursAttendance[],
): MeetingDeduction[] {
  const counts = new Map<string, number>();
  const deductions: MeetingDeduction[] = [];
  for (const row of orderedRows) {
    const term = row.meeting.term;
    if (!term || row.status !== "UNEXCUSED_ABSENT") continue;
    const semester = `${term.schoolYear}:${quarterSemester(term.quarter)}`;
    const count = (counts.get(semester) ?? 0) + 1;
    counts.set(semester, count);
    if (count <= 3) continue;
    deductions.push({
      id: `mtgabs_${row.meetingId}_${tutorId}`,
      tutorId,
      type: "PUNISHMENT",
      amount: DEDUCTION.MISSED_MEETING_UNEXCUSED,
      month: monthKey(row.meeting.date),
      schoolYear: term.schoolYear,
      quarter: term.quarter,
      reason:
        "Unexcused meeting absence beyond the semester allowance of three",
    });
  }
  return deductions;
}

const descriptorFields = [
  "tutorId",
  "type",
  "amount",
  "month",
  "schoolYear",
  "quarter",
  "reason",
] as const;

/** Compare logical consequences captured before and after the source mutation.
 * Stored adjustments deliberately are not inputs: an unchanged consequence must
 * not repair a missing target or normalize retained amounts, reasons or dates. */
export function diffMeetingDeductions(
  before: readonly MeetingDeduction[],
  after: readonly MeetingDeduction[],
): MeetingDeductionDelta {
  const previous = new Map(before.map((row) => [row.id, row]));
  const next = new Map(after.map((row) => [row.id, row]));
  const delta: MeetingDeductionDelta = { removed: [], added: [], changed: [] };
  // Effect ordering is stable without changing the allowance's source ordering.
  const ids = [...new Set([...previous.keys(), ...next.keys()])].sort();
  for (const id of ids) {
    const oldRow = previous.get(id);
    const newRow = next.get(id);
    if (!oldRow && newRow) delta.added.push(newRow);
    else if (oldRow && !newRow) delta.removed.push(oldRow);
    else if (
      oldRow &&
      newRow &&
      descriptorFields.some((field) => oldRow[field] !== newRow[field])
    )
      delta.changed.push({ before: oldRow, after: newRow });
  }
  return delta;
}
