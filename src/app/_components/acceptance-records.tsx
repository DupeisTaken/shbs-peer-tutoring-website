"use client";
import { useState } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { localizedSnapshot } from "~/lib/policy-evidence";
import { Markdown } from "./markdown";

/** Mounted only inside the selected user's dialog. The user key resets pagination
 * and the API scopes every history page; current text never replaces past evidence. */
export function AcceptanceRecords({ userId }: { userId: string }) {
  const format = useFormatter();
  const locale = useLocale();
  const t = useTranslations("policyHistory");
  const [page, setPage] = useState(0);
  const query = api.student.acceptanceRecords.useQuery({ userId, page });
  return (
    <section className="space-y-4 border-t border-slate-200 pt-5">
      <h3 className="font-semibold">{t("title")}</h3>
      {query.isLoading && <p role="status">{t("loading")}</p>}
      {query.error && (
        <div role="alert">
          <p>{query.error.message}</p>
          <button
            className="btn-secondary mt-2"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </button>
        </div>
      )}
      {query.data?.current.map((policy) => {
        const doc = localizedSnapshot(policy.documents, locale);
        return (
          <div key={policy.slug} className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium">
              {doc?.title ??
                t(
                  policy.slug === "tutor-policy"
                    ? "tutorPolicy"
                    : "studentPolicy",
                )}
              {doc?.version ? ` · ${doc.version}` : ""}
            </p>
            <p>
              {t(
                !policy.published
                  ? "unpublished"
                  : policy.acceptedAt
                    ? "currentAccepted"
                    : "pending",
              )}
            </p>
            {policy.acceptedAt && (
              <p className="muted">
                {format.dateTime(policy.acceptedAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            )}
          </div>
        );
      })}
      {query.data?.rows.length === 0 && (
        <p className="muted text-sm">{t("empty")}</p>
      )}
      {query.data?.rows.map((row) => {
        const doc = localizedSnapshot(row.documents, locale);
        return (
          <details
            key={row.id}
            className="rounded-lg border border-slate-200 p-3 text-sm"
          >
            <summary className="cursor-pointer space-y-1 [overflow-wrap:anywhere]">
              <span className="font-medium">
                {doc?.title ??
                  t(
                    row.slug === "tutor-policy"
                      ? "tutorPolicy"
                      : "studentPolicy",
                  )}
                {doc?.version ? ` · ${doc.version}` : ""}
              </span>
              <span className="mt-1 block text-slate-600">
                {t("acceptedAt", {
                  date: format.dateTime(row.acceptedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })}
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                {t("expand")}
              </span>
            </summary>
            <p className="mt-3 [overflow-wrap:anywhere]">
              {t("signature", { name: row.signature })}
            </p>
            {row.documents.length === 0 ? (
              <p className="muted mt-3">{t("unavailable")}</p>
            ) : (
              row.documents.map((document) => (
                <details
                  key={document.locale}
                  open={document.locale === doc?.locale}
                  className="mt-3"
                >
                  <summary className="cursor-pointer font-medium">
                    {document.title} · {document.locale}
                    {document.version ? ` · ${document.version}` : ""}
                  </summary>
                  <div
                    className="mt-3 max-h-80 overflow-y-auto rounded-lg bg-slate-50 p-3 [overflow-wrap:anywhere]"
                    tabIndex={0}
                  >
                    <Markdown>{document.body}</Markdown>
                  </div>
                </details>
              ))
            )}
          </details>
        );
      })}
      {query.data && (page > 0 || query.data.more) && (
        <div className="flex justify-between gap-3">
          <button
            className="btn-secondary btn-sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("previous")}
          </button>
          <button
            className="btn-secondary btn-sm"
            disabled={!query.data.more}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
          </button>
        </div>
      )}
    </section>
  );
}
