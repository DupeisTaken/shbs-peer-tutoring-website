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
    <div className="space-y-6">
      <h1 className="page-title">Service-hour adjustments</h1>

      <form
        className="flex flex-wrap items-end gap-2"
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
          className="select max-w-xs"
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
          className="input max-w-[12rem]"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "PUNISHMENT" | "EXTRA")}
          className="select"
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
          className="input w-24"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="input max-w-xs"
        />
        <button className="btn-primary">Add</button>
      </form>
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tutor</th>
              <th>Month</th>
              <th>Type</th>
              <th className="text-right">Amount</th>
              <th>Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((a) => (
              <tr key={a.id}>
                <td>{a.tutor.englishName}</td>
                <td>{a.month}</td>
                <td className="text-slate-500">{a.type}</td>
                <td className="text-right">{a.amount.toFixed(1)}</td>
                <td>{a.reason}</td>
                <td className="text-right">
                  <button onClick={() => del.mutate({ id: a.id })} className="link-danger">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
