"use client";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { groupAssignmentTutors, type QualificationOption } from "~/lib/assignment-qualification";

/** Native optgroups retain keyboard navigation and announce the meaning of each group. */
export function QualifiedTutorSelect({ tutors, subjectId, value, onChange, label, disabled = false, optionLabel }: {
  tutors: QualificationOption[]; subjectId: string; value: string;
  onChange: (value: string) => void; label: string; disabled?: boolean;
  optionLabel?: (id: string) => string;
}) {
  const t = useTranslations("assignmentQualification");
  const helpId = useId();
  const grants = api.assignment.grants.useQuery();
  const subjects = api.admin.subjects.useQuery();
  const subject = subjects.data?.find((item) => item.id === subjectId);
  const unavailable = !subject?.active || subject.level?.active === false;
  const groups = groupAssignmentTutors(tutors, subjectId, grants.data ?? []);
  return <div className="min-w-0 flex-1 space-y-1">
    <label className="block space-y-1 text-sm">
      <span className="label">{label}</span>
      <select className="select min-h-11 lg:min-h-10" value={value} aria-describedby={helpId}
        disabled={disabled || !subjectId || unavailable || grants.isLoading || subjects.isLoading || !!grants.error || !!subjects.error}
        onChange={(event) => onChange(event.target.value)}>
        <option value="">{t("choose")}</option>
        <optgroup label={t("qualified")}>
          {groups.qualified.map((tu) => <option key={tu.id} value={tu.id}>{optionLabel?.(tu.id) ?? tu.englishName}</option>)}
        </optgroup>
        <option disabled aria-hidden="true">──────────</option>
        <optgroup label={t("unqualified")}>
          {groups.unqualified.map((tu) => <option key={tu.id} value={tu.id}>{optionLabel?.(tu.id) ?? tu.englishName}</option>)}
        </optgroup>
      </select>
    </label>
    <p id={helpId} className="text-xs text-slate-500" role={grants.error || subjects.error ? "alert" : undefined}>
      {grants.error || subjects.error ? t("loadError") : grants.isLoading || subjects.isLoading ? t("loading") : !subjectId ? t("chooseCourse") : unavailable ? t("unavailableCourse") : !groups.qualified.length ? t("noneQualified") : t("groupHelp")}
    </p>
  </div>;
}
