"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Pager } from "./student-portal";
export function AcceptanceRecords() {
  const programFormat = useFormatter();
  const t = useTranslations("workflows");
  const [page, setPage] = useState(0);
  const rows = api.student.acceptanceRecords.useQuery({ page });
  return (
    <section className="card space-y-4 p-6">
      <h2 className="section-title">{t("policy")}</h2>
      {rows.data?.map((r) => (
        <details key={r.id} className="rounded-lg border border-slate-200 p-4">
          <summary className="cursor-pointer">
            {r.name} · {r.slug} · {programFormat.dateTime(r.acceptedAt, { dateStyle: "medium", timeStyle: "short" })}
          </summary>
          <p className="mt-3 font-mono text-xs break-all">{r.revision}</p>
          <p>{r.signature}</p>
          <pre className="mt-3 max-h-72 overflow-auto text-xs break-words whitespace-pre-wrap">
            {JSON.stringify(r.snapshot, null, 2)}
          </pre>
        </details>
      ))}
      {rows.error && <p role="alert">{rows.error.message}</p>}
      <Pager page={page} setPage={setPage} more={rows.data?.length === 20} />
    </section>
  );
}
