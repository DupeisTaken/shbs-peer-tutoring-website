"use client";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { CaptchaError } from "./signup-captcha";

/** Immediate operational setting, with a version token to reject stale tabs (including ABA). */
export function ProgramCaptchaSettings() {
  const t = useTranslations("captcha");
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
        <>
          <p
            role="status"
            className={`rounded-lg p-3 text-sm ${data.ready ? "bg-slate-50 text-slate-700" : "bg-amber-50 text-amber-900"}`}
          >
            {t(data.ready ? "ready" : "notReady")}
          </p>
          {data.canEdit ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm font-medium">
              <input
                type="checkbox"
                role="switch"
                checked={data.enabled}
                disabled={save.isPending || (!data.enabled && !data.ready)}
                onChange={(event) =>
                  save.mutate({
                    enabled: event.target.checked,
                    expectedVersion: data.version,
                  })
                }
              />
              <span>{t("title")}</span>
            </label>
          ) : (
            <p className="muted text-sm">{t("readOnly")}</p>
          )}
        </>
      ) : (
        <p role="status" className="muted">
          {t("loading")}
        </p>
      )}
      {(settings.error ?? save.error) && (
        <p role="alert" className="text-sm text-red-700">
          <CaptchaError error={(settings.error ?? save.error)!} />
        </p>
      )}
      {settings.error && (
        <button
          className="btn-secondary min-h-11"
          onClick={() => void settings.refetch()}
        >
          {t("retry")}
        </button>
      )}
      <p className="muted text-xs">{t("billingBoundary")}</p>
    </section>
  );
}
