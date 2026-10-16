"use client";
import { useSessionPageScroll } from "~/app/_components/session-view-state";
import { ParticipantName } from "~/app/_components/participant-name";
import { InlineNotice, StatePanel } from "~/app/_components/ui/patterns";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { Button } from "~/app/_components/ui/button";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { invalidateTuteeViews } from "~/lib/tutee-cache";

import {
  StudentWithdrawals,
  type WithdrawalViewReadState,
} from "./student-withdrawals";
import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";

/**
 * Student self-service withdrawals require staff review. Tutor-relayed withdrawals retain
 * their recall window; finalized discipline/relay removals retain reinstatement controls.
 * VIEWER can inspect existing removal summaries but cannot read student-review free text.
 */
export default function TuteeRequestsPage() {
  const t = useTranslations();
  const format = useFormatter();
  const readOnly = useReadOnly();
  const [withdrawalRead, setWithdrawalRead] = useState<WithdrawalViewReadState>(
    { ready: false, denied: false },
  );
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const data = api.admin.tuteeRemovalRequests.useQuery(undefined, {
    enabled: !denied,
  });
  const accessDenied =
    data.error?.data?.code === "FORBIDDEN" ||
    data.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (accessDenied) {
      setDenied(true);
      queryClient.removeQueries({
        queryKey: getQueryKey(
          api.admin.tuteeRemovalRequests,
          undefined,
          "query",
        ),
      });
    } else if (data.isSuccess && !data.isFetching) setDenied(false);
  }, [accessDenied, data.isSuccess, data.isFetching, queryClient]);
  // The parent owns page scroll once. Staff-only child feeds report readiness
  // without lending their permissions to this viewer-safe summary.
  useSessionPageScroll({
    id: "tutee-requests-v1",
    ready:
      data.data !== undefined &&
      !denied &&
      !accessDenied &&
      (readOnly || withdrawalRead.ready),
    enabled: !denied && !accessDenied && (readOnly || !withdrawalRead.denied),
  });
  const section = t("admin.tuteeRequests.title");
  const retry = () => {
    void data.refetch();
  };
  const readBlocked = data.data === undefined || !!data.error;

  const invalidate = () =>
    Promise.all([
      utils.admin.tuteeRemovalRequests.invalidate(),
      invalidateTuteeViews(utils),
    ]);
  const cancel = api.admin.cancelTuteeOptOut.useMutation({
    onSuccess: invalidate,
  });
  const reinstate = api.admin.reinstateTutee.useMutation({
    onSuccess: invalidate,
  });

  const pending = data.data?.pendingOptOuts ?? [];
  const finalized = data.data?.finalized ?? [];

  const err =
    (cancel.error?.data?.approvalId ? null : cancel.error) ??
    (reinstate.error?.data?.approvalId ? null : reinstate.error);
  if (denied || accessDenied)
    return (
      <div className="space-y-6">
        <h1 className="page-title">{section}</h1>
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", { section })}
          action={
            <Button size="compact" disabled={data.isFetching} onClick={retry}>
              {t("managementRecovery.retry", { section })}
            </Button>
          }
        />
      </div>
    );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">{t("admin.tuteeRequests.title")}</h1>
        <p className="muted mt-1">{t("admin.tuteeRequests.help")}</p>
        <p className="muted mt-2 text-sm">{t("approvals.reversalHelp")}</p>
      </div>

      <QueryFeedback
        hasData={data.data !== undefined}
        loading={data.data === undefined && !data.error}
        error={!!data.error}
        retrying={data.isFetching}
        loadingTitle={t("managementRecovery.loading", { section })}
        errorTitle={t(
          data.data === undefined
            ? "managementRecovery.loadFailed"
            : "managementRecovery.refreshFailed",
          { section },
        )}
        retryLabel={t("managementRecovery.retry", { section })}
        onRetry={retry}
      />

      {(cancel.error?.data?.approvalId ??
        reinstate.error?.data?.approvalId) && (
        <InlineNotice tone="warning" announcement="status">
          {t("approvals.queuedBody")}
        </InlineNotice>
      )}
      {err && <p className="text-sm text-red-600">{err.message}</p>}

      {!readOnly && <StudentWithdrawals onViewReadState={setWithdrawalRead} />}

      {data.data && (
        <>
          {/* Tutor-relayed withdrawals retain their seven-day recall policy. */}
          <section className="card p-5">
            <h2 className="section-title">
              {t("admin.tuteeRequests.pendingHeading")}{" "}
              <span className="badge-amber ml-1">{pending.length}</span>
            </h2>
            <p className="muted mt-1 text-xs">
              {t("admin.tuteeRequests.pendingHelp")}
            </p>
            <div className="mt-3 space-y-3">
              {pending.map((req) => (
                <div
                  key={req.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      <ParticipantName name={req.tutee.englishName} />
                    </p>
                    <p className="muted mt-1 text-xs">
                      {t("admin.tuteeRequests.relayedBy", {
                        tutor: req.tutorName ?? "—",
                        subject: req.subject ?? "—",
                      })}
                      {req.eligibleAt
                        ? ` · ${t("admin.tuteeRequests.autoApprovesOn", {
                            date: format.dateTime(new Date(req.eligibleAt), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }),
                          })}`
                        : ""}
                    </p>
                    <p className="muted mt-1 text-xs">
                      {t("admin.tuteeRequests.wholeProgram")} ·{" "}
                      {t("admin.tuteeRequests.recallWindow")}
                    </p>
                    {req.reason && (
                      <p className="muted mt-1 text-sm">{req.reason}</p>
                    )}
                  </div>
                  {!readOnly && (
                    <button
                      className="btn-secondary btn-sm"
                      disabled={readBlocked || cancel.isPending}
                      onClick={() => {
                        if (!readBlocked && !cancel.isPending)
                          cancel.mutate({ requestId: req.id });
                      }}
                    >
                      {t("admin.tuteeRequests.cancel")}
                    </button>
                  )}
                </div>
              ))}
              {pending.length === 0 && (
                <p className="muted">{t("admin.tuteeRequests.pendingEmpty")}</p>
              )}
            </div>
          </section>

          {/* Removed & opted-out (finalized) */}
          <section className="card p-5">
            <h2 className="section-title">
              {t("admin.tuteeRequests.removedHeading")}{" "}
              <span className="badge-slate ml-1">{finalized.length}</span>
            </h2>
            <p className="muted mt-1 text-xs">
              {t("admin.tuteeRequests.removedHelp")}
            </p>
            <div className="mt-3 space-y-2">
              {finalized.map((req) => (
                <div
                  key={req.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {req.tutee.englishName}{" "}
                      <span
                        className={
                          req.kind === "PUNISHMENT"
                            ? "badge-red"
                            : "badge-amber"
                        }
                      >
                        {t(`admin.tuteeRequests.kind.${req.kind}`)}
                      </span>
                    </p>
                    <p className="muted mt-1 text-xs">
                      {req.kind === "PUNISHMENT"
                        ? t("admin.tuteeRequests.removedDiscipline")
                        : t("admin.tuteeRequests.removedOptOut", {
                            tutor: req.tutorName ?? "—",
                          })}
                      {req.resolvedAt
                        ? ` · ${format.dateTime(new Date(req.resolvedAt), { dateStyle: "medium", timeStyle: "short" })}`
                        : ""}
                      {req.period ? ` · ${req.period}` : ""}
                    </p>
                  </div>
                  {!readOnly && (
                    <button
                      className="btn-secondary btn-sm"
                      disabled={readBlocked || reinstate.isPending}
                      onClick={() => {
                        if (!readBlocked && !reinstate.isPending)
                          reinstate.mutate({ requestId: req.id });
                      }}
                    >
                      {t("admin.tuteeRequests.reinstate")}
                    </button>
                  )}
                </div>
              ))}
              {finalized.length === 0 && (
                <p className="muted">{t("admin.tuteeRequests.removedEmpty")}</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
