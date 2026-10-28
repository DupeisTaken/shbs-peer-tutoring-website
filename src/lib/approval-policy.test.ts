import { describe, expect, it } from "vitest";
import {
  APPROVAL_OPERATIONS,
  HEAD_APPROVAL_OPERATIONS,
  classifyApproval,
} from "./approval-policy";

describe("management authority by effect", () => {
  it.each(Object.keys(APPROVAL_OPERATIONS).filter((operation) => operation !== "admin.refresh"))(
    "inherits Admin direct and review authority in Head for %s", (operation) => {
      const authority = classifyApproval(operation);
      expect(authority?.directRoles).toEqual(["ADMIN", "HEAD"]);
      expect(authority?.reviewerRoles).toEqual(["ADMIN", "HEAD"]);
    },
  );
  it("reserves refresh execution for Head while keeping both Admin and Head able to request it", () => {
    expect([...HEAD_APPROVAL_OPERATIONS]).toEqual(["admin.refresh"]);
    expect(classifyApproval("admin.refresh")).toMatchObject({
      directRoles: ["HEAD"], requesterRoles: ["ADMIN", "HEAD"], reviewerRoles: ["HEAD"],
    });
  });
  it("does not turn Coordinator badge proposals into management rank grants or demotions", () => {
    for (const rank of ["ADMIN", "COORDINATOR", "HEAD"])
      expect(classifyApproval("admin.setMemberships", { membership: { rank } })?.requesterRoles).not.toContain("COORDINATOR");
    expect(classifyApproval("admin.setMemberships", { membership: { rank: "NONE" } }, { currentAccountRole: "ADMIN" })?.requesterRoles).not.toContain("COORDINATOR");
    expect(classifyApproval("admin.setMemberships", { membership: { rank: "NONE" } }, { currentAccountRole: "TUTOR" })?.requesterRoles).toContain("COORDINATOR");
    expect(classifyApproval("admin.setUserRole")?.requesterRoles).not.toContain("COORDINATOR");
  });
  it("applies chair acceptance directly while rejection retains Admin review", () => {
    expect(classifyApproval("tutor.decideInterview", { accept: true })).toMatchObject({
      directRoles: ["ADMIN", "HEAD"], requesterRoles: ["ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"],
    });
    expect(classifyApproval("tutor.decideInterview", { accept: false })).toMatchObject({
      directRoles: ["ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"],
    });
  });
  it.each(["admin.setApplicationInvalidity", "studentWorkflow.setRequestInvalidity", "admin.setSignupInvalidity"])("keeps both directions of %s in the daily review queue", (operation) => {
    for (const invalid of [true, false])
      expect(classifyApproval(operation, { invalid })).toEqual({
        category: "DAILY_OPERATION", directRoles: ["ADMIN", "HEAD"],
        requesterRoles: ["COORDINATOR", "ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"],
      });
  });
  it.each(["admin.updateSubject", "admin.batchUpdateSubjects", "admin.updateSubjectLevel", "admin.saveCourseGroup", "admin.updateTimeSlot"])("requires management authority only when %s restores archived catalogue records", (operation) => {
    expect(classifyApproval(operation, {}, { restoresArchivedRecord: true })).toMatchObject({ category: "REVERSAL", directRoles: ["ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"] });
    expect(classifyApproval(operation, {}, { restoresArchivedRecord: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
  });
  it.each([
    "program.setSignupWindow", "program.prepareNextRecruitment", "program.setFeaturePending", "program.setTimeZone",
    "program.setCaptcha", "program.setProfilePolicy", "program.setSignupField",
    "program.setEmailNotifications", "program.setSecondaryEmailBinding",
    "student.setCalendarDay", "student.resetCalendarDay", "student.setFeedbackSettings", "admin.upsertPolicy",
    "admin.deletePolicyLocale", "i18n.setLanguageEnabled", "i18n.deleteLanguage",
    "i18n.reorderLanguages", "messaging.setPermission", "admin.updateAccountProfile",
    "admin.updateAccountAcademics", "admin.updateAccountUsername", "admin.setMemberships",
    "admin.updateTutor", "admin.updateTutee", "admin.setUserCanTutor", "admin.setCrewStatus",
    "admin.correctApplicationIdentity",
  ])("limits %s to Coordinator requests and Admin/Head application", (operation) => {
    const authority = classifyApproval(operation);
    expect(authority?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(authority?.requesterRoles).toEqual(operation === "messaging.setPermission" ? ["ADMIN", "HEAD"] : ["COORDINATOR", "ADMIN", "HEAD"]);
    expect(authority?.reviewerRoles).toEqual(["ADMIN", "HEAD"]);
  });

  it.each(["tutor", "tutee"])("keeps %s preparation and clearing in the same preparation boundary", (audience) => {
    expect(APPROVAL_OPERATIONS["program.prepareNextRecruitment"])
      .toBe("NextRecruitmentPreparation");
    expect(HEAD_APPROVAL_OPERATIONS.has("program.prepareNextRecruitment"))
      .toBe(false);
    for (const opensAt of [null, new Date("2027-01-01T00:00:00Z")])
      expect(classifyApproval("program.prepareNextRecruitment", { audience, opensAt }))
        .toEqual({
          category: "SIGNIFICANT_SETTING",
          directRoles: ["ADMIN", "HEAD"],
          requesterRoles: ["COORDINATOR", "ADMIN", "HEAD"],
          reviewerRoles: ["ADMIN", "HEAD"],
        });
  });

  it.each(["admin.undoAudit", "admin.reinstateUser", "admin.reinstateTutee", "admin.deleteAdjustment",
    "admin.revokeRegistrationCode", "corrections.correctAttendance", "corrections.correctPatrol",
    "historicalAcademics.correctBatch"])("requires management authority for the entire reversal %s", (operation) => {
    expect(classifyApproval(operation)).toMatchObject({ category: "REVERSAL", directRoles: ["ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"] });
  });

  it("keeps first discipline decisions daily and reviews corrections/restoration with Head", () => {
    expect(classifyApproval("admin.reviewCard", { reviewStatus: "VALID" }, { currentCardReviewStatus: "PENDING" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.reviewCard", { reviewStatus: "INVALID" }, { currentCardReviewStatus: "VALID" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("student.decideAppeal", { overturn: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("student.decideAppeal", { overturn: true })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.decideAppeal", { action: "APPROVE" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
  });

  it("preserves direct supervision and prohibits Coordinator restoration requests", () => {
    expect(classifyApproval("messaging.moderate", { hide: true })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("messaging.moderate", { hide: false })).toMatchObject({ directRoles: ["ADMIN", "HEAD"], requesterRoles: ["ADMIN", "HEAD"] });
    expect(classifyApproval("messaging.restrict", { restricted: false })?.reviewerRoles).toEqual(["ADMIN", "HEAD"]);
  });

  it("closes alternate reinstatement and content restoration paths", () => {
    expect(classifyApproval("admin.setTuteeStatus", { status: "ACTIVE" }, { currentTuteeStatus: "PENDING" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.setTuteeStatus", { status: "PENDING" }, { currentTuteeStatus: "INACTIVE" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.assignTuteeToTutor", {}, { currentTuteeStatus: "INACTIVE" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("home.updateNews", { status: "PUBLISHED" }, { currentNewsStatus: "DRAFT" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("home.updateNews", { status: "PUBLISHED" }, { currentNewsStatus: "ARCHIVED" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.updateAnnouncement", { active: true }, { currentAnnouncementActive: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
  });

  it("reviews changes to recorded qualifications, interview hours and meeting attendance", () => {
    expect(classifyApproval("interviewManagement.qualify", { qualified: true })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("interviewManagement.qualify", { qualified: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("interviewManagement.complete", {}, { interviewCompleted: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("interviewManagement.complete", {}, { interviewCompleted: true })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.recordMeetingAttendance", {}, { changesRecordedMeetingAttendance: true })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.recordMeetingAttendance", {}, { changesRecordedMeetingAttendance: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.deleteMeeting", {}, { meetingHasAttendance: true })?.directRoles).toEqual(["ADMIN", "HEAD"]);
  });

  it("lets Admin issue tutor/crew codes directly while retaining Admin review of Coordinator requests", () => {
    for (const kind of [undefined, "TUTOR", "CREW"])
      expect(classifyApproval("admin.issueRegistrationCode", { kind })).toMatchObject({
        directRoles: ["ADMIN", "HEAD"], requesterRoles: ["COORDINATOR", "ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"],
      });
    for (const kind of ["ADMIN", "COORDINATOR"])
      expect(classifyApproval("admin.issueRegistrationCode", { kind })).toMatchObject({ directRoles: ["ADMIN", "HEAD"], requesterRoles: ["ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"] });
    for (const currentRegistrationKind of ["ADMIN", "COORDINATOR"])
      expect(classifyApproval("admin.revokeRegistrationCode", {}, { currentRegistrationKind })?.requesterRoles).toEqual(["ADMIN", "HEAD"]);
    for (const currentRegistrationKind of ["TUTOR", "CREW"])
      expect(classifyApproval("admin.revokeRegistrationCode", {}, { currentRegistrationKind })).toMatchObject({
        directRoles: ["ADMIN", "HEAD"], requesterRoles: ["COORDINATOR", "ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"],
      });
  });

  it("protects legacy roster profile aliases even when the tutor status is unchanged", () => {
    expect(classifyApproval("admin.updateTutor", { status: "ACTIVE" }, { currentTutorStatus: "ACTIVE" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.updateTutor", { status: "ACTIVE" }, { currentTutorStatus: "INACTIVE" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.updateTutor", { status: "ACTIVE" })?.directRoles).toEqual(["ADMIN", "HEAD"]);
  });

  it("retains daily authority and rejects unknown operations", () => {
    expect(classifyApproval("admin.createRoom")).toMatchObject({ directRoles: ["ADMIN", "HEAD"], requesterRoles: ["COORDINATOR", "ADMIN", "HEAD"], reviewerRoles: ["ADMIN", "HEAD"] });
    expect(classifyApproval("admin.futureWrite")).toBeNull();
    expect(classifyApproval("account.updateProfile")).toBeNull();
  });

  it("requires management authority when a slot edit propagates changes to submitted attendance", () => {
    expect(classifyApproval("admin.updateTimeSlot", {}, { changesRecordedSlotAttendance: true })?.directRoles).toEqual(["ADMIN", "HEAD"]);
    expect(classifyApproval("admin.updateTimeSlot", {}, { changesRecordedSlotAttendance: false })?.directRoles).toEqual(["ADMIN", "HEAD"]);
  });
});
