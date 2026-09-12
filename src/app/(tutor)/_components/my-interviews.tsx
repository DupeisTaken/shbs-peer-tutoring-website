"use client";

import { useState } from "react";

import { useFormatter, useTranslations, useTimeZone } from "next-intl";

import { api } from "~/trpc/react";

import { programDateTimeInput, parseProgramDateTime } from "~/lib/program-time";

type Status = "PENDING" | "INTERVIEW" | "ACCEPTED" | "REJECTED";

function HeadScheduler({
  applicationId,
  current,
}: {
  applicationId: string;
  current: Date | null;
}) {
  const t = useTranslations();
  const utils = api.useUtils();
  const timeZone = useTimeZone();
  const [inputError, setInputError] = useState("");
  const [value, setValue] = useState(current ? programDateTimeInput(current, timeZone) : "");
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
        onClick={() => { try { setInputError("");
          save.mutate({
            applicationId,
            interviewAt: value ? parseProgramDateTime(value, timeZone) : null,
          }); } catch (error) { setInputError(error instanceof Error ? error.message : "Invalid date"); } }}
      >
        {save.isPending
          ? t("tutor.interviews.saving")
          : t("tutor.interviews.setTime")}
      </button>
      {inputError && <p role="alert">{inputError}</p>}
      {save.isSuccess && (
        <span className="text-sm text-green-600">
          {t("tutor.interviews.saved")}
        </span>
      )}
    </div>
  );
}

