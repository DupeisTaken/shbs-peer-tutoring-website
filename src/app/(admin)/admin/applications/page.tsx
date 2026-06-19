"use client";

import { useState } from "react";

import { api } from "~/trpc/react";

type Status = "PENDING" | "INTERVIEW" | "ACCEPTED" | "REJECTED";

function StatusBadge({ status }: { status: Status }) {
  const cls =
    status === "ACCEPTED"
      ? "badge-green"
      : status === "PENDING"
        ? "badge-amber"
        : status === "INTERVIEW"
          ? "badge bg-indigo-100 text-indigo-700"
          : "badge-slate";
  return <span className={cls}>{status.toLowerCase()}</span>;
}

type Application = {
  id: string;
  name: string;
  email: string;
  status: Status;
  interviewAt: Date | null;
  courseIntents: {
    taken: boolean;
    grade: string | null;
    hasApScore: boolean;
    apScore: string | null;
    selfStudied: boolean;
    selfStudyNote: string | null;
    course: { name: string; tag: string };
  }[];
  interviewers: { isHead: boolean; tutor: { id: string; englishName: string } }[];
};

function ApplicationCard({
  app,
  tutors,
  onChanged,
}: {
  app: Application;
  tutors: { id: string; englishName: string; active: boolean }[];
  onChanged: () => Promise<unknown> | void;
}) {
  const assign = api.admin.assignInterviewers.useMutation({ onSuccess: () => onChanged() });
  const setStatus = api.admin.setApplicationStatus.useMutation({ onSuccess: () => onChanged() });
  const del = api.admin.deleteApplication.useMutation({ onSuccess: () => onChanged() });

  // Seed the three interviewer slots and head from any existing assignment.
  const initial = [0, 1, 2].map((i) => app.interviewers[i]?.tutor.id ?? "");
  const [picks, setPicks] = useState<string[]>(initial);
  const [head, setHead] = useState<string>(
    app.interviewers.find((x) => x.isHead)?.tutor.id ?? "",
  );

  const chosen = picks.filter(Boolean);
  const activeTutors = tutors.filter((t) => t.active);
  const canAssign =
    chosen.length >= 1 &&
    new Set(chosen).size === chosen.length &&
    head &&
    chosen.includes(head) &&
    !assign.isPending;

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900">
            {app.name} <StatusBadge status={app.status} />
          </p>
          <p className="muted">{app.email}</p>
        </div>
        <div className="flex items-center gap-2">
          {app.status !== "ACCEPTED" && (
            <button
              className="btn-secondary btn-sm"
              onClick={() => setStatus.mutate({ id: app.id, status: "ACCEPTED" })}
            >
              Accept
            </button>
          )}
          {app.status !== "REJECTED" && (
            <button
              className="btn-secondary btn-sm"
              onClick={() => setStatus.mutate({ id: app.id, status: "REJECTED" })}
            >
              Reject
            </button>
          )}
          <button
            className="btn-danger btn-sm"
            onClick={() => {
              if (confirm(`Delete ${app.name}'s application?`)) del.mutate({ id: app.id });
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Course intents */}
      <ul className="mt-3 flex flex-wrap gap-2">
        {app.courseIntents.map((ci, i) => {
          const quals: string[] = [];
          if (ci.taken) quals.push(`took class (${ci.grade ?? "n/a"})`);
          if (ci.hasApScore) quals.push(`AP ${ci.apScore ?? "n/a"}`);
          if (ci.selfStudied) quals.push(`self-studied: ${ci.selfStudyNote ?? "n/a"}`);
          return (
            <li
              key={i}
              className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
            >
              <span className="font-medium">{ci.course.name}</span>
              <span className="text-slate-400"> ({ci.course.tag.toLowerCase()})</span>
              {" · "}
              {quals.length ? quals.join(" · ") : "no qualification given"}
            </li>
          );
        })}
      </ul>

      {/* Interviewer assignment (up to 3, one head) */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
          Interview panel
        </p>
        {app.interviewAt && (
          <p className="muted mt-1">
            Scheduled: {new Date(app.interviewAt).toLocaleString()} (set by the head)
          </p>
        )}
        <div className="mt-2 space-y-2">
          {picks.map((pick, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                className="select w-56"
                value={pick}
                onChange={(e) =>
                  setPicks((p) => p.map((v, idx) => (idx === i ? e.target.value : v)))
                }
              >
                <option value="">— interviewer {i + 1} —</option>
                {activeTutors
                  .filter((t) => t.id === pick || !picks.includes(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.englishName}
                    </option>
                  ))}
              </select>
              <label className="flex items-center gap-1 text-sm text-slate-600">
                <input
                  type="radio"
                  name={`head-${app.id}`}
                  checked={!!pick && head === pick}
                  disabled={!pick}
                  onChange={() => setHead(pick)}
                />
                head
              </label>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button
            className="btn-primary btn-sm"
            disabled={!canAssign}
            onClick={() =>
              assign.mutate({ applicationId: app.id, tutorIds: chosen, headTutorId: head })
            }
          >
            {assign.isPending ? "Saving…" : "Save panel"}
          </button>
          {assign.isSuccess && <span className="text-sm text-green-600">Saved.</span>}
          {assign.error && <span className="text-sm text-red-600">{assign.error.message}</span>}
        </div>
      </div>
    </div>
  );
}

export default function ApplicationsPage() {
  const utils = api.useUtils();
  const apps = api.admin.tutorApplications.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const invalidate = () => utils.admin.tutorApplications.invalidate();

  const list = apps.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Tutor applications</h1>
        <p className="muted mt-1">
          Review applicants, assign up to three interviewers (mark one head). The head sets
          the interview time from their own dashboard.
        </p>
      </div>

      <div className="space-y-4">
        {list.map((app) => (
          <ApplicationCard
            key={app.id}
            app={app}
            tutors={tutors.data ?? []}
            onChanged={invalidate}
          />
        ))}
        {list.length === 0 && <p className="muted">No applications yet.</p>}
      </div>
    </div>
  );
}
