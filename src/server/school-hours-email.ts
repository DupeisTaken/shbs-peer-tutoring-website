import { DEFAULT_BRANDING } from "~/lib/branding-config";
import { normalizeEmailLocale, type EmailLocale } from "~/lib/email-locale";
import {
  formatSchoolHours,
  formatSchoolHoursCarryMinutes,
  schoolHoursApproximation,
  schoolHoursRoundedDuration,
} from "~/lib/school-hours-format";
import { schoolHoursVisibleRows } from "~/lib/school-hours-visibility";
import {
  schoolHoursPriorEditions,
  type SchoolHoursPriorEdition,
} from "~/lib/school-hours-corrections";

export type SchoolHoursPublicRow = {
  exportName: string;
  schoolAccountKey: string;
  tutoringChange: number;
  crewChange: number;
  hoursToAdd: number;
  monthAmount: number;
  previousEditionAmount: number | null;
  previousMonthAmount: number | null;
  monthComparison: number | null;
  unchanged: boolean;
  priorEditions?: SchoolHoursPriorEdition[];
  carryInHours?: string;
  carryOutHours?: string;
};
export type SchoolHoursPublicReport = {
  month: string;
  revision: number;
  generatedAt: string;
  timeZone: string;
  includeStatistics: boolean;
  postingPolicy?: "TENTH_HOUR_CARRY" | "TENTH_HOUR_CARRY_NONNEGATIVE";
  rows: SchoolHoursPublicRow[];
  totals: {
    people: number;
    tutoringChange: number;
    crewChange: number;
    hoursToAdd: number;
    monthAmount: number;
  };
};

export const escapeSchoolHours = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

export function schoolHoursHeading(month: string) {
  const label = new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
  return `The Program ${label} Report is ready`;
}

function editionGuidance(report: SchoolHoursPublicReport) {
  if (report.postingPolicy === "TENTH_HOUR_CARRY_NONNEGATIVE") {
    const needsReductionReview = report.rows.some(
      (row) =>
        row.monthAmount < 0 ||
        schoolHoursPriorEditions(row, report.revision).some(
          (edition) => edition.correctionToCurrent < 0,
        ),
    );
    const negativeGuard = needsReductionReview
      ? {
          en: " If an earlier-edition correction or replacement amount is negative, contact the program team before posting.",
          zh: "若较早版本对应的更正额或替代时数为负数，请先联系项目团队。",
        }
      : { en: "", zh: "" };
    return report.revision > 1
      ? `If r${report.revision - 1} was last entered for that person, apply only the highlighted correction once. Otherwise open that person's Details and choose ONE matching row. If the last entered edition is unknown, contact the program team before posting.${negativeGuard.en}\n若该人最后入账的是 r${report.revision - 1}，仅应用突出显示的更正额一次。其他情况请打开该人的详情并仅选符合情况的一项；若不确定最后入账版本，请先联系项目团队。${negativeGuard.zh}`
      : "Apply each person's highlighted amount to that person's school account once. Raw tutoring and Crew changes explain the source activity; they are not extra credit.\n请将每个人突出显示的时数计入对应学校账户一次。辅导与执勤的原始变化用于说明来源，并非额外入账时数。";
  }
  if (report.revision === 1 && report.postingPolicy === "TENTH_HOUR_CARRY")
    return "Apply each person's highlighted amount to that person's school account once. Negative amounts deduct hours. Raw tutoring and Crew changes explain the source activity; they are not extra credit.\n请将每个人突出显示的时数计入对应学校账户一次。负数表示扣减；辅导与执勤的原始变化用于说明来源，并非额外入账时数。";
  return report.revision > 1
    ? `Revision ${report.revision} replaces revision ${report.revision - 1} for ${report.month}. If the immediately preceding edition was applied, apply only each person's highlighted correction. For an earlier applied edition, open that person's Details and choose its correction. If nothing was applied, use the replacement month amount once. Choose only one matching row; never add alternatives. If unknown or not listed, ask the program team before posting. Negative corrections are deductions.\n本修订替代该月上一版本。若上一版已入账，仅应用突出显示的更正额；若更早版本已入账，请打开该人的详情选择对应更正额。若从未入账，使用替代月度时数一次。仅选符合情况的一项，切勿相加。若不确定或版本未列出，请先联系项目团队。负数更正应扣除。`
    : "Apply each person's highlighted amount to that person's school account once. A negative amount is a correction to deduct. Tutoring and Crew are the breakdown, not additional amounts to add again.\n请将每个人突出显示的时数计入该人的学校账户一次。负数表示应扣除的更正额；辅导与执勤仅为总额明细，不应再次相加。";
}

