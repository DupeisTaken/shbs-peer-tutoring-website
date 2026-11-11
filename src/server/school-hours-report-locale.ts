export type SchoolHoursReportLocale = "en" | "zh";

/** Only the two maintained report languages are accepted. Callers choose their
 * fallback when parsing returns undefined; raw query text never becomes copy or URLs. */
export function parseSchoolHoursReportLocale(
  value: string | null | undefined,
): SchoolHoursReportLocale | undefined {
  return value === "en" || value === "zh" ? value : undefined;
}

export function schoolHoursReportText(
  locale: SchoolHoursReportLocale | undefined,
  english: string,
  chinese: string,
) {
  return locale === "en"
    ? english
    : locale === "zh"
      ? chinese
      : `${english} / ${chinese}`;
}
