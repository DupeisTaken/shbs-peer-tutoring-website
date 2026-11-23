import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { formatNotificationEvent } from "~/lib/notification-events";
import { notificationEmailDetail } from "./notification-policy";
import type { EmailPresentation } from "./template";
import {
  DEFAULT_EMAIL_LOCALE,
  emailText,
  normalizeEmailLocale,
  type EmailLocale,
} from "~/lib/email-locale";

const translators = {
  en: createTranslator({
    locale: "en",
    messages: en,
    namespace: "notificationEvents",
  }),
  zh: createTranslator({
    locale: "zh",
    messages: zh,
    namespace: "notificationEvents",
  }),
};

/** Select the established recipient's language. Unknown legacy events remain generic;
 * their arbitrary notification bodies are never recovered into email. */
export function notificationEmailCopy(
  event: string,
  context: unknown,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
) {
  const language = normalizeEmailLocale(locale);
  const detail = notificationEmailDetail(event, context);
  const copy =
    formatNotificationEvent(event, context, language, translators[language]) ??
    formatNotificationEvent(
      "program_update",
      {},
      language,
      translators[language],
    )!;
  const timeLine = copy.time
    ? emailText(language, {
        en: `\nTime: ${copy.time}`,
        zh: `\n时间：${copy.time}`,
      })
    : "";
  return {
    subject: copy.title,
    description: `${detail?.[language] ?? copy.body}${timeLine}`,
    action: copy.action,
  };
}

/** Shared production/preview composition only; eligibility and delivery admission
 * remain with the outbox worker. HTML has named links; text keeps complete URLs. */
export function notificationEmailContent(input: {
  event: string;
  context: unknown;
  createdAt: Date;
  timeZone: string;
  category: string;
  link: string;
  unsubscribeUrl?: string;
  locale?: EmailLocale;
  requiredByProgram?: boolean;
}) {
  const locale = normalizeEmailLocale(input.locale);
  const { category, timeZone, link, unsubscribeUrl } = input;
  const essential = category === "security";
  const requiredByProgram = !essential && input.requiredByProgram === true;
  const copy = notificationEmailCopy(input.event, input.context, locale);
  const time = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(input.createdAt);
  const issued = emailText(locale, {
    en: `Sent: ${time} (${timeZone})`,
    zh: `发送时间：${time}（${timeZone}）`,
  });
  const footer = essential
    ? emailText(locale, {
        en: "If you didn't make this change, contact the program team right away.",
        zh: "如果这不是你的操作，请尽快联系项目团队。",
      })
    : requiredByProgram
      ? emailText(locale, {
          en: "This notification category is required by the program. You can manage optional emails in Account Settings.",
          zh: "此类别邮件为项目必发通知。你可以在账号设置中管理其他可选邮件。",
        })
      : "";
  const preferenceLabel = emailText(
    locale,
    requiredByProgram
      ? { en: "Manage email preferences", zh: "管理邮件偏好" }
      : { en: "Unsubscribe", zh: "取消订阅" },
  );
  return {
    subject: copy.subject,
    text: `${copy.description}\n\n${issued}${footer ? `\n\n${footer}` : ""}\n\n${link}${unsubscribeUrl ? `\n\n${preferenceLabel}: ${unsubscribeUrl}` : ""}`,
    presentation: {
      locale,
      // Inbox previews use only a maintained category instruction, never details,
      // names, private message text, notification subjects or capability URLs.
      preview: emailText(
        locale,
        essential
          ? {
              en: "Check this account security update and contact the program team if it wasn't you.",
              zh: "请查看这条账号安全更新；如果不是你的操作，请联系项目团队。",
            }
          : category === "messages"
            ? {
                en: "Open your inbox to read and reply.",
                zh: "打开收件箱阅读并回复。",
              }
            : category === "review"
              ? {
                  en: "Open the website to review this request.",
                  zh: "打开网站审核这项申请。",
                }
              : category === "reminder"
                ? {
                    en: "Check the time and location before it starts.",
                    zh: "开始前请核对时间和地点。",
                  }
                : {
                    en: "Open the website to view this update.",
                    zh: "打开网站查看更新详情。",
                  },
      ),
      body: `${copy.description}\n\n${issued}${footer ? `\n\n${footer}` : ""}`,
      ...(unsubscribeUrl
        ? { unsubscribeUrl, unsubscribeLabel: preferenceLabel }
        : {}),
      eyebrow: emailText(
        locale,
        essential
          ? { en: "ACCOUNT SECURITY", zh: "账号安全" }
          : category === "messages"
            ? { en: "PRIVATE MESSAGES", zh: "私信" }
            : category === "review"
              ? { en: "REVIEW NEEDED", zh: "待审核" }
              : category === "reminder"
                ? { en: "REMINDER", zh: "日程提醒" }
                : { en: "PROGRAM UPDATE", zh: "项目通知" },
      ),
      action: { label: copy.action, url: link },
    } satisfies EmailPresentation,
  };
}