const carryNotice = {
  en: "School hours are posted in 0.1 h (6 min) increments. Any remainder is retained automatically for a later report; do not enter it separately.",
  zh: "学校时数以 0.1 小时（6 分钟）为单位入账，余量自动保留至后续报告，请勿另行入账。",
};

const nonnegativeCarryNotice = {
  en: "School hours are posted in 0.1 h (6 min) increments. A 0 means nothing to enter now. Any remainder is retained automatically. The full negative balance automatically offsets future earned hours; do not enter carry separately.",
  zh: "学校时数以 0.1 小时（6 分钟）为单位入账。0 表示本次无需入账。余量自动保留；负数余额全额结转，自动抵扣今后获得的时数，请勿另行入账。",
};

const nonnegativePublicCarryNotice = {
  en: "Post in 0.1 h (6 min) increments. 0 means nothing to enter. Positive carry is retained; the full negative balance automatically offsets future earned hours. Never enter carry separately.",
  zh: "按 0.1 小时（6 分钟）入账；0 表示无需入账。正余量保留，全部负数余额自动抵扣今后获得的时数。请勿另行计入余量。",
};

function carryValueHtml(hours: string | undefined) {
  const e = escapeSchoolHours;
  return hours === undefined
    ? '<span title="Not recorded in this earlier report / 此历史报告未记录余量">—</span>'
    : `<span title="${e(hours)} h">${e(formatSchoolHoursCarryMinutes(hours))} min / 分钟</span>`;
}

export function schoolHoursIssuedTime(report: SchoolHoursPublicReport) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: report.timeZone,
  }).format(new Date(report.generatedAt));
}

function individualInstruction(
  row: SchoolHoursPublicRow,
  revision: number,
  carryPolicy = false,
) {
  if (carryPolicy && row.hoursToAdd === 0)
    return revision > 1
      ? `Nothing to enter now if r${revision - 1} was last applied / 若最后入账的是 r${revision - 1}，本次无需入账`
      : "Nothing to enter now / 本次无需入账";
  if (revision > 1)
    return row.unchanged
      ? `Unchanged since r${revision - 1}; do not reapply if that edition was applied / 与 r${revision - 1} 相比无变化，若该版已入账请勿重复应用`
      : `Correction only if r${revision - 1} was last applied / 仅当最后入账的是 r${revision - 1} 时使用此更正额`;
  return row.unchanged
    ? "Unchanged — do not apply again / 无变化，请勿重复入账"
    : row.hoursToAdd < 0
      ? "Correction to deduct from this account / 从该账户扣除的更正额"
      : "Hours to add to this account / 应计入该账户的时数";
}

function editionChoicesHtml(
  row: SchoolHoursPublicRow,
  revision: number,
  nonnegativePolicy = false,
) {
  const e = escapeSchoolHours;
  const choices = schoolHoursPriorEditions(row, revision)
    .map(
      (edition) =>
        `<tr><th scope="row" style="text-align:left;padding:9px;border-bottom:1px solid #CBD5E1;overflow-wrap:anywhere;word-break:break-word">r${edition.revision} (${e(formatSchoolHours(edition.monthAmount, true))} h)</th><td style="padding:9px;border-bottom:1px solid #CBD5E1;font-weight:700;overflow-wrap:anywhere;word-break:break-word">${e(formatSchoolHours(edition.correctionToCurrent, true))} h</td></tr>`,
    )
    .join("");
  // The report introduction owns the complete posting rules. Each person's table
  // keeps the exact alternatives and one-choice instruction without repeating them.
  // Fixed columns and inline wrapping keep full-precision values inside narrow cards.
  return `<div style="margin-top:16px"><p style="font-weight:700">Choose one matching row / 仅选符合情况的一项</p><table class="edition-choices" style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:14px"><thead><tr><th style="text-align:left;padding:9px;overflow-wrap:anywhere;word-break:break-word">Last applied edition / 最后入账版本</th><th style="text-align:left;padding:9px;overflow-wrap:anywhere;word-break:break-word">${nonnegativePolicy ? "Correction from that edition / 相对该版的更正额" : "Correction to apply now / 现在应应用的更正额"}</th></tr></thead><tbody>${choices}<tr><th scope="row" style="text-align:left;padding:9px;overflow-wrap:anywhere;word-break:break-word">Nothing applied / 从未入账</th><td style="padding:9px;font-weight:700;overflow-wrap:anywhere;word-break:break-word">${e(formatSchoolHours(row.monthAmount, true))} h once / 一次</td></tr></tbody></table></div>`;
}

