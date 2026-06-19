"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

const MEETING_STATUS = [
  { value: "PRESENT", label: "P" },
  { value: "EXCUSED_ABSENT", label: "EA" },
  { value: "UNEXCUSED_ABSENT", label: "UA" },
  { value: "EXEMPT", label: "X" },
] as const;
type MeetingStatus = (typeof MEETING_STATUS)[number]["value"];

export default function MeetingsPage() {
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
    <div>
      <h1 className="text-2xl font-bold">Tutor meetings</h1>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
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
          placeholder="Meeting title"
          className="rounded border px-3 py-2"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border px-3 py-2"
        />
        <button className="rounded bg-indigo-600 px-4 py-2 font-semibold text-white">
          Create
        </button>
      </form>

      <ul className="mt-6 divide-y rounded-lg border bg-white">
        {(meetings.data ?? []).map((m) => (
          <li key={m.id} className="p-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSelected(selected === m.id ? null : m.id)}
                className="text-left font-medium hover:text-indigo-600"
              >
                {m.title} · {new Date(m.date).toLocaleDateString()}
              </button>
              <button
                onClick={() => del.mutate({ id: m.id })}
                className="text-sm text-red-600 hover:underline"
              >
                Delete
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
  const utils = api.useUtils();
  const [draft, setDraft] = useState<Record<string, MeetingStatus>>(
    () => current as Record<string, MeetingStatus>,
  );
  const save = api.admin.recordMeetingAttendance.useMutation({
    onSuccess: () => utils.admin.meetings.invalidate(),
  });

  return (
    <div className="mt-3 rounded border bg-gray-50 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tutors.map((t) => (
          <label key={t.id} className="flex items-center justify-between gap-2">
            <span>{t.englishName}</span>
            <select
              value={draft[t.id] ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [t.id]: e.target.value as MeetingStatus }))
              }
              className="rounded border px-2 py-1"
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
        className="mt-3 rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
      >
        {save.isPending ? "Saving…" : "Save attendance"}
      </button>
      {save.isSuccess && <span className="ml-2 text-sm text-green-600">Saved.</span>}
    </div>
  );
}
