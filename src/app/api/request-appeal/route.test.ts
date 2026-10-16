import { afterEach, beforeEach, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  status: vi.fn(),
  submit: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("~/server/email/request-appeal", async () => {
  const { z } = await import("zod");
  return {
    appealBody: z.string().trim().min(10).max(2000),
    requestAppealStatus: service.status,
    submitRequestAppeal: service.submit,
  };
});
vi.mock("~/server/rate-limit", () => ({ rateLimit: service.limit }));
import { requestAppealToken } from "~/server/email/request-appeal-token";
import { GET, POST } from "./route";

const origin = "https://school.example.test";
const body = "Please review this decision with the original evidence.";
let token: string;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_URL", origin);
  vi.stubEnv("AUTH_SECRET", "request-appeal-route-test-secret");
  token = requestAppealToken("synthetic-notice", new Date());
  service.status.mockResolvedValue({
    status: "ready",
    kind: "tutor",
    recordedTime: "2026-09-01T06:17:00.000Z",
    timeZone: "Asia/Shanghai",
    appealStatus: null,
  });
  service.submit.mockResolvedValue({
    status: "submitted",
    appealStatus: "PENDING",
  });
  service.limit.mockReturnValue({ ok: true, retryAfterMs: 0 });
});
afterEach(() => vi.unstubAllEnvs());
const post = (input: unknown = { token, body }, headers: HeadersInit = {}) =>
  new Request(`${origin}/api/request-appeal`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(input),
  });
const get = (value = token) =>
  new Request(
    `${origin}/api/request-appeal?token=${encodeURIComponent(value)}`,
  );

it("mail-scanner GET reads safe status repeatedly without submitting or requiring an account", async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ready",
      kind: "tutor",
      recordedTime: "2026-09-01T06:17:00.000Z",
      timeZone: "Asia/Shanghai",
      appealStatus: null,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  }
  expect(service.status).toHaveBeenCalledTimes(2);
  expect(service.submit).not.toHaveBeenCalled();
});

it("accepts explicit same-origin JSON, trims the appeal and returns immutable-submission outcomes", async () => {
  const response = await POST(
    post(
      { token, body: `  ${body}  ` },
      { "Content-Type": "Application/JSON; charset=utf-8" },
    ),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "submitted",
    appealStatus: "PENDING",
  });
  expect(service.submit).toHaveBeenCalledWith(token, body);
  service.submit.mockResolvedValueOnce({ status: "already-submitted" });
  expect(await (await POST(post())).json()).toEqual({
    status: "already-submitted",
  });
});

it.each(["https://evil.example", `${origin}/path`, "null", ""])(
  "rejects untrusted Origin %s before service/rate-limit access",
  async (value) => {
    const response = await POST(post(undefined, { Origin: value }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ status: "invalid" });
    expect(service.submit).not.toHaveBeenCalled();
    expect(service.limit).not.toHaveBeenCalled();
  },
);

it("rejects an absent Origin and unsupported content types", async () => {
  const missing = post();
  missing.headers.delete("origin");
  expect((await POST(missing)).status).toBe(403);
  expect(
    (await POST(post(undefined, { "Content-Type": "text/plain" }))).status,
  ).toBe(415);
  expect(service.submit).not.toHaveBeenCalled();
});

it.each([
  null,
  [],
  {},
  { token: 7, body },
  { token: "", body },
  { token: "x".repeat(513), body },
  { token: "tampered", body },
  { body },
])(
  "rejects invalid envelopes/capabilities without allocating throttling keys %#",
  async (input) => {
    expect((await POST(post(input))).status).toBe(400);
    expect(service.submit).not.toHaveBeenCalled();
    expect(service.limit).not.toHaveBeenCalled();
  },
);

it.each([undefined, null, 1, "short", " ".repeat(30), "x".repeat(2001)])(
  "rejects invalid appeal text %#",
  async (value) => {
    expect((await POST(post({ token, body: value }))).status).toBe(400);
    expect(service.submit).not.toHaveBeenCalled();
  },
);

it("rejects malformed JSON and advertised oversized bodies before mutation", async () => {
  expect(
    (await POST(post(undefined, { "Content-Length": "12001" }))).status,
  ).toBe(413);
  const malformed = new Request(`${origin}/api/request-appeal`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: "{",
  });
  expect((await POST(malformed)).status).toBe(400);
  expect(service.submit).not.toHaveBeenCalled();
  expect(service.limit).not.toHaveBeenCalled();
});

it("bounds actual streamed UTF-8 bytes independently of Content-Length and cancels an oversized stream", async () => {
  const cancel = vi.fn();
  // No advertised length: a chunked caller cannot bypass the cap. The multibyte
  // content also prevents an accidental character-count limit from passing.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("申".repeat(4001)));
    },
    cancel,
  });
  const request = new Request(`${origin}/api/request-appeal`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Content-Length": "1",
    },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  expect((await POST(request)).status).toBe(413);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(service.submit).not.toHaveBeenCalled();
  expect(service.limit).not.toHaveBeenCalled();
});

it("invalid GET tokens access neither status nor throttling state", async () => {
  for (const value of ["", "x".repeat(513), token.replace("v1.", "v2.")]) {
    const response = await GET(get(value));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "invalid" });
  }
  expect(service.limit).not.toHaveBeenCalled();
  expect(service.status).not.toHaveBeenCalled();
});

it.each(["global", "notice"] as const)(
  "returns distinct 429 Retry-After when %s throttling rejects a valid capability",
  async (scope) => {
    service.limit.mockImplementation((key) =>
      key ===
      (scope === "global"
        ? "request-appeal:global"
        : "request-appeal:synthetic-notice")
        ? { ok: false, retryAfterMs: 1501 }
        : { ok: true, retryAfterMs: 0 },
    );
    for (const response of [await GET(get()), await POST(post())]) {
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("2");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ status: "throttled" });
    }
    expect(service.status).not.toHaveBeenCalled();
    expect(service.submit).not.toHaveBeenCalled();
  },
);

it("returns safe retryable 503 responses for service failures without leaking provider or participant text", async () => {
  service.status.mockRejectedValue(new Error("private-address@example.test"));
  service.submit.mockRejectedValue(new Error("private appeal evidence"));
  for (const response of [await GET(get()), await POST(post())]) {
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});