function schoolHoursValueHtml(value: number) {
  const exact = escapeSchoolHours(formatSchoolHours(value, true));
  const approximation = schoolHoursApproximation(value, true);
  if (approximation === null) return `${exact} h`;
  return `<span style="display:block">≈ ${escapeSchoolHours(approximation)} h <span style="font-size:12px;font-weight:400">(approximate / 约数)</span></span><span style="display:block;font-size:13px;font-weight:400;overflow-wrap:anywhere">Exact / 精确值: ${exact} h</span>`;
}

function durationLabel(value: number) {
  const duration = schoolHoursRoundedDuration(value, true);
  return `${duration.sign}${duration.hours} h ${duration.minutes} min`;
}

/** This view accepts only the public hours projection. It cannot accidentally
 * recover source evidence, private reasons or the intended recipient list. */
export function renderSchoolHoursContent(
  sourceReport: SchoolHoursPublicReport,
) {
  const rows = schoolHoursVisibleRows(sourceReport);
  const report = {
    ...sourceReport,
    totals: { ...sourceReport.totals, people: rows.length },
  };
  const e = escapeSchoolHours;
  const nonnegativePolicy =
    report.postingPolicy === "TENTH_HOUR_CARRY_NONNEGATIVE";
  const carryPolicy =
    report.postingPolicy === "TENTH_HOUR_CARRY" || nonnegativePolicy;
  const policyNotice = nonnegativePolicy
    ? nonnegativePublicCarryNotice
    : carryNotice;
  const tutoringLabel = carryPolicy
    ? "Raw tutoring change / 辅导原始变化"
    : "Tutoring net / 辅导净额";
  const crewLabel = carryPolicy
    ? "Raw Crew change / 执勤原始变化"
    : "Crew / 执勤";
  const cards = rows
    .map((row) => {
      const instruction = individualInstruction(
        row,
        report.revision,
        carryPolicy,
      );
      const rawChange = row.tutoringChange + row.crewChange;
      const duration = schoolHoursRoundedDuration(rawChange, true);
      const rawDuration = `${duration.sign}${duration.hours} h ${duration.minutes} min`;
      // The four summary fields explain the balance; source precision and
      // alternative revision instructions remain in this person's disclosure.
      return `<section class="person" style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:12px;padding:18px;margin:14px 0;color:#0F172A"><h2 style="font-size:19px;margin:0 0 6px;overflow-wrap:anywhere">${e(row.exportName)}</h2><p style="font-size:13px;color:#475569;margin:0 0 12px;overflow-wrap:anywhere">School account / 学校账户: ${e(row.schoolAccountKey)}</p><dl class="school-summary"><div><dt>Carry In / 期初余量</dt><dd>${carryValueHtml(carryPolicy ? row.carryInHours : undefined)}</dd></div><div><dt>Raw Change / 原始变化<span style="display:block;font-size:11px">Rounded to min / 四舍五入至分钟</span></dt><dd class="raw-duration" title="Rounded to nearest minute / 四舍五入至分钟">${e(rawDuration)}</dd></div><div class="posting"><dt>Hours / 入账时数</dt><dd style="font-size:24px;font-weight:750;color:${row.hoursToAdd < 0 ? "#B42318" : row.hoursToAdd === 0 ? "#475569" : "#115E59"}">${schoolHoursValueHtml(row.hoursToAdd)}</dd><p style="margin:5px 0 0;font-size:13px;line-height:1.6">${e(instruction)}</p></div><div><dt>Carry Out / 留待后续</dt><dd>${carryValueHtml(carryPolicy ? row.carryOutHours : undefined)}</dd></div></dl><details class="person-details"><summary style="cursor:pointer;min-height:44px;padding:12px 0;font-weight:650">Details / 详情</summary><p style="font-size:14px;line-height:1.7">Raw Change combines tutoring and Crew; its summary is rounded to the nearest minute. Exact hours below and in CSV are unchanged.<br>原始变化合计辅导与执勤，摘要四舍五入至分钟；下方及 CSV 中的精确时数保持不变。</p><p style="font-size:14px;margin:0;line-height:1.7">${e(tutoringLabel)}: <strong>${e(durationLabel(row.tutoringChange))}</strong><br>Exact tutoring hours / 精确辅导时数: ${e(formatSchoolHours(row.tutoringChange, true))} h<br>${e(crewLabel)}: <strong>${e(durationLabel(row.crewChange))}</strong><br>Exact Crew hours / 精确执勤时数: ${e(formatSchoolHours(row.crewChange, true))} h<br>Exact Raw Change / 精确原始变化: <strong>${e(formatSchoolHours(rawChange, true))} h</strong>${carryPolicy ? `<br>Exact Carry In / 精确期初余量: ${e(row.carryInHours ?? "—")} h<br>Exact Carry Out / 精确期末余量: ${e(row.carryOutHours ?? "—")} h` : ""}</p>${report.revision > 1 ? `<p style="font-size:14px;border-top:1px solid #CBD5E1;margin:12px 0 0;padding-top:12px">Previous edition amount / 上版时数: ${e(row.previousEditionAmount === null ? "—" : `${formatSchoolHours(row.previousEditionAmount, true)} h`)}<br>Replacement month amount / 替代月度时数: <strong>${e(formatSchoolHours(row.monthAmount, true))} h</strong></p>${editionChoicesHtml(row, report.revision, nonnegativePolicy)}` : ""}</details></section>`;
    })
    .join("");
  const comparisons = rows
    .filter((row) => row.previousMonthAmount !== null)
    .map(
      (row) =>
        `<tr><th scope="row" style="text-align:left;padding:10px;border-bottom:1px solid #CBD5E1;overflow-wrap:anywhere;word-break:break-word">${e(row.exportName)}</th><td style="padding:10px;border-bottom:1px solid #CBD5E1;overflow-wrap:anywhere;word-break:break-word">${e(row.previousMonthAmount === null ? "—" : formatSchoolHours(row.previousMonthAmount))}</td><td style="padding:10px;border-bottom:1px solid #CBD5E1;overflow-wrap:anywhere;word-break:break-word">${e(formatSchoolHours(row.monthAmount))}</td><td style="padding:10px;border-bottom:1px solid #CBD5E1;overflow-wrap:anywhere;word-break:break-word">${e(row.monthComparison === null ? "—" : formatSchoolHours(row.monthComparison, true))}</td></tr>`,
    )
    .join("");
  return `<p style="line-height:1.7;color:#475569">Month / 月份: <strong>${e(report.month)}</strong> · Revision / 版本: <strong>${report.revision}</strong><br>Issued / 发出时间: ${e(schoolHoursIssuedTime(report))} (${e(report.timeZone)})</p><div style="padding:16px;background:#EFF6FF;border-left:4px solid #2563EB;line-height:1.7">${e(editionGuidance(report)).replaceAll("\n", "<br>")}</div>${carryPolicy ? `<p style="font-size:14px;line-height:1.7;color:#475569">${e(policyNotice.en)}<br>${e(policyNotice.zh)}${nonnegativePolicy ? "" : "<br>Carry in + raw changes − posted change = carry out. / 期初余量 + 原始变化 − 本次入账 = 留待后续的余量。"}</p>${nonnegativePolicy ? `<details class="carry-explanation" style="font-size:14px;line-height:1.7;color:#475569"><summary style="cursor:pointer;padding:8px 0">How carry works / 余量计算方式</summary><p>Carry in + raw changes − posted change = carry out.<br>期初余量 + 原始变化 − 本次入账 = 留待后续的余量。</p></details>` : ""}` : ""}${cards || "<p>No individual changes in this edition. / 本版本无个人时数变化。</p>"}<p style="font-size:14px;line-height:1.7;color:#475569">This saved edition reports recorded changes; it does not confirm that the school has posted them. The email, link and download are copies of the same instruction. Late records remain eligible for a later report.<br>此报告记录已录入的变化，不代表学校已完成入账。邮件、链接与下载均为同一指示的副本。迟交记录仍可纳入后续报告。</p>${comparisons ? `<details style="margin-top:20px"><summary style="cursor:pointer;font-weight:650;padding:12px 0">Previous-month comparison / 与上月比较 · informational only / 仅供参考</summary><p>These differences compare monthly report amounts. They are not additional credits or deductions for any account.<br>此差异仅比较月度报告时数，不应作为额外时数或扣减入账。</p><div style="overflow-x:auto"><table class="month-comparison" style="border-collapse:collapse;table-layout:fixed;width:100%;font-size:14px"><thead><tr><th style="text-align:left;overflow-wrap:anywhere;word-break:break-word">Individual / 个人</th><th style="overflow-wrap:anywhere;word-break:break-word">Previous month / 上月</th><th style="overflow-wrap:anywhere;word-break:break-word">This month / 本月</th><th style="overflow-wrap:anywhere;word-break:break-word">Difference / 差异</th></tr></thead><tbody>${comparisons}</tbody></table></div></details>` : ""}${report.includeStatistics ? `<details style="margin-top:20px"><summary style="cursor:pointer;font-weight:650;padding:12px 0">Optional program statistics / 项目统计（可选）</summary><p>${report.totals.people} individuals / 人 · ${e(carryPolicy ? "Raw tutoring change / 辅导原始变化" : "Tutoring / 辅导")}: ${e(formatSchoolHours(report.totals.tutoringChange, true))} h · ${e(crewLabel)}: ${e(formatSchoolHours(report.totals.crewChange, true))} h · ${e(carryPolicy ? "Posted changes / 入账变化" : "Net changes / 净变化")}: ${e(formatSchoolHours(report.totals.hoursToAdd, true))} h</p><p>Program statistics are not an amount to apply to any one account. / 项目统计不可计入任何单一个人账户。</p></details>` : ""}`;
}

