"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { currentMonth } from "~/lib/time";

export default function SummaryPage() {
  const [month, setMonth] = useState(currentMonth());
  const summary = api.admin.monthlySummary.useQuery({ month });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Per-tutor monthly summary</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="input max-w-[12rem]"
        />
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
