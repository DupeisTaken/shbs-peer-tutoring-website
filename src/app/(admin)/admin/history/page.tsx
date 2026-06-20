"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

type Scope = "year" | "S1" | "S2" | "Q1" | "Q2" | "Q3" | "Q4";

export default function HistoryPage() {
  const t = useTranslations();
  const periods = api.admin.periods.useQuery();

  // School years that have ever existed, newest first.
  const years = useMemo(() => {
    const set = new Set((periods.data ?? []).map((p) => p.schoolYear));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [periods.data]);

  const [schoolYear, setSchoolYear] = useState<string>("");
  const [scope, setScope] = useState<Scope>("year");
  const activeYear = schoolYear !== "" ? schoolYear : (years[0] ?? "");

  const summary = api.admin.periodSummary.useQuery(
    {
      schoolYear: activeYear,
      ...(scope === "year" ? {} : scope === "S1" || scope === "S2" ? { semester: scope } : { quarter: scope }),
    },
    { enabled: !!activeYear },
  );

  const totals = summary.data?.totals;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.history.title")}</h1>
        <p className="muted mt-1">{t("admin.history.subtitle")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="label">{t("admin.history.schoolYear")}</span>
          <select
            value={activeYear}
            onChange={(e) => setSchoolYear(e.target.value)}
            className="select w-40"
          >
            {years.length === 0 && <option value="">—</option>}
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="label">{t("admin.history.scope")}</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            className="select w-48"
          >
            <option value="year">{t("admin.history.wholeYear")}</option>
            <option value="S1">{t("admin.history.s1")}</option>
            <option value="S2">{t("admin.history.s2")}</option>
            <option value="Q1">Q1</option>
            <option value="Q2">Q2</option>
            <option value="Q3">Q3</option>
            <option value="Q4">Q4</option>
          </select>
        </label>
        {summary.data && (
          <span className="badge-slate mb-1">{summary.data.scope.label}</span>
        )}
      </div>

      {/* Program totals for the selected period */}
      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t("admin.history.totals.total")} value={totals.total.toFixed(1)} primary />
          <Stat label={t("admin.history.totals.earned")} value={totals.earned.toFixed(1)} />
          <Stat label={t("admin.history.totals.sessions")} value={String(totals.sessions)} />
          <Stat label={t("admin.history.totals.present")} value={String(totals.present)} />
          <Stat label={t("admin.history.totals.excused")} value={String(totals.excused)} />
          <Stat label={t("admin.history.totals.unexcused")} value={String(totals.unexcused)} />
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.history.columns.tutor")}</th>
              <th className="text-right">{t("admin.history.columns.sessions")}</th>
              <th className="text-right">{t("admin.history.columns.earned")}</th>
              <th className="text-right">{t("admin.history.columns.extras")}</th>
              <th className="text-right">{t("admin.history.columns.penalties")}</th>
              <th className="text-right">{t("admin.history.columns.total")}</th>
            </tr>
          </thead>
          <tbody>
            {(summary.data?.rows ?? [])
              .filter((r) => r.sessions > 0 || r.earned !== 0 || r.extras !== 0 || r.punishments !== 0)
              .map((r) => (
                <tr key={r.tutorId} className={r.active ? "" : "text-slate-400"}>
                  <td>
                    {r.englishName}
                    {!r.active && ` ${t("admin.history.inactive")}`}
                  </td>
                  <td className="text-right">{r.sessions}</td>
                  <td className="text-right">{r.earned.toFixed(1)}</td>
                  <td className="text-right">{r.extras.toFixed(1)}</td>
                  <td className="text-right">{r.punishments.toFixed(1)}</td>
                  <td className="text-right font-semibold">{r.total.toFixed(1)}</td>
                </tr>
              ))}
            {summary.data?.rows.every(
              (r) => r.sessions === 0 && r.earned === 0 && r.extras === 0 && r.punishments === 0,
            ) && (
              <tr>
                <td colSpan={6} className="text-slate-500">
                  {t("admin.history.noData")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  return (
    <div className="card p-3">
      <p className="muted text-xs">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${primary ? "text-indigo-700" : "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}
