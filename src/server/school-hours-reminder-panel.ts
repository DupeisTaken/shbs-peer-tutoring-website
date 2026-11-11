import { randomUUID } from "node:crypto";
import { escapeSchoolHours as e } from "./school-hours-email";
import {
  schoolHoursReportText,
  type SchoolHoursReportLocale,
} from "./school-hours-report-locale";
import type {
  SchoolHoursRecipientFaultCode,
  SchoolHoursRecipientState,
} from "./school-hours-recipient";

const messages: Record<SchoolHoursRecipientFaultCode, [string, string]> = {
  unavailable: [
    "This reminder link is unavailable. Open the link from your latest report email.",
    "此提醒链接不可用，请打开最新报告邮件中的链接。",
  ],
  retired: [
    "Reminders are unavailable for this report.",
    "此报告目前无法安排提醒。",
  ],
  recipientRemoved: [
    "Reminders are no longer available for this mailbox. You can still view the report.",
    "此邮箱已无法接收提醒，您仍可查看报告。",
  ],
  writeFailed: [
    "We could not confirm the request. Your selected time is retained; retry the same request.",
    "暂时无法确认请求，已保留所选时间，请重试同一请求。",
  ],
  invalidTime: [
    "Choose a valid future time in the displayed timezone. Times repeated or skipped by daylight saving cannot be used.",
    "请选择所示时区内有效的未来时间，不能使用夏令时切换时重复或不存在的时间。",
  ],
  alreadyScheduled: [
    "A reminder is already scheduled. Cancel it before choosing another time.",
    "已安排提醒，请先取消再选择其他时间。",
  ],
  limit: [
    "The daily reminder limit has been reached. Please try again tomorrow.",
    "今日提醒次数已达上限，请明天再试。",
  ],
  sending: [
    "This reminder is being sent and cannot be cancelled.",
    "此提醒正在发送，无法取消。",
  ],
};
const status: Record<string, [string, string]> = {
  PENDING: ["Scheduled", "已安排"],
  SENDING: ["Sending", "发送中"],
  SENT: ["Sent", "已发送"],
  FAILED: ["Delivery failed", "发送失败"],
  BLOCKED: ["Delivery delayed", "投递延迟"],
  SKIPPED: ["Not sent", "未发送"],
  CANCELLED: ["Cancelled", "已取消"],
};
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
    locale?: SchoolHoursReportLocale;
    error?: SchoolHoursRecipientFaultCode;
    draft?: { localTime: string; requestId: string };
    review?: { localTime: string; requestId: string; scheduledFor: Date };
  } = {},
) {
  const t = (english: string, chinese: string) =>
    schoolHoursReportText(options.locale, english, chinese);
  const statusLabel = (value: string) => {
    const labels = status[value];
    return labels ? t(...labels) : t("Status unavailable", "状态暂不可用");
  };
  // Language stays in the route query, keeping the strict mutation fields and
  // the signed link's fixed recipient independent of presentation preferences.
  const action = `/reports/service-hours/${encodeURIComponent(token)}${options.locale ? `?lang=${options.locale}` : ""}`;
  const editUrl = `${action}${options.locale ? "&" : "?"}reminder=edit#reminder`;
  const date = (value: Date) =>
    `${new Intl.DateTimeFormat(options.locale === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: state.report.timeZone }).format(value)} (${state.report.timeZone})`;
  const sameEdition = t(
    "This reminder sends the same saved edition. If its hours have already been entered, do not enter them again.",
    "提醒邮件发送的是同一已保存版本，若时数已入账，请勿重复登记。",
  );
  const active = state.reminders.some((row) =>
    ["PENDING", "SENDING", "BLOCKED", "FAILED"].includes(row.status),
  );
  const form = options.review
    ? `<h3>${e(t("Review reminder email", "核对提醒邮件"))}</h3>
       <p>${e(options.locale ? t("Send to: ", "发送至：") : "Send to / 发送至：")}<strong>${e(state.mailbox)}</strong></p>
       <p class="reminder-selected-time">${e(date(options.review.scheduledFor))}</p>
       <p class="reminder-notice">${e(sameEdition)}</p>
       <form method="post" action="${e(action)}" class="reminder-form">
         ${hidden("operation", "schedule")}${hidden("requestId", options.review.requestId)}${hidden("localTime", options.review.localTime)}
         <div class="reminder-actions"><a href="${e(editUrl)}" class="button">${e(t("Cancel", "取消"))}</a><button type="submit" class="button button-primary">${e(t("Schedule reminder email", "安排提醒邮件"))}</button></div>
       </form>`
    : `${
        state.eligible && !active
          ? `<p>${e(options.locale ? t("Send a reminder email to: ", "提醒邮件将发送至：") : "Send a reminder email to / 提醒邮件将发送至：")}<strong>${e(state.mailbox)}</strong></p>
       <form method="post" action="${e(action)}" class="reminder-form">
         ${hidden("operation", "review")}${hidden("requestId", options.draft?.requestId ?? randomUUID())}
         <label for="reminder-time" class="reminder-label">${e(t("Reminder date and time", "提醒日期和时间"))}</label>
         <input id="reminder-time" name="localTime" type="datetime-local" required value="${e(options.draft?.localTime ?? "")}" aria-describedby="reminder-time-help" class="reminder-input">
         <p id="reminder-time-help" class="reminder-help">${e(options.locale ? t(`Time zone: ${state.report.timeZone}. Choose a future time.`, `时区：${state.report.timeZone}。请选择未来时间。`) : `Time zone / 时区：${state.report.timeZone}. Choose a future time. / 请选择未来时间。`)}</p>
         <div class="reminder-actions"><button type="submit" class="button button-primary">${e(t("Review reminder email", "核对提醒邮件"))}</button></div>
       </form><p class="reminder-notice">${e(sameEdition)}</p>`
          : !state.eligible
            ? `<p>${e(t(...messages.retired))}</p>`
            : ""
      }
       ${state.reminders.length ? `<h3>${e(t("Your reminder emails", "您的提醒邮件"))}</h3><ul class="reminder-history">${state.reminders.map((row) => `<li><p><strong>${e(date(row.scheduledFor))}</strong><br><span class="reminder-status" data-status="${e(row.status)}">${e(statusLabel(row.status))}</span></p>${canCancel(row.status) ? `<form method="post" action="${e(action)}">${hidden("operation", "cancel")}${hidden("reminderId", row.id)}<button type="submit" class="button button-danger">${e(t("Cancel this reminder email", "取消此提醒邮件"))}</button></form>` : ""}</li>`).join("")}</ul>` : ""}`;
  return `<section id="reminder" class="report-card reminder-panel"><details${options.review || options.error || active ? " open" : ""}>
    <summary class="reminder-heading"><h2>${e(t("Email me a reminder", "发送邮件提醒"))}</h2></summary><div class="reminder-content">
    ${options.error ? `<p role="alert" class="reminder-error">${e(t(...messages[options.error]))}</p>` : ""}${form}
    <p class="reminder-help">${e(t("This personal link can send reminder emails only to the mailbox it was emailed to. Delivery may be delayed; unsent reminders can be cancelled here.", "此专属链接仅能向原收件邮箱发送提醒邮件。投递可能延迟，未发送的提醒邮件可在此取消。"))}</p>
    </div></details><p class="reminder-privacy">${e(t("The first visit to this personal link is recorded for delivery status.", "此专属链接的首次访问时间会记录于投递状态。"))}</p></section>`;
}
