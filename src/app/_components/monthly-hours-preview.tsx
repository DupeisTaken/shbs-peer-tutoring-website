"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "~/trpc/react";
import { useReadOnly } from "./read-only";
import { MonthlyHoursSnapshot } from "./monthly-hours-snapshot";
import { Button } from "./ui/button";
import { DisclosureSection } from "./ui/disclosure-section";
import { StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { SectionTabs } from "./ui/section-tabs";

type Preview = RouterOutputs["monthlyHours"]["preview"];
type PreviewTab = "report" | "html" | "text";

/** A reporting month is eligible only after both UTC accounting and the
 * configured schedule's local calendar have moved into the following month. */
export function closedMonthlyHoursMonth(timeZone: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const lastClosed =
    Math.min(
      year * 12 + month - 1,
      now.getUTCFullYear() * 12 + now.getUTCMonth(),
    ) - 1;
  return `${Math.floor(lastClosed / 12)}-${String((lastClosed % 12) + 1).padStart(2, "0")}`;
}

/** Presentation only: both callers review the server renderer's exact HTML and
 * text from the same coherent snapshot. No mail capabilities enter this view. */
export function MonthlyHoursPreview({ preview }: { preview: Preview }) {
  const t = useTranslations("monthlyHours");
  const format = useFormatter();
  const [tab, setTab] = useState<PreviewTab>("report");
  return (
    <div className="min-w-0 space-y-3">
      <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        {t("previewDraft")}
      </p>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="muted">{t("reportMonth")}</dt>
          <dd>{preview.month}</dd>
        </div>
        <div>
          <dt className="muted">{t("proposedRevision")}</dt>
          <dd>{preview.latestRevision + 1}</dd>
        </div>
        <div className="min-w-0">
          <dt className="muted">{t("zone")}</dt>
          <dd className="[overflow-wrap:anywhere]">{preview.timeZone}</dd>
        </div>
        <div>
          <dt className="muted">{t("previewAt")}</dt>
          <dd>
            {format.dateTime(preview.generatedAt, {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: preview.timeZone,
            })}
          </dd>
        </div>
      </dl>
      <SectionTabs<PreviewTab>
        label={t("previewTabs")}
        items={[
          { value: "report", label: t("adminReportTab") },
          { value: "html", label: t("emailHtmlTab") },
          { value: "text", label: t("plainTextTab") },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === "report" ? (
          <MonthlyHoursSnapshot rows={preview.rows} totals={preview.totals} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm [overflow-wrap:anywhere]">
              <span className="font-semibold">{t("emailSubject")}: </span>
              {preview.email.subject}
            </p>
            {tab === "html" ? (
              <iframe
                title={t("emailFrameTitle", { month: preview.month })}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={preview.email.html}
                className="h-[32rem] min-h-80 w-full rounded-lg border border-slate-200 bg-white"
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

/** Keep the query owner lazy and retained inside Communication. Collapsing the
 * preview preserves its transient month/tab choice without starting any writes. */
export function ProgramMonthlyHoursPreview({
  denied = false,
}: {
  denied?: boolean;
}) {
  const t = useTranslations("monthlyHours");
  const readOnly = useReadOnly();
  if (readOnly) return null;
  return (
    <DisclosureSection title={t("emailPreviewsTitle")} lifetime="retained">
      <ProgramPreviewLoader parentDenied={denied} />
    </DisclosureSection>
  );
}

function ProgramPreviewLoader({ parentDenied }: { parentDenied: boolean }) {
  const t = useTranslations("monthlyHours");
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const [month, setMonth] = useState("");
  const [monthInitialized, setMonthInitialized] = useState(false);
  const [requestedMonth, setRequestedMonth] = useState("");
  const settings = api.monthlyHours.settings.useQuery(undefined, {
    enabled: !denied && !parentDenied,
  });
  const preview = api.monthlyHours.preview.useQuery(
    { month: requestedMonth || month },
    {
      enabled: !!requestedMonth && !denied && !parentDenied,
      retry: false,
      staleTime: 0,
    },
  );
  const accessDenied =
    parentDenied ||
    [settings.error, preview.error].some(
      (error) =>
        error?.data?.code === "FORBIDDEN" ||
        error?.data?.code === "UNAUTHORIZED",
    );
  const hidden = denied || accessDenied;
  useEffect(() => {
    if (accessDenied) {
      setDenied(true);
      setRequestedMonth("");
      queryClient.removeQueries({ queryKey: getQueryKey(api.monthlyHours) });
    } else if (settings.isSuccess && !settings.isFetching) setDenied(false);
  }, [accessDenied, settings.isSuccess, settings.isFetching, queryClient]);
  useEffect(() => {
    if (!hidden && settings.data && !monthInitialized) {
      setMonth(closedMonthlyHoursMonth(settings.data.config.timeZone));
      setMonthInitialized(true);
    }
  }, [hidden, settings.data, monthInitialized]);
  const data = hidden ? undefined : settings.data;
  const snapshot =
    data &&
    requestedMonth === month &&
    preview.data?.configVersion === data.config.version
      ? preview.data
      : undefined;
  return (
    <div className="min-w-0 space-y-4">
      {hidden ? (
        <StatePanel
          kind="denied"
          title={t("denied")}
          action={
            <Button
              size="compact"
              disabled={settings.isFetching || parentDenied}
              onClick={() => void settings.refetch()}
            >
              {t("retryRead")}
            </Button>
          }
        />
      ) : (
        <>
          <p className="muted text-sm">{t("emailPreviewsHelp")}</p>
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
          {data && (
            <>
              {!data.serviceHoursEnabled && (
                <p className="text-sm text-amber-800">
                  {t("previewFeatureOff")}
                </p>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-sm">
                  <span className="block">{t("reportMonth")}</span>
                  <input
                    type="month"
                    value={month}
                    max={closedMonthlyHoursMonth(data.config.timeZone)}
                    className="input control-compact max-w-full lg:min-h-8 lg:py-1"
                    onChange={(event) => {
                      setMonth(event.target.value);
                      setRequestedMonth("");
                    }}
                  />
                </label>
                <Button
                  size="compact"
                  disabled={
                    !!settings.error ||
                    settings.isFetching ||
                    preview.isFetching ||
                    !data.serviceHoursEnabled ||
                    !month ||
                    month > closedMonthlyHoursMonth(data.config.timeZone)
                  }
                  onClick={() => {
                    setRequestedMonth(month);
                    if (requestedMonth === month) void preview.refetch();
                  }}
                >
                  {t("preview")}
                </Button>
              </div>
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
              {snapshot && <MonthlyHoursPreview preview={snapshot} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
