"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useFormatter,
  useLocale,
  useTimeZone,
  useTranslations,
} from "next-intl";

import { signupCountdown } from "~/lib/signup-window";
import { DEFAULT_TIME_ZONE } from "~/i18n/config";
import { programTimeZoneLabel } from "~/lib/program-time-zone-label";

/** Retry a failed/stale server refresh without hammering the route once the gate reaches zero. */
const OPENING_REFRESH_RETRY_MS = 5_000;

interface SignupOpeningNoticeProps {
  periodLabel: string;
  /** Closed current intake is context for a next-period announcement, not a second banner. */
  currentPeriodLabel?: string;
  opensAt: string;
  previewUrl: string | null;
  /** Server-render time keeps the first client render hydration-stable. */
  serverNow: string;
  /** A live transition owner passes its clock so mounting at closure cannot restart elapsed time. */
  sharedNowMs?: number;
  programTimeZone?: string;
  onRefresh?: () => void;
  openingKind?: "current" | "planned" | "scheduled" | "pending";
}

/**
 * Public pre-opening state. The server decides whether this component or the form is rendered;
 * this small client timer is only responsible for the live countdown and refreshing at zero.
 */
export function SignupOpeningNotice({
  periodLabel,
  currentPeriodLabel,
  opensAt,
  previewUrl,
  serverNow,
  sharedNowMs,
  programTimeZone,
  onRefresh,
  openingKind = "current",
}: SignupOpeningNoticeProps) {
  const t = useTranslations("public.signup.gate");
  const transition = useTranslations("signupTransition");
  const banner = useTranslations("signupBanner");
  const format = useFormatter();
  const locale = useLocale();
  const contextTimeZone = useTimeZone();
  const timeZone = programTimeZone ?? contextTimeZone ?? DEFAULT_TIME_ZONE;
  const router = useRouter();
  const openingTime = useMemo(() => new Date(opensAt), [opensAt]);
  const openingMs = openingTime.getTime();
  const serverNowMs = useMemo(() => new Date(serverNow).getTime(), [serverNow]);
  const [nowMs, setNowMs] = useState(serverNowMs);
  const hasSharedClock = sharedNowMs !== undefined;
  const lastRefreshAt = useRef<number | null>(null);

  useEffect(() => {
    if (hasSharedClock) return;
    // Anchor the countdown to server time and advance it with a monotonic browser clock. This keeps
    // a misconfigured client wall clock from opening early or delaying the public transition.
    const startedAt = window.performance.now();
    lastRefreshAt.current = null;

    const tick = () => {
      const nextNow = serverNowMs + (window.performance.now() - startedAt);
      setNowMs(nextNow);

      if (
        nextNow >= openingMs &&
        (lastRefreshAt.current === null ||
          nextNow - lastRefreshAt.current >= OPENING_REFRESH_RETRY_MS)
      ) {
        lastRefreshAt.current = nextNow;
        if (onRefresh) onRefresh();
        else router.refresh();
      }
    };

    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [openingMs, router, serverNowMs, onRefresh, hasSharedClock]);

  const displayNowMs = sharedNowMs ?? nowMs;
  const countdown = signupCountdown(openingTime, displayNowMs);
  const hasReachedOpening = displayNowMs >= openingMs;
  const units = [
    [countdown.days, t("days")],
    [countdown.hours, t("hours")],
    [countdown.minutes, t("minutes")],
    [countdown.seconds, t("seconds")],
  ] as const;
  const formattedOpening = format.dateTime(openingTime, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  });

  // Keep time and eligibility separate: reaching zero only requests fresh server evidence.
  const status = hasReachedOpening
    ? openingKind === "current"
      ? banner("checking")
      : transition("pendingActivation")
    : openingKind === "pending"
      ? transition("pendingActivation")
      : banner(
          openingKind === "current"
            ? "currentHelp"
            : openingKind === "planned"
              ? "plannedHelp"
              : "scheduledHelp",
        );

  return (
    <section aria-labelledby="signup-opening-title" className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="signup-opening-title" className="section-title">
          {transition("nextTitle", { period: periodLabel })}
        </h2>
        <span className="badge-slate">
          {banner(
            hasReachedOpening || openingKind === "pending"
              ? "pendingLabel"
              : openingKind === "planned"
                ? "plannedLabel"
                : openingKind === "scheduled"
                  ? "scheduledLabel"
                  : "currentLabel",
          )}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
        <div className="min-w-0">
          <p className="text-base font-medium text-slate-900">
            <time dateTime={opensAt}>{formattedOpening}</time>
          </p>
          <p className="mt-1 text-xs leading-5 break-words text-slate-600">
            {programTimeZoneLabel(timeZone, openingTime, locale)}
          </p>
        </div>
        {!hasReachedOpening && (
          <div
            className="grid grid-cols-4 gap-4 rounded-lg bg-slate-50 px-3 py-2 text-center"
            role="timer"
            aria-label={banner("countdownLabel")}
            aria-live="off"
          >
            {units.map(([value, label]) => (
              <div key={label}>
                <span className="block text-xl font-semibold text-slate-900 tabular-nums">
                  {format.number(value, {
                    minimumIntegerDigits: 2,
                    useGrouping: false,
                  })}
                </span>
                <span className="block text-xs text-slate-600">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm leading-6 text-slate-600">
        {currentPeriodLabel && (
          <p>{banner("currentClosed", { period: currentPeriodLabel })}</p>
        )}
        <p role="status">{status}</p>
        {!hasReachedOpening && previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="public-form-link"
          >
            {banner("previewLink")}
          </a>
        )}
      </div>
    </section>
  );
}
