"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { groupAssignmentTutors } from "~/lib/assignment-qualification";
import { Button } from "./ui/button";
import { FormActions } from "./ui/patterns";

export type PanelTutor = {
  id: string;
  englishName: string;
  status: string;
  user: { tutorAccessRevoked: boolean; suspendedAt: Date | null } | null;
};

/** The subject focus only groups choices. It never removes picks or changes the
 * saved panel, and the server remains authoritative for qualification/chair rules. */
export function InterviewPanelEditor({
  applicationId,
  updatedAt,
  requestedTutorId,
  subjects,
  interviewers,
  tutors,
  onChanged,
}: {
  applicationId: string;
  updatedAt: Date;
  requestedTutorId: string | null;
  subjects: { id: string; label: string }[];
  interviewers: {
    isHead: boolean;
    tutor: { id: string; englishName: string };
  }[];
  tutors: PanelTutor[];
  onChanged: () => Promise<unknown> | void;
}) {
  const t = useTranslations("admin.applications");
  const workflow = useTranslations("workflows");
  const helpId = useId();
  const grants = api.admin.subjectEligibility.useQuery();
  const assign = api.admin.assignInterviewers.useMutation({
    onSuccess: onChanged,
    onError: onChanged,
  });
  const [focus, setFocus] = useState("");
  const [picks, setPicks] = useState(() =>
    Array.from(
      { length: Math.max(3, interviewers.length) },
      (_, index) => interviewers[index]?.tutor.id ?? "",
    ),
  );
  const [head, setHead] = useState(
    interviewers.find((person) => person.isHead)?.tutor.id ?? "",
  );
  const eligible = tutors.filter(
    (tutor) =>
      tutor.status === "ACTIVE" &&
      tutor.user &&
      !tutor.user.tutorAccessRevoked &&
      !tutor.user.suspendedAt &&
      tutor.id !== requestedTutorId,
  );
  const subjectIds = focus ? [focus] : subjects.map((subject) => subject.id);
  const groups = groupAssignmentTutors(eligible, subjectIds, grants.data ?? []);
  const chosen = picks.filter(Boolean);
  const ready = !grants.isLoading && !grants.error && grants.data !== undefined;
  const canAssign =
    ready &&
    chosen.length >= 3 &&
    chosen.length === picks.length &&
    new Set(chosen).size === chosen.length &&
    chosen.includes(head) &&
    chosen.every((id) => eligible.some((tutor) => tutor.id === id)) &&
    !assign.isPending;
  const labelFor = (tutor: PanelTutor) => {
    const names = subjects
      .filter((subject) =>
        grants.data?.some(
          (grant) =>
            grant.tutorId === tutor.id && grant.subjectId === subject.id,
        ),
      )
      .map((subject) => subject.label);
    return names.length
      ? `${tutor.englishName} — ${names.join(", ")}`
      : tutor.englishName;
  };
  return (
    <div className="mt-3 space-y-3">
      <label className="block max-w-xl">
        <span className="label">{t("picker.subjectFocus")}</span>
        <select
          className="select min-h-11 lg:min-h-10"
          value={focus}
          disabled={assign.isPending}
          onChange={(event) => setFocus(event.target.value)}
        >
          <option value="">{t("picker.anySubject")}</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.label}
            </option>
          ))}
        </select>
      </label>
      <p
        id={helpId}
        className="muted text-sm"
        role={grants.error ? "alert" : undefined}
      >
        {grants.error
          ? t("picker.loadError")
          : !ready
            ? t("picker.loading")
            : t("picker.help")}
      </p>
      {grants.error && (
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => void grants.refetch()}
        >
          {t("picker.retry")}
        </button>
      )}
      <div className="space-y-3">
        {picks.map((pick, index) => {
          const selectedTutor = eligible.find((tutor) => tutor.id === pick);
          // Preserve the label of historical/inactive selections instead of silently
          // displaying a blank native select or substituting another tutor.
          const retained =
            !eligible.some((tutor) => tutor.id === pick) && pick
              ? (tutors.find((tutor) => tutor.id === pick) ??
                interviewers.find((person) => person.tutor.id === pick)?.tutor)
              : undefined;
          return (
            <div key={index}>
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-0 flex-[1_1_16rem]">
                  <span className="label">
                    {t("panelistSlot", { n: index + 1 })}
                  </span>
                  <select
                    className="select min-h-11 lg:min-h-10"
                    value={pick}
                    aria-describedby={helpId}
                    disabled={!ready || assign.isPending}
                    onChange={(event) => {
                      const next = event.target.value;
                      setPicks((current) =>
                        current.map((id, slot) => (slot === index ? next : id)),
                      );
                      if (head === pick) setHead("");
                    }}
                  >
                    <option value="">
                      {t("panelistSlot", { n: index + 1 })}
                    </option>
                    {retained && (
                      <option value={retained.id} disabled>
                        {t("picker.unavailable", {
                          name: retained.englishName,
                        })}
                      </option>
                    )}
                    {(["qualified", "unqualified"] as const).map((group) => (
                      <optgroup key={group} label={t(`picker.${group}`)}>
                        {groups[group]
                          .filter(
                            (tutor) =>
                              tutor.id === pick || !picks.includes(tutor.id),
                          )
                          .map((tutor) => (
                            <option key={tutor.id} value={tutor.id}>
                              {labelFor(tutor)}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600 lg:min-h-10">
                  <input
                    type="radio"
                    name={`head-${applicationId}`}
                    checked={!!pick && head === pick}
                    disabled={!pick || !!retained || !ready || assign.isPending}
                    onChange={() => setHead(pick)}
                    aria-label={t("picker.chairSlot", { n: index + 1 })}
                  />
                  {t("head")}
                </label>
              </div>
              {/* Native selects keep one line; expose the complete selected name
                  and qualifications below on narrow screens so nothing is lost. */}
              {(selectedTutor ?? retained) && (
                <p className="muted mt-1 text-xs break-words lg:hidden">
                  {selectedTutor
                    ? labelFor(selectedTutor)
                    : t("picker.unavailable", { name: retained!.englishName })}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          size="compact"
          disabled={picks.length >= 8 || assign.isPending}
          onClick={() => setPicks((current) => [...current, ""])}
        >
          {workflow("addPanelist")}
        </Button>
        <Button
          size="compact"
          disabled={picks.length <= 3 || assign.isPending}
          onClick={() => {
            setPicks((current) => current.slice(0, -1));
            if (head === picks[picks.length - 1]) setHead("");
          }}
        >
          {workflow("removePanelist")}
        </Button>
      </div>
      <FormActions>
        <Button
          variant="primary"
          disabled={!canAssign}
          onClick={() =>
            assign.mutate({
              applicationId,
              tutorIds: chosen,
              headTutorId: head,
              expectedUpdatedAt: updatedAt,
            })
          }
        >
          {assign.isPending ? t("saving") : t("savePanel")}
        </Button>
        {!canAssign && !assign.isPending && (
          <span className="muted text-xs">{t("pickHint", { n: 3 })}</span>
        )}
        {assign.isSuccess && (
          <span role="status" className="text-sm text-green-600">
            {t("saved")}
          </span>
        )}
        {assign.error && (
          <span role="alert" className="text-sm text-red-600">
            {assign.error.message}
          </span>
        )}
      </FormActions>
    </div>
  );
}
