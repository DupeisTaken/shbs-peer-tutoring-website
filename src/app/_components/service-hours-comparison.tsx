"use client";

import { useTranslations } from "next-intl";
import type {
  ServiceHoursRow,
  ServiceHoursView,
} from "~/lib/service-hours-view";
import { ParticipantName, participantNameLabel } from "./participant-name";
import { SortHeader, type Sort } from "./sortable";
import { SummaryTable, TableActions, TableDetails } from "./ui/summary-table";

/** One table and one feature-owned sort survive changes between compact and
 * comparison views. Row identity always comes from tutorId, never display names. */
export function ServiceHoursComparison({
  rows,
  panel,
  sort,
}: {
  rows: ServiceHoursRow[];
  panel: ServiceHoursView["panel"];
  sort: Sort;
}) {
  const t = useTranslations();
  const breakdown = panel === "breakdown";
  return (
    <div className="space-y-3">
      {breakdown && (
        <p className="muted text-sm">{t("admin.summary.compareHelp")}</p>
      )}
      <SummaryTable
        label={t(
          breakdown ? "admin.summary.compareLabel" : "admin.summary.title",
        )}
      >
        <thead>
          <tr>
            <SortHeader sort={sort} sortKey="englishName">
              {t("admin.summary.columns.tutor")}
            </SortHeader>
            <SortHeader sort={sort} sortKey="sessions" className="text-right">
              {t("admin.summary.columns.sessions")}
            </SortHeader>
            {breakdown && (
              <>
                <SortHeader sort={sort} sortKey="earned" className="text-right">
                  {t("admin.summary.columns.earned")}
                </SortHeader>
                <SortHeader sort={sort} sortKey="extras" className="text-right">
                  {t("admin.summary.columns.extras")}
                </SortHeader>
                <SortHeader
                  sort={sort}
                  sortKey="punishments"
                  className="text-right"
                >
                  {t("admin.summary.columns.penalties")}
                </SortHeader>
              </>
            )}
            <SortHeader sort={sort} sortKey="total" className="text-right">
              {t("admin.summary.columns.total")}
            </SortHeader>
            {!breakdown && (
              <th scope="col" className="table-actions-heading">
                {t("tablePatterns.actions")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tutorId} className="text-slate-700">
              <td>
                <ParticipantName name={row.englishName} />
                {!row.active && ` ${t("admin.summary.inactive")}`}
              </td>
              <td className="text-right tabular-nums">{row.sessions}</td>
              {breakdown && (
                <>
                  <td className="text-right tabular-nums">
                    {row.earned.toFixed(1)}
                  </td>
                  <td className="text-right tabular-nums">
                    {row.extras.toFixed(1)}
                  </td>
                  <td className="text-right tabular-nums">
                    {row.punishments.toFixed(1)}
                  </td>
                </>
              )}
              <td className="text-right font-semibold tabular-nums">
                {row.total.toFixed(1)}
              </td>
              {!breakdown && (
                <TableActions>
                  <TableDetails
                    title={participantNameLabel(
                      row.englishName,
                      undefined,
                      t("participantNames.unnamed"),
                    )}
                  >
                    <dl className="grid grid-cols-2 gap-3">
                      <dt>{t("admin.summary.columns.sessions")}</dt>
                      <dd>{row.sessions}</dd>
                      <dt>{t("admin.summary.columns.earned")}</dt>
                      <dd>{row.earned.toFixed(1)}</dd>
                      <dt>{t("admin.summary.columns.extras")}</dt>
                      <dd>{row.extras.toFixed(1)}</dd>
                      <dt>{t("admin.summary.columns.penalties")}</dt>
                      <dd>{row.punishments.toFixed(1)}</dd>
                      <dt>{t("admin.summary.columns.total")}</dt>
                      <dd className="font-semibold">{row.total.toFixed(1)}</dd>
                    </dl>
                  </TableDetails>
                </TableActions>
              )}
            </tr>
          ))}
        </tbody>
      </SummaryTable>
    </div>
  );
}
