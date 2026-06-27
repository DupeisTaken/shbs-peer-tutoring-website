import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Lightweight, dependency-free data viz for the admin surfaces. Pure CSS bars sized by share of
 * the max; values sit in tabular numerals so columns of figures align like a ledger. Themeable —
 * fills map to the accent token + the semantic status colours, never hardcoded hex. Presentational
 * (no hooks) so it renders in both server and client components.
 */

export type BarTone = "accent" | "amber" | "red" | "emerald" | "slate";

const FILL: Record<BarTone, string> = {
  accent: "bg-accent-500",
  amber: "bg-amber-400",
  red: "bg-red-400",
  emerald: "bg-emerald-500",
  slate: "bg-slate-400",
};

const DOT: Record<BarTone, string> = FILL;

export interface BarItem {
  key: string;
  label: ReactNode;
  /** Magnitude that sizes the bar. */
  value: number;
  /** Formatted figure shown at the end of the row (defaults to `value`). */
  display?: string;
  tone?: BarTone;
  href?: string;
}

/** Horizontal labelled bars — the signature dashboard/activity visualization. */
export function BarList({ items, emptyLabel }: { items: BarItem[]; emptyLabel?: string }) {
  if (items.length === 0) {
    return <p className="muted py-6 text-center text-sm">{emptyLabel}</p>;
  }
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((it) => {
        const pct = it.value <= 0 ? 0 : Math.max(6, Math.round((it.value / max) * 100));
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-slate-700">{it.label}</span>
              <span className="shrink-0 text-sm font-semibold text-slate-900 tabular-nums">
                {it.display ?? it.value}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div
                className={`h-full rounded-full ${FILL[it.tone ?? "accent"]} motion-safe:transition-[width] motion-safe:duration-700`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        );
        return (
          <li key={it.key}>
            {it.href ? (
              <Link
                href={it.href}
                className="block rounded-md outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface Segment {
  key: string;
  value: number;
  tone: BarTone;
  label: string;
}

/** A single stacked proportion bar + legend (e.g. attendance present / excused / unexcused). */
export function SegmentBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        {total > 0 &&
          segments.map((s) =>
            s.value > 0 ? (
              <div
                key={s.key}
                className={`${FILL[s.tone]} motion-safe:transition-[width] motion-safe:duration-700`}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ) : null,
          )}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className={`inline-block h-2 w-2 rounded-full ${DOT[s.tone]}`} aria-hidden />
            <span>{s.label}</span>
            <span className="font-semibold text-slate-800 tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
