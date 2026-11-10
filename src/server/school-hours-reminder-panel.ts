import { randomUUID } from "node:crypto";
import { escapeSchoolHours as e } from "./school-hours-email";
import type {
  SchoolHoursRecipientFaultCode,
  SchoolHoursRecipientState,
} from "./school-hours-recipient";

const messages: Record<SchoolHoursRecipientFaultCode, string> = {
  unavailable:
    "This reminder link is unavailable. Open the link from your latest report email. / 此提醒链接不可用，请打开最新报告邮件中的链接。",
  retired:
    "Reminders are unavailable for this report. / 此报告目前无法安排提醒。",
  recipientRemoved:
    "Reminders are no longer available for this mailbox. You can still view the report. / 此邮箱已无法接收提醒，您仍可查看报告。",
  writeFailed:
    "We could not confirm the request. Your selected time is retained; retry the same request. / 暂时无法确认请求，已保留所选时间，请重试同一请求。",
  invalidTime:
    "Choose a valid future time in the displayed timezone. Times repeated or skipped by daylight saving cannot be used. / 请选择所示时区内有效的未来时间，不能使用夏令时切换时重复或不存在的时间。",
  alreadyScheduled:
    "A reminder is already scheduled. Cancel it before choosing another time. / 已安排提醒，请先取消再选择其他时间。",
  limit:
    "The daily reminder limit has been reached. Please try again tomorrow. / 今日提醒次数已达上限，请明天再试。",
  sending:
    "This reminder is being sent and cannot be cancelled. / 此提醒正在发送，无法取消。",
};
const status: Record<string, string> = {
  PENDING: "Scheduled / 已安排",
  SENDING: "Sending / 发送中",
  SENT: "Sent / 已发送",
  FAILED: "Delivery failed / 发送失败",
  BLOCKED: "Delivery delayed / 投递延迟",
  SKIPPED: "Not sent / 未发送",
  CANCELLED: "Cancelled / 已取消",
};
const button =
  "display:inline-flex;min-height:44px;align-items:center;justify-content:center;padding:10px 16px;border:1px solid #CBD5E1;border-radius:8px;background:white;color:#174A89;font:inherit;font-weight:700;cursor:pointer;text-decoration:none";
const hidden = (name: string, value: string) =>
  `<input type="hidden" name="${name}" value="${e(value)}">`;
const canCancel = (value: string) =>
  ["PENDING", "BLOCKED", "FAILED"].includes(value);

/** Native, script-free forms keep recipient self-service on the saved report.
 * Only a masked version of this link's fixed mailbox crosses the public view. */
export function schoolHoursReminderPanel(
  state: SchoolHoursRecipientState,
  token: string,
  options: {
    error?: SchoolHoursRecipientFaultCode;
    draft?: { localTime: string; requestId: string };
    review?: { localTime: string; requestId: string; scheduledFor: Date };
  } = {},
) {
  const action = `/reports/service-hours/${encodeURIComponent(token)}`;
  const date = (value: Date) =>
    `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: state.report.timeZone }).format(value)} (${state.report.timeZone})`;
  const sameEdition =
    "This reminder sends the same saved edition. If its hours have already been entered, do not enter them again. / 提醒邮件发送的是同一已保存版本，若时数已入账，请勿重复登记。";
  const active = state.reminders.some((row) =>
    ["PENDING", "SENDING", "BLOCKED", "FAILED"].includes(row.status),
  );
  const form = options.review
    ? `<h2 style="font-size:19px;margin:0">Confirm your reminder / 确认提醒</h2><p>Send to / 发送至：<strong>${e(state.mailbox)}</strong></p><p>${e(date(options.review.scheduledFor))}</p><p>${e(sameEdition)}</p><form method="post" action="${e(action)}">${hidden("operation", "schedule")}${hidden("requestId", options.review.requestId)}${hidden("localTime", options.review.localTime)}<div style="display:flex;flex-wrap:wrap;gap:10px"><a href="${e(action)}?reminder=edit#reminder" style="${button}">Cancel / 取消</a><button type="submit" style="${button};background:#0D59E6;color:white;border-color:#0D59E6">Schedule my reminder / 安排提醒</button></div></form>`
    : `${state.eligible && !active ? `<p>Send a reminder to / 提醒将发送至：<strong>${e(state.mailbox)}</strong></p><form method="post" action="${e(action)}">${hidden("operation", "review")}${hidden("requestId", options.draft?.requestId ?? randomUUID())}<label for="reminder-time" style="display:block;font-weight:700">Reminder date and time / 提醒日期和时间</label><input id="reminder-time" name="localTime" type="datetime-local" required value="${e(options.draft?.localTime ?? "")}" aria-describedby="reminder-time-help" style="display:block;min-height:44px;width:100%;max-width:380px;min-width:0;box-sizing:border-box;border:1px solid #94A3B8;border-radius:7px;padding:10px;font:inherit;margin:8px 0"><p id="reminder-time-help" style="color:#475569">Time zone / 时区：${e(state.report.timeZone)}. Choose a future time. / 请选择未来时间。</p><button type="submit" style="${button};background:#0D59E6;color:white;border-color:#0D59E6">Review reminder / 核对提醒</button></form><p style="font-size:13px;color:#475569">${e(sameEdition)}</p>` : !state.eligible ? `<p>${e(messages.retired)}</p>` : ""}${state.reminders.length ? `<h3 style="font-size:16px;margin:20px 0 10px">Your reminders / 您的提醒</h3><ul style="padding:0;list-style:none">${state.reminders.map((row) => `<li style="border-top:1px solid #CBD5E1;padding:12px 0;overflow-wrap:anywhere"><p style="margin:0 0 8px"><strong>${e(date(row.scheduledFor))}</strong><br>${e(status[row.status] ?? "Status unavailable / 状态暂不可用")}</p>${canCancel(row.status) ? `<form method="post" action="${e(action)}">${hidden("operation", "cancel")}${hidden("reminderId", row.id)}<button type="submit" style="${button};color:#B42318">Cancel this reminder / 取消此提醒</button></form>` : ""}</li>`).join("")}</ul>` : ""}`;
  return `<section id="reminder" style="margin:20px 0;border:1px solid #CBD5E1;border-radius:12px;background:white;padding:16px;overflow-wrap:anywhere"><details${options.review || options.error || active ? " open" : ""}><summary style="cursor:pointer;min-height:44px;padding:10px 0;font-size:18px;font-weight:700">Remind me later / 稍后提醒我</summary><div style="padding-top:12px">${options.error ? `<p role="alert" style="background:#FEF2F2;color:#991B1B;padding:12px;border-radius:7px">${e(messages[options.error])}</p>` : ""}${form}<p style="font-size:13px;color:#475569">This personal link can request reminders only to the mailbox it was emailed to. Delivery may be delayed; unsent reminders can be cancelled here. / 此专属链接仅能向原收件邮箱发送提醒。投递可能延迟，未发送的提醒可在此取消。</p></div></details><p style="font-size:12px;color:#475569;margin:12px 0 0">The first visit to this personal link is recorded for delivery status. / 此专属链接的首次访问时间会记录于投递状态。</p></section>`;
}
