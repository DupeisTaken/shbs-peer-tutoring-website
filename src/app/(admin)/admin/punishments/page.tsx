"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { currentMonth } from "~/lib/time";

/**
 * Tutor punishments — recorded as PUNISHMENT-type service-hour adjustments (they deduct from
 * the tutor's monthly total). Tutee discipline is handled separately by the card system
 * (/admin/cards).
 */
export default function PunishmentsPage() {
  const utils = api.useUtils();
  const tutors = api.admin.tutors.useQuery();
  const list = api.admin.adjustments.useQuery({});
  const invalidate = () => utils.admin.adjustments.invalidate();
  const create = api.admin.createAdjustment.useMutation({ onSuccess: invalidate });
  const del = api.admin.deleteAdjustment.useMutation({ onSuccess: invalidate });

  const [tutorId, setTutorId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");

  // This page only deals with deductions (punishments).
  const punishments = (list.data ?? []).filter((a) => a.type === "PUNISHMENT");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Punishments (tutor hour deductions)</h1>
        <p className="muted mt-1">
          Deduct service hours from a tutor for the given month. Tutee yellow/red cards are
          managed under{" "}
          <a href="/admin/cards" className="link">
            Discipline · cards
          </a>
          .
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const amt = Number(amount);
          if (tutorId && amt > 0)
            create.mutate(
              { tutorId, month, type: "PUNISHMENT", amount: amt, reason: reason.trim() || undefined },
              { onSuccess: () => setReason("") },
            );
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
        <input
          type="number"
          step="0.25"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input w-24"
          aria-label="Hours to deduct"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="input max-w-xs"
        />
        <button className="btn-primary">Deduct hours</button>
      </form>
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tutor</th>
              <th>Month</th>
              <th className="text-right">Hours deducted</th>
              <th>Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {punishments.map((a) => (
              <tr key={a.id}>
                <td>{a.tutor.englishName}</td>
                <td>{a.month}</td>
                <td className="text-right">−{a.amount.toFixed(2)}</td>
                <td>{a.reason}</td>
                <td className="text-right">
                  <button onClick={() => del.mutate({ id: a.id })} className="link-danger">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {punishments.length === 0 && (
              <tr>
                <td colSpan={5} className="text-slate-500">
                  No punishments recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
