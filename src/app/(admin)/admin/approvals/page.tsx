"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import SuperJSON from "superjson";
import { api, type RouterOutputs } from "~/trpc/react";
import { humanizeOperation, proposalConfirmation } from "~/lib/approval-policy";
import { TimedActionDialog } from "~/app/_components/timed-action-dialog";

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
  const decision = api.approval.decide.useMutation({
    onSuccess: async () => {
      setConfirming(false);
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
  const records = Object.values(request.targets as Record<string, unknown>)
    .flatMap((value): unknown[] =>
      Array.isArray(value) ? (value as unknown[]) : [],
    )
    .map((item) => {
      if (item && typeof item === "object" && "record" in item) return item;
      return { record: item };
    });
  const labels = new Map<string, string>();
  for (const item of records) {
    const row = (item as { record?: Record<string, unknown> }).record;
    const surveyName =
      row?.payload &&
      typeof row.payload === "object" &&
      "englishName" in row.payload
        ? row.payload.englishName
        : null;
    if (row && typeof row.id === "string")
      labels.set(
        row.id,
        [row.englishName, row.name, row.title, surveyName, row.id].find(
          (value): value is string => typeof value === "string",
        ) ?? row.id,
      );
  }
  const display = (value: unknown): string => {
    if (value instanceof Date)
      return format.dateTime(value, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    if (typeof value === "string") return labels.get(value) ?? value;
    if (value === null || value === undefined) return "—";
    if (Array.isArray(value)) return value.map(display).join(", ") || "—";
    if (typeof value === "object")
      return Object.entries(value)
        .map(([key, v]) => `${humanizeOperation(key)}: ${display(v)}`)
        .join(" · ");
    return typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "—";
  };
  const fields =
    payload && typeof payload === "object"
      ? Object.entries(payload).filter(
          ([key]) => !["expectedUpdatedAt", "ticket"].includes(key),
        )
      : [];
  return (
    <article className="card overflow-hidden">
      {confirming && confirmation && (
        <TimedActionDialog
          action={confirmation.action}
          target={confirmation.target}
          title={t("approve")}
          message={t("confirmConsequences")}
          busy={decision.isPending}
          error={decision.error?.message}
          onCancel={() => setConfirming(false)}
          onConfirm={(ticket) =>
            decision.mutate({ id: request.id, approve: true, note, ticket })
          }
        >
          <dl className="space-y-3">
            {fields.map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs text-slate-500">
                  {key === "id"
                    ? t("record")
                    : humanizeOperation(key.replace(/Ids?$/, ""))}
                </dt>
                <dd className="text-sm break-words whitespace-pre-wrap">
                  {display(value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-sm whitespace-pre-wrap">{note}</p>
        </TimedActionDialog>
      )}
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {humanizeOperation(request.operation)}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {request.requesterName} ·{" "}
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
        <dl className="grid gap-x-6 gap-y-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
          {fields.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-xs font-medium text-slate-500">
                {key === "id"
                  ? t("record")
                  : humanizeOperation(key.replace(/Ids?$/, ""))}
              </dt>
              <dd className="mt-1 text-sm break-words whitespace-pre-wrap text-slate-900">
                {display(value)}
              </dd>
            </div>
          ))}
        </dl>
        <details>
          <summary className="link cursor-pointer text-sm">
            {t("evidence")}
          </summary>
          <div className="mt-3 space-y-3">
            {records.map((item, index) => {
              const row = (item as { record?: Record<string, unknown> }).record;
              return row ? (
                <dl
                  key={index}
                  className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2"
                >
                  {Object.entries(row)
                    .filter(
                      ([key]) =>
                        !["id", "createdAt", "updatedAt"].includes(key),
                    )
                    .map(([key, value]) => (
                      <div key={key} className="min-w-0 text-xs">
                        <dt className="text-slate-500">
                          {humanizeOperation(key)}
                        </dt>
                        <dd className="break-words whitespace-pre-wrap">
                          {display(value)}
                        </dd>
                      </div>
                    ))}
                </dl>
              ) : null;
            })}
          </div>
        </details>
        {request.reviewNote && (
          <div className="rounded-lg border-l-4 border-slate-300 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">
              {request.reviewerName} ·{" "}
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
            <label className="block">
              <span className="label">{t("note")}</span>
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
                className="btn-primary"
                disabled={busy || !note.trim()}
                onClick={() =>
                  confirmation
                    ? setConfirming(true)
                    : decision.mutate({ id: request.id, approve: true, note })
                }
              >
                {t("approve")}
              </button>
              <button
                className="btn-secondary"
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
        {pending && canCancel && (
          <button
            className="btn-secondary btn-sm"
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

function ApprovalQueue() {
  const t = useTranslations("approvals");
  const params = useSearchParams();
  const requestId = params.get("request") ?? undefined;
  const [state, setState] = useState<State | "">("PENDING");
  const [page, setPage] = useState(0);
  const [requesterId, setRequesterId] = useState("");
  const queue = api.approval.list.useQuery({
    state: requestId ? undefined : state || undefined,
    page,
    requesterId: requesterId || undefined,
    requestId,
  });
  const options = api.approval.requesters.useQuery(undefined, {
    enabled: !!queue.data?.canReview,
  });
  const refresh = async () => {
    await queue.refetch();
  };
  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">{t("title")}</h1>
        <p className="muted mt-2 max-w-2xl">{t("subtitle")}</p>
      </header>
      <div className="card flex flex-wrap items-end gap-3 p-4">
        {!requestId && (
          <div
            role="group"
            aria-label={t("status")}
            className="flex flex-wrap gap-2"
          >
            {(
              ["PENDING", "APPROVED", "REJECTED", "CANCELLED", ""] as const
            ).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={state === value}
                className={state === value ? "btn-primary" : "btn-secondary"}
                onClick={() => {
                  setState(value);
                  setPage(0);
                }}
              >
                {value ? t(`states.${value}`) : t("allStates")}
              </button>
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
              }}
            >
              <option value="">{t("allUsers")}</option>
              {options.data?.map((u) => (
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
          <Link className="link" href="/admin/approvals">
            {t("allRequests")}
          </Link>
        )}
        {queue.data && (
          <p className="muted ml-auto text-sm">
            {t("count", { count: queue.data.total })}
          </p>
        )}
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
            queue.data.canReview && request.requesterId !== queue.data.viewerId
          }
          canCancel={request.requesterId === queue.data.viewerId}
          onChanged={refresh}
        />
      ))}
      {queue.data?.total === 0 && (
        <div className="card p-10 text-center">
          <p className="font-medium text-slate-800">{t("empty")}</p>
          <p className="muted mt-2 text-sm">{t("emptyHint")}</p>
        </div>
      )}
      {queue.data && queue.data.total > 25 && (
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            disabled={page === 0 || queue.isFetching}
            onClick={() => setPage(page - 1)}
          >
            {t("previous")}
          </button>
          <button
            className="btn-secondary"
            disabled={(page + 1) * 25 >= queue.data.total || queue.isFetching}
            onClick={() => setPage(page + 1)}
          >
            {t("next")}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ApprovalPage() {
  return (
    <Suspense>
      <ApprovalQueue />
    </Suspense>
  );
}
