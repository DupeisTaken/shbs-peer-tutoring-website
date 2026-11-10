"use client";

import { useEffect, useRef, useState } from "react";
import { ApplicationAccountSetupButton } from "./application-account-setup";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { parseProgramDateTime, programDateTimeInput } from "~/lib/program-time";
import { Button } from "./ui/button";
import { Modal } from "./ui/modal";
import { FormSection, InlineNotice } from "./ui/patterns";

export type CompletionParticipant = {
  tutorId: string;
  tutor: { englishName: string; status: string | null };
  attended: boolean;
  creditHours: number;
  currentPanel: boolean;
};
export type InterviewRecord =
  RouterOutputs["interviewManagement"]["options"]["applications"]["rows"][number] & {
    completionParticipants?: CompletionParticipant[];
  };
export type CompletionDraft = {
  date: string;
  duration: string;
  attended: string[];
  reason: string;
  version: Date;
  evidence?: InterviewRecord;
  outcome?: "applied" | "queued";
  refreshFailed?: boolean;
};

/** Summary reads contain no secrets; the setup action loads its exact application on demand. */
export function InterviewWorkflowStatus({
  application,
  navigationBlocked = false,
}: {
  application: InterviewRecord;
  navigationBlocked?: boolean;
}) {
  const t = useTranslations("interviewReview");
  const all = useTranslations();
  return (
    <div className="my-3 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
      <p>
        {t("decision", {
          status: all(`admin.applications.status.${application.status}`),
        })}
      </p>
      {application.pendingDecision && <p>{t("decisionPending")}</p>}
      <p>
        {t(
          application.interviewCompletedAt
            ? "hoursRecorded"
            : "completionPending",
        )}
      </p>
      {application.pendingCompletion && <p>{t("awardPending")}</p>}
      {application.registration && (
        <p>{t(`registration.${application.registration.state}`)}</p>
      )}
      {application.type === "INITIAL" &&
        application.status === "ACCEPTED" &&
        !application.isInvalid && (
          <ApplicationAccountSetupButton
            applicationId={application.id}
            name={application.name}
            label={t("registrationAction")}
            disabled={navigationBlocked}
          />
        )}
    </div>
  );
}

/** The parent retains each cancelled draft, including its reviewed version. A successful
 * write owns a separate read-only recovery step and can never be repeated by Refresh. */
