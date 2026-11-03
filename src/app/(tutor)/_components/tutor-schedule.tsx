"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import {
  SessionAgenda,
  type SupplementalScheduleEvent,
  type SessionOverview,
} from "~/app/_components/session-agenda";
import { useSessionAccessDenied } from "~/app/_components/session-view-state";
import { Button } from "~/app/_components/ui/button";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { ScheduleInterviewDetails } from "./schedule-interview-details";
import { ScheduleMeetingDetails } from "./schedule-meeting-details";
import { upcomingPreview, type ScheduleView } from "~/lib/schedule-overview";
import { focusVisibleContext } from "~/app/_components/focus-visible-context";

/** The agenda shares dates, not write authority. Each private detail keeps its own
 * retained controller and opens only after a deliberate participant action.
 * Native chair links match the detail reader and restart dashboard fragment arrival. */
export function TutorSchedule({
  active,
  interviewsEnabled,
  meetingsEnabled,
  compact = false,
}: {
  active: boolean;
  interviewsEnabled: boolean;
  meetingsEnabled: boolean;
  now: Date;
  compact?: boolean;
}) {
  const t = useTranslations("unifiedSchedule");
  const format = useFormatter();
  const [view, setView] = useState<ScheduleView>("upcoming");
  const interviewEvents = api.personalSchedule.interviews.useInfiniteQuery(
    { view, includeSummary: false },
    {
      enabled: active && interviewsEnabled,
      refetchInterval: active && interviewsEnabled ? 30_000 : false,
      getNextPageParam: (page) => page.pageInfo.nextCursor ?? undefined,
    },
  );
  const meetingEvents = api.personalSchedule.meetings.useInfiniteQuery(
    { view, includeSummary: false },
    {
      enabled: active && meetingsEnabled,
      refetchInterval: active && meetingsEnabled ? 30_000 : false,
      getNextPageParam: (page) => page.pageInfo.nextCursor ?? undefined,
    },
  );
  const interviews = api.personalSchedule.interviews.useQuery(undefined, {
    enabled: active && interviewsEnabled,
    refetchInterval: active && interviewsEnabled ? 30_000 : false,
  });
  const meetings = api.personalSchedule.meetings.useQuery(undefined, {
    enabled: active && meetingsEnabled,
    refetchInterval: active && meetingsEnabled ? 30_000 : false,
  });
  const interviewSummaryDenied = useSessionAccessDenied(interviews);
  const interviewEventsDenied = useSessionAccessDenied(interviewEvents);
  const meetingSummaryDenied = useSessionAccessDenied(meetings);
  const meetingEventsDenied = useSessionAccessDenied(meetingEvents);
  const interviewsDenied = interviewSummaryDenied || interviewEventsDenied;
  const meetingsDenied = meetingSummaryDenied || meetingEventsDenied;
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [allInterviews, setAllInterviews] = useState(false);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [allMeetings, setAllMeetings] = useState(false);
  useEffect(() => {
    if (!compact || !active) return;
    const arrive = () => {
      if (document.querySelector("dialog[open]")) return;
      const hash = window.location.hash;
      if (
        interviewsEnabled &&
        !interviewsDenied &&
        (hash === "#tutor-appointments" ||
          (window.location.pathname === "/schedule" &&
            hash === "#tutor-interviews"))
      ) {
        setInterviewId(null);
        setAllInterviews(true);
      }
      if (meetingsEnabled && !meetingsDenied && hash === "#tutor-meetings") {
        setMeetingId(null);
        setAllMeetings(true);
      }
    };
    arrive();
    window.addEventListener("hashchange", arrive);
    return () => window.removeEventListener("hashchange", arrive);
  }, [
    compact,
    active,
    interviewsEnabled,
    meetingsEnabled,
    interviewsDenied,
    meetingsDenied,
  ]);
  const [mountedOwners, setMountedOwners] = useState({
    interviews: active && interviewsEnabled,
    meetings: active && meetingsEnabled,
  });
  // Retain each owner once admitted, including through feature revocation, so
  // in-flight writes and drafts survive while its private DOM is concealed.
  if (
    (active && interviewsEnabled && !mountedOwners.interviews) ||
    (active && meetingsEnabled && !mountedOwners.meetings)
  ) {
    setMountedOwners({
      interviews: mountedOwners.interviews || (active && interviewsEnabled),
      meetings: mountedOwners.meetings || (active && meetingsEnabled),
    });
  }
  const interviewRows =
    active && interviewsEnabled && !interviewsDenied
      ? interviews.data
      : undefined;
  const meetingRows =
    active && meetingsEnabled && !meetingsDenied ? meetings.data : undefined;
  const datedInterviews =
    active && interviewsEnabled && !interviewsDenied
      ? (interviewEvents.data?.pages.flatMap((page) => page.appointments) ?? [])
      : [];
  const datedMeetings =
    active && meetingsEnabled && !meetingsDenied
      ? (meetingEvents.data?.pages.flatMap((page) => page.appointments) ?? [])
      : [];
  const arrivedHash = useRef<string | null>(null);
  useEffect(() => {
    let frame: number | undefined;
    const arrive = (force = false) => {
      const hash = window.location.hash;
      if (
        (!force && hash === arrivedHash.current) ||
        document.querySelector("dialog[open]")
      )
        return;
      const known =
        !!interviewRows?.appointments.some(
          (row) => hash === `#interview-${row.id}`,
        ) ||
        !!meetingRows?.appointments.some(
          (row) => hash === `#meeting-${row.id}`,
        );
      if (!known) return;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (
          window.location.hash === hash &&
          !document.querySelector("dialog[open]")
        ) {
          const target = document.getElementById(hash.slice(1));
          if (target) {
            focusVisibleContext(target);
            arrivedHash.current = hash;
          }
        }
      });
    };
    arrive();
    const changed = () => arrive(true);
    window.addEventListener("hashchange", changed);
    return () => {
      window.removeEventListener("hashchange", changed);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [interviewRows, meetingRows]);
  const timeText = (date: Date) =>
    format.dateTime(date, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const events: SupplementalScheduleEvent[] = [
    ...datedInterviews.map((row) => ({
      id: `interview:${row.id}`,
      startsAt: row.interviewAt,
      content: (
        <article
          id={`interview-${row.id}`}
          tabIndex={-1}
          className="card scroll-mt-6 space-y-3 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
              <h3 className="font-semibold">{row.name}</h3>
              <p>
                <time dateTime={row.interviewAt.toISOString()}>
                  {timeText(row.interviewAt)}
                </time>
              </p>
              <p className="muted text-sm">{row.subjects.join(" / ")}</p>
              <p className="muted text-sm">{t("endUnknown")}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <span className="badge">{t("interview")}</span>
              <span className="badge-slate">
                {t(row.isHead ? "chair" : "panelist")}
              </span>
            </div>
          </div>
          {row.isHead ? (
            <a
              className="link inline-flex min-h-11 items-center lg:min-h-8"
              href={
                compact ? "#chair-interviews" : "/dashboard#tutor-interviews"
              }
            >
              {t("openChair")}
            </a>
          ) : (
            <Button
              size="compact"
              onClick={() => {
                setAllInterviews(false);
                setInterviewId(row.id);
              }}
            >
              {t("openInterview")}
            </Button>
          )}
        </article>
      ),
    })),
    ...datedMeetings.map((row) => ({
      id: `meeting:${row.id}`,
      startsAt: row.date,
      content: (
        <article
          id={`meeting-${row.id}`}
          tabIndex={-1}
          className="card scroll-mt-6 space-y-3 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
              <h3 className="font-semibold">{row.title}</h3>
              <p>
                <time dateTime={row.date.toISOString()}>
                  {timeText(row.date)}
                </time>
              </p>
              <p className="muted text-sm">{t("endUnknown")}</p>
              {row.excused && (
                <p className="text-sm text-amber-900">{t("excused")}</p>
              )}
            </div>
            <span className="badge">{t("meeting")}</span>
          </div>
          <Button
            size="compact"
            onClick={() => {
              setAllMeetings(false);
              setMeetingId(row.id);
            }}
          >
            {t("openMeeting")}
          </Button>
        </article>
      ),
    })),
  ];

  function renderOverview(overview: SessionOverview) {
    const previewItems = upcomingPreview([
      ...overview.items,
      ...(interviewRows?.appointments ?? []).map((row) => ({
        id: `interview:${row.id}`,
        startsAt: row.interviewAt,
        sortAt: row.interviewAt,
        needsAction: false,
        title: row.name,
        detail: t("interview"),
        action: row.isHead ? (
          <a
            className="link inline-flex min-h-11 items-center lg:min-h-8"
            href={compact ? "#chair-interviews" : "/dashboard#tutor-interviews"}
          >
            {t("openChair")}
          </a>
        ) : (
          <Button
            size="compact"
            onClick={() => {
              setAllInterviews(false);
              setInterviewId(row.id);
            }}
          >
            {t("openInterview")}
          </Button>
        ),
      })),
      ...(interviewRows?.actionableTasks ?? []).map((row) => ({
        id: `interview:${row.id}`,
        startsAt: row.startsAt,
        sortAt: row.sortAt,
        needsAction: true,
        title: row.name,
        detail: t(`action.${row.action}`),
        action:
          row.action === "completion" ? (
            <a
              href="/admin/applications#interview-records"
              className="link inline-flex min-h-11 items-center lg:min-h-8"
            >
              {t("viewEvent")}
            </a>
          ) : row.isHead ? (
            <a
              href={
                compact ? "#chair-interviews" : "/dashboard#tutor-interviews"
              }
              className="link inline-flex min-h-11 items-center lg:min-h-8"
            >
              {t("openChair")}
            </a>
          ) : (
            <Button
              size="compact"
              onClick={() => {
                setAllInterviews(false);
                setInterviewId(row.id);
              }}
            >
              {t("openInterview")}
            </Button>
          ),
      })),
      ...(meetingRows?.actionableTasks ?? []).map((row) => ({
        id: `meeting:${row.id}`,
        startsAt: row.startsAt,
        sortAt: row.sortAt,
        needsAction: false,
        title: row.title,
        detail: t("action.reviewMeeting"),
        action: (
          <Button
            size="compact"
            onClick={() => {
              setAllMeetings(false);
              setMeetingId(row.id);
            }}
          >
            {t("openMeeting")}
          </Button>
        ),
      })),
    ]);
    if (compact)
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="compact"
              onClick={overview.openExtra}
              disabled={!overview.canAddExtra}
            >
              {t("addExtra")}
            </Button>
            {active && interviewsEnabled && (
              <Button
                size="compact"
                disabled={interviewsDenied}
                onClick={() => {
                  setInterviewId(null);
                  setAllInterviews(true);
                }}
              >
                {t("interviewWork")}
              </Button>
            )}
            {active && meetingsEnabled && (
              <Button
                size="compact"
                disabled={meetingsDenied}
                onClick={() => {
                  setMeetingId(null);
                  setAllMeetings(true);
                }}
              >
                {t("meetingWork")}
              </Button>
            )}
          </div>
          {overview.extraSourceUnavailable && (
            <p className="muted text-sm">{t("noExtraSource")}</p>
          )}
          <QueryFeedback
            hasData={!interviewsEnabled || !!interviewRows}
            loading={active && interviewsEnabled && interviews.isLoading}
            error={
              active &&
              interviewsEnabled &&
              (!!interviews.error || interviewsDenied)
            }
            retrying={interviews.isFetching}
            loadingTitle={t("loadingInterviews")}
            errorTitle={t(interviewsDenied ? "denied" : "interviewsFailed")}
            retryLabel={t("retry")}
            onRetry={() => void interviews.refetch()}
          />
          <QueryFeedback
            hasData={!meetingsEnabled || !!meetingRows}
            loading={active && meetingsEnabled && meetings.isLoading}
            error={
              active && meetingsEnabled && (!!meetings.error || meetingsDenied)
            }
            retrying={meetings.isFetching}
            loadingTitle={t("loadingMeetings")}
            errorTitle={t(meetingsDenied ? "denied" : "meetingsFailed")}
            retryLabel={t("retry")}
            onRetry={() => void meetings.refetch()}
          />
          {previewItems.some((item) => item.needsAction) && (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 px-3">
              {previewItems
                .filter((item) => item.needsAction)
                .map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="muted text-sm">{item.detail}</p>
                    </div>
                    {item.action}
                  </li>
                ))}
            </ul>
          )}
        </div>
      );
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {active && interviewsEnabled && (
          <section
            id="tutor-interviews"
            tabIndex={-1}
            className="card scroll-mt-6 space-y-3 p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="section-title">{t("interviews")}</h2>
              <Button
                size="compact"
                disabled={interviewsDenied}
                onClick={() => {
                  setInterviewId(null);
                  setAllInterviews(true);
                }}
              >
                {t("interviewWork")}
              </Button>
            </div>
            <QueryFeedback
              hasData={!!interviewRows}
              loading={interviews.isLoading}
              error={!!interviews.error || interviewsDenied}
              retrying={interviews.isFetching}
              loadingTitle={t("loadingInterviews")}
              errorTitle={t(interviewsDenied ? "denied" : "interviewsFailed")}
              retryLabel={t("retry")}
              onRetry={() => void interviews.refetch()}
            />
            {interviewRows && (
              <p className="muted text-sm">
                {t(
                  interviewRows.tasks.length
                    ? "interviewAttention"
                    : "interviewHelp",
                )}
              </p>
            )}
            {interviewRows?.tasks.slice(0, 3).map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3"
              >
                <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
                  <h3 className="font-semibold">{row.name}</h3>
                  <p className="text-sm">{t(`task.${row.reason}`)}</p>
                  {row.interviewAt && (
                    <p className="muted text-sm">{timeText(row.interviewAt)}</p>
                  )}
                </div>
                {row.isHead ? (
                  <a
                    className="link inline-flex min-h-11 items-center lg:min-h-8"
                    href={
                      compact
                        ? "#tutor-interviews"
                        : "/dashboard#tutor-interviews"
                    }
                  >
                    {t("openChair")}
                  </a>
                ) : (
                  <Button
                    size="compact"
                    onClick={() => {
                      setAllInterviews(false);
                      setInterviewId(row.id);
                    }}
                  >
                    {t("openInterview")}
                  </Button>
                )}
              </div>
            ))}
          </section>
        )}
        {active && meetingsEnabled && (
          <section
            id="tutor-meetings"
            tabIndex={-1}
            className="card scroll-mt-6 space-y-3 p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="section-title">{t("meetings")}</h2>
              <Button
                size="compact"
                disabled={meetingsDenied}
                onClick={() => {
                  setMeetingId(null);
                  setAllMeetings(true);
                }}
              >
                {t("meetingWork")}
              </Button>
            </div>
            <p className="muted text-sm">{t("meetingHelp")}</p>
            <QueryFeedback
              hasData={!!meetingRows}
              loading={meetings.isLoading}
              error={!!meetings.error || meetingsDenied}
              retrying={meetings.isFetching}
              loadingTitle={t("loadingMeetings")}
              errorTitle={t(meetingsDenied ? "denied" : "meetingsFailed")}
              retryLabel={t("retry")}
              onRetry={() => void meetings.refetch()}
            />
          </section>
        )}
        <section
          className="card space-y-3 p-4 sm:p-5"
          aria-labelledby="sessions-overview-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="sessions-overview-title" className="section-title">
              {t("sessions")}
            </h2>
            <Button
              size="compact"
              onClick={overview.openExtra}
              disabled={!overview.canAddExtra}
            >
              {t("addExtra")}
            </Button>
          </div>
          <p className="muted text-sm">{t("sessionsHelp")}</p>
          {overview.extraSourceUnavailable && (
            <p className="muted text-sm">{t("noExtraSource")}</p>
          )}
          <a
            href={compact ? "#tutor-pairings" : "/dashboard#tutor-pairings"}
            className="link inline-flex min-h-11 items-center lg:min-h-8"
          >
            {t("openPairings")}
          </a>
        </section>
        <section
          className="card space-y-3 p-4 sm:p-5"
          aria-labelledby="upcoming-overview-title"
        >
          <h2 id="upcoming-overview-title" className="section-title">
            {t("upcoming")}
          </h2>
          <p className="muted text-sm">{t("upcomingHelp")}</p>
          {!previewItems.length && (
            <p className="muted text-sm">{t("nothingUpcoming")}</p>
          )}
          {previewItems.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3"
            >
              <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
                <h3 className="font-semibold">{item.title}</h3>
                <p className="text-sm">{item.detail}</p>
                {item.startsAt && (
                  <p className="muted text-sm">{timeText(item.startsAt)}</p>
                )}
              </div>
              {item.action}
            </div>
          ))}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div id="attendance" tabIndex={-1} className="scroll-mt-6">
        <SessionAgenda
          role="tutor"
          heading={t("agenda")}
          supplementalEvents={events}
          view={view}
          onViewChange={setView}
          renderOverview={renderOverview}
          pagination={
            <div className="space-y-2">
              {active && interviewsEnabled && (
                <>
                  <QueryFeedback
                    hasData={!!interviewEvents.data && !interviewsDenied}
                    loading={interviewEvents.isLoading}
                    error={!!interviewEvents.error || interviewsDenied}
                    retrying={interviewEvents.isFetching}
                    loadingTitle={t("loadingInterviews")}
                    errorTitle={t(
                      interviewsDenied ? "denied" : "interviewsFailed",
                    )}
                    retryLabel={t("retry")}
                    onRetry={() => void interviewEvents.refetch()}
                  />
                  {interviewEvents.hasNextPage && !interviewsDenied && (
                    <Button
                      size="compact"
                      disabled={interviewEvents.isFetching}
                      onClick={() => void interviewEvents.fetchNextPage()}
                    >
                      {t("moreInterviews")}
                    </Button>
                  )}
                </>
              )}
              {active && meetingsEnabled && (
                <>
                  <QueryFeedback
                    hasData={!!meetingEvents.data && !meetingsDenied}
                    loading={meetingEvents.isLoading}
                    error={!!meetingEvents.error || meetingsDenied}
                    retrying={meetingEvents.isFetching}
                    loadingTitle={t("loadingMeetings")}
                    errorTitle={t(meetingsDenied ? "denied" : "meetingsFailed")}
                    retryLabel={t("retry")}
                    onRetry={() => void meetingEvents.refetch()}
                  />
                  {meetingEvents.hasNextPage && !meetingsDenied && (
                    <Button
                      size="compact"
                      disabled={meetingEvents.isFetching}
                      onClick={() => void meetingEvents.fetchNextPage()}
                    >
                      {t("moreMeetings")}
                    </Button>
                  )}
                </>
              )}
            </div>
          }
        />
      </div>
      <p className="muted text-sm">{t("calendarScope")}</p>
      {mountedOwners.interviews && (
        <ScheduleInterviewDetails
          enabled={active && interviewsEnabled && !interviewsDenied}
          applicationId={interviewId}
          showAll={allInterviews}
          onClose={() => {
            setInterviewId(null);
            setAllInterviews(false);
          }}
        />
      )}
      {mountedOwners.meetings && (
        <ScheduleMeetingDetails
          enabled={active && meetingsEnabled && !meetingsDenied}
          meetingId={meetingId}
          showAll={allMeetings}
          onClose={() => {
            setMeetingId(null);
            setAllMeetings(false);
          }}
        />
      )}
    </div>
  );
}
