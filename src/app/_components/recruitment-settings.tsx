"use client";

import { useState } from "react";
import { useLocale, useTimeZone, useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { programDateTimeInput, parseProgramDateTime } from "~/lib/program-time";
import { programTimeZoneInputLabel } from "~/lib/program-time-zone-label";
import type { RecruitmentAudience, RecruitmentWindow } from "~/lib/recruitment";

/** Separate editors prevent saving one audience from overwriting the other's schedule. */
export function RecruitmentSettings(props: {
  termId: string;
  audience: RecruitmentAudience;
  window: RecruitmentWindow;
}) {
  const zone = useTimeZone();
  const t = useTranslations("admin.program.signupWindow");
  const [saved, setSaved] = useState(false);
  // A refreshed server value or timezone replaces the draft only after a successful save/refetch.
  return (
    <div>
      <Editor
        key={`${zone}-${JSON.stringify(props.window)}`}
        {...props}
        onSaved={() => setSaved(true)}
        onDirty={() => setSaved(false)}
      />
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
  onSaved,
  onDirty,
}: {
  termId: string;
  audience: RecruitmentAudience;
  window: RecruitmentWindow;
  onSaved: () => void;
  onDirty: () => void;
}) {
  const t = useTranslations("recruitment");
  const timeZone = useTimeZone();
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
          if (save.isPending) return;
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
        {(error || save.error) && (
          <p role="alert" className="text-sm text-red-700">
            {error || save.error?.message}
          </p>
        )}
        <button
          className="btn-primary min-h-11 lg:min-h-10"
          disabled={save.isPending}
        >
          {t(save.isPending ? "saving" : "save")}
        </button>
        <a
          className="link ml-4 inline-flex min-h-11 items-center"
          href={audience === "tutor" ? "/tutor-signup" : "/signup"}
          target="_blank"
          rel="noreferrer"
        >
          {t("view")}
        </a>
      </form>
    </section>
  );
}
