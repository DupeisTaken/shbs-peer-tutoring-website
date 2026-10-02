"use client";

import { useTranslations } from "next-intl";
import type { RouterOutputs } from "~/trpc/react";
import { DisclosureSection } from "./ui/disclosure-section";
import { SummaryTable } from "./ui/summary-table";

/** Compact roster actions and cross-person comparison serve different tasks.
 * Keep the full numeric matrix available without manufacturing row actions. */
export function ServiceHoursComparison({
  rows,
}: {
  rows: RouterOutputs["admin"]["periodSummary"]["rows"];
}) {
  const t = useTranslations("admin.summary");
  return (
    <DisclosureSection
      title={t("compareTitle", { count: rows.length })}
      lifetime="lazy"
    >
      <p className="muted mb-3 text-sm">{t("compareHelp")}</p>
      <SummaryTable label={t("compareLabel")}>
        <thead>
          <tr>
            <th scope="col">{t("columns.tutor")}</th>
            <th scope="col" className="text-right">
              {t("columns.sessions")}
            </th>
            <th scope="col" className="text-right">
              {t("columns.earned")}
            </th>
            <th scope="col" className="text-right">
              {t("columns.extras")}
            </th>
            <th scope="col" className="text-right">
              {t("columns.penalties")}
            </th>
            <th scope="col" className="text-right">
              {t("columns.total")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tutorId}>
              <th scope="row" className="text-left font-medium">
                {row.englishName}
                {!row.active && ` ${t("inactive")}`}
              </th>
              <td className="text-right tabular-nums">{row.sessions}</td>
              <td className="text-right tabular-nums">
                {row.earned.toFixed(1)}
              </td>
              <td className="text-right tabular-nums">
                {row.extras.toFixed(1)}
              </td>
              <td className="text-right tabular-nums">
                {row.punishments.toFixed(1)}
              </td>
              <td className="text-right font-semibold tabular-nums">
                {row.total.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </SummaryTable>
    </DisclosureSection>
  );
}
