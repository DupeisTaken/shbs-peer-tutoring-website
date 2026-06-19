"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { currentMonth } from "~/lib/time";

export default function SummaryPage() {
  const [month, setMonth] = useState(currentMonth());
  const summary = api.admin.monthlySummary.useQuery({ month });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Per-tutor monthly summary</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border px-3 py-2"
        />
      </div>

      <table className="mt-6 w-full border-collapse rounded-lg border bg-white text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="p-3">Tutor</th>
            <th className="p-3 text-right">Earned</th>
            <th className="p-3 text-right">Extras</th>
            <th className="p-3 text-right">Penalties</th>
            <th className="p-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {(summary.data?.rows ?? []).map((r) => (
            <tr key={r.tutorId} className={r.active ? "border-b" : "border-b text-gray-400"}>
              <td className="p-3">
                {r.englishName}
                {!r.active && " (inactive)"}
              </td>
              <td className="p-3 text-right">{r.earned.toFixed(1)}</td>
              <td className="p-3 text-right">{r.extras.toFixed(1)}</td>
              <td className="p-3 text-right">{r.punishments.toFixed(1)}</td>
              <td className="p-3 text-right font-semibold">{r.total.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
