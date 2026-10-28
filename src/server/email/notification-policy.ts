import { isNotificationEvent } from "~/lib/notification-events";
import { notificationInAppEvent } from "~/lib/notification-details";

/** Classify the fact, not its title or destination. Outcomes remain ordinary updates. */
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
  "crew_application_pending",
  "tutor_optout_requested",
  "tutor_reentry_requested",
  "crew_optout_requested",
  "crew_reentry_requested",
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

/** Explicitly approved factual snapshots only. Private text/account changes stay generic. */
export const detailedEmailEvents = [
  ...reviewNotificationEvents,
  "qualification_approved",
  "qualification_rejected",
  "viewer_registered",
  "tutor_setup_needed",
  "interview_panel_assigned",
  "interview_scheduled",
  "interview_approved",
  "management_approved",
  "management_rejected",
  "membership_optout_approved",
  "membership_reentry_approved",
  "membership_declined",
  "tutee_optout_cancelled",
  "tutee_removed",
  "attendance_room_reported",
  "attendance_review_warning",
  "attendance_review_penalty",
  "attendance_review_escalated",
  "attendance_history_updated",
  "record_corrected",
  "tutee_feedback_received",
  "tutee_appeal_reviewed",
  "student_assignment_updated",
  "student_availability_updated",
  "student_request_recalled",
  "student_signup_rejected",
  "student_request_expired",
  "student_withdrawal_approved",
  "student_withdrawal_declined",
  "student_schedule_review_approved",
  "student_schedule_review_declined",
  "tutor_reactivated",
  "tutor_opted_out",
  "meeting_absence_excused",
  "school_departure_updated",
  "meeting_upcoming",
  "interview_upcoming",
  "tutoring_upcoming",
] as const;

export function notificationEmailDetail(event: string, input: unknown) {
  if (
    !isNotificationEvent(event) ||
    !(detailedEmailEvents as readonly string[]).includes(event)
  )
    return;
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  // Email delivery rows carry only the explicitly selected emailDetail, never raw body text.
  return notificationInAppEvent(event, { inAppDetail: value.emailDetail })
    .context.inAppDetail;
}
