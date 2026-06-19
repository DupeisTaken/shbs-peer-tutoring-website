"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

export default function PunishmentsPage() {
  const utils = api.useUtils();
  const tutees = api.admin.tutees.useQuery();
  const list = api.admin.punishments.useQuery();
  const invalidate = () => utils.admin.punishments.invalidate();
  const create = api.admin.createPunishment.useMutation({ onSuccess: invalidate });
  const del = api.admin.deletePunishment.useMutation({ onSuccess: invalidate });

  const [tuteeId, setTuteeId] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div className="space-y-6">
      <h1 className="page-title">Punishments (per tutee)</h1>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (tuteeId) create.mutate({ tuteeId, reason: reason.trim() || undefined });
        }}
      >
        <select
          value={tuteeId}
          onChange={(e) => setTuteeId(e.target.value)}
          className="select max-w-xs"
        >
          <option value="">Tutee…</option>
          {(tutees.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.englishName}
            </option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="input max-w-xs"
        />
        <button className="btn-primary">Add</button>
      </form>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Tutee</th>
              <th>Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((p) => (
              <tr key={p.id}>
                <td>{new Date(p.date).toLocaleDateString()}</td>
                <td>{p.tutee.englishName}</td>
                <td>{p.reason}</td>
                <td className="text-right">
                  <button onClick={() => del.mutate({ id: p.id })} className="link-danger">
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
