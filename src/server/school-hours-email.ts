import { APP_TITLE } from "~/lib/branding";
import { formatSchoolHours } from "~/lib/school-hours-format";
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
};
export type SchoolHoursPublicReport = {
  month: string;
  revision: number;
  generatedAt: string;
  timeZone: string;
  includeStatistics: boolean;
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
  return report.revision > 1
    ? `Revision ${report.revision} replaces revision ${report.revision - 1} for ${report.month}. If the immediately preceding edition was applied, apply only each person's highlighted correction. If an earlier edition was last applied, choose that edition's correction from the person's table. If nothing was applied, use the replacement month amount once. Choose only one matching row; never add these alternatives together. If the last applied edition is unknown or missing, ask the program team before posting.\n本修订替代该月上一版本。若上一版已入账，仅应用突出显示的更正额；若最后入账的是更早版本，请选择该人的对应版本更正额。若从未入账，使用替代月度金额一次。仅选择一个符合情况的选项，切勿相加。若不确定或找不到最后入账版本，请先联系项目团队。`
    : "Apply each person's highlighted amount to that person's school account once. A negative amount is a correction to deduct. Tutoring and Crew are the breakdown, not additional amounts to add again.\n请将每个人突出显示的时数计入该人的学校账户一次。负数表示应扣除的更正额；辅导与执勤仅为总额明细，不应再次相加。";
}

export function schoolHoursIssuedTime(report: SchoolHoursPublicReport) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: report.timeZone,
  }).format(new Date(report.generatedAt));
}

