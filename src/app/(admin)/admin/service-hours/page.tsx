"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

export default function SummaryPage() {
  const t = useTranslations();
  // Empty → the active period's current semester; a month ("YYYY-MM") narrows to that month.
  const [month, setMonth] = useState("");
  const summary = api.admin.periodSummary.useQuery(month ? { month } : undefined);
  const scope = summary.data?.scope.label;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{t("admin.summary.title")}</h1>
          <p className="muted mt-1 text-sm">
            {scope
              ? t("admin.summary.scope", { label: scope })
              : t("admin.summary.subtitleMonthly")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="muted text-sm">{t("admin.summary.monthLabel")}</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="input w-[10rem]"
          />
          {month && (
            <button className="link text-sm" onClick={() => setMonth("")}>
              {t("admin.summary.clearMonth")}
            </button>
          )}
          <Link href="/admin/history" className="btn-secondary btn-sm">
            {t("admin.summary.viewHistory")}
          </Link>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.summary.columns.tutor")}</th>
              <th className="text-right">{t("admin.summary.columns.sessions")}</th>
              <th className="text-right">{t("admin.summary.columns.earned")}</th>
              <th className="text-right">{t("admin.summary.columns.extras")}</th>
              <th className="text-right">{t("admin.summary.columns.penalties")}</th>
              <th className="text-right">{t("admin.summary.columns.total")}</th>
            </tr>
          </thead>
          <tbody>
            {(summary.data?.rows ?? []).map((r) => (
              <tr key={r.tutorId} className={r.active ? "" : "text-slate-400"}>
                <td>
                  {r.englishName}
                  {!r.active && ` ${t("admin.summary.inactive")}`}
                </td>
                <td className="text-right">{r.sessions}</td>
                <td className="text-right">{r.earned.toFixed(1)}</td>
                <td className="text-right">{r.extras.toFixed(1)}</td>
                <td className="text-right">{r.punishments.toFixed(1)}</td>
                <td className="text-right font-semibold">{r.total.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
