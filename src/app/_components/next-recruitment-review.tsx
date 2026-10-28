"use client";

import { useLocale, useTranslations } from "next-intl";
import type { RecruitmentAudience } from "~/lib/recruitment";
import type { NextRecruitmentSettingsData } from "./next-recruitment-settings";

/** Used by preparation, refresh and immutable approval evidence. Dates always
 * use the captured program zone rather than the reviewer's computer timezone. */
export function NextRecruitmentReview({ snapshot, audience, compact = false, proposedOpening }: {
  snapshot: Pick<NextRecruitmentSettingsData, "target" | "currentName" | "nextName" | "timeZone" | "preparations"> & { refreshEvidence?: Pick<NextRecruitmentSettingsData["refreshEvidence"], "destination" | "stagedFeatures"> };
  audience?: RecruitmentAudience;
  compact?: boolean;
  proposedOpening?: Date | null;
}) {
  const t = useTranslations("nextRecruitment");
  const features = useTranslations("admin.program.features.name");
  const locale = useLocale();
  const opening = (value: Date | null | undefined) => value
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: snapshot.timeZone }).format(new Date(value))
    : t("noRestriction");
  const audiences = audience ? [audience] : ["tutor", "tutee"] as const;
  return <div className="space-y-3 text-sm">
    <dl className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
      <div><dt className="muted text-xs">{t("source")}</dt><dd className="mt-1 font-medium">{snapshot.currentName}</dd></div>
      {!compact && <div><dt className="muted text-xs">{t("target")}</dt><dd className="mt-1 font-medium">{snapshot.nextName}</dd></div>}
      <div><dt className="muted text-xs">{t("mode")}</dt><dd className="mt-1">{t(snapshot.target.semesterMode ? "semesterMode" : "quarterMode")}</dd></div>
      <div><dt className="muted text-xs">{t("timeZone")}</dt><dd className="mt-1 break-words">{snapshot.timeZone}</dd></div>
    </dl>
    <dl className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {audiences.map((key) => {
        const row = snapshot.preparations[key];
        return <div key={key}>
          <dt className="text-xs font-medium text-slate-600">{t(compact ? "savedOpening" : key)}</dt>
          <dd className="mt-1 font-medium text-slate-900">{row ? opening(row.opensAt) : t("notPrepared")}</dd>
          {!row && <dd className="muted mt-1 text-xs">{t("defaultHelp")}</dd>}
          {!compact && proposedOpening === undefined && <dd className="muted mt-1 text-xs">{t("resultOpening", { value: opening(row ? row.opensAt : snapshot.refreshEvidence?.destination?.[key].opensAt) })}</dd>}
          {!compact && proposedOpening === undefined && <dd className="muted mt-1 text-xs">{t(snapshot.refreshEvidence?.destination?.[key].enabled === false ? "switchDisabled" : "switchEnabled")}</dd>}
          {!compact && proposedOpening === undefined && snapshot.refreshEvidence?.destination?.[key].closesAt && <dd className="muted mt-1 text-xs">{t("preservedClosing", { value: opening(snapshot.refreshEvidence.destination[key].closesAt) })}</dd>}
          {row && !row.matchesTarget && <dd className="mt-1 text-xs text-amber-800">{t("boundElsewhere", { year: row.target.destinationSchoolYear, quarter: row.target.destinationQuarter })}</dd>}
          {row && row.timeZone !== snapshot.timeZone && <dd className="muted mt-1 text-xs">{t("originalZone", { zone: row.timeZone })}</dd>}
        </div>;
      })}
      {proposedOpening !== undefined && <div className="border-t border-slate-200 pt-3"><dt className="text-xs font-medium text-slate-600">{t("proposedOpening")}</dt><dd className="mt-1 font-semibold">{opening(proposedOpening)}</dd></div>}
    </dl>
    {!compact && !audience && snapshot.refreshEvidence?.stagedFeatures && <dl className="space-y-2">
      {snapshot.refreshEvidence.stagedFeatures.filter((feature) => feature.pendingEnabled !== null).map((feature) =>
        <div key={feature.key}><dt className="font-medium">{features(feature.key)}</dt>
          <dd>{t(feature.pendingEnabled ? "featureAfterRefreshEnabled" : "featureAfterRefreshDisabled")}</dd></div>,
      )}
    </dl>}
    {!compact && <p className="muted text-sm">{t("elapsedHelp")}</p>}
  </div>;
}
