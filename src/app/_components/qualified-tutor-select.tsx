"use client";
import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { participantNameLabel } from "./participant-name";
import {
  AssignmentWorkloadFeedback,
  useAssignmentWorkloads,
} from "./assignment-workload";
import {
  groupAssignmentTutors,
  type QualificationOption,
} from "~/lib/assignment-qualification";

/** Native optgroups retain keyboard navigation and announce the meaning of each group. */
export function QualifiedTutorSelect({
  tutors,
  subjectId,
  value,
  onChange,
  label,
  disabled = false,
  optionLabel,
  retainedTutor,
  leading,
  actions,
  className = "",
}: {
  tutors: QualificationOption[];
  subjectId: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  optionLabel?: (id: string) => string;
  retainedTutor?: QualificationOption;
  /** Row companions align with the select box, excluding its label and guidance. */
  leading?: ReactNode;
  actions?: ReactNode;
  /** A caller may place the complete field in its own grid without changing other layouts. */
  className?: string;
}) {
  const t = useTranslations("assignmentQualification");
  const workloadText = useTranslations("tutorWorkload");
  const workloads = useAssignmentWorkloads();
  const names = useTranslations("participantNames");
  const helpId = useId();
  const workloadId = useId();
  const tutorLabel = (tutor: QualificationOption) => {
    const workload = workloads.data?.tutors?.find((row) => row.id === tutor.id);
    // Keep subject/name space available. Unknown or stale data never looks like zero.
    const suffix =
      !workload || workloads.error || workloads.isFetching
        ? "(?)"
        : workload.preferredMaximum === null
          ? `(${workload.count})`
          : `(${workload.count}/${workload.preferredMaximum})`;
    return `${optionName(tutor)} ${suffix}`;
  };
  const grants = api.admin.subjectEligibility.useQuery();
  const subjects = api.admin.subjects.useQuery();
  const subject = subjects.data?.find((item) => item.id === subjectId);
  const unavailable = !subject?.active || subject.level?.active === false;
  const groups = groupAssignmentTutors(tutors, subjectId, grants.data ?? []);
  // Keep caller-owned workload decorations, but never leave a native option unnamed.
  const displayName = (tutor: QualificationOption) =>
    participantNameLabel(tutor.englishName, tutor.username, names("unnamed"));
  const optionName = (tutor: QualificationOption) => {
    const supplied = optionLabel?.(tutor.id);
    return supplied?.trim() ? supplied : displayName(tutor);
  };
  return (
    // Explicit rows support wrapped labels without language-dependent offsets.
    <div
      className={`grid w-full min-w-0 gap-x-3 gap-y-1 ${leading ? "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]" : actions ? "lg:grid-cols-[minmax(0,1fr)_auto]" : ""} ${className}`}
    >
      {leading && (
        <div className="min-w-0 text-sm lg:col-start-1 lg:row-start-2 lg:self-center">
          {leading}
        </div>
      )}
      <label
        className={`grid min-w-0 grid-rows-subgrid text-sm ${leading ? "row-span-2 lg:col-start-2" : "row-span-2"}`}
      >
        <span className="label">{label}</span>
        <select
          className="select min-h-11 lg:min-h-10"
          value={value}
          aria-label={label}
          aria-describedby={`${helpId} ${workloadId}`}
          disabled={
            disabled ||
            !subjectId ||
            unavailable ||
            grants.isLoading ||
            subjects.isLoading ||
            !!grants.error ||
            !!subjects.error
          }
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t("choose")}</option>
          {value === retainedTutor?.id &&
            !tutors.some((tu) => tu.id === value) && (
              <option value={retainedTutor.id} disabled>
                {tutorLabel(retainedTutor)}
              </option>
            )}
          <optgroup label={t("qualified")}>
            {groups.qualified.map((tu) => (
              <option key={tu.id} value={tu.id}>
                {tutorLabel(tu)}
              </option>
            ))}
          </optgroup>
          <option disabled aria-hidden="true">
            ──────────
          </option>
          <optgroup label={t("unqualified")}>
            {groups.unqualified.map((tu) => (
              <option key={tu.id} value={tu.id}>
                {tutorLabel(tu)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {actions && (
        <div
          className={`flex flex-wrap items-center gap-2 ${leading ? "lg:col-start-3" : "lg:col-start-2"} lg:row-start-2`}
        >
          {actions}
        </div>
      )}
      <p
        id={helpId}
        className={`text-xs text-slate-500 ${leading ? "lg:col-start-2" : "lg:col-start-1"}`}
        role={grants.error || subjects.error ? "alert" : undefined}
      >
        {grants.error || subjects.error
          ? t("loadError")
          : grants.isLoading || subjects.isLoading
            ? t("loading")
            : !subjectId
              ? t("chooseCourse")
              : unavailable
                ? t("unavailableCourse")
                : !groups.qualified.length
                  ? t("noneQualified")
                  : t("groupHelp")}
      </p>
      <div
        id={workloadId}
        className={`min-w-0 space-y-2 ${leading ? "lg:col-span-2 lg:col-start-2" : "lg:col-span-full lg:col-start-1"}`}
      >
        <p className="sr-only">{workloadText("compactHelp")}</p>
        <AssignmentWorkloadFeedback />
      </div>
    </div>
  );
}
