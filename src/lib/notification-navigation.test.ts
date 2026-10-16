// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  isNotificationRecordDestination,
  navigateNotificationFragment,
} from "./notification-navigation";
afterEach(() => vi.restoreAllMocks());
it("hands a different managed fragment to its page once while retaining its Back entry and router state", async () => {
  const state = { __NA: true, retainedRouterTree: ["admin", "requests"] };
  window.history.replaceState(state, "", "/admin/requests#request-signup-A");
  const entries = window.history.length;
  const push = vi.spyOn(window.history, "pushState");
  const reveal = vi.fn<(event: HashChangeEvent) => void>();
  window.addEventListener("hashchange", reveal);
  const event = { preventDefault: vi.fn() };
  navigateNotificationFragment("/admin/requests#request-survey-B", event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(window.location.hash).toBe("#request-survey-B");
  expect(window.history.state).toEqual(state);
  expect(window.history.length).toBe(entries + 1);
  expect(push).toHaveBeenCalledExactlyOnceWith(state, "", window.location.href);
  expect(reveal).toHaveBeenCalledOnce();
  const change = reveal.mock.calls[0]?.[0];
  expect(change?.oldURL).toContain("#request-signup-A");
  expect(change?.newURL).toBe(window.location.href);
  window.removeEventListener("hashchange", reveal);
  const back = new Promise<HashChangeEvent>((resolve) => {
    window.addEventListener("hashchange", resolve, { once: true });
  });
  window.history.back();
  const restored = await back;
  expect(window.location.hash).toBe("#request-signup-A");
  expect(window.history.state).toEqual(state);
  expect(restored.newURL).toContain("#request-signup-A");
});
it("keeps ordinary same-page fragment navigation native", () => {
  window.history.replaceState(null, "", "/admin/requests");
  const push = vi.spyOn(window.history, "pushState");
  navigateNotificationFragment("/admin/requests#ordinary-help", {
    preventDefault: vi.fn(),
  });
  expect(window.location.hash).toBe("#ordinary-help");
  expect(push).not.toHaveBeenCalled();
});
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
