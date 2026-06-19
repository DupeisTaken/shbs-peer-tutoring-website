"use client";

import { useState } from "react";

import { api } from "~/trpc/react";
import { currentMonth } from "~/lib/time";

export default function SubmissionsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [tutorId, setTutorId] = useState("");
  const tutors = api.admin.tutors.useQuery();
  const sessions = api.admin.sessions.useQuery({
    month: month || undefined,
    tutorId: tutorId || undefined,
  });

  return (
    <div>
      <h1 className="text-2xl font-bold">Submissions</h1>

      <div className="mt-4 flex flex-wrap gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border px-3 py-2"
        />
        <select
          value={tutorId}
          onChange={(e) => setTutorId(e.target.value)}
          className="rounded border px-3 py-2"
        >
          <option value="">All tutors</option>
          {(tutors.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.englishName}
            </option>
          ))}
        </select>
      </div>

      <table className="mt-6 w-full border-collapse rounded-lg border bg-white text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="p-3">Date</th>
            <th className="p-3">Tutor</th>
            <th className="p-3">Subject</th>
            <th className="p-3">Status</th>
            <th className="p-3">Tutees</th>
            <th className="p-3 text-right">SH</th>
          </tr>
        </thead>
        <tbody>
          {(sessions.data ?? []).map((s) => (
            <tr key={s.id} className="border-b">
              <td className="p-3">{new Date(s.date).toLocaleDateString()}</td>
              <td className="p-3">{s.tutor.englishName}</td>
              <td className="p-3">{s.pairing.subject}</td>
              <td className="p-3">{s.status}</td>
              <td className="p-3">
                {s.tutees.map((t) => t.tutee.englishName).join(", ")}
              </td>
              <td className="p-3 text-right">{s.shCount.toFixed(1)}</td>
            </tr>
          ))}
          {sessions.data?.length === 0 && (
            <tr>
              <td colSpan={6} className="p-4 text-gray-500">
                No submissions for this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
