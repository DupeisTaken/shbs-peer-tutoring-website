import { normalizeEmailLocale } from "~/lib/email-locale";
import { escapeSchoolHours, schoolHoursEmailCopy } from "./school-hours-email";

/** The delivery redesign owns layout and report content policy. This layer adds
 * only the recipient's requested reminder identity and same-edition safeguard. */
export function schoolHoursRecipientEmailCopy(
  input: Parameters<typeof schoolHoursEmailCopy>[0] & { reminder?: boolean },
) {
  const { reminder, ...reportInput } = input;
  const copy = schoolHoursEmailCopy(reportInput);
  if (!reminder) return copy;
  const zh = normalizeEmailLocale(input.locale) === "zh";
  const notice = zh
    ? "这是您请求的同一已保存版本的提醒。已入账的时数请勿重复登记。"
    : "Your requested reminder of the same saved edition. Do not enter hours that are already posted.";
  return {
    subject: `${zh ? "提醒：" : "Reminder: "}${copy.subject}`,
    text: `${notice}\n\n${copy.text}`,
    html: copy.html.replace(
      "</h1>",
      `</h1><p style="font-size:14px;line-height:1.7;color:#475569">${escapeSchoolHours(notice)}</p>`,
    ),
  };
}
