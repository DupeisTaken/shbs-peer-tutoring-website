/** Explicit management authority inventory. Unknown coordinator writes fail closed.
 * Participant self-service remains owned by its separate account/tutor/student procedures. */
// recordTransfer.* requires HEAD directly. Imports/exports cannot be proposed or replayed.
// tuteeHistory.invite/link/cancelInvitation require ADMIN/HEAD directly. Conflict correction
// additionally reauthenticates Head; public history account setup grants no membership.
/** These operations assign or restore account capabilities and retain Head review.
 * classifyApproval explicitly allows Admin to issue Tutor/Crew invitations directly.
 * qualificationApplication.decide deliberately uses adminOnlyProcedure instead: subject grants
 * do not change account badges and coordinators cannot submit/replay these decisions. */
export const HEAD_APPROVAL_OPERATIONS = new Set([
  "program.setCaptcha",
  "program.setProfilePolicy",
  "program.setSignupField",
  "program.setEmailNotifications",
  "program.setSecondaryEmailBinding",
  "program.setTimeZone",
  "program.setSignupWindow",
  "program.setFeaturePending",
  "admin.refresh",
  "i18n.setLanguageEnabled",
  "i18n.deleteLanguage",
  "i18n.reorderLanguages",
  "messaging.setPermission",
  "student.setCalendarDay",
  "student.setFeedbackSettings",
  "admin.upsertPolicy",
  "admin.deletePolicyLocale",
  "admin.updateAccountProfile",
  "admin.updateAccountAcademics",
  "admin.updateAccountUsername",
  "admin.updateTutee",
  "admin.setUserRole",
  "admin.undoAudit",
  "admin.reinstateTutee",
  "admin.reinstateUser",
  "admin.deleteAdjustment",
  "admin.revokeRegistrationCode",
  "corrections.correctAttendance",
  "corrections.correctPatrol",
  "historicalAcademics.correctBatch",
  "departure.setState",
  "admin.setMemberships",
  "admin.setUserCanTutor",
  "admin.setCrewStatus",
  "admin.decideCrewApplication",
  "admin.decideCrewRequest",
  "admin.decideTutorRequest",
  "admin.issueRegistrationCode",
  "admin.updateTutor",
  "admin.setApplicationStatus",
  "tutor.decideInterview",
]);
export const APPROVAL_OPERATIONS: Record<string, string> = {
  "program.setCaptcha": "ProgramSettings",
  "program.setProfilePolicy": "ProgramSettings",
  "program.setSignupField": "ProgramSettings",
  "program.setEmailNotifications": "ProgramSettings",
  "program.setSecondaryEmailBinding": "ProgramSettings",
  "program.setTimeZone": "ProgramSettings",
  "program.setSignupWindow": "Term",
  "program.setFeaturePending": "ProgramFeature",
  "admin.refresh": "Term",
  "i18n.setLanguageEnabled": "Language",
  "i18n.deleteLanguage": "Language",
  "i18n.reorderLanguages": "Language",
  "messaging.setPermission": "MessagePermission",
  "admin.updateAccountUsername": "User",
  "admin.setUserRole": "User",
  "admin.revokeRegistrationCode": "RegistrationCode",
  "messaging.moderate": "DirectMessage",
  "messaging.restrict": "User",
  "historicalAcademics.correctBatch": "HistoricalAcademicRecord",
  "departure.setState": "User",
  "corrections.correctAttendance": "Session",
  "corrections.correctPatrol": "Patrol",
  "interviewManagement.qualify": "Tutor",
  "subjectAvailability.setWillingness": "Tutor",
  "interviewManagement.complete": "TutorApplication",
  "student.setCalendarDay": "SchoolCalendarDay",
  "student.setFeedbackSettings": "StudentSettings",
  "student.decideAppeal": "StudentAppeal",
  "studentWorkflow.assign": "StudentSurvey",
  "studentWorkflow.resolveReview": "StudentRequestReview",
  "translationReview.decide": "TranslationDraft",
  "tutor.decideInterview": "TutorApplication",
  "home.setContent": "HomeContent",
  "home.setNewsTranslation": "NewsPost",
  "home.setSectionTranslation": "LandingSection",
  "home.setPageTitle": "CustomPage",
  "localization.setString": "MessageOverride",
  "admin.saveCourseGroup": "CourseGroup",
  "admin.reorderCatalogue": "CourseGroup",
  "admin.createSubjectLevel": "SubjectLevel",
  "admin.updateSubjectLevel": "SubjectLevel",
  "admin.deleteSubjectLevel": "SubjectLevel",
  "admin.createPairing": "Pairing",
  "admin.updatePairing": "Pairing",
  "admin.deletePairing": "Pairing",
  "admin.setUserCanTutor": "User",
  "admin.setMemberships": "User",
  "admin.issueRegistrationCode": "RegistrationCode",
  "admin.createTutor": "Tutor",
  "admin.updateTutor": "Tutor",
  "admin.updateAccountProfile": "User",
  "admin.updateAccountAcademics": "User",
  "admin.createTutee": "Tutee",
  "admin.updateTutee": "Tutee",
  "admin.assignTuteeToTutor": "Tutee",
  "admin.assignSignup": "Tutee",
  "admin.setTuteeStatus": "Tutee",
  "admin.deleteTutee": "Tutee",
  "admin.createSubject": "Subject",
  "admin.updateSubject": "Subject",
  "admin.deleteSubject": "Subject",
  "admin.batchUpdateSubjects": "Subject",
  "admin.importSubjects": "Subject",
  "admin.importCourseGroups": "CourseGroup",
  "admin.createTimeSlot": "TimeSlot",
  "admin.updateTimeSlot": "TimeSlot",
  "admin.deleteTimeSlot": "TimeSlot",
  "admin.createRoom": "Room",
  "admin.updateRoom": "Room",
  "admin.deleteRoom": "Room",
  "admin.createRoomUnavailability": "RoomUnavailability",
  "admin.updateRoomUnavailability": "RoomUnavailability",
  "admin.deleteRoomUnavailability": "RoomUnavailability",
  "admin.createMeeting": "TutorMeeting",
  "admin.deleteMeeting": "TutorMeeting",
  "admin.recordMeetingAttendance": "MeetingAttendance",
  "admin.createAdjustment": "ServiceHourAdjustment",
  "admin.deleteAdjustment": "ServiceHourAdjustment",
  "admin.assignInterviewers": "TutorApplication",
  "admin.setApplicationStatus": "TutorApplication",
  "admin.deleteApplication": "TutorApplication",
  "admin.decideTutorRequest": "TutorStatusRequest",
  "admin.requeueTutorTutees": "Tutor",
  "admin.cancelTuteeOptOut": "TuteeRemovalRequest",
  "admin.reinstateTutee": "TuteeRemovalRequest",
  "admin.setCrewStatus": "User",
  "admin.setPatrolOrder": "Room",
  "admin.decideCrewApplication": "CrewApplication",
  "admin.decideCrewRequest": "CrewStatusRequest",
  "admin.decideSessionFlag": "SessionFlag",
  "admin.suspendUser": "User",
  "admin.reinstateUser": "User",
  "admin.decideAppeal": "AccountAppeal",
  "admin.upsertPolicy": "PolicyDocument",
  "admin.deletePolicyLocale": "PolicyDocument",
  "admin.createAnnouncement": "Announcement",
  "admin.updateAnnouncement": "Announcement",
  "admin.deleteAnnouncement": "Announcement",
  "admin.reviewCard": "DisciplinaryCard",
  "admin.undoAudit": "AuditLog",
  "home.createNews": "NewsPost",
  "home.updateNews": "NewsPost",
  "home.removeNewsTranslation": "NewsPost",
  "home.deleteNews": "NewsPost",
  "home.setImageAlt": "HomeImage",
  "home.createSection": "LandingSection",
  "home.updateSection": "LandingSection",
  "home.reorderSections": "LandingSection",
  "home.removeSectionTranslation": "LandingSection",
  "home.deleteSection": "LandingSection",
  "home.setLayout": "PageLayout",
  "home.createPage": "CustomPage",
  "home.updatePage": "CustomPage",
  "home.reorderPages": "CustomPage",
  "home.deletePage": "CustomPage",
};

