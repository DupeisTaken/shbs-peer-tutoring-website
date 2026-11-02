import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { formatNotificationEvent } from "~/lib/notification-events";
import { notificationEmailDetail } from "./notification-policy";

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
