"use client";
import { HEAD_APPROVAL_OPERATIONS } from "~/lib/approval-policy";

import Link from "next/link";
import { isAssignmentOperation } from "~/lib/assignment-qualification";
import { AssignmentConfirmation } from "./assignment-confirmation";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import SuperJSON from "superjson";
import { api, type RouterOutputs } from "~/trpc/react";
import { humanizeOperation, proposalConfirmation } from "~/lib/approval-policy";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";
import { ApprovalReviewDetails } from "./approval-review-details";
import { ChoiceButton } from "./ui/button";
import { FilterToolbar } from "./ui/patterns";

type Request = RouterOutputs["approval"]["list"]["rows"][number];
type State = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

/** Show immutable proposed values alongside the target evidence; reviewer notes explain
 * the decision to the trainee and remain available after the request leaves the queue. */
function RequestCard({
  request,
  canReview,
  canCancel,
  onChanged,
}: {
  request: Request;
  canReview: boolean;
  canCancel: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("approvals");
  const format = useFormatter();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [overrideReview, setOverrideReview] = useState<{
    ticket?: string;
  } | null>(null);
  const decision = api.approval.decide.useMutation({
    onSuccess: async () => {
      setConfirming(false);
      setOverrideReview(null);
      await onChanged();
    },
  });
  const cancel = api.approval.cancel.useMutation({ onSuccess: onChanged });
  const pending = request.state === "PENDING";
  const busy = decision.isPending || cancel.isPending;
  const payload: unknown = SuperJSON.deserialize(
    request.payload as unknown as Parameters<typeof SuperJSON.deserialize>[0],
  );
  const confirmation = proposalConfirmation(request.operation, payload);
  const approve = (ticket?: string) => {
    setConfirming(false);
    if (isAssignmentOperation(request.operation)) setOverrideReview({ ticket });
    else decision.mutate({ id: request.id, approve: true, note, ticket });
  };
  return (
    <article className="card overflow-hidden">
      {overrideReview && isAssignmentOperation(request.operation) && (
        <AssignmentConfirmation
          operation={request.operation}
          payload={{
            ...(payload as object),
            ...(overrideReview.ticket ? { ticket: overrideReview.ticket } : {}),
          }}
          busy={decision.isPending}
          error={decision.error?.message}
          onCancel={() => setOverrideReview(null)}
          onConfirm={(overrideTicket) =>
            decision.mutate({
              id: request.id,
              approve: true,
              note,
              ticket: overrideReview.ticket,
              overrideTicket,
            })
          }
        />
      )}
      {confirming && confirmation && (
        <TimedActionDialog
          action={confirmation.action}
          target={confirmation.target}
          title={t("approve")}
          message={t("confirmConsequences")}
          busy={decision.isPending}
          error={decision.error?.message}
          onCancel={() => setConfirming(false)}
          onConfirm={approve}
        >
          <ApprovalReviewDetails
            operation={request.operation}
            payload={payload}
            targets={request.targets}
            compact
          />
          <p className="text-sm whitespace-pre-wrap">{note}</p>
        </TimedActionDialog>
      )}
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">
              <Link
                className="hover:underline"
                href={`/admin/approvals?request=${encodeURIComponent(request.id)}`}
              >
                {t.has(
                  `review.operations.${request.operation.replaceAll(".", "_")}`,
                )
                  ? t(
                      `review.operations.${request.operation.replaceAll(".", "_")}`,
                    )
                  : humanizeOperation(request.operation)}
              </Link>
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("review.requestedBy", { name: request.requesterName })} ·{" "}
              {format.dateTime(new Date(request.createdAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>
          <span
            className={
              pending
                ? "badge-amber"
                : request.state === "APPROVED"
                  ? "badge-green"
                  : "badge-slate"
            }
          >
            {t(`states.${request.state}`)}
          </span>
        </div>
        <p
          className={
            pending
              ? "rounded-lg bg-amber-50 p-3 text-sm text-amber-950"
              : "text-sm text-slate-600"
          }
        >
          {t(`effects.${request.state}`)}
        </p>
        <ApprovalReviewDetails
          operation={request.operation}
          payload={payload}
          targets={request.targets}
        />
        {request.reviewedAt && (
          <div className="rounded-lg border-l-4 border-slate-300 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">
              {request.state === "CANCELLED"
                ? t("withdrawnBy", { name: request.requesterName })
                : request.reviewerName}{" "}
              ·{" "}
              {request.reviewedAt &&
                format.dateTime(new Date(request.reviewedAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
            </p>
            <p className="mt-2 text-sm whitespace-pre-wrap">
              {request.reviewNote}
            </p>
          </div>
        )}
        {pending && canReview && (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-800">
              {t("review.yourDecision")}
            </h3>
            <p className="text-sm text-slate-600">
              {t(
                payload &&
                  typeof payload === "object" &&
                  ["approve", "accept", "overturn", "action"].some(
                    (key) => key in payload,
                  )
                  ? "review.decisionRequestHelp"
                  : "review.decisionHelp",
              )}
            </p>
            <label className="block">
              <span className="label">{t("review.noteRequired")}</span>
              <textarea
                className="input mt-1 w-full"
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("noteHint")}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary min-h-11 lg:min-h-10"
                disabled={busy || !note.trim()}
                onClick={() => (confirmation ? setConfirming(true) : approve())}
              >
                {t("approve")}
              </button>
              <button
                className="btn-secondary min-h-11 lg:min-h-10"
                disabled={busy || !note.trim()}
                onClick={() =>
                  decision.mutate({ id: request.id, approve: false, note })
                }
              >
                {t("reject")}
              </button>
            </div>
          </div>
        )}
        {pending && !canReview && (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            {t(
              HEAD_APPROVAL_OPERATIONS.has(request.operation)
                ? "review.headRequired"
                : canCancel
                  ? "review.otherReviewer"
                  : "review.waitingReviewer",
            )}
          </p>
        )}
        {pending && canCancel && (
          <button
            className="btn-secondary min-h-11 lg:min-h-10"
            disabled={busy}
            onClick={() => cancel.mutate({ id: request.id })}
          >
            {t("cancel")}
          </button>
        )}
        {(decision.error ?? cancel.error) && (
          <p role="alert" className="text-sm text-red-700">
            {(decision.error ?? cancel.error)!.message}
          </p>
        )}
        {decision.data?.emailSent === false && (
          <p role="status" className="text-sm text-amber-800">
            {t("emailRetry")}
          </p>
        )}
        {canReview && (
          <Link
            href={`/admin/audit?approval=${request.id}`}
            className="link text-xs"
          >
            {t("audit")}
          </Link>
        )}
      </div>
    </article>
  );
}

function ApprovalQueue({
  reviewer,
  requestId,
  allStatuses,
}: {
  reviewer: boolean;
  requestId?: string;
  allStatuses: boolean;
}) {
  const t = useTranslations("approvals");
  const router = useRouter();
  const params = useSearchParams();
  const selectedStatus = params.get("status");
  const selectedPage = Number(params.get("page") ?? 0);
  const [state, setState] = useState<State | "">(
    selectedStatus &&
      ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(selectedStatus)
      ? (selectedStatus as State)
      : allStatuses || !reviewer
        ? ""
        : "PENDING",
  );
  const [page, setPage] = useState(
    Number.isSafeInteger(selectedPage) && selectedPage >= 0 ? selectedPage : 0,
  );
  const [requesterId, setRequesterId] = useState(
    reviewer ? (params.get("requester") ?? "") : "",
  );
  // Persist list state in the URL so clicking the banner from a filtered or older
  // page really returns to the full first page, even within the same route.
  const navigateList = (
    change: Partial<{ state: State | ""; page: number; requesterId: string }>,
  ) => {
    const next = { state, page, requesterId, ...change };
    const search = new URLSearchParams({ status: next.state || "all" });
    if (next.page) search.set("page", String(next.page));
    if (next.requesterId) search.set("requester", next.requesterId);
    router.replace(`/admin/approvals?${search.toString()}`, { scroll: false });
  };
  const queue = api.approval.list.useQuery({
    state: requestId ? undefined : state || undefined,
    page: requestId ? 0 : page,
    requesterId: requestId ? undefined : requesterId || undefined,
    requestId,
  });
  const refresh = async () => {
    await queue.refetch();
  };
  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">{t("title")}</h1>
        <p className="mt-2 text-sm font-semibold text-slate-800">
          {t(reviewer ? "reviewQueue" : "myRequests")}
        </p>
        <p className="muted mt-2 max-w-2xl">
          {t(reviewer ? "subtitle" : "ownSubtitle")}
        </p>
        <p className="muted mt-2 max-w-2xl text-sm">{t("reviewPermissions")}</p>
      </header>
      <div className="card p-4">
        <FilterToolbar label={t("status")}>
          {!requestId && (
            <div
              role="group"
              aria-label={t("status")}
              className="flex flex-wrap gap-2"
            >
              {(
                ["PENDING", "APPROVED", "REJECTED", "CANCELLED", ""] as const
              ).map((value) => (
                <ChoiceButton
                  key={value}
                  selected={state === value}
                  onClick={() => {
                    setState(value);
                    setPage(0);
                    navigateList({ state: value, page: 0 });
                  }}
                >
                  {value ? t(`states.${value}`) : t("allStates")}
                </ChoiceButton>
              ))}
            </div>
          )}
          {queue.data?.canReview && !requestId && (
            <label className="min-w-48">
              <span className="label">{t("requester")}</span>
              <select
                className="input mt-1 block w-full"
                value={requesterId}
                onChange={(e) => {
                  setRequesterId(e.target.value);
                  setPage(0);
                  navigateList({ requesterId: e.target.value, page: 0 });
                }}
              >
                <option value="">{t("allUsers")}</option>
                {queue.data.requesters.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="btn-secondary"
            onClick={() => void refresh()}
            disabled={queue.isFetching}
          >
            {t("refresh")}
          </button>
          {requestId && (
            <Link className="link" href="/admin/approvals?status=all">
              {t("allRequests")}
            </Link>
          )}
          {queue.data && (
            <p className="muted ml-auto text-sm">
              {t("count", { count: queue.data.total })}
            </p>
          )}
        </FilterToolbar>
      </div>
      {queue.isLoading && (
        <p role="status" className="muted">
          {t("loading")}
        </p>
      )}
      {queue.error && (
        <p role="alert" className="text-red-700">
          {queue.error.message}
        </p>
      )}
      {queue.data?.rows.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          canReview={
            queue.data.canReview &&
            (request.requesterId !== queue.data.viewerId ||
              queue.data.headReviewer) &&
            (!HEAD_APPROVAL_OPERATIONS.has(request.operation) ||
              queue.data.headReviewer)
          }
          canCancel={request.requesterId === queue.data.viewerId}
          onChanged={refresh}
        />
      ))}
      {queue.data?.total === 0 && (
        <div className="card p-10 text-center">
          <p className="font-medium text-slate-800">{t("empty")}</p>
          <p className="muted mt-2 text-sm">
            {t(
              requestId
                ? "missingHint"
                : reviewer
                  ? "emptyHint"
                  : "ownEmptyHint",
            )}
          </p>
          {requestId && (
            <Link
              className="link mt-3 inline-block"
              href="/admin/approvals?status=all"
            >
              {t("allRequests")}
            </Link>
          )}
        </div>
      )}
      {!requestId && queue.data && queue.data.total > 25 && (
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            disabled={page === 0 || queue.isFetching}
            onClick={() => {
              setPage(page - 1);
              navigateList({ page: page - 1 });
            }}
          >
            {t("previous")}
          </button>
          <button
            className="btn-secondary"
            disabled={(page + 1) * 25 >= queue.data.total || queue.isFetching}
            onClick={() => {
              setPage(page + 1);
              navigateList({ page: page + 1 });
            }}
          >
            {t("next")}
          </button>
        </div>
      )}
    </div>
  );
}

function LinkedQueue({ reviewer }: { reviewer: boolean }) {
  const params = useSearchParams();
  // A banner or detail link starts a fresh list view rather than retaining hidden filters.
  return (
    <ApprovalQueue
      key={params.toString()}
      reviewer={reviewer}
      requestId={params.get("request") ?? undefined}
      allStatuses={params.get("status") === "all"}
    />
  );
}

export function ManagementActions({ reviewer }: { reviewer: boolean }) {
  const t = useTranslations("approvals");
  return (
    <Suspense
      fallback={
        <p role="status" className="muted">
          {t("loading")}
        </p>
      }
    >
      <LinkedQueue reviewer={reviewer} />
    </Suspense>
  );
}
