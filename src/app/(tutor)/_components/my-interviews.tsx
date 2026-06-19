"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

/** Convert a Date to the value a <input type="datetime-local"> expects (local time). */
function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function HeadScheduler({ applicationId, current }: { applicationId: string; current: Date | null }) {
  const utils = api.useUtils();
  const [value, setValue] = useState(toLocalInput(current));
  const save = api.tutor.setInterviewTime.useMutation({
    onSuccess: () => utils.tutor.myInterviews.invalidate(),
  });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="datetime-local"
        className="input w-auto"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        className="btn-primary btn-sm"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            applicationId,
            interviewAt: value ? new Date(value) : null,
          })
        }
      >
        {save.isPending ? "Saving…" : "Set time"}
      </button>
      {save.isSuccess && <span className="text-sm text-green-600">Saved.</span>}
    </div>
  );
}

export function MyInterviews() {
  const interviews = api.tutor.myInterviews.useQuery();
  const list = interviews.data ?? [];

  if (list.length === 0) return null;

  return (
    <section className="card p-5">
      <h2 className="font-semibold text-slate-900">Interviews to conduct</h2>
      <p className="muted mt-1 mb-3">
        Applicants you&apos;re on the panel for. The head coordinates the time.
      </p>
      <div className="space-y-3">
        {list.map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-slate-900">
                {a.name}
                {a.isHead && <span className="badge bg-indigo-100 text-indigo-700 ml-2">you are head</span>}
              </p>
              <p className="muted">{a.email}</p>
            </div>

            <ul className="mt-2 flex flex-wrap gap-2">
              {a.courseIntents.map((ci, i) => (
                <li key={i} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                  {ci.course.name}
                  {ci.taken ? ` · ${ci.grade ?? "taken"}` : " · not taken"}
                </li>
              ))}
            </ul>

            <p className="muted mt-2">
              Panel: {a.interviewers.map((x) => `${x.tutor.englishName}${x.isHead ? " (head)" : ""}`).join(", ")}
            </p>

            {a.isHead ? (
              <HeadScheduler applicationId={a.id} current={a.interviewAt} />
            ) : (
              <p className="muted mt-2">
                {a.interviewAt
                  ? `Scheduled: ${new Date(a.interviewAt).toLocaleString()}`
                  : "Awaiting the head to schedule a time."}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
