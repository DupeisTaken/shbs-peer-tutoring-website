import { describe, expect, it } from "vitest";
import { eligibleReviewRecipient } from "./notification-policy";
import { notificationEmailCopy } from "./notification-copy";

describe("review email eligibility", () => {
  it("rechecks the required live reviewer authority", () => {
    expect(
      eligibleReviewRecipient({ role: "HEAD" }, "crew_application_pending"),
    ).toBe(true);
    expect(
      eligibleReviewRecipient({ role: "ADMIN" }, "crew_application_pending"),
    ).toBe(false);
    expect(
      eligibleReviewRecipient({ role: "ADMIN" }, "management_review_pending"),
    ).toBe(true);
    expect(
      eligibleReviewRecipient(
        { role: "COORDINATOR" },
        "management_review_pending",
      ),
    ).toBe(false);
    expect(
      eligibleReviewRecipient(
        { role: "HEAD", suspendedAt: new Date() },
        "management_review_pending",
      ),
    ).toBe(false);
    expect(
      eligibleReviewRecipient(
        { role: "HEAD", mergedIntoId: "other" },
        "management_review_pending",
      ),
    ).toBe(false);
    expect(
      eligibleReviewRecipient({ role: "HEAD" }, "management_approved"),
    ).toBe(false);
  });
});

it("renders approved bilingual facts, without copying arbitrary message/profile fields", () => {
  const copy = notificationEmailCopy("student_assignment_updated", {
    emailDetail: {
      en: "Morgan is assigned to Alex for Mathematics.",
      zh: "Morgan 已分配给 Alex 辅导数学。",
    },
    body: "Private body sentinel",
    reason: "Private reason sentinel",
    email: "private@example.test",
  });
  expect(copy.description).toContain(
    "Morgan is assigned to Alex for Mathematics.",
  );
  expect(copy.description).toContain("Morgan 已分配给 Alex 辅导数学。");
  expect(JSON.stringify(copy)).not.toMatch(/sentinel|private@example/);
});

it.each([
  "security_changed",
  "information_changed",
  "program_update",
  "unknown_event",
])("does not accept factual-detail overrides for %s", (event) => {
  expect(
    JSON.stringify(
      notificationEmailCopy(event, {
        emailDetail: { en: "private sentinel", zh: "private sentinel" },
      }),
    ),
  ).not.toContain("sentinel");
});

it.each([
  { en: "only one language" },
  { en: " ", zh: "empty" },
  { en: "x".repeat(1001), zh: "too long" },
  { en: { name: "private sentinel" }, zh: "private sentinel" },
])("falls back safely for malformed email detail", (emailDetail) => {
  const copy = notificationEmailCopy("student_assignment_updated", {
    emailDetail,
  });
  expect(copy.description).toContain("A tutoring assignment was updated.");
  expect(copy.description).not.toContain("sentinel");
});
