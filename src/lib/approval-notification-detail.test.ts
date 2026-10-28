import { describe, expect, it } from "vitest";
import { approvalNotificationDetail } from "./approval-notification-detail";
import { notificationEmailCopy } from "~/server/email/notification-copy";
import { notificationInAppEvent } from "./notification-details";

const targets = {
  StudentSurvey: [
    {
      record: {
        id: "survey",
        email: "private@example.test",
        payload: { englishName: "Original Emma", reason: "Private answer" },
        currentPayload: { englishName: "Emma Chen" },
      },
    },
  ],
  Tutor: [
    { record: { id: "tutor", name: "Alice Lin", passwordHash: "secret" } },
  ],
  Subject: [{ record: { id: "subject", name: "Mathematics" } }],
};
const payload = {
  id: "survey",
  tutorId: "tutor",
  subjectId: "subject",
  ticket: "private-ticket",
};

describe("management notification details", () => {
  it("names the exact proposed assignment in both languages without claiming it was applied", () => {
    const detail = approvalNotificationDetail(
      "studentWorkflow.assign",
      payload,
      targets,
      "pending",
    );
    expect(detail.en).toBe(
      "Proposed assignment: Tutee Emma Chen → Tutor Alice Lin (Mathematics).",
    );
    expect(detail.zh).toBe(
      "待审核的分配：学习伙伴 Emma Chen → 辅导伙伴 Alice Lin（Mathematics）。",
    );
    expect(JSON.stringify(detail)).not.toMatch(/private|secret|15:30|Monday/);
  });

  it("distinguishes two assignments of the same event type by their captured people", () => {
    const first = approvalNotificationDetail(
      "studentWorkflow.assign",
      payload,
      targets,
      "pending",
    );
    const second = approvalNotificationDetail(
      "studentWorkflow.assign",
      payload,
      {
        ...targets,
        StudentSurvey: [
          { record: { id: "survey", payload: { englishName: "Grace Wu" } } },
        ],
      },
      "pending",
    );
    expect(first.en).not.toBe(second.en);
    expect(second.en).toContain("Grace Wu");
    expect(second.zh).toContain("Grace Wu");
  });

  it.each(["approved", "rejected"] as const)(
    "describes the %s assignment decision using original evidence",
    (outcome) => {
      const detail = approvalNotificationDetail(
        "studentWorkflow.assign",
        payload,
        targets,
        outcome,
      );
      expect(detail.en).toContain(
        outcome === "approved" ? "Approved assignment" : "Declined assignment",
      );
      expect(detail.en).toContain("Emma Chen → Tutor Alice Lin");
    },
  );

  it("matches IDs within their captured tables and does not invent absent identities", () => {
    const detail = approvalNotificationDetail(
      "studentWorkflow.assign",
      { ...payload, tutorId: "missing" },
      targets,
      "pending",
    );
    expect(detail.en).toContain("Tutor (name not recorded)");
    expect(detail.en).not.toContain("Alice Lin");
    expect(detail.en).not.toContain("missing");
    expect(detail.en).not.toContain("undefined");
  });

  it("describes multi-subject legacy signup assignments", () => {
    const detail = approvalNotificationDetail(
      "admin.assignSignup",
      {
        tuteeId: "student",
        assignments: [
          { tutorId: "tutor", subject: "Physics" },
          { tutorId: "tutor", subject: "Chemistry" },
        ],
      },
      { ...targets, Tutee: [{ record: { id: "student", name: "Grace Wu" } }] },
      "pending",
    );
    expect(detail.en).toContain("Grace Wu → Tutor Alice Lin (Physics)");
    expect(detail.en).toContain("Grace Wu → Tutor Alice Lin (Chemistry)");
  });

  it("identifies the translated operation, captured person and changed fields without copying secret values", () => {
    const detail = approvalNotificationDetail(
      "admin.updateAccountProfile",
      {
        id: "user",
        name: "New Name",
        email: "secret@example.test",
        note: "Private note",
      },
      {
        User: [
          {
            record: {
              id: "user",
              name: "Original Name",
              email: "old@example.test",
            },
          },
        ],
      },
      "pending",
    );
    expect(detail.en).toContain("Original Name");
    expect(detail.zh).toContain("Original Name");
    expect(detail.en).toContain("Name");
    expect(JSON.stringify(detail)).not.toMatch(
      /secret@example|old@example|Private note/,
    );
  });

  it("does not copy private message titles or bodies into management details", () => {
    const detail = approvalNotificationDetail(
      "messaging.moderate",
      { id: "message", note: "Private note" },
      {
        DirectMessage: [
          {
            record: {
              id: "message",
              title: "Private title",
              body: "Private body",
            },
          },
        ],
      },
      "approved",
    );
    expect(JSON.stringify(detail)).not.toContain("Private");
  });

  it("keeps management identities out of optional email even when the caller passes the full in-app context", () => {
    const detail = approvalNotificationDetail(
      "studentWorkflow.assign",
      payload,
      targets,
      "pending",
    );
    const notice = notificationInAppEvent(
      "management_review_pending",
      {},
      detail,
    );
    expect(notice.context).toHaveProperty("inAppDetail");
    expect(
      JSON.stringify(notificationEmailCopy(notice.event, notice.context)),
    ).not.toMatch(/Emma|Alice|Mathematics/);
  });
});
