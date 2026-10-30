"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api } from "~/trpc/react";
import { useReadOnly } from "./read-only";
import { Button } from "./ui/button";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import {
  MonthlyHoursSnapshot,
  MonthlyHoursStatus,
  MonthlyHoursReason,
} from "./monthly-hours-snapshot";

export function MonthlyHoursReport({ id }: { id: string }) {
  const t = useTranslations("monthlyHours");
  const readOnly = useReadOnly();
  return readOnly ? (
    <StatePanel kind="denied" title={t("denied")} />
  ) : (
    <ReportReader key={id} id={id} />
  );
}

function ReportReader({ id }: { id: string }) {
  const t = useTranslations("monthlyHours");
  const format = useFormatter();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const [denied, setDenied] = useState(false);
  const report = api.monthlyHours.report.useQuery({ id }, { enabled: !denied });
  const accessDenied =
    report.error?.data?.code === "FORBIDDEN" ||
    report.error?.data?.code === "UNAUTHORIZED";
  const hidden = denied || accessDenied;
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const downloadInFlight = useRef(false);
  const generation = useRef(0);
  const hiddenNow = useRef(hidden);
  useLayoutEffect(() => {
    hiddenNow.current = hidden;
  }, [hidden]);
  useLayoutEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (accessDenied) {
      setDenied(true);
      generation.current += 1;
      queryClient.removeQueries({ queryKey: getQueryKey(api.monthlyHours) });
    } else if (report.isSuccess && !report.isFetching) setDenied(false);
  }, [accessDenied, report.isSuccess, report.isFetching, queryClient]);
  const data = hidden ? undefined : report.data;
  const date = (value: Date, zone: string) =>
    format.dateTime(value, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    });
  async function download() {
    if (!data || report.error || hidden || downloadInFlight.current) return;
    downloadInFlight.current = true;
    setDownloading(true);
    setDownloadError(false);
    const started = generation.current;
    try {
      // Recheck current access on every download, even when a prior CSV is cached.
      // Export the stored snapshot, independent of the interactive roster.
      const result = await utils.monthlyHours.csv.fetch({ id }, { staleTime: 0 });
      if (hiddenNow.current || generation.current !== started) return;
      const url = URL.createObjectURL(
        new Blob([result.content], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (generation.current !== started) return;
      if (
        typeof error === "object" &&
        error &&
        "data" in error &&
        typeof error.data === "object" &&
        error.data &&
        "code" in error.data &&
        (error.data.code === "FORBIDDEN" || error.data.code === "UNAUTHORIZED")
      ) {
        hiddenNow.current = true;
        setDenied(true);
        generation.current += 1;
        queryClient.removeQueries({ queryKey: getQueryKey(api.monthlyHours) });
      } else setDownloadError(true);
    } finally {
      downloadInFlight.current = false;
      setDownloading(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("reportTitle")}</h1>
        <Link
          className="btn-secondary control-compact"
          href="/admin/service-hours"
        >
          {t("back")}
        </Link>
      </div>
      {hidden ? (
        <StatePanel
          kind="denied"
          title={t("denied")}
          action={
            <Button
              size="compact"
              disabled={report.isFetching}
              onClick={() => void report.refetch()}
            >
              {t("retryRead")}
            </Button>
          }
        />
      ) : (
        <QueryFeedback
          hasData={!!data}
          loading={!data && !report.error}
          error={!!report.error}
          retrying={report.isFetching}
          loadingTitle={t("loading")}
          errorTitle={t(data ? "refreshFailed" : "loadFailed")}
          retryLabel={t("retryRead")}
          onRetry={() => void report.refetch()}
        />
      )}
      {data && (
        <>
          <section className="card space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="section-title">
                {t("reportLabel", {
                  month: data.month,
                  revision: data.revision,
                })}
              </h2>
              <MonthlyHoursStatus status={data.status} />
            </div>
            <p className="muted text-sm">{t("immutableHelp")}</p>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="muted">{t("generatedAt")}</dt>
                <dd>{date(data.generatedAt, data.timeZone)}</dd>
              </div>
              <div>
                <dt className="muted">{t("zone")}</dt>
                <dd>{data.timeZone}</dd>
              </div>
              <div>
                <dt className="muted">{t("configVersion")}</dt>
                <dd>{data.configVersion}</dd>
              </div>
            </dl>
            {data.reason && (
              <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                {t("revisionReason")}: {data.reason}
              </p>
            )}
            <Button
              size="compact"
              disabled={downloading || !!report.error || report.isFetching}
              onClick={() => void download()}
            >
              {t("downloadCsv")}
            </Button>
            {downloadError && (
              <InlineNotice tone="error">{t("csvFailed")}</InlineNotice>
            )}
            <MonthlyHoursSnapshot rows={data.rows} totals={data.totals} />
          </section>
          <section
            className="card space-y-3 p-4 sm:p-5"
            aria-label={t("deliveryHistory")}
          >
            <h2 className="section-title">{t("deliveryHistory")}</h2>
            <h3 className="text-sm font-semibold">{t("recipients")}</h3>
            <ul className="space-y-2 text-sm">
              {data.intendedRecipients.map((recipient) => (
                <li
                  key={`${recipient.userId}:${recipient.email ?? ""}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                  <span className="max-w-full min-w-0 [overflow-wrap:anywhere]">
                    {recipient.name ?? t("unnamed")}
                    {recipient.email && ` · ${recipient.email}`}
                  </span>
                  <MonthlyHoursReason reason={recipient.reason} />
                </li>
              ))}
            </ul>
            <ul className="space-y-3">
              {data.deliveries.map((delivery) => (
                <li
                  key={delivery.id}
                  className="space-y-1 rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <p className="font-medium break-all">
                    {delivery.recipient || t("noAddress")}
                  </p>
                  <MonthlyHoursStatus
                    status={
                      delivery.status === "PENDING" && delivery.attempts > 0
                        ? "RETRYING"
                        : delivery.status
                    }
                  />
                  <p className="muted">
                    {t("attempts", { count: delivery.attempts })}
                  </p>
                  {delivery.lastError && (
                    <MonthlyHoursReason reason={delivery.lastError} />
                  )}
                  {delivery.lastError &&
                    (delivery.status === "FAILED" ||
                      (delivery.status === "PENDING" &&
                        delivery.attempts > 0)) && (
                      <p className="text-amber-800">{t("lastError")}</p>
                    )}
                  {delivery.status === "PENDING" && (
                    <p className="muted">
                      {t("nextAttempt")}:{" "}
                      {date(delivery.availableAt, data.timeZone)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {data.deliveries.length === 0 && (
              <p className="muted text-sm">{t("noDeliveries")}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
