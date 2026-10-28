"use client";

import { useEffect, useRef, useState } from "react";
import {
  useFormatter,
  useLocale,
  useTimeZone,
  useTranslations,
} from "next-intl";
import { api } from "~/trpc/react";
import { DEFAULT_TIME_ZONE } from "~/i18n/config";
import { programDateKey } from "~/lib/program-time";
import { schoolCalendarHashDate } from "~/lib/notification-navigation";
import { resolveSchoolCalendarDay } from "~/lib/school-calendar";
import { formatWeekday } from "~/lib/time";
import { useSessionAccessDenied } from "./session-view-state";
import { Button } from "./ui/button";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { focusVisibleContext } from "./focus-visible-context";

/** Shared dated context keeps the actual date distinct from its school timetable. */
export function SchoolCalendarDayContext({
  date,
  isSchoolDay,
  effectiveTimetableWeekday,
}: {
  date: string;
  isSchoolDay: boolean;
  effectiveTimetableWeekday: number | null;
}) {
  const t = useTranslations("schoolCalendar");
  const format = useFormatter();
  const locale = useLocale();
  return (
    <div className="space-y-1 text-sm">
      <p>
        <time dateTime={date}>
          {format.dateTime(new Date(`${date}T00:00:00Z`), {
            dateStyle: "full",
            timeZone: "UTC",
          })}
        </time>
        {" · "}
        {isSchoolDay && effectiveTimetableWeekday !== null
          ? t("follows", {
              weekday: formatWeekday(effectiveTimetableWeekday, locale),
            })
          : t("noSchool")}
      </p>
      {!isSchoolDay && <p>{t("closureWarning")}</p>}
    </div>
  );
}

/** Only public school-calendar facts enter participant pages; staff notes stay in settings. */
export function SchoolCalendarNotice() {
  const t = useTranslations("schoolCalendar");
  const timeZone = useTimeZone() ?? DEFAULT_TIME_ZONE;
  const [now, setNow] = useState(() => new Date());
  const [requestedDate, setRequestedDate] = useState<string | null>(null);
  const [hashReady, setHashReady] = useState(false);
  const [arrivalSequence, setArrivalSequence] = useState(0);
  const context = useRef<HTMLDivElement>(null);
  const arrival = useRef<{ hash: string } | null>(null);
  useEffect(() => {
    let previousHash: string | undefined;
    const readHash = (event?: Event) => {
      const hash = window.location.hash;
      const repeatedNavigation =
        event instanceof HashChangeEvent &&
        event.oldURL === event.newURL &&
        event.newURL === window.location.href;
      if (hash === previousHash && !repeatedNavigation) return;
      previousHash = hash;
      const date = schoolCalendarHashDate(hash);
      arrival.current = date || hash === "#school-calendar" ? { hash } : null;
      if (arrival.current) setArrivalSequence((sequence) => sequence + 1);
      setRequestedDate(date);
      setHashReady(true);
    };
    // A gesture relinquishes a delayed notification reveal; later refetches never pull it back.
    const cancelReveal = () => {
      arrival.current = null;
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    window.addEventListener("popstate", readHash);
    for (const name of ["wheel", "touchstart", "pointerdown", "keydown"])
      window.addEventListener(name, cancelReveal, {
        capture: true,
        passive: true,
      });
    return () => {
      window.removeEventListener("hashchange", readHash);
      window.removeEventListener("popstate", readHash);
      for (const name of ["wheel", "touchstart", "pointerdown", "keydown"])
        window.removeEventListener(name, cancelReveal, true);
    };
  }, []);
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const from = requestedDate ?? programDateKey(now, timeZone);
  const last = new Date(`${from}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 13);
  const to = requestedDate ?? last.toISOString().slice(0, 10);
  const query = api.program.schoolCalendar.useQuery(
    { from, to },
    { enabled: hashReady, refetchInterval: 60_000 },
  );
  const denied = useSessionAccessDenied(query);
  useEffect(() => {
    if (
      !hashReady ||
      denied ||
      !query.isSuccess ||
      query.isFetching ||
      query.error ||
      query.data === undefined
    )
      return;
    const pending = arrival.current;
    const target = context.current;
    if (
      window.location.hash !== pending?.hash ||
      !target?.getClientRects().length
    )
      return;
    arrival.current = null;
    focusVisibleContext(target);
  }, [
    hashReady,
    requestedDate,
    denied,
    query.isSuccess,
    query.isFetching,
    query.error,
    query.data,
    arrivalSequence,
  ]);
  if (denied)
    return (
      <div id="school-calendar" tabIndex={-1} ref={context}>
        <StatePanel
          kind="denied"
          title={t("denied")}
          action={
            <Button onClick={() => void query.refetch()}>{t("refresh")}</Button>
          }
        />
      </div>
    );
  const days =
    query.data?.filter((day) => day.date >= from && day.date <= to) ?? [];
  return (
    <div id="school-calendar" tabIndex={-1} ref={context} className="space-y-3">
      <QueryFeedback
        hasData={hashReady && query.data !== undefined}
        loading={!hashReady || query.data === undefined}
        error={!!query.error}
        retrying={query.isFetching}
        loadingTitle={t("loading")}
        errorTitle={t("noticeLoadFailed")}
        retryLabel={t("refresh")}
        onRetry={() => void query.refetch()}
      />
      {hashReady && requestedDate && (
        <a
          className="btn-secondary control-standard inline-flex items-center"
          href="#school-calendar"
        >
          {t("viewUpcoming")}
        </a>
      )}
      {hashReady && requestedDate && query.data !== undefined ? (
        <InlineNotice tone="info">
          <p className="mb-2 font-medium">{t("requestedDateTitle")}</p>
          <SchoolCalendarDayContext
            {...resolveSchoolCalendarDay(requestedDate, query.data)}
          />
          {!days.length && (
            <p className="mt-2 text-sm">{t("defaultCalendar")}</p>
          )}
          {!query.error && !query.isFetching && (
            <p className="mt-2 text-sm">{t("currentCalendar")}</p>
          )}
        </InlineNotice>
      ) : (
        hashReady &&
        !!days.length && (
          <InlineNotice tone="info">
            <p className="mb-2 font-medium">{t("noticeTitle")}</p>
            <ul className="space-y-3">
              {days.map((day) => (
                <li key={day.date}>
                  <SchoolCalendarDayContext
                    {...resolveSchoolCalendarDay(day.date, query.data)}
                  />
                </li>
              ))}
            </ul>
          </InlineNotice>
        )
      )}
    </div>
  );
}
