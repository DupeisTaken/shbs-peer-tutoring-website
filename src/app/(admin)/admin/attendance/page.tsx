"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { AttendanceCorrection } from "~/app/_components/attendance-correction";
import { useReadOnly } from "~/app/_components/read-only";
import { currentMonth } from "~/lib/time";

export default function SubmissionsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [tutorId, setTutorId] = useState("");
  const tutors = api.admin.tutors.useQuery();
  const sessions = api.admin.sessions.useQuery({
    month: month || undefined,
    tutorId: tutorId || undefined,
  });

  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("admin.submissions.title")}</h1>

      <div className="flex flex-wrap gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="input field-auto min-w-36"
        />
        <select
          value={tutorId}
          onChange={(e) => setTutorId(e.target.value)}
          className="select field-auto min-w-48"
        >
          <option value="">{t("admin.submissions.allTutors")}</option>
          {(tutors.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.englishName}
            </option>
          ))}
        </select>
      </div>

      {editingId && !readOnly && (
        <section className="card space-y-3 p-5">
          <button
            className="btn-secondary btn-sm"
            onClick={() => setEditingId(null)}
          >
            {t("common.cancel")}
          </button>
          <AttendanceCorrection key={editingId} id={editingId} />
        </section>
      )}
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("admin.submissions.colDate")}</th>
              <th>{t("admin.submissions.colTutor")}</th>
              <th>{t("admin.submissions.colSubject")}</th>
              <th>{t("admin.submissions.colStatus")}</th>
              <th>{t("admin.submissions.colTutees")}</th>
              <th className="text-right">{t("admin.submissions.colSH")}</th>
            </tr>
          </thead>
          <tbody>
            {(sessions.data ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  {new Date(s.date).toLocaleDateString(undefined, {
                    timeZone: "UTC",
                  })}
                </td>
                <td>{s.tutor.englishName}</td>
                <td>{s.pairing.subject}</td>
                <td className="text-slate-500">{s.tutorStatus}</td>
                <td>{s.tutees.map((t) => t.tutee.englishName).join(", ")}</td>
                <td className="text-right">
                  {s.shCount.toFixed(1)}
                  {!readOnly &&
                    (!s.mergeGroupId || s.mergeGroupId === s.id) && (
                      <button
                        className="link ml-2"
                        onClick={() => setEditingId(s.id)}
                      >
                        {t("corrections.editAttendance")}
                      </button>
                    )}
                </td>
              </tr>
            ))}
            {sessions.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="text-slate-500">
                  {t("admin.submissions.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
