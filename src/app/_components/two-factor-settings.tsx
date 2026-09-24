"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";

/** Shared self-service control used by both tutor and administrative account settings. */
export function TwoFactorSettings() {
  const t = useTranslations("auth.twoFactor.settings");
  const utils = api.useUtils();
  const me = api.account.me.useQuery();
  const features = api.program.features.useQuery();
  const [currentPassword, setCurrentPassword] = useState("");

  const update = api.account.setTwoFactorEnabled.useMutation({
    onSuccess: async () => {
      setCurrentPassword("");
      await utils.account.me.invalidate();
    },
  });

  const enabled = me.data?.twoFactorEnabled ?? false;
  const programEnabled = features.data?.EMAIL_2FA ?? false;
  const deliveryAvailable = features.data?.EMAIL_DELIVERY_AVAILABLE ?? false;
  const canEnable = programEnabled && deliveryAvailable;
  const canSubmit =
    Boolean(currentPassword) && !update.isPending && (enabled || canEnable);

  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">{t("title")}</h2>
          <p className="muted mt-1 text-sm">{t("description")}</p>
        </div>
        <span className={enabled ? "badge-green" : "badge-slate"}>
          {enabled ? t("enabled") : t("disabled")}
        </span>
      </div>

      {!enabled && !programEnabled && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          {t("featureOff")}
        </p>
      )}
      {!enabled && programEnabled && !deliveryAvailable && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {t("unavailable")}
        </p>
      )}

      {(enabled || canEnable) && (
        <form
          className="space-y-3 border-t border-slate-100 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate({ enabled: !enabled, currentPassword });
          }}
        >
          <label className="block space-y-1">
            <span className="label">{t("currentPassword")}</span>
            <input
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              className="input"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className={enabled ? "btn-secondary" : "btn-primary"}
              disabled={!canSubmit}
            >
              {update.isPending
                ? t("saving")
                : enabled
                  ? t("disable")
                  : t("enable")}
            </button>
            {update.isSuccess && (
              <span className="text-sm text-green-600">{t("saved")}</span>
            )}
            {update.error && (
              <span className="text-sm text-red-600">
                {update.error.message}
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
