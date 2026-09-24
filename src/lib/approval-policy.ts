/** Explicitly reviewed management operations. Unknown coordinator writes fail closed.
 * Account privileges, program configuration and irreversible file deletion are never proposals.
 * program.setEmailNotifications and program.setSecondaryEmailBinding require ADMIN/HEAD directly. */
// program.setSignupField is a direct Head-only setting; it cannot be proposed or replayed.
/** These operations assign or restore account capabilities. Only Head can apply/review them.
 * qualificationApplication.decide deliberately uses adminOnlyProcedure instead: subject grants
 * do not change account badges and coordinators cannot submit/replay these decisions. */
export const HEAD_APPROVAL_OPERATIONS = new Set([
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
  "admin.cancelTuteeOptOut": "Tutee",
  "admin.reinstateTutee": "Tutee",
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
  "assignment.prepare",
  "assignment.cancel",
  "admin.sendTutorSetup",
  // Email proof/setup only; no role, profile link or verified status is changed by sending.
  "admin.sendAccountVerification",
  // Resending an existing verification link neither assigns a tutor nor extends a deadline.
  "studentWorkflow.resend",
  // Tutors/crew still perform their own duties through their participant procedures.
]);

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
