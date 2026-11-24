"use client";

import { useLocale, useTranslations } from "next-intl";
import type { RouterOutputs } from "~/trpc/react";
import { parseProgramDateTime } from "~/lib/program-time";
import { quarterSemester } from "~/lib/period";
import type { NextRecruitmentSettingsData } from "./next-recruitment-settings";
import { NextRecruitmentReview } from "./next-recruitment-review";
import { ProgramRefreshEffects } from "./program-refresh-effects";
import { DisclosureSection } from "./ui/disclosure-section";

export type ScheduleData = RouterOutputs["admin"]["refreshSchedule"];
export type Schedule = NonNullable<ScheduleData["schedule"]>;
export type RefreshPeriod = NonNullable<RouterOutputs["admin"]["currentPeriod"]>;
export type RefreshMode = "scheduled" | "immediate";
export type SchedulePhase =
  | "scheduled"
  | "due"
  | "retrying"
  | "blocked"
  | "failed"
  | "cancelled"
  | "completed"
  | "none";

export type RefreshSnapshot = {
  schedule: Schedule | null;
  next: NextRecruitmentSettingsData;
};

export type RefreshConditionsState = {
  changed: boolean;
  stalePreparation: boolean;
  sourceMismatch: boolean;
  effectiveTuteeOpening: Date | null;
  futureTuteeOpening: Date | null;
  schedulePhase: SchedulePhase;
  timingIssue: "past_or_invalid" | "after_tutee_opening" | null;
  stagedFeatureCount: number;
  hasActiveOrAttentionSchedule: boolean;
};

export function refreshSnapshotIdentity(
  schedule: Schedule | null,
  next: NextRecruitmentSettingsData,
) {
  return JSON.stringify({ schedule, evidence: next.refreshEvidence });
}

export function formatScheduleDestination(value: Schedule) {
  return `${value.destinationSchoolYear} ${value.semesterMode ? quarterSemester(value.destinationQuarter) : value.destinationQuarter}`;
}

export function formatRefreshDateTime(
  at: Date | string,
  zone: string,
  locale: string,
) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: zone,
  }).format(new Date(at));
}

/** Pure derivation of schedule lifecycle and run-condition readiness from the
 * captured review snapshot and live polled state. Never mutates or authorizes. */
export function evaluateRefreshConditions({
  liveSchedule,
  liveNext,
  snapshot,
  period,
  serverNow,
  mode,
  timeInput,
}: {
  liveSchedule: Schedule | null;
  liveNext: NextRecruitmentSettingsData;
  snapshot: RefreshSnapshot;
  period: RefreshPeriod;
  serverNow: Date | string;
  mode: RefreshMode;
  timeInput: string;
}): RefreshConditionsState {
  const nowMs = new Date(serverNow).getTime();
  const changed =
    refreshSnapshotIdentity(liveSchedule, liveNext) !==
    refreshSnapshotIdentity(snapshot.schedule, snapshot.next);
  const stalePreparation = Object.values(snapshot.next.preparations).some(
    (value) => value !== null && !value.matchesTarget,
  );
  const sourceMismatch = snapshot.next.target.sourceTermId !== period.termId;

  const rawTuteeOpening = snapshot.next.preparations.tutee
    ? snapshot.next.preparations.tutee.opensAt
    : (snapshot.next.refreshEvidence.destination?.tutee.opensAt ?? null);
  const effectiveTuteeOpening = rawTuteeOpening
    ? new Date(rawTuteeOpening)
    : null;
  const futureTuteeOpening =
    effectiveTuteeOpening && effectiveTuteeOpening.getTime() > nowMs
      ? effectiveTuteeOpening
      : null;

  let schedulePhase: SchedulePhase = "none";
  if (liveSchedule) {
    if (liveSchedule.state === "COMPLETED") {
      schedulePhase = "completed";
    } else if (liveSchedule.state === "BLOCKED") {
      schedulePhase = "blocked";
    } else if (liveSchedule.state === "FAILED") {
      schedulePhase = "failed";
    } else if (liveSchedule.state === "CANCELLED") {
      schedulePhase = "cancelled";
    } else if ((liveSchedule.attempts ?? 0) > 0) {
      schedulePhase = "retrying";
    } else if (new Date(liveSchedule.executeAt).getTime() <= nowMs) {
      schedulePhase = "due";
    } else {
      schedulePhase = "scheduled";
    }
  }

  let timingIssue: RefreshConditionsState["timingIssue"] = null;
  if (mode === "scheduled" && timeInput.trim()) {
    try {
      const parsed = parseProgramDateTime(timeInput, snapshot.next.timeZone);
      if (parsed.getTime() <= nowMs) {
        timingIssue = "past_or_invalid";
      } else if (
        futureTuteeOpening &&
        parsed.getTime() > futureTuteeOpening.getTime()
      ) {
        timingIssue = "after_tutee_opening";
      }
    } catch {
      timingIssue = "past_or_invalid";
    }
  }

  const stagedFeatureCount = (
    snapshot.next.refreshEvidence.stagedFeatures ?? []
  ).filter((feature) => feature.pendingEnabled !== null).length;

  const hasActiveOrAttentionSchedule =
    !!snapshot.schedule &&
    ["SCHEDULED", "BLOCKED", "FAILED"].includes(snapshot.schedule.state);

  return {
    changed,
    stalePreparation,
    sourceMismatch,
    effectiveTuteeOpening,
    futureTuteeOpening,
    schedulePhase,
    timingIssue,
    stagedFeatureCount,
    hasActiveOrAttentionSchedule,
  };
}

