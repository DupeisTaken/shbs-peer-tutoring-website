"use client";

import { useLocale, useTranslations } from "next-intl";
import type { RouterOutputs } from "~/trpc/react";
import { parseProgramDateTime } from "~/lib/program-time";
import { quarterSemester } from "~/lib/period";
import type { NextRecruitmentSettingsData } from "./next-recruitment-settings";

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

export type StagedFeatureChange = {
  key: string;
  pendingEnabled: boolean;
};

export type RefreshConditionsState = {
  changed: boolean;
  stalePreparation: boolean;
  sourceMismatch: boolean;
  effectiveTuteeOpening: Date | null;
  futureTuteeOpening: Date | null;
  schedulePhase: SchedulePhase;
  timingIssue: "past_or_invalid" | "after_tutee_opening" | null;
  stagedFeatures: StagedFeatureChange[];
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

  const stagedFeatures: StagedFeatureChange[] = (
    snapshot.next.refreshEvidence.stagedFeatures ?? []
  )
    .filter(
      (
        feature,
      ): feature is typeof feature & { pendingEnabled: boolean } =>
        feature.pendingEnabled !== null,
    )
    .map((feature) => ({
      key: feature.key,
      pendingEnabled: feature.pendingEnabled,
    }));

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
    stagedFeatures,
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

/** Compact status and active-condition summary: surfaces only essential live
 * schedule state, staged feature switches, and blockers without redundant chrome. */
export function RefreshScheduleOverview({
  liveSchedule,
  conditions,
}: {
  liveSchedule: Schedule | null;
  conditions: RefreshConditionsState;
}) {
  const t = useTranslations("scheduledRefresh");
  const featureNames = useTranslations("admin.program.features.name");
  const featureState = useTranslations("admin.program.features");
  const locale = useLocale();
  const format = (at: Date | string, zone: string) =>
    formatRefreshDateTime(at, zone, locale);

  const hasScheduleCard =
    liveSchedule &&
    ["scheduled", "due", "retrying", "blocked", "failed"].includes(
      conditions.schedulePhase,
    );

  const statusTone =
    conditions.schedulePhase === "scheduled" ||
    conditions.schedulePhase === "due"
      ? "border-green-200 bg-green-50/70 text-slate-900"
      : conditions.schedulePhase === "retrying" ||
          conditions.schedulePhase === "blocked"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-red-200 bg-red-50 text-red-950";

  return (
    <div className="space-y-3">
      {hasScheduleCard ? (
        <div className={`space-y-1.5 rounded-lg border px-4 py-3 text-sm ${statusTone}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-semibold">
              {conditions.schedulePhase === "scheduled"
                ? t("statusReady")
                : conditions.schedulePhase === "due"
                  ? t("statusDue")
                  : conditions.schedulePhase === "retrying"
                    ? t("statusRetrying", {
                        attempts: liveSchedule.attempts ?? 1,
                      })
                    : `${t("statusPaused")} — ${t(`states.${liveSchedule.state}`)}`}
            </p>
            <p className="font-medium">
              {t("summary", {
                target: formatScheduleDestination(liveSchedule),
                time: format(liveSchedule.executeAt, liveSchedule.timeZone),
                zone: liveSchedule.timeZone,
              })}
            </p>
          </div>
          {conditions.schedulePhase === "scheduled" && (
            <p className="text-xs text-slate-700">{t("statusReadyHelp")}</p>
          )}
          {conditions.schedulePhase === "due" && (
            <p className="text-xs text-slate-700">{t("statusDueHelp")}</p>
          )}
          {conditions.schedulePhase === "retrying" && (
            <p className="text-xs text-amber-900">{t("statusRetryingHelp")}</p>
          )}
          {(conditions.schedulePhase === "blocked" ||
            conditions.schedulePhase === "failed") && (
            <p className="text-xs">
              {liveSchedule.blockedReason &&
              t.has(`errors.${liveSchedule.blockedReason}`)
                ? t(`errors.${liveSchedule.blockedReason}`)
                : t("blockedHelp")}
            </p>
          )}
        </div>
      ) : (
        <p className="muted text-sm">{t("none")}</p>
      )}

      {conditions.stagedFeatures.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-950">
          <span className="font-semibold">{t("conditionFeatures")}:</span>
          {conditions.stagedFeatures.map((feature) => (
            <span key={feature.key} className="badge-amber">
              {featureNames(feature.key)}:{" "}
              {featureState(feature.pendingEnabled ? "on" : "off")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
