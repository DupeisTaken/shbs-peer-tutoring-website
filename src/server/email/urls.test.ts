import { afterEach, expect, it, vi } from "vitest";
import { emailOrigin, emailUrl, notificationDestination } from "./urls";
import { returnDestination } from "~/lib/return-destination";
afterEach(() => vi.unstubAllEnvs());

it.each([
  "/messages",
  "/admin/approvals?request=synthetic#details",
  "/student?view=messages",
])("round-trips destination %s through sign-in", (path) => {
  vi.stubEnv("AUTH_URL", "https://school.example///");
  const url = new URL(emailUrl(path));
  expect(url.origin).toBe("https://school.example");
  expect(url.pathname).toBe("/signin");
  expect(returnDestination(url.searchParams.get("callbackUrl"))).toBe(path);
});

it.each([
  undefined,
  "",
  "http://school.example",
  "https://localhost",
  "https://127.0.0.1",
  "https://school.example/path",
  "https://user:pass@school.example",
  "javascript:alert(1)",
  "https://school.example?bad=1",
])("fails closed for bad production origin %s", (value) => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_URL", value);
  expect(emailOrigin).toThrow();
});

it("allows a development-only localhost fallback", () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_URL", undefined);
  expect(emailOrigin()).toBe("http://localhost:3000");
});

it.each([
  "https://evil.example",
  "//evil.example",
  "/a/..//evil.example",
  "/a/%2e%2e//evil.example",
  "https://school.example/a/..//evil.example",
  "/\\evil.example",
  "/%2fevil.example",
  "/messages\n",
  "/api/auth/signout",
  "/signin?callbackUrl=/signin",
  "javascript:alert(1)",
])("rejects unsafe return %s", (value) => {
  expect(returnDestination(value, "https://school.example")).toBe("/");
});

it("accepts only the configured origin for Auth.js absolute callbacks", () => {
  expect(
    returnDestination(
      "https://school.example/messages?view=all#latest",
      "https://school.example",
    ),
  ).toBe("/messages?view=all#latest");
  expect(
    returnDestination(
      "https://school.example.evil.example/messages",
      "https://school.example",
    ),
  ).toBe("/");
});

it("uses event-specific fallbacks and avoids staff links after a role downgrade", () => {
  expect(
    notificationDestination(
      "info",
      "program_update",
      "/admin/approvals?request=one",
      "ADMIN",
    ),
  ).toBe("/admin/approvals?request=one");
  expect(
    notificationDestination(
      "info",
      "program_update",
      "/admin/approvals",
      "VIEWER",
    ),
  ).toBe("/");
  expect(notificationDestination("info", "program_update", null, "ADMIN")).toBe(
    "/",
  );
  expect(
    notificationDestination("info", "information_changed", null, "STUDENT"),
  ).toBe("/my-account");
  expect(
    notificationDestination("security", "security_changed", null, "ADMIN"),
  ).toBe("/my-account");
  expect(
    notificationDestination("messages", "message_received", null, "STUDENT"),
  ).toBe("/messages");
});
