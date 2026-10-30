"use client";

import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { isOpenInterview } from "~/lib/interview-order";
import { programDateKey } from "~/lib/program-time";
import { DEFAULT_TIME_ZONE } from "~/i18n/config";
import { minToHm } from "~/lib/time";
import { pairingEntries } from "~/lib/pairing-groups";
import { InlineNotice, StatePanel } from "~/app/_components/ui/patterns";
import { Button } from "~/app/_components/ui/button";
import { focusVisibleContext } from "~/app/_components/focus-visible-context";
import { resolveSchoolCalendarDay } from "~/lib/school-calendar";
import { SchoolCalendarDayContext } from "~/app/_components/school-calendar-notice";
import { useSessionAccessDenied } from "~/app/_components/session-view-state";

const taskTargets = new Set([
  "tutor-activation",
  "attendance",
  "tutor-pairings",
  "tutor-interviews",
  "tutor-meetings",
  "qualification-requests",
  "tutor-preferences",
  "room-schedule",
  "sessions",
]);

/** Summary queries share the feature components' cache. Unknown/failed reads must
 * never look like an empty task list, and inactive accounts get no write shortcuts. */
export function DashboardTasks({
  status,
  interviewsEnabled,
  meetingsEnabled,
  now: initialNow,
}: {
  status: string;
  interviewsEnabled: boolean;
  meetingsEnabled: boolean;
  now: Date;
}) {
  const t = useTranslations("tutor.tasks");
  const groupText = useTranslations("pairingGroups");
  const pairingsText = useTranslations("dashboard.pairings");
  const planning = useTranslations("sessionPlanning");
  const format = useFormatter();
  const timeZone = useTimeZone();
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    if (status !== "ACTIVE") return;
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [status]);
  const revealFrame = useRef<number | null>(null);
  const revealTask = useCallback((id: string) => {
    if (!taskTargets.has(id)) return;
    if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current);
    // Keep the anchor's native URL/history behavior; reveal after its default
    // scroll so the measured, possibly wrapped header cannot cover the heading.
    revealFrame.current = requestAnimationFrame(() => {
      revealFrame.current = null;
      if (window.location.hash === `#${id}`)
        focusVisibleContext(document.getElementById(id));
    });
  }, []);
  useEffect(() => {
    const revealHash = () => revealTask(window.location.hash.slice(1));
    revealHash();
    window.addEventListener("hashchange", revealHash);
    return () => {
      window.removeEventListener("hashchange", revealHash);
      if (revealFrame.current !== null)
        cancelAnimationFrame(revealFrame.current);
    };
  }, [revealTask]);
  const active = status === "ACTIVE";
  const agenda = api.sessionPlanning.agenda.useQuery(
    { role: "tutor" },
    {
      enabled: active,
      refetchInterval: active ? 30_000 : false,
    },
  );
  const agendaDenied = useSessionAccessDenied(agenda);
  const schoolTimeZone = agenda.data?.timeZone ?? timeZone ?? DEFAULT_TIME_ZONE;
  const date = programDateKey(now, schoolTimeZone);
  const calendar = api.program.schoolCalendar.useQuery(
    { from: date, to: date },
    {
      enabled: active,
      refetchInterval: active ? 60_000 : false,
    },
  );
  const pairings = api.tutor.myPairings.useQuery();
  const roster = api.studentWorkflow.tutorRoster.useQuery();
  const removals = api.tutor.myTuteeRemovalRequests.useQuery();
  const membership = api.tutor.myStatusRequest.useQuery();
  const qualifications = api.qualificationApplication.mine.useQuery();
  const interviews = api.tutor.myInterviews.useQuery(undefined, {
    enabled: active && interviewsEnabled,
  });
  const meetings = api.tutor.myMeetings.useQuery(undefined, {
    enabled: active && meetingsEnabled,
  });
  const queries = [
    pairings,
    roster,
    qualifications,
    removals,
    membership,
    ...(active ? [calendar] : []),
    ...(active ? [agenda] : []),
    ...(active && interviewsEnabled ? [interviews] : []),
    ...(active && meetingsEnabled ? [meetings] : []),
  ];
  const schoolDay = resolveSchoolCalendarDay(date, calendar.data ?? []);
  const entries = pairingEntries(pairings.data ?? []);
  // Weekly assignments still own setup/repair tasks. Today's teaching uses only
  // effective dated cohorts, so moved/cancelled originals cannot reappear here.
  const today = (agendaDenied ? [] : (agenda.data?.cohorts ?? [])).filter(
    (cohort) =>
      cohort.date === date &&
      !cohort.unavailable &&
      (cohort.status === "SCHEDULED" || cohort.status === "RECORDED"),
  );
  // One valid unscheduled group is one plan, not one task for every subject.
  // Invalid groups get their own repair task rather than an invented appointment.
  const unscheduled = entries.filter(
    (entry) =>
      entry.groupStatus !== "needsRepair" && !entry.primary.scheduleConfirmed,
  ).length;
  const needsRepair = entries.filter(
    (entry) => entry.groupStatus === "needsRepair",
  ).length;
  const reviews = (roster.data ?? []).filter(
    (r) => r.pending || !r.verified || r.editedAt,
  ).length;
  const pendingQualifications = (qualifications.data?.requests ?? []).filter(
    (request) => request.status === "PENDING" || request.status === "INTERVIEW",
  ).length;
  const pendingInterviews = (interviews.data ?? []).filter(
    (interview) => !interview.isInvalid && isOpenInterview(interview),
  ).length;
  const links = [
    ...(status === "PENDING"
      ? [{ id: "tutor-activation", label: t("activation") }]
      : []),
    ...(unscheduled || needsRepair || reviews || removals.data?.length
      ? [
          {
            id: "tutor-pairings",
            label: pairingsText("title"),
            detail: [
              ...(pairings.data
                ? [t("unconfirmedCount", { count: unscheduled })]
                : []),
              ...(needsRepair
                ? [groupText("repairCount", { count: needsRepair })]
                : []),
              ...(roster.data ? [t("rosterCount", { count: reviews })] : []),
              ...(removals.data?.length
                ? [t("pendingOptOuts", { count: removals.data.length })]
                : []),
            ].join(" · "),
          },
        ]
      : []),
    ...(active && interviewsEnabled && pendingInterviews
      ? [
          {
            id: "tutor-interviews",
            label: t("interviews", { count: pendingInterviews }),
          },
        ]
      : []),
    ...(active && meetingsEnabled && meetings.data?.length
      ? [
          {
            id: "tutor-meetings",
            label: t("meetings", { count: meetings.data.length }),
          },
        ]
      : []),
    ...(pendingQualifications
      ? [
          {
            id: "qualification-requests",
            label: t("qualifications", { count: pendingQualifications }),
          },
        ]
      : []),
  ];
  // Native anchors keep history/modifier behavior; actionable tasks retain measured-header reveal.
  const anchor = (id: string, label: string) => (
    <a
      className="link inline-flex min-h-11 items-center lg:min-h-8"
      href={`#${id}`}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        document.getElementById(id)?.focus({ preventScroll: true });
        revealTask(id);
      }}
    >
      {label}
    </a>
  );

  return (
    <section
      aria-labelledby="tutor-tasks-heading"
      className="card space-y-3 p-4 sm:p-5"
    >
      <h2 id="tutor-tasks-heading" className="section-title">
        {t("attention")}
      </h2>
      <p className="muted text-sm">
        {t(active ? "activeHelp" : "readonlyHelp")}
      </p>
      {queries.some((query) => query.data === undefined && !query.error) && (
        <InlineNotice announcement="status">{t("loading")}</InlineNotice>
      )}
      {queries.some((query) => query.error) && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button
              size="compact"
              onClick={() => {
                for (const query of queries)
                  if (query.error) void query.refetch();
              }}
            >
              {t("retry")}
            </Button>
          }
        >
          {t("loadError")}
          {active && !agendaDenied && agenda.data && agenda.error && (
            <p className="mt-1">{planning("refreshFailed")}</p>
          )}
        </InlineNotice>
      )}
      <nav aria-label={t("attention")}>
        {membership.data && (
          <a className="btn-secondary btn-sm" href="/settings">
            {t("membershipPending")}
          </a>
        )}
        <ul className="divide-y divide-slate-100">
          {links.map((entry) => (
            <li key={entry.id} className="py-1">
              {anchor(entry.id, entry.label)}
              {"detail" in entry && (
                <p className="muted text-sm">{entry.detail}</p>
              )}
            </li>
          ))}
        </ul>
        {!membership.data &&
          !links.length &&
          queries.every(
            (query) => query.data !== undefined && !query.error,
          ) && <p className="muted text-sm">{t("emptyTasks")}</p>}
      </nav>
      {active && (
        <div className="border-t border-slate-100 pt-3">
          <h3 className="font-semibold">
            {t("today", {
              date: format.dateTime(now, {
                dateStyle: "medium",
                timeZone: schoolTimeZone,
              }),
            })}
          </h3>
          <p className="muted mt-1 text-sm">{t("scheduleHelp")}</p>
          <p className="muted text-xs">
            {planning("zone", { timeZone: schoolTimeZone })}
          </p>
          {calendar.data && !calendar.error && (
            <SchoolCalendarDayContext {...schoolDay} />
          )}
          {anchor("attendance", t("attendance"))}
          {agendaDenied && (
            <StatePanel
              kind="denied"
              title={planning("denied")}
              action={
                <Button
                  disabled={agenda.isFetching}
                  onClick={() => void agenda.refetch()}
                >
                  {planning("retry")}
                </Button>
              }
            />
          )}
          {agenda.data && !agenda.error && !agendaDenied && !today.length && (
            <p className="mt-2 text-sm">{t("noSessions")}</p>
          )}
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {today.map((cohort) => (
              <li
                key={cohort.id}
                className="rounded-lg bg-slate-50 p-3 text-sm"
              >
                <p className="font-semibold">{cohort.subjects.join(" + ")}</p>
                <p>
                  {minToHm(cohort.startMin)}–{minToHm(cohort.endMin)} ·{" "}
                  {cohort.online
                    ? planning("online")
                    : (cohort.roomName ?? t("noRoom"))}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {cohort.kind === "EXTRA" && (
                    <span className="badge-slate">{planning("extra")}</span>
                  )}
                  {cohort.rescheduled && (
                    <span className="badge-slate">
                      {planning("rescheduled")}
                    </span>
                  )}
                  {cohort.status === "RECORDED" && (
                    <span className="badge-slate">{planning("recorded")}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
