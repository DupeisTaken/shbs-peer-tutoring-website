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
    <div className="space-y-6">
      <h1 className="page-title">Submissions</h1>

      <div className="flex flex-wrap gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="input max-w-[12rem]"
        />
        <select
          value={tutorId}
          onChange={(e) => setTutorId(e.target.value)}
          className="select max-w-xs"
        >
          <option value="">All tutors</option>
          {(tutors.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.englishName}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Tutor</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Tutees</th>
              <th className="text-right">SH</th>
            </tr>
          </thead>
          <tbody>
            {(sessions.data ?? []).map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.date).toLocaleDateString()}</td>
                <td>{s.tutor.englishName}</td>
                <td>{s.pairing.subject}</td>
                <td className="text-slate-500">{s.tutorStatus}</td>
                <td>{s.tutees.map((t) => t.tutee.englishName).join(", ")}</td>
                <td className="text-right">{s.shCount.toFixed(1)}</td>
              </tr>
            ))}
            {sessions.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="text-slate-500">
                  No submissions for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
