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
    <div>
      <h1 className="text-2xl font-bold">Punishments (per tutee)</h1>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (tuteeId) create.mutate({ tuteeId, reason: reason.trim() || undefined });
        }}
      >
        <select
          value={tuteeId}
          onChange={(e) => setTuteeId(e.target.value)}
          className="rounded border px-3 py-2"
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
          className="rounded border px-3 py-2"
        />
        <button className="rounded bg-indigo-600 px-4 py-2 font-semibold text-white">
          Add
        </button>
      </form>

      <table className="mt-6 w-full border-collapse rounded-lg border bg-white text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="p-3">Date</th>
            <th className="p-3">Tutee</th>
            <th className="p-3">Reason</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((p) => (
            <tr key={p.id} className="border-b">
              <td className="p-3">{new Date(p.date).toLocaleDateString()}</td>
              <td className="p-3">{p.tutee.englishName}</td>
              <td className="p-3">{p.reason}</td>
              <td className="p-3 text-right">
                <button
                  onClick={() => del.mutate({ id: p.id })}
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
