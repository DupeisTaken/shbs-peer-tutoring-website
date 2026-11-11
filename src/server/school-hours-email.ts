import { DEFAULT_BRANDING } from "~/lib/branding-config";
import { normalizeEmailLocale, type EmailLocale } from "~/lib/email-locale";
import {
  formatSchoolHours,
  formatSchoolHoursCarryMinutes,
  schoolHoursRoundedDuration,
} from "~/lib/school-hours-format";
import { schoolHoursVisibleRows } from "~/lib/school-hours-visibility";
import {
  schoolHoursPriorEditions,
  type SchoolHoursPriorEdition,
} from "~/lib/school-hours-corrections";
import { renderEmail } from "~/server/email/template";

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

const nonnegativePublicCarryNotice = {
  en: "Post in 0.1 h (6 min) increments. Positive carry is retained; the full negative balance automatically offsets future earned hours. Never enter carry separately.",
  zh: "按 0.1 小时（6 分钟）入账。正余量保留，全部负数余额自动抵扣今后获得的时数。请勿另行计入余量。",
};

function carryValueHtml(hours: string | undefined) {
  const e = escapeSchoolHours;
  return hours === undefined
    ? '<span aria-label="Carry not recorded / 未记录余量" title="Not recorded in this earlier report / 此历史报告未记录余量">—</span>'
    : `<span title="${e(hours)} h">${e(formatSchoolHoursCarryMinutes(hours))} min / 分钟</span>`;
}

export function schoolHoursIssuedTime(report: SchoolHoursPublicReport) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: report.timeZone,
  }).format(new Date(report.generatedAt));
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
  // The report introduction owns revised-edition posting rules. Each person's table
  // keeps the exact alternatives and one-choice instruction without repeating them.
  // Fixed columns and inline wrapping retain every exact alternative on small screens.
  return `<div style="margin-top:16px"><p style="font-weight:700">Choose one matching row / 仅选符合情况的一项</p><table class="edition-choices" style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:14px"><thead><tr><th style="text-align:left;padding:9px;overflow-wrap:anywhere;word-break:break-word">Last applied edition / 最后入账版本</th><th style="text-align:left;padding:9px;overflow-wrap:anywhere;word-break:break-word">${nonnegativePolicy ? "Correction from that edition / 相对该版的更正额" : "Correction to apply now / 现在应应用的更正额"}</th></tr></thead><tbody>${choices}<tr><th scope="row" style="text-align:left;padding:9px;overflow-wrap:anywhere;word-break:break-word">Nothing applied / 从未入账</th><td style="padding:9px;font-weight:700;overflow-wrap:anywhere;word-break:break-word">${e(formatSchoolHours(row.monthAmount, true))} h once / 一次</td></tr></tbody></table></div>`;
}

