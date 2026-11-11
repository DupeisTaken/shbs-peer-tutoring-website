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
  formatSchoolHoursCarryMinutes,
  schoolHoursApproximation,
  schoolHoursRoundedDuration,
} from "~/lib/school-hours-format";
import { programDateKey } from "~/lib/program-time";
import { useReadOnly } from "./read-only";
import { Button } from "./ui/button";
import { DisclosureSection } from "./ui/disclosure-section";
import { InlineNotice, StatePanel } from "./ui/patterns";
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

/** Keep the summary focused on amounts, with posting rules and exact evidence
 * in Details. Revised reports retain their last-applied-edition safeguard. */
export function SchoolHoursIndividuals({
  rows: allRows,
  revision,
  includeStatistics = false,
  showEvidence = true,
  postingPolicy,
}: {
  rows: SchoolHoursRow[];
  revision: number;
  includeStatistics?: boolean;
  showEvidence?: boolean;
  postingPolicy?: "TENTH_HOUR_CARRY" | "TENTH_HOUR_CARRY_NONNEGATIVE";
}) {
  const t = useTranslations("schoolHours");
  const nonnegativePolicy = postingPolicy === "TENTH_HOUR_CARRY_NONNEGATIVE";
  const carryPolicy = postingPolicy === "TENTH_HOUR_CARRY" || nonnegativePolicy;
  const carry = (value: string | undefined) =>
    !carryPolicy ? (
      <span aria-label={t("carryUnavailable")} title={t("carryUnavailable")}>
        —
      </span>
    ) : value === undefined ? (
      t("none")
    ) : (
      <span title={t("exactCarryHours", { hours: value })}>
        {t("carryMinutes", { minutes: formatSchoolHoursCarryMinutes(value) })}
        <span className="sr-only">{`; ${t("exactCarryHours", { hours: value })}`}</span>
      </span>
    );
  const rows = schoolHoursVisibleRows({ revision, rows: allRows });
  const rawChange = (row: SchoolHoursRow) => (
    <span className="whitespace-nowrap" title={t("rawChangeHelp")}>
      {t(
        "rawChangeDuration",
        schoolHoursRoundedDuration(row.tutoringChange + row.crewChange, true),
      )}
    </span>
  );
  const sourceEvidence = (value: number) => (
    <>
      {t("rawChangeDuration", schoolHoursRoundedDuration(value, true))}
      <span className="block text-xs text-slate-700">
        {t("exactHours", { hours: hours(value, true) })}
      </span>
    </>
  );
  const amount = (row: SchoolHoursRow) =>
    row.hoursToAdd === 0 ? (
      <span
        className="text-slate-700"
        aria-label={t("zeroAmount")}
        title={t("zeroAmount")}
      >
        —
      </span>
    ) : (
      <>
        <SchoolHoursValue value={row.hoursToAdd} signed />
        {revision > 1 && (
          <span className="mt-1 block text-xs font-normal text-slate-700">
            {t("revisionAmountCondition", { revision: revision - 1 })}
          </span>
        )}
      </>
    );
  const details = (row: SchoolHoursRow) => {
    const editions = schoolHoursPriorEditions(row, revision);
    return (
      <TableDetails title={row.exportName} longReader>
        {revision === 1 && (
          <p className="text-sm text-slate-700">
            {t(
              nonnegativePolicy
                ? "nonnegativeApplyInstructions"
                : carryPolicy
                  ? "carryApplyInstructions"
                  : "applyInstructions",
            )}
          </p>
        )}
        {carryPolicy && (
          <p className="text-sm text-slate-700">
            {t(
              nonnegativePolicy
                ? "nonnegativeCarryPolicyNotice"
                : "carryPolicyNotice",
            )}{" "}
            {t("carryReconciliation")}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt>{t("schoolAccount")}</dt>
          <dd>{row.schoolAccountKey}</dd>
          <dt>{t("rawChange")}</dt>
          <dd>{sourceEvidence(row.tutoringChange + row.crewChange)}</dd>
          <dt>{t(carryPolicy ? "rawTutoring" : "tutoring")}</dt>
          <dd>{sourceEvidence(row.tutoringChange)}</dd>
          <dt>{t("earnedChange")}</dt>
          <dd>{hours(row.change.earned, true)}</dd>
          <dt>{t("extrasChange")}</dt>
          <dd>{hours(row.change.extras, true)}</dd>
          <dt>{t("deductionsChange")}</dt>
          <dd>{hours(row.change.deductions, true)}</dd>
          <dt>{t(carryPolicy ? "rawCrew" : "crewChange")}</dt>
          <dd>{sourceEvidence(row.crewChange)}</dd>
          {carryPolicy && (
            <>
              <dt>{t("carryIn")}</dt>
              <dd>{carry(row.carryInHours)}</dd>
              <dt>{t("carryOut")}</dt>
              <dd>{carry(row.carryOutHours)}</dd>
            </>
          )}
          <dt>{t("hours")}</dt>
          <dd className="font-semibold">{hours(row.hoursToAdd, true)}</dd>
          <dt>{t("previousMonth")}</dt>
          <dd>
            {row.previousMonthAmount === null
              ? t("none")
              : hours(row.previousMonthAmount, true)}
          </dd>
          <dt>{t("correctedMonthLabel")}</dt>
          <dd>{hours(row.monthAmount, true)}</dd>
          <dt>{t("monthDifference")}</dt>
          <dd>
            {row.monthComparison === null
              ? t("none")
              : hours(row.monthComparison, true)}
          </dd>
          {revision > 1 && (
            <>
              <dt>{t("previousEdition")}</dt>
              <dd>
                {row.previousEditionAmount === null
                  ? t("none")
                  : hours(row.previousEditionAmount, true)}
              </dd>
            </>
          )}
        </dl>
        <p className="text-sm text-slate-700">{t("comparisonHelp")}</p>
        {revision > 1 && (
          <section className="space-y-3" aria-label={t("comparisons")}>
            <p>{t("priorEditionHelp")}</p>
            {row.unchanged && <p>{t("unchanged")}</p>}
            {editions.length > 0 && (
              <ul className="list-disc space-y-2 pl-5">
                {editions.map((edition) => (
                  <li key={edition.revision}>
                    {t(
                      nonnegativePolicy
                        ? "priorEditionComparison"
                        : "priorEditionCorrection",
                      {
                        revision: edition.revision,
                        hours: hours(edition.correctionToCurrent, true),
                      },
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="font-semibold">
              {t("correctedMonth", { hours: hours(row.monthAmount, true) })}
            </p>
          </section>
        )}
      </TableDetails>
    );
  };
  return (
    <div className="min-w-0 space-y-3">
      {revision > 1 && (
        <p className="text-sm text-slate-700">
          {t(
            nonnegativePolicy
              ? "nonnegativeRevisionInstructions"
              : "revisionInstructions",
          )}
        </p>
      )}
      {!carryPolicy && (
        <p className="text-xs text-slate-700">{t("carryUnavailable")}</p>
      )}
      <p className="text-xs text-slate-700">
        <span>{t("rawChangeHelp")}</span> <span>{t("hoursDashLegend")}</span>
      </p>
      {/* Both responsive views preserve the same reconciliation order. */}
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
            <p className="font-medium">{row.exportName}</p>
            <dl className="grid grid-cols-2 gap-3">
              <div className="min-w-0 p-3">
                <dt className="text-xs text-slate-700">{t("carryIn")}</dt>
                <dd className="mt-1 tabular-nums">{carry(row.carryInHours)}</dd>
              </div>
              <div className="min-w-0 p-3">
                <dt className="text-xs text-slate-700">{t("rawChange")}</dt>
                <dd className="mt-1 tabular-nums">{rawChange(row)}</dd>
              </div>
              <div className="bg-accent-50 text-accent-700 min-w-0 rounded-md p-3">
                <dt className="text-xs font-medium">{t("hours")}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {amount(row)}
                </dd>
              </div>
              <div className="min-w-0 p-3">
                <dt className="text-xs text-slate-700">{t("carryOut")}</dt>
                <dd className="mt-1 tabular-nums">
                  {carry(row.carryOutHours)}
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
              <th className="text-right">{t("carryIn")}</th>
              <th className="text-right">{t("rawChange")}</th>
              <th className="text-right">{t("hours")}</th>
              <th className="text-right">{t("carryOut")}</th>
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
                </td>
                <td
                  className="text-right tabular-nums"
                  data-sort-value={
                    carryPolicy ? Number(row.carryInHours) : undefined
                  }
                >
                  {carry(row.carryInHours)}
                </td>
                <td
                  className="text-right tabular-nums"
                  data-sort-value={row.tutoringChange + row.crewChange}
                >
                  {rawChange(row)}
                </td>
                <td
                  className="bg-accent-50 text-accent-700 text-right font-semibold tabular-nums"
                  data-sort-value={row.hoursToAdd}
                >
                  {amount(row)}
                </td>
                <td
                  className="text-right tabular-nums"
                  data-sort-value={
                    carryPolicy ? Number(row.carryOutHours) : undefined
                  }
                >
                  {carry(row.carryOutHours)}
                </td>
                {showEvidence && <TableActions>{details(row)}</TableActions>}
              </tr>
            ))}
          </tbody>
        </SummaryTable>
      </div>
      {rows.length === 0 && <p className="muted text-sm">{t("noChanges")}</p>}
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
  const groups = new Map<
    string,
    { blocker: SchoolPreview["blockers"][number]; people: Set<string> }
  >();
  for (const blocker of blockers) {
    const key = `${blocker.code}:${t.has(`blockers.${blocker.code}`) ? "" : blocker.message}`;
    const group = groups.get(key) ?? { blocker, people: new Set<string>() };
    if (blocker.beneficiaryId) group.people.add(blocker.beneficiaryId);
    groups.set(key, group);
  }
  const openingOnly = blockers.every(
    (blocker) =>
      blocker.code === "BASELINE_REQUIRED" ||
      blocker.code === "OPENING_NOT_REVIEWED",
  );
  return (
    <InlineNotice tone={openingOnly ? "warning" : "error"}>
      <p className="mb-2 font-semibold">
        {t(openingOnly ? "baselineSetupRequired" : "blocked")}
      </p>
      <ul className="list-disc space-y-2 pl-5">
        {[...groups].map(([key, { blocker, people }]) => (
          <li key={key}>
            {t.has(`blockers.${blocker.code}`)
              ? t(`blockers.${blocker.code}`)
              : blocker.message}
            {people.size === 1 && (
              <span className="block text-xs">
                {names.get([...people][0]!) ?? [...people][0]}
              </span>
            )}
            {people.size > 1 && (
              <DisclosureSection
                title={t("affectedPeople", { count: people.size })}
                lifetime="lazy"
              >
                <ul className="space-y-1 text-sm">
                  {[...people].map((id) => (
                    <li key={id}>{names.get(id) ?? id}</li>
                  ))}
                </ul>
              </DisclosureSection>
            )}
          </li>
        ))}
      </ul>
    </InlineNotice>
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
      {preview.archivedSourceCount > 0 && (
        <InlineNotice>
          {t("archivedSources", { count: preview.archivedSourceCount })}
        </InlineNotice>
      )}
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
            postingPolicy={preview.postingPolicy}
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
    setMonth(
      programDateKey(new Date(), settings.data.config.timeZone).slice(0, 7),
    );
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
