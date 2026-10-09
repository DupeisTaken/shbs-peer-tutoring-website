"use client";
import { useRef } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { Button } from "./ui/button";
import { InlineNotice, StatePanel } from "./ui/patterns";

/** Independent immediate controls share query invalidation, never a combined toggle. */
export function ProgramEmailSettings() {
  const t = useTranslations("programEmail");
  const utils = api.useUtils();
  const settings = api.program.emailNotificationSettings.useQuery();
  const save = api.program.setEmailNotifications.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.program.emailNotificationSettings.invalidate(),
        utils.account.emailSettings.invalidate(),
      ]);
    },
  });
  const binding = api.program.setSecondaryEmailBinding.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.program.emailNotificationSettings.invalidate(),
        utils.account.emailSettings.invalidate(),
      ]);
    },
  });
  const data = settings.data;
  return (
    <section className="card space-y-3 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="section-title">{t("title")}</h2>
          <p className="muted mt-1 text-sm">{t("help")}</p>
        </div>
        {data && (
          <span className={data.enabled ? "badge-green" : "badge-slate"}>
            {t(data.enabled ? "on" : "off")}
          </span>
        )}
      </div>
      {data && <EmailDeliveryStatus />}
      {!data && !settings.error && (
        <StatePanel kind="loading" title={t("loading")} />
      )}
      {data?.canEdit && (
        <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={data.enabled}
            disabled={
              save.isPending ||
              !!settings.error ||
              (!data.enabled && !data.deliveryAvailable)
            }
            onChange={(e) =>
              save.mutate({
                enabled: e.target.checked,
                expectedEnabled: data.enabled,
              })
            }
            className="accent-accent-600 h-4 w-4"
          />
          {t("enable")}
        </label>
      )}
      <p className="muted text-xs">{t("essential")}</p>
      <div className="space-y-3 border-t border-slate-100 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {t("bindingTitle")}
            </h3>
            <p className="muted mt-1 text-sm">{t("bindingHelp")}</p>
          </div>
          {data && (
            <span
              className={
                data.secondaryEmailBindingEnabled
                  ? "badge-green"
                  : "badge-slate"
              }
            >
              {t(data.secondaryEmailBindingEnabled ? "on" : "off")}
            </span>
          )}
        </div>
        {data?.canEdit && (
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={data.secondaryEmailBindingEnabled}
              disabled={binding.isPending || !!settings.error}
              onChange={(e) =>
                binding.mutate({
                  enabled: e.target.checked,
                  expectedEnabled: data.secondaryEmailBindingEnabled,
                })
              }
              className="accent-accent-600 h-4 w-4 shrink-0"
            />
            {t("bindingEnable")}
          </label>
        )}
      </div>
      {data && !data.deliveryAvailable && (
        <p className="text-sm text-amber-800">{t("unavailable")}</p>
      )}
      {(save.isSuccess || binding.isSuccess) && (
        <p role="status" className="text-sm text-green-700">
          {t("saved")}
        </p>
      )}
      {settings.error && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button
              size="compact"
              disabled={settings.isFetching}
              onClick={() => void settings.refetch()}
            >
              {t("retrySettings")}
            </Button>
          }
        >
          {t("settingsFailed")}
        </InlineNotice>
      )}
      {(save.error ?? binding.error) && (
        <p role="alert" className="text-sm text-red-700">
          {(save.error ?? binding.error)?.message}
        </p>
      )}
    </section>
  );
}

/** Diagnostics own only a read query: refreshing cannot replay settings or program rollover. */
function EmailDeliveryStatus() {
  const t = useTranslations("programEmail");
  const format = useFormatter();
  const refreshInFlight = useRef(false);
  const status = api.program.emailDeliveryStatus.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const refresh = async () => {
    if (refreshInFlight.current || status.isFetching) return;
    refreshInFlight.current = true;
    try {
      await status.refetch();
    } finally {
      refreshInFlight.current = false;
    }
  };
  return (
    <section
      className="space-y-3 rounded-lg border border-slate-200 p-3"
      aria-labelledby="email-delivery-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          id="email-delivery-title"
          className="text-sm font-semibold text-slate-900"
        >
          {t("deliveryTitle")}
        </h3>
        <Button
          size="compact"
          disabled={status.isFetching}
          onClick={() => void refresh()}
        >
          {t(status.isFetching ? "checking" : "refreshStatus")}
        </Button>
      </div>
      <p className="muted text-xs">{t("deliveryHelp")}</p>
      {!status.data && !status.error && (
        <StatePanel kind="loading" title={t("checking")} />
      )}
      {status.error && (
        <InlineNotice tone="error" announcement="alert">
          {t(status.data ? "statusStale" : "statusFailed")}
        </InlineNotice>
      )}
      {status.data && (
        <>
          <div className="space-y-2" aria-live="polite">
            {status.data.channels.map((channel) => (
              <InlineNotice
                key={channel.category}
                tone={
                  status.error
                    ? "info"
                    : channel.state === "READY"
                      ? "success"
                      : "warning"
                }
              >
                <p className="font-semibold">
                  {t(`channel.${channel.category}`)}
                </p>
                <p>{t(`transport.${channel.state}`)}</p>
                <p className="mt-1 text-xs">
                  {t("checkedAt", {
                    time: format.dateTime(channel.checkedAt, {
                      dateStyle: "short",
                      timeStyle: "medium",
                    }),
                  })}
                </p>
              </InlineNotice>
            ))}
          </div>
          {status.data.retrying > 0 && (
            <InlineNotice tone="warning" announcement="status">
              {t("retrying", { count: status.data.retrying })}
            </InlineNotice>
          )}
          {status.data.failed > 0 && (
            <InlineNotice tone="warning" announcement="status">
              {t("failed", { count: status.data.failed })}
            </InlineNotice>
          )}
        </>
      )}
    </section>
  );
}
