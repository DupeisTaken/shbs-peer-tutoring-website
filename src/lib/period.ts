/**
 * Program period model (pure, unit-tested).
 *
 * The program refreshes four times a year, one per **quarter** (Q1–Q4). Two quarters make a
 * **semester**: S1 = Q1 + Q2, S2 = Q3 + Q4. Quarters/semesters live inside a **school year**
 * written as two 2-digit years, e.g. "25-26".
 *
 * Refreshing advances to the next quarter (Q4 rolls into the next school year's Q1). Service
 * hours and attendance are scoped by **semester** — they accumulate across a semester's two
 * quarters and start fresh when a new semester (or year) begins. Nothing is deleted; views are
 * filtered by period and history stays browsable.
 */

export const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
export type Quarter = (typeof QUARTERS)[number];

export const SEMESTERS = ["S1", "S2"] as const;
export type Semester = (typeof SEMESTERS)[number];

/** A point in program time: a quarter within a school year. */
export interface Period {
  schoolYear: string; // "25-26"
  quarter: Quarter;
}

/** Which semester a quarter belongs to (Q1/Q2 -> S1, Q3/Q4 -> S2). */
export function quarterSemester(quarter: Quarter): Semester {
  return quarter === "Q1" || quarter === "Q2" ? "S1" : "S2";
}

/** The two quarters that make up a semester. */
export function semesterQuarters(semester: Semester): Quarter[] {
  return semester === "S1" ? ["Q1", "Q2"] : ["Q3", "Q4"];
}

function pad2(n: number): string {
  return String(((n % 100) + 100) % 100).padStart(2, "0");
}

/**
 * School years are stored as two 2-digit years ("25-26") and assumed to be in the 21st century
 * (20xx). This is unambiguous and correct for every year from 2000–2098; the "98-99" -> "99-00"
 * step is the documented horizon (well beyond a decade). To run past ~2098, widen the format to
 * 4-digit start years — `schoolYearEndYear` is the single place that maps the suffix to a calendar
 * year, so the change is localized.
 */
const SCHOOL_YEAR_CENTURY = 2000;

/** Validate a "YY-YY" school year where the second year is the first + 1. */
export function isSchoolYear(value: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (a + 1) % 100 === b;
}

/** "25-26" -> "26-27". */
export function nextSchoolYear(schoolYear: string): string {
  const m = /^(\d{2})-(\d{2})$/.exec(schoolYear);
  const start = m ? Number(m[1]) : 0;
  return `${pad2(start + 1)}-${pad2(start + 2)}`;
}

/** "26-27" -> "25-26". */
export function prevSchoolYear(schoolYear: string): string {
  const m = /^(\d{2})-(\d{2})$/.exec(schoolYear);
  const start = m ? Number(m[1]) : 0;
  return `${pad2(start - 1)}-${pad2(start)}`;
}

/**
 * Advance to the next period. In quarter mode (default) it steps one quarter (Q4 rolls into the
 * next school year's Q1). In **semester mode** (the Quarter System toggle off) it steps a whole
 * semester — the active quarter is always a semester's first quarter (S1 = Q1, S2 = Q3), so S1 → Q3
 * (same year) and S2 → next year's Q1.
 */
export function nextPeriod(period: Period, semesterMode = false): Period {
  if (semesterMode) {
    return quarterSemester(period.quarter) === "S1"
      ? { schoolYear: period.schoolYear, quarter: "Q3" }
      : { schoolYear: nextSchoolYear(period.schoolYear), quarter: "Q1" };
  }
  const i = QUARTERS.indexOf(period.quarter);
  if (i < QUARTERS.length - 1) {
    return { schoolYear: period.schoolYear, quarter: QUARTERS[i + 1]! };
  }
  return { schoolYear: nextSchoolYear(period.schoolYear), quarter: "Q1" };
}

/** True when advancing from `from` to `to` lands in a different semester (or year) — the
 *  boundary at which service hours / attendance reset to a fresh total. */
export function crossesSemester(from: Period, to: Period): boolean {
  return (
    from.schoolYear !== to.schoolYear ||
    quarterSemester(from.quarter) !== quarterSemester(to.quarter)
  );
}

/** True when advancing crosses into a new school year (Q4 -> next year's Q1). */
export function crossesYear(from: Period, to: Period): boolean {
  return from.schoolYear !== to.schoolYear;
}

/** Last (spring) calendar year of a "YY-YY" school year, e.g. "25-26" -> 2026. */
export function schoolYearEndYear(schoolYear: string): number {
  const m = /^(\d{2})-(\d{2})$/.exec(schoolYear);
  return m ? SCHOOL_YEAR_CENTURY + Number(m[2]) : NaN;
}

/** Graduating ("class of") year for a grade in a given school year. G12 of "25-26" -> 2026. */
export function graduationYear(gradeLevel: number, schoolYear: string): number {
  return schoolYearEndYear(schoolYear) + (12 - gradeLevel);
}

/** Best-guess school year for a date, assuming the year starts in August. */
export function schoolYearForDate(date: Date): string {
  const y = date.getFullYear();
  const start = date.getMonth() >= 7 ? y : y - 1; // getMonth: 0=Jan, 7=Aug
  return `${pad2(start)}-${pad2(start + 1)}`;
}

export function periodLabel(period: Period, semesterMode = false): string {
  return semesterMode
    ? `${period.schoolYear} ${quarterSemester(period.quarter)}`
    : `${period.schoolYear} ${period.quarter}`;
}

export function semesterLabel(schoolYear: string, semester: Semester): string {
  return `${schoolYear} ${semester}`;
}
