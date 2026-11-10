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
  return {
    subject: copy.title,
    description: `${detail?.[language] ?? copy.body}${copy.time ? `\n${copy.time}` : ""}`,
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
}) {
  const locale = normalizeEmailLocale(input.locale);
  const { category, timeZone, link, unsubscribeUrl } = input;
  const essential = category === "security";
  const copy = notificationEmailCopy(input.event, input.context, locale);
  const time = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(input.createdAt);
  const issued = emailText(locale, {
    en: `Notice issued: ${time} (${timeZone})`,
    zh: `通知发出时间：${time}（${timeZone}）`,
  });
  const footer = essential
    ? emailText(locale, {
        en: "If you do not recognize this activity, contact the program team through private support.",
        zh: "如非本人操作，请通过私密支持联系项目团队。",
      })
    : "";
  return {
    subject: copy.subject,
    text: `${copy.description}\n\n${issued}${footer ? `\n\n${footer}` : ""}\n\n${link}${unsubscribeUrl ? `\n\n${emailText(locale, { en: "Unsubscribe", zh: "取消订阅" })}: ${unsubscribeUrl}` : ""}`,
    presentation: {
      locale,
      // Inbox previews use only a maintained category instruction, never details,
      // names, private message text, notification subjects or capability URLs.
      preview: emailText(
        locale,
        essential
          ? {
              en: "Review this notice. Contact the program team if the change is unfamiliar.",
              zh: "请核对安全通知。如非本人操作，请联系项目团队。",
            }
          : category === "messages"
            ? {
                en: "Open your inbox to read and reply.",
                zh: "请打开收件箱阅读并回复。",
              }
            : category === "review"
              ? {
                  en: "Review the request and its details on the website.",
                  zh: "请在网站核对申请及其详情。",
                }
              : category === "reminder"
                ? {
                    en: "Check the scheduled time and location before the event.",
                    zh: "请在活动开始前核对时间和地点。",
                  }
                : {
                    en: "Open the website for the update and any next steps.",
                    zh: "请打开网站查看通知和后续步骤。",
                  },
      ),
      body: `${copy.description}\n\n${issued}${essential ? `\n\n${footer}` : ""}`,
      ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
      eyebrow: emailText(
        locale,
        essential
          ? { en: "ACCOUNT SECURITY", zh: "账户安全" }
          : category === "messages"
            ? { en: "PRIVATE MESSAGES", zh: "私信" }
            : category === "review"
              ? { en: "REVIEW REQUEST", zh: "审核请求" }
              : category === "reminder"
                ? { en: "UPCOMING EVENT", zh: "即将开始的活动" }
                : { en: "PROGRAM UPDATE", zh: "项目通知" },
      ),
      action: { label: copy.action, url: link },
    } satisfies EmailPresentation,
  };
}
