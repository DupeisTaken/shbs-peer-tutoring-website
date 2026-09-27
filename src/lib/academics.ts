import { z } from "zod";
import { graduationYear, isSchoolYear } from "./period";

export const academicFields = z.object({
  status: z.enum(["REPORTED", "UNKNOWN", "NOT_APPLICABLE"]),
  gradeLevel: z.number().int().min(1).max(12).nullable(),
  rawGrade: z.string().trim().max(200).nullable().optional(),
  schoolYear: z
    .string()
    .refine(isSchoolYear, "Use an adjacent school year, such as 26-27.")
    .nullable(),
  reason: z.string().trim().max(500).optional(),
});
export const academicInput = academicFields
  .extend({ expectedProfileVersion: z.number().int().nonnegative() })
  .superRefine((value, ctx) => {
    if (
      value.status === "REPORTED" &&
      (value.gradeLevel === null || value.schoolYear === null)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A reported grade needs its reference school year.",
      });
    if (value.status !== "REPORTED" && value.gradeLevel !== null)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only a reported grade may have a numeric grade.",
      });
  });
/** Public confirmations describe today's grade; legacy client years are accepted but never trusted. */
export const currentAcademicInput = academicFields.omit({ schoolYear: true }).extend({
  schoolYear: z.string().nullable().optional(),
  expectedSchoolYear: z.string().nullable().optional(),
  expectedProfileVersion: z.number().int().nonnegative(),
});
export type AcademicRecord = {
  status: "REPORTED" | "UNKNOWN" | "NOT_APPLICABLE";
  gradeLevel: number | null;
  rawGrade: string | null;
  schoolYear: string | null;
  confirmedAt: Date | null;
  reconfirmRequired: boolean;
};

/** Only explicit G1�G12 notation is normalized. Preserve other school systems verbatim. */
export function normalizeGrade(raw: string | number | null | undefined) {
  const rawGrade = raw == null ? null : String(raw).trim() || null;
  const match = rawGrade
    ? /^(?:g(?:rade)?\s*)?([1-9]|1[0-2])$/i.exec(rawGrade)
    : null;
  return { gradeLevel: match ? Number(match[1]) : null, rawGrade };
}

/** Expected graduation belongs to the report's year, never today's program term. */
export function academicSummary(
  profile: AcademicRecord | null | undefined,
  currentSchoolYear?: string | null,
) {
  const value: AcademicRecord = profile ?? {
    status: "UNKNOWN",
    gradeLevel: null,
    rawGrade: null,
    schoolYear: null,
    confirmedAt: null,
    reconfirmRequired: true,
  };
  const expectedGraduationYear =
    value.status === "REPORTED" &&
    value.gradeLevel !== null &&
    value.schoolYear &&
    isSchoolYear(value.schoolYear)
      ? graduationYear(value.gradeLevel, value.schoolYear)
      : null;
  return {
    status: value.status,
    gradeLevel: value.gradeLevel,
    rawGrade: value.rawGrade,
    schoolYear: value.schoolYear,
    confirmedAt: value.confirmedAt,
    expectedGraduationYear,
    needsConfirmation:
      value.reconfirmRequired ||
      (value.status !== "NOT_APPLICABLE" &&
        (!value.confirmedAt ||
          !value.schoolYear ||
          !currentSchoolYear ||
          value.schoolYear !== currentSchoolYear)),
  };
}
export type AcademicSummary = ReturnType<typeof academicSummary>;

/** Optional/other-system grades stay optional; stale known grades and explicit conflicts need review. */
export function needsAcademicConfirmationForParticipation(
  academic: AcademicSummary,
) {
  return (
    academic.needsConfirmation &&
    (academic.status !== "UNKNOWN" || academic.gradeLevel !== null)
  );
}
