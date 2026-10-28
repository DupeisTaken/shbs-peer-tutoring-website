import {
  isNotificationEvent,
  type NotificationEvent,
} from "./notification-events";

export const notificationCategories = [
  "messages",
  "reviews",
  "applications",
  "tutoring",
  "attendance",
  "membership",
  "account",
  "announcements",
  "management",
  "program",
  "reminders",
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];
export function isNotificationCategory(
  value: unknown,
): value is NotificationCategory {
  return (
    typeof value === "string" &&
    (notificationCategories as readonly string[]).includes(value)
  );
}

export const reviewNotificationEvents = [
  "tutor_application_pending",
  "qualification_requested",
  "crew_application_pending",
  "management_review_pending",
  "management_head_review_pending",
  "translation_review_pending",
  "tutor_optout_requested",
  "tutor_reentry_requested",
  "crew_optout_requested",
  "crew_reentry_requested",
  "tutee_optout_requested",
  "attendance_cards_pending",
  "account_appeal_requested",
  "tutee_card_appeal",
  "student_withdrawal_pending",
  "student_schedule_review_pending",
  "request_invalidity_appeal_pending",
] as const;
const headOnly = new Set<string>([
  "management_head_review_pending",
]);
export function eligibleReviewRecipient(
  user: {
    role: string;
    suspendedAt?: Date | null;
    mergedIntoId?: string | null;
  },
  event?: string,
) {
  return (
    (!event ||
      (reviewNotificationEvents as readonly string[]).includes(event)) &&
    !user.suspendedAt &&
    !user.mergedIntoId &&
    (user.role === "HEAD" ||
      (user.role === "ADMIN" && (!event || !headOnly.has(event))))
  );
}

/** Every typed event owns a stable topic. Reviewer copies override this domain topic. */
export const notificationEventCategories = {
  primary_changed: "account",
  secondary_added: "account",
  secondary_removed: "account",
  security_changed: "account",
  information_changed: "account",
  message_received: "messages",
  program_update: "program",
  tutor_application_pending: "applications",
  qualification_requested: "applications",
  qualification_approved: "applications",
  qualification_rejected: "applications",
  crew_application_pending: "applications",
  viewer_registered: "account",
  tutor_setup_needed: "account",
  interview_panel_assigned: "applications",
  interview_scheduled: "applications",
  interview_approved: "applications",
  interview_upcoming: "reminders",
  meeting_upcoming: "reminders",
  tutoring_upcoming: "reminders",
  management_review_pending: "management",
  management_head_review_pending: "management",
  management_approved: "management",
  management_rejected: "management",
  translation_review_pending: "management",
  announcement_published: "announcements",
  tutor_optout_requested: "membership",
  tutor_reentry_requested: "membership",
  crew_optout_requested: "membership",
  crew_reentry_requested: "membership",
  membership_optout_approved: "membership",
  membership_reentry_approved: "membership",
  membership_declined: "membership",
  tutee_optout_requested: "tutoring",
  tutee_optout_cancelled: "tutoring",
  tutee_removed: "tutoring",
  attendance_cards_pending: "attendance",
  attendance_room_reported: "attendance",
  attendance_review_warning: "attendance",
  attendance_review_penalty: "attendance",
  attendance_review_escalated: "attendance",
  attendance_history_updated: "attendance",
  account_suspended: "account",
  account_reinstated: "account",
  account_appeal_requested: "account",
  account_appeal_approved: "account",
  account_appeal_declined: "account",
  record_corrected: "attendance",
  tutee_feedback_received: "attendance",
  tutee_card_appeal: "attendance",
  tutee_appeal_reviewed: "attendance",
  student_assignment_updated: "tutoring",
  student_availability_updated: "tutoring",
  student_request_recalled: "tutoring",
  student_signup_rejected: "tutoring",
  student_request_expired: "tutoring",
  student_withdrawal_pending: "tutoring",
  student_withdrawal_approved: "tutoring",
  student_withdrawal_declined: "tutoring",
  student_schedule_review_pending: "tutoring",
  student_schedule_review_approved: "tutoring",
  student_schedule_review_declined: "tutoring",
  tutor_reactivated: "membership",
  tutor_opted_out: "membership",
  meeting_absence_excused: "attendance",
  school_departure_updated: "membership",
  request_invalidity_appeal_pending: "tutoring",
  room_assignment_needed: "tutoring",
} satisfies Record<NotificationEvent, NotificationCategory>;

export function notificationCategory(
  event: string | null | undefined,
  recipient?: {
    role: string;
    suspendedAt?: Date | null;
    mergedIntoId?: string | null;
  },
  link?: string | null,
): NotificationCategory {
  if (!isNotificationEvent(event))
    return link === "/messages" ? "messages" : "program";
  if (recipient && eligibleReviewRecipient(recipient, event)) return "reviews";
  return notificationEventCategories[event];
}

export type LegacyNotificationPreferences = {
  emailMessages?: boolean;
  emailInfo?: boolean;
  emailReviewRequests?: boolean;
  emailEventReminders?: boolean;
};
export type NotificationPreferenceValue = {
  category: string;
  badgeEnabled: boolean;
  emailEnabled: boolean;
};
export function legacyEmailEnabled(
  user: LegacyNotificationPreferences,
  category: NotificationCategory,
) {
  return (
    (category === "messages"
      ? user.emailMessages
      : category === "reviews"
        ? user.emailReviewRequests
        : category === "reminders"
          ? user.emailEventReminders
          : user.emailInfo) ?? false
  );
}
export function effectiveNotificationPreference(
  user: LegacyNotificationPreferences,
  category: NotificationCategory,
  preferences: readonly NotificationPreferenceValue[] = [],
) {
  const saved = preferences.find((item) => item.category === category);
  return {
    category,
    badgeEnabled: saved?.badgeEnabled ?? true,
    emailEnabled: saved?.emailEnabled ?? legacyEmailEnabled(user, category),
  };
}
export const informationCategories = notificationCategories.filter(
  (category) =>
    !(["messages", "reviews", "reminders"] as readonly string[]).includes(
      category,
    ),
);
