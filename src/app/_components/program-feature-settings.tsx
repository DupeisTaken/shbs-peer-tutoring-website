"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";
import { InlineNotice, StatePanel } from "./ui/patterns";
import { useSessionAccessDenied } from "./session-view-state";
import { Button, Switch } from "./ui/button";
import type { FeatureKey } from "~/server/program/features";

/**
 * Optional-module toggles. Room automation controls new allocation while retaining
 * reservations/readers; Quarter System controls refresh granularity. Admin/Head stage them directly and Coordinators may request Admin review. Changes are staged — they take effect at the next program refresh.
 */
export function FeatureToggles() {
  const t = useTranslations();
  const settings = api.program.featureSettings.useQuery();
  const setPending = api.program.setFeaturePending.useMutation();
  const utils = api.useUtils();
  const denied = useSessionAccessDenied(settings);
  const admitted = useRef(false);
  const modeReadPending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [accepted, setAccepted] = useState(false);

  // A committed staged change must only be recovered with reads. Keep switches
  // locked while cached effective/pending values might still describe the old state.
  async function reload() {
    setBusy(true);
    try {
      // A staged mode changes both next-period identities. Refresh their live
      // evidence without replacing frozen recruitment drafts or review snapshots.
      // Keep failed accepted-save recovery here so Retry never repeats the write.
      const [settingsResult, ...relatedResults] = await Promise.allSettled([
        settings.refetch(),
        ...(modeReadPending.current
          ? [
              utils.program.nextRecruitment.invalidate(undefined, undefined, {
                throwOnError: true,
              }),
              utils.admin.currentPeriod.invalidate(undefined, undefined, {
                throwOnError: true,
              }),
            ]
          : []),
      ] as const);
      if (
        settingsResult.status === "rejected" ||
        !settingsResult.value.isSuccess ||
        relatedResults.some((result) => result.status === "rejected")
      )
        throw new Error("Feature settings refresh failed");
      modeReadPending.current = false;
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      setBusy(false);
    }
  }
  async function stage(key: FeatureKey, enabled: boolean) {
    if (
      admitted.current ||
      busy ||
      setPending.isPending ||
      refreshFailed ||
      !!settings.error ||
      denied ||
      settings.data?.canEdit !== true
    )
      return;
    admitted.current = true;
    setBusy(true);
    setAccepted(false);
    try {
      await setPending.mutateAsync({ key, enabled });
      setAccepted(true);
      modeReadPending.current = key === "QUARTER_SYSTEM";
      await reload();
    } catch {
      // Mutation errors (including queued approval) remain owned by the mutation.
      // In particular, a queued request never changes the effective switch.
    } finally {
      admitted.current = false;
      setBusy(false);
    }
  }

  const data = settings.data;
  if (denied)
    return (
      <StatePanel
        kind="denied"
        title={t("managementRecovery.denied", {
          section: t("admin.program.features.heading"),
        })}
        action={
          <Button disabled={busy} onClick={() => void reload()}>
            {t("uiPatterns.retry")}
          </Button>
        }
      />
    );
  if (!data)
    return (
      <StatePanel
        kind={settings.error ? "error" : "loading"}
        title={settings.error?.message ?? t("admin.program.loading")}
        action={
          settings.error ? (
            <Button disabled={busy} onClick={() => void reload()}>
              {t("uiPatterns.retry")}
            </Button>
          ) : undefined
        }
      />
    );

  return (
    <section className="card p-5">
      <h2 className="section-title">{t("admin.program.features.heading")}</h2>
      <p className="muted mt-1 text-sm">{t("admin.program.features.help")}</p>
      <p className="muted mt-2 text-sm">{t("approvals.sensitiveHelp")}</p>
      {(refreshFailed || settings.error) && (
        <InlineNotice
          tone="error"
          announcement="alert"
          action={
            <Button disabled={busy} onClick={() => void reload()}>
              {t("admin.program.features.retryRefresh")}
            </Button>
          }
        >
          {accepted
            ? t("admin.program.features.savedRefreshFailed")
            : (settings.error?.message ??
              t("admin.program.features.readFailed"))}
        </InlineNotice>
      )}
      <ul className="mt-3 divide-y divide-slate-100">
        {data.features.map((f) => {
          // `target` = the desired state (staged value if any, else the current effective value).
          const target = f.pending ?? f.enabled;
          return (
            <li key={f.key} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-44 flex-1">
                <p className="font-medium text-slate-800">
                  {t(`admin.program.features.name.${f.key}`)}
                </p>
                {f.key === "QUARTER_SYSTEM" && (
                  <p className="muted text-xs">
                    {t("admin.program.features.quarterNote")}
                  </p>
                )}
                {f.key === "AUTO_ASSIGN_ROOMS" && (
                  <p className="muted text-xs">
                    {t("admin.program.features.autoRoomsNote")}
                  </p>
                )}
              </div>
              <span className={f.enabled ? "badge-green" : "badge-slate"}>
                {t(
                  f.enabled
                    ? "admin.program.features.on"
                    : "admin.program.features.off",
                )}
              </span>
              {f.pending !== null && (
                <span className="badge-amber">
                  {t("admin.program.features.pending", {
                    state: t(
                      f.pending
                        ? "admin.program.features.on"
                        : "admin.program.features.off",
                    ),
                  })}
                </span>
              )}
              {data.canEdit && (
                // Keep the staged-setting behavior while giving each compact switch a named touch target.
                <Switch
                  label={
                    data.canApply !== true
                      ? t("approvals.requestChange", {
                          setting: t(`admin.program.features.name.${f.key}`),
                        })
                      : t(`admin.program.features.name.${f.key}`)
                  }
                  checked={target}
                  disabled={
                    busy ||
                    setPending.isPending ||
                    refreshFailed ||
                    !!settings.error
                  }
                  onChange={(enabled) => void stage(f.key, enabled)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {!data.canEdit && (
        <p className="muted mt-3 text-xs">
          {t("admin.program.features.headOnly")}
        </p>
      )}
      {setPending.error?.data?.approvalId && (
        <InlineNotice tone="warning" announcement="status">
          {t("approvals.queuedBody")}{" "}
          <Link
            className="link"
            href={`/admin/approvals?request=${encodeURIComponent(setPending.error.data.approvalId)}`}
          >
            {t("approvals.viewRequest")}
          </Link>
        </InlineNotice>
      )}
      {setPending.error && !setPending.error.data?.approvalId && (
        <p className="mt-2 text-sm text-red-600">{setPending.error.message}</p>
      )}
    </section>
  );
}
