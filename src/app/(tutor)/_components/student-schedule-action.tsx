"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";
import { DAY_NAMES, minToHm } from "~/lib/time";
type Row = RouterOutputs["studentWorkflow"]["tutorRoster"][number];
export function StudentScheduleAction({
  row,
  active = true,
  name = "",
}: {
  row: Row;
  active?: boolean;
  name?: string;
}) {
  const t = useTranslations("workflow");
  const tasks = useTranslations("tutor.tasks");
  const format = useFormatter();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const request = api.studentWorkflow.rejectSchedule.useMutation({
    onSuccess: async () => {
      setOpen(false);
      setReason("");
      await utils.studentWorkflow.tutorRoster.invalidate();
    },
  });
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
        {t("availability")}:{" "}
        {row.slots
          .map(
            (s) =>
              `${DAY_NAMES[s.dayOfWeek]} ${minToHm(s.startMin)}–${minToHm(s.endMin)}`,
          )
          .join(", ")}
      </p>
      {row.pending ? (
        <span className="badge-amber">{t("needsReview")}</span>
      ) : active ? (
        <button
          className="link inline-flex min-h-11 items-center text-xs lg:min-h-7"
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
          busy={request.isPending}
          error={request.error?.message}
          canConfirm={!!reason.trim()}
          onCancel={() => setOpen(false)}
          onConfirm={(ticket) =>
            request.mutate({
              tuteeId: row.tuteeId,
              pairingId: row.pairingId,
              reason,
              ticket,
            })
          }
        >
          <label className="block text-sm">
            {t("reason")}
            <textarea
              className="input mt-2 w-full"
              rows={3}
              maxLength={2000}
              value={reason}
              disabled={request.isPending}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </TimedActionDialog>
      )}
    </div>
  );
}
