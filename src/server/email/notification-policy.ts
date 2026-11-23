import { isNotificationEvent } from "~/lib/notification-events";
import { notificationInAppEvent } from "~/lib/notification-details";

export { eligibleReviewRecipient, reviewNotificationEvents } from "~/lib/notification-categories";
import { reviewNotificationEvents } from "~/lib/notification-categories";

/** Explicitly approved factual snapshots only. Private text/account changes stay generic. */
export const detailedEmailEvents = [
  ...reviewNotificationEvents,
  "message_received", "announcement_published", "account_suspended", "account_reinstated",
  "account_appeal_approved", "account_appeal_declined",
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
  const account = accountChangeDetail(event, input);
  if (account) return account;
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

/** Account trigger context is field-only. Never accept free-form text for security events. */
export function accountChangeDetail(event: string, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.changedFields)) return;
  const copy: Record<string, { en: string; zh: string }> = event === "security_changed" ? {
    password: { en: "Your password was changed.", zh: "你的密码已更改。" },
    twoFactorEnabled: { en: "Email two-factor verification was enabled.", zh: "邮箱双重验证已启用。" },
    twoFactorDisabled: { en: "Email two-factor verification was disabled.", zh: "邮箱双重验证已关闭。" },
  } : event === "information_changed" ? {
    name: { en: "Your display name was updated.", zh: "你的显示姓名已更新。" },
    firstName: { en: "Your first name was updated.", zh: "你的名字已更新。" },
    lastName: { en: "Your last name was updated.", zh: "你的姓氏已更新。" },
    preferredName: { en: "Your preferred name was updated.", zh: "你的常用名已更新。" },
    username: { en: "Your username was updated.", zh: "你的用户名已更新。" },
    alternativeNames: { en: "Your name in another language was updated.", zh: "你的其他语言姓名已更新。" },
    role: { en: "Your account role was updated.", zh: "你的账号角色已更新。" },
    suspended: { en: "Your account access was suspended.", zh: "你的账号访问权限已暂停。" },
    reinstated: { en: "Your account access was restored.", zh: "你的账号访问权限已恢复。" },
    tutorAccessRevoked: { en: "Your tutor access was removed.", zh: "你的辅导伙伴权限已移除。" },
    tutorAccessRestored: { en: "Your tutor access was restored.", zh: "你的辅导伙伴权限已恢复。" },
    tuteeAdded: { en: "Tutee access was added to your account.", zh: "你的账号已添加学习伙伴身份。" },
    tuteeRemoved: { en: "Tutee access was removed from your account.", zh: "你的账号学习伙伴身份已移除。" },
    translationEnabled: { en: "Translation access was enabled.", zh: "翻译权限已启用。" },
    translationDisabled: { en: "Translation access was disabled.", zh: "翻译权限已关闭。" },
    crewStatus: { en: "Your crew status was updated.", zh: "你的巡查队状态已更新。" },
  } : {};
  const fields = [...new Set(value.changedFields.filter((field): field is string => typeof field === "string" && Object.hasOwn(copy, field)))];
  if (!fields.length) return;
  return { en: fields.map((field) => copy[field]!.en).join(" "), zh: fields.map((field) => copy[field]!.zh).join("") };
}
