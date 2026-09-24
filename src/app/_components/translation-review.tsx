"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { translationAccess } from "~/lib/translation-access";
import { Pager } from "./student-portal";

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
export function TranslationReview() {
  const t = useTranslations("translationEditor");
  const workflow = useTranslations("workflows");
  const format = useFormatter();
  const [page, setPage] = useState(0);
  const [state, setState] = useState<DraftState | "ALL">("PENDING");
  const [requested, setRequested] = useState<Record<string, string>>({});
  const me = api.account.me.useQuery();
  const access = translationAccess(me.data);
  const rows = api.translationReview.list.useQuery(
    { page, state: state === "ALL" ? undefined : state },
    { enabled: access.enter },
  );
  const utils = api.useUtils();
  const decide = api.translationReview.decide.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.translationReview.list.invalidate(),
        utils.localization.strings.invalidate(),
        utils.home.invalidate(),
      ]);
    },
    onError: (error, input) => {
      if (error.data?.approvalId) {
        const id = error.data.approvalId;
        setRequested((previous) => ({ ...previous, [input.id]: id }));
      }
    },
  });
  if (!access.enter) return null;
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
                disabled={decide.isPending || draft.needsResubmission}
                onClick={() =>
                  decide.mutate({
                    id: draft.id,
                    approve: true,
                    expectedUpdatedAt: draft.updatedAt,
                  })
                }
              >
                {workflow("approve")}
              </button>
              <button
                className="btn-secondary"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({
                    id: draft.id,
                    approve: false,
                    expectedUpdatedAt: draft.updatedAt,
                  })
                }
              >
                {workflow("rejectDraft")}
              </button>
            </div>
          )}
          {draft.state === "PENDING" && access.request && (
            <button
              className="btn-secondary"
              disabled={
                decide.isPending ||
                draft.needsResubmission ||
                !!requested[draft.id]
              }
              onClick={() =>
                decide.mutate({
                  id: draft.id,
                  approve: true,
                  expectedUpdatedAt: draft.updatedAt,
                })
              }
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
      {rows.error && (
        <p role="alert" className="text-red-700">
          {rows.error.message}
        </p>
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
