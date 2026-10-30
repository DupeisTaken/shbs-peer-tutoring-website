"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import {
  SessionAgenda,
  type SupplementalScheduleEvent,
} from "~/app/_components/session-agenda";
import { useSessionAccessDenied } from "~/app/_components/session-view-state";
import { Button } from "~/app/_components/ui/button";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { ScheduleInterviewDetails } from "./schedule-interview-details";
import { ScheduleMeetingDetails } from "./schedule-meeting-details";
import { focusVisibleContext } from "~/app/_components/focus-visible-context";

/** The agenda shares dates, not write authority. Each private detail keeps its own
 * retained controller and opens only after a deliberate participant action. */
export function TutorSchedule({
  active,
  interviewsEnabled,
  meetingsEnabled,
}: {
  active: boolean;
  interviewsEnabled: boolean;
  meetingsEnabled: boolean;
  now: Date;
}) {
  const t = useTranslations("unifiedSchedule");
  const format = useFormatter();
  const interviews = api.personalSchedule.interviews.useQuery(undefined, {
    enabled: active && interviewsEnabled,
    refetchInterval: active && interviewsEnabled ? 30_000 : false,
  });
  const meetings = api.personalSchedule.meetings.useQuery(undefined, {
    enabled: active && meetingsEnabled,
    refetchInterval: active && meetingsEnabled ? 30_000 : false,
  });
  const interviewsDenied = useSessionAccessDenied(interviews);
  const meetingsDenied = useSessionAccessDenied(meetings);
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [allInterviews, setAllInterviews] = useState(false);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [allMeetings, setAllMeetings] = useState(false);
  const [mountedOwners, setMountedOwners] = useState({
    interviews: active && interviewsEnabled,
    meetings: active && meetingsEnabled,
  });
  useEffect(() => {
    if (
      (active && interviewsEnabled && !mountedOwners.interviews) ||
      (active && meetingsEnabled && !mountedOwners.meetings)
    ) {
      setMountedOwners((previous) => ({
        interviews: previous.interviews || (active && interviewsEnabled),
        meetings: previous.meetings || (active && meetingsEnabled),
      }));
    }
  }, [active, interviewsEnabled, meetingsEnabled, mountedOwners]);
  const interviewRows =
    active && interviewsEnabled && !interviewsDenied
      ? interviews.data
      : undefined;
  const meetingRows =
    active && meetingsEnabled && !meetingsDenied ? meetings.data : undefined;
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
    ...(interviewRows?.appointments ?? []).map((row) => ({
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
            <Link
              className="link inline-flex min-h-11 items-center lg:min-h-8"
              href="/dashboard#tutor-interviews"
            >
              {t("openChair")}
            </Link>
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
    ...(meetingRows?.appointments ?? []).map((row) => ({
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

  return (
    <div className="space-y-6">
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
            {interviewRows?.tasks.map((row) => (
              <div
                key={row.id}
                className="space-y-1 border-t border-slate-200 pt-3"
              >
                <h3 className="font-semibold">{row.name}</h3>
                <p className="text-sm">{t(`task.${row.reason}`)}</p>
                {row.interviewAt && (
                  <p className="muted text-sm">{timeText(row.interviewAt)}</p>
                )}
                {row.isHead ? (
                  <Link
                    className="link inline-flex min-h-11 items-center lg:min-h-8"
                    href="/dashboard#tutor-interviews"
                  >
                    {t("openChair")}
                  </Link>
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
      </div>
      <div id="attendance" tabIndex={-1} className="scroll-mt-6">
        <SessionAgenda
          role="tutor"
          heading={t("agenda")}
          supplementalEvents={events}
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
