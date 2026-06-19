"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { currentMonth } from "~/lib/time";

export default function AdjustmentsPage() {
  const utils = api.useUtils();
  const tutors = api.admin.tutors.useQuery();
  const list = api.admin.adjustments.useQuery({});
  const invalidate = () => utils.admin.adjustments.invalidate();
  const create = api.admin.createAdjustment.useMutation({ onSuccess: invalidate });
  const del = api.admin.deleteAdjustment.useMutation({ onSuccess: invalidate });

  const [tutorId, setTutorId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [type, setType] = useState<"PUNISHMENT" | "EXTRA">("EXTRA");
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");

  return (
    <div>
      <h1 className="text-2xl font-bold">Service-hour adjustments</h1>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const amt = Number(amount);
          if (tutorId && amt > 0)
            create.mutate({
              tutorId,
              month,
              type,
              amount: amt,
              reason: reason.trim() || undefined,
            });
        }}
      >
        <select
          value={tutorId}
          onChange={(e) => setTutorId(e.target.value)}
          className="rounded border px-3 py-2"
        >
          <option value="">Tutor…</option>
          {(tutors.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.englishName}
            </option>
          ))}
        </select>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border px-3 py-2"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "PUNISHMENT" | "EXTRA")}
          className="rounded border px-3 py-2"
        >
          <option value="EXTRA">Extra (+)</option>
          <option value="PUNISHMENT">Punishment (−)</option>
        </select>
        <input
          type="number"
          step="0.5"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-24 rounded border px-3 py-2"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="rounded border px-3 py-2"
        />
        <button className="rounded bg-indigo-600 px-4 py-2 font-semibold text-white">
          Add
        </button>
      </form>
      {create.error && <p className="mt-1 text-sm text-red-600">{create.error.message}</p>}

      <table className="mt-6 w-full border-collapse rounded-lg border bg-white text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="p-3">Tutor</th>
            <th className="p-3">Month</th>
            <th className="p-3">Type</th>
            <th className="p-3 text-right">Amount</th>
            <th className="p-3">Reason</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((a) => (
            <tr key={a.id} className="border-b">
              <td className="p-3">{a.tutor.englishName}</td>
              <td className="p-3">{a.month}</td>
              <td className="p-3">{a.type}</td>
              <td className="p-3 text-right">{a.amount.toFixed(1)}</td>
              <td className="p-3">{a.reason}</td>
              <td className="p-3 text-right">
                <button
                  onClick={() => del.mutate({ id: a.id })}
                  className="text-red-600 hover:underline"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
