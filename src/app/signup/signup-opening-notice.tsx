"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import { signupCountdown } from "~/lib/signup-window";

/** Retry a failed/stale server refresh without hammering the route once the gate reaches zero. */
const OPENING_REFRESH_RETRY_MS = 5_000;

interface SignupOpeningNoticeProps {
  quarter: string;
  opensAt: string;
  previewUrl: string | null;
  /** Server-render time keeps the first client render hydration-stable. */
  serverNow: string;
}

/**
 * Public pre-opening state. The server decides whether this component or the form is rendered;
 * this small client timer is only responsible for the live countdown and refreshing at zero.
 */
export function SignupOpeningNotice({
  quarter,
  opensAt,
  previewUrl,
  serverNow,
}: SignupOpeningNoticeProps) {
  const t = useTranslations("public.signup.gate");
  const format = useFormatter();
  const router = useRouter();
  const openingTime = useMemo(() => new Date(opensAt), [opensAt]);
  const openingMs = openingTime.getTime();
  const serverNowMs = useMemo(() => new Date(serverNow).getTime(), [serverNow]);
  const [nowMs, setNowMs] = useState(serverNowMs);
  const lastRefreshAt = useRef<number | null>(null);

  useEffect(() => {
    // Anchor the countdown to server time and advance it with a monotonic browser clock. This keeps
    // a misconfigured client wall clock from opening early or delaying the public transition.
    const startedAt = window.performance.now();
    lastRefreshAt.current = null;

    const tick = () => {
      const nextNow =
        serverNowMs + (window.performance.now() - startedAt);
      setNowMs(nextNow);

      if (
        nextNow >= openingMs &&
        (lastRefreshAt.current === null ||
          nextNow - lastRefreshAt.current >= OPENING_REFRESH_RETRY_MS)
      ) {
        lastRefreshAt.current = nextNow;
        router.refresh();
      }
    };

    tick();
    const interval = window.setInterval(tick, 1_000);
    return () => window.clearInterval(interval);
  }, [openingMs, router, serverNowMs]);

  const countdown = signupCountdown(openingTime, nowMs);
  const hasReachedOpening = nowMs >= openingMs;
  const units = [
    [countdown.days, t("days")],
    [countdown.hours, t("hours")],
    [countdown.minutes, t("minutes")],
    [countdown.seconds, t("seconds")],
  ] as const;
  const formattedOpening = format.dateTime(openingTime, {
    dateStyle: "long",
    timeStyle: "short",
  });

  return (
    <section
      aria-labelledby="signup-opening-title"
      className="border-accent-200 relative overflow-hidden rounded-2xl border bg-white px-5 py-8 shadow-[0_24px_70px_-42px_var(--accent-700)] sm:px-9 sm:py-10"
    >
      <div
        aria-hidden="true"
        className="bg-accent-100/70 absolute -top-24 -right-20 h-64 w-64 rounded-full blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-28 -left-24 h-56 w-56 rounded-full bg-slate-100 blur-3xl"
      />

      <div className="relative mx-auto max-w-xl text-center">
        <div className="bg-accent-600 shadow-accent-200 mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-6 w-6"
          >
            <path d="M7 3v3m10-3v3M4.5 9.5h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
            <path d="m9.5 15 1.7 1.7 3.5-4" />
          </svg>
        </div>
        <p className="text-accent-700 mt-5 text-xs font-semibold tracking-[0.18em] uppercase">
          {t("eyebrow")}
        </p>
        <h2
          id="signup-opening-title"
          className="mt-3 text-2xl font-bold tracking-tight text-balance text-slate-900 sm:text-3xl"
        >
          {t("title", { quarter, time: formattedOpening })}
        </h2>

        <div
          className="mt-7 grid grid-cols-4 gap-2 sm:gap-3"
          role="timer"
          aria-label={t("countdownLabel")}
          aria-live="off"
        >
          {units.map(([value, label]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200/80 bg-slate-50/90 px-1 py-3 sm:py-4"
            >
              <span className="block font-mono text-xl font-semibold text-slate-900 tabular-nums sm:text-2xl">
                {format.number(value, {
                  minimumIntegerDigits: 2,
                  useGrouping: false,
                })}
              </span>
              <span className="mt-1 block text-[10px] font-semibold tracking-wider text-slate-500 uppercase sm:text-xs">
                {label}
              </span>
            </div>
          ))}
        </div>

        {hasReachedOpening ? (
          <p className="text-accent-700 mt-6 text-sm font-medium">
            {t("opening")}
          </p>
        ) : previewUrl ? (
          <p className="mt-6 text-sm text-slate-600">
            {t.rich("preview", {
              link: (chunks) => (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="link inline-flex items-center gap-1"
                >
                  {chunks}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M7 13 13.5 6.5M9 6h5v5" />
                    <path d="M14 12.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2.5" />
                  </svg>
                </a>
              ),
            })}
          </p>
        ) : (
          <p className="muted mt-6">{t("noPreview")}</p>
        )}
      </div>
    </section>
  );
}