function individualInstruction(row: SchoolHoursPublicRow, revision: number) {
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

function editionChoicesHtml(row: SchoolHoursPublicRow, revision: number) {
  const e = escapeSchoolHours;
  const choices = schoolHoursPriorEditions(row, revision)
    .map(
      (edition) =>
        `<tr><th scope="row" style="text-align:left;padding:9px;border-bottom:1px solid #CBD5E1">r${edition.revision} (${e(formatSchoolHours(edition.monthAmount, true))} h)</th><td style="padding:9px;border-bottom:1px solid #CBD5E1;font-weight:700">${e(formatSchoolHours(edition.correctionToCurrent, true))} h</td></tr>`,
    )
    .join("");
  return `<div style="margin-top:16px"><p style="font-weight:700">Last applied edition → correction to apply now<br>最后入账版本 → 现在应应用的更正额</p><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr><th style="text-align:left;padding:9px">Last applied edition / 最后入账版本</th><th style="text-align:left;padding:9px">Correction to apply now / 现在应应用的更正额</th></tr></thead><tbody>${choices}<tr><th scope="row" style="text-align:left;padding:9px">Nothing applied / 从未入账</th><td style="padding:9px;font-weight:700">${e(formatSchoolHours(row.monthAmount, true))} h once / 一次</td></tr></tbody></table><p style="font-size:13px;line-height:1.7">Choose only one row matching this person's last applied edition. Never add the alternatives together. If unknown or not listed, ask the program team before posting. Negative corrections are deductions.<br>仅选择符合该人最后入账版本的一个选项，切勿相加。若不确定或版本未列出，请先联系项目团队。负数更正应扣除。</p></div>`;
}

function editionChoicesText(row: SchoolHoursPublicRow, revision: number) {
  const choices = schoolHoursPriorEditions(row, revision)
    .map(
      (edition) =>
        `r${edition.revision} (${formatSchoolHours(edition.monthAmount, true)} h applied) -> ${formatSchoolHours(edition.correctionToCurrent, true)} h`,
    )
    .join("\n");
  return `\nLast applied edition -> correction to apply now / 最后入账版本 -> 现在应应用的更正额 (choose one / 仅选一项):\n${choices}${choices ? "\n" : ""}Nothing applied / 从未入账 -> ${formatSchoolHours(row.monthAmount, true)} h once / 一次\nChoose only one matching row; never add alternatives. If unknown or not listed, ask the program team. Negative corrections are deductions. / 仅选符合情况的一项，切勿相加；若不确定或未列出，请先联系项目团队。负数应扣除。`;
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
  const cards = rows
    .map((row) => {
      const instruction = individualInstruction(row, report.revision);
      return `<section class="person" style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:12px;padding:18px;margin:14px 0;color:#0F172A"><h2 style="font-size:19px;margin:0 0 6px;overflow-wrap:anywhere">${e(row.exportName)}</h2><p style="font-size:13px;color:#475569;margin:0 0 12px;overflow-wrap:anywhere">School account / 学校账户: ${e(row.schoolAccountKey)}</p><p style="margin:0;font-size:30px;font-weight:750;font-variant-numeric:tabular-nums;color:${row.hoursToAdd < 0 ? "#B42318" : "#115E59"}">${e(formatSchoolHours(row.hoursToAdd, true))} h</p><p style="margin:5px 0 14px;font-weight:600">${e(instruction)}</p><p style="font-size:14px;margin:0;line-height:1.7">Tutoring net / 辅导净额: <strong>${e(formatSchoolHours(row.tutoringChange, true))} h</strong><br>Crew / 执勤: <strong>${e(formatSchoolHours(row.crewChange, true))} h</strong></p>${report.revision > 1 ? `<p style="font-size:14px;border-top:1px solid #CBD5E1;margin:12px 0 0;padding-top:12px">Previous edition amount / 上版金额: ${e(row.previousEditionAmount === null ? "—" : `${formatSchoolHours(row.previousEditionAmount, true)} h`)}<br>Replacement month amount / 替代月度金额: <strong>${e(formatSchoolHours(row.monthAmount, true))} h</strong></p>${editionChoicesHtml(row, report.revision)}` : ""}</section>`;
    })
    .join("");
  const comparisons = rows
    .filter((row) => row.previousMonthAmount !== null)
    .map(
      (row) =>
        `<tr><th scope="row" style="text-align:left;padding:10px;border-bottom:1px solid #CBD5E1">${e(row.exportName)}</th><td style="padding:10px;border-bottom:1px solid #CBD5E1">${e(row.previousMonthAmount === null ? "—" : formatSchoolHours(row.previousMonthAmount))}</td><td style="padding:10px;border-bottom:1px solid #CBD5E1">${e(formatSchoolHours(row.monthAmount))}</td><td style="padding:10px;border-bottom:1px solid #CBD5E1">${e(row.monthComparison === null ? "—" : formatSchoolHours(row.monthComparison, true))}</td></tr>`,
    )
    .join("");
  return `<p style="line-height:1.7;color:#475569">Month / 月份: <strong>${e(report.month)}</strong> · Revision / 版本: <strong>${report.revision}</strong><br>Issued / 发出时间: ${e(schoolHoursIssuedTime(report))} (${e(report.timeZone)})</p><div style="padding:16px;background:#EFF6FF;border-left:4px solid #2563EB;line-height:1.7">${e(editionGuidance(report)).replaceAll("\n", "<br>")}</div>${cards || "<p>No individual changes in this edition. / 本版本无个人时数变化。</p>"}<p style="font-size:14px;line-height:1.7;color:#475569">This saved edition reports recorded changes; it does not confirm that the school has posted them. The email, link and download are copies of the same instruction. Late records remain eligible for a later report.<br>此报告记录已录入的变化，不代表学校已完成入账。邮件、链接与下载均为同一指示的副本。迟交记录仍可纳入后续报告。</p>${comparisons ? `<details style="margin-top:20px"><summary style="cursor:pointer;font-weight:650;padding:12px 0">Previous-month comparison / 与上月比较 · informational only / 仅供参考</summary><p>These differences compare monthly report amounts. They are not additional credits or deductions for any account.<br>此差异仅比较月度报告金额，不应作为额外时数或扣减入账。</p><div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr><th style="text-align:left">Individual / 个人</th><th>Previous month / 上月</th><th>This month / 本月</th><th>Difference / 差异</th></tr></thead><tbody>${comparisons}</tbody></table></div></details>` : ""}${report.includeStatistics ? `<details style="margin-top:20px"><summary style="cursor:pointer;font-weight:650;padding:12px 0">Optional program statistics / 项目统计（可选）</summary><p>${report.totals.people} individuals / 人 · Tutoring / 辅导: ${e(formatSchoolHours(report.totals.tutoringChange, true))} h · Crew / 执勤: ${e(formatSchoolHours(report.totals.crewChange, true))} h · Net changes / 净变化: ${e(formatSchoolHours(report.totals.hoursToAdd, true))} h</p><p>Program statistics are not an amount to apply to any one account. / 项目统计不可计入任何单一个人账户。</p></details>` : ""}`;
}

export function schoolHoursEmailCopy(input: {
  report: SchoolHoursPublicReport;
  reportUrl: string;
  preview?: boolean;
}) {
  const { report: sourceReport, reportUrl, preview } = input;
  const rows = schoolHoursVisibleRows(sourceReport);
  const report = {
    ...sourceReport,
    rows,
    totals: { ...sourceReport.totals, people: rows.length },
  };
  const subject = schoolHoursHeading(report.month);
  const textRows = report.rows
    .map(
      (row) =>
        `${row.exportName}\nSchool account / 学校账户: ${row.schoolAccountKey}\n${individualInstruction(row, report.revision)}: ${formatSchoolHours(row.hoursToAdd, true)} h\nTutoring net / 辅导净额: ${formatSchoolHours(row.tutoringChange, true)} h; Crew / 执勤: ${formatSchoolHours(row.crewChange, true)} h${report.revision > 1 ? `\nPrevious edition / 上版: ${row.previousEditionAmount === null ? "—" : formatSchoolHours(row.previousEditionAmount, true)} h; Replacement month amount / 替代月度金额: ${formatSchoolHours(row.monthAmount, true)} h${editionChoicesText(row, report.revision)}` : ""}${row.previousMonthAmount === null ? "" : `\nInformational monthly comparison only / 仅供参考的月度比较: ${formatSchoolHours(row.previousMonthAmount)} → ${formatSchoolHours(row.monthAmount)} h (${row.monthComparison === null ? "—" : formatSchoolHours(row.monthComparison, true)} h). Not an additional account correction / 非额外账户更正。`}`,
    )
    .join("\n\n");
  const capabilityNotice =
    "Anyone possessing the report link can view this saved report. Share it only with intended school recipients. No account or sign-in is required.\n任何持有报告链接的人均可查看此报告，请仅与预期的学校收件人分享；无需注册或登录。";
  const statistics = report.includeStatistics
    ? `\n\nOptional program statistics / 项目统计（可选）: ${report.totals.people} individuals; tutoring ${formatSchoolHours(report.totals.tutoringChange, true)} h; Crew ${formatSchoolHours(report.totals.crewChange, true)} h. Not an amount for one account.`
    : "";
  const text = `${subject}\n${report.month} · Revision ${report.revision}\nIssued: ${schoolHoursIssuedTime(report)} (${report.timeZone})\n\n${editionGuidance(report)}\n\n${textRows || "No individual changes / 无个人变化"}${statistics}\n\nView Month Report${preview ? " (preview only / 仅供预览)" : `: ${reportUrl}`}\n\n${capabilityNotice}\n\nThis edition is a report, not confirmation of posting to school accounts. Email, link and CSV are the same instruction, not separate credits.`;
  const action = preview
    ? '<span aria-disabled="true" style="display:inline-block;background:#0D59E6;color:white;padding:12px 18px;border-radius:7px;font-weight:700">View Month Report</span>'
    : `<a href="${escapeSchoolHours(reportUrl)}" style="display:inline-block;background:#0D59E6;color:white;padding:12px 18px;border-radius:7px;font-weight:700;text-decoration:none">View Month Report</a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeSchoolHours(subject)}</title></head><body style="margin:0;background:#EAF0F7;color:#0F172A;font-family:Arial,sans-serif"><main style="max-width:760px;margin:0 auto;padding:24px 16px"><p style="color:#475569;font-size:14px">${escapeSchoolHours(APP_TITLE)}</p><h1 style="font-size:28px;line-height:1.25">${escapeSchoolHours(subject)}</h1>${renderSchoolHoursContent(report)}<p style="margin:24px 0">${action}</p><p style="font-size:13px;line-height:1.7;color:#475569">${escapeSchoolHours(capabilityNotice).replaceAll("\n", "<br>")}</p></main></body></html>`;
  return { subject, text, html };
}
