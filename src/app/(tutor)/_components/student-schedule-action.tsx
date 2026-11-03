"use client";
import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";
import { formatWeekday, minToHm } from "~/lib/time";
import { useDialogPending } from "~/app/_components/ui/modal";
type Row = RouterOutputs["studentWorkflow"]["tutorRoster"][number];
export function StudentScheduleAction({
  row,
  active = true,
  name = "",
  draft,
}: {
  row: Row;
  active?: boolean;
  name?: string;
  /** The assignment reader retains this draft when its dialog closes. */
  draft?: { value: string; onChange: (value: string) => void };
}) {
  const t = useTranslations("workflow");
  const tasks = useTranslations("tutor.tasks");
  const sourcesText = useTranslations("studentScheduleRequest");
  const format = useFormatter();
  // ISO weekdays are recurring evidence, not dates in the viewer's time zone.
  const locale = useLocale();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [selectedSurveyId, setSelectedSurveyId] = useState("");
  const sources = api.studentWorkflow.scheduleRequestSources.useQuery(
    { pairingId: row.pairingId, tuteeId: row.tuteeId },
    { enabled: open && active, retry: false, staleTime: 0, refetchOnWindowFocus: true },
  );
  const availableSources = sources.data?.sources ?? [];
  const selectedSource = availableSources.find((source) => source.surveyId === selectedSurveyId) ??
    (!selectedSurveyId && availableSources.length === 1 ? availableSources[0] : undefined);
  const sourceReady = sources.isSuccess && !sources.isFetching && !sources.error &&
    (selectedSource ? !selectedSource.pending : sources.data?.legacy === true);
  const [localReason, setLocalReason] = useState("");
  const reason = draft?.value ?? localReason;
  const setReason = draft?.onChange ?? setLocalReason;
  const request = api.studentWorkflow.rejectSchedule.useMutation({
    onSuccess: async () => {
      setOpen(false);
      setReason("");
      await utils.studentWorkflow.tutorRoster.invalidate();
    },
  });
  const busy = useDialogPending(request.isPending);
  const pairings = useTranslations("tutor.pairings");
  const eligible = active && !row.pending;
  return (
    <div className="my-2 w-full space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap gap-2">
        {!row.verified && (
          <span className="badge-amber">{t("unverified")}</span>
        )}
        {row.editedAt && <span className="badge-amber">{t("edited")}</span>}
      </div>
      {!row.verified && row.verificationDueAt && (
        <p className="text-sm font-medium text-amber-800">
          {tasks("verificationDeadline", {
            date: format.dateTime(row.verificationDueAt, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </p>
      )}
      <p className="muted text-xs">
        {row.slots.length
          ? `${t("availability")}: ${row.slots
              .map(
                (s) =>
                  `${formatWeekday(s.dayOfWeek, locale)} ${minToHm(s.startMin)}–${minToHm(s.endMin)}`,
              )
              .join(", ")}`
          : pairings("availabilityMissing")}
      </p>
      {row.pending ? (
        <span className="badge-amber">{t("needsReview")}</span>
      ) : active ? (
        <button
          className="link inline-flex min-h-11 items-center text-xs lg:min-h-7"
          disabled={busy}
          onClick={() => {
            setSelectedSurveyId("");
            setOpen(true);
          }}
        >
          {t("scheduleReject")}
        </button>
      ) : null}
      {open && (
        <TimedActionDialog
          action="SCHEDULE"
          target={`${row.pairingId}:${row.tuteeId}${selectedSource ? `:${selectedSource.surveyId}` : ""}`}
          title={`${t("scheduleReject")}${name ? `: ${name}` : ""}`}
          message={sourcesText("consequences")}
          busy={busy}
          error={request.error?.message}
          canConfirm={eligible && sourceReady && !busy && !!reason.trim()}
          onCancel={() => setOpen(false)}
          onConfirm={(ticket) => {
            // A retained review must honor current read/assignment eligibility.
            if (!eligible || !sourceReady || busy || !reason.trim()) return;
            // Return the write promise so an identical rejection releases the
            // timed dialog's admission guard without discarding this draft.
            return request.mutateAsync({
              tuteeId: row.tuteeId,
              pairingId: row.pairingId,
              ...(selectedSource ? { surveyId: selectedSource.surveyId } : {}),
              reason,
              ticket,
            });
          }}
        >
          {sources.isFetching ? <p role="status">{sourcesText("loading")}</p> : sources.error ? (
            <div role="alert"><p>{sourcesText("readFailed")}</p><button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => void sources.refetch()}>{sourcesText("retry")}</button></div>
          ) : availableSources.length ? (
            <fieldset disabled={busy} className="space-y-2">
              <legend className="font-medium">{sourcesText("choose")}</legend>
              <p className="text-sm">{sourcesText("exactOnly")}</p>
              {availableSources.map((source) => <label key={source.surveyId} className="flex min-h-11 items-start gap-2 rounded border p-2">
                <input type="radio" name={`schedule-source-${row.pairingId}-${row.tuteeId}`} value={source.surveyId} checked={selectedSource?.surveyId === source.surveyId} disabled={busy || source.pending} onChange={() => setSelectedSurveyId(source.surveyId)} className="mt-1" />
                <span>{source.name} · {source.termName} · {format.dateTime(source.submittedAt, { dateStyle: "medium", timeStyle: "short" })}<span className="block break-all text-xs">{sourcesText("source", { id: source.sourceTuteeId, request: source.surveyId })}</span>{source.pending && <span className="badge-amber">{t("needsReview")}</span>}</span>
              </label>)}
            </fieldset>
          ) : sources.isSuccess && !sources.data?.legacy ? <p role="alert">{sourcesText("none")}</p> : null}
          <label className="block text-sm">
            {t("reason")}
            <textarea
              className="input mt-2 w-full"
              rows={3}
              maxLength={2000}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </TimedActionDialog>
      )}
    </div>
  );
}
