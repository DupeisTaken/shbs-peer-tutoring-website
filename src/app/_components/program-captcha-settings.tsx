"use client";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { CaptchaError } from "./signup-captcha";
import { Button, Switch } from "./ui/button";
import { InlineNotice, SettingRow, StatePanel } from "./ui/patterns";

/** Immediate operational setting, with a version token to reject stale tabs (including ABA). */
export function ProgramCaptchaSettings() {
  const t = useTranslations("captcha");
  const patterns = useTranslations("uiPatterns");
  const utils = api.useUtils();
  const settings = api.program.captchaSettings.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const save = api.program.setCaptcha.useMutation({
    onSettled: async () => {
      await Promise.all([
        utils.program.captchaSettings.invalidate(),
        utils.program.captchaPublic.invalidate(),
      ]);
    },
  });
  const data = settings.data;
  const retry = (
    <Button
      disabled={settings.isFetching}
      onClick={() => void settings.refetch()}
    >
      {t("retry")}
    </Button>
  );
  return (
    <section
      className="card space-y-3 p-5"
      aria-labelledby="captcha-setting-title"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="captcha-setting-title" className="section-title">
          {t("title")}
        </h2>
        {data && (
          <span className={data.enabled ? "badge-green" : "badge-slate"}>
            {t(data.enabled ? "on" : "off")}
          </span>
        )}
      </div>
      <p className="muted text-sm">{t("scope")}</p>
      <p className="text-sm text-slate-700">{t("cost")}</p>
      {data ? (
        <SettingRow
          label={t("title")}
          control={
            data.canEdit ? (
              <Switch
                label={t("title")}
                checked={data.enabled}
                disabled={save.isPending || (!data.enabled && !data.ready)}
                onChange={(enabled) =>
                  save.mutate({
                    enabled,
                    expectedVersion: data.version,
                  })
                }
              />
            ) : (
              <p className="muted text-sm">{t("readOnly")}</p>
            )
          }
          feedback={
            <InlineNotice
              tone={data.ready ? "info" : "warning"}
              announcement="status"
            >
              {t(data.ready ? "ready" : "notReady")}
            </InlineNotice>
          }
        />
      ) : !settings.error ? (
        <StatePanel kind="loading" title={t("loading")} />
      ) : null}
      {/* An initial failure replaces loading; a refetch failure keeps cached controls. */}
      {settings.error &&
        (data ? (
          <InlineNotice tone="error" announcement="alert" action={retry}>
            <CaptchaError error={settings.error} />
          </InlineNotice>
        ) : (
          <StatePanel kind="error" title={patterns("loadFailed")} action={retry}>
            <CaptchaError error={settings.error} />
          </StatePanel>
        ))}
      {save.error && (
        <p role="alert" className="text-sm text-red-700">
          <CaptchaError error={save.error} />
        </p>
      )}
      <p className="muted text-xs">{t("billingBoundary")}</p>
    </section>
  );
}