/** Read-only status badge for the unified Program Refresh header. */
export function RefreshStatusBadge({
  schedule,
  phase,
}: {
  schedule: Schedule | null;
  phase: SchedulePhase;
}) {
  const t = useTranslations("scheduledRefresh");
  if (phase === "scheduled") {
    return <span className="badge-green">{t("states.SCHEDULED")}</span>;
  }
  if (phase === "due") {
    return <span className="badge-green">{t("dueBadge")}</span>;
  }
  if (phase === "retrying") {
    return (
      <span className="badge-amber">
        {t("retryingBadge", { attempts: schedule?.attempts ?? 1 })}
      </span>
    );
  }
  if (phase === "blocked") {
    return <span className="badge-amber">{t("states.BLOCKED")}</span>;
  }
  if (phase === "failed") {
    return <span className="badge-red">{t("states.FAILED")}</span>;
  }
  if (phase === "cancelled") {
    return <span className="badge-slate">{t("states.CANCELLED")}</span>;
  }
  if (phase === "completed") {
    return <span className="badge-green">{t("states.COMPLETED")}</span>;
  }
  return <span className="badge-slate">{t("notScheduledBadge")}</span>;
}

/** Read-only overview of the current scheduled refresh and every run condition
 * that must hold before automatic or immediate activation can proceed. */
