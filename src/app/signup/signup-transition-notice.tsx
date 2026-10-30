"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  publicSignupView,
  type PublicSignupTransition,
} from "~/lib/public-signup-transition";
import { SignupOpeningNotice } from "./signup-opening-notice";

/** Wall-clock errors cannot open intake; all public presentation advances from the server anchor. */
export function useSignupClock(serverNow?: string) {
  const [clock, setClock] = useState({ anchor: serverNow, elapsed: 0 });
  useEffect(() => {
    if (!serverNow) return;
    const start = performance.now();
    const timer = setInterval(
      () => setClock({ anchor: serverNow, elapsed: performance.now() - start }),
      1_000,
    );
    return () => clearInterval(timer);
  }, [serverNow]);
  return serverNow
    ? new Date(serverNow).getTime() +
        (clock.anchor === serverNow ? clock.elapsed : 0)
    : 0;
}

export function SignupTransitionNotice({
  data,
  now,
  refresh,
  verified = true,
}: {
  data: PublicSignupTransition;
  now: number;
  refresh: () => void;
  verified?: boolean;
}) {
  const t = useTranslations("signupTransition");
  const banner = useTranslations("signupBanner");
  const currentText = useTranslations("public.signup");
  const view = publicSignupView(data, now);
  const anchor = new Date(data.serverNow).getTime();
  const crossedCurrentBoundary = [
    data.current?.window.opensAt,
    data.current?.window.closesAt,
  ].some(
    (at) =>
      !!at && anchor < new Date(at).getTime() && now >= new Date(at).getTime(),
  );
  const lastRead = useRef<number | null>(null);
  useEffect(() => {
    // The cached future projection can hand off immediately at closure. Re-read at
    // activation boundaries; a zero timer is never evidence that activation succeeded.
    if (
      !verified ||
      (view.state !== "pendingActivation" && !crossedCurrentBoundary)
    ) {
      lastRead.current = null;
      return;
    }
    if (lastRead.current === null || now - lastRead.current >= 5_000) {
      lastRead.current = now;
      refresh();
    }
  }, [now, view.state, refresh, verified, crossedCurrentBoundary]);
  if (!verified)
    return (
      <p
        className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-slate-700"
        role="status"
      >
        {t("unverified")}
      </p>
    );
  const timed =
    view.state === "currentScheduled" ||
    view.state === "planned" ||
    view.state === "scheduled" ||
    (view.state === "pendingActivation" &&
      !!view.opensAt &&
      now < new Date(view.opensAt).getTime());
  return (
    <div className="mb-6 space-y-4">
      {data.current && !view.next && !timed && (
        <p>
          <span className="badge-slate">
            {currentText(data.current.kind, { period: data.current.label })}
          </span>
        </p>
      )}
      {timed && view.opensAt && view.label ? (
        <SignupOpeningNotice
          periodLabel={view.label}
          currentPeriodLabel={view.next ? data.current?.label : undefined}
          opensAt={view.opensAt}
          previewUrl={view.previewUrl}
          serverNow={data.serverNow}
          sharedNowMs={now}
          programTimeZone={data.timeZone}
          onRefresh={refresh}
          openingKind={
            view.next
              ? view.state === "pendingActivation"
                ? "pending"
                : view.state === "planned"
                  ? "planned"
                  : "scheduled"
              : "current"
          }
        />
      ) : view.next && view.label ? (
        <section className="card space-y-2 p-5 sm:p-6" aria-live="polite">
          <h2 className="section-title">
            {t("nextTitle", { period: view.label })}
          </h2>
          {data.current && (
            <p className="text-sm text-slate-600">
              {banner("currentClosed", { period: data.current.label })}
            </p>
          )}
          <p className="text-sm leading-6 text-slate-700">{t(view.state)}</p>
        </section>
      ) : null}
    </div>
  );
}
