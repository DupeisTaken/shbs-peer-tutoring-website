"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "~/trpc/react";
import { schoolHoursVisibleRows } from "~/lib/school-hours-visibility";
import { schoolHoursPriorEditions } from "~/lib/school-hours-corrections";
import {
  formatSchoolHours as hours,
  schoolHoursApproximation,
} from "~/lib/school-hours-format";
import { programDateKey } from "~/lib/program-time";
import { useReadOnly } from "./read-only";
import { Button } from "./ui/button";
import { DisclosureSection } from "./ui/disclosure-section";
import { StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { SectionTabs } from "./ui/section-tabs";
import { SummaryTable, TableActions, TableDetails } from "./ui/summary-table";

export type SchoolPreview = RouterOutputs["schoolHours"]["preview"];
export type SchoolHoursRow = SchoolPreview["rows"][number];
type View = "report" | "html" | "text";
export const schoolHoursDenied = (
  error: { data?: { code?: string } | null } | null | undefined,
) => error?.data?.code === "FORBIDDEN" || error?.data?.code === "UNAUTHORIZED";

/** Keep the exact posting value visible. Source-only summaries may instead use
 * the existing evidence dialog, with the exact value also in screen-reader text. */
export function SchoolHoursValue({
  value,
  signed = false,
  sourceSummary = false,
}: {
  value: number;
  signed?: boolean;
  sourceSummary?: boolean;
}) {
  const t = useTranslations("schoolHours");
  const exact = hours(value, signed);
  const approximation = schoolHoursApproximation(value, signed);
  if (approximation === null) return <>{exact}</>;
  const exactLabel = t("exactHours", { hours: exact });
  const approximateLabel = t("approximateHours", { hours: approximation });
  return sourceSummary ? (
    <span title={exactLabel}>
      {approximateLabel}
      <span className="sr-only">{`; ${exactLabel}`}</span>
    </span>
  ) : (
    <>
      <span className="block">{approximateLabel}</span>
      <span className="block text-xs font-normal [overflow-wrap:anywhere]">
        {exactLabel}
      </span>
    </>
  );
}

/** The highlighted incremental instruction belongs to this individual only.
 * Tutoring/Crew explain it; optional aggregate statistics never award credit. */
export function SchoolHoursIndividuals({
  rows: allRows,
  revision,
  includeStatistics = false,
  showEvidence = true,
}: {
  rows: SchoolHoursRow[];
  revision: number;
  includeStatistics?: boolean;
  showEvidence?: boolean;
}) {
  const t = useTranslations("schoolHours");
  const rows = schoolHoursVisibleRows({ revision, rows: allRows });
  const amount = (row: SchoolHoursRow) => (
    <>
      <SchoolHoursValue value={row.hoursToAdd} signed />
      {revision > 1 && (
        <>
          <span className="block text-xs font-normal text-slate-700">
            {t("priorEditionCorrection", {
              revision: revision - 1,
              hours: hours(row.hoursToAdd, true),
            })}
          </span>
          <span className="block text-xs font-normal text-slate-700">
            {t("correctedMonth", {
              hours: hours(row.monthAmount, true),
            })}
          </span>
          {row.unchanged && (
            <span className="block text-xs font-normal text-slate-700">
              {t("unchanged")}
            </span>
          )}
        </>
      )}
    </>
  );
  const details = (row: SchoolHoursRow) => (
    <TableDetails title={row.exportName}>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <dt>{t("schoolAccount")}</dt>
        <dd>{row.schoolAccountKey}</dd>
        <dt>{t("earnedChange")}</dt>
        <dd>{hours(row.change.earned, true)}</dd>
        <dt>{t("extrasChange")}</dt>
        <dd>{hours(row.change.extras, true)}</dd>
        <dt>{t("deductionsChange")}</dt>
        <dd>{hours(row.change.deductions, true)}</dd>
        <dt>{t("crewChange")}</dt>
        <dd>{hours(row.crewChange, true)}</dd>
        <dt>{t("amountToApply")}</dt>
        <dd className="font-semibold">{hours(row.hoursToAdd, true)}</dd>
        {revision > 1 && (
          <>
            <dt>{t("previousEdition")}</dt>
            <dd>
              {row.previousEditionAmount === null
                ? t("none")
                : hours(row.previousEditionAmount, true)}
            </dd>
            <dt>{t("correctedMonthLabel")}</dt>
            <dd>{hours(row.monthAmount, true)}</dd>
          </>
        )}
      </dl>
    </TableDetails>
  );
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm text-slate-700">
        {t(revision > 1 ? "revisionInstructions" : "applyInstructions")}
      </p>
      {/* Keep the person and exact credit together on narrow screens, where
          a sticky table action can otherwise cover the amount being applied. */}
      <ul
        aria-label={t("individualAmounts")}
        role="list"
        className="space-y-3 sm:hidden print:hidden"
      >
        {rows.map((row) => (
          <li
            key={row.beneficiaryId}
            className="min-w-0 space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm [overflow-wrap:anywhere]"
          >
            <div>
              <p className="font-medium">{row.exportName}</p>
              <p className="muted mt-1 text-xs">
                {t("schoolAccount")}: {row.schoolAccountKey}
              </p>
            </div>
            <dl className="bg-accent-50 text-accent-700 rounded-md p-3">
              <dt className="text-xs font-medium">{t("amountToApply")}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">
                {amount(row)}
              </dd>
            </dl>
            <dl className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <dt className="muted text-xs">{t("tutoring")}</dt>
                <dd className="mt-1 tabular-nums">
                  <SchoolHoursValue value={row.tutoringChange} signed />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="muted text-xs">{t("crew")}</dt>
                <dd className="mt-1 tabular-nums">
                  <SchoolHoursValue value={row.crewChange} signed />
                </dd>
              </div>
            </dl>
            {showEvidence && <div className="text-right">{details(row)}</div>}
          </li>
        ))}
      </ul>
      <div className="hidden sm:block print:block">
        <SummaryTable sortable label={t("individualAmounts")}>
          <thead>
            <tr>
              <th>{t("individual")}</th>
              <th className="text-right">{t("amountToApply")}</th>
              <th className="text-right">{t("tutoring")}</th>
              <th className="text-right">{t("crew")}</th>
              {showEvidence && (
                <th className="table-actions-heading">{t("details")}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.beneficiaryId}>
                <td data-sort-value={row.exportName}>
                  <span className="font-medium">{row.exportName}</span>
                  <span className="muted block text-xs [overflow-wrap:anywhere]">
                    {t("schoolAccount")}: {row.schoolAccountKey}
                  </span>
                </td>
                <td
                  className="bg-accent-50 text-accent-700 text-right font-semibold tabular-nums"
                  data-sort-value={row.hoursToAdd}
                >
                  {amount(row)}
                </td>
                <td
                  className="text-right tabular-nums"
                  data-sort-value={row.tutoringChange}
                >
                  <SchoolHoursValue value={row.tutoringChange} signed />
                </td>
                <td
                  className="text-right tabular-nums"
                  data-sort-value={row.crewChange}
                >
                  <SchoolHoursValue value={row.crewChange} signed />
                </td>
                {showEvidence && <TableActions>{details(row)}</TableActions>}
              </tr>
            ))}
          </tbody>
        </SummaryTable>
      </div>
      {rows.length === 0 && <p className="muted text-sm">{t("noChanges")}</p>}
      <DisclosureSection title={t("comparisons")} lifetime="lazy">
        <p className="muted mb-3 text-sm">{t("comparisonHelp")}</p>
        <SummaryTable label={t("comparisons")}>
          <thead>
            <tr>
              <th>{t("individual")}</th>
              <th className="text-right">{t("previousMonth")}</th>
              <th className="text-right">{t("correctedMonthLabel")}</th>
              <th className="text-right">{t("monthDifference")}</th>
              <th className="text-right">{t("editionCorrection")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.beneficiaryId}>
                <td>{row.exportName}</td>
                <td className="text-right tabular-nums">
                  {row.previousMonthAmount === null
                    ? t("none")
                    : hours(row.previousMonthAmount, true)}
                </td>
                <td className="text-right tabular-nums">
                  {hours(row.monthAmount, true)}
                </td>
                <td className="text-right tabular-nums">
                  {row.monthComparison === null
                    ? t("none")
                    : hours(row.monthComparison, true)}
                </td>
                <td className="text-right tabular-nums">
                  {revision > 1 ? hours(row.hoursToAdd, true) : t("none")}
                </td>
              </tr>
            ))}
          </tbody>
        </SummaryTable>
        {revision > 1 &&
          rows.map((row) => {
            const editions = schoolHoursPriorEditions(row, revision);
            return (
              editions.length > 0 && (
                <div key={row.beneficiaryId} className="mt-3">
                  <DisclosureSection title={row.exportName} lifetime="lazy">
                    <p className="mb-3 text-sm">{t("priorEditionHelp")}</p>
                    <ul className="list-disc space-y-2 pl-5 text-sm">
                      {editions.map((edition) => (
                        <li key={edition.revision}>
                          {t("priorEditionCorrection", {
                            revision: edition.revision,
                            hours: hours(edition.correctionToCurrent, true),
                          })}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-sm font-semibold">
                      {t("correctedMonth", {
                        hours: hours(row.monthAmount, true),
                      })}
                    </p>
                  </DisclosureSection>
                </div>
              )
            );
          })}
      </DisclosureSection>
      {includeStatistics && (
        <DisclosureSection title={t("statistics")} lifetime="lazy">
          <p className="text-sm">
            {t("statisticsValue", {
              count: rows.length,
              hours: hours(
                rows.reduce((sum, row) => sum + row.hoursToAdd, 0),
                true,
              ),
            })}
          </p>
          <p className="muted mt-2 text-sm">{t("statisticsHelp")}</p>
        </DisclosureSection>
      )}
    </div>
  );
}

export function SchoolHoursBlockers({
  blockers,
  participants,
}: {
  blockers: SchoolPreview["blockers"];
  participants: ReadonlyArray<{ beneficiaryId: string; exportName: string }>;
}) {
  const t = useTranslations("schoolHours");
  if (!blockers.length) return null;
  const names = new Map(
    participants
      .filter((person) => person.exportName.trim().length > 0)
      .map((person) => [person.beneficiaryId, person.exportName.trim()]),
  );
  return (
    <StatePanel kind="error" title={t("blocked")}>
      <ul className="list-disc space-y-2 pl-5">
        {blockers.map((blocker, index) => (
          <li key={`${blocker.code}:${blocker.beneficiaryId ?? index}`}>
            {t.has(`blockers.${blocker.code}`)
              ? t(`blockers.${blocker.code}`)
              : blocker.message}
            {blocker.beneficiaryId && (
              <span className="block text-xs">
                {names.get(blocker.beneficiaryId) ?? blocker.beneficiaryId}
              </span>
            )}
          </li>
        ))}
      </ul>
    </StatePanel>
  );
}

export function SchoolHoursPreview({ preview }: { preview: SchoolPreview }) {
  const t = useTranslations("schoolHours");
  const format = useFormatter();
  const [view, setView] = useState<View>("report");
  return (
    <div className="min-w-0 space-y-4">
      <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        {t("previewOnly")}
      </p>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="muted">{t("reportMonth")}</dt>
          <dd>{preview.month}</dd>
        </div>
        <div>
          <dt className="muted">{t("revision")}</dt>
          <dd>{preview.revision}</dd>
        </div>
        <div>
          <dt className="muted">{t("generatedAt")}</dt>
          <dd>
            {format.dateTime(preview.generatedAt, {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: preview.timeZone,
            })}
          </dd>
        </div>
        <div>
          <dt className="muted">{t("zone")}</dt>
          <dd className="[overflow-wrap:anywhere]">{preview.timeZone}</dd>
        </div>
      </dl>
      <SchoolHoursBlockers
        blockers={preview.blockers}
        participants={preview.rows}
      />
      <SectionTabs<View>
        label={t("previewViews")}
        items={[
          { value: "report", label: t("schoolReport") },
          { value: "html", label: t("emailHtml") },
          { value: "text", label: t("plainText") },
        ]}
        value={view}
        onChange={setView}
      >
        {view === "report" ? (
          <SchoolHoursIndividuals
            rows={preview.rows}
            revision={preview.revision}
            includeStatistics={preview.includeStatistics}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm [overflow-wrap:anywhere]">
              <strong>{t("subject")}: </strong>
              {preview.email.subject}
            </p>
            {view === "html" ? (
              <iframe
                title={t("emailPreview")}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={preview.email.html}
                className="h-[32rem] w-full rounded-lg border border-slate-200 bg-white"
              />
            ) : (
              <pre className="max-h-[36rem] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                {preview.email.text}
              </pre>
            )}
          </div>
        )}
      </SectionTabs>
    </div>
  );
}

export function ProgramSchoolHoursPreview({
  denied = false,
}: {
  denied?: boolean;
}) {
  const t = useTranslations("schoolHours");
  const readOnly = useReadOnly();
  return readOnly ? null : (
    <DisclosureSection title={t("emailPreview")} lifetime="retained">
      <ReadSchoolPreview parentDenied={denied} />
    </DisclosureSection>
  );
}

function ReadSchoolPreview({ parentDenied }: { parentDenied: boolean }) {
  const t = useTranslations("schoolHours");
  const client = useQueryClient();
  const [denied, setDenied] = useState(false);
  const [month, setMonth] = useState("");
  const [requested, setRequested] = useState("");
  const [initialized, setInitialized] = useState(false);
  const settings = api.schoolHours.settings.useQuery(undefined, {
    enabled: !denied && !parentDenied,
  });
  const preview = api.schoolHours.preview.useQuery(
    { month: requested || month },
    {
      enabled: !!requested && !denied && !parentDenied,
      retry: false,
      staleTime: 0,
    },
  );
  const accessDenied =
    parentDenied ||
    schoolHoursDenied(settings.error) ||
    schoolHoursDenied(preview.error);
  const hidden = denied || accessDenied;
  const readGeneration = useRef(0);
  // A retry cannot restore access after a newer denial from another read.
  useLayoutEffect(() => {
    if (accessDenied) readGeneration.current += 1;
  }, [accessDenied, settings.error, preview.error]);
  useLayoutEffect(
    () => () => {
      readGeneration.current += 1;
    },
    [],
  );
  // Keep denial latched until an explicit successful read; cached/late data
  // cannot restore the previous private preview request.
  if (accessDenied && !denied) {
    setDenied(true);
    setRequested("");
  }
  useEffect(() => {
    if (hidden)
      client.removeQueries({ queryKey: getQueryKey(api.schoolHours) });
  }, [hidden, client]);
  if (!hidden && settings.data && !initialized) {
    setMonth(programDateKey(new Date(), settings.data.config.timeZone).slice(0, 7));
    setInitialized(true);
  }
  const retryRead = async () => {
    const started = readGeneration.current;
    const result = await settings.refetch();
    if (started === readGeneration.current && result.isSuccess && result.data)
      setDenied(false);
  };
  const data = hidden ? undefined : settings.data;
  const snapshot =
    data &&
    requested === month &&
    preview.data?.configVersion === data.config.version &&
    preview.data.baselineVersion === data.config.baselineVersion &&
    preview.data.expectedHeadId === data.headReportId
      ? preview.data
      : undefined;
  return (
    <div className="space-y-4">
      {hidden ? (
        <StatePanel
          kind="denied"
          title={t("denied")}
          action={
            <Button
              disabled={settings.isFetching || parentDenied}
              onClick={() => void retryRead()}
            >
              {t("retryRead")}
            </Button>
          }
        />
      ) : (
        <>
          <p className="muted text-sm">{t("previewHelp")}</p>
          <QueryFeedback
            hasData={!!data}
            loading={!data && !settings.error}
            error={!!settings.error}
            retrying={settings.isFetching}
            loadingTitle={t("loading")}
            errorTitle={t(data ? "refreshFailed" : "loadFailed")}
            retryLabel={t("retryRead")}
            onRetry={() => void retryRead()}
          />
          {data && (
            <>
              {!data.serviceHoursEnabled && (
                <p className="text-sm text-amber-800">{t("featureOff")}</p>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-sm">
                  <span className="block">{t("reportMonth")}</span>
                  <input
                    type="month"
                    className="input control-compact max-w-full lg:min-h-8 lg:py-1"
                    value={month}
                    onChange={(event) => {
                      setMonth(event.target.value);
                      setRequested("");
                    }}
                  />
                </label>
                <Button
                  size="compact"
                  disabled={
                    !month ||
                    !!settings.error ||
                    settings.isFetching ||
                    preview.isFetching ||
                    !data.serviceHoursEnabled
                  }
                  onClick={() => {
                    setRequested(month);
                    if (requested === month) void preview.refetch();
                  }}
                >
                  {t("preview")}
                </Button>
              </div>
              {requested && (
                <QueryFeedback
                  hasData={!!snapshot}
                  loading={!snapshot && preview.isFetching}
                  error={!!preview.error}
                  retrying={preview.isFetching}
                  loadingTitle={t("loading")}
                  errorTitle={t("previewFailed")}
                  retryLabel={t("retryRead")}
                  onRetry={() => void preview.refetch()}
                />
              )}
              {snapshot && <SchoolHoursPreview preview={snapshot} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