export const COORDINATOR_DIRECT_OPERATIONS = new Set([
  // Read-only preview uses POST so academic CSV contents never enter a query URL.
  "historicalAcademics.preview",
  "assignment.prepare",
  "assignment.cancel",
  "admin.sendTutorSetup",
  // Email proof/setup only; no role, profile link or verified status is changed by sending.
  "admin.sendAccountVerification",
  // Resending an existing verification link neither assigns a tutor nor extends a deadline.
  "studentWorkflow.resend",
  // Tutors/crew still perform their own duties through their participant procedures.
]);

export type ManagementRole = "HEAD" | "ADMIN" | "COORDINATOR";
export type ApprovalAuthority = {
  category: "SIGNIFICANT_SETTING" | "ACCOUNT_ACCESS" | "REVERSAL" | "DAILY_OPERATION";
  directRoles: readonly string[];
  requesterRoles: readonly string[];
  reviewerRoles: readonly ManagementRole[];
};

const significantSettings = new Set([
  "program.setCaptcha", "program.setProfilePolicy", "program.setSignupField",
  "program.setEmailNotifications", "program.setSecondaryEmailBinding",
  "program.setTimeZone", "program.setSignupWindow", "program.setFeaturePending",
  "admin.refresh", "i18n.setLanguageEnabled", "i18n.deleteLanguage", "i18n.reorderLanguages", "messaging.setPermission",
  "student.setCalendarDay", "student.setFeedbackSettings", "admin.upsertPolicy",
  "admin.deletePolicyLocale",
]);
const managementEdits = new Set([
  "admin.updateAccountProfile", "admin.updateAccountAcademics", "admin.updateAccountUsername",
  "admin.setUserRole", "admin.setMemberships", "admin.setUserCanTutor", "admin.setCrewStatus",
  "admin.updateTutor", "admin.updateTutee",
]);
const reversals = new Set([
  "admin.undoAudit", "admin.reinstateTutee", "admin.reinstateUser",
  "admin.deleteAdjustment", "admin.revokeRegistrationCode",
  // A correction may remove a reviewed deduction and restore dependent participation.
  // Review the complete correction with Head before applying any part of it.
  "corrections.correctAttendance", "corrections.correctPatrol", "historicalAcademics.correctBatch",
]);

