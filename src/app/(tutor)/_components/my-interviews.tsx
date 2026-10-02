"use client";

import { useState } from "react";

import { useFormatter, useTranslations, useTimeZone } from "next-intl";

import { api } from "~/trpc/react";
import { useDialog } from "~/app/_components/confirm-dialog";
import { DisclosureSection } from "~/app/_components/ui/disclosure-section";

import { programDateTimeInput, parseProgramDateTime } from "~/lib/program-time";

type Status = "PENDING" | "INTERVIEW" | "ACCEPTED" | "REJECTED" | "RECALLED";

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
  const [value, setValue] = useState(
    current ? programDateTimeInput(current, timeZone) : "",
  );
  const save = api.tutor.setInterviewTime.useMutation({
    onSuccess: () => utils.tutor.myInterviews.invalidate(),
  });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="datetime-local"
        className="input min-h-11 w-auto max-w-full lg:min-h-10"
        aria-label={t("tutor.interviews.setTime")}
        value={value}
        disabled={save.isPending}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        className="btn-primary btn-sm min-h-11 lg:min-h-10"
        disabled={save.isPending}
        onClick={() => {
          try {
            setInputError("");
            save.mutate({
              applicationId,
              interviewAt: value ? parseProgramDateTime(value, timeZone) : null,
            });
          } catch (error) {
            setInputError(
              error instanceof Error ? error.message : "Invalid date",
            );
          }
        }}
      >
        {save.isPending
          ? t("tutor.interviews.saving")
          : t("tutor.interviews.setTime")}
      </button>
      <button
        className="btn-secondary btn-sm min-h-11 lg:min-h-10"
        disabled={save.isPending}
        onClick={() => {
          setValue(current ? programDateTimeInput(current, timeZone) : "");
          setInputError("");
          save.reset();
        }}
      >
        {t("common.cancel")}
      </button>
      {inputError && <p role="alert">{inputError}</p>}
      {save.error && <p role="alert">{save.error.message}</p>}
      {save.isSuccess && (
        <span role="status" className="text-sm text-green-600">
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
  const votingClosed = status !== "INTERVIEW";
  const cast = api.tutor.castInterviewVote.useMutation({
    onSuccess: () => utils.tutor.myInterviews.invalidate(),
  });

  return (
    <div className="mt-2 space-y-2">
      <input
        className="input min-h-11 w-full lg:min-h-10"
        aria-label={t("tutor.interviews.voteCommentPlaceholder")}
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`btn-sm min-h-11 lg:min-h-8 ${myVote?.accept === true ? "btn-primary" : "btn-secondary"}`}
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
          className={`btn-sm min-h-11 lg:min-h-8 ${myVote?.accept === false ? "btn-primary" : "btn-secondary"}`}
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
        {!votingClosed && (
          <button
            type="button"
            className="btn-secondary btn-sm min-h-11 lg:min-h-8"
            disabled={cast.isPending}
            onClick={() => {
              setComment(myVote?.comment ?? "");
              cast.reset();
            }}
          >
            {t("common.cancel")}
          </button>
        )}
      </div>
      {cast.error && (
        <p role="alert" className="text-sm text-red-700">
          {cast.error.message}
        </p>
      )}
      {cast.isSuccess && (
        <p role="status" className="text-sm text-green-700">
          {t("tutor.interviews.saved")}
        </p>
      )}
    </div>
  );
}

