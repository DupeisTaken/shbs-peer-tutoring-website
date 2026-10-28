"use client";
import {
  useSessionViewState,
  useSessionPageScroll,
} from "~/app/_components/session-view-state";
import { viewMonth } from "~/lib/management-view-state";
import {
  HOURS_SORT_KEYS,
  hasServiceHoursRecords,
  initialServiceHoursView,
  selectServiceHoursRows,
  serviceHoursSubtotal,
  serviceHoursViewParser,
  type HoursSortKey,
  type ServiceHoursView,
} from "~/lib/service-hours-view";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useLocale, useTranslations } from "next-intl";

import { api } from "~/trpc/react";
import { Button } from "~/app/_components/ui/button";
import { FilterToolbar, StatePanel } from "~/app/_components/ui/patterns";
import { QueryFeedback } from "~/app/_components/ui/query-feedback";
import { SectionTabs } from "~/app/_components/ui/section-tabs";
import { nextSort, type Sort } from "~/app/_components/sortable";
import { ServiceHoursComparison } from "~/app/_components/service-hours-comparison";

export default function SummaryPage() {
  const t = useTranslations();
  const locale = useLocale();
  // Empty selects the active period's semester; a month ("YYYY-MM") narrows it.
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const [month, setMonth] = useSessionViewState({
    id: "service-hours-month-v1",
    initialState: "",
    parse: viewMonth,
    enabled: !denied,
  });
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
  const [view, setView] = useSessionViewState({
    id: "service-hours-roster-v1",
    initialState: initialServiceHoursView,
    parse: serviceHoursViewParser,
    enabled: !hidden,
  });
  const rows = hidden ? [] : (summary.data?.rows ?? []);
  const selected = selectServiceHoursRows(rows, view, locale);
  const subtotal = serviceHoursSubtotal(selected);
  const hiddenInactive =
    view.status === "active"
      ? rows.filter((row) => !row.active && hasServiceHoursRecords(row)).length
      : 0;
  const sort: Sort = {
    key: view.sortKey,
    dir: view.sortDir,
    toggle: (key) => {
      if (!HOURS_SORT_KEYS.includes(key as HoursSortKey)) return;
      setView((before) => {
        const next = nextSort(
          { key: before.sortKey, dir: before.sortDir },
          key,
        );
        return {
          ...before,
          sortKey: next.key as HoursSortKey,
          sortDir: next.dir,
        };
      });
    },
  };
  const updateView = (patch: Partial<ServiceHoursView>) =>
    setView((before) => ({ ...before, ...patch }));
  const section = t("admin.summary.title");
  const scope = hidden ? undefined : summary.data?.scope.label;
  useSessionPageScroll({
    id: "service-hours-v1",
    scope: JSON.stringify([
      month || (scope ?? ""),
      view.status,
      view.activity,
      view.panel,
      view.sortKey,
      view.sortDir,
    ]),
    ready: summary.data !== undefined && !hidden,
    enabled: !hidden,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{t("admin.summary.title")}</h1>
          <p className="muted mt-1 text-sm">
            {scope
              ? t("admin.summary.selectedPeriod", { label: scope })
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
        <>
          <section
            className="card space-y-3 p-4 sm:p-5"
            aria-label={t("admin.summary.programTotals")}
          >
            <h2 className="section-title">
              {t("admin.summary.programTotals")}
            </h2>
            <p className="muted text-sm">
              {t("admin.summary.programTotalsHelp")}
            </p>
            <HoursTotals totals={summary.data.totals} />
          </section>
          <div className="card space-y-4 p-4 sm:p-5">
            <FilterToolbar
              label={t("admin.summary.filtersLabel")}
              summary={
                <span role="status">
                  {t("admin.summary.resultCount", {
                    count: selected.length,
                    total: rows.length,
                  })}
                </span>
              }
              actions={
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() =>
                    updateView({
                      status: "active",
                      activity: "all",
                      search: "",
                    })
                  }
                >
                  {t("admin.summary.resetFilters")}
                </Button>
              }
            >
              <label className="min-w-0 space-y-1 text-sm">
                <span className="block">{t("admin.summary.statusLabel")}</span>
                <select
                  className="input control-compact w-full lg:min-h-8 lg:py-1"
                  value={view.status}
                  onChange={(event) =>
                    updateView({
                      status: event.target.value as ServiceHoursView["status"],
                    })
                  }
                >
                  <option value="active">
                    {t("admin.summary.statusActive")}
                  </option>
                  <option value="inactive">
                    {t("admin.summary.statusInactive")}
                  </option>
                  <option value="all">{t("admin.summary.statusAll")}</option>
                </select>
              </label>
              <label className="min-w-0 space-y-1 text-sm">
                <span className="block">
                  {t("admin.summary.activityLabel")}
                </span>
                <select
                  className="input control-compact w-full lg:min-h-8 lg:py-1"
                  aria-describedby="hours-activity-help"
                  value={view.activity}
                  onChange={(event) =>
                    updateView({
                      activity: event.target
                        .value as ServiceHoursView["activity"],
                    })
                  }
                >
                  <option value="all">{t("admin.summary.activityAll")}</option>
                  <option value="records">
                    {t("admin.summary.activityRecords")}
                  </option>
                  <option value="none">
                    {t("admin.summary.activityNone")}
                  </option>
                </select>
              </label>
              <label className="min-w-0 flex-1 basis-48 space-y-1 text-sm">
                <span className="block">{t("admin.summary.searchLabel")}</span>
                <input
                  type="search"
                  className="input control-compact w-full lg:min-h-8 lg:py-1"
                  value={view.search}
                  onChange={(event) =>
                    updateView({ search: event.target.value })
                  }
                />
              </label>
            </FilterToolbar>
            <p id="hours-activity-help" className="muted text-sm">
              {t("admin.summary.activityHelp")}
            </p>
            {hiddenInactive > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
                <p>
                  {t("admin.summary.hiddenInactive", { count: hiddenInactive })}
                </p>
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() =>
                    updateView({
                      status: "inactive",
                      activity: "records",
                      search: "",
                    })
                  }
                >
                  {t("admin.summary.viewInactive")}
                </Button>
              </div>
            )}
            <section
              className="space-y-2 border-t border-slate-200 pt-4"
              aria-label={t("admin.summary.filteredSubtotal", {
                count: selected.length,
              })}
            >
              <h2 className="text-sm font-semibold">
                {t("admin.summary.filteredSubtotal", {
                  count: selected.length,
                })}
              </h2>
              <HoursTotals totals={subtotal} compact />
            </section>
            <SectionTabs
              label={t("admin.summary.viewLabel")}
              items={[
                { value: "summary", label: t("admin.summary.viewSummary") },
                { value: "breakdown", label: t("admin.summary.viewBreakdown") },
              ]}
              value={view.panel}
              onChange={(panel) => updateView({ panel })}
            >
              {selected.length > 0 ? (
                <ServiceHoursComparison
                  rows={selected}
                  panel={view.panel}
                  sort={sort}
                />
              ) : (
                <StatePanel
                  kind="empty"
                  title={t(
                    rows.length === 0
                      ? "admin.summary.emptyRoster"
                      : "admin.summary.noMatches",
                  )}
                />
              )}
            </SectionTabs>
          </div>
        </>
      )}
    </div>
  );
}

function HoursTotals({
  totals,
  compact = false,
}: {
  totals: {
    earned: number;
    extras: number;
    punishments: number;
    total: number;
  };
  compact?: boolean;
}) {
  const t = useTranslations("admin.summary");
  return (
    <dl
      className={
        compact
          ? "flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
          : "grid grid-cols-2 gap-3 sm:grid-cols-4"
      }
    >
      {(
        [
          ["netHours", totals.total],
          ["columns.earned", totals.earned],
          ["columns.extras", totals.extras],
          ["columns.penalties", totals.punishments],
        ] as const
      ).map(([label, value]) => (
        <div
          key={label}
          className={compact ? "inline-flex items-baseline gap-1" : undefined}
        >
          <dt className="text-sm text-slate-600">{t(label)}</dt>
          <dd
            className={
              !compact
                ? "text-2xl font-semibold text-slate-900 tabular-nums"
                : label === "netHours"
                  ? "text-base font-semibold text-slate-900 tabular-nums"
                  : "font-medium text-slate-700 tabular-nums"
            }
          >
            {value.toFixed(1)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
