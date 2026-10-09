import { describe, expect, it } from "vitest";
import { classifyApproval } from "./approval-policy";

describe("management authority by effect", () => {
  it.each(["admin.updateSubject", "admin.batchUpdateSubjects", "admin.updateSubjectLevel", "admin.saveCourseGroup", "admin.updateTimeSlot"])("requires Head only when %s restores archived catalogue records", (operation) => {
    expect(classifyApproval(operation, {}, { restoresArchivedRecord: true })).toMatchObject({ category: "REVERSAL", directRoles: ["HEAD"], reviewerRoles: ["HEAD"] });
    expect(classifyApproval(operation, {}, { restoresArchivedRecord: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
  });
  it.each([
    "program.setSignupWindow", "program.setFeaturePending", "program.setTimeZone",
    "program.setCaptcha", "program.setProfilePolicy", "program.setSignupField",
    "program.setEmailNotifications", "program.setSecondaryEmailBinding", "admin.refresh",
    "student.setCalendarDay", "student.setFeedbackSettings", "admin.upsertPolicy",
    "admin.deletePolicyLocale", "i18n.setLanguageEnabled", "i18n.deleteLanguage",
    "i18n.reorderLanguages", "messaging.setPermission", "admin.updateAccountProfile",
    "admin.updateAccountAcademics", "admin.updateAccountUsername", "admin.setUserRole", "admin.setMemberships",
    "admin.updateTutor", "admin.updateTutee", "admin.setUserCanTutor", "admin.setCrewStatus",
  ])("limits %s to Admin requests and Head application", (operation) => {
    const authority = classifyApproval(operation);
    expect(authority?.directRoles).toEqual(["HEAD"]);
    expect(authority?.requesterRoles).toEqual(["ADMIN", "HEAD"]);
    expect(authority?.reviewerRoles).toEqual(["HEAD"]);
  });

  it.each(["admin.undoAudit", "admin.reinstateUser", "admin.reinstateTutee", "admin.deleteAdjustment",
    "admin.revokeRegistrationCode", "corrections.correctAttendance", "corrections.correctPatrol",
    "historicalAcademics.correctBatch"])("requires Head for the entire reversal %s", (operation) => {
    expect(classifyApproval(operation)).toMatchObject({ category: "REVERSAL", directRoles: ["HEAD"], reviewerRoles: ["HEAD"] });
  });

  it("keeps first discipline decisions daily and reviews corrections/restoration with Head", () => {
    expect(classifyApproval("admin.reviewCard", { reviewStatus: "VALID" }, { currentCardReviewStatus: "PENDING" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.reviewCard", { reviewStatus: "INVALID" }, { currentCardReviewStatus: "VALID" })?.directRoles).toEqual(["HEAD"]);
    expect(classifyApproval("student.decideAppeal", { overturn: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("student.decideAppeal", { overturn: true })?.directRoles).toEqual(["HEAD"]);
    expect(classifyApproval("admin.decideAppeal", { action: "APPROVE" })?.directRoles).toEqual(["HEAD"]);
  });

  it("preserves direct supervision and prohibits Coordinator restoration requests", () => {
    expect(classifyApproval("messaging.moderate", { hide: true })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("messaging.moderate", { hide: false })).toMatchObject({ directRoles: ["HEAD"], requesterRoles: ["ADMIN", "HEAD"] });
    expect(classifyApproval("messaging.restrict", { restricted: false })?.reviewerRoles).toEqual(["HEAD"]);
  });

  it("closes alternate reinstatement and content restoration paths", () => {
    expect(classifyApproval("admin.setTuteeStatus", { status: "ACTIVE" }, { currentTuteeStatus: "PENDING" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.setTuteeStatus", { status: "PENDING" }, { currentTuteeStatus: "INACTIVE" })?.directRoles).toEqual(["HEAD"]);
    expect(classifyApproval("admin.assignTuteeToTutor", {}, { currentTuteeStatus: "INACTIVE" })?.directRoles).toEqual(["HEAD"]);
    expect(classifyApproval("home.updateNews", { status: "PUBLISHED" }, { currentNewsStatus: "DRAFT" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("home.updateNews", { status: "PUBLISHED" }, { currentNewsStatus: "ARCHIVED" })?.directRoles).toEqual(["HEAD"]);
    expect(classifyApproval("admin.updateAnnouncement", { active: true }, { currentAnnouncementActive: false })?.directRoles).toEqual(["HEAD"]);
  });

  it("reviews changes to recorded qualifications, interview hours and meeting attendance", () => {
    expect(classifyApproval("interviewManagement.qualify", { qualified: true })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("interviewManagement.qualify", { qualified: false })?.directRoles).toEqual(["HEAD"]);
    expect(classifyApproval("interviewManagement.complete", {}, { interviewCompleted: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("interviewManagement.complete", {}, { interviewCompleted: true })?.directRoles).toEqual(["HEAD"]);
    expect(classifyApproval("admin.recordMeetingAttendance", {}, { changesRecordedMeetingAttendance: true })?.directRoles).toEqual(["HEAD"]);
    expect(classifyApproval("admin.recordMeetingAttendance", {}, { changesRecordedMeetingAttendance: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.deleteMeeting", {}, { meetingHasAttendance: true })?.directRoles).toEqual(["HEAD"]);
  });

  it("allows existing tutor/crew requests, rejecting Coordinator management grants", () => {
    for (const kind of [undefined, "TUTOR", "CREW"])
      expect(classifyApproval("admin.issueRegistrationCode", { kind })?.requesterRoles).toContain("COORDINATOR");
    for (const kind of ["ADMIN", "COORDINATOR"])
      expect(classifyApproval("admin.issueRegistrationCode", { kind })).toMatchObject({ requesterRoles: ["ADMIN", "HEAD"], reviewerRoles: ["HEAD"] });
    for (const currentRegistrationKind of ["ADMIN", "COORDINATOR"])
      expect(classifyApproval("admin.revokeRegistrationCode", {}, { currentRegistrationKind })?.requesterRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.revokeRegistrationCode", {}, { currentRegistrationKind: "TUTOR" })?.requesterRoles).toContain("COORDINATOR");
  });

  it("protects legacy roster profile aliases even when the tutor status is unchanged", () => {
    expect(classifyApproval("admin.updateTutor", { status: "ACTIVE" }, { currentTutorStatus: "ACTIVE" })?.directRoles).toEqual(["HEAD"]);
    expect(classifyApproval("admin.updateTutor", { status: "ACTIVE" }, { currentTutorStatus: "INACTIVE" })?.directRoles).toEqual(["HEAD"]);
    expect(classifyApproval("admin.updateTutor", { status: "ACTIVE" })?.directRoles).toEqual(["HEAD"]);
  });

  it("retains daily authority and rejects unknown operations", () => {
    expect(classifyApproval("admin.createRoom")).toMatchObject({ directRoles: ["ADMIN", "HEAD"], requesterRoles: ["COORDINATOR", "ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"] });
    expect(classifyApproval("admin.futureWrite")).toBeNull();
    expect(classifyApproval("account.updateProfile")).toBeNull();
  });

  it("requires Head when a slot edit propagates changes to submitted attendance", () => {
    expect(classifyApproval("admin.updateTimeSlot", {}, { changesRecordedSlotAttendance: true })?.directRoles).toEqual(["HEAD"]);
    expect(classifyApproval("admin.updateTimeSlot", {}, { changesRecordedSlotAttendance: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
  });
});
