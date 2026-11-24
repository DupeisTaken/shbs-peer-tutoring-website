import { APP_TITLE } from "~/lib/branding";
import { formatMonthlyHours as hours } from "~/lib/monthly-hours-format";
import type { MonthlyHoursSnapshot } from "./monthly-hours";

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

/** Only the immutable hours projection enters email. Every user-authored name
 * is escaped; recipients, adjustment reasons and student evidence are excluded. */
export function monthlyHoursEmailCopy(input: {
  snapshot: MonthlyHoursSnapshot;
  revision: number;
  generatedAt: Date;
  timeZone: string;
  reason: string | null;
  reportUrl: string;
  unsubscribeUrl: string;
  /** Browser previews expose no navigation or account capabilities. */
  preview?: boolean;
}) {
  const { snapshot, revision, reportUrl, unsubscribeUrl } = input;
  const subject = `${snapshot.month} service-hours report / 服务时数报告 · r${revision}`;
  const generated = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: input.timeZone,
  }).format(input.generatedAt);
  const intro = `Reporting month / 报告月份: ${snapshot.month}\nRevision / 修订版本: ${revision}${revision > 1 ? ` (replaces r${revision - 1} / 替代第 ${revision - 1} 版)` : ""}\nGenerated / 生成时间: ${generated} (${input.timeZone})`;
  const notice =
    "This saved report reflects service hours recorded when it was generated; later edits do not change it. Combined sessions count per paired subject rather than physical teaching blocks. Crew hours are reported separately.\n本报告保存生成时已记录的月度服务时数，后续更正不会修改此报告。合并辅导按配对科目分别记录，不代表实际教学时段数；巡查时数另行统计。";
  const header =
    "Tutor / 辅导伙伴 | Status / 状态 | Sessions / 辅导记录 | Earned / 获得 | Extras / 额外 | Deductions / 扣减 | Net / 合计";
  const values = snapshot.rows.map((row) => [
    row.englishName,
    row.active ? "Active / 参与中" : "Inactive / 未参与",
    row.sessions,
    hours(row.earned),
    hours(row.extras),
    hours(row.punishments),
    hours(row.total),
  ]);
  const total = [
    `Total (${snapshot.totals.tutors} tutors) / 总计（${snapshot.totals.tutors} 位辅导伙伴）`,
    "",
    snapshot.totals.sessions,
    hours(snapshot.totals.earned),
    hours(snapshot.totals.extras),
    hours(snapshot.totals.punishments),
    hours(snapshot.totals.total),
  ];
  const confidentiality =
    "For authorized program staff only. Please do not forward outside the team.\n本邮件仅供获授权的项目工作人员查阅，请勿向外转发。";
  const reportLabel =
    "View saved report and download CSV / 查看报告并下载 CSV";
  const previewSuffix = " (preview only / 仅供预览)";
  const reportText = input.preview
    ? `${reportLabel}${previewSuffix}`
    : `${reportLabel}: ${reportUrl}`;
  const unsubscribeText = input.preview
    ? `Unsubscribe / 取消订阅${previewSuffix}`
    : `Unsubscribe / 取消订阅: ${unsubscribeUrl}`;
  const text = `${intro}\n\n${notice}\n\n${header}\n${values.map((row) => row.join(" | ")).join("\n")}\n${total.join(" | ")}\n\n${reportText}\n\n${confidentiality}\n\n${unsubscribeText}`;
  const labels = [
    "Tutor<br>辅导伙伴",
    "Status<br>状态",
    "Sessions<br>辅导记录",
    "Earned<br>获得",
    "Extras<br>额外",
    "Deductions<br>扣减",
    "Net<br>合计",
  ];
  const cells = (row: (string | number)[], heading = false) =>
    `<tr>${row.map((value, index) => `<${heading ? "th" : "td"} style="padding:10px 7px;border-bottom:1px solid #454B56;text-align:${index > 1 ? "right" : "left"};vertical-align:top;${heading ? "font-weight:700;" : ""}">${escape(value)}</${heading ? "th" : "td"}>`).join("")}</tr>`;
  const action = (url: string, label: string) =>
    input.preview
      ? `<span style="color:#B6D5FF" aria-disabled="true">${escape(`${label}${previewSuffix}`)}</span>`
      : `<a style="color:#B6D5FF" href="${escape(url)}">${escape(label)}</a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#181B20;color:#E8EDF5;font-family:Arial,sans-serif"><main style="max-width:900px;margin:auto;padding:24px 12px"><p style="color:#A8C8F5">${escape(APP_TITLE)}</p><h1 style="font-size:24px">${escape(snapshot.month)} service-hours report<br>服务时数报告 · r${revision}</h1><p>${escape(intro).replaceAll("\n", "<br>")}</p><p style="font-size:14px;line-height:1.6;color:#C1CAD8">${escape(notice).replaceAll("\n", "<br>")}</p><div style="overflow-x:auto;background:#272D35;border-radius:8px;padding:8px"><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr>${labels.map((label, index) => `<th scope="col" style="padding:10px 7px;text-align:${index > 1 ? "right" : "left"}">${label}</th>`).join("")}</tr></thead><tbody>${values.map((row) => cells(row)).join("")}${cells(total, true)}</tbody></table></div><p style="padding-top:16px">${action(reportUrl, reportLabel)}</p><p style="font-size:13px;color:#B3BDCB">${escape(confidentiality).replaceAll("\n", "<br>")}</p><p>${action(unsubscribeUrl, "Unsubscribe / 取消订阅")}</p></main></body></html>`;
  return { subject, text, html };
}
