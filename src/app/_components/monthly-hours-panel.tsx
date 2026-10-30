"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "~/trpc/react";
import { queuedApprovalId } from "~/lib/approval-outcome";
import { formatMonthlyHours } from "~/lib/monthly-hours-format";
import { useReadOnly } from "./read-only";
import { useActionReview } from "./ui/action-review";
import { Button } from "./ui/button";
import { DisclosureSection } from "./ui/disclosure-section";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import {
  MonthlyHoursStatus,
  MonthlyHoursReason,
  MonthlyHoursCounts,
  monthlyHoursStatusKey,
} from "./monthly-hours-snapshot";
import {
  MonthlyHoursPreview,
  closedMonthlyHoursMonth as closedMonth,
} from "./monthly-hours-preview";

type Settings = RouterOutputs["monthlyHours"]["settings"];
type Config = Settings["config"];
type Draft = Pick<
  Config,
  | "enabled"
  | "recipientUserIds"
  | "dayOfMonth"
  | "localTime"
  | "timeZone"
  | "version"
>;
const draftFrom = (config: Config): Draft => ({
  enabled: config.enabled,
  recipientUserIds: [...config.recipientUserIds],
  dayOfMonth: config.dayOfMonth,
  localTime: config.localTime,
  timeZone: config.timeZone,
  version: config.version,
});
const deniedError = (
  error: { data?: { code?: string } | null } | null | undefined,
) => error?.data?.code === "FORBIDDEN" || error?.data?.code === "UNAUTHORIZED";

export function MonthlyHoursPanel() {
  const readOnly = useReadOnly();
  return readOnly ? null : <MonthlyHoursSettings />;
}