/** Email is the concise posting instruction; the saved report retains every
 * component and prior-edition alternative. Keep each person's exact delta once:
 * neither repetition nor display rounding may change the amount to enter. */
export function schoolHoursEmailCopy(input: {
  /** Supplied by live callers; isolated previews need no server environment. */
  brand?: string;
  locale?: EmailLocale;
  report: SchoolHoursPublicReport;
  reportUrl: string;
  preview?: boolean;
}) {
  const { report, reportUrl, preview } = input;
  const locale = normalizeEmailLocale(input.locale);
  const e = escapeSchoolHours;
  const rows = schoolHoursVisibleRows(report);
  const nonnegativePolicy =
    report.postingPolicy === "TENTH_HOUR_CARRY_NONNEGATIVE";
  const carryPolicy =
    report.postingPolicy === "TENTH_HOUR_CARRY" || nonnegativePolicy;
  const policyNotice = nonnegativePolicy ? nonnegativeCarryNotice : carryNotice;
  const revised = report.revision > 1;
  const previousRevision = report.revision - 1;
  const monthDate = new Date(`${report.month}-01T00:00:00Z`);
  const month = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(monthDate);
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthDate);
  const copy =
    locale === "zh"
      ? {
          heading: `项目${month}报告已就绪`,
          revision: `第 ${report.revision} 版`,
          replaces: `替代第 ${previousRevision} 版`,
          issued: "发出时间",
          action: "查看月度报告",
          preview: "仅供预览",
          account: "学校账户",
          unit: "小时",
          guidanceTitle: revised
            ? `仅适用于最后入账第 ${previousRevision} 版的个人`
            : "每人时数仅入账一次",
          guidance: revised
            ? "若入账的是更早版本或从未入账，请在报告中选择该人的入账时数。若不确定最后入账版本，请先联系项目团队。每项更正仅应用一次，负数表示扣减。"
            : "请将下方时数计入对应学校账户。负数表示扣减；报告中的分类明细已包含在此时数内。",
          unchanged: `无新增变化；若已入账第 ${previousRevision} 版，请勿重复入账。`,
          zeroNet: "净变化为零；明细请查看报告。",
          empty: "本版本无个人时数变化。",
          details: revised
            ? "报告保留历史版本更正选项、分类明细及 CSV 下载。"
            : "分类明细及 CSV 下载保留在报告中。",
          receipt:
            "邮件、报告与 CSV 记录同一次更新。邮件送达不代表学校已完成入账。",
          privacy:
            "持有报告链接的人无需账户即可查看，请仅与预期学校收件人分享。",
        }
      : {
          heading: schoolHoursHeading(report.month),
          revision: `Revision ${report.revision}`,
          replaces: `Replaces Revision ${previousRevision}`,
          issued: "Issued",
          action: "View Month Report",
          preview: "preview only",
          account: "School account",
          unit: "h",
          guidanceTitle: revised
            ? `Use these changes only if Revision ${previousRevision} was last entered for that person`
            : "Hours to enter once",
          guidance: revised
            ? "For an earlier edition or no entry, choose that person's amount in the saved report. If the last entered edition is unknown, contact the program first. Apply each change once. Negative amounts deduct hours."
            : "Enter each person's signed amount in the named school account. Negative amounts deduct hours. Component breakdowns in the report are already included.",
          unchanged: `No further change. Do not enter again if Revision ${previousRevision} was entered.`,
          zeroNet: "No net change; see the breakdown in the report.",
          empty: "No individual changes in this edition.",
          details: revised
            ? "Earlier-edition choices, breakdowns and CSV are in the saved report."
            : "Breakdowns and CSV are in the saved report.",
          receipt:
            "Email, report and CSV record the same update. Delivery does not confirm school entry.",
          privacy:
            "Anyone with the report link can view it without an account. Share only with intended school recipients.",
        };
  const subject = revised
    ? locale === "zh"
      ? `${monthLabel}学校时数报告更正 · ${copy.revision}`
      : `${monthLabel} school-hours correction · ${copy.revision}`
    : carryPolicy
      ? locale === "zh"
        ? `${monthLabel}学校时数报告 · ${copy.revision}`
        : `${monthLabel} school-hours report · ${copy.revision}`
      : copy.heading;
  if (carryPolicy && !revised)
    copy.guidance =
      locale === "zh"
        ? "请将下方时数计入对应学校账户。负数表示扣减。"
        : "Enter each person's signed amount in the named school account. Negative amounts deduct hours.";
  if (nonnegativePolicy)
    copy.guidance =
      locale === "zh"
        ? revised
          ? "若入账的是更早版本或从未入账，请在报告中选择该人的入账时数。若不确定最后入账版本，请先联系项目团队。每项更正仅应用一次。若较早版本对应的更正额为负数，请先联系项目团队。"
          : "请将下方时数计入对应学校账户一次。"
        : revised
          ? "For an earlier edition or no entry, choose that person's amount in the saved report. If the last entered edition is unknown, contact the program first. Apply each change once. If an earlier-edition correction is negative, contact the program team before posting."
          : "Enter each person's amount once in the named school account.";
  const issued = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: report.timeZone,
  }).format(new Date(report.generatedAt));
  const metadata = `${monthLabel} · ${copy.revision}${revised ? ` · ${copy.replaces}` : ""}`;
  const issuedText = `${copy.issued}: ${issued} (${report.timeZone})`;
  const status = (row: SchoolHoursPublicRow) => {
    let carried = "";
    if (carryPolicy && row.carryOutHours && Number(row.carryOutHours) !== 0) {
      const negative = Number(row.carryOutHours) < 0;
      const minutes = formatSchoolHoursCarryMinutes(
        row.carryOutHours.replace(/^-/, ""),
      );
      carried =
        locale === "zh"
          ? `${negative ? (nonnegativePolicy ? "待抵扣余额" : "待扣减余量") : "留待后续"}：${minutes} 分钟。`
          : `${negative ? (nonnegativePolicy ? "Balance to offset future earnings" : "Deduction carried forward") : "Carried forward"}: ${minutes} min.`;
    }
    if (revised && row.unchanged && !nonnegativePolicy)
      return `${copy.unchanged}${carried ? ` ${carried}` : ""}`;
    if (carryPolicy) {
      if (row.hoursToAdd !== 0) return carried;
      const zero = revised
        ? locale === "zh"
          ? `若最后入账的是第 ${previousRevision} 版，本次无需入账。`
          : `Nothing to enter now if Revision ${previousRevision} was last entered.`
        : locale === "zh"
          ? "本次无需入账。"
          : "Nothing to enter now.";
      return `${zero}${carried ? ` ${carried}` : ""}`;
    }
    if (row.hoursToAdd !== 0) return "";
    return copy.zeroNet;
  };
  const textRows = rows
    .map(
      (row) =>
        `${row.exportName}\n${copy.account}: ${row.schoolAccountKey}\n${formatSchoolHours(row.hoursToAdd, true)} ${copy.unit}${status(row) ? `\n${status(row)}` : ""}`,
    )
    .join("\n\n");
  const actionText = `${copy.action}${preview ? ` (${copy.preview})` : `: ${reportUrl}`}`;
  const text = `${copy.heading}\n${metadata}\n${issuedText}\n\n${copy.guidanceTitle}\n${copy.guidance}${carryPolicy ? `\n${policyNotice[locale]}` : ""}\n\n${textRows || copy.empty}\n\n${actionText}\n${copy.details}\n\n${copy.receipt}\n\n${copy.privacy}`;
  const cards = rows
    .map((row) => {
      const rowStatus = status(row);
      const amount = `${formatSchoolHours(row.hoursToAdd, true)} ${copy.unit}`;
      // Budget for the narrow 320px email card; CJK units need wider glyphs.
      // Inline sizing survives stylesheet removal and keeps the exact token intact.
      const widthUnits = amount.length + (locale === "zh" ? 2 : 0);
      const fontSize =
        widthUnits <= 12
          ? 30
          : widthUnits <= 18
            ? 20
            : widthUnits <= 26
              ? 16
              : 14;
      return `<section class="person" style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:12px;padding:18px;margin:14px 0;color:#0F172A"><h2 style="font-size:19px;margin:0 0 6px;overflow-wrap:anywhere">${e(row.exportName)}</h2><p style="font-size:13px;color:#475569;margin:0 0 12px;overflow-wrap:anywhere">${e(copy.account)}: ${e(row.schoolAccountKey)}</p><p class="email-amount" style="margin:0;font-size:${fontSize}px;font-weight:750;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;word-break:break-word;color:${row.hoursToAdd < 0 ? "#B42318" : row.hoursToAdd === 0 ? "#475569" : "#115E59"}"><span class="email-value" style="white-space:nowrap">${e(amount)}</span></p>${rowStatus ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.7;color:#475569">${e(rowStatus)}</p>` : ""}</section>`;
    })
    .join("");
  const actionStyle =
    "display:inline-block;background:#0D59E6;color:white;padding:12px 18px;border-radius:7px;font-weight:700";
  const action = preview
    ? `<span aria-disabled="true" style="${actionStyle}">${e(copy.action)}</span>`
    : `<a href="${e(reportUrl)}" style="${actionStyle};text-decoration:none">${e(copy.action)}</a>`;
  const inboxPreview =
    locale === "zh"
      ? revised
        ? "入账前请核对精确更正额及最后入账版本。"
        : "请核对每个学校账户的精确时数，仅入账一次。"
      : revised
        ? "Check exact changes and the last entered edition before posting."
        : "Review exact hours for each school account; enter each amount once.";
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head><body style="margin:0;background:#EAF0F7;color:#0F172A;font-family:Arial,sans-serif"><div class="email-preheader" style="display:none;max-height:0;overflow:hidden;mso-hide:all">${e(inboxPreview)}</div><main style="max-width:760px;margin:0 auto;padding:24px 16px"><p style="color:#475569;font-size:14px">${e(input.brand ?? DEFAULT_BRANDING.APP_TITLE)}</p><h1 style="font-size:28px;line-height:1.25">${e(copy.heading)}</h1><p style="line-height:1.7;color:#475569">${e(metadata)}<br>${e(issuedText)}</p><div class="email-guidance" style="padding:16px;background:#EFF6FF;border-left:4px solid #2563EB;line-height:1.7"><strong>${e(copy.guidanceTitle)}</strong><p style="margin:8px 0 0">${e(copy.guidance)}</p></div>${carryPolicy ? `<p class="email-carry-notice" style="font-size:14px;line-height:1.7;color:#475569">${e(policyNotice[locale])}</p>` : ""}${cards || `<p>${e(copy.empty)}</p>`}<p style="margin:24px 0 12px">${action}</p><p style="font-size:14px;line-height:1.7;color:#475569">${e(copy.details)}</p><p style="font-size:14px;line-height:1.7;color:#475569">${e(copy.receipt)}</p><p style="font-size:13px;line-height:1.7;color:#475569">${e(copy.privacy)}</p></main></body></html>`;
  return { subject, text, html };
}