function HeadDecision({
  applicationId,
  name,
  status,
  tally,
  panelSize,
  decisionComment,
  decidedBy,
  expectedUpdatedAt,
}: {
  applicationId: string;
  name: string;
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
  const { confirm, dialog } = useDialog();
  const [version, setVersion] = useState(expectedUpdatedAt);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState("");
  const decide = api.tutor.decideInterview.useMutation({
    onSuccess: () => utils.tutor.myInterviews.invalidate(),
    onError: () => utils.tutor.myInterviews.invalidate(),
  });

  const decided = status === "ACCEPTED" || status === "REJECTED";
  const queued = !!decide.error?.data?.approvalId;
  const recordDecision = async (accept: boolean) => {
    if (
      await confirm({
        title: t(
          accept ? "tutor.interviews.approve" : "tutor.interviews.reject",
        ),
        message: t("tutor.tasks.confirmDecision", {
          name,
          outcome: t(
            accept
              ? "tutor.interviews.voteAccept"
              : "tutor.interviews.voteReject",
          ),
        }),
        confirmLabel: t(
          accept ? "tutor.interviews.approve" : "tutor.interviews.reject",
        ),
        cancelLabel: t("common.cancel"),
        danger: !accept,
      })
    )
      decide.mutate({
        applicationId,
        accept,
        comment: comment.trim(),
        expectedUpdatedAt: version,
      });
  };
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
      {dialog}
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
        aria-label={t("tutor.interviews.decisionCommentPlaceholder")}
        disabled={decide.isPending || queued || reloading}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary btn-sm"
          disabled={
            !comment.trim() ||
            decide.isPending ||
            queued ||
            reloading ||
            status !== "INTERVIEW" ||
            tally.accepts + tally.rejects < panelSize ||
            tally.accepts < tally.rejects
          }
          onClick={() => void recordDecision(true)}
        >
          {t("tutor.interviews.approve")}
        </button>
        <button
          className="btn-secondary btn-sm"
          disabled={
            !comment.trim() ||
            decide.isPending ||
            queued ||
            reloading ||
            status !== "INTERVIEW" ||
            tally.accepts + tally.rejects < panelSize ||
            tally.rejects < tally.accepts
          }
          onClick={() => void recordDecision(false)}
        >
          {t("tutor.interviews.reject")}
        </button>
        {decide.error && !queued && (
          <span role="alert" className="text-sm text-red-600">
            {decide.error.message}
          </span>
        )}
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={decide.isPending || queued || reloading}
          onClick={() => {
            setComment("");
            setReloadError("");
            decide.reset();
          }}
        >
          {t("common.cancel")}
        </button>
        {decide.error && !queued && (
          <button
            className="btn-secondary btn-sm"
            disabled={reloading || decide.isPending}
            onClick={async () => {
              setReloading(true);
              setReloadError("");
              try {
                // Only an explicit successful reload replaces this draft's version.
                // Background invalidation must never silently rebase a failed decision.
                const rows = await utils.tutor.myInterviews.fetch();
                const current = rows.find((row) => row.id === applicationId);
                if (!current) throw new Error(t("tutor.tasks.loadError"));
                setVersion(current.updatedAt);
                setComment("");
                decide.reset();
              } catch (error) {
                setReloadError(
                  error instanceof Error
                    ? error.message
                    : t("tutor.tasks.loadError"),
                );
              } finally {
                setReloading(false);
              }
            }}
          >
            {t("tutor.tasks.reloadDecision")}
          </button>
        )}
        {reloadError && <p role="alert">{reloadError}</p>}
        {queued && (
          <p role="status" className="text-sm text-amber-800">
            {t("approvals.queuedBody")}
          </p>
        )}
        {decide.isSuccess && (
          <p role="status" className="text-sm text-green-700">
            {t("tutor.interviews.saved")}
          </p>
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

  if (list.length === 0 && !interviews.error && !interviews.isLoading)
    return null;

  return (
    <section
      id="tutor-interviews"
      tabIndex={-1}
      className="card scroll-mt-6 p-5"
    >
      <h2 className="section-title">{t("dashboard.interviews.title")}</h2>
      <p className="muted mt-1 mb-3">{t("tutor.interviews.help")}</p>
      {interviews.isLoading && <p role="status">{t("tutor.tasks.loading")}</p>}
      {interviews.error && (
        <p role="alert">
          {interviews.error.message}{" "}
          <button
            className="btn-secondary btn-sm"
            onClick={() => void interviews.refetch()}
          >
            {t("tutor.tasks.retry")}
          </button>
        </p>
      )}
      <div className="space-y-3">
        {list.map((a) => {
          const votes = a.votes;
          const content = (
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
                    {/* Course-taking evidence belongs only to the initial intake. */}
                    {a.type === "INITIAL" &&
                      (ci.taken
                        ? ` · ${ci.grade ?? t("tutor.interviews.taken")}`
                        : ` · ${t("tutor.interviews.notTaken")}`)}
                  </li>
                ))}
              </ul>

              {a.type !== "INITIAL" && a.qualificationReason && (
                <p className="mt-2 text-sm break-words whitespace-pre-wrap">
                  {a.qualificationReason}
                </p>
              )}

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

              {a.status === "RECALLED" ? (
                <p className="badge-slate mt-2">
                  {t("qualificationRequests.RECALLED")}
                </p>
              ) : a.isHead &&
                (a.status === "PENDING" || a.status === "INTERVIEW") ? (
                <HeadScheduler applicationId={a.id} current={a.interviewAt} />
              ) : (
                <p className="muted mt-2">
                  {a.interviewAt
                    ? t("tutor.interviews.scheduled", {
                        time: programFormat.dateTime(new Date(a.interviewAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
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
              {a.isHead &&
                a.type !== "ADDITIONAL_SUBJECT" &&
                a.type !== "HIGHER_LEVEL" && (
                  <HeadDecision
                    applicationId={a.id}
                    name={a.name}
                    status={a.status}
                    tally={a.tally}
                    panelSize={a.interviewers.length}
                    decisionComment={a.decisionComment}
                    decidedBy={a.decidedByTutor?.englishName ?? null}
                    expectedUpdatedAt={a.updatedAt}
                  />
                )}
              {a.isHead &&
                a.status !== "RECALLED" &&
                (a.type === "ADDITIONAL_SUBJECT" ||
                  a.type === "HIGHER_LEVEL") && (
                  <a
                    className="link mt-3 inline-flex min-h-11 items-center lg:min-h-8"
                    href={`/admin/applications#application-${a.id}`}
                  >
                    {t("qualificationRequests.reviewLink")}
                  </a>
                )}
              {(!a.isHead ||
                a.type === "ADDITIONAL_SUBJECT" ||
                a.type === "HIGHER_LEVEL") &&
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
          return a.status === "PENDING" || a.status === "INTERVIEW" ? (
            content
          ) : (
            <DisclosureSection
              key={a.id}
              title={t("tutor.tasks.completedInterview", {
                name: a.name,
                count: 1,
              })}
              lifetime="retained"
            >
              {content}
            </DisclosureSection>
          );
        })}
      </div>
    </section>
  );
}
