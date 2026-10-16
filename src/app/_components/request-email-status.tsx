"use client";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Button } from "./ui/button";
import { FormSection, InlineNotice, StatePanel } from "./ui/patterns";
import { useDialogPending } from "./ui/modal";
import { useSessionAccessDenied } from "./session-view-state";

type Source = { kind: "application" | "survey" | "signup"; id: string };
const statuses = new Set([
  "PENDING",
  "SENDING",
  "SENT",
  "FAILED",
  "BLOCKED",
  "SUPERSEDED",
  "SKIPPED",
  "CANCELLED",
]);
export type RequestEmailSession = {
  writing: boolean;
  reading: boolean;
  needsRead: boolean;
  accessDenied: boolean;
  outcome: "queued" | "declined" | "retryUnchanged" | null;
  writeFailed: "retry" | "decline" | null;
  decisionDraft: {
    appealId: string;
    reviewVersion: number;
    reason: string;
  } | null;
};
export const newRequestEmailSession = (): RequestEmailSession => ({
  writing: false,
  reading: false,
  needsRead: false,
  accessDenied: false,
  outcome: null,
  writeFailed: null,
  decisionDraft: null,
});
/** Receipt recovery is separate from the flag writer: refresh only reads; retry
 * requeues the existing receipt; appeal decisions retain their own reason draft. */
