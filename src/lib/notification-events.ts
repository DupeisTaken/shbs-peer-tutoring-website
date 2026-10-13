/** Event identities describe committed facts. Free text (messages, appeals, review notes,
 * announcements and contact details) never belongs in their email-safe context. */
export const notificationEvents = [
  "primary_changed",
  "secondary_added",
  "secondary_removed",
  "security_changed",
  "information_changed",
  "message_received",
  "program_update",
  "tutor_application_pending",
  "qualification_requested",
  "qualification_approved",
  "qualification_rejected",
  "crew_application_pending",
  "viewer_registered",
  "tutor_setup_needed",
  "interview_panel_assigned",
  "interview_scheduled",
  "management_review_pending",
  "management_head_review_pending",
  "management_approved",
  "management_rejected",
  "translation_review_pending",
  "announcement_published",
  "tutor_optout_requested",
  "tutor_reentry_requested",
  "crew_optout_requested",
  "crew_reentry_requested",
  "membership_optout_approved",
  "membership_reentry_approved",
  "membership_declined",
  "tutee_optout_requested",
  "tutee_optout_cancelled",
  "tutee_removed",
  "attendance_cards_pending",
  "attendance_room_reported",
  "attendance_review_warning",
  "attendance_review_penalty",
  "attendance_review_escalated",
  "attendance_history_updated",
  "account_suspended",
  "account_reinstated",
  "account_appeal_requested",
  "account_appeal_approved",
  "account_appeal_declined",
  "record_corrected",
  "tutee_feedback_received",
  "tutee_card_appeal",
  "tutee_appeal_reviewed",
  "student_assignment_updated",
  "student_availability_updated",
  "student_request_recalled",
  "student_request_expired",
  "student_withdrawal_pending",
  "student_withdrawal_approved",
  "student_withdrawal_declined",
  "student_schedule_review_pending",
  "student_schedule_review_approved",
  "student_schedule_review_declined",
  "tutor_reactivated",
  "tutor_opted_out",
  "meeting_absence_excused",
  "school_departure_updated",
  "request_invalidity_appeal_pending",
] as const;
export type NotificationEvent = (typeof notificationEvents)[number];
const supported = new Set<string>(notificationEvents);
export function isNotificationEvent(
  value: unknown,
): value is NotificationEvent {
  return typeof value === "string" && supported.has(value);
}

export type NotificationContext = {
  count?: number;
  startsAt?: string;
  timeZone?: string;
};
const counted = new Set<NotificationEvent>([
  "attendance_cards_pending",
  "attendance_history_updated",
]);

/** Sanitize on both write and read. Adding a field requires an explicit event allowlist;
 * callers cannot accidentally serialize an entire application, message or profile. */
export function notificationEvent(
  event: NotificationEvent,
  input: unknown = {},
) {
  const context: Record<string, string | number> = {};
  const data =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (
    counted.has(event) &&
    typeof data.count === "number" &&
    Number.isSafeInteger(data.count) &&
    data.count >= 0
  )
    context.count = data.count;
  if (
    event === "interview_scheduled" &&
    typeof data.startsAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.startsAt) &&
    Number.isFinite(Date.parse(data.startsAt)) &&
    new Date(data.startsAt).toISOString() === data.startsAt &&
    typeof data.timeZone === "string"
  ) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: data.timeZone }).format(
        new Date(data.startsAt),
      );
      context.startsAt = new Date(data.startsAt).toISOString();
      context.timeZone = data.timeZone;
    } catch {
      /* Missing/invalid time context uses the readable undated event description. */
    }
  }
  return { event, context };
}

type CopyKey =
  | `${NotificationEvent}.${"title" | "body" | "action"}`
  | "attendance_cards_pending.bodyWithoutCount"
  | "attendance_history_updated.bodyWithoutCount";
type Translate = (
  key: CopyKey,
  values?: Record<string, string | number>,
) => string;
/** One semantic formatter powers both surfaces. Instant and timezone are recorded together;
 * recurring assignments never acquire an invented calendar date or next-session promise. */
export function formatNotificationEvent(
  event: string | null | undefined,
  input: unknown,
  locale: string,
  t: Translate,
) {
  if (!isNotificationEvent(event)) return null;
  const { context } = notificationEvent(event, input);
  let time = "";
  if (
    typeof context.startsAt === "string" &&
    typeof context.timeZone === "string"
  ) {
    time = `${new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: context.timeZone }).format(new Date(context.startsAt))} (${context.timeZone})`;
  }
  const bodyKey: CopyKey =
    context.count === undefined && event === "attendance_cards_pending"
      ? "attendance_cards_pending.bodyWithoutCount"
      : context.count === undefined && event === "attendance_history_updated"
        ? "attendance_history_updated.bodyWithoutCount"
        : `${event}.body`;
  return {
    title: t(`${event}.title`),
    body: t(bodyKey, { count: context.count ?? 0 }),
    action: t(`${event}.action`),
    time,
  };
}
