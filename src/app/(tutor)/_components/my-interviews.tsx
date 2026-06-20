"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/** Convert a Date to the value a <input type="datetime-local"> expects (local time). */
function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

type Status = "PENDING" | "INTERVIEW" | "ACCEPTED" | "REJECTED";

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
          save.mutate({ applicationId, interviewAt: value ? new Date(value) : null })
        }
      >
        {save.isPending ? "Saving…" : "Set time"}
      </button>
      {save.isSuccess && <span className="text-sm text-green-600">Saved.</span>}
    </div>
  );
}

function VoteForm({
  applicationId,
  myVote,
}: {
  applicationId: string;
  myVote: { accept: boolean; comment: string | null } | null;
}) {
  const utils = api.useUtils();
  const [comment, setComment] = useState(myVote?.comment ?? "");
  const cast = api.tutor.castInterviewVote.useMutation({
    onSuccess: () => utils.tutor.myInterviews.invalidate(),
  });

  return (
    <div className="mt-2 space-y-2">
      <input
        className="input w-full"
        placeholder="Optional comment on your vote"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <button
          className={`btn-sm ${myVote?.accept === true ? "btn-primary" : "btn-secondary"}`}
          disabled={cast.isPending}
          onClick={() =>
            cast.mutate({ applicationId, accept: true, comment: comment.trim() || undefined })
          }
        >
          👍 Accept
        </button>
        <button
          className={`btn-sm ${myVote?.accept === false ? "btn-primary" : "btn-secondary"}`}
          disabled={cast.isPending}
          onClick={() =>
            cast.mutate({ applicationId, accept: false, comment: comment.trim() || undefined })
          }
        >
          👎 Reject
        </button>
        {myVote && (
          <span className="muted text-xs">
            Your vote: {myVote.accept ? "accept" : "reject"}
          </span>
        )}
      </div>
    </div>
  );
}

function HeadDecision({
  applicationId,
  status,
  tally,
  headVote,
  decisionComment,
  decidedBy,
  expectedUpdatedAt,
}: {
  applicationId: string;
  status: Status;
  tally: { accepts: number; rejects: number };
  headVote: { accept: boolean; comment: string | null } | null;
  decisionComment: string | null;
  decidedBy: string | null;
  expectedUpdatedAt: Date;
}) {
  const utils = api.useUtils();
  const [comment, setComment] = useState("");
  const decide = api.tutor.decideInterview.useMutation({
    onSuccess: () => utils.tutor.myInterviews.invalidate(),
    onError: () => utils.tutor.myInterviews.invalidate(),
  });

  const decided = status === "ACCEPTED" || status === "REJECTED";
  // Simple majority admits; on a tie the head's own vote breaks it (policy §VII.4).
  const majority =
    tally.accepts > tally.rejects
      ? "accept"
      : tally.rejects > tally.accepts
        ? "reject"
        : headVote
          ? `${headVote.accept ? "accept" : "reject"} (head breaks tie)`
          : "tie — cast your vote to break it";

  if (decided) {
    return (
      <div className="mt-2 rounded-md bg-slate-50 p-2 text-sm">
        <span className={status === "ACCEPTED" ? "badge-green" : "badge-red"}>
          {status.toLowerCase()}
        </span>
        {decisionComment && <span className="ml-2 text-slate-700">“{decisionComment}”</span>}
        {decidedBy && <span className="muted ml-1 text-xs">— {decidedBy}</span>}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
        Head decision
      </p>
      <p className="muted text-xs">
        Tally: {tally.accepts} accept · {tally.rejects} reject (majority: {majority}). Record
        the final decision with a brief comment.
      </p>
      <input
        className="input w-full"
        placeholder="Brief comment on your decision (required)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <button
          className="btn-primary btn-sm"
          disabled={!comment.trim() || decide.isPending}
          onClick={() =>
            decide.mutate({ applicationId, accept: true, comment: comment.trim(), expectedUpdatedAt })
          }
        >
          Approve
        </button>
        <button
          className="btn-secondary btn-sm"
          disabled={!comment.trim() || decide.isPending}
          onClick={() =>
            decide.mutate({ applicationId, accept: false, comment: comment.trim(), expectedUpdatedAt })
          }
        >
          Reject
        </button>
        {decide.error && <span className="text-sm text-red-600">{decide.error.message}</span>}
      </div>
    </div>
  );
}

export function MyInterviews() {
  const t = useTranslations();
  const interviews = api.tutor.myInterviews.useQuery();
  const list = interviews.data ?? [];

  if (list.length === 0) return null;

  return (
    <section className="card p-5">
      <h2 className="font-semibold text-slate-900">{t("dashboard.interviews.title")}</h2>
      <p className="muted mt-1 mb-3">
        Applicants you&apos;re on the panel for. Cast your vote after the demo; the head
        records the final decision.
      </p>
      <div className="space-y-3">
        {list.map((a) => {
          const votes = a.votes;
          return (
            <div key={a.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">
                  {a.name}
                  {a.isHead && (
                    <span className="badge ml-2 bg-indigo-100 text-indigo-700">you are head</span>
                  )}
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
                Panel:{" "}
                {a.interviewers
                  .map((x) => `${x.tutor.englishName}${x.isHead ? " (head)" : ""}`)
                  .join(", ")}
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

              {/* Your vote */}
              <VoteForm applicationId={a.id} myVote={a.myVote} />

              {/* Panel votes (visible to all panelists) */}
              {votes.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {votes.map((v) => (
                    <li key={v.tutorId} className="text-xs text-slate-600">
                      {v.accept ? "👍" : "👎"} {v.tutor.englishName}
                      {v.comment ? ` — ${v.comment}` : ""}
                    </li>
                  ))}
                </ul>
              )}

              {/* Head's final decision */}
              {a.isHead && (
                <HeadDecision
                  applicationId={a.id}
                  status={a.status}
                  tally={a.tally}
                  headVote={a.myVote}
                  decisionComment={a.decisionComment}
                  decidedBy={a.decidedByTutor?.englishName ?? null}
                  expectedUpdatedAt={a.updatedAt}
                />
              )}
              {!a.isHead && (a.status === "ACCEPTED" || a.status === "REJECTED") && (
                <div className="mt-2 rounded-md bg-slate-50 p-2 text-sm">
                  <span className={a.status === "ACCEPTED" ? "badge-green" : "badge-red"}>
                    {a.status.toLowerCase()}
                  </span>
                  {a.decisionComment && (
                    <span className="ml-2 text-slate-700">“{a.decisionComment}”</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