function VoteForm({
  applicationId,
  myVote,
  status,
}: {
  applicationId: string;
  myVote: { accept: boolean; comment: string | null } | null;
  status: Status;
}) {
  const t = useTranslations();
  const utils = api.useUtils();
  const [comment, setComment] = useState(myVote?.comment ?? "");
  const votingClosed = status === "ACCEPTED" || status === "REJECTED";
  const cast = api.tutor.castInterviewVote.useMutation({
    onSuccess: () => utils.tutor.myInterviews.invalidate(),
  });

  return (
    <div className="mt-2 space-y-2">
      <input
        className="input w-full"
        placeholder={t("tutor.interviews.voteCommentPlaceholder")}
        value={comment}
        disabled={votingClosed || cast.isPending}
        onChange={(e) => setComment(e.target.value)}
      />
      {votingClosed && (
        <p className="muted text-xs" role="status">
          {t("tutor.interviews.votingClosed")}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          className={`btn-sm ${myVote?.accept === true ? "btn-primary" : "btn-secondary"}`}
          disabled={votingClosed || cast.isPending}
          onClick={() =>
            cast.mutate({
              applicationId,
              accept: true,
              comment: comment.trim() || undefined,
            })
          }
        >
          👍 {t("tutor.interviews.accept")}
        </button>
        <button
          className={`btn-sm ${myVote?.accept === false ? "btn-primary" : "btn-secondary"}`}
          disabled={votingClosed || cast.isPending}
          onClick={() =>
            cast.mutate({
              applicationId,
              accept: false,
              comment: comment.trim() || undefined,
            })
          }
        >
          👎 {t("tutor.interviews.reject")}
        </button>
        {myVote && (
          <span className="muted text-xs">
            {t("tutor.interviews.yourVote", {
              vote: myVote.accept
                ? t("tutor.interviews.voteAccept")
                : t("tutor.interviews.voteReject"),
            })}
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
  panelSize,
  decisionComment,
  decidedBy,
  expectedUpdatedAt,
}: {
  applicationId: string;
  status: Status;
  tally: { accepts: number; rejects: number };
  panelSize: number;
  decisionComment: string | null;
  decidedBy: string | null;
  expectedUpdatedAt: Date;
}) {
  const t = useTranslations();
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
      ? t("tutor.interviews.majorityAccept")
      : tally.rejects > tally.accepts
        ? t("tutor.interviews.majorityReject")
        : t("tutor.interviews.majorityTie");

  if (decided) {
    return (
      <div className="mt-2 rounded-md bg-slate-50 p-2 text-sm">
        <span className={status === "ACCEPTED" ? "badge-green" : "badge-red"}>
          {status === "ACCEPTED"
            ? t("tutor.interviews.statusAccepted")
            : t("tutor.interviews.statusRejected")}
        </span>
        {decisionComment && (
          <span className="ml-2 text-slate-700">“{decisionComment}”</span>
        )}
        {decidedBy && <span className="muted ml-1 text-xs">— {decidedBy}</span>}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
        {t("tutor.interviews.headDecision")}
      </p>
      <p className="muted text-xs">
        {t("tutor.interviews.tally", {
          accepts: tally.accepts,
          rejects: tally.rejects,
          majority,
        })}
      </p>
      <input
        className="input w-full"
        placeholder={t("tutor.interviews.decisionCommentPlaceholder")}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <button
          className="btn-primary btn-sm"
          disabled={
            !comment.trim() ||
            decide.isPending ||
            tally.accepts + tally.rejects < panelSize ||
            tally.accepts < tally.rejects
          }
          onClick={() =>
            decide.mutate({
              applicationId,
              accept: true,
              comment: comment.trim(),
              expectedUpdatedAt,
            })
          }
        >
          {t("tutor.interviews.approve")}
        </button>
        <button
          className="btn-secondary btn-sm"
          disabled={
            !comment.trim() ||
            decide.isPending ||
            tally.accepts + tally.rejects < panelSize ||
            tally.rejects < tally.accepts
          }
          onClick={() =>
            decide.mutate({
              applicationId,
              accept: false,
              comment: comment.trim(),
              expectedUpdatedAt,
            })
          }
        >
          {t("tutor.interviews.reject")}
        </button>
        {decide.error && (
          <span className="text-sm text-red-600">{decide.error.message}</span>
        )}
      </div>
    </div>
  );
}

export function MyInterviews() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const interviews = api.tutor.myInterviews.useQuery();
  const list = interviews.data ?? [];

  if (list.length === 0) return null;

  return (
    <section className="card p-5">
      <h2 className="section-title">{t("dashboard.interviews.title")}</h2>
      <p className="muted mt-1 mb-3">{t("tutor.interviews.help")}</p>
      <div className="space-y-3">
        {list.map((a) => {
          const votes = a.votes;
          return (
            <div key={a.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">
                  {a.name}
                  {a.isHead && (
                    <span className="badge bg-accent-100 text-accent-700 ml-2">
                      {t("tutor.interviews.youAreHead")}
                    </span>
                  )}
                </p>
                <p className="muted">{a.email}</p>
              </div>

              <ul className="mt-2 flex flex-wrap gap-2">
                {a.subjectIntents.map((ci, i) => (
                  <li
                    key={i}
                    className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                  >
                    {ci.subject.name}
                    {ci.taken
                      ? ` · ${ci.grade ?? t("tutor.interviews.taken")}`
                      : ` · ${t("tutor.interviews.notTaken")}`}
                  </li>
                ))}
              </ul>

              <p className="muted mt-2">
                {t("tutor.interviews.panel", {
                  members: a.interviewers
                    .map(
                      (x) =>
                        `${x.tutor.englishName}${x.isHead ? ` ${t("tutor.interviews.headSuffix")}` : ""}`,
                    )
                    .join(", "),
                })}
              </p>

              {a.isHead ? (
                <HeadScheduler applicationId={a.id} current={a.interviewAt} />
              ) : (
                <p className="muted mt-2">
                  {a.interviewAt
                    ? t("tutor.interviews.scheduled", {
                        time: programFormat.dateTime(new Date(a.interviewAt), { dateStyle: "medium", timeStyle: "short" }),
                      })
                    : t("tutor.interviews.awaitingSchedule")}
                </p>
              )}

              {/* Your vote */}
              <VoteForm
                applicationId={a.id}
                myVote={a.myVote}
                status={a.status}
              />

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
                  panelSize={a.interviewers.length}
                  decisionComment={a.decisionComment}
                  decidedBy={a.decidedByTutor?.englishName ?? null}
                  expectedUpdatedAt={a.updatedAt}
                />
              )}
              {!a.isHead &&
                (a.status === "ACCEPTED" || a.status === "REJECTED") && (
                  <div className="mt-2 rounded-md bg-slate-50 p-2 text-sm">
                    <span
                      className={
                        a.status === "ACCEPTED" ? "badge-green" : "badge-red"
                      }
                    >
                      {a.status === "ACCEPTED"
                        ? t("tutor.interviews.statusAccepted")
                        : t("tutor.interviews.statusRejected")}
                    </span>
                    {a.decisionComment && (
                      <span className="ml-2 text-slate-700">
                        “{a.decisionComment}”
                      </span>
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
