"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";

type Enrollment =
  RouterOutputs["studentWorkflow"]["legacyParticipation"][number];
/** Manual intake has no survey, but explicit account ownership still enables self service. */
export function LegacyParticipation() {
  const query = api.studentWorkflow.legacyParticipation.useQuery();
  if (query.error) return <p role="alert">{query.error.message}</p>;
  return (
    <>
      {query.data
        ?.filter((row) => row.status !== "INACTIVE" || row.reviews.length > 0)
        .map((row) => (
          <Participation key={row.id} row={row} />
        ))}
    </>
  );
}
function Participation({ row }: { row: Enrollment }) {
  const t = useTranslations("workflow");
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const mutation = api.studentWorkflow.applyLegacyWithdrawal.useMutation({
    onSuccess: async () => {
      setOpen(false);
      await utils.studentWorkflow.legacyParticipation.invalidate();
    },
  });
  const pending = row.reviews.some((r) => r.state === "PENDING");
  return (
    <section className="card space-y-3 p-6">
      <h2 className="section-title">
        {t("participation")} · {row.englishName}
      </h2>
      <p className="muted text-sm">{t("abortHelp")}</p>
      {pending ? (
        <p role="status" className="badge-amber">
          {t("abortPending")}
        </p>
      ) : row.status !== "INACTIVE" ? (
        <button
          className="btn-danger btn-sm"
          onClick={() => {
            setReason("");
            setOpen(true);
          }}
        >
          {t("applyAbort")}
        </button>
      ) : (
        <p>{t("abortFinal")}</p>
      )}
      {row.reviews
        .filter((r) => r.state !== "PENDING")
        .map((r) => (
          <p key={r.id} className="muted text-sm">
            {t("applyAbort")} · {t(`reviewState.${r.state}`)}
          </p>
        ))}
      {open && (
        <TimedActionDialog
          action="ABORT"
          target={`legacy:${row.id}`}
          title={t("applyAbort")}
          message={t("abortConsequences")}
          busy={mutation.isPending}
          error={mutation.error?.message}
          canConfirm={!!reason.trim()}
          onCancel={() => setOpen(false)}
          onConfirm={(ticket) =>
            mutation.mutate({ tuteeId: row.id, reason, ticket })
          }
        >
          <label className="block text-sm">
            {t("reason")}
            <textarea
              className="input mt-2 w-full"
              rows={3}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </TimedActionDialog>
      )}
    </section>
  );
}
