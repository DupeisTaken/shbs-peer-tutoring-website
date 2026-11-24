"use client";

import { useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { api, type RouterOutputs } from "~/trpc/react";
import {
  MeetingPeriodSections,
  useMeetingPeriodBusy,
} from "~/app/_components/meeting-period-sections";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { useSessionAccessDenied } from "~/app/_components/session-view-state";
import { useServerBoundaryClock } from "~/app/_components/use-server-clock";
import { invalidateAndReport } from "~/lib/invalidate-refresh";
import {
  MEETING_EXCUSE_CUTOFF_MS,
  canExcusePersonalMeeting,
} from "~/lib/personal-schedule";
import { settleRefreshes } from "~/lib/settle-refreshes";

/**
 * Active-period meetings and personal recorded history. Upcoming exceptions stay
 * visible across refreshes; history mounts on demand and never offers writes.
 */
export function TutorMeetings() {
  const controller = useTutorMeetingController();
  return <TutorMeetingBrowser controller={controller} />;
}

export function TutorMeetingBrowser({
  controller,
  embedded = false,
  readable = true,
}: {
  controller: MeetingController;
  embedded?: boolean;
  /** A cached source remains reviewable through transport errors, without writes. */
  readable?: boolean;
}) {
  const t = useTranslations();
  const periods = api.tutor.meetingPeriods.useQuery();
  const denied = useSessionAccessDenied(periods);
  return (
    <section
      id={embedded ? undefined : "tutor-meetings"}
      tabIndex={-1}
      className="card scroll-mt-6 space-y-4 p-4 sm:p-5"
    >
      {!embedded && (
        <h2 className="section-title">{t("tutor.meetings.title")}</h2>
      )}
      <p className="muted">{t("tutor.meetings.help")}</p>
      <QueryFeedback
        hasData={periods.data !== undefined && !denied}
        loading={periods.isLoading}
        error={!!periods.error}
        retrying={periods.isFetching}
        loadingTitle={t("tutor.tasks.loading")}
        errorTitle={t(
          denied ? "meetingPeriods.denied" : "uiPatterns.loadFailed",
        )}
        retryLabel={t("tutor.tasks.retry")}
        onRetry={() => void periods.refetch()}
      />
      {!denied && periods.data && (
        <MeetingPeriodSections
          catalog={periods.data}
          renderPeriod={(period, history, outsideCurrent) => (
            <TutorMeetingPeriod
              controller={controller}
              period={period}
              history={history}
              outsideCurrent={outsideCurrent}
              readable={readable && !periods.error && !periods.isLoading}
            />
          )}
        />
      )}
      {!denied && controller.feedback}
    </section>
  );
}

function TutorMeetingPeriod({
  period,
  history,
  outsideCurrent,
  controller,
  readable,
}: {
  period: string;
  history: boolean;
  outsideCurrent?: string | null;
  controller: MeetingController;
  readable: boolean;
}) {
  const t = useTranslations();
  const meetings = api.tutor.meetingRecords.useQuery({
    period,
    outsideCurrent,
  });
  const denied = useSessionAccessDenied(meetings);
  useMeetingPeriodBusy(controller.pending);
  const rows = useMemo(
    () => (!denied ? (meetings.data ?? []) : []),
    [denied, meetings.data],
  );
  const serverAnchor = !history ? rows[0]?.serverNow?.getTime() : undefined;
  const boundaries = useMemo(
    () => (history ? [] : meetingClockBoundaries(rows)),
    [history, rows],
  );
  const clockNowMs = useServerBoundaryClock(serverAnchor, boundaries);
  const effectiveNow = useMemo(
    () => (clockNowMs === undefined ? undefined : new Date(clockNowMs)),
    [clockNowMs],
  );

  return (
    <div className="space-y-3">
      <QueryFeedback
        hasData={!denied && meetings.data !== undefined}
        loading={meetings.isLoading}
        error={!!meetings.error || denied}
        retrying={meetings.isFetching}
        loadingTitle={t("tutor.tasks.loading")}
        errorTitle={t(
          denied ? "meetingPeriods.denied" : "uiPatterns.loadFailed",
        )}
        retryLabel={t("tutor.tasks.retry")}
        onRetry={() => void meetings.refetch()}
      />
      {!denied && meetings.data?.length === 0 && !meetings.error && (
        <p className="muted">{t("meetingPeriods.empty")}</p>
      )}
      {!denied &&
        controller.render(
          rows,
          history,
          readable && !meetings.error && !meetings.isLoading,
          effectiveNow,
        )}
    </div>
  );
}

type MeetingRecord = Omit<
  RouterOutputs["tutor"]["meetingRecords"][number],
  "serverNow"
> & { serverNow?: Date };
type MeetingController = ReturnType<typeof useTutorMeetingController>;

/** Collect the exact post-cutoff (+1 ms) and post-start (+1 ms) instants so
 * meeting excuse/cancel controls hide automatically without polling every second. */
export function meetingClockBoundaries(list: readonly MeetingRecord[]) {
  const boundaries: number[] = [];
  for (const m of list) {
    const startMs = new Date(m.date).getTime();
    if (m.canExcuse) boundaries.push(startMs - MEETING_EXCUSE_CUTOFF_MS + 1);
    if (m.upcoming) boundaries.push(startMs + 1);
  }
  return boundaries;
}

/** Both source history and the Schedule detail entry retain this same editor.
 * Drafts are private, in-memory and keyed by meeting; closing a reader is not
 * cancellation. An accepted write's refresh retry never sends the write again. */
export function useTutorMeetingController() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const utils = api.useUtils();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const admitted = useRef<string | null>(null);
  const [lastAction, setLastAction] = useState<"excuse" | "cancel" | null>(
    null,
  );
  const refresh = () =>
    settleRefreshes([
      () => invalidateAndReport(utils.tutor.myMeetings),
      () => invalidateAndReport(utils.tutor.meetingRecords),
      () => invalidateAndReport(utils.tutor.meetingPeriods),
      () => invalidateAndReport(utils.personalSchedule.meetings),
      () => invalidateAndReport(utils.personalSchedule.meetingDetail),
    ]);
  const synchronize = async () => {
    setSyncing(true);
    try {
      await refresh();
      setSyncFailed(false);
      admitted.current = null;
    } catch {
      setSyncFailed(true);
    } finally {
      setSyncing(false);
    }
  };
  const excuse = api.tutor.excuseMeeting.useMutation({
    onSuccess: async () => {
      const id = admitted.current;
      setOpenId(null);
      if (id) setDrafts((current) => ({ ...current, [id]: "" }));
      await synchronize();
    },
    onError: () => {
      admitted.current = null;
    },
  });
  const cancel = api.tutor.cancelMeetingExcuse.useMutation({
    onSuccess: synchronize,
    onError: () => {
      admitted.current = null;
    },
  });
  const pending = !!excuse.isPending || !!cancel.isPending || syncing;
  const feedback =
    lastAction === "excuse" ? excuse : lastAction === "cancel" ? cancel : null;
  const render = (
    list: readonly MeetingRecord[],
    history = false,
    readable = true,
    now?: Date,
  ) => {
    const blocked = pending || syncFailed || !readable;
    return (
      <div className="space-y-3">
        <ul className="space-y-2">
          {list.map((m) => {
            const meetingDate = new Date(m.date);
            const upcoming =
              m.upcoming && (!now || meetingDate.getTime() >= now.getTime());
            const canExcuse =
              m.canExcuse &&
              (!now || canExcusePersonalMeeting(meetingDate, now));
            const editing =
              !history && upcoming && !m.excused && canExcuse && openId === m.id;
            return (
              <li
                key={m.id}
                className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{m.title}</p>
                  <p className="muted text-xs">
                    {programFormat.dateTime(meetingDate, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                  {m.excused && (
                    <p className="mt-0.5 text-xs text-amber-700">
                      {t("tutor.meetings.excused")}
                      {m.reason ? ` — ${m.reason}` : ""}
                    </p>
                  )}
                  {!m.excused && m.reason && (
                    <p className="muted mt-1 text-xs whitespace-pre-wrap">
                      {m.reason}
                    </p>
                  )}
                </div>

                {/* Give the open excuse editor its own bounded full-width row so input and actions wrap inside ProfileDialog. */}
                <div
                  className={
                    editing
                      ? "w-full min-w-0 basis-full"
                      : "min-w-0 max-w-full sm:shrink-0"
                  }
                >
                  {history || !upcoming ? (
                    <span className="badge-slate">
                      {m.status
                        ? t(
                            m.status === "EXEMPT"
                              ? "admin.meetings.exempt"
                              : m.status === "PRESENT"
                                ? "admin.meetings.status.present"
                                : m.status === "EXCUSED_ABSENT"
                                  ? "admin.meetings.status.excusedAbsent"
                                  : "admin.meetings.status.unexcusedAbsent",
                          )
                        : t("auditEventDetails.notRecorded")}
                    </span>
                  ) : m.excused ? (
                    canExcuse ? (
                      <button
                        className="btn-secondary btn-sm"
                        disabled={blocked}
                        onClick={() => {
                          if (blocked || admitted.current || !canExcuse) return;
                          admitted.current = m.id;
                          setLastAction("cancel");
                          cancel.mutate({ meetingId: m.id });
                        }}
                      >
                        {t("tutor.meetings.cancelExcuse")}
                      </button>
                    ) : (
                      <span className="badge-amber">
                        {t("tutor.meetings.excusedBadge")}
                      </span>
                    )
                  ) : !canExcuse ? (
                    <span className="muted text-xs">
                      {t("tutor.meetings.tooLate")}
                    </span>
                  ) : editing ? (
                    <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                      <input
                        value={drafts[m.id] ?? ""}
                        aria-label={`${m.title}: ${t("tutor.meetings.reasonPlaceholder")}`}
                        disabled={blocked}
                        maxLength={500}
                        onChange={(e) =>
                          setDrafts((current) => ({
                            ...current,
                            [m.id]: e.target.value,
                          }))
                        }
                        placeholder={t("tutor.meetings.reasonPlaceholder")}
                        className="input control-standard min-w-0 sm:w-auto sm:flex-[1_1_12rem] lg:min-h-10 lg:py-2"
                      />
                      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn-primary control-standard max-w-full lg:whitespace-normal"
                          disabled={blocked}
                          onClick={() => {
                            if (blocked || admitted.current || !canExcuse)
                              return;
                            admitted.current = m.id;
                            setLastAction("excuse");
                            const reason = (drafts[m.id] ?? "").trim();
                            excuse.mutate({
                              meetingId: m.id,
                              reason: reason.length > 0 ? reason : undefined,
                            });
                          }}
                        >
                          {t("tutor.meetings.submitExcuse")}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary control-standard max-w-full lg:whitespace-normal"
                          disabled={pending}
                          onClick={() => {
                            setOpenId(null);
                            setDrafts((current) => ({
                              ...current,
                              [m.id]: "",
                            }));
                          }}
                        >
                          {t("common.dismiss")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="btn-secondary btn-sm"
                      disabled={blocked}
                      onClick={() => {
                        if (blocked || !canExcuse) return;
                        setOpenId(m.id);
                        setLastAction(null);
                      }}
                    >
                      {t("tutor.meetings.excuseBtn")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };
  const actionFeedback = (
    <>
      {feedback?.error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {feedback.error.message}
        </p>
      )}
      {syncFailed && (
        <p role="alert" className="text-sm text-red-600">
          {t("sessionPlanning.savedRefreshFailed")}{" "}
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={syncing}
            onClick={() => void synchronize()}
          >
            {t("tutor.tasks.retry")}
          </button>
        </p>
      )}
      {feedback?.isSuccess && !syncFailed && (
        <p role="status" className="mt-2 text-sm text-green-700">
          {t("workflows.saved")}
        </p>
      )}
    </>
  );
  return {
    render,
    feedback: actionFeedback,
    pending,
    canClose: () => !pending && (!admitted.current || syncFailed),
  };
}
