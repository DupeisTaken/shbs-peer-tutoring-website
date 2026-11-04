"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

const tones = {
  warning: "bg-yellow-100 text-yellow-900",
  success: "bg-emerald-100 text-emerald-800",
  neutral: "bg-slate-100 text-slate-700",
} as const;

/** Neutral event labels keep yellow for action and green for completed/excused states. */
export function AgendaBadge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
}) {
  return (
    <span className={`badge max-w-full gap-1.5 ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Presentation only: the owning schedule supplies status and authorized actions. */
export function AgendaEventCard({
  id,
  kind,
  title,
  time,
  details,
  badges,
  actions,
  children,
}: {
  id: string;
  kind: "regular" | "extra" | "interview" | "meeting";
  title: string;
  time: ReactNode;
  details?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const t = useTranslations("agendaEvents");
  return (
    <article
      id={id}
      tabIndex={-1}
      className="card scroll-mt-6 border-l-4 border-l-slate-300 p-4 sm:p-5"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2 [overflow-wrap:anywhere]">
          <AgendaBadge>{t(kind)}</AgendaBadge>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <p className="text-sm font-medium text-slate-700">{time}</p>
          {details && (
            <div className="space-y-1 text-sm text-slate-600">{details}</div>
          )}
        </div>
        {badges && (
          <div className="flex max-w-full flex-wrap items-center gap-1.5 sm:max-w-[45%] sm:justify-end">
            {badges}
          </div>
        )}
      </div>
      {children && <div className="mt-3">{children}</div>}
      {actions && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {actions}
        </div>
      )}
    </article>
  );
}
