"use client";
import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import {
  AssignmentWorkloadAdvice,
  AssignmentWorkloadFeedback,
  useAssignmentWorkloads,
} from "./assignment-workload";
import type { WorkloadProposal } from "~/lib/tutor-workload";
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
  proposals,
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
  /** Defaults to one new awaiting-schedule assignment; editors supply their exact change. */
  proposals?: WorkloadProposal[];
}) {
  const t = useTranslations("assignmentQualification");
  const workloadText = useTranslations("tutorWorkload");
  const workloads = useAssignmentWorkloads();
  const helpId = useId();
  const workloadId = useId();
  const tutorLabel = (tutor: QualificationOption) => {
    const workload = workloads.data?.tutors?.find((row) => row.id === tutor.id);
    const count = workload
      ? workloadText(
          workloads.error
            ? "stale"
            : workloads.isFetching
              ? "rechecking"
              : "current",
          { count: workload.count },
        )
      : workloadText("unavailable");
    const preference =
      workload && !workloads.error && !workloads.isFetching
        ? ` · ${workload.preferredMaximum === null ? workloadText("unset") : workloadText("savedPreference", { count: workload.preferredMaximum })}`
        : "";
    return `${optionLabel?.(tutor.id) ?? tutor.englishName} — ${count}${preference}`;
  };
  const grants = api.admin.subjectEligibility.useQuery();
  const subjects = api.admin.subjects.useQuery();
  const subject = subjects.data?.find((item) => item.id === subjectId);
  const unavailable = !subject?.active || subject.level?.active === false;
  const groups = groupAssignmentTutors(tutors, subjectId, grants.data ?? []);
  return (
    // Explicit rows support wrapped labels without language-dependent offsets.
    <div
      className={`grid w-full min-w-0 gap-x-3 gap-y-1 ${leading ? "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]" : actions ? "lg:grid-cols-[minmax(0,1fr)_auto]" : ""}`}
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
        <AssignmentWorkloadFeedback />
        {value && (
          <AssignmentWorkloadAdvice tutorId={value} proposals={proposals} />
        )}
      </div>
    </div>
  );
}
