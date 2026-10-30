"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { useFormatter, useTranslations, useTimeZone } from "next-intl";

import { api, type RouterOutputs } from "~/trpc/react";
import { useDialog } from "~/app/_components/confirm-dialog";
import { useSessionAccessDenied } from "~/app/_components/session-view-state";
import { DisclosureIcon } from "~/app/_components/icons";
import { Button } from "~/app/_components/ui/button";
import { ProfileDialog } from "~/app/_components/profile-dialog";
import {
  InterviewApprovalDialog,
  type InterviewApprovalDraft,
  type InterviewApprovalEvidence,
} from "~/app/_components/interview-approval-dialog";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { isOpenInterview, orderInterviews } from "~/lib/interview-order";
import {
  InvalidityBadge,
  InvalidityNotice,
} from "~/app/_components/request-invalidity";

import { programDateTimeInput, parseProgramDateTime } from "~/lib/program-time";

type Status = "PENDING" | "INTERVIEW" | "ACCEPTED" | "REJECTED" | "RECALLED";
type TutorInterview = RouterOutputs["tutor"]["myInterviews"][number];

/** This mutation observer mounts only after an authorized chair opens approval. */
function TutorInterviewApproval({
  approval,
  current,
  initialDraft,
  onClose,
  onSaved,
}: {
  approval: { evidence: InterviewApprovalEvidence; comment: string };
  current: TutorInterview | undefined;
  initialDraft?: InterviewApprovalDraft;
  onClose: (draft?: InterviewApprovalDraft) => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const utils = api.useUtils();
  const router = useRouter();
  const approve = api.tutor.decideInterview.useMutation();
  return (
    <InterviewApprovalDialog
      evidence={current ?? approval.evidence}
      initialComment={approval.comment}
      initialEvidence={approval.evidence}
      initialDraft={initialDraft}
      authorized={!!current?.canChair && !current.isInvalid}
      canApprove={
        !!current &&
        current.status === "INTERVIEW" &&
        current.tally.accepts + current.tally.rejects ===
          current.panel.length &&
        current.tally.accepts >= current.tally.rejects
      }
      canRetrySubmitted={current?.status === "ACCEPTED"}
      commit={async (input) => {
        const result = await approve.mutateAsync({
          applicationId: approval.evidence.id,
          accept: true,
          ...input,
        });
        onSaved();
        return result;
      }}
      refresh={() =>
        settleRefreshes([
          () => invalidateAndReport(utils.tutor.myInterviews),
          () => invalidateAndReport(utils.notification.list),
          () => invalidateAndReport(utils.notification.unreadCount),
          async () => {
            // The dashboard total is server-rendered. Verify a fresh read, then
            // replace that payload while preserving independent client drafts.
            await utils.tutor.myMonthlyTotal.fetch(undefined, { staleTime: 0 });
            router.refresh();
          },
        ])
      }
      reload={async () => {
        const rows = await utils.tutor.myInterviews.fetch(undefined, {
          staleTime: 0,
        });
        const row = rows.find((item) => item.id === approval.evidence.id);
        if (!row?.canChair || row.isInvalid || row.status !== "INTERVIEW")
          throw new Error(t("interviewApproval.unavailable"));
        return row;
      }}
      onClose={onClose}
    />
  );
}

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
  paused = false,
  renderContent,
  onPendingChange,
}: {
  applicationId: string;
  myVote: { accept: boolean; comment: string | null } | null;
  status: Status;
  paused?: boolean;
  /** Retained Schedule owners keep this draft and mutation alive when closed. */
  renderContent?: (content: ReactNode, pending: boolean) => ReactNode;
  onPendingChange?: (pending: boolean) => void;
}) {
  const t = useTranslations();
  const utils = api.useUtils();
  const [comment, setComment] = useState(myVote?.comment ?? "");
  const votingClosed = paused || status !== "INTERVIEW";
  const cast = api.tutor.castInterviewVote.useMutation({
    onSuccess: () => utils.tutor.myInterviews.invalidate(),
  });
  useLayoutEffect(() => {
    onPendingChange?.(!!cast.isPending);
    return () => onPendingChange?.(false);
  }, [cast.isPending, onPendingChange]);

  const content = (
    <div className="mt-2 space-y-2">
      <input
        className="input min-h-11 w-full lg:min-h-10"
        aria-label={t("tutor.interviews.voteCommentPlaceholder")}
        placeholder={t("tutor.interviews.voteCommentPlaceholder")}
        value={comment}
        disabled={votingClosed || cast.isPending}
        onChange={(e) => setComment(e.target.value)}
      />
      {votingClosed && !paused && (
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
  return renderContent ? renderContent(content, cast.isPending) : content;
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
  onApprove,
  approvalBlocked,
}: {
  applicationId: string;
  name: string;
  status: Status;
  tally: { accepts: number; rejects: number };
  panelSize: number;
  decisionComment: string | null;
  decidedBy: string | null;
  expectedUpdatedAt: Date;
  onApprove: (comment: string, version: Date) => void;
  approvalBlocked: boolean;
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
  // Simple majority decides; the selected eligible chair resolves a tied panel.
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
        disabled={decide.isPending || queued || reloading || approvalBlocked}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary btn-sm"
          disabled={
            !comment.trim() ||
            approvalBlocked ||
            decide.isPending ||
            queued ||
            reloading ||
            status !== "INTERVIEW" ||
            tally.accepts + tally.rejects < panelSize ||
            tally.accepts < tally.rejects
          }
          onClick={() => onApprove(comment.trim(), version)}
        >
          {t("tutor.interviews.approve")}
        </button>
        <button
          className="btn-secondary btn-sm"
          disabled={
            !comment.trim() ||
            decide.isPending ||
            approvalBlocked ||
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
          disabled={decide.isPending || queued || reloading || approvalBlocked}
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

/** Share evidence and voting presentation without moving chair authority to Schedule. */
function InterviewRow({
  interview: a,
  hidden = false,
  chairActions = true,
  approvalBlocked = false,
  onApprove,
  voteForm,
}: {
  interview: TutorInterview;
  hidden?: boolean;
  chairActions?: boolean;
  approvalBlocked?: boolean;
  onApprove?: (comment: string, version: Date) => void;
  voteForm?: ReactNode;
}) {
  const t = useTranslations();
  const programFormat = useFormatter();
  const votes = a.votes;
  // Historical assignment is evidence; current server authority controls actions.
  const canChair = chairActions && a.isHead && a.canChair;
  return (
    <div
      key={a.id}
      id={`completed-interview-${a.id}`}
      hidden={hidden}
      data-interview-id={a.id}
      className="rounded-lg border border-slate-200 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-slate-900">
          {a.name}
          {a.isInvalid && (
            <span className="ml-2">
              <InvalidityBadge />
            </span>
          )}
          {a.isHead && (
            <span className="badge bg-accent-100 text-accent-700 ml-2">
              {t("tutor.interviews.youAreHead")}
            </span>
          )}
        </p>
        <p className="muted">{a.email}</p>
      </div>
      {a.isInvalid && (
        <div className="mt-2">
          <InvalidityNotice />
        </div>
      )}

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
      ) : canChair &&
        !a.isInvalid &&
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
      {a.isHead && !canChair && !a.isInvalid && isOpenInterview(a) && (
        <p className="mt-2 text-sm text-amber-800">
          {t("interviewReview.chairNeedsUpdate")}
        </p>
      )}

      <p className="mt-2 text-sm">
        {a.interviewCompletedAt
          ? t("interviewReview.recorded", {
              minutes: a.interviewDurationMin ?? 0,
              date: programFormat.dateTime(a.interviewCompletedAt, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })
          : t("interviewReview.completionPending")}
      </p>
      {a.interviewCompletedAt && (
        <p className="muted text-sm">
          {t("interviewReview.myCredit", {
            // Match completion review's locale-aware display; retain exact stored credit.
            hours: programFormat.number(a.myAwardedHours, {
              maximumFractionDigits: 4,
            }),
          })}
        </p>
      )}
      {a.pendingDecision && (
        <p className="mt-2 text-sm text-amber-800">
          {t("interviewReview.decisionPending")}
        </p>
      )}
      {/* Your vote */}
      {voteForm ?? (
        <VoteForm
          applicationId={a.id}
          myVote={a.myVote}
          status={a.status}
          paused={a.isInvalid}
        />
      )}

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
      {canChair &&
        !a.isInvalid &&
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
            approvalBlocked={approvalBlocked}
            onApprove={(comment, version) => onApprove?.(comment, version)}
          />
        )}
      {canChair &&
        a.status !== "RECALLED" &&
        (a.type === "ADDITIONAL_SUBJECT" || a.type === "HIGHER_LEVEL") && (
          <a
            className="link mt-3 inline-flex min-h-11 items-center lg:min-h-8"
            href={`/admin/applications#application-${a.id}`}
          >
            {t("qualificationRequests.reviewLink")}
          </a>
        )}
      {(a.isInvalid ||
        !canChair ||
        a.type === "ADDITIONAL_SUBJECT" ||
        a.type === "HIGHER_LEVEL") &&
        (a.status === "ACCEPTED" || a.status === "REJECTED") && (
          <div className="mt-2 rounded-md bg-slate-50 p-2 text-sm">
            <span
              className={a.status === "ACCEPTED" ? "badge-green" : "badge-red"}
            >
              {a.status === "ACCEPTED"
                ? t("tutor.interviews.statusAccepted")
                : t("tutor.interviews.statusRejected")}
            </span>
            {a.decisionComment && (
              <span className="ml-2 text-slate-700">“{a.decisionComment}”</span>
            )}
          </div>
        )}
    </div>
  );
}

export function MyInterviews({
  audience = "all",
}: {
  audience?: "all" | "chair" | "panelist";
}) {
  const t = useTranslations();
  const interviews = api.tutor.myInterviews.useQuery();
  const [approvalSaved, setApprovalSaved] = useState(false);
  const [approval, setApproval] = useState<{
    evidence: InterviewApprovalEvidence;
    comment: string;
  } | null>(null);
  const [approvalDrafts, setApprovalDrafts] = useState<
    ReadonlyMap<string, InterviewApprovalDraft>
  >(() => new Map());
  const accessDenied = useSessionAccessDenied(interviews);
  const [expanded, setExpanded] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Destination focus is explicit navigation (including same-hash task links).
  // Internal field focus never expands a manually collapsed section.
  useEffect(() => {
    const arrive = () => {
      if (window.location.hash === "#tutor-interviews") setExpanded(true);
    };
    arrive();
    window.addEventListener("hashchange", arrive);
    return () => window.removeEventListener("hashchange", arrive);
  }, []);
  const list = orderInterviews(interviews.data ?? []).filter((row) =>
    audience === "chair"
      ? row.isHead
      : audience === "panelist"
        ? !row.isHead
        : true,
  );
  const active = list.filter(isOpenInterview);
  const history = list.filter((row) => !isOpenInterview(row));
  const currentApproval = approval
    ? list.find((row) => row.id === approval.evidence.id)
    : undefined;
  const followups = history.filter(
    (row) =>
      !row.isInvalid && row.status !== "RECALLED" && !row.interviewCompletedAt,
  ).length;

  if (accessDenied)
    return (
      <section
        id="tutor-interviews"
        tabIndex={-1}
        className="card space-y-3 p-5"
      >
        <h2 className="section-title">{t("dashboard.interviews.title")}</h2>
        <p role="alert">{t("interviewReview.accessDenied")}</p>
        <Button
          disabled={interviews.isFetching}
          onClick={() => void interviews.refetch()}
        >
          {t("tutor.tasks.retry")}
        </Button>
      </section>
    );

  if (list.length === 0 && !interviews.error && !interviews.isLoading)
    return null;

  return (
    <section
      id="tutor-interviews"
      onFocus={(event) => {
        if (event.target === event.currentTarget) setExpanded(true);
      }}
      tabIndex={-1}
      className="card scroll-mt-6 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">
          {t("dashboard.interviews.title")} ({list.length})
        </h2>
        <Button
          size="compact"
          aria-expanded={expanded}
          aria-controls="interview-section-content"
          onClick={() => setExpanded(!expanded)}
        >
          {t(expanded ? "interviewReview.collapse" : "interviewReview.expand")}
        </Button>
      </div>
      <p className="muted mt-1 mb-3">{t("tutor.interviews.help")}</p>
      {approvalSaved && (
        <p role="status" className="mb-3 text-sm text-green-700">
          {t("interviewApproval.saved")}
        </p>
      )}
      {approval && (
        <TutorInterviewApproval
          key={approval.evidence.id}
          approval={approval}
          current={currentApproval}
          initialDraft={approvalDrafts.get(approval.evidence.id)}
          onSaved={() => setApprovalSaved(true)}
          onClose={(draft) => {
            setApprovalDrafts((current) => {
              const next = new Map(current);
              if (draft) next.set(approval.evidence.id, draft);
              else next.delete(approval.evidence.id);
              return next;
            });
            setApproval(null);
          }}
        />
      )}
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
      <div
        id="interview-section-content"
        hidden={!expanded}
        className="space-y-3 max-lg:[&_button]:min-h-11"
      >
        <h3 className="font-semibold">
          {t("interviewReview.active", { count: active.length })}
        </h3>
        {active.length === 0 && (
          <p className="muted">{t("interviewReview.noActive")}</p>
        )}
        {/* One flat keyed sibling list retains drafts when current server state moves a row. */}
        {[...active, null, ...history].map((a) => {
          if (!a)
            return (
              <div key="completed-menu">
                <Button
                  aria-expanded={historyOpen}
                  aria-describedby={
                    followups ? "interview-completion-followups" : undefined
                  }
                  aria-controls={
                    history
                      .map((row) => `completed-interview-${row.id}`)
                      .join(" ") || undefined
                  }
                  className="w-full justify-between"
                  onClick={() => setHistoryOpen(!historyOpen)}
                >
                  <span>
                    {t("interviewReview.completed", { count: history.length })}
                  </span>
                  <DisclosureIcon open={historyOpen} />
                </Button>
                {followups > 0 && (
                  <p
                    id="interview-completion-followups"
                    className="muted mt-2 text-sm"
                  >
                    {t("interviewReview.historyFollowups", {
                      count: followups,
                    })}
                  </p>
                )}
              </div>
            );
          return (
            <InterviewRow
              key={a.id}
              interview={a}
              hidden={!isOpenInterview(a) && !historyOpen}
              approvalBlocked={!!approval}
              onApprove={(comment, version) =>
                setApproval({ evidence: { ...a, updatedAt: version }, comment })
              }
            />
          );
        })}
      </div>
    </section>
  );
}

/** Keep each deliberately opened vote owner alive even after its reader closes.
 * Cached evidence is never rendered after denial or removal from the live panel. */
function RetainedScheduleInterview({
  interview,
  authorized,
  open,
  onClose,
  onPendingChange,
  feedback,
  readable,
}: {
  interview: TutorInterview;
  authorized: boolean;
  open: boolean;
  onClose: () => void;
  onPendingChange: (id: string, pending: boolean) => void;
  feedback: ReactNode;
  readable: boolean;
}) {
  const reportPending = useCallback(
    (pending: boolean) => onPendingChange(interview.id, pending),
    [interview.id, onPendingChange],
  );
  return (
    <VoteForm
      applicationId={interview.id}
      myVote={interview.myVote}
      status={interview.status}
      paused={!authorized || !readable || interview.isInvalid}
      onPendingChange={reportPending}
      renderContent={(vote, pending) =>
        authorized && open ? (
          <ProfileDialog
            title={interview.name}
            onClose={onClose}
            pending={pending}
          >
            {feedback}
            <InterviewRow
              interview={interview}
              chairActions={false}
              voteForm={vote}
            />
          </ProfileDialog>
        ) : null
      }
    />
  );
}

/** Schedule owns one always-mounted controller. Its first deliberate open starts
 * private reads; later closes retain independent drafts and in-flight vote observers.
 * This retains the existing vote/invalidation contract, without receipt recovery. */
export function ScheduleInterviewDetails({
  applicationId,
  onClose,
  showAll = false,
  enabled = true,
}: {
  applicationId: string | null;
  onClose: () => void;
  showAll?: boolean;
  /** The summary owner conceals this retained controller when live access changes. */
  enabled?: boolean;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const requested = applicationId !== null || showAll;
  const [activated, setActivated] = useState(requested);
  const interviews = api.tutor.myInterviews.useQuery(undefined, {
    enabled: enabled && (requested || activated),
  });
  const accessDenied = useSessionAccessDenied(interviews);
  const [selection, setSelection] = useState({
    request: applicationId,
    id: applicationId,
  });
  const [retained, setRetained] = useState<ReadonlyMap<string, TutorInterview>>(
    () => new Map(),
  );
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const pending = pendingIds.size > 0;
  const reportPending = useCallback((id: string, busy: boolean) => {
    setPendingIds((current) => {
      if (current.has(id) === busy) return current;
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  useLayoutEffect(() => {
    if (requested) setActivated(true);
    // A changed route/list selection waits for the existing write to settle.
    // Its owner remains mounted throughout, including an external Close request.
    if (!pending && selection.request !== applicationId)
      setSelection({ request: applicationId, id: applicationId });
  }, [requested, applicationId, pending, selection.request]);
  const rows = orderInterviews(interviews.data ?? []);
  const current = rows.find((row) => row.id === selection.id);
  useEffect(() => {
    if (!enabled || !current || current.isHead || accessDenied) return;
    setRetained((previous) => {
      if (previous.has(current.id)) return previous;
      return new Map(previous).set(current.id, current);
    });
  }, [current, accessDenied, enabled]);
  const close = () => {
    if (pending) return;
    setSelection({ request: applicationId, id: null });
    onClose();
  };
  // Include the first selected record immediately, then retain it by stable ID.
  const owners = new Map(retained);
  if (enabled && current && !current.isHead && !accessDenied)
    owners.set(current.id, current);
  const visible = enabled && (requested || pending);
  const authorizedCurrent = !accessDenied && !!current;
  const showFallback =
    visible && (!selection.id || !authorizedCurrent || current?.isHead);
  const panelistRows = rows.filter((row) => !row.isHead);
  const feedback = interviews.error ? (
    <div className="mb-3 space-y-2">
      <p role="alert">{interviews.error.message}</p>
      <Button
        disabled={interviews.isFetching}
        onClick={() => void interviews.refetch()}
      >
        {t("tutor.tasks.retry")}
      </Button>
    </div>
  ) : null;
  return (
    <>
      {[...owners.values()].map((snapshot) => {
        const live = rows.find((row) => row.id === snapshot.id);
        return (
          <RetainedScheduleInterview
            key={snapshot.id}
            interview={live ?? snapshot}
            authorized={enabled && !accessDenied && !!live && !live.isHead}
            open={visible && selection.id === snapshot.id}
            onClose={close}
            onPendingChange={reportPending}
            feedback={feedback}
            readable={!interviews.error}
          />
        );
      })}
      {showFallback && (
        <ProfileDialog
          title={t("unifiedScheduleInterview.title")}
          onClose={close}
          pending={pending}
        >
          {accessDenied ? (
            <p role="alert">{t("interviewReview.accessDenied")}</p>
          ) : interviews.isLoading ? (
            <p role="status">{t("tutor.tasks.loading")}</p>
          ) : selection.id ? (
            current?.isHead ? (
              <a
                className="link inline-flex min-h-11 items-center"
                href="/dashboard#tutor-interviews"
              >
                {t("unifiedScheduleInterview.chairWorkspace")}
              </a>
            ) : (
              <p role="alert">{t("unifiedScheduleInterview.unavailable")}</p>
            )
          ) : (
            <div className="space-y-4">
              {[true, false].map((active) => {
                const group = panelistRows.filter(
                  (row) => isOpenInterview(row) === active,
                );
                return (
                  <section key={String(active)} className="space-y-2">
                    <h3 className="font-semibold">
                      {t(
                        active
                          ? "interviewReview.active"
                          : "interviewReview.completed",
                        { count: group.length },
                      )}
                    </h3>
                    {group.length === 0 ? (
                      <p className="muted">
                        {t("unifiedScheduleInterview.emptyGroup")}
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-200">
                        {group.map((row) => (
                          <li
                            key={row.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2"
                          >
                            <div>
                              <p className="font-medium">{row.name}</p>
                              <p className="muted text-sm">
                                {row.interviewAt
                                  ? format.dateTime(row.interviewAt, {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    })
                                  : t("tutor.interviews.awaitingSchedule")}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="link inline-flex min-h-11 items-center"
                              disabled={pending}
                              aria-label={`${t("tablePatterns.details")}: ${row.name}`}
                              onClick={() =>
                                setSelection({
                                  request: applicationId,
                                  id: row.id,
                                })
                              }
                            >
                              {t("tablePatterns.details")}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
              <a
                className="link inline-flex min-h-11 items-center"
                href="/dashboard#tutor-interviews"
              >
                {t("unifiedScheduleInterview.chairWorkspace")}
              </a>
            </div>
          )}
          {(!!interviews.error || accessDenied) && (
            <div className="mt-3 space-y-2">
              {!accessDenied && <p role="alert">{interviews.error?.message}</p>}
              <Button
                disabled={interviews.isFetching}
                onClick={() => void interviews.refetch()}
              >
                {t("tutor.tasks.retry")}
              </Button>
            </div>
          )}
        </ProfileDialog>
      )}
    </>
  );
}
