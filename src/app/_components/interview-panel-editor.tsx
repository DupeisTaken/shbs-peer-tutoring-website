"use client";
import { participantNameLabel } from "./participant-name";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { groupAssignmentTutors } from "~/lib/assignment-qualification";
import { isInterviewChairRole } from "~/lib/interview-chair";
import { Button } from "./ui/button";
import { FormActions, InlineNotice } from "./ui/patterns";

export type PanelTutor = {
  id: string;
  englishName: string;
  username?: string | null;
  status: string;
  user: {
    role: string;
    tutorAccessRevoked: boolean;
    suspendedAt: Date | null;
  } | null;
};

export type InterviewPanelSnapshot = {
  applicationId: string;
  updatedAt: Date;
  repairRequired?: boolean;
  interviewers: {
    isHead: boolean;
    tutor: { id: string; englishName: string };
  }[];
};

type InterviewPanelEditorProps = InterviewPanelSnapshot & {
  requestedTutorId: string | null;
  subjects: { id: string; label: string }[];
  tutors: PanelTutor[];
  onChanged: () => Promise<unknown> | void;
  /** Read the exact current, still-editable application before replacing a draft. */
  onReload?: () => Promise<InterviewPanelSnapshot>;
};

const panelDraft = (snapshot: InterviewPanelSnapshot) => ({
  expectedUpdatedAt: snapshot.updatedAt,
  interviewers: snapshot.interviewers,
  picks: Array.from(
    { length: Math.max(3, snapshot.interviewers.length) },
    (_, index) => snapshot.interviewers[index]?.tutor.id ?? "",
  ),
  head: snapshot.interviewers.find((person) => person.isHead)?.tutor.id ?? "",
  repairRequired: snapshot.repairRequired ?? false,
  reason: "",
});

/** The subject focus only groups choices. It never removes picks or changes the
 * saved panel, and the server remains authoritative for qualification/chair rules. */
export function InterviewPanelEditor(props: InterviewPanelEditorProps) {
  // A retained editor may receive another target without unmounting its caller.
  // Each application must own its draft, version and pending admission together.
  return <PanelEditorDraft key={props.applicationId} {...props} />;
}

