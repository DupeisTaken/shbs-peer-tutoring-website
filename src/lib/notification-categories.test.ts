import { expect, it } from "vitest";
import { notificationEvents } from "./notification-events";
import {
  effectiveNotificationPreference,
  notificationCategory,
  notificationEventCategories,
} from "./notification-categories";

it("covers every maintained event and keeps unknown legacy notices visible", () => {
  expect(Object.keys(notificationEventCategories).sort()).toEqual(
    [...notificationEvents].sort(),
  );
  expect(notificationCategory(null, undefined, "/messages")).toBe("messages");
  expect(notificationCategory("future_event")).toBe("program");
});
it("distinguishes reviewers from participants without changing the event's domain", () => {
  expect(
    notificationCategory("student_withdrawal_pending", { role: "ADMIN" }),
  ).toBe("reviews");
  expect(
    notificationCategory("student_withdrawal_pending", { role: "STUDENT" }),
  ).toBe("tutoring");
  expect(
    notificationCategory("crew_application_pending", { role: "ADMIN" }),
  ).toBe("reviews");
  expect(notificationCategory("crew_application_pending", { role: "STUDENT" })).toBe("applications");
  expect(notificationCategory("management_head_review_pending", { role: "ADMIN" })).toBe("management");
  expect(
    notificationCategory("crew_application_pending", { role: "HEAD" }),
  ).toBe("reviews");
  expect(
    notificationCategory("management_review_pending", {
      role: "HEAD",
      suspendedAt: new Date(),
    }),
  ).toBe("management");
});
it("inherits broad email choices until an explicit category override exists", () => {
  expect(
    effectiveNotificationPreference({ emailInfo: true }, "tutoring"),
  ).toEqual({ category: "tutoring", badgeEnabled: true, emailEnabled: true });
  expect(
    effectiveNotificationPreference({ emailInfo: true }, "tutoring", [
      { category: "tutoring", badgeEnabled: false, emailEnabled: false },
    ]),
  ).toEqual({ category: "tutoring", badgeEnabled: false, emailEnabled: false });
  expect(
    effectiveNotificationPreference({ emailInfo: true }, "reviews")
      .emailEnabled,
  ).toBe(false);
});
