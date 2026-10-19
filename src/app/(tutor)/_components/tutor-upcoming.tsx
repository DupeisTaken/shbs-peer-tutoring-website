"use client";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useTimeZone, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { DEFAULT_TIME_ZONE } from "~/i18n/config";
import { tutorUpcoming } from "~/lib/tutor-upcoming";
import { programDateKey } from "~/lib/program-time";
import { viewAccessDenied } from "~/lib/session-view-state";
import { settleRefreshes } from "~/lib/settle-refreshes";
import { Button } from "~/app/_components/ui/button";
import { InlineNotice, StatePanel } from "~/app/_components/ui/patterns";
import { focusVisibleContext } from "~/app/_components/focus-visible-context";

/** Personal query evidence stays outside RoomGrid. Transient read failures retain
 * partial content. Both readers share tutor authorization, so either denial hides all. */
export function TutorUpcoming({
  active,
  interviewsEnabled,
  now: initialNow,
}: {
  active: boolean;
  interviewsEnabled: boolean;
  now: Date;
}) {
  const t = useTranslations("tutorUpcoming");
  const format = useFormatter();
  const timeZone = useTimeZone() ?? DEFAULT_TIME_ZONE;
  const [now, setNow] = useState(initialNow);
  const [denied, setDenied] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const recoveryAdmission = useRef(false);
  useEffect(() => {
    if (!active) return;
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [active]);
  const pairings = api.tutor.myPairings.useQuery(undefined, {
    enabled: active,
    refetchInterval: active ? 60_000 : false,
  });
  const interviews = api.tutor.myInterviews.useQuery(undefined, {
    enabled: active && interviewsEnabled,
    refetchInterval: active && interviewsEnabled ? 60_000 : false,
  });
  const deniedNow =
    viewAccessDenied(pairings.error) ||
    (interviewsEnabled && viewAccessDenied(interviews.error));
  useEffect(() => {
    if (deniedNow) setDenied(true);
  }, [deniedNow]);
  const sources = [
    { name: t("sessions"), query: pairings },
    ...(interviewsEnabled
      ? [{ name: t("interviews"), query: interviews }]
      : []),
  ];
  async function recoverAccess() {
    if (recoveryAdmission.current) return;
    recoveryAdmission.current = true;
    setRecovering(true);
    try {
      // Untouched sibling cache success is not new authorization evidence. Hold
      // the boundary until every enabled source's explicit fresh read settles.
      await settleRefreshes(
        sources.map(({ query }) => async () => {
          const result = await query.refetch({ throwOnError: true });
          if (!result.data) throw new Error("Missing schedule response");
        }),
      );
      setDenied(false);
    } catch {
      setDenied(true);
    } finally {
      recoveryAdmission.current = false;
      setRecovering(false);
    }
  }
  if (!active) return null;
  if (denied || deniedNow) {
    const source = sources.map((s) => s.name).join(" / ");
    return (
      <section
        className="card space-y-3 p-4 sm:p-5"
        aria-labelledby="tutor-upcoming-title"
      >
        <h3 id="tutor-upcoming-title" className="section-title">
          {t("title")}
        </h3>
        <StatePanel
          kind="denied"
          title={t("denied", { source })}
          action={
            <Button disabled={recovering} onClick={() => void recoverAccess()}>
              {t("retry", { source })}
            </Button>
          }
        />
      </section>
    );
  }
  const { events, unresolvedTimes } = tutorUpcoming({
    pairings: pairings.data ?? [],
    interviews: interviewsEnabled ? (interviews.data ?? []) : [],
    now,
    timeZone,
  });
  const complete = sources.every((s) => s.query.data && !s.query.error);
  return (
    <section
      className="card space-y-3 p-4 sm:p-5"
      aria-labelledby="tutor-upcoming-title"
    >
      <h3 id="tutor-upcoming-title" className="section-title">
        {t("title")}
      </h3>
      <p className="muted text-sm">{t("help", { timeZone })}</p>
      {sources.map(({ name, query }) =>
        query.error || !query.data ? (
          <StatePanel
            key={name}
            kind={query.error ? "error" : "loading"}
            title={t(query.error ? "readFailed" : "loading", { source: name })}
            action={
              query.error ? (
                <Button onClick={() => void query.refetch()}>
                  {t("retry", { source: name })}
                </Button>
              ) : undefined
            }
          />
        ) : null,
      )}
      {unresolvedTimes > 0 && (
        <InlineNotice tone="warning">
          {t("unresolved", { count: unresolvedTimes })}
        </InlineNotice>
      )}
      {complete && !events.length && !unresolvedTimes && (
        <p className="muted">{t("empty")}</p>
      )}
      {events.length > 0 && (
        <ul className="space-y-2">
          {events.map((event) => {
            const target =
              event.kind === "interview"
                ? "tutor-interviews"
                : "tutor-pairings";
            return (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3"
              >
                <div className="min-w-0 space-y-1 break-words">
                  <p className="text-xs font-semibold text-slate-600">
                    {t(event.kind === "interview" ? "interview" : "session")}
                  </p>
                  <p className="font-medium">{event.label}</p>
                  <p className="text-sm">
                    <time dateTime={event.start.toISOString()}>
                      {format.dateTime(event.start, {
                        month: "short",
                        day: "numeric",
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    {event.end && (
                      <>
                        {" "}
                        –{" "}
                        <time dateTime={event.end.toISOString()}>
                          {format.dateTime(event.end, {
                            ...(programDateKey(event.start, timeZone) !==
                            programDateKey(event.end, timeZone)
                              ? ({ month: "short", day: "numeric" } as const)
                              : {}),
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </>
                    )}
                  </p>
                  {event.kind === "interview" && (
                    <p className="muted text-xs">{t("startOnly")}</p>
                  )}
                  {event.end && event.start <= now && (
                    <p className="text-accent-700 text-sm">{t("ongoing")}</p>
                  )}
                  {event.count > 1 && (
                    <p className="muted text-xs">
                      {t("grouped", { count: event.count })}
                    </p>
                  )}
                  {event.room && <p className="muted text-xs">{event.room}</p>}
                </div>
                <a
                  className="link inline-flex min-h-11 items-center lg:min-h-8"
                  href={`#${target}`}
                  aria-label={t("detailsFor", { name: event.label })}
                  onClick={() => {
                    requestAnimationFrame(() =>
                      focusVisibleContext(document.getElementById(target)),
                    );
                  }}
                >
                  {t("details")}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
