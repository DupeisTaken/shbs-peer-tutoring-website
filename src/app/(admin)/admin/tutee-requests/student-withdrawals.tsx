"use client";
import {
  ParticipantName,
  participantNameLabel,
} from "~/app/_components/participant-name";
import { invalidateTuteeViews } from "~/lib/tutee-cache";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";
import { Button } from "~/app/_components/ui/button";
import { FormActions, StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

export type WithdrawalViewReadState = { ready: boolean; denied: boolean };

/** Both intake sources share the existing timed staff-review mutation and approval policy. */
export function StudentWithdrawals({
  onViewReadState,
}: { onViewReadState?: (state: WithdrawalViewReadState) => void } = {}) {
  const t = useTranslations("admin.tuteeRequests");
  const names = useTranslations("participantNames");
  const workflow = useTranslations("workflow");
  const recovery = useTranslations("managementRecovery");
  const format = useFormatter();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const rows = api.studentWorkflow.adminRequests.useQuery(undefined, {
    enabled: !denied,
  });
  const legacy = api.studentWorkflow.legacyReviews.useQuery(undefined, {
    enabled: !denied,
  });
  const accessDenied = [rows.error, legacy.error].some(
    (error) =>
      error?.data?.code === "FORBIDDEN" || error?.data?.code === "UNAUTHORIZED",
  );
  // These staff-only reads must never borrow permission from the viewer-safe
  // parent summary. A denial closes this private section until both reads recover.
  useEffect(() => {
    if (accessDenied) {
      setDenied(true);
      queryClient.removeQueries({
        queryKey: getQueryKey(
          api.studentWorkflow.adminRequests,
          undefined,
          "query",
        ),
      });
      queryClient.removeQueries({
        queryKey: getQueryKey(
          api.studentWorkflow.legacyReviews,
          undefined,
          "query",
        ),
      });
    } else if (
      rows.isSuccess &&
      legacy.isSuccess &&
      !rows.isFetching &&
      !legacy.isFetching
    )
      setDenied(false);
  }, [
    accessDenied,
    rows.isSuccess,
    legacy.isSuccess,
    rows.isFetching,
    legacy.isFetching,
    queryClient,
  ]);
  const hasData = rows.data !== undefined && legacy.data !== undefined;
  const readError = !!rows.error || !!legacy.error;
  // Report only read lifecycle booleans, never the review records or drafts.
  useEffect(() => {
    onViewReadState?.({
      ready: hasData && !denied && !accessDenied,
      denied: denied || accessDenied,
    });
  }, [onViewReadState, hasData, denied, accessDenied]);
  const readBlocked = !hasData || readError;
  const section = t("studentHeading");
  const retry = () => {
    if (denied || rows.error || rows.data === undefined) void rows.refetch();
    if (denied || legacy.error || legacy.data === undefined)
      void legacy.refetch();
  };
  const readFeedback = (
    <QueryFeedback
      hasData={hasData}
      loading={!hasData && !readError}
      error={readError}
      retrying={rows.isFetching || legacy.isFetching}
      loadingTitle={recovery("loading", { section })}
      errorTitle={recovery(hasData ? "refreshFailed" : "loadFailed", {
        section,
      })}
      retryLabel={recovery("retry", { section })}
      onRetry={retry}
    />
  );
  const [decision, setDecision] = useState<{
    id: string;
    name: string;
    approve: boolean;
  } | null>(null);
  const resolve = api.studentWorkflow.resolveReview.useMutation({
    onSuccess: async () => {
      setDecision(null);
      await Promise.all([
        utils.studentWorkflow.adminRequests.invalidate(),
        utils.studentWorkflow.legacyReviews.invalidate(),
        utils.admin.tuteeRemovalRequests.invalidate(),
        invalidateTuteeViews(utils),
      ]);
    },
  });
  const reviews = [
    ...(rows.data ?? []).flatMap((row) =>
      row.reviews
        .filter((r) => r.kind === "STUDENT_ABORT")
        .map((review) => ({ ...review, name: row.name })),
    ),
    ...(legacy.data ?? []).filter((r) => r.kind === "STUDENT_ABORT"),
  ].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const pending = reviews.filter((r) => r.state === "PENDING");
  const completed = reviews.filter((r) => r.state !== "PENDING");
  if (denied || accessDenied)
    return (
      <section className="card space-y-4 p-5">
        <h2 className="section-title">{section}</h2>
        <StatePanel
          kind="denied"
          title={recovery("denied", { section })}
          action={
            <Button
              size="compact"
              disabled={rows.isFetching || legacy.isFetching}
              onClick={retry}
            >
              {recovery("retry", { section })}
            </Button>
          }
        />
      </section>
    );
  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="section-title">
          {t("studentHeading")}{" "}
          {hasData && (
            <span className="badge-amber ml-1">{pending.length}</span>
          )}
        </h2>
        <p className="muted mt-1 text-sm">{t("studentHelp")}</p>
      </div>
      {readFeedback}
      {(rows.data !== undefined || legacy.data !== undefined) && (
        <>
          {pending.map((review) => (
            <article
              key={review.id}
              className="space-y-3 rounded-lg border border-slate-200 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  <ParticipantName name={review.name} />
                </h3>
                <span className="badge-amber">{workflow("needsReview")}</span>
              </div>
              <p className="muted text-sm">
                {t("studentSource")} · {t("wholeProgram")} ·{" "}
                {t("effectiveOnApproval")}
              </p>
              <p className="muted text-xs">
                {t("submittedOn", {
                  date: format.dateTime(new Date(review.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })}
              </p>
              <p className="text-sm whitespace-pre-wrap">{review.reason}</p>
              {/* The trailing decision group shares size; timed review stays feature-owned. */}
              <div className="[&>div]:justify-end">
                <FormActions>
                  <Button
                    variant="danger"
                    size="compact"
                    disabled={readBlocked || resolve.isPending}
                    onClick={() =>
                      setDecision({
                        id: review.id,
                        name: review.name,
                        approve: true,
                      })
                    }
                  >
                    {workflow("approve")}
                  </Button>
                  <Button
                    size="compact"
                    disabled={readBlocked || resolve.isPending}
                    onClick={() =>
                      setDecision({
                        id: review.id,
                        name: review.name,
                        approve: false,
                      })
                    }
                  >
                    {workflow("deny")}
                  </Button>
                </FormActions>
              </div>
            </article>
          ))}
          {hasData && !readError && !pending.length && (
            <p className="muted">{t("studentEmpty")}</p>
          )}
          {!!completed.length && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                {t("studentHistory")} ({completed.length})
              </summary>
              <div className="mt-3 space-y-2">
                {completed.map((review) => (
                  <article
                    key={review.id}
                    className="rounded-lg bg-slate-50 p-3 text-sm"
                  >
                    <span className="font-medium">{review.name}</span> ·{" "}
                    {workflow(`reviewState.${review.state}`)}
                    <p className="muted mt-1">
                      {t("studentSource")} · {t("wholeProgram")}
                      {review.resolvedAt
                        ? ` · ${format.dateTime(new Date(review.resolvedAt), { dateStyle: "medium", timeStyle: "short" })}`
                        : ""}
                    </p>
                  </article>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      {decision && (
        <TimedActionDialog
          action={decision.approve ? "APPROVE" : "DENY"}
          target={decision.id}
          title={workflow(decision.approve ? "approve" : "deny")}
          message={`${participantNameLabel(decision.name, undefined, names("unnamed"))}\n\n${workflow(decision.approve ? "approveAbortConsequences" : "denyConsequences")}`}
          busy={resolve.isPending}
          canConfirm={!readBlocked}
          error={resolve.error?.message}
          onCancel={() => setDecision(null)}
          onConfirm={(ticket) => {
            if (readBlocked || resolve.isPending) return;
            return resolve.mutateAsync({
              id: decision.id,
              approve: decision.approve,
              ticket,
            });
          }}
        >
          {readFeedback}
        </TimedActionDialog>
      )}
    </section>
  );
}
