"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { currentMonth } from "~/lib/time";

export default function SummaryPage() {
  const [month, setMonth] = useState(currentMonth());
  const [allTime, setAllTime] = useState(false);
  const summary = api.admin.monthlySummary.useQuery(
    allTime ? { allTime: true } : { month },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Tutor service hours</h1>
          <p className="muted mt-1 text-sm">
            {allTime ? "All-time totals" : "Monthly summary"} per tutor.
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
            {allTime ? "Showing all history" : "Show all history"}
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tutor</th>
              <th className="text-right">Earned</th>
              <th className="text-right">Extras</th>
              <th className="text-right">Penalties</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(summary.data?.rows ?? []).map((r) => (
              <tr key={r.tutorId} className={r.active ? "" : "text-slate-400"}>
                <td>
                  {r.englishName}
                  {!r.active && " (inactive)"}
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
