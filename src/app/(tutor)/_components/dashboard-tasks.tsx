"use client";

import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";
import { api } from "~/trpc/react";
import { programDateKey } from "~/lib/program-time";
import { minToHm } from "~/lib/time";
import { InlineNotice } from "~/app/_components/ui/patterns";
import { Button } from "~/app/_components/ui/button";
import { focusVisibleContext } from "~/app/_components/focus-visible-context";

const taskTargets = new Set([
  "tutor-activation",
  "attendance",
  "tutor-pairings",
  "tutor-interviews",
  "tutor-meetings",
  "qualification-requests",
  "tutor-preferences",
  "room-schedule",
]);

/** Summary queries share the feature components' cache. Unknown/failed reads must
 * never look like an empty task list, and inactive accounts get no write shortcuts. */
export function DashboardTasks({
  status,
  interviewsEnabled,
  meetingsEnabled,
  now,
}: {
  status: string;
  interviewsEnabled: boolean;
  meetingsEnabled: boolean;
  now: Date;
}) {
  const t = useTranslations("tutor.tasks");
  const pairingsText = useTranslations("dashboard.pairings");
  const format = useFormatter();
  const timeZone = useTimeZone();
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
    ...(active && interviewsEnabled ? [interviews] : []),
    ...(active && meetingsEnabled ? [meetings] : []),
  ];
  const date = programDateKey(now, timeZone);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  const today = (pairings.data ?? []).filter(
    (pairing) => pairing.scheduleConfirmed && pairing.dayOfWeek === weekday,
  );
  const unscheduled = (pairings.data ?? []).filter(
    (p) => !p.scheduleConfirmed,
  ).length;
  const reviews = (roster.data ?? []).filter(
    (r) => r.pending || !r.verified || r.editedAt,
  ).length;
  const pendingQualifications = (qualifications.data?.requests ?? []).filter(
    (request) => request.status === "PENDING" || request.status === "INTERVIEW",
  ).length;
  const pendingInterviews = (interviews.data ?? []).filter(
    (interview) =>
      interview.status === "PENDING" || interview.status === "INTERVIEW",
  ).length;
  const links = [
    ...(status === "PENDING"
      ? [{ id: "tutor-activation", label: t("activation") }]
      : []),
    ...(active ? [{ id: "attendance", label: t("attendance") }] : []),
    {
      id: "tutor-pairings",
      label: pairings.data
        ? t("pairings", { count: pairings.data.length })
        : pairingsText("title"),
    },
    ...(unscheduled || reviews
      ? [
          {
            id: "tutor-pairings",
            label: t("scheduleReview", { count: unscheduled + reviews }),
          },
        ]
      : []),
    ...(removals.data?.length
      ? [
          {
            id: "tutor-pairings",
            label: t("pendingOptOuts", { count: removals.data.length }),
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
    { id: "tutor-preferences", label: t("preferences") },
    { id: "room-schedule", label: t("roomSchedule") },
  ];

  return (
    <section
      aria-labelledby="tutor-tasks-heading"
      className="card space-y-3 p-4 sm:p-5"
    >
      <h2 id="tutor-tasks-heading" className="section-title">
        {t("title")}
      </h2>
      <p className="muted text-sm">
        {t(active ? "activeHelp" : "readonlyHelp")}
      </p>
      {queries.some((query) => query.isLoading) && (
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
        </InlineNotice>
      )}
      <nav aria-label={t("title")} className="flex flex-wrap gap-2">
        {membership.data && (
          <a className="btn-secondary btn-sm" href="/settings">
            {t("membershipPending")}
          </a>
        )}
        {links.map(({ id, label }, index) => (
          <a
            key={`${id}-${index}`}
            className="btn-secondary btn-sm"
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
        ))}
      </nav>
      {active && (
        <div className="border-t border-slate-100 pt-3">
          <h3 className="font-semibold">
            {t("today", {
              date: format.dateTime(now, { dateStyle: "medium" }),
            })}
          </h3>
          <p className="muted mt-1 text-sm">{t("scheduleHelp")}</p>
          {pairings.data && !today.length && (
            <p className="mt-2 text-sm">{t("noSessions")}</p>
          )}
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {today.map((pairing) => (
              <li
                key={pairing.id}
                className="rounded-lg bg-slate-50 p-3 text-sm"
              >
                <p className="font-semibold">{pairing.subject}</p>
                <p>
                  {minToHm(pairing.startMin)}–{minToHm(pairing.endMin)} ·{" "}
                  {pairing.room?.name ?? t("noRoom")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
