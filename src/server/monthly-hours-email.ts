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
}) {
  const { snapshot, revision, reportUrl, unsubscribeUrl } = input;
  const subject = `${snapshot.month} service-hours report / 服务时数报告 · r${revision}`;
  const generated = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: input.timeZone,
  }).format(input.generatedAt);
  const intro = `Reporting month / 报告月份: ${snapshot.month}\nRevision / 修订版本: ${revision}${revision > 1 ? ` (replaces r${revision - 1} / 替代上一版本)` : ""}\nGenerated / 生成时间: ${generated} (${input.timeZone})`;
  const notice =
    "Recorded monthly credits at generation time. Later corrections do not change this saved report. Session rows can include combined courses; they are not a count of physical teaching blocks. Crew hours are separate.\n此报告保存生成时已记录的月度时数。后续更正不会修改本报告。课程合并可能对应多条课程记录，记录数不代表实际教学时段数；执勤时数另行统计。";
  const header =
    "Tutor / 辅导伙伴 | Status / 状态 | Session rows / 课程记录 | Earned / 获得 | Extras / 额外 | Deductions / 扣减 | Net / 合计";
  const values = snapshot.rows.map((row) => [
    row.englishName,
    row.active ? "Active / 活跃" : "Inactive / 非活跃",
    row.sessions,
    hours(row.earned),
    hours(row.extras),
    hours(row.punishments),
    hours(row.total),
  ]);
  const total = [
    `TOTAL / 总计 (${snapshot.totals.tutors} tutors / 位辅导伙伴)`,
    "",
    snapshot.totals.sessions,
    hours(snapshot.totals.earned),
    hours(snapshot.totals.extras),
    hours(snapshot.totals.punishments),
    hours(snapshot.totals.total),
  ];
  const text = `${intro}\n\n${notice}\n\n${header}\n${values.map((row) => row.join(" | ")).join("\n")}\n${total.join(" | ")}\n\nView saved report / 查看已保存报告: ${reportUrl}\n\nUnsubscribe / 取消订阅: ${unsubscribeUrl}`;
  const labels = [
    "Tutor<br>辅导伙伴",
    "Status<br>状态",
    "Session rows<br>课程记录",
    "Earned<br>获得",
    "Extras<br>额外",
    "Deductions<br>扣减",
    "Net<br>合计",
  ];
  const cells = (row: (string | number)[], heading = false) =>
    `<tr>${row.map((value, index) => `<${heading ? "th" : "td"} style="padding:10px 7px;border-bottom:1px solid #454B56;text-align:${index > 1 ? "right" : "left"};vertical-align:top;${heading ? "font-weight:700;" : ""}">${escape(value)}</${heading ? "th" : "td"}>`).join("")}</tr>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#181B20;color:#E8EDF5;font-family:Arial,sans-serif"><main style="max-width:900px;margin:auto;padding:24px 12px"><p style="color:#A8C8F5">${escape(APP_TITLE)}</p><h1 style="font-size:24px">${escape(snapshot.month)} service-hours report<br>服务时数报告 · r${revision}</h1><p>${escape(intro).replaceAll("\n", "<br>")}</p><p style="font-size:14px;line-height:1.6;color:#C1CAD8">${escape(notice).replaceAll("\n", "<br>")}</p><div style="overflow-x:auto;background:#272D35;border-radius:8px;padding:8px"><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr>${labels.map((label) => `<th scope="col" style="padding:10px 7px;text-align:left">${label}</th>`).join("")}</tr></thead><tbody>${values.map((row) => cells(row)).join("")}${cells(total, true)}</tbody></table></div><p style="padding-top:16px"><a style="color:#B6D5FF" href="${escape(reportUrl)}">View saved report and download CSV / 查看报告并下载 CSV</a></p><p style="font-size:13px;color:#B3BDCB">Contains staff reporting information. Share only with authorized program staff.<br>此邮件包含项目管理报告信息，请仅向获授权工作人员分享。</p><p><a style="color:#B6D5FF" href="${escape(unsubscribeUrl)}">Unsubscribe / 取消订阅</a></p></main></body></html>`;
  return { subject, text, html };
}
