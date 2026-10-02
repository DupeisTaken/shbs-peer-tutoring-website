"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { AttendanceCorrection } from "~/app/_components/attendance-correction";
import { useReadOnly } from "~/app/_components/read-only";
import { currentMonth } from "~/lib/time";
import {
  SummaryTable,
  TableActions,
  TableDetails,
} from "~/app/_components/ui/summary-table";
import { visibleTutors } from "~/lib/tutor-visibility";
import { PastTutorsToggle } from "~/app/_components/past-tutors-toggle";

export default function SubmissionsPage() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const readOnly = useReadOnly();
  const [month, setMonth] = useState(currentMonth());
  const [tutorId, setTutorId] = useState("");
  const tutors = api.admin.tutors.useQuery();
  const [showPast, setShowPast] = useState(false);
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
          {visibleTutors(tutors.data ?? [], showPast, [tutorId]).map((t) => (
            <option key={t.id} value={t.id}>
              {t.englishName}
            </option>
          ))}
        </select>
        <PastTutorsToggle showPast={showPast} onChange={setShowPast} />
      </div>

      <div className="card">
        <SummaryTable label={t("admin.submissions.title")}>
          <thead>
            <tr>
              <th>{t("admin.submissions.colDate")}</th>
              <th>{t("admin.submissions.colTutor")}</th>
              <th>{t("admin.submissions.colSubject")}</th>
              <th>{t("admin.submissions.colStatus")}</th>
              <th>{t("admin.submissions.colTutees")}</th>
              <th className="text-right">{t("admin.submissions.colSH")}</th>
              <th className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {(sessions.data ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  {programFormat.dateTime(new Date(s.date), {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  })}
                </td>
                <td>{s.tutor.englishName}</td>
                <td>{s.pairing.subject}</td>
                <td className="text-slate-500">
                  {t(`tutor.attendance.tutorStatusOpt.${s.tutorStatus}`)}
                </td>
                <td>{s.tutees.length}</td>
                <td className="text-right">{s.shCount.toFixed(1)}</td>
                <TableActions>
                  <TableDetails
                    title={`${s.tutor.englishName} · ${s.pairing.subject}`}
                  >
                    <p>
                      {programFormat.dateTime(new Date(s.date), {
                        dateStyle: "full",
                        timeZone: "UTC",
                      })}{" "}
                      · {t(`tutor.attendance.tutorStatusOpt.${s.tutorStatus}`)}
                    </p>
                    <h3 className="font-semibold">
                      {t("admin.submissions.colTutees")}
                    </h3>
                    <ul className="list-inside list-disc">
                      {s.tutees.map((entry, index) => (
                        <li key={index}>{entry.tutee.englishName}</li>
                      ))}
                    </ul>
                    <p>
                      {t("admin.submissions.colSH")}: {s.shCount.toFixed(1)}
                    </p>
                  </TableDetails>
                  {!readOnly &&
                    (!s.mergeGroupId || s.mergeGroupId === s.id) && (
                      <TableDetails
                        label={t("corrections.editAttendance")}
                        title={`${s.tutor.englishName} · ${s.pairing.subject}`}
                      >
                        <AttendanceCorrection id={s.id} />
                      </TableDetails>
                    )}
                </TableActions>
              </tr>
            ))}
            {sessions.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="text-slate-500">
                  {t("admin.submissions.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </SummaryTable>
      </div>
    </div>
  );
}
