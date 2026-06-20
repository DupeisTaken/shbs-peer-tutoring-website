import { describe, expect, it } from "vitest";

import {
  type Period,
  crossesSemester,
  crossesYear,
  graduationYear,
  isSchoolYear,
  nextPeriod,
  nextSchoolYear,
  prevSchoolYear,
  quarterSemester,
  schoolYearEndYear,
  schoolYearForDate,
  semesterQuarters,
} from "./period";

describe("quarter <-> semester", () => {
  it("maps quarters to semesters", () => {
    expect(quarterSemester("Q1")).toBe("S1");
    expect(quarterSemester("Q2")).toBe("S1");
    expect(quarterSemester("Q3")).toBe("S2");
    expect(quarterSemester("Q4")).toBe("S2");
  });

  it("lists a semester's quarters", () => {
    expect(semesterQuarters("S1")).toEqual(["Q1", "Q2"]);
    expect(semesterQuarters("S2")).toEqual(["Q3", "Q4"]);
  });
});

describe("school year", () => {
  it("validates the YY-YY form", () => {
    expect(isSchoolYear("25-26")).toBe(true);
    expect(isSchoolYear("26-27")).toBe(true);
    expect(isSchoolYear("25-27")).toBe(false);
    expect(isSchoolYear("2025-2026")).toBe(false);
    expect(isSchoolYear("abc")).toBe(false);
  });

  it("advances and rewinds", () => {
    expect(nextSchoolYear("25-26")).toBe("26-27");
    expect(prevSchoolYear("26-27")).toBe("25-26");
    // wraps the century cleanly
    expect(nextSchoolYear("99-00")).toBe("00-01");
  });

  it("derives the school year from a date (Aug start)", () => {
    expect(schoolYearForDate(new Date(2025, 8, 1))).toBe("25-26"); // Sep 2025
    expect(schoolYearForDate(new Date(2026, 0, 15))).toBe("25-26"); // Jan 2026
    expect(schoolYearForDate(new Date(2026, 7, 1))).toBe("26-27"); // Aug 2026
  });
});

describe("nextPeriod", () => {
  it("advances within a year", () => {
    expect(nextPeriod({ schoolYear: "25-26", quarter: "Q1" })).toEqual({
      schoolYear: "25-26",
      quarter: "Q2",
    });
    expect(nextPeriod({ schoolYear: "25-26", quarter: "Q3" })).toEqual({
      schoolYear: "25-26",
      quarter: "Q4",
    });
  });

  it("rolls Q4 into the next year's Q1", () => {
    expect(nextPeriod({ schoolYear: "25-26", quarter: "Q4" })).toEqual({
      schoolYear: "26-27",
      quarter: "Q1",
    });
  });
});

describe("crossesSemester", () => {
  const advance = (p: Parameters<typeof nextPeriod>[0]) => crossesSemester(p, nextPeriod(p));

  it("stays within a semester from Q1->Q2 and Q3->Q4", () => {
    expect(advance({ schoolYear: "25-26", quarter: "Q1" })).toBe(false);
    expect(advance({ schoolYear: "25-26", quarter: "Q3" })).toBe(false);
  });

  it("crosses at Q2->Q3 (S1->S2) and Q4->Q1 (new year)", () => {
    expect(advance({ schoolYear: "25-26", quarter: "Q2" })).toBe(true);
    expect(advance({ schoolYear: "25-26", quarter: "Q4" })).toBe(true);
  });
});

describe("crossesYear", () => {
  const advance = (p: Parameters<typeof nextPeriod>[0]) => crossesYear(p, nextPeriod(p));

  it("only true when Q4 rolls into the next year", () => {
    expect(advance({ schoolYear: "25-26", quarter: "Q1" })).toBe(false);
    expect(advance({ schoolYear: "25-26", quarter: "Q2" })).toBe(false);
    expect(advance({ schoolYear: "25-26", quarter: "Q3" })).toBe(false);
    expect(advance({ schoolYear: "25-26", quarter: "Q4" })).toBe(true);
  });
});

describe("graduation year", () => {
  it("derives the spring end year", () => {
    expect(schoolYearEndYear("25-26")).toBe(2026);
    expect(schoolYearEndYear("26-27")).toBe(2027);
  });

  it("maps grade -> class-of year within a school year", () => {
    expect(graduationYear(12, "25-26")).toBe(2026);
    expect(graduationYear(11, "25-26")).toBe(2027);
    expect(graduationYear(9, "25-26")).toBe(2029);
    // class-of stays constant as both grade and year advance together
    expect(graduationYear(11, "25-26")).toBe(graduationYear(12, "26-27"));
  });
});

/**
 * Longevity: the program only advances via explicit refreshes, so the engine must stay correct
 * across many years of them. Simulate 15 school years (60 quarterly refreshes) and assert the
 * invariants never drift.
 */
describe("longevity — 15 years of quarterly refreshes", () => {
  it("keeps quarters, semesters, and school years consistent", () => {
    let p: Period = { schoolYear: "25-26", quarter: "Q1" };
    let yearCount = 0;

    for (let i = 0; i < 60; i++) {
      const next = nextPeriod(p);
      // Semester always matches the quarter.
      expect(quarterSemester(p.quarter)).toBe(p.quarter < "Q3" ? "S1" : "S2");
      // A year boundary happens exactly when Q4 rolls to Q1.
      const yearTurned = crossesYear(p, next);
      expect(yearTurned).toBe(p.quarter === "Q4");
      // Every year boundary is also a semester boundary.
      if (yearTurned) {
        expect(crossesSemester(p, next)).toBe(true);
        yearCount++;
      }
      // School year only changes at a year boundary, and always advances by one.
      if (yearTurned) {
        expect(schoolYearEndYear(next.schoolYear)).toBe(schoolYearEndYear(p.schoolYear) + 1);
      } else {
        expect(next.schoolYear).toBe(p.schoolYear);
      }
      p = next;
    }

    expect(yearCount).toBe(15);
    expect(p.schoolYear).toBe("40-41"); // 25-26 + 15 years
    expect(p.quarter).toBe("Q1");
  });

  it("keeps a cohort's class-of year constant as it ages each year", () => {
    // A G9 tutor in 25-26 should always read "Class of 2029" until they graduate (G12 -> archived).
    let schoolYear = "25-26";
    for (let grade = 9; grade <= 12; grade++) {
      expect(graduationYear(grade, schoolYear)).toBe(2029);
      schoolYear = nextSchoolYear(schoolYear);
    }
  });
});