function MonthlyHoursSettings() {
  const t = useTranslations("monthlyHours");
  const approvals = useTranslations("approvals");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const review = useActionReview();
  const [denied, setDenied] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [month, setMonth] = useState("");
  const [monthInitialized, setMonthInitialized] = useState(false);
  const [requestedMonth, setRequestedMonth] = useState("");
  const [reason, setReason] = useState("");
  const settings = api.monthlyHours.settings.useQuery(undefined, {
    enabled: !denied,
  });
  const preview = api.monthlyHours.preview.useQuery(
    { month: requestedMonth || month },
    { enabled: !!requestedMonth && !denied, retry: false, staleTime: 0 },
  );
  const save = api.monthlyHours.save.useMutation();
  const generate = api.monthlyHours.generate.useMutation();
  const retry = api.monthlyHours.retry.useMutation();
  const accessDenied =
    deniedError(settings.error) || deniedError(preview.error);
  const hidden = denied || accessDenied;
  useEffect(() => {
    if (accessDenied) {
      setDenied(true);
      setDraft(null);
      setRequestedMonth("");
      setReason("");
      review.revoke();
      queryClient.removeQueries({ queryKey: getQueryKey(api.monthlyHours) });
    } else if (settings.isSuccess && !settings.isFetching) setDenied(false);
  }, [
    accessDenied,
    settings.isSuccess,
    settings.isFetching,
    queryClient,
    review.revoke,
  ]);
  useEffect(() => {
    // Background refreshes never replace a versioned editor draft.
    if (!hidden && settings.data && !draft)
      setDraft(draftFrom(settings.data.config));
    if (!hidden && settings.data && !monthInitialized) {
      setMonth(closedMonth(settings.data.config.timeZone));
      setMonthInitialized(true);
    }
  }, [hidden, settings.data, draft, monthInitialized]);
  const data = hidden ? undefined : settings.data;
  const dirty =
    !!data &&
    !!draft &&
    JSON.stringify(draft) !== JSON.stringify(draftFrom(data.config));
  const stale = !!data && !!draft && draft.version !== data.config.version;
  const ready =
    !!data &&
    !!draft &&
    !settings.error &&
    !settings.isFetching &&
    !review.blocked("controls");
  const snapshot =
    requestedMonth === month &&
    !dirty &&
    !hidden &&
    preview.data?.configVersion === data?.config.version
      ? preview.data
      : undefined;
  const update = (patch: Partial<Draft>) => {
    setDraft((before) => (before ? { ...before, ...patch } : before));
    setRequestedMonth("");
  };
  const refresh = async () => {
    const result = await settings.refetch();
    if (!result.isSuccess || !result.data)
      throw new Error("Monthly report settings refresh failed");
    setDraft(draftFrom(result.data.config));
    setRequestedMonth("");
  };
  const saveDraft = () => {
    if (!ready || !draft || !data?.canEdit || stale) return;
    const { version, ...fields } = draft;
    const input = { ...fields, expectedVersion: version };
    const key = `monthly-settings:${draft.version}`;
    review.open({
      key,
      title: t(data.canApply ? "save" : "requestSave"),
      description: t("saveReview"),
      confirmLabel: t(data.canApply ? "save" : "requestSave"),
      confirmVariant: "primary",
      approvalId: queuedApprovalId,
      details: (
        <p className="text-sm">
          {t("scheduleSummary", {
            day: draft.dayOfMonth,
            time: draft.localTime,
            zone: draft.timeZone,
            count: draft.recipientUserIds.length,
          })}
        </p>
      ),
      commit: () => save.mutateAsync(input),
      refresh,
      renderError: () => t("writeFailed"),
    });
  };
  const generateReport = () => {
    if (
      !ready ||
      !snapshot ||
      !data?.canGenerate ||
      !data.serviceHoursEnabled ||
      !data.config.enabled ||
      preview.error ||
      preview.isFetching ||
      (snapshot.latestRevision > 0 && !reason.trim())
    )
      return;
    const input = {
      month: snapshot.month,
      expectedVersion: snapshot.configVersion,
      expectedContentHash: snapshot.contentHash,
      expectedLatestRevision: snapshot.latestRevision,
      requestId: crypto.randomUUID(),
      ...(snapshot.latestRevision > 0 ? { reason: reason.trim() } : {}),
    };
    review.open({
      key: `monthly-generate:${snapshot.month}:${snapshot.contentHash}:${snapshot.latestRevision}`,
      title: t(snapshot.latestRevision > 0 ? "generateRevision" : "generate"),
      description: t("generateReview"),
      confirmLabel: t("confirmGenerate"),
      confirmVariant: "primary",
      successMessage: t("generated"),
      details: (
        <p>
          {t("snapshotTotals", {
            tutors: snapshot.totals.tutors,
            sessions: snapshot.totals.sessions,
            hours: formatMonthlyHours(snapshot.totals.total),
          })}
        </p>
      ),
      commit: () => generate.mutateAsync(input),
      refresh,
      renderError: () => t("writeFailed"),
    });
  };
  const date = (value: Date | null | undefined, zone: string) =>
    value
      ? format.dateTime(value, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: zone,
        })
      : t("none");
  const latest = data?.recentReports[0];
  const attention =
    data &&
    (!data.serviceHoursEnabled ||
      !data.optionalEmailEnabled ||
      !data.transportAvailable ||
      Boolean(data.lastGenerationError) ||
      (latest && ["FAILED", "BLOCKED", "PARTIAL"].includes(latest.status)));
  const statusSummary = data
    ? [
        t(data.config.enabled ? "enabled" : "disabled"),
        t("selectedStaffCount", { count: data.config.recipientUserIds.length }),
        ...(data.config.enabled
          ? [
              `${t("nextDue")}: ${date(data.config.nextDueAt, data.config.timeZone)}`,
            ]
          : []),
        ...(latest
          ? [
              t("lastOutcome", {
                status: t(`status.${monthlyHoursStatusKey(latest.status)}`),
              }),
            ]
          : []),
        ...(attention ? [t("attention")] : []),
      ].join(" · ")
    : t(hidden ? "denied" : settings.error ? "loadFailed" : "loading");
  return (
    <DisclosureSection
      title={`${t("title")} · ${statusSummary}`}
      lifetime="retained"
    >
      {hidden ? (
        <StatePanel
          kind="denied"
          title={t("denied")}
          action={
            <Button
              size="compact"
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
            <div className="space-y-5">
              <p className="text-sm text-slate-700">{t("help")}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <span
                  className={
                    data.config.enabled ? "badge-green" : "badge-slate"
                  }
                >
                  {t(data.config.enabled ? "enabled" : "disabled")}
                </span>
                <p>
                  {t("nextDue")}:{" "}
                  {date(data.config.nextDueAt, data.config.timeZone)}
                </p>
                <p>
                  {t("lastGenerated")}:{" "}
                  {date(
                    data.recentReports[0]?.generatedAt,
                    data.config.timeZone,
                  )}
                </p>
              </div>
              {(!data.serviceHoursEnabled ||
                !data.optionalEmailEnabled ||
                !data.transportAvailable) && (
                <InlineNotice tone="warning">
                  {t("deliveryUnavailable")}
                </InlineNotice>
              )}
              {data.lastGenerationError && (
                <InlineNotice tone="error">{t("lastError")}</InlineNotice>
              )}
              {data.canEdit && !data.canApply && (
                <p className="muted text-sm">{approvals("sensitiveHelp")}</p>
              )}
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveDraft();
                }}
              >
                <fieldset
                  disabled={!ready || !data.canEdit}
                  aria-describedby="monthly-schedule-help"
                  className="min-w-0 space-y-3"
                >
                  <legend className="sr-only">{t("settings")}</legend>
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      disabled={
                        !draft.enabled &&
                        (!data.serviceHoursEnabled ||
                          !data.optionalEmailEnabled ||
                          !data.transportAvailable)
                      }
                      onChange={(event) =>
                        update({ enabled: event.target.checked })
                      }
                    />
                    {t("enable")}
                  </label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="space-y-1 text-sm">
                      <span className="block">{t("day")}</span>
                      <input
                        type="number"
                        min={1}
                        max={28}
                        required
                        className="input w-full"
                        value={draft.dayOfMonth}
                        onChange={(event) =>
                          update({ dayOfMonth: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="block">{t("time")}</span>
                      <input
                        type="time"
                        required
                        className="input w-full"
                        value={draft.localTime}
                        onChange={(event) =>
                          update({ localTime: event.target.value })
                        }
                      />
                    </label>
                    <label className="min-w-0 space-y-1 text-sm">
                      <span className="block">{t("zone")}</span>
                      <input
                        required
                        className="input w-full"
                        value={draft.timeZone}
                        onChange={(event) =>
                          update({ timeZone: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <p id="monthly-schedule-help" className="muted text-sm">
                    {t("scheduleHelp")}
                  </p>
                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-sm font-semibold">
                      {t("recipients")}
                    </legend>
                    <p className="muted text-sm">{t("recipientHelp")}</p>
                    {data.staff.length === 0 && (
                      <p className="muted text-sm">{t("noRecipients")}</p>
                    )}
                    {data.staff.map((staff) => (
                      <label
                        key={staff.userId}
                        className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 shrink-0"
                          disabled={
                            !staff.eligible &&
                            !draft.recipientUserIds.includes(staff.userId)
                          }
                          checked={draft.recipientUserIds.includes(
                            staff.userId,
                          )}
                          onChange={(event) =>
                            update({
                              recipientUserIds: event.target.checked
                                ? [...draft.recipientUserIds, staff.userId]
                                : draft.recipientUserIds.filter(
                                    (id) => id !== staff.userId,
                                  ),
                            })
                          }
                        />
                        <span className="min-w-0 break-words">
                          <span className="font-medium">
                            {staff.name ?? t("unnamed")}
                          </span>
                          <span className="muted block">
                            {staff.addresses
                              .map((address) => address.email)
                              .join(", ") || t("noAddress")}
                          </span>
                          {!staff.eligible && (
                            <span className="block text-amber-800">
                              {t("ineligible")}
                            </span>
                          )}
                          <MonthlyHoursReason reason={staff.reason} />
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {data.canEdit && (
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={
                        !dirty ||
                        stale ||
                        (draft.enabled &&
                          draft.recipientUserIds.length === 0) ||
                        review.blocked(`monthly-settings:${draft.version}`)
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
                      disabled={review.busy}
                      onClick={() => void refresh().catch(() => undefined)}
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
                      className="input control-compact lg:min-h-8 lg:py-1"
                      max={closedMonth(data.config.timeZone)}
                      value={month}
                      disabled={review.busy}
                      onChange={(event) => {
                        setMonth(event.target.value);
                        setRequestedMonth("");
                        setReason("");
                      }}
                    />
                  </label>
                  <Button
                    size="compact"
                    disabled={
                      !ready ||
                      !data.serviceHoursEnabled ||
                      dirty ||
                      !month ||
                      month > closedMonth(data.config.timeZone) ||
                      preview.isFetching
                    }
                    onClick={() => {
                      setRequestedMonth(month);
                      if (requestedMonth === month) void preview.refetch();
                    }}
                  >
                    {t("preview")}
                  </Button>
                </div>
                {dirty && (
                  <p className="muted text-sm">{t("saveBeforePreview")}</p>
                )}
                {!!requestedMonth && (
                  <QueryFeedback
                    hasData={!!snapshot}
                    loading={preview.isFetching && !snapshot}
                    error={!!preview.error}
                    retrying={preview.isFetching}
                    loadingTitle={t("loading")}
                    errorTitle={t(
                      snapshot ? "previewRefreshFailed" : "previewFailed",
                    )}
                    retryLabel={t("retryRead")}
                    onRetry={() => void preview.refetch()}
                  />
                )}
                {snapshot && (
                  <div className="space-y-3">
                    <MonthlyHoursPreview preview={snapshot} />
                    <ul className="space-y-2 text-sm">
                      {snapshot.recipients.map((recipient) => (
                        <li
                          key={`${recipient.userId}:${recipient.email ?? ""}`}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1"
                        >
                          <span className="max-w-full min-w-0 [overflow-wrap:anywhere]">
                            {recipient.name ?? t("unnamed")}
                            {recipient.email && ` · ${recipient.email}`}
                          </span>
                          <MonthlyHoursStatus status={recipient.status} />
                          <MonthlyHoursReason reason={recipient.reason} />
                        </li>
                      ))}
                    </ul>
                    {snapshot.latestRevision > 0 && (
                      <label className="block space-y-1 text-sm">
                        <span className="block">{t("revisionReason")}</span>
                        <textarea
                          className="input w-full"
                          required
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
                          !ready ||
                          !data.serviceHoursEnabled ||
                          !data.config.enabled ||
                          !!preview.error ||
                          preview.isFetching ||
                          (snapshot.latestRevision > 0 && !reason.trim()) ||
                          review.blocked(
                            `monthly-generate:${snapshot.month}:${snapshot.contentHash}:${snapshot.latestRevision}`,
                          )
                        }
                        onClick={generateReport}
                      >
                        {t(
                          snapshot.latestRevision > 0
                            ? "generateRevision"
                            : "generate",
                        )}
                      </Button>
                    )}
                  </div>
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
                {data.recentReports.length === 0 && (
                  <p className="muted text-sm">{t("emptyHistory")}</p>
                )}
                <ul className="space-y-3">
                  {data.recentReports.map((report) => (
                    <li
                      key={report.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                    >
                      <div className="min-w-0 space-y-1">
                        <Link
                          className="link inline-flex min-h-11 items-center lg:min-h-8"
                          href={`/admin/service-hours/reports/${encodeURIComponent(report.id)}`}
                        >
                          {t("reportLabel", {
                            month: report.month,
                            revision: report.revision,
                          })}
                        </Link>
                        <p className="muted">
                          {date(report.generatedAt, report.timeZone)}
                        </p>
                        <MonthlyHoursStatus status={report.status} />
                        <MonthlyHoursCounts counts={report.deliveryCounts} />
                      </div>
                      {data.canGenerate &&
                        (report.deliveryCounts.failed > 0 ||
                          report.deliveryCounts.retrying > 0 ||
                          report.deliveryCounts.blocked > 0) && (
                          <Button
                            size="compact"
                            disabled={
                              !ready ||
                              review.blocked(`monthly-retry:${report.id}`)
                            }
                            onClick={() =>
                              review.open({
                                key: `monthly-retry:${report.id}`,
                                title: t("retryDelivery"),
                                description: t("retryReview"),
                                confirmLabel: t("retryDelivery"),
                                confirmVariant: "primary",
                                successMessage: t("retryQueued"),
                                repeatAfterRefresh: true,
                                commit: () =>
                                  retry.mutateAsync({ id: report.id }),
                                refresh,
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
