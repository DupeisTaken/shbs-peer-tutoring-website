"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { getQueryKey } from "@trpc/react-query";
import { translationAccess } from "~/lib/translation-access";
import { Pager } from "./student-portal";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { useSessionAccessDenied } from "./session-view-state";
import { viewAccessDenied } from "~/lib/session-view-state";

type DraftState = "PENDING" | "APPROVED" | "REJECTED";
const operationLabels: Record<
  string,
  "strings" | "content" | "news" | "sections" | "pages"
> = {
  "localization.setString": "strings",
  "home.setContent": "content",
  "home.setNewsTranslation": "news",
  "home.setSectionTranslation": "sections",
  "home.setPageTitle": "pages",
};

/** Review authority is independent of Translator assignment. Coordinator clicks queue
 * an Admin/Head request through the server; they never optimistically publish a draft. */
export function TranslationReview({
  concealed = false,
}: { concealed?: boolean } = {}) {
  const t = useTranslations("translationEditor");
  const workflow = useTranslations("workflows");
  const format = useFormatter();
  const [page, setPage] = useState(0);
  const [state, setState] = useState<DraftState | "ALL">("PENDING");
  const [requested, setRequested] = useState<Record<string, string>>({});
  const acceptedIds = useRef(new Set<string>());
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const admission = useRef(false);
  const synchronizationAllowed = useRef(false);
  const ownerActive = useRef(false);
  useLayoutEffect(() => {
    ownerActive.current = true;
    return () => {
      ownerActive.current = false;
    };
  }, []);
  const submittedRead = useRef<(() => Promise<unknown>) | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<Error | null>(null);
  const me = api.account.me.useQuery();
  const access = translationAccess(me.data);
  const reviewInput = { page, state: state === "ALL" ? undefined : state };
  const rows = api.translationReview.list.useQuery(reviewInput, {
    enabled: !concealed && access.enter,
  });
  const utils = api.useUtils();
  const denied = useSessionAccessDenied(
    ...[
      { ...me, queryKey: getQueryKey(api.account.me, undefined, "query") },
      {
        ...rows,
        denialKey: "review",
        queryKey: getQueryKey(api.translationReview.list, reviewInput, "query"),
      },
    ].map((query) => ({
      ...query,
      isSuccess: query.isSuccess && query.data != null,
    })),
  );
  useLayoutEffect(() => {
    synchronizationAllowed.current = !concealed && !denied && access.enter;
  });
  const refresh = async () => {
    setRefreshing(true);
    try {
      if (!ownerActive.current || !synchronizationAllowed.current)
        throw new Error(t("acceptedRefreshFailed"));
      const invalidations = await Promise.allSettled([
        invalidateAndReport(utils.translationReview.list),
        invalidateAndReport(utils.localization.strings),
        invalidateAndReport(utils.home),
      ]);
      if (!ownerActive.current || !synchronizationAllowed.current)
        throw new Error(t("acceptedRefreshFailed"));
      for (const result of invalidations) {
        if (
          result.status === "rejected" &&
          viewAccessDenied(result.reason as { data?: { code?: string } })
        )
          throw result.reason as unknown;
      }
      // Avoid default cancelRefetch cancelling the exact list fetch ourselves.
      await settleRefreshes([
        async () => {
          for (const result of invalidations)
            if (result.status === "rejected") throw result.reason as unknown;
        },
        async () => {
          await submittedRead.current?.();
        },
        async () => {
          await me.refetch({ throwOnError: true });
        },
      ]);
      setRefreshError(null);
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      setRefreshing(false);
    }
  };
  const decide = api.translationReview.decide.useMutation({
    onSuccess: async (_result, input) => {
      acceptedIds.current.add(input.id);
      setAccepted((previous) => new Set(previous).add(input.id));
      await refresh();
    },
    onError: async (error, input) => {
      if (error.data?.approvalId) {
        const id = error.data.approvalId;
        acceptedIds.current.add(input.id);
        setAccepted((previous) => new Set(previous).add(input.id));
        setRequested((previous) => ({ ...previous, [input.id]: id }));
        await refresh();
      }
    },
    onSettled: () => {
      admission.current = false;
    },
  });
  const missingRead = [me, rows].some(
    (query) => query.isSuccess && query.data == null,
  );
  const readError =
    me.error ?? rows.error ?? (missingRead ? new Error(t("readFailed")) : null);
  const blocked =
    concealed ||
    decide.isPending ||
    refreshing ||
    !!readError ||
    !!refreshError;
  const retryRead = () => {
    if (!ownerActive.current || concealed || refreshing || admission.current)
      return;
    if (refreshError && !denied) {
      void refresh();
      return;
    }
    setRefreshing(true);
    void settleRefreshes([
      async () => {
        await me.refetch();
      },
      async () => {
        await rows.refetch();
      },
    ])
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };
  const submitDecision = (
    id: string,
    approve: boolean,
    expectedUpdatedAt: Date,
  ) => {
    if (
      !ownerActive.current ||
      admission.current ||
      blocked ||
      acceptedIds.current.has(id) ||
      !access.enter
    )
      return;
    admission.current = true;
    const scope = { page, state: state === "ALL" ? undefined : state };
    submittedRead.current = async () => {
      const data = await utils.translationReview.list.fetch(scope, {
        staleTime: 0,
      });
      if (data == null) throw new Error(t("readFailed"));
    };
    decide.mutate({ id, approve, expectedUpdatedAt });
  };
  if (concealed) return null;
  if (denied || !access.enter)
    return (
      <div className="space-y-2">
        <p role="alert">{t("noAccess")}</p>
        {(denied || me.error) && (
          <button
            type="button"
            className="btn-secondary"
            disabled={refreshing}
            onClick={retryRead}
          >
            {t("retryRead")}
          </button>
        )}
      </div>
    );
  const decisionError = decide.error?.data?.approvalId ? null : decide.error;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="section-title">{t("review")}</h2>
          <p className="muted mt-1 text-sm">
            {t(access.request ? "coordinatorHelp" : "reviewHelp")}
          </p>
        </div>
        <label className="space-y-1 text-sm">
          <span className="label">{t("filter")}</span>
          <select
            className="select field-auto"
            value={state}
            aria-label={t("filter")}
            onChange={(event) => {
              setState(event.target.value as DraftState | "ALL");
              setPage(0);
            }}
          >
            {(["PENDING", "APPROVED", "REJECTED", "ALL"] as const).map(
              (value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      {rows.isLoading && <p role="status">{t("loading")}</p>}
      {!rows.isLoading && !rows.error && rows.data?.length === 0 && (
        <p className="card p-6">{t("empty")}</p>
      )}
      {rows.data?.map((draft) => (
        <article key={draft.id} className="card space-y-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold">
                {t(operationLabels[draft.operation] ?? "website")}
              </h3>
              <p className="muted mt-1 text-xs">
                {format.dateTime(draft.createdAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </div>
            <span
              className={
                draft.state === "PENDING" ? "badge-amber" : "badge-slate"
              }
            >
              {t(draft.state)}
            </span>
          </div>
          <dl className="grid min-w-0 gap-3 rounded-lg bg-slate-50 p-4">
            {Object.entries(draft.payload as Record<string, unknown>).map(
              ([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="text-xs font-semibold text-slate-500">
                    {t(
                      [
                        "locale",
                        "key",
                        "value",
                        "title",
                        "body",
                        "postId",
                        "sectionId",
                        "id",
                      ].includes(key)
                        ? `fields.${key}`
                        : "fields.other",
                    )}
                  </dt>
                  <dd className="mt-1 [overflow-wrap:anywhere] whitespace-pre-wrap">
                    {String(value)}
                  </dd>
                </div>
              ),
            )}
          </dl>
          {draft.needsResubmission && draft.state === "PENDING" && (
            <p className="text-sm text-amber-800">{t("resubmit")}</p>
          )}
          {draft.state === "PENDING" && access.publish && (
            <div className="flex flex-wrap gap-3">
              <button
                className="btn-primary"
                disabled={
                  blocked || accepted.has(draft.id) || draft.needsResubmission
                }
                onClick={() => submitDecision(draft.id, true, draft.updatedAt)}
              >
                {workflow("approve")}
              </button>
              <button
                className="btn-secondary"
                disabled={blocked || accepted.has(draft.id)}
                onClick={() => submitDecision(draft.id, false, draft.updatedAt)}
              >
                {workflow("rejectDraft")}
              </button>
            </div>
          )}
          {draft.state === "PENDING" && access.request && (
            <button
              className="btn-secondary"
              disabled={
                blocked ||
                accepted.has(draft.id) ||
                draft.needsResubmission ||
                !!requested[draft.id]
              }
              onClick={() => submitDecision(draft.id, true, draft.updatedAt)}
            >
              {t("requestApproval")}
            </button>
          )}
          {requested[draft.id] && (
            <p role="status" className="text-sm">
              {t("requested")}{" "}
              <Link
                className="link inline-flex min-h-11 items-center lg:min-h-9"
                href={`/admin/approvals?request=${encodeURIComponent(requested[draft.id] ?? "")}`}
              >
                {t("viewRequest")}
              </Link>
            </p>
          )}
          {/* Keep a failed decision next to its draft, even in a long review queue. */}
          {decisionError && decide.variables?.id === draft.id && (
            <p role="alert" className="text-red-700">
              {decisionError.message}
            </p>
          )}
        </article>
      ))}
      {(readError != null || refreshError != null) && (
        <div className="space-y-2">
          <p role="alert" className="text-red-700">
            {(readError ?? refreshError)?.message}
          </p>
          <p className="text-sm">
            {t(refreshError ? "acceptedRefreshFailed" : "readFailed")}
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={decide.isPending || refreshing}
            onClick={retryRead}
          >
            {t("retryRead")}
          </button>
        </div>
      )}
      {!!rows.data?.length && (
        <Pager page={page} setPage={setPage} more={rows.data.length === 30} />
      )}
      {page > 0 && rows.data?.length === 0 && (
        <Pager page={page} setPage={setPage} more={false} />
      )}
    </div>
  );
}