/** Authority depends on effects, including legacy payloads. Context comes from live DB state;
 * callers cannot claim that a tutor's status is unchanged in order to avoid Head review. */
export function classifyApproval(
  operation: string,
  input?: unknown,
  context: { currentTutorStatus?: string; currentCardReviewStatus?: string; currentTuteeStatus?: string;
    currentNewsStatus?: string; currentAnnouncementActive?: boolean; interviewCompleted?: boolean;
    changesRecordedMeetingAttendance?: boolean; meetingHasAttendance?: boolean; changesRecordedSlotAttendance?: boolean;
    currentRegistrationKind?: string; restoresArchivedRecord?: boolean } = {},
): ApprovalAuthority | null {
  if (!Object.hasOwn(APPROVAL_OPERATIONS, operation)) return null;
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (significantSettings.has(operation))
    return { category: "SIGNIFICANT_SETTING", directRoles: ["HEAD"], requesterRoles: ["ADMIN", "HEAD"], reviewerRoles: ["HEAD"] };
  if (managementEdits.has(operation))
    return { category: "ACCOUNT_ACCESS", directRoles: ["HEAD"], requesterRoles: ["ADMIN", "HEAD"], reviewerRoles: ["HEAD"] };
  if (reversals.has(operation) || context.restoresArchivedRecord === true ||
      (operation === "messaging.moderate" && value.hide === false) ||
      (operation === "messaging.restrict" && value.restricted === false) ||
      (operation === "admin.decideAppeal" && value.action === "APPROVE") ||
      (operation === "student.decideAppeal" && value.overturn === true) ||
      (operation === "admin.setTuteeStatus" && context.currentTuteeStatus === "INACTIVE" && value.status !== "INACTIVE") ||
      (operation === "admin.assignTuteeToTutor" && context.currentTuteeStatus === "INACTIVE") ||
      (operation === "home.updateNews" && context.currentNewsStatus === "ARCHIVED" && value.status !== undefined && value.status !== "ARCHIVED") ||
      (operation === "admin.updateAnnouncement" && context.currentAnnouncementActive === false && value.active === true) ||
      (operation === "interviewManagement.qualify" && value.qualified === false) ||
      (operation === "interviewManagement.complete" && context.interviewCompleted === true) ||
      (operation === "admin.recordMeetingAttendance" && context.changesRecordedMeetingAttendance === true) ||
      (operation === "admin.deleteMeeting" && context.meetingHasAttendance === true) ||
      (operation === "admin.updateTimeSlot" && context.changesRecordedSlotAttendance === true) ||
      (operation === "admin.reviewCard" && context.currentCardReviewStatus !== "PENDING"))
    return { category: "REVERSAL", directRoles: ["HEAD"], requesterRoles: operation.startsWith("messaging.") || operation === "historicalAcademics.correctBatch" ||
      (operation === "admin.revokeRegistrationCode" && ["ADMIN", "COORDINATOR"].includes(context.currentRegistrationKind ?? ""))
      ? ["ADMIN", "HEAD"] : ["COORDINATOR", "ADMIN", "HEAD"], reviewerRoles: ["HEAD"] };
  // Supervision remains immediate Admin/Head authority; only restorations enter this queue.
  if (operation.startsWith("messaging."))
    return { category: "DAILY_OPERATION", directRoles: ["ADMIN", "HEAD"], requesterRoles: ["ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"] };
  const tutorStatusChange = operation === "admin.updateTutor" &&
    (context.currentTutorStatus === undefined || value.status !== context.currentTutorStatus);
  if (HEAD_APPROVAL_OPERATIONS.has(operation) &&
      (operation !== "admin.updateTutor" || tutorStatusChange)) {
    const managementCode = operation === "admin.issueRegistrationCode" && ["ADMIN", "COORDINATOR"].includes(String(value.kind));
    // Admin may issue participation invitations directly. Coordinator proposals still
    // go to Head, and this exception never extends to management grants or revocation.
    const participationCode = operation === "admin.issueRegistrationCode" &&
      (value.kind === undefined || value.kind === "TUTOR" || value.kind === "CREW");
    return { category: "ACCOUNT_ACCESS", directRoles: participationCode ? ["ADMIN", "HEAD"] : ["HEAD"],
      requesterRoles: managementCode ? ["ADMIN", "HEAD"] : operation === "tutor.decideInterview" ? ["TUTOR", "COORDINATOR", "ADMIN", "HEAD"] : ["COORDINATOR", "ADMIN", "HEAD"],
      reviewerRoles: ["HEAD"] };
  }
  return { category: "DAILY_OPERATION", directRoles: ["ADMIN", "HEAD"], requesterRoles: ["COORDINATOR", "ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"] };
}

