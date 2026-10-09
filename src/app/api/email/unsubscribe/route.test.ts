import { afterEach, beforeEach, expect, it, vi } from "vitest";
const service = vi.hoisted(() => ({ status: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("~/server/email/unsubscribe", () => ({
  getUnsubscribeStatus: service.status,
  unsubscribeFromEmail: service.unsubscribe,
}));
import { GET, POST } from "./route";

const origin = "https://school.example.test";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_URL", origin);
  service.status.mockResolvedValue({ status: "ready", category: "messages" });
  service.unsubscribe.mockResolvedValue({
    status: "unsubscribed",
    category: "messages",
  });
});
afterEach(() => vi.unstubAllEnvs());
const post = (
  body: unknown = { token: "synthetic-token", scope: "category" },
  headers: HeadersInit = {},
) =>
  new Request(`${origin}/api/email/unsubscribe`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

it("GET returns no identity and never invokes a mutation", async () => {
  const response = await GET(
    new Request(`${origin}/api/email/unsubscribe?token=synthetic-token`),
  );
  expect(await response.json()).toEqual({
    status: "ready",
    category: "messages",
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(service.unsubscribe).not.toHaveBeenCalled();
});

it.each(["category", "all"])(
  "accepts explicit same-origin confirmation for scope %s",
  async (scope) => {
    const response = await POST(post({ token: "synthetic-token", scope }));
    expect(response.status).toBe(200);
    expect(service.unsubscribe).toHaveBeenCalledWith("synthetic-token", scope);
    expect(response.headers.get("cache-control")).toBe("no-store");
  },
);

it.each(["https://evil.example", "null", ""])(
  "rejects untrusted or missing Origin %s",
  async (value) => {
    expect((await POST(post(undefined, { Origin: value }))).status).toBe(403);
    expect(service.unsubscribe).not.toHaveBeenCalled();
  },
);

it.each([
  null,
  [],
  {},
  { token: "x", scope: "security" },
  { token: "x".repeat(513), scope: "all" },
])("rejects invalid input %#", async (body) => {
  expect((await POST(post(body))).status).toBe(400);
  expect(service.unsubscribe).not.toHaveBeenCalled();
});

it("rejects content types, oversized chunked bodies and malformed JSON without mutation", async () => {
  expect(
    (await POST(post(undefined, { "Content-Type": "text/plain" }))).status,
  ).toBe(415);
  expect(
    (await POST(post({ token: "x".repeat(3000), scope: "all" }))).status,
  ).toBe(413);
  const request = new Request(`${origin}/api/email/unsubscribe`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: "{",
  });
  expect((await POST(request)).status).toBe(400);
  expect(service.unsubscribe).not.toHaveBeenCalled();
});

it("returns a safe retryable response when the database or configuration fails", async () => {
  service.status.mockRejectedValue(new Error("secret-address@example.test"));
  service.unsubscribe.mockRejectedValue(new Error("secret-token"));
  for (const response of [
    await GET(
      new Request(`${origin}/api/email/unsubscribe?token=synthetic-token`),
    ),
    await POST(post()),
  ]) {
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  }
});
