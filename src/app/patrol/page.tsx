"use client";

import { useState, useRef, useEffect, useId, useLayoutEffect } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

import { api, type RouterInputs } from "~/trpc/react";
import { Button } from "~/app/_components/ui/button";
import { AcademicError } from "~/app/_components/academic-error";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { StatePanel } from "~/app/_components/ui/patterns";
import { useActionReview } from "~/app/_components/ui/action-review";
import { invalidateAndReport } from "~/lib/invalidate-refresh";

type Headcount = "ZERO" | "ONE" | "TWO" | "THREE" | "FOUR_PLUS";
const BUCKETS: { value: Headcount; label: string }[] = [
  { value: "ZERO", label: "0" },
  { value: "ONE", label: "1" },
  { value: "TWO", label: "2" },
  { value: "THREE", label: "3" },
  { value: "FOUR_PLUS", label: "4+" },
];

/**
 * Crew patrol portal: walk the rooms (in the set patrol order), tap each room's student count, and
 * submit the sweep. An eligible sweep credits 0.5h within the server-enforced 20-minute budget.
 * Only ACTIVE crew (or elevated admins) can patrol; opted-out / paused members see a read-only
 * notice and can request reentry.
 */
export default function PatrolPage() {
  const programFormat = useFormatter();
  const t = useTranslations();
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState({
    status: false,
    config: false,
    history: false,
  });
  const utils = api.useUtils();
  const myStatus = api.crew.myStatus.useQuery(undefined, {
    enabled: !denied.status,
  });
  const unauthorized = (
    error: { data?: { code?: string } | null } | null | undefined,
  ) =>
    error?.data?.code === "FORBIDDEN" || error?.data?.code === "UNAUTHORIZED";
  const statusDenied = unauthorized(myStatus.error);
  const statusHidden = denied.status || statusDenied;

  const status = myStatus.data?.status ?? null;
  const pending = myStatus.data?.pendingRequest ?? null;
  // ACTIVE crew patrol; elevated admins (no crewStatus) also reach here and may patrol.
  // A missing read is not an elevated administrator. Keep authority explicit even with cache.
  const canPatrol =
    myStatus.data !== undefined &&
    !statusHidden &&
    (status === "ACTIVE" || status === null);

  const config = api.crew.patrolConfig.useQuery(undefined, {
    enabled: canPatrol && !denied.config,
  });
  const history = api.crew.myPatrols.useQuery(undefined, {
    enabled: canPatrol && !denied.history,
  });
  const configDenied = unauthorized(config.error);
  const historyDenied = unauthorized(history.error);
  const configHidden = statusHidden || denied.config || configDenied;
  const historyHidden = statusHidden || denied.history || historyDenied;
  const canEditPatrol =
    canPatrol &&
    !myStatus.error &&
    config.data !== undefined &&
    !configHidden &&
    !config.error;
  // Each reader keeps its denial until a completed authorized read. Resolve
  // these local transitions before rendering; evict external caches separately.
  const sources = [
    {
      name: "status" as const,
      revoked: statusDenied,
      query: myStatus,
    },
    {
      name: "config" as const,
      revoked: configDenied || statusDenied,
      query: config,
    },
    {
      name: "history" as const,
      revoked: historyDenied || statusDenied,
      query: history,
    },
  ];
  const next = { ...denied };
  for (const source of sources) {
    if (source.revoked) {
      next[source.name] = true;
    } else if (
      source.query.isSuccess &&
      !source.query.isFetching &&
      !statusHidden
    )
      next[source.name] = false;
    // An explicit status Retry is the only way to establish authority after revocation.
    if (
      source.name === "status" &&
      myStatus.isSuccess &&
      !myStatus.isFetching &&
      !statusDenied
    )
      next.status = false;
  }
  if (
    Object.keys(next).some(
      (key) =>
        next[key as keyof typeof next] !== denied[key as keyof typeof denied],
    )
  )
    setDenied(next);
  useEffect(() => {
    if (statusDenied)
      queryClient.removeQueries({
        queryKey: getQueryKey(api.crew.myStatus, undefined, "query"),
        exact: true,
      });
    if (configDenied || statusDenied)
      queryClient.removeQueries({
        queryKey: getQueryKey(api.crew.patrolConfig, undefined, "query"),
        exact: true,
      });
    if (historyDenied || statusDenied)
      queryClient.removeQueries({
        queryKey: getQueryKey(api.crew.myPatrols, undefined, "query"),
        exact: true,
      });
  }, [statusDenied, configDenied, historyDenied, queryClient]);
  // Keep a submitted intent intact across uncertain network outcomes. A changed payload gets
  // a new key; an unchanged retry reuses the original observations, timestamps and request.
  const lastSubmission = useRef<{
    fingerprint: string;
    input: RouterInputs["crew"]["submitPatrol"];
  } | null>(null);
  // React's pending state renders the disabled controls; this synchronous guard also fences
  // rapid/programmatic events before that render and throughout the success refresh.
  const submissionInFlight = useRef(false);

  // roomId -> chosen headcount + the time it was recorded.
  const [counts, setCounts] = useState<
    Record<string, { headcount: Headcount; at: string }>
  >({});
  const [note, setNote] = useState("");
  const [optOutReason, setOptOutReason] = useState("");
  const [showOptOut, setShowOptOut] = useState(false);
  const optOutReview = useActionReview();
  const optOutKey = "crew-membership:opt-out";
  const draftRevoked = statusDenied || configDenied;
  const [wasDraftRevoked, setWasDraftRevoked] = useState(draftRevoked);
  if (draftRevoked !== wasDraftRevoked) {
    setWasDraftRevoked(draftRevoked);
  }
  if (draftRevoked && !wasDraftRevoked) {
    // Revocation releases private drafts before descendants can observe them.
    setCounts({});
    setNote("");
    setOptOutReason("");
    setShowOptOut(false);
  }
  useEffect(() => {
    if (draftRevoked) lastSubmission.current = null;
  }, [draftRevoked]);

  const refetchStatus = () => utils.crew.myStatus.invalidate();
  const optOut = api.crew.requestOptOut.useMutation();
  const recall = api.crew.recallOptOut.useMutation({
    onSuccess: refetchStatus,
  });
  const reentry = api.crew.requestReentry.useMutation({
    onSuccess: refetchStatus,
  });
  const membershipBusy =
    optOut.isPending ||
    recall.isPending ||
    reentry.isPending ||
    optOutReview.busy;
  const optOutAllowed =
    !statusHidden &&
    !draftRevoked &&
    status === "ACTIVE" &&
    !pending &&
    !myStatus.error &&
    !myStatus.isFetching &&
    !membershipBusy;
  const optOutAllowedNow = useRef(false);
  useLayoutEffect(() => {
    optOutAllowedNow.current = optOutAllowed;
  }, [optOutAllowed]);
  const { revoke: revokeOptOut } = optOutReview;
  useEffect(() => {
    if (statusHidden || draftRevoked) revokeOptOut();
  }, [statusHidden, draftRevoked, revokeOptOut]);
  const optOutBlocked = !optOutAllowed || optOutReview.blocked(optOutKey);
  const reviewOptOut = () => {
    if (optOutBlocked || !optOutAllowedNow.current) return;
    const reason = optOutReason.trim();
    optOutReview.open({
      key: optOutKey,
      title: t("crew.patrol.optOut.request"),
      description: t("tutor.settings.optOutReviewHelp"),
      confirmLabel: t("crew.patrol.optOut.submit"),
      confirmVariant: "danger",
      confirmDelayMs: 3_000,
      successMessage: t("tutor.settings.optOutSubmitted"),
      details: reason ? (
        <div className="space-y-1">
          <p className="label">{t("crew.patrol.optOut.reasonLabel")}</p>
          <p className="text-sm wrap-anywhere whitespace-pre-wrap">{reason}</p>
        </div>
      ) : undefined,
      // Capture the reviewed reason, but recheck current eligibility when confirming.
      commit: () => {
        if (!optOutAllowedNow.current)
          throw new Error(t("participantRecovery.loadFailed"));
        return optOut.mutateAsync({ reason: reason || undefined });
      },
      refresh: () => invalidateAndReport(utils.crew.myStatus),
      renderResult: () => <p>{t("crew.patrol.optOut.pending")}</p>,
      repeatAfterRefresh: true,
    });
  };

  const submit = api.crew.submitPatrol.useMutation({
    onSuccess: async () => {
      lastSubmission.current = null;
      setCounts({});
      setNote("");
      await Promise.all([
        utils.crew.patrolConfig.invalidate(),
        utils.crew.myPatrols.invalidate(),
      ]);
    },
    onSettled: () => {
      submissionInFlight.current = false;
    },
  });

  const pick = (roomId: string, headcount: Headcount) => {
    if (!canEditPatrol || submissionInFlight.current || submit.isPending)
      return;
    setCounts((c) => ({
      ...c,
      [roomId]: { headcount, at: new Date().toISOString() },
    }));
  };

  const rooms = configHidden ? [] : (config.data?.rooms ?? []);
  const recorded = Object.keys(counts).length;

  const onSubmit = () => {
    if (!canEditPatrol || submissionInFlight.current || submit.isPending)
      return;
    const observations = Object.entries(counts).map(([roomId, v]) => ({
      roomId,
      headcount: v.headcount,
      observedAt: new Date(v.at),
    }));
    if (observations.length === 0) return;
    const trimmed = note.trim();
    const payload = {
      note: trimmed.length > 0 ? trimmed : undefined,
      observations,
    };
    const fingerprint = JSON.stringify(payload);
    if (lastSubmission.current?.fingerprint !== fingerprint) {
      lastSubmission.current = {
        fingerprint,
        input: { submissionKey: crypto.randomUUID(), ...payload },
      };
    }
    submissionInFlight.current = true;
    submit.mutate(lastSubmission.current.input);
  };
  const readFeedback = (
    scope: "status" | "config" | "history",
    title: string,
  ) => {
    const query =
      scope === "status" ? myStatus : scope === "config" ? config : history;
    const hidden =
      scope === "status"
        ? statusHidden
        : scope === "config"
          ? configHidden
          : historyHidden;
    const retry = () => {
      void query.refetch();
    };
    return hidden ? (
      <StatePanel
        kind="denied"
        title={t("managementRecovery.denied", { section: title })}
        action={
          <Button
            size="compact"
            variant="secondary"
            disabled={query.isFetching}
            onClick={retry}
          >
            {t("managementRecovery.retry", { section: title })}
          </Button>
        }
      />
    ) : (
      <QueryFeedback
        hasData={query.data !== undefined}
        loading={query.isLoading}
        error={!!query.error}
        retrying={query.isFetching}
        loadingTitle={t("managementRecovery.loading", { section: title })}
        errorTitle={t(
          query.data === undefined
            ? "managementRecovery.loadFailed"
            : "managementRecovery.refreshFailed",
          { section: title },
        )}
        retryLabel={t("managementRecovery.retry", { section: title })}
        onRetry={retry}
      />
    );
  };

  const optOutSection = status === "ACTIVE" && (
    <section className="border-t border-slate-200/80 pt-3">
      {pending?.kind === "OPT_OUT" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs leading-5 text-slate-600">
            {t("crew.patrol.optOut.pending")}
          </span>
          <button
            className="btn-secondary btn-sm"
            disabled={membershipBusy || !!myStatus.error}
            onClick={() => {
              if (!myStatus.error) recall.mutate();
            }}
          >
            {t("crew.patrol.optOut.recall")}
          </button>
        </div>
      ) : showOptOut ? (
        <div
          data-tone="warning"
          className="warning-surface space-y-3 rounded-xl border bg-white p-4"
        >
          <label
            className="block text-sm font-medium text-slate-700"
            htmlFor={`${fieldId}-reason`}
          >
            {t("crew.patrol.optOut.reasonLabel")}
          </label>
          <textarea
            id={`${fieldId}-reason`}
            disabled={optOutBlocked}
            value={optOutReason}
            onChange={(e) => setOptOutReason(e.target.value)}
            placeholder={t("crew.patrol.optOut.reason")}
            rows={2}
            maxLength={500}
            className="textarea"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="compact"
              disabled={optOutBlocked}
              onClick={reviewOptOut}
            >
              {t("crew.patrol.optOut.submit")}
            </Button>
            <Button
              variant="secondary"
              size="compact"
              disabled={membershipBusy}
              onClick={() => setShowOptOut(false)}
            >
              {t("common.close")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-600">{t("crew.role")}</span>
          <Button
            variant="danger"
            size="compact"
            disabled={optOutBlocked}
            onClick={() => setShowOptOut(true)}
          >
            {t("crew.patrol.optOut.request")}
          </Button>
        </div>
      )}
      {(optOut.error ?? recall.error) && (
        <p className="mt-2 text-sm text-red-600">
          {(optOut.error ?? recall.error)?.message}
        </p>
      )}
    </section>
  );

  return (
    <div className="space-y-5">
      {/* Hero + crew service-hours card matching the tutor dashboard summary */}
      <section className="border-accent-100 bg-accent-50/45 rounded-xl border p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="page-title">{t("crew.patrol.title")}</h1>
            <p className="muted mt-1 max-w-prose">
              {t("crew.patrol.subtitle")}
            </p>
          </div>
          {canPatrol && !configHidden && config.data !== undefined && (
            <div className="grid w-full min-w-0 gap-3 sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap">
              <section
                aria-label={t("crew.patrol.myHours")}
                className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 text-right sm:min-w-48 sm:max-w-full"
              >
                <div className="space-y-1 text-xs leading-4 text-slate-600">
                  <h2 className="font-medium tracking-wide uppercase">
                    {t("crew.patrol.myHours")}
                  </h2>
                  {config.data.periodLabel && (
                    <p className="break-words">{config.data.periodLabel}</p>
                  )}
                </div>
                <p className="mt-2 text-4xl leading-none font-bold tracking-tight text-slate-900 tabular-nums">
                  {config.data.myHours.toFixed(1)} <span>h</span>
                </p>
                <p className="mt-3 border-t border-slate-100 pt-2 text-sm leading-5 text-slate-600 tabular-nums">
                  {t("crew.patrol.patrolCount", {
                    count: config.data.myPatrols,
                  })}
                </p>
              </section>
            </div>
          )}
        </div>
      </section>
      {readFeedback("status", t("crew.patrol.statusLabel"))}

      {/* Opted-out / paused notice (no patrolling) */}
      {!statusHidden && status === "OPTED_OUT" && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-800">
          <p className="font-semibold">{t("crew.patrol.optedOut.title")}</p>
          <p className="mt-1 text-sm">{t("crew.patrol.optedOut.body")}</p>
          <div className="mt-3">
            {pending?.kind === "REENTRY" ? (
              <span className="text-sm">
                {t("crew.patrol.reentry.pending")}
              </span>
            ) : (
              <button
                className="btn-primary btn-sm"
                disabled={reentry.isPending || !!myStatus.error}
                onClick={() => {
                  if (!myStatus.error) reentry.mutate();
                }}
              >
                {t("crew.patrol.reentry.request")}
              </button>
            )}
            {reentry.error && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                <AcademicError message={reentry.error.message} selfService />
              </p>
            )}
          </div>
        </section>
      )}
      {!statusHidden && status === "INACTIVE" && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-slate-700">
          <p className="font-semibold">{t("crew.patrol.inactive.title")}</p>
          <p className="mt-1 text-sm">{t("crew.patrol.inactive.body")}</p>
        </section>
      )}

      {canPatrol && (
        <>
          {readFeedback("config", t("crew.patrol.title"))}
          {!configHidden && config.data !== undefined && (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
              {/* Primary workbench: connected patrol route sheet */}
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {rooms.length > 0 && (
                  <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
                    {/* Per-room stop progress strip: each segment mirrors an exact room along the route. */}
                    <div
                      className="flex flex-1 items-center gap-1"
                      aria-hidden="true"
                    >
                      {rooms.map((room) => (
                        <span
                          key={room.id}
                          className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${
                            counts[room.id]
                              ? "bg-[var(--action-background)]"
                              : "bg-slate-200/80"
                          }`}
                        />
                      ))}
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-slate-600 tabular-nums">
                      {recorded} / {rooms.length}
                    </span>
                  </div>
                )}

                {rooms.length === 0 && !config.error ? (
                  <p className="muted p-5">{t("crew.patrol.noRooms")}</p>
                ) : (
                  <ol className="divide-y divide-slate-100">
                    {rooms.map((room, i) => {
                      const chosen = counts[room.id]?.headcount;
                      const isFirst = i === 0;
                      const isLast = i === rooms.length - 1;
                      const nextChosen =
                        !isLast && rooms[i + 1]
                          ? Boolean(counts[rooms[i + 1]!.id])
                          : false;
                      const prevChosen =
                        !isFirst && rooms[i - 1]
                          ? Boolean(counts[rooms[i - 1]!.id])
                          : false;
                      return (
                        <li
                          key={room.id}
                          className={`relative flex flex-col gap-2.5 px-4 py-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 ${
                            chosen ? "bg-accent-50/25" : ""
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {/* Vertical route rail showing real hallway walk order */}
                            <div
                              className="relative flex w-5 shrink-0 items-center justify-center self-stretch"
                              aria-hidden="true"
                            >
                              {!isFirst && (
                                <span
                                  className={`absolute -top-4 bottom-1/2 left-1/2 hidden w-px -translate-x-1/2 transition-colors sm:block ${
                                    chosen && prevChosen
                                      ? "bg-accent-400"
                                      : "bg-slate-200"
                                  }`}
                                />
                              )}
                              {!isLast && (
                                <span
                                  className={`absolute top-1/2 -bottom-4 left-1/2 hidden w-px -translate-x-1/2 transition-colors sm:block ${
                                    chosen && nextChosen
                                      ? "bg-accent-400"
                                      : "bg-slate-200"
                                  }`}
                                />
                              )}
                              <span
                                className={`relative z-10 h-2.5 w-2.5 rounded-full border-2 transition-colors ${
                                  chosen
                                    ? "border-[var(--action-background)] bg-[var(--action-background)]"
                                    : "border-slate-300 bg-white"
                                }`}
                              />
                            </div>
                            <span className="w-5 shrink-0 text-xs font-medium text-slate-500 tabular-nums">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="min-w-0 truncate text-[15px] font-semibold text-slate-900">
                              {room.name}
                            </span>
                          </div>

                          {/* Unified segmented headcount tally bar */}
                          <div
                            role="group"
                            aria-label={room.name}
                            className="grid w-full grid-cols-5 gap-0.5 rounded-lg bg-slate-100 p-1 sm:w-64 sm:shrink-0"
                          >
                            {BUCKETS.map((b) => {
                              const selected = chosen === b.value;
                              return (
                                <button
                                  key={b.value}
                                  type="button"
                                  aria-pressed={selected}
                                  disabled={submit.isPending || !canEditPatrol}
                                  onClick={() => pick(room.id, b.value)}
                                  className={`focus-visible:ring-accent-500 inline-flex min-h-11 items-center justify-center rounded-md text-sm font-semibold tabular-nums transition focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-8 ${
                                    selected
                                      ? "bg-[var(--action-background)] text-white shadow-xs"
                                      : "text-slate-700 hover:bg-white/80 hover:text-slate-900"
                                  }`}
                                >
                                  {b.label}
                                </button>
                              );
                            })}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              {/* Right rail: sweep note + commit action, recent log, and quiet membership controls */}
              <div className="space-y-4 lg:sticky lg:top-24">
                <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="space-y-3">
                    <label
                      className="block text-sm font-medium text-slate-800"
                      htmlFor={`${fieldId}-note`}
                    >
                      {t("crew.patrol.noteLabel")}
                    </label>
                    <textarea
                      id={`${fieldId}-note`}
                      value={note}
                      disabled={submit.isPending || !canEditPatrol}
                      onChange={(e) => {
                        if (
                          canEditPatrol &&
                          !submissionInFlight.current &&
                          !submit.isPending
                        )
                          setNote(e.target.value);
                      }}
                      placeholder={t("crew.patrol.notePlaceholder")}
                      rows={3}
                      className="textarea bg-slate-50/50 focus:bg-white"
                    />
                    <button
                      className="btn-primary w-full"
                      disabled={
                        recorded === 0 || submit.isPending || !canEditPatrol
                      }
                      onClick={onSubmit}
                    >
                      {submit.isPending
                        ? t("crew.patrol.submitting")
                        : t("crew.patrol.submit", { count: recorded })}
                    </button>
                    {submit.isSuccess && (
                      <p role="status" className="text-sm text-green-700">
                        {t(
                          submit.data?.hours === 0
                            ? "crew.patrol.recordedWithoutCredit"
                            : "crew.patrol.submitted",
                        )}
                      </p>
                    )}
                    {submit.error && (
                      <p role="alert" className="text-sm text-red-600">
                        {submit.error.message}
                      </p>
                    )}
                  </div>
                </section>

                {/* Recent patrols */}
                {readFeedback("history", t("crew.patrol.recent"))}
                {!historyHidden && (history.data?.length ?? 0) > 0 && (
                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-100 px-4 py-3">
                      <h2 className="text-sm font-semibold text-slate-900">
                        {t("crew.patrol.recent")}
                      </h2>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {(history.data ?? []).map((p) => (
                        <div key={p.id} className="space-y-2 px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-slate-700">
                              {programFormat.dateTime(new Date(p.createdAt), {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </p>
                            <span className="badge-slate tabular-nums">
                              {p.hours.toFixed(1)} h
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {p.observations.map((o, idx) => (
                              <span
                                key={`${p.id}-${idx}`}
                                className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 tabular-nums"
                              >
                                {o.room.name}:{" "}
                                <strong className="font-semibold text-slate-900">
                                  {BUCKETS.find((b) => b.value === o.headcount)
                                    ?.label ?? o.headcount}
                                </strong>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Quiet opt-out / membership footer (ACTIVE crew only) */}
                {optOutSection}
              </div>
            </div>
          )}

          {/* Fallback when patrol config is hidden/failed: keep history & opt-out reachable */}
          {(configHidden || config.data === undefined) && (
            <>
              {readFeedback("history", t("crew.patrol.recent"))}
              {optOutSection}
            </>
          )}
        </>
      )}
      {!statusHidden && !draftRevoked && optOutReview.dialog}
    </div>
  );
}
