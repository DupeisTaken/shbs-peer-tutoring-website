"use client";
import { TranslationComposer } from "./translation-composer";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Pager } from "./student-portal";
export function TranslationReview() {
  const t = useTranslations("workflows");
  const [page, setPage] = useState(0);
  const rows = api.translationReview.list.useQuery({ page });
  const me = api.account.me.useQuery();
  const staff =
    me.data && ["HEAD", "ADMIN", "COORDINATOR"].includes(me.data.role);
  const decide = api.translationReview.decide.useMutation({
    onSuccess: () => rows.refetch(),
  });
  return (
    <div className="space-y-4">
      <p className="muted">{t("draftNotice")}</p>
      {!staff && me.data && <TranslationComposer />}
      {rows.data?.length === 0 && <p className="card p-6">{t("empty")}</p>}
      {rows.data?.map((d) => (
        <article key={d.id} className="card space-y-4 p-6">
          <div className="flex flex-wrap justify-between gap-2">
            <h2 className="font-semibold">{d.operation}</h2>
            <span className="badge-slate">{d.state}</span>
          </div>
          <dl className="space-y-3">
            {Object.entries(d.payload as Record<string, unknown>).map(
              ([key, value]) => (
                <div key={key}>
                  <dt className="text-xs font-semibold text-slate-500 uppercase">
                    {key}
                  </dt>
                  <dd className="break-words whitespace-pre-wrap">
                    {String(value)}
                  </dd>
                </div>
              ),
            )}
          </dl>
          {staff && d.state === "PENDING" && (
            <div className="flex gap-3">
              {[true, false].map((approve) => (
                <button
                  key={String(approve)}
                  className={approve ? "btn-primary" : "btn-secondary"}
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate({
                      id: d.id,
                      approve,
                      expectedUpdatedAt: d.updatedAt,
                    })
                  }
                >
                  {t(approve ? "approve" : "rejectDraft")}
                </button>
              ))}
            </div>
          )}
        </article>
      ))}
      {(rows.error ?? decide.error) && (
        <p role="alert">{(rows.error ?? decide.error)?.message}</p>
      )}
      <Pager page={page} setPage={setPage} more={rows.data?.length === 30} />
    </div>
  );
}
