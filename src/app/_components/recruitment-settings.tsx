"use client";

import { InlineNotice } from "./ui/patterns";
import { useState } from "react";
import { useLocale, useTimeZone, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { programDateTimeInput, parseProgramDateTime } from "~/lib/program-time";
import { programTimeZoneInputLabel } from "~/lib/program-time-zone-label";
import type { RecruitmentAudience, RecruitmentWindow } from "~/lib/recruitment";
import { DEFAULT_TIME_ZONE } from "~/i18n/config";

/** Separate editors prevent saving one audience from overwriting the other's schedule. */
export function RecruitmentSettings(props: {
  termId: string;
  audience: RecruitmentAudience;
  window: RecruitmentWindow;
  canEdit?: boolean;
  canApply?: boolean;
}) {
  const zone = useTimeZone() ?? DEFAULT_TIME_ZONE;
  const t = useTranslations("admin.program.signupWindow");
  const common = useTranslations("profilePolicy");
  const utils = api.useUtils();
  const [saved, setSaved] = useState(false);
  const [snapshot, setSnapshot] = useState(() => ({ termId: props.termId, window: props.window, timeZone: zone }));
  const [generation, setGeneration] = useState(0);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  // Keep each audience's period and timezone evidence with its draft across live-query updates.
  return (
    <div>
      <Editor
        key={generation}
        {...props}
        {...snapshot}
        reloading={reloading}
        onReload={async () => {
          setReloading(true);
          setReloadError(null);
          try {
            const current = await utils.admin.currentPeriod.fetch();
            if (!current) throw new Error(common("loadFailed"));
            setSnapshot({ termId: current.termId, window: current.recruitment[props.audience], timeZone: zone });
            setGeneration((value) => value + 1);
            setSaved(false);
          } catch (error) {
            setReloadError(error instanceof Error ? error.message : common("loadFailed"));
          } finally { setReloading(false); }
        }}
        onSaved={() => setSaved(true)}
        onDirty={() => setSaved(false)}
      />
      {reloadError && <InlineNotice tone="error" announcement="alert">{reloadError}</InlineNotice>}
      {saved && (
        <p role="status" className="mt-2 text-sm text-green-700">
          {t("saved")}
        </p>
      )}
    </div>
  );
}
function Editor({
  termId,
  audience,
  window,
  canEdit = true,
  canApply = true,
  onSaved,
  onDirty,
  timeZone,
  reloading,
  onReload,
}: {
  termId: string;
  audience: RecruitmentAudience;
  window: RecruitmentWindow;
  canEdit?: boolean;
  canApply?: boolean;
  onSaved: () => void;
  onDirty: () => void;
  timeZone: string;
  reloading: boolean;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations("recruitment");
  const approvals = useTranslations("approvals");
  const common = useTranslations("profilePolicy");
  const locale = useLocale();
  const utils = api.useUtils();
  const [enabled, setEnabled] = useState(window.enabled);
  const [startEnabled, setStartEnabled] = useState(!!window.opensAt);
  const [endEnabled, setEndEnabled] = useState(!!window.closesAt);
  const [start, setStart] = useState(
    window.opensAt
      ? programDateTimeInput(new Date(window.opensAt), timeZone)
      : "",
  );
  const [end, setEnd] = useState(
    window.closesAt
      ? programDateTimeInput(new Date(window.closesAt), timeZone)
      : "",
  );
  const [previewUrl, setPreviewUrl] = useState(window.previewUrl ?? "");
  const [error, setError] = useState("");
  const save = api.program.setSignupWindow.useMutation({
    onSuccess: async () => {
      onSaved();
      await Promise.all([
        utils.admin.currentPeriod.invalidate(),
        utils.application.options.invalidate(),
        utils.tutee.signupOptions.invalidate(),
      ]);
    },
  });
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
        <h2 className="section-title">{t(audience)}</h2>
        <p className="muted mt-1">{t("help")}</p>
      </div>
      <form
        className="space-y-4 p-5"
        onChange={onDirty}
        onSubmit={(event) => {
          event.preventDefault();
          // Mirror proposal eligibility even for synthetic submit events on a disabled form.
          if (!canEdit || save.isPending || reloading) return;
          try {
            const opensAt = startEnabled
              ? parseProgramDateTime(start, timeZone)
              : null;
            const closesAt = endEnabled
              ? parseProgramDateTime(end, timeZone)
              : null;
            if (opensAt && closesAt && closesAt <= opensAt) {
              setError(t("invalidOrder"));
              return;
            }
            setError("");
            save.mutate({
              audience,
              expectedTermId: termId,
              enabled,
              opensAt,
              closesAt,
              previewUrl: previewUrl.trim() || null,
            });
          } catch (err) {
            setError(err instanceof Error ? err.message : t("invalidOrder"));
          }
        }}
      >
        <p className="muted text-sm">{approvals("sensitiveHelp")}</p>
        <fieldset disabled={!canEdit || save.isPending || reloading} className="min-w-0 space-y-4">
        <legend className="sr-only">{t(audience)}</legend>
        <label className="flex min-h-11 items-center gap-3 font-medium">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t("enabled")}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              {
                key: "start",
                checked: startEnabled,
                toggle: setStartEnabled,
                value: start,
                set: setStart,
              },
              {
                key: "end",
                checked: endEnabled,
                toggle: setEndEnabled,
                value: end,
                set: setEnd,
              },
            ] as const
          ).map((item) => (
            <div key={item.key} className="space-y-2">
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => item.toggle(e.target.checked)}
                />
                {t(item.key)}
              </label>
              {item.checked && (
                <label className="block space-y-1">
                  <span className="sr-only">{t(item.key)}</span>
                  <input
                    type="datetime-local"
                    className="input min-h-11 min-w-0 lg:min-h-10"
                    required
                    value={item.value}
                    onChange={(e) => item.set(e.target.value)}
                  />
                  <span className="muted block text-xs">
                    {programTimeZoneInputLabel(item.value, timeZone, locale)}
                  </span>
                </label>
              )}
              {!item.checked && (
                <p className="muted text-sm">
                  {t(item.key === "start" ? "noStart" : "noEnd")}
                </p>
              )}
            </div>
          ))}
        </div>
        <label className="block space-y-1">
          <span className="label">{t("previewLink")}</span>
          <input
            type="url"
            className="input min-h-11 lg:min-h-10"
            value={previewUrl}
            onChange={(e) => setPreviewUrl(e.target.value)}
            placeholder="https://…"
          />
          <span className="muted block text-xs">{t("previewHelp")}</span>
        </label>
        {save.error?.data?.approvalId && <InlineNotice tone="warning" announcement="status">{approvals("queuedBody")}</InlineNotice>}
        {(error || (save.error && !save.error.data?.approvalId)) && (
          <p role="alert" className="text-sm text-red-700">
            {error || save.error?.message}
          </p>
        )}
        <button
          className="btn-primary min-h-11 lg:min-h-10"
          disabled={save.isPending}
        >
          {save.isPending ? t("saving") : canApply ? t("save") : approvals("requestHead")}
        </button>
        <button type="button" className="btn-secondary min-h-11 lg:min-h-10" onClick={() => void onReload()}>{common("reload")}</button>
        </fieldset>
        <a
          className="link ml-4 inline-flex min-h-11 items-center"
          href={audience === "tutor" ? "/tutor" : "/tutee"}
          target="_blank"
          rel="noreferrer"
        >
          {t("view")}
        </a>
      </form>
    </section>
  );
}