export function InterviewCompletionReview({
  application,
  initialDraft,
  onClose,
  refresh,
  reload,
  onAccessDenied,
  readAvailable = true,
}: {
  application: InterviewRecord;
  initialDraft?: CompletionDraft;
  onClose: (draft?: CompletionDraft) => void;
  refresh: () => Promise<unknown>;
  reload: () => Promise<InterviewRecord>;
  onAccessDenied?: () => void;
  readAvailable?: boolean;
}) {
  const t = useTranslations("interviewReview");
  const all = useTranslations();
  const format = useFormatter();
  const timeZone = useTimeZone();
  const correctionT = useTranslations("interviewReview.correctionEvidence");
  const [evidence, setEvidence] = useState(
    initialDraft?.evidence ?? application,
  );
  const [draft, setDraft] = useState<CompletionDraft>(
    () =>
      initialDraft ?? {
        date: application.interviewCompletedAt
          ? programDateTimeInput(application.interviewCompletedAt, timeZone)
          : "",
        duration: String(application.interviewDurationMin ?? 30),
        attended: (application.completionParticipants ?? [])
          .filter((p) => p.attended)
          .map((p) => p.tutorId),
        reason: "",
        version: application.updatedAt,
      },
  );
  const [step, setStep] = useState<"edit" | "review" | "applied" | "queued">(
    initialDraft?.outcome ?? "edit",
  );
  const [error, setError] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(
    initialDraft?.refreshFailed ?? false,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [readRecoveryFailed, setReadRecoveryFailed] = useState(false);
  const writing = useRef(false);
  const reading = useRef(false);
  const editor = useRef<HTMLFormElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  // Replacing editor/review controls must leave keyboard focus inside the dialog.
  useEffect(() => {
    if (step === "review") reviewHeading.current?.focus();
    else if (step === "edit") editor.current?.querySelector("input")?.focus();
  }, [step]);
  const mutation = api.interviewManagement.complete.useMutation();
  const busy = mutation.isPending || refreshing || submitting;
  const correction = !!evidence.interviewCompletedAt;
  // The private evidence reader supplies historical physical-panel candidates
  // and real source amounts. Today's voting assignments cannot reconstruct them.
  const participants = evidence.completionParticipants ?? [];
  const evidenceAvailable = participants.length > 0;
  const canReview = readAvailable && evidenceAvailable && !readRecoveryFailed;
  const action = t(correction ? "correct" : "record");
  const hours = Number(draft.duration) / 60;
  const beforeTotal = participants.reduce(
    (sum, person) => sum + person.creditHours,
    0,
  );
  const afterTotal = hours * draft.attended.length;
  const completionDate = () =>
    evidence.interviewCompletedAt &&
    draft.date === programDateTimeInput(evidence.interviewCompletedAt, timeZone)
      ? evidence.interviewCompletedAt
      : parseProgramDateTime(draft.date, timeZone);
  const number = (value: number) =>
    format.number(value, { maximumFractionDigits: 4 });
  const update = (values: Partial<CompletionDraft>) =>
    setDraft((previous) => ({ ...previous, ...values }));
  const retryReads = async () => {
    if (reading.current || writing.current || busy) return;
    reading.current = true;
    setRefreshing(true);
    try {
      await refresh();
      setReadRecoveryFailed(false);
    } catch (caught) {
      const code = (caught as { data?: { code?: string } }).data?.code;
      if (code === "FORBIDDEN" || code === "UNAUTHORIZED") onAccessDenied?.();
      else setReadRecoveryFailed(true);
    } finally {
      reading.current = false;
      setRefreshing(false);
    }
  };
  const sync = async () => {
    if (reading.current) return;
    reading.current = true;
    setRefreshing(true);
    try {
      await refresh();
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      reading.current = false;
      setRefreshing(false);
    }
  };
  const submit = async () => {
    if (writing.current || busy || !canReview || step !== "review") return;
    writing.current = true;
    setSubmitting(true);
    setError("");
    try {
      await mutation.mutateAsync({
        applicationId: application.id,
        durationMin: Number(draft.duration),
        completedAt: completionDate(),
        attendedTutorIds: draft.attended,
        reason: draft.reason.trim(),
        expectedUpdatedAt: draft.version,
      });
    } catch (caught) {
      const code = (caught as { data?: { code?: string } }).data?.code;
      if (code === "FORBIDDEN" || code === "UNAUTHORIZED") {
        onAccessDenied?.();
        writing.current = false;
        setSubmitting(false);
        return;
      }
      const queued = (caught as { data?: { approvalId?: string } }).data
        ?.approvalId;
      if (queued) {
        setStep("queued");
        await sync();
      } else
        setError(caught instanceof Error ? caught.message : t("saveFailed"));
      writing.current = false;
      setSubmitting(false);
      return;
    }
    setStep("applied");
    await sync();
    writing.current = false;
    setSubmitting(false);
  };
  const close = () => {
    if (!writing.current && !busy)
      onClose(
        step === "applied" || step === "queued"
          ? refreshFailed
            ? { ...draft, evidence, outcome: step, refreshFailed: true }
            : undefined
          : { ...draft, evidence },
      );
  };
  const reloadEvidence = async () => {
    if (reading.current || writing.current || busy) return;
    reading.current = true;
    setRefreshing(true);
    try {
      const current = await reload();
      if (
        current.id !== application.id ||
        !current.completionParticipants?.length
      )
        throw new Error(correctionT("missingEvidence"));
      setEvidence(current);
      setDraft({
        date: current.interviewCompletedAt
          ? programDateTimeInput(current.interviewCompletedAt, timeZone)
          : "",
        duration: String(current.interviewDurationMin ?? 30),
        attended: current.completionParticipants
          .filter((p) => p.attended)
          .map((p) => p.tutorId),
        reason: "",
        version: current.updatedAt,
      });
      setError("");
      setReadRecoveryFailed(false);
      setStep("edit");
    } catch (caught) {
      const code = (caught as { data?: { code?: string } }).data?.code;
      if (code === "FORBIDDEN" || code === "UNAUTHORIZED") onAccessDenied?.();
      else setError(caught instanceof Error ? caught.message : t("saveFailed"));
    } finally {
      reading.current = false;
      setRefreshing(false);
    }
  };
  return (
    <Modal
      wide
      title={`${action} · ${application.name}`}
      busy={busy}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>
            {all(
              step === "applied" || step === "queued"
                ? "common.close"
                : "common.cancel",
            )}
          </Button>
          {step === "edit" && (
            <Button
              variant="primary"
              type="submit"
              form="interview-completion-editor"
              disabled={busy || !canReview}
            >
              {t("review")}
            </Button>
          )}
          {step === "review" && (
            <>
              <Button
                disabled={busy}
                onClick={() => {
                  if (!writing.current && !busy) setStep("edit");
                }}
              >
                {t("back")}
              </Button>
              <Button
                variant="primary"
                disabled={busy || !canReview}
                onClick={() => void submit()}
              >
                {t(correction ? "confirmCorrection" : "confirmAward")}
              </Button>
            </>
          )}
          {refreshFailed && (
            <Button onClick={() => void sync()}>{t("refreshOnly")}</Button>
          )}
        </>
      }
    >
      <InterviewWorkflowStatus
        navigationBlocked={busy}
        application={
          step === "applied"
            ? {
                ...application,
                interviewCompletedAt: completionDate(),
                interviewDurationMin: Number(draft.duration),
                pendingCompletion: false,
              }
            : step === "queued"
              ? { ...application, pendingCompletion: true }
              : application
        }
      />
      {(step === "edit" || step === "review") &&
        (!readAvailable || readRecoveryFailed) && (
          <InlineNotice
            tone="warning"
            announcement="status"
            action={
              <Button disabled={busy} onClick={() => void retryReads()}>
                {t("refreshOnly")}
              </Button>
            }
          >
            {correctionT("readUnavailable")}
          </InlineNotice>
        )}
      {!evidenceAvailable && (step === "edit" || step === "review") && (
        <InlineNotice
          tone="warning"
          announcement="status"
          action={
            !error ? (
              <Button disabled={busy} onClick={() => void reloadEvidence()}>
                {t("reloadEvidence")}
              </Button>
            ) : undefined
          }
        >
          {correctionT("missingEvidence")}
        </InlineNotice>
      )}
      {step === "edit" && (
        <form
          ref={editor}
          id="interview-completion-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !canReview) return;
            setError("");
            try {
              const date = completionDate();
              if (
                date > new Date() ||
                draft.attended.length === 0 ||
                new Set(draft.attended).size !== draft.attended.length ||
                draft.attended.some(
                  (id) => !participants.some((person) => person.tutorId === id),
                ) ||
                !draft.reason.trim() ||
                draft.reason.trim().length > 1000 ||
                !Number.isInteger(Number(draft.duration)) ||
                Number(draft.duration) < 1 ||
                Number(draft.duration) > 480
              )
                throw new Error(t("invalidEvidence"));
              setStep("review");
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : t("invalidEvidence"),
              );
            }
          }}
        >
          <FormSection title={t("evidence")} busy={busy}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="label">
                  {all("workflows.interviewComplete")}
                </span>
                <input
                  data-dialog-autofocus
                  required
                  type="datetime-local"
                  className="input w-full"
                  value={draft.date}
                  onChange={(event) => update({ date: event.target.value })}
                />
              </label>
              <label>
                <span className="label">{all("workflows.duration")}</span>
                <input
                  required
                  type="number"
                  min={1}
                  max={480}
                  step={1}
                  className="input w-full"
                  value={draft.duration}
                  onChange={(event) => update({ duration: event.target.value })}
                />
              </label>
            </div>
            {correction && (
              <InlineNotice>
                <p>{correctionT("historyHelp")}</p>
                <p className="mt-1">
                  {correctionT("decisionPanel", {
                    names:
                      evidence.interviewers
                        .map((person) => person.tutor.englishName)
                        .join(", ") || all("workflows.unassignedPanel"),
                  })}
                </p>
              </InlineNotice>
            )}
            <fieldset>
              <legend className="label">
                {correction
                  ? correctionT("participants")
                  : all("workflows.attended")}
              </legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {participants.map((panelist) => (
                  <div
                    key={panelist.tutorId}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <label className="flex min-h-11 items-center gap-2 lg:min-h-8">
                      <input
                        type="checkbox"
                        checked={draft.attended.includes(panelist.tutorId)}
                        onChange={(event) =>
                          update({
                            attended: event.target.checked
                              ? [...draft.attended, panelist.tutorId]
                              : draft.attended.filter(
                                  (id) => id !== panelist.tutorId,
                                ),
                          })
                        }
                      />
                      {panelist.tutor.englishName}
                    </label>
                    {correction && !panelist.currentPanel && (
                      <span className="badge-slate">
                        {correctionT("formerPanelist")}
                      </span>
                    )}
                    {panelist.tutor.status && (
                      <span className="badge-slate">
                        {all(`admin.tutorStatus.${panelist.tutor.status}`)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="label">{t("reason")}</span>
              <textarea
                required
                maxLength={1000}
                className="textarea w-full"
                value={draft.reason}
                onChange={(event) => update({ reason: event.target.value })}
              />
            </label>
          </FormSection>
        </form>
      )}
      {step === "review" && (
        <div className="space-y-3">
          <h3 ref={reviewHeading} tabIndex={-1} className="font-semibold">
            {t("review")}
          </h3>
          <p>
            {t("reviewDate", {
              date: format.dateTime(completionDate(), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
              minutes: Number(draft.duration),
            })}
          </p>
          <p className="break-words whitespace-pre-wrap">{draft.reason}</p>
          {correction && (
            <InlineNotice tone="warning">
              <p>{t("replacement")}</p>
              <p className="mt-1">{correctionT("historyHelp")}</p>
            </InlineNotice>
          )}
          <ul className="space-y-2">
            {participants
              .filter(
                (p) =>
                  draft.attended.includes(p.tutorId) ||
                  (correction && (p.attended || p.creditHours !== 0)),
              )
              .map((panelist) => {
                const before = panelist.creditHours;
                const after = draft.attended.includes(panelist.tutorId)
                  ? hours
                  : 0;
                return (
                  <li
                    className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2"
                    key={panelist.tutorId}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{panelist.tutor.englishName}</span>
                      {correction && !panelist.currentPanel && (
                        <span className="badge-slate">
                          {correctionT("formerPanelist")}
                        </span>
                      )}
                      {panelist.tutor.status && (
                        <span className="badge-slate">
                          {all(`admin.tutorStatus.${panelist.tutor.status}`)}
                        </span>
                      )}
                    </span>
                    <span>
                      {correction
                        ? t("change", {
                            before: number(before),
                            after: number(after),
                            delta: number(after - before),
                          })
                        : t("credit", { hours: number(after) })}
                    </span>
                  </li>
                );
              })}
          </ul>
          <p className="font-semibold">
            {correction
              ? correctionT("totalChange", {
                  before: number(beforeTotal),
                  after: number(afterTotal),
                  delta: number(afterTotal - beforeTotal),
                })
              : t("total", { hours: number(afterTotal) })}
          </p>
          <p className="muted text-sm">
            {t(correction ? "correctionApproval" : "initialApproval")}
          </p>
        </div>
      )}
      {step === "applied" && (
        <InlineNotice tone="success" announcement="status">
          {t("awarded")}
        </InlineNotice>
      )}
      {step === "queued" && (
        <InlineNotice tone="warning" announcement="status">
          {all("approvals.queuedBody")}
        </InlineNotice>
      )}
      {refreshFailed && (
        <InlineNotice tone="warning" announcement="status">
          {t(step === "queued" ? "queuedRefreshFailed" : "refreshFailed")}
        </InlineNotice>
      )}
      {error && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button disabled={busy} onClick={() => void reloadEvidence()}>
              {t("reloadEvidence")}
            </Button>
          }
        >
          {error}
        </InlineNotice>
      )}
    </Modal>
  );
}
