"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale, useTimeZone } from "next-intl";
import { recruitmentStatus, type RecruitmentWindow } from "~/lib/recruitment";
import { Markdown } from "~/app/_components/markdown";

/** Advance from server time, not the visitor's wall clock. Options refetch separately for admin edits. */
export function useRecruitmentStatus(
  window?: RecruitmentWindow & { serverNow: string },
) {
  const [clock, setClock] = useState({ anchor: window?.serverNow, elapsed: 0 });
  useEffect(() => {
    const start = performance.now();
    const timer = setInterval(
      () =>
        setClock({
          anchor: window?.serverNow,
          elapsed: performance.now() - start,
        }),
      1_000,
    );
    return () => clearInterval(timer);
  }, [window?.serverNow]);
  return window
    ? recruitmentStatus(
        window,
        new Date(window.serverNow).getTime() +
          (clock.anchor === window.serverNow ? clock.elapsed : 0),
      )
    : "open";
}

/** Readable status and published policy remain outside the disabled response fields. */
export function RecruitmentNotice({
  status,
  missing,
  window,
  policy,
}: {
  status: ReturnType<typeof recruitmentStatus>;
  missing: string[];
  window?: RecruitmentWindow;
  policy?: { title: string; body: string } | null;
}) {
  const t = useTranslations("recruitment");
  const locale = useLocale();
  const timeZone = useTimeZone();
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  return (
    <section className="mb-6 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-5">
      <div role="status">
        <h2 className="text-lg font-semibold text-slate-900">{t("preview")}</h2>
        <p className="mt-1 text-sm text-slate-700">
          {t(status === "open" ? "setup" : status)}
        </p>
        <p className="mt-2 text-sm text-slate-700">{t("readOnly")}</p>
        {missing.length > 0 && (
          <p className="mt-2 text-sm text-slate-700">
            {t("missing", { items: missing.map((key) => t(key)).join(", ") })}
          </p>
        )}
      </div>
      {(["opensAt", "closesAt"] as const).map((key) =>
        window?.[key] ? (
          <p key={key} className="text-sm text-slate-700">
            {t(key === "opensAt" ? "opens" : "closes")}:{" "}
            {dateFormat.format(new Date(window[key]))} ({timeZone})
          </p>
        ) : null,
      )}
      {window?.previewUrl && (
        <a
          className="link inline-flex min-h-11 items-center break-all"
          href={window.previewUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t("sheet")}
        </a>
      )}
      {policy && (
        <details className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">
            {policy.title}
          </summary>
          <Markdown>{policy.body}</Markdown>
        </details>
      )}
    </section>
  );
}
