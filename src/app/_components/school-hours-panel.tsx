"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { api, type RouterOutputs } from "~/trpc/react";
import { schoolHoursVisibleRows } from "~/lib/school-hours-visibility";
import { queuedApprovalId } from "~/lib/approval-outcome";
import {
  isProgramTimeZone,
  parseProgramDateTime,
  programDateKey,
} from "~/lib/program-time";
import { useReadOnly } from "./read-only";
import { SchoolHoursBaselineEditor } from "./school-hours-baseline";
import { SchoolHoursPreview, schoolHoursDenied } from "./school-hours-preview";
import { MonthlyHoursCounts } from "./monthly-hours-snapshot";
import { useActionReview } from "./ui/action-review";
import { Button } from "./ui/button";
import { DisclosureSection } from "./ui/disclosure-section";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";

type Config = RouterOutputs["schoolHours"]["settings"]["config"];
type Draft = {
  enabled: boolean;
  emails: string;
  timeZone: string;
  includeStatistics: boolean;
  dateOverrides: Record<string, string>;
  version: number;
};
const draftFrom = (config: Config): Draft => ({
  enabled: config.enabled,
  emails: config.recipientEmails.join("\n"),
  timeZone: config.timeZone,
  includeStatistics: config.includeStatistics,
  dateOverrides: { ...config.dateOverrides },
  version: config.version,
});
const recipients = (value: string) => [
  ...new Set(
    value
      .split(/[,;\n]+/)
      .map((email) => email.trim())
      .filter(Boolean),
  ),
];

export function SchoolHoursPanel() {
  const readOnly = useReadOnly();
  return readOnly ? null : <SchoolHoursController />;
}

