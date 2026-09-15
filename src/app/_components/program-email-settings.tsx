"use client";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";

/** Notification enablement is immediate and available to ADMIN/HEAD, unlike staged modules. */
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
      {data?.canEdit && (
        <label className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={data.enabled}
            disabled={
              save.isPending || (!data.enabled && !data.deliveryAvailable)
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
      {data && !data.deliveryAvailable && (
        <p className="text-sm text-amber-800">{t("unavailable")}</p>
      )}
      {!!data?.failed && (
        <p role="status" className="text-sm text-amber-800">
          {t("failed", { count: data.failed })}
        </p>
      )}
      {save.isSuccess && (
        <p role="status" className="text-sm text-green-700">
          {t("saved")}
        </p>
      )}
      {(settings.error ?? save.error) && (
        <p role="alert" className="text-sm text-red-700">
          {(settings.error ?? save.error)?.message}
        </p>
      )}
    </section>
  );
}
