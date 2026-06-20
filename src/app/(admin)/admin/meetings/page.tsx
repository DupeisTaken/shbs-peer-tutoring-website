"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

const MEETING_STATUS = [
  { value: "PRESENT", label: "P" },
  { value: "EXCUSED_ABSENT", label: "EA" },
  { value: "UNEXCUSED_ABSENT", label: "UA" },
  { value: "EXEMPT", label: "X" },
] as const;
type MeetingStatus = (typeof MEETING_STATUS)[number]["value"];

export default function MeetingsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const meetings = api.admin.meetings.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const invalidate = () => utils.admin.meetings.invalidate();
  const create = api.admin.createMeeting.useMutation({ onSuccess: invalidate });
  const del = api.admin.deleteMeeting.useMutation({ onSuccess: invalidate });

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("admin.meetings.title")}</h1>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) {
            create.mutate({ title: title.trim(), date: new Date(date) });
            setTitle("");
          }
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("admin.meetings.titlePlaceholder")}
          className="input max-w-xs"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="input max-w-[12rem]"
        />
        <button className="btn-primary">{t("admin.meetings.create")}</button>
      </form>

      <div className="card overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {(meetings.data ?? []).map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setSelected(selected === m.id ? null : m.id)}
                  className="text-left font-medium text-slate-900 hover:text-indigo-600"
                >
                  {m.title} · {new Date(m.date).toLocaleDateString()}
                </button>
                <button onClick={() => del.mutate({ id: m.id })} className="link-danger">
                  {t("admin.meetings.delete")}
                </button>
              </div>
              {selected === m.id && (
                <AttendanceEditor
                  meetingId={m.id}
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

function AttendanceEditor({
  meetingId,
  tutors,
  current,
}: {
  meetingId: string;
  tutors: { id: string; englishName: string }[];
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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tutors.map((t) => (
          <label key={t.id} className="flex items-center justify-between gap-2 text-sm">
            <span>{t.englishName}</span>
            <select
              value={draft[t.id] ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [t.id]: e.target.value as MeetingStatus }))
              }
              className="select w-24"
            >
              <option value="">—</option>
              {MEETING_STATUS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button
        onClick={() => {
          const entries = Object.entries(draft)
            .filter(([, status]) => status)
            .map(([tutorId, status]) => ({ tutorId, status }));
          save.mutate({ meetingId, entries });
        }}
        className="btn-primary btn-sm mt-3"
      >
        {save.isPending ? t("admin.meetings.saving") : t("admin.meetings.saveAttendance")}
      </button>
      {save.isSuccess && (
        <span className="ml-2 text-sm text-green-600">{t("admin.meetings.saved")}</span>
      )}
    </div>
  );
}
