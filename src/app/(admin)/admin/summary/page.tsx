"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { currentMonth } from "~/lib/time";

export default function SummaryPage() {
  const t = useTranslations();
  const [month, setMonth] = useState(currentMonth());
  const [allTime, setAllTime] = useState(false);
  const summary = api.admin.monthlySummary.useQuery(
    allTime ? { allTime: true } : { month },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{t("admin.summary.title")}</h1>
          <p className="muted mt-1 text-sm">
            {allTime ? t("admin.summary.subtitleAllTime") : t("admin.summary.subtitleMonthly")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={allTime}
            className="input max-w-[12rem] disabled:opacity-50"
          />
          <button
            className={allTime ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
            onClick={() => setAllTime((v) => !v)}
          >
            {allTime ? t("admin.summary.showingAllHistory") : t("admin.summary.showAllHistory")}
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.summary.columns.tutor")}</th>
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
