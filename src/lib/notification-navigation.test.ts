// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import {
  isNotificationRecordDestination,
  navigateNotificationFragment,
} from "./notification-navigation";
it.each([
  ["/admin/requests#request-survey-abc_123", true],
  ["/admin/requests#request-signup-abc-123", true],
  ["/admin/applications#application-abc123", true],
  ["/admin/requests", false],
  ["/admin/requests?tab=all#request-survey-abc", false],
  ["/admin/requests#request-survey-", false],
  ["/admin/requests#request-survey-" + "a".repeat(129), false],
  ["/admin/requests#request-survey-abc%2Fdef", false],
  ["https://external.example/admin/requests#request-survey-abc", false],
  ["//external.example/admin/requests#request-survey-abc", false],
])(
  "validates the exact relative managed record destination %s",
  (href, expected) => {
    expect(isNotificationRecordDestination(href)).toBe(expected);
  },
);
it("repeats a same-document fragment through the record adapter without replacing the mounted page", () => {
  window.history.replaceState(null, "", "/admin/applications#application-123");
  const reveal = vi.fn(),
    event = { preventDefault: vi.fn() };
  window.addEventListener("hashchange", reveal);
  navigateNotificationFragment("/admin/applications#application-123", event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(reveal).toHaveBeenCalledOnce();
  expect(window.location.hash).toBe("#application-123");
  window.removeEventListener("hashchange", reveal);
});
it("uses a native changed fragment so existing page adapters receive navigation", () => {
  window.history.replaceState(null, "", "/admin/requests");
  const event = { preventDefault: vi.fn() };
  navigateNotificationFragment("/admin/requests#request-survey-123", event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(window.location.pathname).toBe("/admin/requests");
  expect(window.location.hash).toBe("#request-survey-123");
});
it.each([
  "/admin/applications",
  "/admin/requests#request-signup-123",
  "/admin/applications?verified=1#application-123",
  "https://outside.example/admin/applications#application-123",
])("leaves normal navigation of %s to Next", (href) => {
  window.history.replaceState(null, "", "/admin/applications");
  const event = { preventDefault: vi.fn() };
  navigateNotificationFragment(href, event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("");
});