function schoolHoursValueHtml(value: number) {
  // A dash is presentation only. Snapshots, raw/carry zeroes and CSV stay numeric.
  return value === 0
    ? '<span class="no-posting" aria-label="No posting / 无需入账">—</span>'
    : `${escapeSchoolHours(formatSchoolHours(value, true))} h`;
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
  const people = rows
    .map((row) => {
      const rawChange = row.tutoringChange + row.crewChange;
      // A full-span disclosure row keeps exact evidence and correction choices
      // readable without widening a narrow Actions cell or requiring scripts.
      // Keep identity and the exact posting together while the mobile table pans.
      // Account references and first-edition instructions stay in existing Details.
      const mobileContext = `<span class="mobile-row-context" aria-hidden="true">${e(row.exportName)} · <strong>${row.hoursToAdd === 0 ? "—" : `${e(formatSchoolHours(row.hoursToAdd, true))} h`}</strong></span>`;
      return `<tbody class="person"><tr class="school-summary"><th scope="row" class="person-identity" data-label="Individual / 个人">${e(row.exportName)}</th><td class="carry-in" data-label="Carry In / 期初余量">${carryValueHtml(carryPolicy ? row.carryInHours : undefined)}</td><td class="raw-duration" data-label="Raw Change / 原始变化" title="Rounded to nearest minute / 四舍五入至分钟">${e(durationLabel(rawChange))}</td><td class="posting" data-label="Hours / 入账时数" style="color:${row.hoursToAdd < 0 ? "#B42318" : row.hoursToAdd === 0 ? "#475569" : "#115E59"}">${schoolHoursValueHtml(row.hoursToAdd)}</td><td class="carry-out" data-label="Carry Out / 留待后续">${carryValueHtml(carryPolicy ? row.carryOutHours : undefined)}</td></tr><tr class="person-detail-row"><td colspan="5"><details class="person-details"><summary aria-label="Details for ${e(row.exportName)} / ${e(row.exportName)}的详情">${mobileContext}Details / 详情</summary><div class="person-detail-content"><p class="school-account">School account / 学校账户: ${e(row.schoolAccountKey)}</p>${report.revision === 1 ? `<p class="posting-guidance">${e(editionGuidance(report)).replaceAll("\n", "<br>")}</p>` : ""}<p class="exact-posting">Exact Hours / 精确入账时数: <strong>${e(formatSchoolHours(row.hoursToAdd, true))} h</strong></p><p>${e(tutoringLabel)}: <strong>${e(durationLabel(row.tutoringChange))}</strong><br>Exact tutoring hours / 精确辅导时数: ${e(formatSchoolHours(row.tutoringChange, true))} h<br>${e(crewLabel)}: <strong>${e(durationLabel(row.crewChange))}</strong><br>Exact Crew hours / 精确执勤时数: ${e(formatSchoolHours(row.crewChange, true))} h<br>Exact Raw Change / 精确原始变化: <strong>${e(formatSchoolHours(rawChange, true))} h</strong>${carryPolicy ? `<br>Exact Carry In / 精确期初余量: ${row.carryInHours === undefined ? carryValueHtml(undefined) : `${e(row.carryInHours)} h`}<br>Exact Carry Out / 精确期末余量: ${row.carryOutHours === undefined ? carryValueHtml(undefined) : `${e(row.carryOutHours)} h`}` : ""}</p>${report.revision > 1 ? `<p>Previous edition amount / 上版时数: ${e(row.previousEditionAmount === null ? "—" : `${formatSchoolHours(row.previousEditionAmount, true)} h`)}<br>Replacement month amount / 替代月度时数: <strong>${e(formatSchoolHours(row.monthAmount, true))} h</strong>${row.unchanged ? `<br>Unchanged since r${report.revision - 1} / 与 r${report.revision - 1} 相比无变化` : ""}</p>${editionChoicesHtml(row, report.revision, nonnegativePolicy)}` : ""}</div></details></td></tr></tbody>`;
    })
    .join("");
  const table = people
    ? `<p class="table-scroll-hint">Scroll the table to see every column on a narrow screen. / 窄屏可横向滚动查看完整表格。</p><div class="school-table-scroll" role="region" aria-label="Individual school hours / 个人学校时数" tabindex="0"><table class="school-hours-table"><caption>Individual school-account changes / 个人学校账户时数变化</caption><colgroup><col style="width:27%"><col style="width:17%"><col style="width:21%"><col style="width:18%"><col style="width:17%"></colgroup><thead><tr><th scope="col">Individual / 个人</th><th scope="col">Carry In / 期初余量</th><th scope="col">Raw Change / 原始变化<span class="column-note">Rounded to min / 四舍五入至分钟</span></th><th scope="col" class="posting">Hours / 入账时数</th><th scope="col">Carry Out / 留待后续</th></tr></thead>${people}</table></div>`
    : "<p>No individual changes in this edition. / 本版本无个人时数变化。</p>";
  const comparisons = rows
    .filter((row) => row.previousMonthAmount !== null)
    .map(
      (row) =>
        `<tr><th scope="row" style="text-align:left;padding:10px;border-bottom:1px solid #CBD5E1;overflow-wrap:anywhere;word-break:break-word">${e(row.exportName)}</th><td style="padding:10px;border-bottom:1px solid #CBD5E1;overflow-wrap:anywhere;word-break:break-word">${e(row.previousMonthAmount === null ? "—" : formatSchoolHours(row.previousMonthAmount))}</td><td style="padding:10px;border-bottom:1px solid #CBD5E1;overflow-wrap:anywhere;word-break:break-word">${e(formatSchoolHours(row.monthAmount))}</td><td style="padding:10px;border-bottom:1px solid #CBD5E1;overflow-wrap:anywhere;word-break:break-word">${e(row.monthComparison === null ? "—" : formatSchoolHours(row.monthComparison, true))}</td></tr>`,
    )
    .join("");
  return `<p style="line-height:1.7;color:#475569">Month / 月份: <strong>${e(report.month)}</strong> · Revision / 版本: <strong>${report.revision}</strong><br>Issued / 发出时间: ${e(schoolHoursIssuedTime(report))} (${e(report.timeZone)})</p>${report.revision > 1 ? `<div class="edition-guidance" style="padding:16px;background:#EFF6FF;border-left:4px solid #2563EB;line-height:1.7">${e(editionGuidance(report)).replaceAll("\n", "<br>")}</div>` : ""}${carryPolicy ? `${nonnegativePolicy ? "" : `<p style="font-size:14px;line-height:1.7;color:#475569">${e(policyNotice.en)}<br>${e(policyNotice.zh)}<br>Carry in + raw changes − posted change = carry out. / 期初余量 + 原始变化 − 本次入账 = 留待后续的余量。</p>`}${nonnegativePolicy ? `<details class="carry-explanation" style="font-size:14px;line-height:1.7;color:#475569"><summary style="cursor:pointer;padding:8px 0">How carry works / 余量计算方式</summary><p>${e(policyNotice.en)}<br>${e(policyNotice.zh)}</p><p>Carry in + raw changes − posted change = carry out.<br>期初余量 + 原始变化 − 本次入账 = 留待后续的余量。</p></details>` : ""}` : ""}<p class="posting-legend" style="font-size:14px;line-height:1.7;color:#475569">— in Hours means no posting for the highlighted instruction. / 入账时数栏中的 — 表示按突出显示的指示无需入账。</p>${table}<p style="font-size:14px;line-height:1.7;color:#475569">This saved edition reports recorded changes; it does not confirm that the school has posted them. The report and CSV preserve the saved instruction; email only notifies you that it is ready. Late records remain eligible for a later report.<br>此报告记录已录入的变化，不代表学校已完成入账。报告与 CSV 保留已保存的入账指示，邮件仅通知报告已就绪。迟交记录仍可纳入后续报告。</p>${comparisons ? `<details style="margin-top:20px"><summary style="cursor:pointer;font-weight:650;padding:12px 0">Previous-month comparison / 与上月比较 · informational only / 仅供参考</summary><p>These differences compare monthly report amounts. They are not additional credits or deductions for any account.<br>此差异仅比较月度报告时数，不应作为额外时数或扣减入账。</p><div style="overflow-x:auto"><table class="month-comparison" style="border-collapse:collapse;table-layout:fixed;width:100%;font-size:14px"><thead><tr><th style="text-align:left;overflow-wrap:anywhere;word-break:break-word">Individual / 个人</th><th style="overflow-wrap:anywhere;word-break:break-word">Previous month / 上月</th><th style="overflow-wrap:anywhere;word-break:break-word">This month / 本月</th><th style="overflow-wrap:anywhere;word-break:break-word">Difference / 差异</th></tr></thead><tbody>${comparisons}</tbody></table></div></details>` : ""}${report.includeStatistics ? `<details style="margin-top:20px"><summary style="cursor:pointer;font-weight:650;padding:12px 0">Optional program statistics / 项目统计（可选）</summary><p>${report.totals.people} individuals / 人 · ${e(carryPolicy ? "Raw tutoring change / 辅导原始变化" : "Tutoring / 辅导")}: ${e(formatSchoolHours(report.totals.tutoringChange, true))} h · ${e(crewLabel)}: ${e(formatSchoolHours(report.totals.crewChange, true))} h · ${e(carryPolicy ? "Posted changes / 入账变化" : "Net changes / 净变化")}: ${e(formatSchoolHours(report.totals.hoursToAdd, true))} h</p><p>Program statistics are not an amount to apply to any one account. / 项目统计不可计入任何单一个人账户。</p></details>` : ""}`;
}

