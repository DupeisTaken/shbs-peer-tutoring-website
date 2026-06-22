"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { useReadOnly } from "~/app/_components/read-only";

/** The statuses an admin picks directly. EXEMPT (X) is auto-applied to inactive tutors. */
const ATTENDANCE_OPTIONS = [
  { value: "PRESENT", labelKey: "admin.meetings.status.present" },
  { value: "EXCUSED_ABSENT", labelKey: "admin.meetings.status.excusedAbsent" },
  { value: "UNEXCUSED_ABSENT", labelKey: "admin.meetings.status.unexcusedAbsent" },
] as const;
type MeetingStatus = "PRESENT" | "EXCUSED_ABSENT" | "UNEXCUSED_ABSENT" | "EXEMPT";

export default function MeetingsPage() {
  const t = useTranslations();
  const readOnly = useReadOnly();
  const utils = api.useUtils();
  const meetings = api.admin.meetings.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const invalidate = () => utils.admin.meetings.invalidate();
  const create = api.admin.createMeeting.useMutation({ onSuccess: invalidate });
  const del = api.admin.deleteMeeting.useMutation({ onSuccess: invalidate });

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("12:00");
  const [selected, setSelected] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("admin.meetings.title")}</h1>
        <button className="btn-secondary btn-sm" onClick={() => setShowSummary((v) => !v)}>
          {showSummary ? t("admin.meetings.summary.hide") : t("admin.meetings.summary.show")}
        </button>
      </div>

      {showSummary && (
        <MeetingSummary meetings={meetings.data ?? []} tutors={tutors.data ?? []} />
      )}

      {!readOnly && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) {
              create.mutate({ title: title.trim(), date: new Date(`${date}T${time || "00:00"}`) });
              setTitle("");
            }
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("admin.meetings.titlePlaceholder")}
            className="input field-auto min-w-48"
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input field-auto min-w-36"
          />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label={t("admin.meetings.timeLabel")}
            className="input field-auto min-w-28"
          />
          <button className="btn-primary" disabled={!title.trim() || create.isPending}>
            {t("admin.meetings.create")}
          </button>
        </form>
      )}

      <div className="card overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {(meetings.data ?? []).map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setSelected(selected === m.id ? null : m.id)}
                  className="text-left font-medium text-slate-900 hover:text-accent-600"
                >
                  {m.title} · {new Date(m.date).toLocaleString()}
                </button>
                {!readOnly && (
                  <button onClick={() => del.mutate({ id: m.id })} className="link-danger">
                    {t("admin.meetings.delete")}
                  </button>
                )}
              </div>
              {selected === m.id && (
                <AttendanceEditor
                  meetingId={m.id}
                  readOnly={readOnly}
                  tutors={tutors.data ?? []}
                  current={Object.fromEntries(
                    m.attendances.map((a) => [a.tutorId, a.status]),
                  )}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Read-only matrix: every tutor (rows) × every meeting (columns), showing attendance at a glance.
 *  Inactive tutors are exempt (X); cells with no record show a dot. */
function MeetingSummary({
  meetings,
  tutors,
}: {
  meetings: { id: string; title: string; date: Date; attendances: { tutorId: string; status: string }[] }[];
  tutors: { id: string; englishName: string; active: boolean }[];
}) {
  const t = useTranslations();
  const byMeeting = new Map<string, Map<string, string>>();
  for (const m of meetings) {
    const inner = new Map<string, string>();
    for (const a of m.attendances) inner.set(a.tutorId, a.status);
    byMeeting.set(m.id, inner);
  }

  const cell = (status: string | undefined, active: boolean) => {
    if (!active) return { text: "X", cls: "text-slate-400", title: t("admin.meetings.exempt") };
    switch (status) {
      case "PRESENT":
        return { text: "P", cls: "text-green-600", title: t("admin.meetings.status.present") };
      case "EXCUSED_ABSENT":
        return { text: "EA", cls: "text-amber-600", title: t("admin.meetings.status.excusedAbsent") };
      case "UNEXCUSED_ABSENT":
        return { text: "UA", cls: "text-red-600", title: t("admin.meetings.status.unexcusedAbsent") };
      default:
        return { text: "·", cls: "text-slate-300", title: "—" };
    }
  };

  return (
    <div className="card overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white">{t("admin.meetings.summary.tutor")}</th>
            {meetings.map((m) => (
              <th key={m.id} className="text-center whitespace-nowrap" title={m.title}>
                {new Date(m.date).toLocaleDateString()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tutors.map((tu) => (
            <tr key={tu.id} className={tu.active ? "" : "text-slate-400"}>
              <th className="sticky left-0 z-10 bg-white text-left font-medium whitespace-nowrap text-slate-700">
                {tu.englishName}
              </th>
              {meetings.map((m) => {
                const c = cell(byMeeting.get(m.id)?.get(tu.id), tu.active);
                return (
                  <td key={m.id} className={`text-center text-xs font-semibold ${c.cls}`} title={c.title}>
                    {c.text}
                  </td>
                );
              })}
            </tr>
          ))}
          {(meetings.length === 0 || tutors.length === 0) && (
            <tr>
              <td className="text-slate-500">{t("admin.meetings.summary.noMeetings")}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AttendanceEditor({
  meetingId,
  readOnly,
  tutors,
  current,
}: {
  meetingId: string;
  readOnly: boolean;
  tutors: { id: string; englishName: string; active: boolean }[];
  current: Record<string, string>;
}) {
  const t = useTranslations();
  const utils = api.useUtils();
  const [draft, setDraft] = useState<Record<string, MeetingStatus>>(
    () => current as Record<string, MeetingStatus>,
  );
  const save = api.admin.recordMeetingAttendance.useMutation({
    onSuccess: () => utils.admin.meetings.invalidate(),
  });

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="space-y-1.5">
        {tutors.map((tu) => {
          // Inactive (unavailable) tutors are exempt (X) — shown grayed and not editable.
          if (!tu.active) {
            return (
              <div
                key={tu.id}
                className="flex items-center justify-between gap-2 text-sm text-slate-400"
              >
                <span>{tu.englishName}</span>
                <span className="badge-slate">{t("admin.meetings.exempt")}</span>
              </div>
            );
          }
          const value = draft[tu.id];
          return (
            <div key={tu.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-slate-700">{tu.englishName}</span>
              <div className="flex flex-wrap gap-1">
                {ATTENDANCE_OPTIONS.map((opt) => {
                  const activeChoice = value === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={readOnly}
                      onClick={() => setDraft((d) => ({ ...d, [tu.id]: opt.value }))}
                      className={`rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap ${
                        activeChoice
                          ? "bg-accent-600 text-white"
                          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      {t(opt.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <button
          onClick={() => {
            const entries = tutors
              .filter((tu) => tu.active && draft[tu.id])
              .map((tu) => ({ tutorId: tu.id, status: draft[tu.id]! }));
            save.mutate({ meetingId, entries });
          }}
          className="btn-primary btn-sm mt-3"
        >
          {save.isPending ? t("admin.meetings.saving") : t("admin.meetings.saveAttendance")}
        </button>
      )}
      {save.isSuccess && (
        <span className="ml-2 text-sm text-green-600">{t("admin.meetings.saved")}</span>
      )}
      {save.error && <span className="ml-2 text-sm text-red-600">{save.error.message}</span>}
    </div>
  );
}
