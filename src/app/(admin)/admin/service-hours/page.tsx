"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { Button } from "~/app/_components/ui/button";
import { FilterToolbar, StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import {
  SummaryTable,
  TableActions,
  TableDetails,
} from "~/app/_components/ui/summary-table";
import { ServiceHoursComparison } from "~/app/_components/service-hours-comparison";

export default function SummaryPage() {
  const t = useTranslations();
  // Empty → the active period's current semester; a month ("YYYY-MM") narrows to that month.
  const [month, setMonth] = useState("");
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const summary = api.admin.periodSummary.useQuery(
    month ? { month } : undefined,
    { enabled: !denied },
  );
  const accessDenied =
    summary.error?.data?.code === "FORBIDDEN" ||
    summary.error?.data?.code === "UNAUTHORIZED";
  useEffect(() => {
    if (accessDenied) {
      setDenied(true);
      // Period totals are private in every cached month, not just the selected filter.
      queryClient.removeQueries({
        queryKey: getQueryKey(api.admin.periodSummary, undefined, "query"),
      });
    } else if (summary.isSuccess && !summary.isFetching) setDenied(false);
  }, [accessDenied, summary.isSuccess, summary.isFetching, queryClient]);
  const hidden = denied || accessDenied;
  const section = t("admin.summary.title");
  const scope = hidden ? undefined : summary.data?.scope.label;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{t("admin.summary.title")}</h1>
          <p className="muted mt-1 text-sm">
            {scope
              ? t("admin.summary.scope", { label: scope })
              : t("admin.summary.subtitleMonthly")}
          </p>
        </div>
        <FilterToolbar label={t("admin.summary.monthLabel")}>
          <label className="muted self-center text-sm" htmlFor="summary-month">
            {t("admin.summary.monthLabel")}
          </label>
          <input
            id="summary-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            // Native input padding otherwise overrides the compact toolbar size.
            className="input control-compact w-[10rem] max-w-full lg:min-h-8 lg:py-1"
          />
          {month && (
            <Button variant="ghost" size="compact" onClick={() => setMonth("")}>
              {t("admin.summary.clearMonth")}
            </Button>
          )}
          <Link href="/admin/history" className="btn-secondary control-compact">
            {t("admin.summary.viewHistory")}
          </Link>
        </FilterToolbar>
      </div>

      {hidden ? (
        <StatePanel
          kind="denied"
          title={t("managementRecovery.denied", { section })}
          action={
            <Button
              size="compact"
              disabled={summary.isFetching}
              onClick={() => void summary.refetch()}
            >
              {t("managementRecovery.retry", { section })}
            </Button>
          }
        />
      ) : (
        <QueryFeedback
          hasData={summary.data !== undefined}
          loading={summary.data === undefined && !summary.error}
          error={!!summary.error}
          retrying={summary.isFetching}
          loadingTitle={t("managementRecovery.loading", { section })}
          errorTitle={t(
            summary.data === undefined
              ? "managementRecovery.loadFailed"
              : "managementRecovery.refreshFailed",
            { section },
          )}
          retryLabel={t("managementRecovery.retry", { section })}
          onRetry={() => void summary.refetch()}
        />
      )}
      {!hidden && summary.data && (
        <div className="card">
          <SummaryTable label={t("admin.summary.title")}>
            <thead>
              <tr>
                <th>{t("admin.summary.columns.tutor")}</th>
                <th className="text-right">
                  {t("admin.summary.columns.sessions")}
                </th>
                <th className="text-right">
                  {t("admin.summary.columns.total")}
                </th>
                <th className="table-actions-heading">
                  {t("tablePatterns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(summary.data?.rows ?? []).map((r) => (
                <tr
                  key={r.tutorId}
                  className={r.active ? "" : "text-slate-400"}
                >
                  <td>
                    {r.englishName}
                    {!r.active && ` ${t("admin.summary.inactive")}`}
                  </td>
                  <td className="text-right">{r.sessions}</td>
                  <td className="text-right font-semibold">
                    {r.total.toFixed(1)}
                  </td>
                  <TableActions>
                    <TableDetails title={r.englishName}>
                      <dl className="grid grid-cols-2 gap-3">
                        <dt>{t("admin.summary.columns.sessions")}</dt>
                        <dd>{r.sessions}</dd>
                        <dt>{t("admin.summary.columns.earned")}</dt>
                        <dd>{r.earned.toFixed(1)}</dd>
                        <dt>{t("admin.summary.columns.extras")}</dt>
                        <dd>{r.extras.toFixed(1)}</dd>
                        <dt>{t("admin.summary.columns.penalties")}</dt>
                        <dd>{r.punishments.toFixed(1)}</dd>
                        <dt>{t("admin.summary.columns.total")}</dt>
                        <dd className="font-semibold">{r.total.toFixed(1)}</dd>
                      </dl>
                    </TableDetails>
                  </TableActions>
                </tr>
              ))}
            </tbody>
          </SummaryTable>
        </div>
      )}
      {!hidden && summary.data && (
        <ServiceHoursComparison rows={summary.data.rows} />
      )}
    </div>
  );
}