export function RequestEmailStatus({
  source,
  canApply,
  refreshSignal,
  session,
  setSession,
}: {
  source: Source;
  canApply: boolean;
  refreshSignal: boolean;
  session?: RequestEmailSession;
  setSession?: Dispatch<SetStateAction<RequestEmailSession>>;
}) {
  const t = useTranslations("requestEmail"),
    common = useTranslations("common"),
    format = useFormatter();
  const status = api.notification.requestEmailStatus.useQuery(source, {
    retry: false,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
  const retry = api.notification.retryRequestEmail.useMutation(),
    decline = api.notification.declineRequestAppeal.useMutation();
  const currentDenied = useSessionAccessDenied(status);
  const [localSession, setLocalSession] = useState(newRequestEmailSession);
  const { writing, reading, needsRead, outcome, writeFailed, decisionDraft } =
    session ?? localSession;
  const update = setSession ?? setLocalSession;
  const denied = currentDenied || (session ?? localSession).accessDenied;
  useEffect(() => {
    if (currentDenied)
      update((old) =>
        old.accessDenied ? old : { ...old, accessDenied: true },
      );
    else if (status.isSuccess && !status.isFetching && !status.error)
      update((old) =>
        old.accessDenied ? { ...old, accessDenied: false } : old,
      );
  }, [
    currentDenied,
    status.isSuccess,
    status.isFetching,
    status.error,
    update,
  ]);
  const setWriting = (value: boolean) =>
    update((old) => ({ ...old, writing: value }));
  const setReading = (value: boolean) =>
    update((old) => ({ ...old, reading: value }));
  const setNeedsRead = (value: boolean) =>
    update((old) => ({ ...old, needsRead: value }));
  const setOutcome = (value: RequestEmailSession["outcome"]) =>
    update((old) => ({ ...old, outcome: value }));
  const setWriteFailed = (value: RequestEmailSession["writeFailed"]) =>
    update((old) => ({ ...old, writeFailed: value }));
  const setDecisionDraft = (
    value: SetStateAction<RequestEmailSession["decisionDraft"]>,
  ) =>
    update((old) => ({
      ...old,
      decisionDraft:
        typeof value === "function" ? value(old.decisionDraft) : value,
    }));
  const admitted = useRef(false),
    lastSignal = useRef(refreshSignal);
  const busy = useDialogPending(writing);
  useEffect(() => {
    if (lastSignal.current === refreshSignal) return;
    lastSignal.current = refreshSignal;
    if (refreshSignal) void status.refetch();
  }, [refreshSignal, status]);
  async function refresh() {
    setReading(true);
    try {
      const result = await status.refetch();
      if (result.error) throw new Error("Status read failed");
      setNeedsRead(false);
      return true;
    } catch {
      return false;
    } finally {
      setReading(false);
    }
  }
  async function mutate(kind: "retry" | "decline") {
    const appeal = status.data?.requestAppeal;
    if (
      admitted.current ||
      needsRead ||
      reading ||
      busy ||
      denied ||
      status.error ||
      !canApply ||
      (kind === "decline" &&
        (!appeal ||
          !decisionDraft?.reason.trim() ||
          appeal.id !== decisionDraft.appealId ||
          appeal.reviewVersion !== decisionDraft.reviewVersion))
    )
      return;
    admitted.current = true;
    setWriting(true);
    setWriteFailed(null);
    setOutcome(null);
    try {
      let nextOutcome: "queued" | "declined" | "retryUnchanged" = "declined";
      if (kind === "retry") {
        const result = await retry.mutateAsync(source);
        nextOutcome = result.queued ? "queued" : "retryUnchanged";
      } else
        await decline.mutateAsync({
          ...source,
          appealId: decisionDraft!.appealId,
          expectedReviewVersion: decisionDraft!.reviewVersion,
          reason: decisionDraft!.reason.trim(),
        });
      // Accepted writes remain locked through failed synchronization. A successful
      // read permits a later distinct action; it never repeats the accepted write.
      setNeedsRead(true);
      setOutcome(nextOutcome);
      await refresh();
    } catch {
      setWriteFailed(kind);
    } finally {
      admitted.current = false;
      setWriting(false);
    }
  }
  if (denied) return <StatePanel kind="error" title={t("denied")} />;
  const data = status.data,
    appeal = data?.requestAppeal;
  const staleDraft =
    !!decisionDraft &&
    (appeal?.id !== decisionDraft.appealId ||
      appeal.reviewVersion !== decisionDraft.reviewVersion);
  async function reloadDecision() {
    setReading(true);
    try {
      const result = await status.refetch();
      if (result.error || !result.data?.requestAppeal)
        throw new Error("Unavailable");
      const fresh = result.data.requestAppeal;
      setDecisionDraft({
        appealId: fresh.id,
        reviewVersion: fresh.reviewVersion,
        reason: "",
      });
    } catch {
      /* Retain the old draft/version until an explicit read succeeds. */
    } finally {
      setReading(false);
    }
  }
  const retryEligible =
    data &&
    (data.status === "FAILED" ||
      (data.status === "PENDING" && data.attempts > 0)) &&
    data.retryEligible;
  return (
    <section
      className="space-y-3 border-t border-slate-200 pt-4"
      aria-label={t("title")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{t("title")}</h3>
        <Button
          size="compact"
          disabled={busy || reading}
          onClick={() => void refresh()}
        >
          {t("retryRead")}
        </Button>
      </div>
      {!data && status.error ? (
        <StatePanel kind="error" title={t("unknown")} />
      ) : !data && status.isLoading ? (
        <StatePanel kind="loading" title={common("loading")} />
      ) : (
        <p className="text-sm text-slate-700">
          {!data
            ? t("none")
            : t(
                data.status === "PENDING" && data.attempts > 0
                  ? "retrying"
                  : statuses.has(data.status)
                    ? data.status
                    : "unknown",
              )}
        </p>
      )}
      {(!!status.error || needsRead) && (
        <InlineNotice tone="warning" announcement="status">
          {needsRead && outcome
            ? t(
                outcome === "queued"
                  ? "queuedReadFailed"
                  : outcome === "declined"
                    ? "reviewReadFailed"
                    : "unknown",
              )
            : t("unknown")}
        </InlineNotice>
      )}
      {outcome && !needsRead && (
        <InlineNotice tone="success" announcement="status">
          {t(outcome)}
        </InlineNotice>
      )}
      {writeFailed && (
        <InlineNotice tone="error" announcement="alert">
          {t(writeFailed === "retry" ? "failed" : "declineFailed")}
        </InlineNotice>
      )}
      {canApply && retryEligible && (
        <Button
          size="compact"
          disabled={busy || reading || needsRead || !!status.error}
          onClick={() => void mutate("retry")}
        >
          {t("retrySend")}
        </Button>
      )}
      {data && (
        <p className="text-xs leading-relaxed text-slate-600">
          {t("sendLimit")}
        </p>
      )}
      {appeal && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h4 className="font-semibold text-slate-900">{t("appeal")}</h4>
          <p className="text-sm text-slate-700">
            {t(
              appeal.status === "PENDING"
                ? "appealPending"
                : appeal.status === "DECLINED"
                  ? "appealDeclined"
                  : "appealCleared",
            )}
          </p>
          <p className="text-xs text-slate-600">
            {format.dateTime(new Date(appeal.submittedAt), {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
          <p className="text-sm break-words whitespace-pre-wrap text-slate-800">
            {appeal.body}
          </p>
          {appeal.decisionReason && (
            <p className="text-sm break-words whitespace-pre-wrap text-slate-700">
              {appeal.decisionReason}
            </p>
          )}
          {staleDraft && (
            <InlineNotice
              tone="warning"
              action={
                <Button
                  size="compact"
                  disabled={busy || reading}
                  onClick={() => void reloadDecision()}
                >
                  {t("reloadAppeal")}
                </Button>
              }
            >
              {t("staleAppealDraft")}
            </InlineNotice>
          )}
          {canApply &&
            appeal.status === "PENDING" &&
            appeal.notice.requestVersion === data.requestVersion && (
              <FormSection
                title={t("decisionReason")}
                busy={busy}
                disabled={needsRead || !!status.error || staleDraft}
              >
                <label
                  className="sr-only"
                  htmlFor={`appeal-decline-${appeal.id}`}
                >
                  {t("decisionReason")}
                </label>
                <textarea
                  id={`appeal-decline-${appeal.id}`}
                  className="input min-h-24 w-full"
                  maxLength={1000}
                  value={decisionDraft?.reason ?? ""}
                  onChange={(event) =>
                    setDecisionDraft((old) => ({
                      appealId: old?.appealId ?? appeal.id,
                      reviewVersion: old?.reviewVersion ?? appeal.reviewVersion,
                      reason: event.target.value,
                    }))
                  }
                />
                <Button
                  size="compact"
                  disabled={
                    busy ||
                    reading ||
                    needsRead ||
                    !!status.error ||
                    staleDraft ||
                    !decisionDraft?.reason.trim()
                  }
                  onClick={() => void mutate("decline")}
                >
                  {t("decline")}
                </Button>
              </FormSection>
            )}
        </div>
      )}
    </section>
  );
}
