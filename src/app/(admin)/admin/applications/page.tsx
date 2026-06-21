"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

type Status = "PENDING" | "INTERVIEW" | "ACCEPTED" | "REJECTED";

function StatusBadge({ status }: { status: Status }) {
  const t = useTranslations();
  const cls =
    status === "ACCEPTED"
      ? "badge-green"
      : status === "PENDING"
        ? "badge-amber"
        : status === "INTERVIEW"
          ? "badge bg-indigo-100 text-indigo-700"
          : "badge-slate";
  return <span className={cls}>{t(`admin.applications.status.${status}`)}</span>;
}

type Application = {
  id: string;
  name: string;
  email: string;
  preferredContact: string | null;
  status: Status;
  updatedAt: Date;
  interviewAt: Date | null;
  courseIntents: {
    taken: boolean;
    grade: string | null;
    hasApScore: boolean;
    apScore: string | null;
    selfStudied: boolean;
    selfStudyNote: string | null;
    course: { name: string; level: { name: string } | null };
  }[];
  interviewers: { isHead: boolean; tutor: { id: string; englishName: string } }[];
  votes: { accept: boolean; comment: string | null; tutor: { englishName: string } }[];
  decisionComment: string | null;
  decidedByTutor: { englishName: string } | null;
};

const PANEL_SIZE = 3;

