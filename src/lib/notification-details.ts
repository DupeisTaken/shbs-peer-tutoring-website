import {
  formatNotificationEvent,
  isNotificationEvent,
  notificationEvent,
  type NotificationEvent,
} from "./notification-events";

export type NotificationInAppDetail = { en: string; zh: string };

function inAppDetail(value: unknown): NotificationInAppDetail | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const detail = value as Record<string, unknown>;
  if (
    typeof detail.en !== "string" ||
    typeof detail.zh !== "string" ||
    !detail.en.trim() ||
    !detail.zh.trim() ||
    detail.en.length > 1000 ||
    detail.zh.length > 1000
  )
    return;
  return { en: detail.en.trim(), zh: detail.zh.trim() };
}

/** Detail is a bounded, recorded snapshot. Email promotion requires its separate
 * event allowlist; reads revalidate imported/malformed JSON at this boundary. */
export function notificationInAppEvent(
  event: NotificationEvent,
  input: unknown = {},
  detail?: NotificationInAppDetail,
) {
  const safe = notificationEvent(event, input);
  const candidate =
    detail ??
    (input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).inAppDetail
      : undefined);
  const checked = inAppDetail(candidate);
  return {
    event,
    context: {
      ...safe.context,
      ...(checked ? { inAppDetail: checked } : {}),
    },
  };
}

/** Stored details describe the original change. Never reconstruct historical
 * notices from current records, or pass these details to the email formatter. */
export function formatNotificationInApp(
  event: string | null | undefined,
  input: unknown,
  locale: string,
  t: Parameters<typeof formatNotificationEvent>[3],
  stored: { title: string; body?: string | null },
) {
  const copy = formatNotificationEvent(event, input, locale, t);
  const detail = isNotificationEvent(event)
    ? notificationInAppEvent(event, input).context.inAppDetail
    : undefined;
  let storedBody = stored.body?.trim();
  if (storedBody === "") storedBody = undefined;
  return {
    title: copy?.title ?? stored.title,
    body: detail
      ? detail[locale.split("-")[0] === "zh" ? "zh" : "en"]
      : (storedBody ?? copy?.body ?? ""),
    time: copy?.time ?? "",
    action: copy?.action ?? "",
  };
}
