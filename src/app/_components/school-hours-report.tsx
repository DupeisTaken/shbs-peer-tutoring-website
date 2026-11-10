"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "~/trpc/react";
import { useReadOnly } from "./read-only";
import {
  SchoolHoursIndividuals,
  schoolHoursDenied,
} from "./school-hours-preview";
import { MonthlyHoursStatus } from "./monthly-hours-snapshot";
import { useActionReview } from "./ui/action-review";
import { Button } from "./ui/button";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { QueryFeedback } from "./ui/query-feedback";
import { SchoolHoursFollowups } from "./school-hours-followups";

export function SchoolHoursReport({ id }: { id: string }) {
  const t = useTranslations("schoolHours");
  const readOnly = useReadOnly();
  return readOnly ? (
    <StatePanel kind="denied" title={t("denied")} />
  ) : (
    <SchoolReportReader key={id} id={id} />
  );
}

function SchoolReportReader({ id }: { id: string }) {
  const t = useTranslations("schoolHours");
  const format = useFormatter();
  const utils = api.useUtils();
  const client = useQueryClient();
  const review = useActionReview();
  const [denied, setDenied] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [copyResult, setCopyResult] = useState<"copied" | "copyFailed" | null>(
    null,
  );
  const [downloading, setDownloading] = useState(false);
  const reading = useRef(false);
  const generation = useRef(0);
  const hiddenNow = useRef(false);
  const report = api.schoolHours.report.useQuery({ id }, { enabled: !denied });
  const settings = api.schoolHours.settings.useQuery(undefined, {
    enabled: !denied,
  });
  const revoke = api.schoolHours.revokeLink.useMutation();
  const reissue = api.schoolHours.reissueLink.useMutation();
  const retry = api.schoolHours.retry.useMutation();
  const accessDenied =
    schoolHoursDenied(report.error) || schoolHoursDenied(settings.error);
  const hidden = denied || accessDenied;
  useLayoutEffect(() => {
    hiddenNow.current = hidden;
  }, [hidden]);
  useLayoutEffect(() => {
    if (accessDenied) generation.current += 1;
  }, [accessDenied, report.error, settings.error]);
  useLayoutEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );
  if (accessDenied && !denied) {
    setDenied(true);
    setCopyResult(null);
  }
  const { revoke: revokeReview } = review;
  useEffect(() => {
    if (hidden) {
      revokeReview();
      client.removeQueries({ queryKey: getQueryKey(api.schoolHours) });
    }
  }, [hidden, client, revokeReview]);
  const retryRead = async () => {
    const started = generation.current;
    const results = await Promise.all([report.refetch(), settings.refetch()]);
    if (
      started === generation.current &&
      results.every((result) => result.isSuccess && result.data)
    )
      setDenied(false);
  };
  const data = hidden ? undefined : report.data;
  const canManage =
    !hidden &&
    settings.data?.canGenerate &&
    !settings.error &&
    !report.error &&
    !report.isFetching &&
    !settings.isFetching &&
    !review.blocked("controls");
  const refresh = async () => {
    const result = await Promise.all([report.refetch(), settings.refetch()]);
    if (!result.every((item) => item.isSuccess && item.data))
      throw new Error("School report refresh failed");
  };
  const date = (value: Date) =>
    format.dateTime(value, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: data?.timeZone ?? "UTC",
    });
  async function csv() {
    if (!data || hidden || report.error || reading.current) return;
    reading.current = true;
    setDownloading(true);
    setDownloadError(false);
    const started = generation.current;
    try {
      const result = await utils.schoolHours.csv.fetch(
        { id },
        { staleTime: 0 },
      );
      if (hiddenNow.current || started !== generation.current) return;
      const url = URL.createObjectURL(
        new Blob([result.content], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (started !== generation.current) return;
      if (
        typeof error === "object" &&
        error &&
        "data" in error &&
        typeof error.data === "object" &&
        error.data &&
        "code" in error.data &&
        ["FORBIDDEN", "UNAUTHORIZED"].includes(String(error.data.code))
      ) {
        hiddenNow.current = true;
        setDenied(true);
        generation.current += 1;
        client.removeQueries({ queryKey: getQueryKey(api.schoolHours) });
      } else setDownloadError(true);
    } finally {
      reading.current = false;
      setDownloading(false);
    }
  }
  const linkResult = (result: unknown) =>
    typeof result === "object" &&
    result &&
    "url" in result &&
    typeof result.url === "string" ? (
      <a
        className="link inline-flex min-h-11 items-center"
        href={result.url}
        target="_blank"
        rel="noreferrer"
      >
        {t("viewMonthReport")}
      </a>
    ) : null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t("savedReportTitle")}</h1>
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
              disabled={report.isFetching || settings.isFetching}
              onClick={() => void retryRead()}
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
          <SchoolHoursFollowups
            key={`${id}:${settings.data?.canGenerate ?? false}`}
            id={id}
            timeZone={data.timeZone}
            linkVersion={data.linkVersion}
            recipients={data.recipients}
            followups={data.followups}
            canManage={!!canManage}
            canSchedule={
              !!data.linkUrl &&
              !!settings.data?.config.enabled &&
              !!settings.data?.serviceHoursEnabled
            }
            refresh={refresh}
          />
          <section className="card space-y-4 p-4 sm:p-5">
            <h2 className="section-title">
              {t("reportLabel", { month: data.month, revision: data.revision })}
            </h2>
            <p className="muted text-sm">{t("savedHelp")}</p>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="muted">{t("generatedAt")}</dt>
                <dd>{date(data.generatedAt)}</dd>
              </div>
              <div>
                <dt className="muted">{t("zone")}</dt>
                <dd>{data.timeZone}</dd>
              </div>
              <div>
                <dt className="muted">{t("revision")}</dt>
                <dd>{data.revision}</dd>
              </div>
            </dl>
            {data.supersededById && (
              <InlineNotice tone="warning">
                {t("supersededHelp")}{" "}
                <Link
                  className="link"
                  href={`/admin/service-hours/school-reports/${encodeURIComponent(data.supersededById)}`}
                >
                  {t("currentEdition")}
                </Link>
              </InlineNotice>
            )}
            {data.reason && (
              <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                {t("revisionReason")}: {data.reason}
              </p>
            )}
            <SchoolHoursIndividuals
              rows={data.rows}
              revision={data.revision}
              includeStatistics={data.includeStatistics}
            />
            <Button
              size="compact"
              disabled={downloading || !!report.error || report.isFetching}
              onClick={() => void csv()}
            >
              {t("downloadCsv")}
            </Button>
            {downloadError && (
              <InlineNotice tone="error">{t("csvFailed")}</InlineNotice>
            )}
          </section>
          <section
            className="card space-y-3 p-4 sm:p-5"
            aria-label={t("schoolLink")}
          >
            <h2 className="section-title">{t("schoolLink")}</h2>
            <p className="muted text-sm">{t("linkHelp")}</p>
            <p className="text-sm">
              {t(data.revokedAt ? "linkRevoked" : "linkActive")}
            </p>
            {data.linkUrl && !data.revokedAt && !data.supersededById && (
              <div className="flex flex-wrap items-center gap-3">
                <a
                  className="btn-secondary control-compact"
                  href={data.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("viewMonthReport")}
                </a>
                <Button
                  size="compact"
                  disabled={!!report.error}
                  onClick={() => {
                    const copy = async () => {
                      try {
                        if (!data.linkUrl) return;
                        await navigator.clipboard.writeText(
                          new URL(data.linkUrl, window.location.origin).href,
                        );
                        if (!hiddenNow.current) setCopyResult("copied");
                      } catch {
                        if (!hiddenNow.current) setCopyResult("copyFailed");
                      }
                    };
                    void copy();
                  }}
                >
                  {t("copyLink")}
                </Button>
              </div>
            )}
            {copyResult && (
              <p role="status" className="text-sm">
                {t(copyResult)}
              </p>
            )}
            {settings.error && (
              <InlineNotice
                tone="error"
                action={
                  <Button
                    size="compact"
                    onClick={() => void settings.refetch()}
                  >
                    {t("retryRead")}
                  </Button>
                }
              >
                {t("refreshFailed")}
              </InlineNotice>
            )}
            {settings.data?.canGenerate && !data.supersededById && (
              <div className="flex flex-wrap gap-3">
                {!data.revokedAt && (
                  <Button
                    size="compact"
                    disabled={
                      !canManage ||
                      review.blocked(`school-revoke:${id}:${data.linkVersion}`)
                    }
                    onClick={() =>
                      review.open({
                        key: `school-revoke:${id}:${data.linkVersion}`,
                        title: t("revokeLink"),
                        description: t("revokeHelp"),
                        confirmLabel: t("revokeLink"),
                        commit: () =>
                          revoke.mutateAsync({
                            id,
                            expectedLinkVersion: data.linkVersion,
                          }),
                        refresh,
                        renderError: () => t("writeFailed"),
                      })
                    }
                  >
                    {t("revokeLink")}
                  </Button>
                )}
                <Button
                  size="compact"
                  disabled={
                    !canManage ||
                    review.blocked(`school-reissue:${id}:${data.linkVersion}`)
                  }
                  onClick={() =>
                    review.open({
                      key: `school-reissue:${id}:${data.linkVersion}`,
                      title: t("reissueLink"),
                      description: t("reissueHelp"),
                      confirmLabel: t("reissueLink"),
                      confirmVariant: "primary",
                      renderResult: linkResult,
                      commit: () =>
                        reissue.mutateAsync({
                          id,
                          expectedLinkVersion: data.linkVersion,
                        }),
                      refresh,
                      renderError: () => t("writeFailed"),
                    })
                  }
                >
                  {t("reissueLink")}
                </Button>
              </div>
            )}
          </section>
          <section className="card space-y-3 p-4 sm:p-5">
            <h2 className="section-title">{t("deliveryHistory")}</h2>
            <p className="muted text-sm">{t("deliveryHelp")}</p>
            <ul className="space-y-3">
              {data.deliveries.map((delivery) => (
                <li
                  key={delivery.id}
                  className="space-y-1 rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <p className="break-all">{delivery.recipient}</p>
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
                    <p className="text-amber-800">{t("deliveryFailed")}</p>
                  )}
                </li>
              ))}
            </ul>
            {settings.data?.canGenerate &&
              !data.supersededById &&
              data.deliveries.some((delivery) =>
                ["FAILED", "BLOCKED"].includes(delivery.status),
              ) && (
                <Button
                  size="compact"
                  disabled={
                    !canManage ||
                    !settings.data?.config.enabled ||
                    !!data.revokedAt ||
                    review.blocked(`school-retry:${id}`)
                  }
                  onClick={() =>
                    review.open({
                      key: `school-retry:${id}`,
                      title: t("retryDelivery"),
                      description: t("retryHelp"),
                      confirmLabel: t("retryDelivery"),
                      confirmVariant: "primary",
                      repeatAfterRefresh: true,
                      successMessage: t("retryQueued"),
                      commit: () => retry.mutateAsync({ id }),
                      refresh,
                      renderError: () => t("writeFailed"),
                    })
                  }
                >
                  {t("retryDelivery")}
                </Button>
              )}
          </section>
        </>
      )}
      {!hidden && review.dialog}
    </div>
  );
}