/** Messaging supervision is immediate ADMIN/HEAD authority, never a coordinator proposal.
 * Participant sends/read receipts retain protectedProcedure ownership checks. */
export const MESSAGING_ADMIN_OPERATIONS = new Set([
  "messaging.setPermission",
  "messaging.review",
  "messaging.moderate",
  "messaging.restrict",
]);

/** Each reviewer opens a fresh consequence dialog. Never replay another user's ticket. */
export function proposalConfirmation(operation: string, value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string"
  )
    return null;
  if (operation === "studentWorkflow.assign")
    return { action: "ASSIGN" as const, target: value.id };
  if (
    operation === "studentWorkflow.resolveReview" &&
    "approve" in value &&
    typeof value.approve === "boolean"
  )
    return {
      action: value.approve ? ("APPROVE" as const) : ("DENY" as const),
      target: value.id,
    };
  return null;
}

/** Stable, readable fallback for audit operations and proposal field labels. */
export function humanizeOperation(operation: string): string {
  const words = (operation.split(".").at(-1) ?? operation)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function actionKind(operation: string): "ACTION" | "DECISION" {
  return /\.(decide|review|vote|castInterviewVote|setApplicationStatus|completeInterview|qualify)/.test(
    operation,
  )
    ? "DECISION"
    : "ACTION";
}
