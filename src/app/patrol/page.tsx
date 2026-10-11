"use client";

import { useState, useRef, useEffect, useId } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

import { api, type RouterInputs } from "~/trpc/react";
import { Button, ChoiceButton } from "~/app/_components/ui/button";
import { AcademicError } from "~/app/_components/academic-error";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { StatePanel } from "~/app/_components/ui/patterns";

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
  useEffect(() => {
    const sources = [
      {
        name: "status" as const,
        revoked: statusDenied,
        query: myStatus,
        key: getQueryKey(api.crew.myStatus, undefined, "query"),
      },
      {
        name: "config" as const,
        revoked: configDenied || statusDenied,
        query: config,
        key: getQueryKey(api.crew.patrolConfig, undefined, "query"),
      },
      {
        name: "history" as const,
        revoked: historyDenied || statusDenied,
        query: history,
        key: getQueryKey(api.crew.myPatrols, undefined, "query"),
      },
    ];
    const next = { ...denied };
    for (const source of sources) {
      if (source.revoked) {
        next[source.name] = true;
        if (!denied[source.name])
          queryClient.removeQueries({ queryKey: source.key, exact: true });
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
  }, [
    myStatus,
    config,
    history,
    statusDenied,
    configDenied,
    historyDenied,
    statusHidden,
    denied,
    queryClient,
  ]);
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
  useEffect(() => {
    if (!statusDenied && !configDenied) return;
    // Authoritative revocation releases local evidence; transport failures retain retry intent.
    setCounts({});
    setNote("");
    setOptOutReason("");
    setShowOptOut(false);
    lastSubmission.current = null;
  }, [statusDenied, configDenied]);

  const refetchStatus = () => utils.crew.myStatus.invalidate();
  const optOut = api.crew.requestOptOut.useMutation({
    onSuccess: refetchStatus,
  });
  const recall = api.crew.recallOptOut.useMutation({
    onSuccess: refetchStatus,
  });
  const reentry = api.crew.requestReentry.useMutation({
    onSuccess: refetchStatus,
  });

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">{t("crew.patrol.title")}</h1>
          <p className="muted mt-1">{t("crew.patrol.subtitle")}</p>
        </div>
        {canPatrol && !configHidden && config.data !== undefined && (
          <div className="card px-4 py-2 text-right">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              {t("crew.patrol.myHours")}
            </p>
            <p className="text-2xl font-bold text-slate-900">
              {config.data.myHours.toFixed(1)} h
            </p>
            <p className="muted text-xs">
              {t("crew.patrol.patrolCount", {
                count: config.data.myPatrols,
              })}
            </p>
          </div>
        )}
      </div>
      {readFeedback("status", t("crew.patrol.statusLabel"))}

      {/* Opted-out / paused notice (no patrolling) */}
      {!statusHidden && status === "OPTED_OUT" && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-amber-800">
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
        <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-slate-700">
          <p className="font-semibold">{t("crew.patrol.inactive.title")}</p>
          <p className="mt-1 text-sm">{t("crew.patrol.inactive.body")}</p>
        </section>
      )}

      {canPatrol && (
        <>
          {readFeedback("config", t("crew.patrol.title"))}
          {/* The sweep — one row per room in patrol order. */}
          {!configHidden && config.data !== undefined && (
            <section className="card divide-y divide-slate-100">
              {rooms.length === 0 && !config.error ? (
                <p className="muted p-4">{t("crew.patrol.noRooms")}</p>
              ) : (
                rooms.map((room, i) => {
                  const chosen = counts[room.id]?.headcount;
                  return (
                    <div
                      key={room.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3"
                    >
                      <span className="w-7 text-sm font-semibold text-slate-400">
                        {i + 1}
                      </span>
                      <span className="min-w-28 flex-1 font-medium text-slate-800">
                        {room.name}
                      </span>
                      {/* Room grouping names repeated choices; pressed state exposes the recorded value. */}
                      <div
                        role="group"
                        aria-label={room.name}
                        className="flex flex-wrap gap-2"
                      >
                        {BUCKETS.map((b) => (
                          <ChoiceButton
                            key={b.value}
                            selected={chosen === b.value}
                            disabled={submit.isPending || !canEditPatrol}
                            onClick={() => pick(room.id, b.value)}
                            className="font-semibold"
                          >
                            {b.label}
                          </ChoiceButton>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </section>
          )}

          {!configHidden && config.data !== undefined && (
            <div className="space-y-3">
              <label
                className="block text-sm font-medium text-slate-700"
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
                rows={2}
                className="textarea"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="btn-primary"
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
                  <span role="status" className="text-sm text-green-700">
                    {t(
                      submit.data?.hours === 0
                        ? "crew.patrol.recordedWithoutCredit"
                        : "crew.patrol.submitted",
                    )}
                  </span>
                )}
                {submit.error && (
                  <span role="alert" className="text-sm text-red-600">
                    {submit.error.message}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Recent patrols */}
          {readFeedback("history", t("crew.patrol.recent"))}
          {!historyHidden && (history.data?.length ?? 0) > 0 && (
            <section className="space-y-2">
              <h2 className="section-title">{t("crew.patrol.recent")}</h2>
              <div className="card divide-y divide-slate-100">
                {(history.data ?? []).map((p) => (
                  <div key={p.id} className="px-4 py-3">
                    <p className="text-sm font-medium text-slate-800">
                      {programFormat.dateTime(new Date(p.createdAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}{" "}
                      · {p.hours.toFixed(1)} h
                    </p>
                    <p className="muted mt-0.5 text-xs">
                      {p.observations
                        .map(
                          (o) =>
                            `${o.room.name}: ${
                              BUCKETS.find((b) => b.value === o.headcount)
                                ?.label ?? o.headcount
                            }`,
                        )
                        .join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Opt-out (ACTIVE crew only — not elevated admins, who have no crew status) */}
          {status === "ACTIVE" && (
            <section className="card p-4">
              {pending?.kind === "OPT_OUT" ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-slate-700">
                    {t("crew.patrol.optOut.pending")}
                  </span>
                  <button
                    className="btn-secondary btn-sm"
                    disabled={recall.isPending || !!myStatus.error}
                    onClick={() => {
                      if (!myStatus.error) recall.mutate();
                    }}
                  >
                    {t("crew.patrol.optOut.recall")}
                  </button>
                </div>
              ) : showOptOut ? (
                <div className="space-y-2">
                  <label
                    className="block text-sm font-medium text-slate-700"
                    htmlFor={`${fieldId}-reason`}
                  >
                    {t("crew.patrol.optOut.reasonLabel")}
                  </label>
                  <textarea
                    id={`${fieldId}-reason`}
                    disabled={optOut.isPending || !!myStatus.error}
                    value={optOutReason}
                    onChange={(e) => setOptOutReason(e.target.value)}
                    placeholder={t("crew.patrol.optOut.reason")}
                    rows={2}
                    className="textarea"
                  />
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary btn-sm"
                      disabled={optOut.isPending || !!myStatus.error}
                      onClick={() =>
                        !myStatus.error &&
                        optOut.mutate({
                          reason: optOutReason.trim() || undefined,
                        })
                      }
                    >
                      {t("crew.patrol.optOut.submit")}
                    </button>
                    <button
                      className="btn-secondary btn-sm"
                      disabled={optOut.isPending}
                      onClick={() => setShowOptOut(false)}
                    >
                      {t("common.close")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="link text-sm"
                  disabled={!!myStatus.error}
                  onClick={() => setShowOptOut(true)}
                >
                  {t("crew.patrol.optOut.request")}
                </button>
              )}
              {(optOut.error ?? recall.error) && (
                <p className="mt-2 text-sm text-red-600">
                  {(optOut.error ?? recall.error)?.message}
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