export function RefreshScheduleOverview({
  liveSchedule,
  snapshot,
  conditions,
  readFailed,
  allowed,
  applies,
  approvalId,
}: {
  liveSchedule: Schedule | null;
  snapshot: RefreshSnapshot;
  conditions: RefreshConditionsState;
  readFailed: boolean;
  allowed: boolean;
  applies: boolean;
  approvalId?: string;
}) {
  const t = useTranslations("scheduledRefresh");
  const locale = useLocale();
  const format = (at: Date | string, zone: string) =>
    formatRefreshDateTime(at, zone, locale);

  const syncBadge =
    conditions.changed || conditions.sourceMismatch
      ? { className: "badge-amber", label: t("conditionSyncChanged") }
      : readFailed
        ? { className: "badge-red", label: t("conditionSyncError") }
        : { className: "badge-green", label: t("conditionSyncReady") };

  const openingsBadge = conditions.stalePreparation
    ? { className: "badge-amber", label: t("conditionOpeningsStale") }
    : { className: "badge-green", label: t("conditionOpeningsReady") };

  const featuresBadge =
    conditions.stagedFeatureCount > 0
      ? {
          className: "badge-amber",
          label: t("conditionFeaturesPending", {
            count: conditions.stagedFeatureCount,
          }),
        }
      : { className: "badge-slate", label: t("conditionFeaturesNone") };

  const authBadge = approvalId
    ? { className: "badge-amber", label: t("conditionAuthPending") }
    : conditions.schedulePhase === "blocked" &&
        liveSchedule?.blockedReason === "SCHEDULED_REFRESH_HEAD_CHANGED"
      ? { className: "badge-amber", label: t("conditionAuthChanged") }
      : ["scheduled", "due", "retrying"].includes(conditions.schedulePhase)
        ? { className: "badge-green", label: t("conditionAuthApproved") }
        : applies
          ? { className: "badge-slate", label: t("conditionAuthDirect") }
          : allowed
            ? { className: "badge-slate", label: t("conditionAuthRequest") }
            : { className: "badge-slate", label: t("conditionAuthReadOnly") };

  const statusTone =
    conditions.schedulePhase === "scheduled" ||
    conditions.schedulePhase === "due"
      ? "border-green-200 bg-green-50/70 text-slate-900"
      : conditions.schedulePhase === "retrying" ||
          conditions.schedulePhase === "blocked"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : conditions.schedulePhase === "failed"
          ? "border-red-200 bg-red-50 text-red-950"
          : "border-slate-200 bg-slate-50 text-slate-900";

  return (
    <div className="space-y-5">
      {/* Live scheduled refresh status */}
      <div className={`space-y-2 rounded-lg border p-4 ${statusTone}`}>
        {liveSchedule && conditions.schedulePhase !== "none" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                {conditions.schedulePhase === "scheduled"
                  ? t("statusReady")
                  : conditions.schedulePhase === "due"
                    ? t("statusDue")
                    : conditions.schedulePhase === "retrying"
                      ? t("statusRetrying", {
                          attempts: liveSchedule.attempts ?? 1,
                        })
                      : conditions.schedulePhase === "blocked" ||
                          conditions.schedulePhase === "failed"
                        ? `${t("statusPaused")} — ${t(`states.${liveSchedule.state}`)}`
                        : t(`states.${liveSchedule.state}`)}
              </p>
            </div>
            <p className="text-sm">
              {t("summary", {
                target: formatScheduleDestination(liveSchedule),
                time: format(liveSchedule.executeAt, liveSchedule.timeZone),
                zone: liveSchedule.timeZone,
              })}
            </p>
            {conditions.schedulePhase === "scheduled" && (
              <p className="text-sm text-slate-700">{t("statusReadyHelp")}</p>
            )}
            {conditions.schedulePhase === "due" && (
              <p className="text-sm text-slate-700">{t("statusDueHelp")}</p>
            )}
            {conditions.schedulePhase === "retrying" && (
              <p className="text-sm text-amber-900">{t("statusRetryingHelp")}</p>
            )}
            {(conditions.schedulePhase === "blocked" ||
              conditions.schedulePhase === "failed") && (
              <p className="text-sm">
                {liveSchedule.blockedReason &&
                t.has(`errors.${liveSchedule.blockedReason}`)
                  ? t(`errors.${liveSchedule.blockedReason}`)
                  : t("blockedHelp")}
              </p>
            )}
            {conditions.schedulePhase === "cancelled" && (
              <p className="muted text-sm">{t("noneHelp")}</p>
            )}
          </>
        ) : (
          <>
            <p className="font-medium text-slate-900">{t("none")}</p>
            <p className="muted text-sm">{t("noneHelp")}</p>
          </>
        )}
      </div>

      {/* Run conditions & reviewed snapshot */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            {t("conditionsHeading")}
          </h3>
          <p className="muted mt-1 text-sm">{t("conditionsHelp")}</p>
        </div>

        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-4">
          <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span className="font-medium text-slate-700">
              {t("conditionSync")}
            </span>
            <span className={syncBadge.className}>{syncBadge.label}</span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span className="font-medium text-slate-700">
              {t("conditionOpenings")}
            </span>
            <span className={openingsBadge.className}>
              {openingsBadge.label}
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span className="font-medium text-slate-700">
              {t("conditionFeatures")}
            </span>
            <span className={featuresBadge.className}>
              {featuresBadge.label}
            </span>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span className="font-medium text-slate-700">
              {t("conditionAuth")}
            </span>
            <span className={authBadge.className}>{authBadge.label}</span>
          </li>
        </ul>

        <NextRecruitmentReview snapshot={snapshot.next} />

        <DisclosureSection title={t("effectsDisclosure")} lifetime="lazy">
          <div className="space-y-3">
            <ProgramRefreshEffects target={snapshot.next.target} />
            <p className="muted text-sm">{t("staleHelp")}</p>
          </div>
        </DisclosureSection>
      </div>
    </div>
  );
}
