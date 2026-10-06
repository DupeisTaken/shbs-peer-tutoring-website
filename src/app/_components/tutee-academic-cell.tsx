"use client";
import { useTranslations } from "next-intl";
import { normalizeGrade } from "~/lib/academics";
import { graduationYear, isSchoolYear } from "~/lib/period";
import type { RouterOutputs } from "~/trpc/react";

/** Match account-table typography while keeping enrollment evidence tied to its own year. */
export function TuteeAcademicCell({
  row,
}: {
  row: RouterOutputs["admin"]["tutees"][number];
}) {
  const t = useTranslations("tuteeHistory");
  const a = useTranslations("academics");
  const enrollment = row.historical || !(row.owner ?? row.user);
  // A saved original outranks mutable roster mirrors even when its values are null.
  const original = row.enrollmentOriginal;
  const report = row.enrollmentCorrection ?? original;
  const grade = enrollment
    ? normalizeGrade(report ? report.rawGrade : row.gradeLevel)
    : row.academic;
  const year = enrollment
    ? report
      ? report.schoolYear
      : row.enrollmentPeriod?.schoolYear
    : row.academic.schoolYear;
  const graduated = enrollment
    ? !row.enrollmentCorrection &&
      (original ? original.academicallyGraduated : row.academicallyGraduated)
    : row.academic.status === "GRADUATED";
  const review =
    !enrollment &&
    (row.academic.status === "UNKNOWN" ||
      (row.academic.status === "REPORTED" && row.academic.needsConfirmation));
  const classYear =
    !graduated &&
    !review &&
    grade.gradeLevel != null &&
    year &&
    isSchoolYear(year)
      ? graduationYear(grade.gradeLevel, year)
      : null;
  const label = graduated
    ? a("graduated")
    : review
      ? a("rosterUnknown")
      : grade.gradeLevel != null
        ? a("gradeValue", { grade: grade.gradeLevel })
        : (grade.rawGrade ??
          (row.academic.status === "NOT_APPLICABLE" && !enrollment
            ? a("notApplicable")
            : t("notRecorded")));
  return (
    <div className="space-y-1 leading-tight">
      <p>{label}</p>
      {classYear && (
        <p className="muted text-xs">{t("classOf", { year: classYear })}</p>
      )}
      {year && (
        <p className="muted text-xs">
          {year}
          {enrollment && !row.enrollmentCorrection && year === row.enrollmentPeriod?.schoolYear && row.enrollmentPeriod?.quarter
            ? ` · ${row.enrollmentPeriod.quarter}`
            : ""}
        </p>
      )}
      {review && <p className="text-xs text-amber-700">{t("reviewNeeded")}</p>}
    </div>
  );
}
