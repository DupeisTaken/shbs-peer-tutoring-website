"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getQueryKey } from "@trpc/react-query";

import { api } from "~/trpc/react";
import { useSessionAccessDenied } from "./session-view-state";
import { Button } from "./ui/button";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";

/** Shared self-service control used by both tutor and administrative account settings. */
export function TwoFactorSettings() {
  const t = useTranslations("auth.twoFactor.settings");
  const ui = useTranslations("uiPatterns");
  const me = api.account.me.useQuery();
  const features = api.program.features.useQuery();
  const [currentPassword, setCurrentPassword] = useState("");
  const [committed, setCommitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const admitted = useRef(false);
  const reading = useRef(false);

  const refreshReads = async (accepted = committed) => {
    if (reading.current) return;
    reading.current = true;
    setRefreshing(true);
    try {
      // Replace older cached requests: a pre-write read must not release the
      // accepted-write fence. Retry always reads; it never repeats the toggle.
      const results = await Promise.allSettled([
        me.refetch({ throwOnError: true, cancelRefetch: true }),
        features.refetch({ throwOnError: true, cancelRefetch: true }),
      ]);
      if (
        results.some(
          (result) =>
            result.status === "rejected" ||
            !result.value.isSuccess ||
            !result.value.data,
        )
      )
        throw new Error("Two-factor settings refresh failed");
      setSyncFailed(false);
      if (accepted) setCommitted(false);
      update.reset();
    } catch {
      if (accepted) setSyncFailed(true);
    } finally {
      reading.current = false;
      setRefreshing(false);
    }
  };
  const update = api.account.setTwoFactorEnabled.useMutation({
    onSuccess: async () => {
      setCurrentPassword("");
      setSaved(true);
      setCommitted(true);
      await refreshReads(true);
    },
    onSettled: () => {
      admitted.current = false;
    },
  });
  const denied = useSessionAccessDenied(
    {
      ...me,
      denialKey: "two-factor-account",
      queryKey: getQueryKey(api.account.me, undefined, "query"),
    },
    {
      ...features,
      denialKey: "two-factor-program",
      queryKey: getQueryKey(api.program.features, undefined, "query"),
    },
    {
      error: update.error,
      isSuccess: !update.error,
      isFetching: refreshing,
    },
  );
  const hasData = !!me.data && !!features.data;
  const readError = !!me.error || !!features.error;
  const loading = me.isFetching || features.isFetching || refreshing;
  const enabled = me.data?.twoFactorEnabled;
  const programEnabled = features.data?.EMAIL_2FA;
  const deliveryAvailable = features.data?.EMAIL_DELIVERY_AVAILABLE;
  const canEnable = programEnabled && deliveryAvailable;
  const canToggle = enabled === true || canEnable === true;
  const blocked =
    !hasData || readError || loading || denied || update.isPending || committed;
  const canSubmit = !blocked && Boolean(currentPassword) && canToggle;
  const retryBlocked = loading || update.isPending;
  const retry = () => {
    // A pending write owns the next post-write read. An earlier user retry must
    // not occupy its read lease and swallow accepted-write synchronization.
    if (admitted.current || update.isPending) return;
    void refreshReads();
  };

  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">{t("title")}</h2>
          <p className="muted mt-1 text-sm">{t("description")}</p>
        </div>
        {!denied && me.data && !me.error && (
          <span className={enabled ? "badge-green" : "badge-slate"}>
            {enabled ? t("enabled") : t("disabled")}
          </span>
        )}
      </div>

      {denied ? (
        <StatePanel
          kind="denied"
          title={t("accessDenied")}
          action={
            <Button disabled={retryBlocked} onClick={retry}>
              {ui("retry")}
            </Button>
          }
        />
      ) : (
        <>
          <QueryFeedback
            hasData={hasData}
            loading={!hasData && !readError}
            error={readError && !syncFailed}
            retrying={retryBlocked}
            loadingTitle={t("loading")}
            errorTitle={t(hasData ? "refreshFailed" : "loadFailed")}
            retryLabel={ui("retry")}
            onRetry={retry}
          />
          {hasData && loading && !readError && (
            <InlineNotice announcement="status">{t("refreshing")}</InlineNotice>
          )}
          {hasData && (
            <>
              {!enabled && !programEnabled && !readError && (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  {t("featureOff")}
                </p>
              )}
              {!enabled &&
                programEnabled &&
                !deliveryAvailable &&
                !readError && (
                  <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                    {t("unavailable")}
                  </p>
                )}

              {canToggle && (
                <form
                  className="space-y-3 border-t border-slate-100 pt-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    // The ref also closes the same-turn gap before mutation state renders.
                    if (!canSubmit || admitted.current || reading.current)
                      return;
                    admitted.current = true;
                    setSaved(false);
                    update.mutate({ enabled: !enabled, currentPassword });
                  }}
                >
                  <label className="block space-y-1">
                    <span className="label">{t("currentPassword")}</span>
                    <input
                      value={currentPassword}
                      onChange={(event) => {
                        if (blocked || admitted.current || reading.current)
                          return;
                        setCurrentPassword(event.target.value);
                        setSaved(false);
                      }}
                      disabled={blocked}
                      type="password"
                      autoComplete="current-password"
                      maxLength={1024}
                      aria-describedby={
                        update.error ? "two-factor-error" : undefined
                      }
                      className="input"
                    />
                  </label>
                  <Button
                    type="submit"
                    variant={enabled ? "secondary" : "primary"}
                    disabled={!canSubmit}
                  >
                    {update.isPending
                      ? t("saving")
                      : enabled
                        ? t("disable")
                        : t("enable")}
                  </Button>
                </form>
              )}
              {update.error && (
                <p
                  id="two-factor-error"
                  role="alert"
                  className="text-sm text-red-700"
                >
                  {update.error.message}
                </p>
              )}
            </>
          )}
          {saved && (
            <p role="status" className="text-sm text-green-700">
              {t("saved")}
            </p>
          )}
          {syncFailed && (
            <InlineNotice
              tone="warning"
              announcement="alert"
              action={
                <Button disabled={retryBlocked} onClick={retry}>
                  {ui("retry")}
                </Button>
              }
            >
              {t("savedRefreshFailed")}
            </InlineNotice>
          )}
        </>
      )}
    </section>
  );
}