function ApplicationCard({
  app,
  tutors,
  onChanged,
}: {
  app: Application;
  tutors: { id: string; englishName: string; active: boolean }[];
  onChanged: () => Promise<unknown> | void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const assign = api.admin.assignInterviewers.useMutation({
    onSuccess: () => onChanged(),
    onError: () => onChanged(),
  });
  const setStatus = api.admin.setApplicationStatus.useMutation({
    onSuccess: () => onChanged(),
    onError: () => onChanged(),
  });
  const del = api.admin.deleteApplication.useMutation({ onSuccess: () => onChanged() });

  // Exactly three fixed panelist slots, seeded from any existing assignment.
  const [picks, setPicks] = useState<string[]>(() =>
    Array.from({ length: PANEL_SIZE }, (_, i) => app.interviewers[i]?.tutor.id ?? ""),
  );
  const [head, setHead] = useState<string>(
    app.interviewers.find((x) => x.isHead)?.tutor.id ?? "",
  );

  const chosen = picks.filter(Boolean);
  const activeTutors = tutors.filter((t) => t.active);
  const canAssign =
    chosen.length === PANEL_SIZE &&
    new Set(chosen).size === PANEL_SIZE &&
    !!head &&
    chosen.includes(head) &&
    !assign.isPending;

  const accepts = app.votes.filter((v) => v.accept).length;
  const courseNames =
    app.courseIntents.map((ci) => ci.course.name).join(", ") ||
    t("admin.applications.noCourses");

  return (
    <div className="card p-4">
      {/* Collapsed one-line summary (click to expand) */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="text-slate-400">{open ? "▾" : "▸"}</span>
          <span className="font-medium text-slate-900">{app.name}</span>
          <StatusBadge status={app.status} />
          <span className="muted hidden truncate text-xs sm:inline">
            {courseNames}
            {" · "}
            {t("admin.applications.panelSummary", {
              n: app.interviewers.length,
              total: PANEL_SIZE,
            })}
            {app.votes.length > 0
              ? ` · ${t("admin.applications.votesSummary", {
                  accepts,
                  total: app.votes.length,
                })}`
              : ""}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {app.status !== "ACCEPTED" && (
            <button
              className="btn-secondary btn-sm"
              onClick={() =>
                setStatus.mutate({
                  id: app.id,
                  status: "ACCEPTED",
                  expectedUpdatedAt: app.updatedAt,
                })
              }
            >
              {t("admin.applications.accept")}
            </button>
          )}
          {app.status !== "REJECTED" && (
            <button
              className="btn-secondary btn-sm"
              onClick={() =>
                setStatus.mutate({
                  id: app.id,
                  status: "REJECTED",
                  expectedUpdatedAt: app.updatedAt,
                })
              }
            >
              {t("admin.applications.reject")}
            </button>
          )}
          <button
            className="btn-danger btn-sm"
            onClick={() => {
              if (confirm(t("admin.applications.confirmDelete", { name: app.name })))
                del.mutate({ id: app.id });
            }}
          >
            {t("admin.applications.delete")}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="muted">{app.email}</p>
          {app.preferredContact && (
            <p className="muted text-xs">
              {t("admin.applications.reach", { contact: app.preferredContact })}
            </p>
          )}

          {/* Course intents */}
          <ul className="mt-3 flex flex-wrap gap-2">
            {app.courseIntents.map((ci, i) => {
              const quals: string[] = [];
              const na = t("admin.applications.na");
              if (ci.taken)
                quals.push(t("admin.applications.qual.took", { grade: ci.grade ?? na }));
              if (ci.hasApScore)
                quals.push(t("admin.applications.qual.ap", { score: ci.apScore ?? na }));
              if (ci.selfStudied)
                quals.push(
                  t("admin.applications.qual.selfStudied", { note: ci.selfStudyNote ?? na }),
                );
              return (
                <li key={i} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                  <span className="font-medium">{ci.course.name}</span>
                  {ci.course.level && (
                    <span className="badge-slate ml-1 align-middle">{ci.course.level.name}</span>
                  )}
                  {" · "}
                  {quals.length ? quals.join(" · ") : t("admin.applications.noQualification")}
                </li>
              );
            })}
          </ul>

          {/* Interviewer assignment — three fixed panelists, one head */}
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
              {t("admin.applications.panelHeading", { n: PANEL_SIZE })}
            </p>
            {app.interviewAt && (
              <p className="muted mt-1">
                {t("admin.applications.scheduled", {
                  when: new Date(app.interviewAt).toLocaleString(),
                })}
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
                    <option value="">{t("admin.applications.panelistSlot", { n: i + 1 })}</option>
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
                    {t("admin.applications.head")}
                  </label>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <button
                className="btn-primary btn-sm"
                disabled={!canAssign}
                onClick={() =>
                  assign.mutate({
                    applicationId: app.id,
                    tutorIds: chosen,
                    headTutorId: head,
                    expectedUpdatedAt: app.updatedAt,
                  })
                }
              >
                {assign.isPending
                  ? t("admin.applications.saving")
                  : t("admin.applications.savePanel")}
              </button>
              {!canAssign && !assign.isPending && (
                <span className="muted text-xs">
                  {t("admin.applications.pickHint", { n: PANEL_SIZE })}
                </span>
              )}
              {assign.isSuccess && (
                <span className="text-sm text-green-600">{t("admin.applications.saved")}</span>
              )}
              {assign.error && <span className="text-sm text-red-600">{assign.error.message}</span>}
            </div>
          </div>

          {/* Panel votes + head decision (recorded on the head's dashboard) */}
          {(app.votes.length > 0 || app.decisionComment) && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                {t("admin.applications.votesDecisionHeading")}
              </p>
              {app.votes.length > 0 ? (
                <>
                  <p className="muted mt-1 text-sm">
                    {t("admin.applications.voteTally", {
                      accepts,
                      rejects: app.votes.length - accepts,
                    })}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {app.votes.map((v, i) => (
                      <li key={i} className="text-xs text-slate-600">
                        {v.accept ? "👍" : "👎"} {v.tutor.englishName}
                        {v.comment ? ` — ${v.comment}` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="muted mt-1 text-sm">{t("admin.applications.noVotes")}</p>
              )}
              {app.decisionComment && (
                <p className="mt-2 text-sm text-slate-700">
                  {t("admin.applications.decision", { comment: app.decisionComment })}
                  {app.decidedByTutor
                    ? ` — ${t("admin.applications.decidedByHead", {
                        name: app.decidedByTutor.englishName,
                      })}`
                    : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApplicationsPage() {
  const t = useTranslations();
  const utils = api.useUtils();
  const apps = api.admin.tutorApplications.useQuery();
  const tutors = api.admin.tutors.useQuery();
  const invalidate = () => utils.admin.tutorApplications.invalidate();

  const list = apps.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("admin.applications.title")}</h1>
        <p className="muted mt-1">{t("admin.applications.intro", { n: PANEL_SIZE })}</p>
      </div>

      <div className="space-y-3">
        {list.map((app) => (
          <ApplicationCard
            key={app.id}
            app={app}
            tutors={tutors.data ?? []}
            onChanged={invalidate}
          />
        ))}
        {list.length === 0 && <p className="muted">{t("admin.applications.empty")}</p>}
      </div>
    </div>
  );
}
