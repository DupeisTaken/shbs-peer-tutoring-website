"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

const kinds = {
  regular: {
    rail: "border-l-indigo-400",
    badge: "bg-indigo-50 text-indigo-800",
  },
  extra: { rail: "border-l-violet-400", badge: "bg-violet-50 text-violet-800" },
  interview: { rail: "border-l-sky-400", badge: "bg-sky-50 text-sky-800" },
  meeting: { rail: "border-l-teal-400", badge: "bg-teal-50 text-teal-800" },
} as const;

const tones = {
  warning: "bg-yellow-100 text-yellow-900",
  success: "bg-emerald-100 text-emerald-800",
  info: "bg-sky-100 text-sky-800",
  excused: "bg-teal-100 text-teal-800",
  neutral: "bg-slate-100 text-slate-700",
} as const;

/** Fixed semantic colors remain readable under every selectable accent theme. */
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
  kind: keyof typeof kinds;
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
      className={`card scroll-mt-6 border-l-4 p-4 sm:p-5 ${kinds[kind].rail}`}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2 [overflow-wrap:anywhere]">
          <span className={`badge ${kinds[kind].badge}`}>{t(kind)}</span>
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
