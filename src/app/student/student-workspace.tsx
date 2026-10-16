"use client";
import { pairingScheduleText } from "~/lib/pairing-schedule";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";
import { formatWeekday, minToHm } from "~/lib/time";
import { Button } from "~/app/_components/ui/button";
import { StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { useSessionPageScroll } from "~/app/_components/session-view-state";
import { ParticipantName } from "~/app/_components/participant-name";
import { StudentSignupEditor } from "~/app/_components/student-signup-editor";

type Request = RouterOutputs["studentWorkflow"]["mine"][number];
export function StudentWorkspace({ viewScope = "" }: { viewScope?: string }) {
  const t = useTranslations("workflow");
  const appeal = useTranslations("signupAppeal");
  const recovery = useTranslations("participantRecovery");
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const query = api.studentWorkflow.mine.useQuery(undefined, {
    enabled: !denied,
  });
  const legacy = api.studentWorkflow.legacyParticipation.useQuery(undefined, {
    enabled: !denied,
  });
  const requestDenied =
    query.error?.data?.code === "FORBIDDEN" ||
    query.error?.data?.code === "UNAUTHORIZED";
  const legacyDenied =
    legacy.error?.data?.code === "FORBIDDEN" ||
    legacy.error?.data?.code === "UNAUTHORIZED";
  useSessionPageScroll({
    id: "student-requests-v1",
    scope: viewScope,
    ready: !!query.data && !!legacy.data,
    enabled: !denied && !requestDenied && !legacyDenied,
  });
  useEffect(() => {
    if (!requestDenied && !legacyDenied) return;
    setDenied(true);
    if (requestDenied)
      queryClient.removeQueries({
        queryKey: getQueryKey(api.studentWorkflow.mine, undefined, "query"),
      });
    if (legacyDenied)
      queryClient.removeQueries({
        queryKey: getQueryKey(
          api.studentWorkflow.legacyParticipation,
          undefined,
          "query",
        ),
      });
  }, [requestDenied, legacyDenied, queryClient]);
  useEffect(() => {
    if (
      query.isSuccess &&
      legacy.isSuccess &&
      !query.isFetching &&
      !legacy.isFetching
    )
      setDenied(false);
  }, [query.isSuccess, legacy.isSuccess, query.isFetching, legacy.isFetching]);
  const retry = () => {
    void query.refetch();
    void legacy.refetch();
  };
  const readBlocked =
    !!query.error || !!legacy.error || !query.data || !legacy.data;
  const readFeedback = (
    <>
      <QueryFeedback
        hasData={!!query.data}
        loading={!query.data && !query.error}
        error={!!query.error}
        retrying={query.isFetching}
        loadingTitle={recovery("loading")}
        errorTitle={recovery(query.data ? "refreshFailed" : "loadFailed")}
        retryLabel={recovery("retry")}
        onRetry={() => void query.refetch()}
      />
      <QueryFeedback
        hasData={!!legacy.data}
        loading={!legacy.data && !legacy.error}
        error={!!legacy.error}
        retrying={legacy.isFetching}
        loadingTitle={recovery("loading")}
        errorTitle={recovery(legacy.data ? "refreshFailed" : "loadFailed")}
        retryLabel={recovery("retry")}
        onRetry={() => void legacy.refetch()}
      />
    </>
  );
  if (denied || requestDenied || legacyDenied)
    return (
      <StatePanel
        kind="denied"
        title={recovery("accessDenied")}
        action={
          <Button
            size="compact"
            disabled={query.isFetching || legacy.isFetching}
            onClick={retry}
          >
            {recovery("retry")}
          </Button>
        }
      >
        {recovery("accessDeniedHelp")}
      </StatePanel>
    );
  if (!query.data) return <div className="space-y-4">{readFeedback}</div>;
  const active = query.data?.find((r) => r.state === "OPEN");
  const quarterBlocked =
    (query.data?.some((r) => r.state === "ABORTED") ?? false) ||
    (legacy.data?.some((r) =>
      r.reviews.some((review) => review.state === "APPROVED"),
    ) ??
      false);
  return (
    <div className="space-y-6">
      {readFeedback}
      <nav
        aria-label={t("navigation")}
        className="flex flex-wrap gap-4 border-b border-slate-200 pb-3 text-sm"
      >
        <a className="link" href="#current-request">
          {t("current")}
        </a>
        <a className="link" href="#request-history">
          {t("processed")}
        </a>
      </nav>
      <section id="current-request" className="space-y-4">
        <h2 className="section-title">{t("current")}</h2>
        {active ? (
          <CurrentRequest
            key={active.id}
            row={active}
            readBlocked={readBlocked}
            readFeedback={readFeedback}
          />
        ) : readBlocked ||
          legacy.data?.some((row) => row.status !== "INACTIVE") ? null : (
          <div className="card space-y-3 p-6">
            <p>{t(quarterBlocked ? "abortFinal" : "noActive")}</p>
            {!quarterBlocked && (
              <Link href="/tutee" className="btn-primary">
                {t("newRequest")}
              </Link>
            )}
          </div>
        )}
      </section>
      <section id="request-history" className="space-y-3">
        <h2 className="section-title">{t("processed")}</h2>
        {query.data
          ?.filter((r) => r.state !== "OPEN")
          .map((row) => (
            <div key={row.id} className="card p-5">
              <span className="badge-slate">
                {row.state === "INVALID_REJECTED"
                  ? appeal("rejectedTitle")
                  : t(`state.${row.state}`)}
              </span>
              <p className="mt-2 text-sm">
                {row.subjects.map((s) => s.name).join(", ")}
              </p>
              <p className="muted mt-2 text-sm">
                {row.state === "INVALID_REJECTED"
                  ? appeal("rejected")
                  : t(row.state === "ABORTED" ? "abortFinal" : "closedFinal")}
              </p>
            </div>
          ))}
        {!query.data?.some((r) => r.state !== "OPEN") && (
          <p className="muted">{t("noHistory")}</p>
        )}
      </section>
    </div>
  );
}
function CurrentRequest({
  row,
  readBlocked,
  readFeedback,
}: {
  row: Request;
  readBlocked: boolean;
  readFeedback: ReactNode;
}) {
  const format = useFormatter();
  const locale = useLocale();
  const t = useTranslations("workflow");
  const signupEditing = useTranslations("signupEditing");
  const appeals = useTranslations("signupAppeal");
  const scheduling = useTranslations("scheduling");
  const utils = api.useUtils();
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<"RECALL" | "ABORT" | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () => utils.studentWorkflow.mine.invalidate();
  const recall = api.studentWorkflow.recall.useMutation({
    onSuccess: async () => {
      setAction(null);
      await refresh();
    },
  });
  const abort = api.studentWorkflow.applyAbort.useMutation({
    onSuccess: async () => {
      setAction(null);
      await refresh();
    },
  });
  const abortPending = row.reviews.some(
    (r) => r.kind === "STUDENT_ABORT" && r.state === "PENDING",
  );
  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge-green">{t("verified")}</span>
          {row.editedAt && <span className="badge-amber">{t("edited")}</span>}
        </div>
        <p className="text-lg font-semibold">
          {row.subjects.map((s) => s.name).join(" · ")}
        </p>
        <p className="muted text-sm">
          {t("priority", {
            time: format.dateTime(new Date(row.submittedAt), {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </p>
        {(row.canAppeal || row.appeal) && (
          <div
            role="status"
            className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm"
          >
            <p className="font-semibold">{appeals("title")}</p>
            <p>
              {row.appeal
                ? appeals(
                    row.appeal.state === "PENDING"
                      ? "pending"
                      : row.appeal.state === "ACCEPTED"
                        ? "accepted"
                        : "rejected",
                  )
                : appeals("help")}
            </p>
            <Button
              variant="secondary"
              size="compact"
              disabled={readBlocked}
              onClick={() => setEditing(true)}
            >
              {appeals("staffTitle")}
            </Button>
          </div>
        )}
        <div className="border-t border-slate-100 pt-4">
          <h3 className="font-semibold">{t("assignments")}</h3>
          {row.pairings.length ? (
            row.pairings.map((p) => (
              <p key={p.id} className="mt-2 text-sm">
                {p.subject} ·{" "}
                <ParticipantName
                  name={p.tutor.englishName}
                  username={p.tutor.user?.username}
                />{" "}
                · {pairingScheduleText(p, scheduling("awaiting"), locale)}
              </p>
            ))
          ) : (
            <p className="muted mt-2">{t("waitingMatch")}</p>
          )}
        </div>
      </div>
      <section className="card space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">{t("availability")}</h3>
          <Button
            variant="secondary"
            size="compact"
            disabled={readBlocked}
            onClick={() => setEditing(true)}
          >
            {signupEditing("edit")}
          </Button>
        </div>
        <p className="muted text-sm">{signupEditing("availabilityHelp")}</p>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {row.slots.map((slot) => (
            <li key={slot.id}>
              {formatWeekday(slot.dayOfWeek, locale)} {minToHm(slot.startMin)}–
              {minToHm(slot.endMin)}
            </li>
          ))}
        </ul>
      </section>
      {editing && (
        <StudentSignupEditor
          requestId={row.id}
          onClose={() => setEditing(false)}
        />
      )}
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h3 className="font-semibold">{t("participation")}</h3>
        <p className="mt-2 text-sm text-slate-600">
          {t(row.pairings.length ? "abortHelp" : "recallHelp")}
        </p>
        {abortPending ? (
          <p role="status" className="mt-3 font-medium">
            {t("abortPending")}
          </p>
        ) : (
          <button
            className="btn-danger btn-sm mt-4"
            disabled={readBlocked}
            onClick={() => {
              setReason("");
              setAction(row.pairings.length ? "ABORT" : "RECALL");
            }}
          >
            {t(row.pairings.length ? "applyAbort" : "recall")}
          </button>
        )}
      </section>
      {action && (
        <TimedActionDialog
          action={action}
          target={row.id}
          title={t(action === "ABORT" ? "applyAbort" : "recall")}
          message={t(
            action === "ABORT" ? "abortConsequences" : "recallConsequences",
          )}
          busy={recall.isPending || abort.isPending}
          error={recall.error?.message ?? abort.error?.message}
          canConfirm={!readBlocked && (action !== "ABORT" || !!reason.trim())}
          onCancel={() => setAction(null)}
          onConfirm={(ticket) =>
            !readBlocked &&
            (action === "ABORT"
              ? abort.mutateAsync({ id: row.id, reason, ticket })
              : recall.mutateAsync({ id: row.id, ticket }))
          }
        >
          {/* Read recovery must be reachable while the existing reason/ticket stays mounted. */}
          {readFeedback}
          {action === "ABORT" && (
            <label className="block text-sm">
              {t("reason")}
              <textarea
                className="input mt-2 w-full"
                rows={3}
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
        </TimedActionDialog>
      )}
    </div>
  );
}
