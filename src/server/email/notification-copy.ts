import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { formatNotificationEvent } from "~/lib/notification-events";
import { notificationEmailDetail } from "./notification-policy";
import type { EmailPresentation } from "./template";

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

/** There is no persisted recipient language. Send both maintained languages rather
 * than guessing from the actor's browser. Unknown legacy events remain generic;
 * their arbitrary notification bodies are never recovered into email. */
export function notificationEmailCopy(event: string, context: unknown) {
  const detail = notificationEmailDetail(event, context);
  const english =
    formatNotificationEvent(event, context, "en", translators.en) ??
    formatNotificationEvent("program_update", {}, "en", translators.en)!;
  const chinese =
    formatNotificationEvent(event, context, "zh", translators.zh) ??
    formatNotificationEvent("program_update", {}, "zh", translators.zh)!;
  return {
    subject: `${english.title} / ${chinese.title}`,
    description: `${detail?.en ?? english.body}${english.time ? `\n${english.time}` : ""}\n\n${detail?.zh ?? chinese.body}${chinese.time ? `\n${chinese.time}` : ""}`,
    action: `${english.action} / ${chinese.action}`,
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
}) {
  const { category, timeZone, link, unsubscribeUrl } = input;
  const essential = category === "security";
  const copy = notificationEmailCopy(input.event, input.context);
  const time = new Intl.DateTimeFormat("en", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone,
  }).format(input.createdAt);
  const issued = `Notice issued / 通知发出时间: ${time} (${timeZone})`;
  const footer = essential
    ? "If you do not recognize this activity, contact the program team through private support.\n如非本人操作，请通过私密支持联系项目团队。"
    : "";
  return {
    subject: copy.subject,
    text: `${copy.description}\n\n${issued}${footer ? `\n\n${footer}` : ""}\n\n${link}${unsubscribeUrl ? `\n\nUnsubscribe / 取消订阅: ${unsubscribeUrl}` : ""}`,
    presentation: {
      body: `${copy.description}\n\n${issued}${essential ? `\n\n${footer}` : ""}`,
      ...(unsubscribeUrl ? { unsubscribeUrl } : {}),
      eyebrow: essential
        ? "ACCOUNT SECURITY"
        : category === "messages"
          ? "PRIVATE MESSAGES"
          : category === "review"
            ? "REVIEW REQUEST"
            : category === "reminder"
              ? "UPCOMING EVENT"
              : "PROGRAM UPDATE",
      action: { label: copy.action, url: link },
    } satisfies EmailPresentation,
  };
}
