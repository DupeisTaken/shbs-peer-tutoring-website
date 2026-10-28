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
  ["/admin/pairings#opaque-room-pairing_123", true],
  ["/admin/pairings", false],
  ["/admin/pairings#", false],
  ["/admin/pairings#bad%2Ftarget", false],
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

it("preserves router history state when a same-page shortage link changes its target", () => {
  const routerState = { __NA: true, retained: ["pairings"] };
  window.history.replaceState(routerState, "", "/admin/pairings#old");
  const event = { preventDefault: vi.fn() },
    reveal = vi.fn();
  window.addEventListener("hashchange", reveal);
  navigateNotificationFragment("/admin/pairings#shortage-123", event);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(window.history.state).toEqual(routerState);
  expect(window.location.hash).toBe("#shortage-123");
  expect(reveal).toHaveBeenCalledOnce();
  window.removeEventListener("hashchange", reveal);
});

it.each(["/dashboard", "/student"])(
  "delegates same-page school-calendar navigation on %s to its authorized date reader",
  (route) => {
    const routerState = { __NA: true, retainedRouterTree: [route] };
    window.history.replaceState(routerState, "", `${route}#previous-section`);
    const push = vi.spyOn(window.history, "pushState");
    const reveal = vi.fn<(event: HashChangeEvent) => void>();
    const event = { preventDefault: vi.fn() };
    window.addEventListener("hashchange", reveal);
    navigateNotificationFragment(`${route}#school-calendar/2026-12-01`, event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledExactlyOnceWith(
      routerState,
      "",
      window.location.href,
    );
    expect(reveal).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe("#school-calendar/2026-12-01");
    expect(window.history.state).toEqual(routerState);
    window.removeEventListener("hashchange", reveal);
  },
);

it.each([
  ["/dashboard#school-calendar/2026-12-01", true],
  ["/student#school-calendar/2028-02-29", true],
  ["/student#school-calendar/2026-02-29", false],
  ["/student#school-calendar/2026-13-01", false],
  ["/student#school-calendar/2026-12-01/extra", false],
  ["/student#school-calendar/2026%2D12%2D01", false],
  ["/student?view=schedule#school-calendar/2026-12-01", false],
  ["https://outside.example/student#school-calendar/2026-12-01", false],
  ["/other#school-calendar/2026-12-01", false],
] as const)(
  "validates the managed school-calendar destination %s",
  (href, expected) => {
    expect(isNotificationRecordDestination(href)).toBe(expected);
  },
);

it("identifies an intentional repeated calendar notification through equal old and new URLs", () => {
  window.history.replaceState(
    null,
    "",
    "/dashboard#school-calendar/2026-12-01",
  );
  const reveal = vi.fn<(event: HashChangeEvent) => void>();
  const push = vi.spyOn(window.history, "pushState");
  window.addEventListener("hashchange", reveal);
  navigateNotificationFragment("/dashboard#school-calendar/2026-12-01", {
    preventDefault: vi.fn(),
  });
  expect(reveal).toHaveBeenCalledOnce();
  expect(reveal.mock.calls[0]?.[0].oldURL).toBe(window.location.href);
  expect(reveal.mock.calls[0]?.[0].newURL).toBe(window.location.href);
  expect(push).not.toHaveBeenCalled();
  window.removeEventListener("hashchange", reveal);
});
