"use client";

import { useTranslations } from "next-intl";
import type { ServiceHoursRow } from "~/lib/service-hours-view";
import { formatMonthlyHours } from "~/lib/monthly-hours-format";
import { ParticipantName } from "./participant-name";
import { SummaryTable } from "./ui/summary-table";

/** Stored report rows are independent of the interactive roster's filters. */
export function MonthlyHoursSnapshot({
  rows,
  totals,
}: {
  rows: ServiceHoursRow[];
  totals: {
    tutors: number;
    sessions: number;
    earned: number;
    extras: number;
    punishments: number;
    total: number;
  };
}) {
  const t = useTranslations("monthlyHours");
  const hours = useTranslations("admin.summary");
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">
        {t("snapshotTotals", {
          tutors: totals.tutors,
          sessions: totals.sessions,
          hours: formatMonthlyHours(totals.total),
        })}
      </p>
      <SummaryTable sortable label={t("snapshot")}>
        <thead>
          <tr>
            <th>{hours("columns.tutor")}</th>
            <th className="text-right">{t("sessionRows")}</th>
            <th className="text-right">{hours("columns.earned")}</th>
            <th className="text-right">{hours("columns.extras")}</th>
            <th className="text-right">{hours("columns.penalties")}</th>
            <th className="text-right">{hours("columns.total")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tutorId}>
              <td data-sort-value={row.englishName}>
                <ParticipantName name={row.englishName} />
                {!row.active && ` ${hours("inactive")}`}
              </td>
              <td className="text-right tabular-nums">{row.sessions}</td>
              <td className="text-right tabular-nums">
                {formatMonthlyHours(row.earned)}
              </td>
              <td className="text-right tabular-nums">
                {formatMonthlyHours(row.extras)}
              </td>
              <td className="text-right tabular-nums">
                {formatMonthlyHours(row.punishments)}
              </td>
              <td className="text-right font-semibold tabular-nums">
                {formatMonthlyHours(row.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </SummaryTable>
      <p className="muted text-sm">{t("accountingHelp")}</p>
      {rows.length === 0 && <p className="muted text-sm">{t("noActivity")}</p>}
    </div>
  );
}

export function monthlyHoursStatusKey(status: string) {
  const normalized = status === "PENDING" ? "QUEUED" : status;
  return [
    "QUEUED",
    "RETRYING",
    "SENDING",
    "SENT",
    "PARTIAL",
    "FAILED",
    "SKIPPED",
    "BLOCKED",
  ].includes(normalized)
    ? (normalized as
        | "QUEUED"
        | "RETRYING"
        | "SENDING"
        | "SENT"
        | "PARTIAL"
        | "FAILED"
        | "SKIPPED"
        | "BLOCKED")
    : "BLOCKED";
}

export function MonthlyHoursStatus({ status }: { status: string }) {
  const t = useTranslations("monthlyHours.status");
  const key = monthlyHoursStatusKey(status);
  return (
    <span
      className={
        key === "SENT"
          ? "badge-green"
          : key === "FAILED" || key === "BLOCKED"
            ? "badge-amber"
            : "badge-slate"
      }
    >
      {t(key)}
    </span>
  );
}

export function MonthlyHoursReason({ reason }: { reason: string | null }) {
  const t = useTranslations("monthlyHours.reason");
  const reasons = [
    "ROLE_CHANGED",
    "UNAVAILABLE_ACCOUNT",
    "NO_VERIFIED_ADDRESS",
    "OPTED_OUT",
    "NOT_SELECTED",
    "SCHEDULE_OFF",
    "EMAIL_OFF",
    "FEATURE_OFF",
    "TRANSPORT_UNAVAILABLE",
  ] as const;
  const key = reasons.find((value) => value === reason);
  return key ? <span className="text-sm text-slate-600">{t(key)}</span> : null;
}

export function MonthlyHoursCounts({
  counts,
}: {
  counts: {
    queued: number;
    retrying: number;
    sending: number;
    sent: number;
    failed: number;
    skipped: number;
    blocked: number;
  };
}) {
  const t = useTranslations("monthlyHours.status");
  const entries = [
    ["QUEUED", counts.queued],
    ["RETRYING", counts.retrying],
    ["SENDING", counts.sending],
    ["SENT", counts.sent],
    ["FAILED", counts.failed],
    ["SKIPPED", counts.skipped],
    ["BLOCKED", counts.blocked],
  ] as const;
  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600">
      {entries
        .filter(([, count]) => count > 0)
        .map(([label, count]) => (
          <div key={label} className="inline-flex gap-1">
            <dt>{t(label)}</dt>
            <dd>{count}</dd>
          </div>
        ))}
    </dl>
  );
}
