"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";
import { Button } from "~/app/_components/ui/button";
import { StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

type Enrollment =
  RouterOutputs["studentWorkflow"]["legacyParticipation"][number];
/** Manual intake has no survey, but explicit account ownership still enables self service. */
export function LegacyParticipation() {
  const recovery = useTranslations("participantRecovery");
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const query = api.studentWorkflow.legacyParticipation.useQuery(undefined, {
    enabled: !denied,
  });
  const authorizationDenied =
    query.error?.data?.code === "FORBIDDEN" ||
    query.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (!authorizationDenied) return;
    // A transport failure preserves drafts; an authoritative denial revokes this private cache.
    setDenied(true);
    queryClient.removeQueries({
      queryKey: getQueryKey(
        api.studentWorkflow.legacyParticipation,
        undefined,
        "query",
      ),
    });
  }, [authorizationDenied, queryClient]);
  useEffect(() => {
    if (query.isSuccess && !query.isFetching) setDenied(false);
  }, [query.isSuccess, query.isFetching]);
  const retry = () => {
    void query.refetch();
  };
  const readFeedback = (
    <QueryFeedback
      hasData={!!query.data}
      loading={!query.data && !query.error}
      error={!!query.error}
      retrying={query.isFetching}
      loadingTitle={recovery("loading")}
      errorTitle={recovery(query.data ? "refreshFailed" : "loadFailed")}
      retryLabel={recovery("retry")}
      onRetry={retry}
    />
  );
  if (denied || authorizationDenied)
    return (
      <StatePanel
        kind="denied"
        title={recovery("accessDenied")}
        action={
          <Button size="compact" disabled={query.isFetching} onClick={retry}>
            {recovery("retry")}
          </Button>
        }
      >
        {recovery("accessDeniedHelp")}
      </StatePanel>
    );
  return (
    <>
      {readFeedback}
      {query.data
        ?.filter((row) => row.status !== "INACTIVE" || row.reviews.length > 0)
        .map((row) => (
          <Participation
            key={row.id}
            row={row}
            readBlocked={!!query.error}
            readFeedback={readFeedback}
          />
        ))}
    </>
  );
}
function Participation({
  row,
  readBlocked,
  readFeedback,
}: {
  row: Enrollment;
  readBlocked: boolean;
  readFeedback: ReactNode;
}) {
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
      <p className="muted text-sm">{t("legacyWithdrawalHelp")}</p>
      {pending ? (
        <p role="status" className="badge-amber">
          {t("abortPending")}
        </p>
      ) : row.status !== "INACTIVE" ? (
        <button
          className="btn-danger btn-sm"
          disabled={readBlocked}
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
          canConfirm={!readBlocked && !!reason.trim()}
          onCancel={() => setOpen(false)}
          onConfirm={(ticket) =>
            !readBlocked && mutation.mutate({ tuteeId: row.id, reason, ticket })
          }
        >
          {readFeedback}
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