function PanelEditorDraft({
  applicationId,
  updatedAt,
  repairRequired = false,
  requestedTutorId,
  subjects,
  interviewers,
  tutors,
  onChanged,
  onReload,
}: InterviewPanelEditorProps) {
  const t = useTranslations("admin.applications");
  const workflow = useTranslations("workflows");
  const participantNames = useTranslations("participantNames");
  const helpId = useId();
  const reasonId = useId();
  const submitted = useRef(false);
  const reading = useRef(false);
  const [writePending, setWritePending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<
    "reload" | "refresh" | null
  >(null);
  // Background reads may change the props, but cannot lend a new token to old
  // selections. Only a successful explicit/accepted-save read replaces this pair.
  const [draft, setDraft] = useState(() =>
    panelDraft({ applicationId, updatedAt, interviewers, repairRequired }),
  );
  const { picks, head } = draft;
  // A newly opened panel may require repair while this old draft stays stale.
  // Requiring its reason must not replace the captured concurrency token.
  const repairing = repairRequired || draft.repairRequired;
  const repairReason = draft.reason.trim();
  const adoptSnapshot = (snapshot: InterviewPanelSnapshot) => {
    if (snapshot.applicationId !== applicationId)
      throw new Error("Panel identity changed");
    setDraft(panelDraft(snapshot));
  };
  const refreshSavedPanel = async () => {
    if (reading.current) return;
    reading.current = true;
    setRefreshing(true);
    try {
      await onChanged();
      if (onReload) adoptSnapshot(await onReload());
      submitted.current = false;
      setAccepted(false);
      setRecoveryError(null);
    } catch {
      // Acceptance is final for this submission; retry reads, never this write.
      setRecoveryError("refresh");
    } finally {
      reading.current = false;
      setRefreshing(false);
    }
  };
  const grants = api.admin.subjectEligibility.useQuery();
  const assign = api.admin.assignInterviewers.useMutation({
    onSuccess: async () => {
      setWritePending(false);
      setAccepted(true);
      await refreshSavedPanel();
    },
    onError: () => {
      submitted.current = false;
      setWritePending(false);
      void Promise.resolve()
        .then(onChanged)
        .catch(() => undefined);
    },
  });
  const [focus, setFocus] = useState("");
  const locked =
    assign.isPending || writePending || accepted || refreshing || reloading;
  const reloadDraft = async () => {
    if (!onReload || locked || reading.current || submitted.current) return;
    reading.current = true;
    setReloading(true);
    setRecoveryError(null);
    try {
      adoptSnapshot(await onReload());
      assign.reset();
    } catch {
      setRecoveryError("reload");
    } finally {
      reading.current = false;
      setReloading(false);
    }
  };
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
  // Chair authority is independent of panel seniority. Keep an old chair visible
  // as saved history, but require a currently eligible Admin/Head before saving.
  const chairIds = new Set(
    eligible
      .filter((tutor) => isInterviewChairRole(tutor.user?.role))
      .map((tutor) => tutor.id),
  );
  const ready = !grants.isLoading && !grants.error && grants.data !== undefined;
  const panelReady =
    ready &&
    chosen.length >= 3 &&
    chosen.length === picks.length &&
    new Set(chosen).size === chosen.length &&
    chosen.includes(head) &&
    chairIds.has(head) &&
    chosen.every((id) => eligible.some((tutor) => tutor.id === id));
  const canAssign =
    panelReady &&
    (!repairing || (repairReason.length > 0 && repairReason.length <= 1000)) &&
    !locked;
  const labelFor = (tutor: PanelTutor) => {
    const names = subjects
      .filter((subject) =>
        grants.data?.some(
          (grant) =>
            grant.tutorId === tutor.id && grant.subjectId === subject.id,
        ),
      )
      .map((subject) => subject.label);
    const name = participantNameLabel(
      tutor.englishName,
      tutor.username,
      participantNames("unnamed"),
    );
    return names.length ? `${name} — ${names.join(", ")}` : name;
  };
  return (
    <div className="mt-3 space-y-3">
      <label className="block max-w-xl">
        <span className="label">{t("picker.subjectFocus")}</span>
        <select
          className="select min-h-11 lg:min-h-10"
          value={focus}
          disabled={locked}
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
                draft.interviewers.find((person) => person.tutor.id === pick)
                  ?.tutor)
              : undefined;
          const retainedName = retained
            ? participantNameLabel(
                retained.englishName,
                tutors.find((tutor) => tutor.id === retained.id)?.username,
                participantNames("unnamed"),
              )
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
                    disabled={!ready || locked}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDraft((current) => ({
                        ...current,
                        picks: current.picks.map((id, slot) =>
                          slot === index ? next : id,
                        ),
                        head: current.head === pick ? "" : current.head,
                      }));
                    }}
                  >
                    <option value="">
                      {t("panelistSlot", { n: index + 1 })}
                    </option>
                    {retained && (
                      <option value={retained.id} disabled>
                        {t("picker.unavailable", {
                          name: retainedName!,
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
                    disabled={!chairIds.has(pick) || !ready || locked}
                    onChange={() =>
                      setDraft((current) => ({ ...current, head: pick }))
                    }
                    aria-label={t("picker.chairSlot", { n: index + 1 })}
                    aria-describedby={helpId}
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
                    : t("picker.unavailable", { name: retainedName! })}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          size="compact"
          disabled={picks.length >= 8 || locked}
          onClick={() =>
            setDraft((current) => ({
              ...current,
              picks: [...current.picks, ""],
            }))
          }
        >
          {workflow("addPanelist")}
        </Button>
        <Button
          size="compact"
          disabled={picks.length <= 3 || locked}
          onClick={() => {
            setDraft((current) => ({
              ...current,
              picks: current.picks.slice(0, -1),
              head:
                current.head === current.picks[current.picks.length - 1]
                  ? ""
                  : current.head,
            }));
          }}
        >
          {workflow("removePanelist")}
        </Button>
      </div>
      {repairing && (
        <>
          <InlineNotice tone="warning">
            {t("panelRepair.consequence")}
          </InlineNotice>
          <label className="block" htmlFor={reasonId}>
            <span className="label">{t("panelRepair.reason")}</span>
            <textarea
              id={reasonId}
              className="textarea w-full"
              rows={3}
              required
              maxLength={1000}
              disabled={locked}
              value={draft.reason}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
            />
          </label>
        </>
      )}
      {!accepted &&
        onReload &&
        (!!assign.error ||
          draft.expectedUpdatedAt.getTime() !== updatedAt.getTime()) && (
          <InlineNotice
            tone="warning"
            action={
              <Button disabled={locked} onClick={() => void reloadDraft()}>
                {t(reloading ? "panelDraft.loading" : "panelDraft.reload")}
              </Button>
            }
          >
            {t(
              draft.expectedUpdatedAt.getTime() !== updatedAt.getTime()
                ? "panelDraft.changed"
                : "panelDraft.reloadHelp",
            )}
          </InlineNotice>
        )}
      {recoveryError && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            accepted ? (
              <Button
                disabled={refreshing}
                onClick={() => void refreshSavedPanel()}
              >
                {t(refreshing ? "panelDraft.loading" : "panelDraft.retry")}
              </Button>
            ) : undefined
          }
        >
          {t(
            recoveryError === "refresh"
              ? "panelDraft.refreshError"
              : "panelDraft.reloadError",
          )}
        </InlineNotice>
      )}
      <FormActions>
        <Button
          variant="primary"
          disabled={!canAssign}
          onClick={() => {
            if (!canAssign || submitted.current || reading.current) return;
            submitted.current = true;
            setWritePending(true);
            assign.mutate({
              applicationId,
              tutorIds: chosen,
              headTutorId: head,
              expectedUpdatedAt: draft.expectedUpdatedAt,
              ...(repairing ? { repairReason } : {}),
            });
          }}
        >
          {assign.isPending || writePending
            ? t("saving")
            : t(repairing ? "panelRepair.save" : "savePanel")}
        </Button>
        {!panelReady && !locked && (
          <span className="muted text-xs">{t("pickHint", { n: 3 })}</span>
        )}
        {assign.isSuccess && !accepted && !recoveryError && (
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
