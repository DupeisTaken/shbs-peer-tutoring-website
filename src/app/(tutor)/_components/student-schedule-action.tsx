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
  const format = useFormatter();
  // ISO weekdays are recurring evidence, not dates in the viewer's time zone.
  const locale = useLocale();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
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
            setOpen(true);
          }}
        >
          {t("scheduleReject")}
        </button>
      ) : null}
      {open && (
        <TimedActionDialog
          action="SCHEDULE"
          target={`${row.pairingId}:${row.tuteeId}`}
          title={`${t("scheduleReject")}${name ? `: ${name}` : ""}`}
          message={t("scheduleConsequences")}
          busy={busy}
          error={request.error?.message}
          canConfirm={eligible && !busy && !!reason.trim()}
          onCancel={() => setOpen(false)}
          onConfirm={(ticket) => {
            // A retained review must honor current read/assignment eligibility.
            if (!eligible || busy || !reason.trim()) return;
            // Return the write promise so an identical rejection releases the
            // timed dialog's admission guard without discarding this draft.
            return request.mutateAsync({
              tuteeId: row.tuteeId,
              pairingId: row.pairingId,
              reason,
              ticket,
            });
          }}
        >
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