/** Email announces a saved edition only. Row-level accounting belongs exclusively
 * to the linked report, so message bodies and inbox previews cannot expose it. */
export function schoolHoursEmailCopy(input: {
  /** Supplied by live callers; isolated previews need no server environment. */
  brand?: string;
  /** Canonical public asset supplied by live callers, never loaded here. */
  iconUrl?: string;
  locale?: EmailLocale;
  report: SchoolHoursPublicReport;
  reportUrl: string;
  preview?: boolean;
}) {
  const { report, reportUrl, preview } = input;
  const locale = normalizeEmailLocale(input.locale);
  const revised = report.revision > 1;
  const monthDate = new Date(`${report.month}-01T00:00:00Z`);
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthDate);
  const copy =
    locale === "zh"
      ? {
          heading: "月度报告已就绪",
          revision: `第 ${report.revision} 版`,
          replaces: `替代第 ${report.revision - 1} 版`,
          issued: "发出时间",
          action: "查看月度报告",
          preview: "仅供预览",
          message: revised
            ? "请打开更新后的报告查看本版本。"
            : "请打开已保存的报告查看本版本。",
          receipt: "此邮件仅通知报告已就绪；邮件送达不代表学校已完成入账。",
          privacy:
            "持有报告链接的人无需账户即可查看，请仅与预期学校收件人分享。",
          inbox: "月度报告已就绪，请通过报告链接查看。",
        }
      : {
          heading: "Your monthly report is ready",
          revision: `Revision ${report.revision}`,
          replaces: `Replaces Revision ${report.revision - 1}`,
          issued: "Issued",
          action: "View Month Report",
          preview: "preview only",
          message: revised
            ? "Open the updated report to review this edition."
            : "Open the saved report to review this edition.",
          receipt:
            "This email only announces the report. Delivery does not confirm school entry.",
          privacy:
            "Anyone with the report link can view it without an account. Share only with intended school recipients.",
          inbox:
            "Your monthly report is ready to view through the report link.",
        };
  const subject =
    locale === "zh"
      ? `${monthLabel}学校时数报告${revised ? "更新" : ""} · ${copy.revision}`
      : `${monthLabel} school-hours report${revised ? " updated" : ""} · ${copy.revision}`;
  const issued = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: report.timeZone,
  }).format(new Date(report.generatedAt));
  const metadata = `${monthLabel} · ${copy.revision}${revised ? ` · ${copy.replaces}` : ""}`;
  const issuedText = `${copy.issued}: ${issued} (${report.timeZone})`;
  const actionText = `${copy.action}${preview ? ` (${copy.preview})` : `: ${reportUrl}`}`;
  const text = `${copy.heading}\n${metadata}\n${issuedText}\n\n${copy.message}\n\n${actionText}\n\n${copy.receipt}\n\n${copy.privacy}`;
  // Match every push email through the shared renderer. A preview omits action
  // metadata entirely, so neither its CTA nor copyable fallback becomes a link.
  const html = renderEmail({
    brand: input.brand ?? DEFAULT_BRANDING.APP_TITLE,
    subject,
    text,
    iconUrl: input.iconUrl,
    presentation: {
      locale,
      preview: copy.inbox,
      body: [
        `${revised ? `${copy.replaces}\n` : ""}${issuedText}`,
        copy.message,
        ...(preview ? [actionText] : []),
        copy.receipt,
        copy.privacy,
      ].join("\n\n"),
      ...(!preview ? { action: { label: copy.action, url: reportUrl } } : {}),
    },
  });
  return { subject, text, html };
}
