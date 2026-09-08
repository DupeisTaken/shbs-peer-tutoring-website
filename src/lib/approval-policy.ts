/** Explicitly reviewed management operations. Unknown coordinator writes fail closed.
 * Account privileges, program configuration and irreversible file deletion are never proposals. */
export const APPROVAL_OPERATIONS: Record<string, string> = {
  "tutor.decideInterview": "TutorApplication",
  "home.setContent": "HomeContent",
  "home.setNewsTranslation": "NewsPost",
  "home.setSectionTranslation": "LandingSection",
  "home.setPageTitle": "CustomPage",
  "localization.setString": "MessageOverride",
  "admin.createSubjectLevel": "SubjectLevel",
  "admin.updateSubjectLevel": "SubjectLevel",
  "admin.deleteSubjectLevel": "SubjectLevel",
  "admin.createPairing": "Pairing",
  "admin.updatePairing": "Pairing",
  "admin.deletePairing": "Pairing",
  "admin.setUserCanTutor": "User",
  "admin.createTutor": "Tutor",
  "admin.updateTutor": "Tutor",
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
  "admin.createTimeSlot": "TimeSlot",
  "admin.updateTimeSlot": "TimeSlot",
  "admin.deleteTimeSlot": "TimeSlot",
  "admin.createRoom": "Room",
  "admin.updateRoom": "Room",
  "admin.deleteRoom": "Room",
  "admin.createRoomUnavailability": "RoomUnavailability",
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
  "admin.sendTutorSetup",
  // Tutors/crew still perform their own duties through their participant procedures.
]);

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
