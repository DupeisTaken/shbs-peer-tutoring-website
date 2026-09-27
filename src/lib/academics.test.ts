import { describe, expect, it } from "vitest";
import {
  academicInput,
  academicSummary,
  normalizeGrade,
  type AcademicRecord,
} from "./academics";
const report: AcademicRecord = {
  status: "REPORTED",
  gradeLevel: 10,
  rawGrade: "G10",
  schoolYear: "26-27",
  confirmedAt: new Date("2026-09-01"),
  reconfirmRequired: false,
};
describe("academic references", () => {
  it.each(["10", "G10", "Grade 10", "grade 1", "G12"])(
    "normalizes explicit grade %s",
    (raw) => expect(normalizeGrade(raw).gradeLevel).not.toBeNull(),
  );
  it.each(["Year 10", "高一", "IB1", "13", "G0", "10th", "", "university"])(
    "preserves unsupported %s without guessing",
    (raw) => {
      expect(normalizeGrade(raw)).toEqual({
        gradeLevel: null,
        rawGrade: raw || null,
      });
    },
  );
  it("keeps alumni estimates anchored through multiple years and unknown current terms", () => {
    for (const current of ["26-27", "27-28", "30-31", null])
      expect(academicSummary(report, current).expectedGraduationYear).toBe(
        2029,
      );
    expect(academicSummary(report, "27-28").needsConfirmation).toBe(true);
  });
  it("distinguishes a repeated year from continuing school during a tutoring break", () => {
    expect(
      academicSummary(
        { ...report, gradeLevel: 11, schoolYear: "27-28" },
        "27-28",
      ).expectedGraduationYear,
    ).toBe(2029);
    expect(
      academicSummary(
        { ...report, gradeLevel: 10, schoolYear: "27-28" },
        "27-28",
      ).expectedGraduationYear,
    ).toBe(2030);
  });
  it("never estimates legacy or unknown grades", () => {
    expect(
      academicSummary(
        { ...report, status: "UNKNOWN", schoolYear: null },
        "26-27",
      ).expectedGraduationYear,
    ).toBeNull();
    expect(academicSummary(null, null).needsConfirmation).toBe(true);
    expect(
      academicSummary(
        {
          ...report,
          status: "NOT_APPLICABLE",
          gradeLevel: null,
          schoolYear: null,
        },
        null,
      ).needsConfirmation,
    ).toBe(false);
  });
  it("requires explicit supported grades and adjacent reference years", () => {
    const valid = {
      status: "REPORTED",
      gradeLevel: 1,
      schoolYear: "26-27",
      expectedProfileVersion: 0,
    };
    expect(academicInput.safeParse(valid).success).toBe(true);
    for (const patch of [
      { gradeLevel: 13 },
      { schoolYear: null },
      { schoolYear: "26-29" },
      { status: "UNKNOWN" },
    ])
      expect(academicInput.safeParse({ ...valid, ...patch }).success).toBe(
        false,
      );
  });
});
