"use client";

import { useTranslations } from "next-intl";
import { crossesSemester, crossesYear, quarterSemester } from "~/lib/period";
import type { NextRecruitmentTarget } from "~/lib/next-recruitment";

/** Settings and Head approval render consequences from the same immutable
 * source/destination evidence; current mode and calendar reads are irrelevant. */
export function ProgramRefreshEffects({ target }: { target: NextRecruitmentTarget }) {
  const t = useTranslations("admin.program");
  const nextText = useTranslations("nextRecruitment");
  const source = { schoolYear: target.sourceSchoolYear, quarter: target.sourceQuarter };
  const destination = { schoolYear: target.destinationSchoolYear, quarter: target.destinationQuarter };
  const semesterCross = crossesSemester(source, destination);
  const yearCross = crossesYear(source, destination);
  const graduates = target.semesterMode ? yearCross : destination.quarter === "Q4";
  return <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
    <li>{t("effectTutees")}</li><li>{t("effectPairings")}</li>
    {semesterCross && <li>{t("effectReactivate")}</li>}
    {graduates && <li>{nextText("graduationHelp")}</li>}
    {yearCross && <li>{nextText("academicReconfirm")}</li>}
    <li>{semesterCross ? t("effectHoursReset", { semester: quarterSemester(destination.quarter) }) : t("effectHoursKeep")}</li>
    <li>{nextText("historyHelp")}</li>
  </ul>;
}