function SchoolHoursController() {
  const t = useTranslations("schoolHours");
  const approvalText = useTranslations("approvals");
  const format = useFormatter();
  const client = useQueryClient();
  const review = useActionReview();
  const recipientsId = useId();
  const [open, setOpen] = useState(false);
  const [denied, setDenied] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [month, setMonth] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [requested, setRequested] = useState("");
  const [reason, setReason] = useState("");
  const [overrideMonth, setOverrideMonth] = useState("");
  const [formError, setFormError] = useState(false);
  const settings = api.schoolHours.settings.useQuery(undefined, {
    enabled: !denied,
  });
  const baseline = api.schoolHours.baselinePreview.useQuery(undefined, {
    enabled: open && !denied,
    staleTime: 0,
  });
  const preview = api.schoolHours.preview.useQuery(
    { month: requested || month },
    { enabled: !!requested && !denied, retry: false, staleTime: 0 },
  );
  const save = api.schoolHours.save.useMutation();
  const generate = api.schoolHours.generate.useMutation();
  const retry = api.schoolHours.retry.useMutation();
  const accessDenied = [settings.error, baseline.error, preview.error].some(
    schoolHoursDenied,
  );
  const hidden = denied || accessDenied;
  useEffect(() => {
    if (accessDenied) {
      setDenied(true);
      setDraft(null);
      setRequested("");
      setReason("");
      review.revoke();
      client.removeQueries({ queryKey: getQueryKey(api.schoolHours) });
    } else if (settings.isSuccess && !settings.isFetching) setDenied(false);
  }, [
    accessDenied,
    settings.isSuccess,
    settings.isFetching,
    client,
    review.revoke,
  ]);
  useEffect(() => {
    if (!hidden && settings.data) {
      if (!draft) setDraft(draftFrom(settings.data.config));
      if (!initialized) {
        const current = programDateKey(
          new Date(),
          settings.data.config.timeZone,
        ).slice(0, 7);
        setMonth(current);
        setOverrideMonth(current);
        setInitialized(true);
      }
    }
  }, [hidden, settings.data, draft, initialized]);
  const data = hidden ? undefined : settings.data;
  const dirty =
    !!draft &&
    !!data &&
    JSON.stringify(draft) !== JSON.stringify(draftFrom(data.config));
  const stale = !!draft && !!data && draft.version !== data.config.version;
  const blocked =
    !!settings.error ||
    !!baseline.error ||
    settings.isFetching ||
    baseline.isFetching ||
    review.blocked("controls");
  const baselineReviewCount =
    baseline.data?.participants.filter((person) => person.needsReview).length ??
    0;
  const snapshot =
    data &&
    requested === month &&
    !dirty &&
    preview.data?.configVersion === data.config.version &&
    preview.data.baselineVersion === data.config.baselineVersion &&
    preview.data.expectedHeadId === data.headReportId
      ? preview.data
      : undefined;
  const update = (patch: Partial<Draft>) => {
    setDraft((previous) => (previous ? { ...previous, ...patch } : previous));
    setRequested("");
    setFormError(false);
  };
  async function reloadBaseline() {
    const result = await baseline.refetch();
    if (!result.isSuccess || !result.data)
      throw new Error("Baseline read failed");
    return result.data;
  }
  async function refresh(acceptConfig = false) {
    const [fresh, basis] = await Promise.all([
      settings.refetch(),
      baseline.refetch(),
    ]);
    if (!fresh.isSuccess || !fresh.data || !basis.isSuccess || !basis.data)
      throw new Error("School hours refresh failed");
    if (acceptConfig) setDraft(draftFrom(fresh.data.config));
    setRequested("");
    return basis.data;
  }
  function saveDraft() {
    if (!data?.canEdit || !draft || blocked || stale) return;
    try {
      if (!isProgramTimeZone(draft.timeZone))
        throw new Error("Invalid time zone");
      const input = {
        enabled: draft.enabled,
        recipientEmails: recipients(draft.emails),
        timeZone: draft.timeZone,
        includeStatistics: draft.includeStatistics,
        dateOverrides: Object.fromEntries(
          Object.entries(draft.dateOverrides).map(([key, value]) => {
            if (value.slice(0, 7) !== key)
              throw new Error("Override must stay within its month");
            parseProgramDateTime(value, draft.timeZone);
            return [key, value];
          }),
        ),
        expectedVersion: draft.version,
      };
      review.open({
        key: `school-settings:${draft.version}`,
        title: t(data.canApply ? "save" : "requestSave"),
        description: t("saveHelp"),
        confirmLabel: t(data.canApply ? "save" : "requestSave"),
        confirmVariant: "primary",
        approvalId: queuedApprovalId,
        details: (
          <p>{t("recipientCount", { count: input.recipientEmails.length })}</p>
        ),
        commit: () => save.mutateAsync(input),
        refresh: () => refresh(true),
        renderError: () => t("writeFailed"),
      });
    } catch {
      setFormError(true);
    }
  }
  function issue() {
    if (
      !data?.canGenerate ||
      !data.config.enabled ||
      !snapshot ||
      blocked ||
      snapshot.blockers.length ||
      preview.error ||
      preview.isFetching ||
      (snapshot.revision > 1 && !reason.trim())
    )
      return;
    const input = {
      month: snapshot.month,
      expectedVersion: snapshot.configVersion,
      expectedBaselineVersion: snapshot.baselineVersion,
      expectedHeadId: snapshot.expectedHeadId,
      expectedContentHash: snapshot.contentHash,
      requestId: crypto.randomUUID(),
      ...(snapshot.revision > 1 ? { reason: reason.trim() } : {}),
    };
    review.open({
      key: `school-issue:${snapshot.month}:${snapshot.contentHash}:${snapshot.revision}`,
      title: t(snapshot.revision > 1 ? "revise" : "issue"),
      description: t("issueHelp"),
      confirmLabel: t("confirmIssue"),
      confirmVariant: "primary",
      successMessage: t("issued"),
      details: (
        <p>
          {t("issueReview", {
            month: snapshot.month,
            revision: snapshot.revision,
            count: schoolHoursVisibleRows(snapshot).length,
          })}
        </p>
      ),
      commit: () => generate.mutateAsync(input),
      refresh: () => refresh(),
      renderError: () => t("writeFailed"),
    });
  }
  const date = (value: Date | null | undefined, zone: string) =>
    value
      ? format.dateTime(value, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: zone,
        })
      : t("none");
  const title = `${t("title")} · ${data ? `${t(data.config.enabled ? "enabled" : "disabled")} · ${t("recipientCount", { count: data.config.recipientEmails.length })}${data.config.enabled ? ` · ${t("nextSend")}: ${date(data.config.nextDueAt, data.config.timeZone)}` : ""}` : t(hidden ? "denied" : "loading")}`;
  return (
    <DisclosureSection
      title={title}
      lifetime="retained"
      open={open}
      onOpenChange={setOpen}
    >
      {hidden ? (
        <StatePanel
          kind="denied"
          title={t("denied")}
          action={
            <Button
              disabled={settings.isFetching}
              onClick={() => void settings.refetch()}
            >
              {t("retryRead")}
            </Button>
          }
        />
      ) : (
        <>
          <QueryFeedback
            hasData={!!data}
            loading={!data && !settings.error}
            error={!!settings.error}
            retrying={settings.isFetching}
            loadingTitle={t("loading")}
            errorTitle={t(data ? "refreshFailed" : "loadFailed")}
            retryLabel={t("retryRead")}
            onRetry={() => void settings.refetch()}
          />
          {data && draft && (
            <div className="space-y-6">
              <p className="text-sm text-slate-700">{t("help")}</p>
              <QueryFeedback
                hasData={!!baseline.data}
                loading={!baseline.data && !baseline.error}
                error={!!baseline.error}
                retrying={baseline.isFetching}
                loadingTitle={t("loading")}
                errorTitle={t(baseline.data ? "refreshFailed" : "loadFailed")}
                retryLabel={t("retryRead")}
                onRetry={() => void baseline.refetch()}
              />
              {baseline.data && (
                // Keep recurring reporting compact without losing an opened
                // review draft when staff collapse its evidence.
                <DisclosureSection
                  title={`${t("baselineTitle")} · ${t("baselineSummary", {
                    review: baselineReviewCount,
                    committed:
                      baseline.data.participants.length - baselineReviewCount,
                  })}${baseline.data.blockers.length ? ` · ${t("baselineIssues", { count: baseline.data.blockers.length })}` : ""}`}
                  lifetime="retained"
                  defaultOpen={
                    !baseline.data.headReportId ||
                    baselineReviewCount > 0 ||
                    baseline.data.blockers.length > 0
                  }
                >
                  <SchoolHoursBaselineEditor
                    basis={baseline.data}
                    canReview={data.canGenerate}
                    blocked={blocked}
                    review={review}
                    reload={reloadBaseline}
                    refresh={() => refresh()}
                  />
                </DisclosureSection>
              )}
              <form
                className="space-y-3 border-t border-slate-200 pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveDraft();
                }}
              >
                <h3 className="text-sm font-semibold">{t("settings")}</h3>
                {data.canEdit && !data.canApply && (
                  <p className="muted text-sm">
                    {approvalText("sensitiveHelp")}
                  </p>
                )}
                <fieldset
                  disabled={!data.canEdit || blocked}
                  className="space-y-3"
                >
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      disabled={
                        !draft.enabled &&
                        (!data.config.openingReviewedAt ||
                          !data.transportAvailable ||
                          !data.optionalEmailEnabled ||
                          !data.serviceHoursEnabled)
                      }
                      onChange={(event) =>
                        update({ enabled: event.target.checked })
                      }
                    />
                    {t("enable")}
                  </label>
                  {(!data.config.openingReviewedAt ||
                    !data.transportAvailable ||
                    !data.optionalEmailEnabled ||
                    !data.serviceHoursEnabled) && (
                    <p className="text-sm text-amber-800">
                      {t("activationHelp")}
                    </p>
                  )}
                  <div className="space-y-1 text-sm">
                    <label htmlFor={recipientsId} className="block">
                      {t("recipients")}
                    </label>
                    <textarea
                      id={recipientsId}
                      aria-describedby={`${recipientsId}-help`}
                      rows={3}
                      className="input w-full"
                      value={draft.emails}
                      maxLength={16000}
                      onChange={(event) =>
                        update({ emails: event.target.value })
                      }
                    />
                    <p id={`${recipientsId}-help`} className="muted">
                      {t("recipientsHelp")}
                    </p>
                  </div>
                  <label className="block space-y-1 text-sm">
                    <span className="block">{t("zone")}</span>
                    <input
                      className="input w-full"
                      required
                      value={draft.timeZone}
                      onChange={(event) =>
                        update({ timeZone: event.target.value })
                      }
                    />
                  </label>
                  <p className="muted text-sm">{t("scheduleHelp")}</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="space-y-1 text-sm">
                      <span className="block">{t("overrideMonth")}</span>
                      <input
                        type="month"
                        className="input control-compact lg:min-h-8 lg:py-1"
                        value={overrideMonth}
                        onChange={(event) =>
                          setOverrideMonth(event.target.value)
                        }
                      />
                    </label>
                    <Button
                      size="compact"
                      disabled={
                        !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(overrideMonth) ||
                        !!draft.dateOverrides[overrideMonth]
                      }
                      onClick={() => {
                        const year = Number(overrideMonth.slice(0, 4));
                        const selected = Number(overrideMonth.slice(5));
                        const last = new Date(
                          Date.UTC(year, selected, 0),
                        ).getUTCDate();
                        update({
                          dateOverrides: {
                            ...draft.dateOverrides,
                            [overrideMonth]: `${overrideMonth}-${String(last).padStart(2, "0")}T12:00`,
                          },
                        });
                      }}
                    >
                      {t("addOverride")}
                    </Button>
                  </div>
                  {Object.entries(draft.dateOverrides)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([selected, value]) => (
                      <div
                        key={selected}
                        className="flex flex-wrap items-end gap-3"
                      >
                        <label className="min-w-0 flex-1 space-y-1 text-sm">
                          <span className="block">
                            {t("overrideFor", { month: selected })}
                          </span>
                          <input
                            type="datetime-local"
                            className="input max-w-full"
                            min={`${selected}-01T00:00`}
                            max={`${selected}-${String(new Date(Date.UTC(Number(selected.slice(0, 4)), Number(selected.slice(5)), 0)).getUTCDate()).padStart(2, "0")}T23:59`}
                            required
                            value={value}
                            onChange={(event) =>
                              update({
                                dateOverrides: {
                                  ...draft.dateOverrides,
                                  [selected]: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <Button
                          size="compact"
                          variant="ghost"
                          onClick={() => {
                            const next = { ...draft.dateOverrides };
                            delete next[selected];
                            update({ dateOverrides: next });
                          }}
                        >
                          {t("removeOverride")}
                        </Button>
                      </div>
                    ))}
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.includeStatistics}
                      onChange={(event) =>
                        update({ includeStatistics: event.target.checked })
                      }
                    />
                    {t("includeStatistics")}
                  </label>
                  {formError && (
                    <p role="alert" className="text-sm text-red-700">
                      {t("invalidSchedule")}
                    </p>
                  )}
                  {data.canEdit && (
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={
                        !dirty ||
                        stale ||
                        (draft.enabled && !recipients(draft.emails).length) ||
                        review.blocked(`school-settings:${draft.version}`)
                      }
                    >
                      {t(data.canApply ? "save" : "requestSave")}
                    </Button>
                  )}
                </fieldset>
              </form>
              {stale && (
                <InlineNotice
                  tone="warning"
                  action={
                    <Button
                      size="compact"
                      disabled={blocked}
                      onClick={() =>
                        void settings.refetch().then((result) => {
                          if (result.isSuccess && result.data)
                            setDraft(draftFrom(result.data.config));
                        })
                      }
                    >
                      {t("reload")}
                    </Button>
                  }
                >
                  {t("stale")}
                </InlineNotice>
              )}
              <section
                className="space-y-3 border-t border-slate-200 pt-4"
                aria-label={t("previewTitle")}
              >
                <h3 className="text-sm font-semibold">{t("previewTitle")}</h3>
                <p className="muted text-sm">{t("previewHelp")}</p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="space-y-1 text-sm">
                    <span className="block">{t("reportMonth")}</span>
                    <input
                      type="month"
                      className="input control-compact max-w-full lg:min-h-8 lg:py-1"
                      value={month}
                      disabled={review.busy}
                      onChange={(event) => {
                        setMonth(event.target.value);
                        setRequested("");
                        setReason("");
                      }}
                    />
                  </label>
                  <Button
                    size="compact"
                    disabled={
                      !month ||
                      dirty ||
                      blocked ||
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
                {dirty && (
                  <p className="muted text-sm">{t("saveBeforePreview")}</p>
                )}
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
                {snapshot && (
                  <>
                    <SchoolHoursPreview preview={snapshot} />
                    {snapshot.revision > 1 && (
                      <label className="block space-y-1 text-sm">
                        <span className="block">{t("revisionReason")}</span>
                        <textarea
                          className="input w-full"
                          maxLength={1000}
                          value={reason}
                          disabled={review.busy}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </label>
                    )}
                    {data.canGenerate && (
                      <Button
                        variant="primary"
                        disabled={
                          blocked ||
                          !data.config.enabled ||
                          snapshot.blockers.length > 0 ||
                          !!preview.error ||
                          preview.isFetching ||
                          (snapshot.revision > 1 && !reason.trim()) ||
                          review.blocked(
                            `school-issue:${snapshot.month}:${snapshot.contentHash}:${snapshot.revision}`,
                          )
                        }
                        onClick={issue}
                      >
                        {t(snapshot.revision > 1 ? "revise" : "issue")}
                      </Button>
                    )}
                  </>
                )}
              </section>
              <section
                className="space-y-3 border-t border-slate-200 pt-4"
                aria-label={t("history")}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{t("history")}</h3>
                  <Button
                    size="compact"
                    disabled={settings.isFetching || review.busy}
                    onClick={() => void settings.refetch()}
                  >
                    {t("refreshStatus")}
                  </Button>
                </div>
                {!data.recentReports.length && (
                  <p className="muted text-sm">{t("emptyHistory")}</p>
                )}
                <ul className="space-y-3">
                  {data.recentReports.map((report) => (
                    <li
                      key={report.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                    >
                      <div className="min-w-0 space-y-2">
                        <Link
                          className="link inline-flex min-h-11 items-center lg:min-h-8"
                          href={`/admin/service-hours/school-reports/${encodeURIComponent(report.id)}`}
                        >
                          {t("reportLabel", {
                            month: report.month,
                            revision: report.revision,
                          })}
                        </Link>
                        <p className="muted">
                          {date(report.generatedAt, data.config.timeZone)}
                        </p>
                        <span className="badge-slate">
                          {t(
                            report.supersededById
                              ? "superseded"
                              : report.revokedAt
                                ? "linkRevoked"
                                : "issuedState",
                          )}
                        </span>
                        <MonthlyHoursCounts counts={report.deliveryCounts} />
                      </div>
                      {data.canGenerate &&
                        !report.supersededById &&
                        (report.deliveryCounts.failed ||
                          report.deliveryCounts.blocked) > 0 && (
                          <Button
                            size="compact"
                            disabled={
                              blocked ||
                              !data.config.enabled ||
                              !!report.revokedAt ||
                              review.blocked(`school-retry:${report.id}`)
                            }
                            onClick={() =>
                              review.open({
                                key: `school-retry:${report.id}`,
                                title: t("retryDelivery"),
                                description: t("retryHelp"),
                                confirmLabel: t("retryDelivery"),
                                confirmVariant: "primary",
                                successMessage: t("retryQueued"),
                                repeatAfterRefresh: true,
                                commit: () =>
                                  retry.mutateAsync({ id: report.id }),
                                refresh: () => refresh(),
                                renderError: () => t("writeFailed"),
                              })
                            }
                          >
                            {t("retryDelivery")}
                          </Button>
                        )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </>
      )}
      {!hidden && review.dialog}
    </DisclosureSection>
  );
}
