"use client";
import { useSessionPageScroll } from "~/app/_components/session-view-state";
import {
  ParticipantName,
  participantNameLabel,
} from "~/app/_components/participant-name";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { AcademicError } from "~/app/_components/academic-error";
import { useReadOnly } from "~/app/_components/read-only";
import { Button } from "~/app/_components/ui/button";
import { StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";

/**
 * Admin review of tutor lifecycle requests (opt-out / reentry). Opt-out approvals are gated until
 * the one-week cooldown elapses; on approval a follow-up prompt offers to re-queue the tutor's
 * tutees onto the signup page. VIEWER is read-only.
 */
export default function TutorRequestsPage() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const requests = api.admin.tutorRequests.useQuery(undefined, {
    enabled: !denied,
  });
  const accessDenied =
    requests.error?.data?.code === "FORBIDDEN" ||
    requests.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (accessDenied) {
      setDenied(true);
      queryClient.removeQueries({
        queryKey: getQueryKey(api.admin.tutorRequests, undefined, "query"),
      });
    } else if (requests.isSuccess && !requests.isFetching) setDenied(false);
  }, [accessDenied, requests.isSuccess, requests.isFetching, queryClient]);
  const readBlocked = requests.data === undefined || !!requests.error;
  const section = t("admin.tutorRequests.title");
  useSessionPageScroll({
    id: "tutor-requests-v1",
    ready: requests.data !== undefined && !denied && !accessDenied,
    enabled: !denied && !accessDenied,
  });
  const retry = () => {
    void requests.refetch();
  };

  // After an opt-out approval, offer to re-queue that tutor's tutees.
  const [requeue, setRequeue] = useState<{
    tutorId: string;
    name: string;
    count: number;
  } | null>(null);

  const invalidate = () => utils.admin.tutorRequests.invalidate();
  const decide = api.admin.decideTutorRequest.useMutation({
    onSuccess: invalidate,
  });
  const requeueTutees = api.admin.requeueTutorTutees.useMutation({
    onSuccess: () => setRequeue(null),
  });

  const onDecide = (
    req: {
      id: string;
      kind: string;
      tutor: { id: string; englishName: string };
      affectedTutees: number;
    },
    approve: boolean,
  ) => {
    if (readBlocked || readOnly || decide.isPending) return;
    decide.mutate(
      { requestId: req.id, approve },
      {
        onSuccess: () => {
          if (approve && req.kind === "OPT_OUT" && req.affectedTutees > 0) {
            setRequeue({
              tutorId: req.tutor.id,
              name: req.tutor.englishName,
              count: req.affectedTutees,
            });
          }
        },
      },
    );
  };

  const list = requests.data ?? [];
  if (denied || accessDenied)
    return (
      <div className="space-y-6">
        <h1 className="page-title">{section}</h1>
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", { section })}
          action={
            <Button
              size="compact"
              disabled={requests.isFetching}
              onClick={retry}
            >
              {t("managementRecovery.retry", { section })}
            </Button>
          }
        />
      </div>
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.tutorRequests.title")}</h1>
        <p className="muted mt-1">{t("admin.tutorRequests.help")}</p>
      </div>

      <QueryFeedback
        hasData={requests.data !== undefined}
        loading={requests.data === undefined && !requests.error}
        error={!!requests.error}
        retrying={requests.isFetching}
        loadingTitle={t("managementRecovery.loading", { section })}
        errorTitle={t(
          requests.data === undefined
            ? "managementRecovery.loadFailed"
            : "managementRecovery.refreshFailed",
          { section },
        )}
        retryLabel={t("managementRecovery.retry", { section })}
        onRetry={retry}
      />

      {requeue && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            {t("admin.tutorRequests.requeuePrompt", {
              name: participantNameLabel(
                requeue.name,
                undefined,
                t("participantNames.unnamed"),
              ),
              count: requeue.count,
            })}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              className="btn-primary btn-sm"
              onClick={() => requeueTutees.mutate({ tutorId: requeue.tutorId })}
              disabled={requeueTutees.isPending}
            >
              {t("admin.tutorRequests.requeueConfirm")}
            </button>
            <button
              className="btn-secondary btn-sm"
              onClick={() => setRequeue(null)}
            >
              {t("admin.tutorRequests.requeueDismiss")}
            </button>
          </div>
        </div>
      )}

      {decide.error && (
        <p role="alert" className="text-sm text-red-600">
          <AcademicError message={decide.error.message} />
        </p>
      )}

      <div className="space-y-3">
        {list.map((req) => (
          <div
            key={req.id}
            className="card flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div className="min-w-0">
              <p className="font-medium text-slate-900">
                <ParticipantName name={req.tutor.englishName} />{" "}
                <span
                  className={
                    req.kind === "OPT_OUT" ? "badge-amber" : "badge-green"
                  }
                >
                  {t(`admin.tutorRequests.kind.${req.kind}`)}
                </span>
              </p>
              {req.reason && <p className="muted mt-1 text-sm">{req.reason}</p>}
              <p className="muted mt-1 text-xs">
                {req.kind === "OPT_OUT" && req.eligibleAt
                  ? req.approvable
                    ? t("admin.tutorRequests.cooldownDone")
                    : t("admin.tutorRequests.cooldownUntil", {
                        date: programFormat.dateTime(new Date(req.eligibleAt), {
                          dateStyle: "medium",
                        }),
                      })
                  : null}
                {req.kind === "OPT_OUT" && req.affectedTutees > 0
                  ? ` · ${t("admin.tutorRequests.affected", { count: req.affectedTutees })}`
                  : ""}
              </p>
            </div>
            {!readOnly && (
              <div className="flex gap-2">
                <button
                  className="btn-primary btn-sm"
                  disabled={readBlocked || !req.approvable || decide.isPending}
                  title={
                    !req.approvable
                      ? t("admin.tutorRequests.notYet")
                      : undefined
                  }
                  onClick={() => onDecide(req, true)}
                >
                  {t("admin.tutorRequests.approve")}
                </button>
                <button
                  className="btn-secondary btn-sm"
                  disabled={readBlocked || decide.isPending}
                  onClick={() => onDecide(req, false)}
                >
                  {t("admin.tutorRequests.deny")}
                </button>
              </div>
            )}
          </div>
        ))}
        {!requests.error && requests.data?.length === 0 && (
          <p className="muted">{t("admin.tutorRequests.empty")}</p>
        )}
      </div>
    </div>
  );
}
