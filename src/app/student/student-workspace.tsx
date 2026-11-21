"use client";
import { pairingScheduleText } from "~/lib/pairing-schedule";
import Link from "next/link";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { api, type RouterOutputs } from "~/trpc/react";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";
import { formatWeekday, minToHm } from "~/lib/time";
import { Button } from "~/app/_components/ui/button";
import { InlineNotice, StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { useSessionPageScroll } from "~/app/_components/session-view-state";
import { ParticipantName } from "~/app/_components/participant-name";
import { StudentSignupEditor } from "~/app/_components/student-signup-editor";
import { getSessionReadReceipts } from "~/lib/session-read-receipts";
import { studentAbortReasonHash } from "~/lib/student-abort-intent";
import { useStudentSignupRestriction } from "./signup-restriction";

type Request = RouterOutputs["studentWorkflow"]["mine"][number];
const noReadSubscription = () => () => undefined;
const emptyReadSnapshot = () => 0;
export function StudentWorkspace({
  viewScope = "",
  quarterBlocked = false,
}: {
  viewScope?: string;
  quarterBlocked?: boolean;
}) {
  const restriction = useStudentSignupRestriction();
  const refreshRestriction = restriction?.refreshAfterSourceRead;
  const t = useTranslations("workflow");
  const appeal = useTranslations("signupAppeal");
  const recovery = useTranslations("participantRecovery");
  const queryClient = useQueryClient();
  const readReceipts = getSessionReadReceipts(queryClient);
  useSyncExternalStore(
    readReceipts?.subscribe ?? noReadSubscription,
    readReceipts?.getSnapshot ?? emptyReadSnapshot,
    emptyReadSnapshot,
  );
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
  // Hide creation guidance before painting freshly read source rows; the
  // restriction still comes from its independent authoritative read.
  useLayoutEffect(() => {
    if (
      query.isSuccess &&
      legacy.isSuccess &&
      !query.error &&
      !legacy.error &&
      !query.isFetching &&
      !legacy.isFetching &&
      !requestDenied &&
      !legacyDenied
    )
      void refreshRestriction?.();
  }, [
    query.dataUpdatedAt,
    legacy.dataUpdatedAt,
    query.isSuccess,
    legacy.isSuccess,
    query.error,
    legacy.error,
    query.isFetching,
    legacy.isFetching,
    requestDenied,
    legacyDenied,
    refreshRestriction,
  ]);
  useSessionPageScroll({
    id: "student-requests-v1",
    scope: viewScope,
    ready: !!query.data && !!legacy.data,
    enabled: !denied && !requestDenied && !legacyDenied,
  });
  useEffect(() => {
    if (!requestDenied && !legacyDenied) return;
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
  // Both owned reads must recover before cached request children can return.
  const nextDenied =
    requestDenied || legacyDenied
      ? true
      : query.isSuccess &&
          legacy.isSuccess &&
          !query.isFetching &&
          !legacy.isFetching &&
          !query.error &&
          !legacy.error
        ? false
        : denied;
  if (nextDenied !== denied) setDenied(nextDenied);
  const retry = () => {
    void query.refetch();
    void legacy.refetch();
  };
  const readBlocked =
    !!query.error || !!legacy.error || !query.data || !legacy.data;
  const sourceQuery = queryClient.getQueryCache().find({
    queryKey: getQueryKey(api.studentWorkflow.mine, undefined, "query"),
    exact: true,
  });
  const sourceProof = sourceQuery && readReceipts?.read(sourceQuery).proof;
  // An exact review must come from a completed network read of this generation.
  // Manual cache writes and reads crossing a denial cannot release a receipt.
  const readVerified = Boolean(
    sourceProof &&
    sourceProof.firstDenialFence === undefined &&
    sourceQuery?.state.data === query.data &&
    query.isSuccess &&
    legacy.isSuccess &&
    !query.isFetching &&
    !legacy.isFetching,
  );
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
  const currentRequests = useCurrentRequests({
    rows: query.data ?? [],
    readBlocked,
    readVerified,
    readFeedback,
    concealed: denied || requestDenied || legacyDenied,
    onRefresh: async () => {
      const fresh = await query.refetch();
      if (fresh.error || !fresh.data)
        throw new Error(recovery("refreshFailed"));
      return fresh.data;
    },
  });
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
  const active = query.data.filter((r) => r.state === "OPEN");
  const currentLabel = t(active.length > 1 ? "currentRequests" : "current");
  const signupBlocked = restriction?.blocked ?? quarterBlocked;
  const signupReady = restriction?.ready ?? true;
  return (
    <div className="space-y-6">
      {readFeedback}
      <nav
        aria-label={t("navigation")}
        className="flex flex-wrap gap-4 border-b border-slate-200 pb-3 text-sm"
      >
        <a className="link" href="#current-request">
          {currentLabel}
        </a>
        <a className="link" href="#request-history">
          {t("processed")}
        </a>
      </nav>
      <section id="current-request" className="space-y-4">
        <h2 className="section-title">{currentLabel}</h2>
        {currentRequests}
        {!active.length &&
          !readBlocked &&
          (signupBlocked || signupReady) &&
          !legacy.data?.some((row) => row.status !== "INACTIVE") && (
            <div className="card space-y-3 p-6">
              <p>{t(signupBlocked ? "abortFinal" : "noActive")}</p>
              {!signupBlocked && signupReady && (
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
type RequestAction = { row: Request; kind: "RECALL" | "ABORT" };
type AcceptedRequestAction =
  | { kind: "RECALL" }
  | { kind: "ABORT"; reviewId: string };
type UnconfirmedAbort = {
  selected: RequestAction;
  ticket: string;
  reason: string;
  checked: boolean;
  retired: boolean;
  notAccepted?: boolean;
  canRetire?: boolean;
  unavailable?: "pending" | "unassigned" | "closed" | "missing";
  error?: string;
};

/** Dialogs and accepted receipts belong to the list, not a removable OPEN card.
 * Source IDs keep actions stable when reads reorder or close another request. */
function useCurrentRequests({
  rows,
  readBlocked,
  readVerified,
  readFeedback,
  concealed,
  onRefresh,
}: {
  rows: Request[];
  readBlocked: boolean;
  readVerified: boolean;
  readFeedback: ReactNode;
  concealed: boolean;
  onRefresh: () => Promise<Request[]>;
}) {
  const format = useFormatter();
  const t = useTranslations("workflow");
  const [editing, setEditing] = useState<Request | null>(null);
  const [action, setAction] = useState<RequestAction | null>(null);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Map<string, AcceptedRequestAction>>(
    () => new Map(),
  );
  const [recoveries, setRecoveries] = useState<RequestAction[]>([]);
  const [unconfirmed, setUnconfirmed] = useState<Map<string, UnconfirmedAbort>>(
    () => new Map(),
  );
  const admitted = useRef(false);
  const utils = api.useUtils();
  const recall = api.studentWorkflow.recall.useMutation();
  const abort = api.studentWorkflow.applyAbort.useMutation({ retry: false });
  const cancel = api.studentWorkflow.cancelAction.useMutation({ retry: false });
  const busy = working || recall.isPending || abort.isPending;
  // Reconcile denial before committing private children. An in-flight action
  // keeps its captured source/admission and accepted receipt in this owner.
  if (concealed && (editing || action)) {
    setEditing(null);
    setAction(null);
  }
  if (readVerified && !readBlocked && !concealed) {
    const nextAccepted = new Map(accepted);
    const observed = new Set<string>();
    for (const [id, receipt] of accepted) {
      const row = rows.find((item) => item.id === id);
      const review =
        receipt.kind === "ABORT"
          ? row?.reviews.find(
              (item) =>
                item.id === receipt.reviewId && item.kind === "STUDENT_ABORT",
            )
          : undefined;
      if (review || (receipt.kind === "RECALL" && row?.state === "RECALLED"))
        observed.add(id);
      // A decline of this exact submission permits a fresh ticketed attempt,
      // even if no intervening PENDING snapshot reached the mounted workspace.
      if (row?.state === "OPEN" && review?.state === "DENIED")
        nextAccepted.delete(id);
    }
    if (nextAccepted.size !== accepted.size) setAccepted(nextAccepted);
    if (recoveries.some((item) => observed.has(item.row.id)))
      setRecoveries(recoveries.filter((item) => !observed.has(item.row.id)));
  }
  const active = rows.filter((row) => row.state === "OPEN");
  const context = (row: Request) =>
    `${row.name ? `${row.name} · ` : ""}${row.subjects.map((subject) => subject.name).join(" · ")} · ${t(
      "priority",
      {
        time: format.dateTime(new Date(row.submittedAt), {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      },
    )}`;
  const recover = async () => {
    if (admitted.current || busy) return;
    admitted.current = true;
    setWorking(true);
    try {
      await onRefresh();
    } catch {
      // The accepted source keeps its own read-only recovery; never replay it.
    } finally {
      admitted.current = false;
      setWorking(false);
    }
  };
  const liveAction = action && rows.find((row) => row.id === action.row.id);
  const actionAllowed = Boolean(
    action &&
    liveAction?.state === "OPEN" &&
    !accepted.has(action.row.id) &&
    (!unconfirmed.has(action.row.id) ||
      (action.kind === "RECALL" &&
        unconfirmed.get(action.row.id)?.notAccepted)) &&
    !readBlocked &&
    (action.kind === "RECALL"
      ? !liveAction.pairings.length
      : liveAction.pairings.length &&
        !liveAction.reviews.some(
          (review) =>
            review.kind === "STUDENT_ABORT" && review.state === "PENDING",
        ) &&
        reason.trim()),
  );
  const checkAbort = async (attempt: UnconfirmedAbort, restart = false) => {
    if (admitted.current || busy || concealed || readBlocked) return;
    admitted.current = true;
    setWorking(true);
    const id = attempt.selected.row.id;
    let retired = attempt.retired;
    let notAccepted = attempt.notAccepted ?? false;
    let receiptChecked = false;
    try {
      // Retiring an unused proof fences a delayed original POST. A missing/used
      // proof alone never establishes rejection of an old, unreceipted write.
      if (restart && !retired && !notAccepted) {
        const result = await cancel.mutateAsync({ ticket: attempt.ticket });
        retired = result.count === 1;
      }
      const receipt = await utils.studentWorkflow.abortReceipt.fetch(
        {
          id,
          ticket: attempt.ticket,
          reasonHash: await studentAbortReasonHash(attempt.reason),
        },
        { staleTime: 0 },
      );
      receiptChecked = true;
      if (receipt.status === "ACCEPTED") {
        setUnconfirmed((previous) => {
          const next = new Map(previous);
          next.delete(id);
          return next;
        });
        setAccepted((previous) =>
          new Map(previous).set(id, {
            kind: "ABORT",
            reviewId: receipt.reviewId,
          }),
        );
        setRecoveries((previous) => [...previous, attempt.selected]);
        try {
          await onRefresh();
        } catch {
          /* Exact accepted receipt retains read-only refresh. */
        }
      } else {
        notAccepted =
          notAccepted || retired || receipt.status === "NOT_ACCEPTED";
        let unavailable = attempt.unavailable;
        if (notAccepted) {
          const fresh = (await onRefresh()).find((row) => row.id === id);
          unavailable = !fresh
            ? "missing"
            : fresh.state !== "OPEN"
              ? "closed"
              : fresh.reviews.some(
                    (review) =>
                      review.kind === "STUDENT_ABORT" &&
                      review.state === "PENDING",
                  )
                ? "pending"
                : !fresh.pairings.length
                  ? "unassigned"
                  : undefined;
          if (restart && fresh && !unavailable) {
            setUnconfirmed((previous) => {
              const next = new Map(previous);
              next.delete(id);
              return next;
            });
            setReason(attempt.reason);
            setFailure(null);
            setAction({ row: fresh, kind: "ABORT" });
            return;
          }
        }
        setUnconfirmed((previous) =>
          new Map(previous).set(id, {
            ...attempt,
            checked: true,
            retired,
            notAccepted,
            canRetire: receipt.status === "UNCONFIRMED" && receipt.canRetire,
            unavailable,
            error: undefined,
          }),
        );
      }
    } catch {
      setUnconfirmed((previous) =>
        new Map(previous).set(id, {
          ...attempt,
          retired,
          notAccepted,
          error: t(
            receiptChecked && notAccepted
              ? "abortRefreshFailed"
              : "abortCheckFailed",
          ),
        }),
      );
    } finally {
      admitted.current = false;
      setWorking(false);
    }
  };
  const confirm = async (ticket: string) => {
    if (admitted.current || busy || !action || !actionAllowed) return;
    admitted.current = true;
    setWorking(true);
    setFailure(null);
    const selected = action;
    const submittedReason = reason.trim();
    try {
      let receipt: AcceptedRequestAction;
      if (selected.kind === "ABORT") {
        const result = await abort.mutateAsync({
          id: selected.row.id,
          reason: submittedReason,
          ticket,
        });
        receipt = { kind: "ABORT", reviewId: result.reviewId };
      } else {
        await recall.mutateAsync({ id: selected.row.id, ticket });
        receipt = { kind: "RECALL" };
      }
      setAccepted((previous) =>
        new Map(previous).set(selected.row.id, receipt),
      );
      setRecoveries((previous) => [...previous, selected]);
      setAction(null);
      try {
        await onRefresh();
      } catch {
        // Keep read-only recovery until the exact accepted result is observed.
      }
    } catch (error) {
      if (selected.kind === "ABORT") {
        // Preserve the exact intent even when a transport retry reports a used
        // ticket. This source cannot submit again until its outcome is resolved.
        setUnconfirmed((previous) =>
          new Map(previous).set(selected.row.id, {
            selected,
            ticket,
            reason: submittedReason,
            checked: false,
            retired: false,
          }),
        );
        setAction(null);
      } else
        setFailure(error instanceof Error ? error.message : t("actionFailed"));
    } finally {
      admitted.current = false;
      setWorking(false);
    }
  };
  if (concealed) return null;
  return (
    <>
      {[...unconfirmed.values()].map((attempt) => (
        <InlineNotice
          key={attempt.selected.row.id}
          tone="warning"
          announcement="status"
          action={
            <>
              <Button
                disabled={busy || readBlocked}
                onClick={() => void checkAbort(attempt)}
              >
                {t("checkAbortSubmission")}
              </Button>
              {attempt.checked &&
                !attempt.unavailable &&
                (attempt.canRetire ||
                  attempt.retired ||
                  attempt.notAccepted) && (
                  <Button
                    disabled={busy || readBlocked}
                    onClick={() => void checkAbort(attempt, true)}
                  >
                    {t("freshAbortReview")}
                  </Button>
                )}
            </>
          }
        >
          <p className="font-medium">
            {attempt.unavailable === "missing"
              ? t("abortFreshMissing")
              : context(attempt.selected.row)}
          </p>
          <p>
            {t(
              attempt.notAccepted
                ? "abortNotAccepted"
                : attempt.checked
                  ? attempt.canRetire || attempt.retired
                    ? "abortNotConfirmed"
                    : "abortStillUnknown"
                  : "abortUnconfirmed",
            )}
          </p>
          {attempt.unavailable && attempt.unavailable !== "missing" && (
            <p>{t(`abortFreshUnavailable.${attempt.unavailable}`)}</p>
          )}
          {attempt.error && <p role="alert">{attempt.error}</p>}
        </InlineNotice>
      ))}
      {recoveries.map((item) => (
        <InlineNotice
          key={item.row.id}
          tone="warning"
          announcement="status"
          action={
            <Button
              disabled={busy}
              aria-label={
                recoveries.length > 1
                  ? `${t("retryRefresh")} · ${context(item.row)}`
                  : undefined
              }
              onClick={() => void recover()}
            >
              {t("retryRefresh")}
            </Button>
          }
        >
          <p className="font-medium">{context(item.row)}</p>
          <p>
            {t(item.kind === "RECALL" ? "recallAccepted" : "abortAccepted")}
          </p>
        </InlineNotice>
      ))}
      {active.map((row) => (
        <CurrentRequest
          key={row.id}
          row={row}
          context={context(row)}
          multiple={active.length > 1}
          readBlocked={readBlocked || busy}
          actionAccepted={
            accepted.has(row.id) ||
            (unconfirmed.has(row.id) &&
              (!unconfirmed.get(row.id)?.notAccepted || !!row.pairings.length))
          }
          onEdit={() => {
            if (
              editing ||
              action ||
              admitted.current ||
              busy ||
              readBlocked ||
              (unconfirmed.has(row.id) && !unconfirmed.get(row.id)?.notAccepted)
            )
              return;
            setEditing(row);
          }}
          onAction={(kind) => {
            if (
              editing ||
              action ||
              admitted.current ||
              busy ||
              readBlocked ||
              accepted.has(row.id) ||
              (unconfirmed.has(row.id) &&
                !(kind === "RECALL" && unconfirmed.get(row.id)?.notAccepted))
            )
              return;
            setReason("");
            setFailure(null);
            setAction({ row, kind });
          }}
        />
      ))}
      {editing && (
        <StudentSignupEditor
          key={editing.id}
          requestId={editing.id}
          requestContext={context(editing)}
          onClose={() => setEditing(null)}
        />
      )}
      {action && (
        <TimedActionDialog
          action={action.kind === "ABORT" ? "SURVEY_ABORT" : action.kind}
          target={action.row.id}
          title={t(action.kind === "ABORT" ? "applyAbort" : "recall")}
          message={t(
            action.kind === "ABORT"
              ? "abortConsequences"
              : "recallConsequences",
          )}
          busy={busy}
          error={failure ?? undefined}
          canConfirm={actionAllowed}
          onCancel={() => {
            if (!admitted.current && !busy) setAction(null);
          }}
          onConfirm={confirm}
        >
          <p className="font-medium">{context(action.row)}</p>
          {readFeedback}
          {action.kind === "ABORT" && (
            <label className="block text-sm">
              {t("reason")}
              <textarea
                className="input mt-2 w-full"
                rows={3}
                maxLength={2000}
                disabled={busy}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          )}
        </TimedActionDialog>
      )}
    </>
  );
}

function CurrentRequest({
  row,
  context,
  multiple,
  readBlocked,
  actionAccepted,
  onEdit,
  onAction,
}: {
  row: Request;
  context: string;
  multiple: boolean;
  readBlocked: boolean;
  actionAccepted: boolean;
  onEdit: () => void;
  onAction: (kind: "RECALL" | "ABORT") => void;
}) {
  const format = useFormatter();
  const locale = useLocale();
  const t = useTranslations("workflow");
  const signupEditing = useTranslations("signupEditing");
  const appeals = useTranslations("signupAppeal");
  const scheduling = useTranslations("scheduling");
  const headingId = useId();
  const submissionId = useId();
  const abortPending = row.reviews.some(
    (r) => r.kind === "STUDENT_ABORT" && r.state === "PENDING",
  );
  return (
    <article
      className="space-y-4"
      aria-labelledby={headingId}
      aria-describedby={submissionId}
    >
      <div className="card space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge-green">{t("verified")}</span>
          {row.editedAt && <span className="badge-slate">{t("edited")}</span>}
        </div>
        <h3 id={headingId} className="text-lg font-semibold">
          {row.subjects.map((s) => s.name).join(" · ")}
        </h3>
        {multiple && row.name && <p className="text-sm">{row.name}</p>}
        <p id={submissionId} className="muted text-sm">
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
              aria-label={
                multiple ? `${appeals("staffTitle")} · ${context}` : undefined
              }
              aria-describedby={`${headingId} ${submissionId}`}
              onClick={onEdit}
            >
              {appeals("staffTitle")}
            </Button>
          </div>
        )}
        <div className="border-t border-slate-100 pt-4">
          <h4 className="font-semibold">{t("assignments")}</h4>
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
          <h4 className="font-semibold">{t("availability")}</h4>
          <Button
            variant="secondary"
            size="compact"
            disabled={readBlocked}
            aria-label={
              multiple ? `${signupEditing("edit")} · ${context}` : undefined
            }
            aria-describedby={`${headingId} ${submissionId}`}
            onClick={onEdit}
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
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h4 className="font-semibold">{t("participation")}</h4>
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
            disabled={readBlocked || actionAccepted}
            aria-label={
              multiple
                ? `${t(row.pairings.length ? "applyAbort" : "recall")} · ${context}`
                : undefined
            }
            aria-describedby={`${headingId} ${submissionId}`}
            onClick={() => onAction(row.pairings.length ? "ABORT" : "RECALL")}
          >
            {t(row.pairings.length ? "applyAbort" : "recall")}
          </button>
        )}
      </section>
    </article>
  );
}
