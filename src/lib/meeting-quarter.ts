import { DEFAULT_TIME_ZONE } from "~/i18n/config";
import { QUARTERS, schoolYearEndYear, type Quarter } from "./period";
import { programDateKey } from "./program-time";

export interface MeetingTermWindow {
  id: string;
  schoolYear: string;
  quarter: Quarter;
  name: string;
  active: boolean;
  startDate: Date | string | null;
  endDate: Date | string | null;
  createdAt: Date | string;
}

export interface MeetingTutorAccountInfo {
  status: string;
  user?: { createdAt?: Date | string | null } | null;
}

export type MeetingAutoExemptionReason =
  | "inactive"
  | "no_account_at_meeting"
  | null;

function toTime(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function compareTermOrder(a: MeetingTermWindow, b: MeetingTermWindow): number {
  const yearA = schoolYearEndYear(a.schoolYear);
  const yearB = schoolYearEndYear(b.schoolYear);
  if (Number.isFinite(yearA) && Number.isFinite(yearB) && yearA !== yearB) {
    return yearA - yearB;
  }
  const yearCmp = a.schoolYear.localeCompare(b.schoolYear);
  if (yearCmp !== 0) return yearCmp;
  return QUARTERS.indexOf(a.quarter) - QUARTERS.indexOf(b.quarter);
}

/**
 * Resolve which existing program Term (quarter) a meeting date belongs to.
 *
 * Resolution rules:
 * 1. Explicit `startDate`/`endDate` windows take priority when configured on a Term
 *    (compared by program calendar day so local dates match across time zones).
 * 2. Otherwise, terms ordered chronologically partition time by `[effectiveStart, nextEffectiveStart)`
 *    where `effectiveStart = term.startDate ?? term.createdAt`, matching how Reports
 *    derives per-period calendar windows.
 * 3. Future dates beyond the last explicit `endDate` fall back to the active term.
 * 4. Dates before the earliest term fall back to the earliest term unless multiple
 *    terms share that exact start timestamp (e.g. seeded/initial setup), in which
 *    case the active term wins if it shares that timestamp.
 */
export function resolveTermForMeetingDate<T extends MeetingTermWindow>(
  date: Date | string,
  terms: readonly T[],
  options?: { timeZone?: string },
): T | null {
  if (terms.length === 0) return null;
  const meetingDate = new Date(date);
  const meetingMs = meetingDate.getTime();
  if (!Number.isFinite(meetingMs)) return null;

  const timeZone = options?.timeZone ?? DEFAULT_TIME_ZONE;
  const ordered = [...terms].sort(compareTermOrder);
  const active =
    ordered.find((term) => term.active) ?? ordered[ordered.length - 1] ?? null;

  // Pass 1: explicit bounded date windows (`startDate` + `endDate`) using program local calendar days.
  const meetingDay = programDateKey(meetingDate, timeZone);
  const explicitMatches = ordered.filter((term) => {
    if (!term.startDate || !term.endDate) return false;
    const startMs = toTime(term.startDate);
    const endMs = toTime(term.endDate);
    if (startMs === null || endMs === null) return false;
    const startDay = programDateKey(new Date(startMs), timeZone);
    const endDay = programDateKey(new Date(endMs), timeZone);
    return meetingDay >= startDay && meetingDay <= endDay;
  });
  if (explicitMatches.length > 0) {
    return (
      explicitMatches.find((term) => term.active) ??
      explicitMatches[explicitMatches.length - 1]!
    );
  }

  // Pass 2: chronological windows `[effectiveStart, nextEffectiveStart)`.
  // Explicit `endDate` caps the latest term only if it falls before a future meeting,
  // in which case future dates still land in the active quarter.
  const withStarts = ordered
    .map((term) => ({
      term,
      startMs: toTime(term.startDate) ?? toTime(term.createdAt),
      endMs: toTime(term.endDate),
    }))
    .filter(
      (entry): entry is { term: T; startMs: number; endMs: number | null } =>
        entry.startMs !== null,
    )
    .sort((a, b) => a.startMs - b.startMs || compareTermOrder(a.term, b.term));

  if (withStarts.length === 0) return active;

  // Check if the date falls strictly before the earliest term's effective start.
  const earliestStart = withStarts[0]!.startMs;
  if (meetingMs < earliestStart) {
    const earliestGroup = withStarts.filter(
      (entry) => entry.startMs === earliestStart,
    );
    return (
      earliestGroup.find((entry) => entry.term.active)?.term ??
      earliestGroup[0]!.term
    );
  }

  // Find the latest term whose effective start is <= meetingMs.
  let matchedIndex = -1;
  for (let i = 0; i < withStarts.length; i++) {
    if (withStarts[i]!.startMs <= meetingMs) {
      matchedIndex = i;
    } else {
      break;
    }
  }

  if (matchedIndex >= 0) {
    const matched = withStarts[matchedIndex]!;
    // If multiple terms share the exact same start timestamp (e.g., created in one batch),
    // prefer the active term when it belongs to that tied group.
    const tiedGroup = withStarts.filter(
      (entry) => entry.startMs === matched.startMs,
    );
    const chosen =
      tiedGroup.find((entry) => entry.term.active) ?? matched;

    // If this is the latest term and it has an explicit `endDate` that the meeting is past,
    // route future dates to the active term.
    if (
      matchedIndex === withStarts.length - 1 &&
      chosen.endMs !== null &&
      meetingDay > programDateKey(new Date(chosen.endMs), timeZone)
    ) {
      return active ?? chosen.term;
    }
    return chosen.term;
  }

  return active;
}

/**
 * Determine whether a tutor should be automatically marked Exempt (X) for a meeting
 * when no explicit attendance row exists yet.
 *
 * - Inactive tutors (`status !== "ACTIVE"`) are always exempt.
 * - Active tutors who did not have a user account when the meeting occurred are
 *   auto-exempt (`"no_account_at_meeting"`):
 *   1. Tutor currently has no linked account (`user === null`) and the meeting has
 *      already happened (`meetingDate <= now`).
 *   2. Tutor's linked account was created after the meeting started
 *      (`user.createdAt > meetingDate`).
 *
 * Note: `user === undefined` (field omitted in minimal fixtures) is treated as
 * unknown rather than accountless so existing tests without account metadata
 * remain unaffected.
 */
export function getMeetingAutoExemption(
  tutor: MeetingTutorAccountInfo,
  meetingDate: Date | string,
  now: Date = new Date(),
): MeetingAutoExemptionReason {
  if (tutor.status !== "ACTIVE") return "inactive";
  const meetingMs = toTime(meetingDate);
  if (meetingMs === null) return null;
  if (tutor.user === null) {
    return meetingMs <= now.getTime() ? "no_account_at_meeting" : null;
  }
  const accountMs = toTime(tutor.user?.createdAt);
  if (accountMs !== null && meetingMs < accountMs) {
    return "no_account_at_meeting";
  }
  return null;
}

/**
 * Combine recorded attendance evidence with automatic account-based exemptions.
 * Recorded attendance always takes precedence; missing rows for inactive tutors
 * stay unrecorded in historical tables (no invented historical evidence), while
 * active tutors who had no account at the meeting date resolve to `EXEMPT`.
 */
export function resolveEffectiveMeetingStatus(
  recordedStatus: string | undefined,
  tutor: MeetingTutorAccountInfo,
  meetingDate: Date | string,
  now: Date = new Date(),
): {
  status: string | undefined;
  autoExemptReason: MeetingAutoExemptionReason;
  isRecorded: boolean;
} {
  if (recordedStatus) {
    return {
      status: recordedStatus,
      autoExemptReason: null,
      isRecorded: true,
    };
  }
  const reason = getMeetingAutoExemption(tutor, meetingDate, now);
  if (reason === "no_account_at_meeting") {
    return {
      status: "EXEMPT",
      autoExemptReason: reason,
      isRecorded: false,
    };
  }
  return {
    status: undefined,
    autoExemptReason: reason,
    isRecorded: false,
  };
}
