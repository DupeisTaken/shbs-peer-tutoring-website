import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type * as RecipientModule from "./school-hours-recipient";
import type * as PublicModule from "./school-hours-public";
import type { SchoolHoursPublicReport } from "./school-hours-email";

const fixture = vi.hoisted(() => ({
  db: { syntheticRecipientRoute: true },
  state: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  html: vi.fn(),
  panel: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("./db", () => ({ db: fixture.db }));
vi.mock("./school-hours-recipient", async (original) => ({
  ...(await original<typeof RecipientModule>()),
  getSchoolHoursRecipientState: fixture.state,
  scheduleSchoolHoursRecipientReminder: fixture.schedule,
  cancelSchoolHoursRecipientReminder: fixture.cancel,
}));
vi.mock("./rate-limit", () => ({ rateLimit: fixture.rate }));
vi.mock("./school-hours-reminder-panel", () => ({
  schoolHoursReminderPanel: (...args: unknown[]) => {
    fixture.panel(...args);
    return "<section>synthetic-recipient-panel</section>";
  },
}));
vi.mock("./school-hours-public", async (original) => {
  const actual = await original<typeof PublicModule>();
  return {
    ...actual,
    schoolHoursHtmlResponse: (
      report: SchoolHoursPublicReport,
      token: string,
      options?: { recipientPanel?: string; status?: number },
    ) => {
      fixture.html(report, token, options);
      return new Response(options?.recipientPanel ?? "Synthetic report", {
        status: options?.status ?? 200,
        headers: {
          ...actual.schoolHoursResponseHeaders,
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    },
  };
});

import {
  getSchoolHoursRecipientResponse,
  postSchoolHoursRecipientResponse,
} from "./school-hours-recipient-route";
import {
  SchoolHoursRecipientFault,
  type SchoolHoursRecipientState,
} from "./school-hours-recipient";
import { publicSchoolHoursReport } from "./school-hours-public";
import { schoolHoursTestSnapshot } from "./school-hours-test-fixture";
import { issueSchoolHoursRecipientToken } from "./school-hours-recipient-token";
import { issueSchoolHoursToken } from "./school-hours-link";

const origin = "https://reports.example.test";
const requestId = "c190b686-fd97-46e7-82e5-18739c34c053";
const localTime = "2099-11-12T09:30";
let token: string;
let state: SchoolHoursRecipientState;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_URL", origin);
  vi.stubEnv("AUTH_SECRET", "synthetic-recipient-route-secret");
  token = issueSchoolHoursRecipientToken(
    {
      id: "synthetic-recipient-delivery",
      schoolHoursReportId: "synthetic-recipient-report",
      recipient: "synthetic-office@example.test",
    },
    1,
  );
  state = {
    report: publicSchoolHoursReport(schoolHoursTestSnapshot()),
    mailbox: "s•••@example.test",
    eligible: true,
    reminders: [],
  };
  fixture.state.mockResolvedValue(state);
  fixture.schedule.mockResolvedValue({
    id: "synthetic-reminder",
    scheduledFor: new Date("2099-11-12T01:30:00Z"),
  });
  fixture.cancel.mockResolvedValue({ count: 1 });
  fixture.rate.mockReturnValue({ ok: true, remaining: 19, retryAfterMs: 0 });
});
afterEach(() => vi.unstubAllEnvs());

function fields(operation = "schedule") {
  return { operation, requestId, localTime };
}
function post(
  body: Record<string, string> | string = fields(),
  options: { headers?: HeadersInit; url?: string } = {},
) {
  const headers = new Headers({
    Origin: origin,
    "Content-Type": "application/x-www-form-urlencoded",
  });
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  return new Request(
    options.url ?? `${origin}/reports/service-hours/${token}`,
    {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : new URLSearchParams(body),
    },
  );
}
function expectNoWrite() {
  expect(fixture.schedule).not.toHaveBeenCalled();
  expect(fixture.cancel).not.toHaveBeenCalled();
}

it.each([
  "https://attacker.example.test",
  "https://reports.example.test.attacker.test",
  "http://reports.example.test",
  "https://reports.example.test:8443",
  `${origin}/`,
  "null",
  "",
])("requires the exact configured Origin: %s", async (value) => {
  const response = await postSchoolHoursRecipientResponse(
    post(fields(), { headers: { Origin: value } }),
    token,
  );
  expect(response.status).toBe(403);
  expectNoWrite();
  expect(fixture.state).not.toHaveBeenCalled();
});

it("rejects a missing Origin even when request Host matches the configuration", async () => {
  const request = post();
  request.headers.delete("Origin");
  expect((await postSchoolHoursRecipientResponse(request, token)).status).toBe(
    403,
  );
  expectNoWrite();
});

it.each(["application/json", "multipart/form-data", "text/plain"])(
  "rejects unsupported body content type %s",
  async (contentType) => {
    expect(
      (
        await postSchoolHoursRecipientResponse(
          post(fields(), { headers: { "Content-Type": contentType } }),
          token,
        )
      ).status,
    ).toBe(415);
    expectNoWrite();
    expect(fixture.state).not.toHaveBeenCalled();
  },
);

it("rejects a missing content type without resolving or changing recipient state", async () => {
  const request = post();
  request.headers.delete("Content-Type");
  expect((await postSchoolHoursRecipientResponse(request, token)).status).toBe(
    415,
  );
  expect(fixture.state).not.toHaveBeenCalled();
  expectNoWrite();
});

it("bounds Content-Length before reading or resolving the recipient", async () => {
  const request = post(fields(), { headers: { "Content-Length": "2049" } });
  const read = vi.spyOn(request.body!, "getReader");
  expect((await postSchoolHoursRecipientResponse(request, token)).status).toBe(
    400,
  );
  expect(read).not.toHaveBeenCalled();
  expect(fixture.state).not.toHaveBeenCalled();
  expectNoWrite();
});

it.each([undefined, "1"])(
  "bounds actual streamed bytes with Content-Length %s",
  async (contentLength) => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("operation=schedule&"));
        // Multibyte input verifies a byte limit rather than a character limit.
        controller.enqueue(new TextEncoder().encode("界".repeat(700)));
      },
      cancel: cancelled,
    });
    const headers = new Headers({
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    });
    if (contentLength) headers.set("Content-Length", contentLength);
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers,
      body: stream,
      duplex: "half",
    };
    const response = await postSchoolHoursRecipientResponse(
      new Request(`${origin}/reports/service-hours/${token}`, init),
      token,
    );
    expect(response.status).toBe(400);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(fixture.state).not.toHaveBeenCalled();
    expectNoWrite();
  },
);

const invalidForms: Record<string, string>[] = [
  { ...fields(), email: "different@example.test" },
  { ...fields(), recipient: "different@example.test" },
  { ...fields(), reportId: "different-report" },
  { ...fields(), token: "different-token" },
  { operation: "send-now", requestId, localTime },
  { operation: "schedule", requestId: "not-a-uuid", localTime },
  { operation: "schedule", requestId, localTime: "not-a-date" },
  {
    operation: "cancel",
    reminderId: "synthetic-reminder",
    recipient: "different@example.test",
  },
];
it.each(invalidForms)(
  "rejects unknown fields, destination overrides and malformed operations %#",
  async (body) => {
    expect(
      (await postSchoolHoursRecipientResponse(post(body), token)).status,
    ).toBe(400);
    expect(fixture.state).not.toHaveBeenCalled();
    expectNoWrite();
  },
);

it.each(["operation", "requestId", "localTime"])(
  "rejects duplicate form field %s",
  async (key) => {
    const body = new URLSearchParams(fields());
    body.append(key, body.get(key)!);
    expect(
      (await postSchoolHoursRecipientResponse(post(body.toString()), token))
        .status,
    ).toBe(400);
    expect(fixture.state).not.toHaveBeenCalled();
    expectNoWrite();
  },
);

it("rejects malformed and legacy report-only tokens before service access", async () => {
  for (const invalid of [
    "invalid",
    "x".repeat(321),
    issueSchoolHoursToken("synthetic-recipient-report", 1),
  ]) {
    expect(
      (await postSchoolHoursRecipientResponse(post(), invalid)).status,
    ).toBe(404);
  }
  expect(fixture.state).not.toHaveBeenCalled();
  expectNoWrite();
});

it("GET records only a link request and ignores mutation-like query parameters", async () => {
  const response = await getSchoolHoursRecipientResponse(
    new Request(
      `${origin}/reports/service-hours/${token}?operation=schedule&email=other@example.test`,
    ),
    token,
  );
  expect(response.status).toBe(200);
  expect(fixture.state).toHaveBeenCalledExactlyOnceWith(
    fixture.db,
    token,
    true,
  );
  expectNoWrite();
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});

it.each([
  ["purpose", "prefetch"],
  ["sec-purpose", "prefetch;prerender"],
])(
  "prefetch reads neither record opens nor schedule reminders: %s",
  async (name, value) => {
    const response = await getSchoolHoursRecipientResponse(
      new Request(`${origin}/reports/service-hours/${token}`, {
        headers: { [name]: value },
      }),
      token,
    );
    expect(response.status).toBe(200);
    expect(fixture.state).toHaveBeenCalledExactlyOnceWith(
      fixture.db,
      token,
      false,
    );
    expectNoWrite();
  },
);

it("HEAD does not record an open, schedule mail or return an HTML body", async () => {
  const response = await getSchoolHoursRecipientResponse(
    new Request(`${origin}/reports/service-hours/${token}`, { method: "HEAD" }),
    token,
    true,
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("");
  expect(fixture.state).toHaveBeenCalledExactlyOnceWith(
    fixture.db,
    token,
    false,
  );
  expectNoWrite();
});

it("HEAD also strips bodies from early invalid-token and rate-limit responses", async () => {
  const request = () =>
    new Request(`${origin}/reports/service-hours/${token}`, { method: "HEAD" });
  const invalid = await getSchoolHoursRecipientResponse(
    request(),
    "invalid",
    true,
  );
  expect(invalid.status).toBe(404);
  expect(await invalid.text()).toBe("");
  fixture.rate.mockReturnValue({
    ok: false,
    remaining: 0,
    retryAfterMs: 60000,
  });
  const limited = await getSchoolHoursRecipientResponse(request(), token, true);
  expect(limited.status).toBe(429);
  expect(await limited.text()).toBe("");
  expect(limited.headers.get("retry-after")).toBe("60");
  expect(fixture.state).not.toHaveBeenCalled();
  expectNoWrite();
});

it("HEAD strips a safe service-failure response without recording an open", async () => {
  fixture.state.mockRejectedValue(
    new Error("synthetic-private-storage-detail"),
  );
  const response = await getSchoolHoursRecipientResponse(
    new Request(`${origin}/reports/service-hours/${token}`, { method: "HEAD" }),
    token,
    true,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).toBe("");
  expect(fixture.state).toHaveBeenCalledExactlyOnceWith(
    fixture.db,
    token,
    false,
  );
  expectNoWrite();
});

it("a denied write rate limit returns a retryable response without touching recipient state", async () => {
  fixture.rate.mockReturnValue({
    ok: false,
    remaining: 0,
    retryAfterMs: 60000,
  });
  const response = await postSchoolHoursRecipientResponse(post(), token);
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(fixture.state).not.toHaveBeenCalled();
  expectNoWrite();
});

it("review resolves the timezone and shows confirmation without creating mail or recording an open", async () => {
  const response = await postSchoolHoursRecipientResponse(
    post(fields("review")),
    token,
  );
  expect(response.status).toBe(200);
  expect(fixture.state).toHaveBeenCalledExactlyOnceWith(fixture.db, token);
  expect(fixture.panel).toHaveBeenCalledWith(state, token, {
    review: {
      requestId,
      localTime,
      scheduledFor: new Date("2099-11-12T01:30:00Z"),
    },
  });
  expectNoWrite();
});

it("only confirmed scheduling passes the token and the exact retained intent to the service", async () => {
  const response = await postSchoolHoursRecipientResponse(
    post(fields(), {
      url: "https://untrusted-request-host.example.test/reports/service-hours/anything",
    }),
    token,
  );
  expect(fixture.schedule).toHaveBeenCalledExactlyOnceWith(fixture.db, token, {
    requestId,
    localTime,
  });
  expect(fixture.cancel).not.toHaveBeenCalled();
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    `${origin}/reports/service-hours/${encodeURIComponent(token)}#reminder`,
  );
  expect(await response.text()).toBe("");
});

it("cancellation delegates only the validated token and selected reminder id", async () => {
  const reminderId = "synthetic-reminder";
  const response = await postSchoolHoursRecipientResponse(
    post({ operation: "cancel", reminderId }),
    token,
  );
  expect(response.status).toBe(303);
  expect(fixture.cancel).toHaveBeenCalledExactlyOnceWith(
    fixture.db,
    token,
    reminderId,
  );
  expect(fixture.schedule).not.toHaveBeenCalled();
  expect(response.headers.get("location")).toBe(
    `${origin}/reports/service-hours/${encodeURIComponent(token)}#reminder`,
  );
});

it.each(["unavailable", "retired"] as const)(
  "refuses %s capabilities without reflecting private service errors",
  async (code) => {
    const error = new SchoolHoursRecipientFault(code);
    error.message = "synthetic-private@example.test secret-database-detail";
    fixture.state.mockRejectedValue(error);
    const response = await postSchoolHoursRecipientResponse(post(), token);
    expect(response.status).toBe(code === "retired" ? 410 : 404);
    const html = await response.text();
    expect(html).not.toContain("synthetic-private@example.test");
    expect(html).not.toContain("secret-database-detail");
    expect(html).not.toContain(token);
    expectNoWrite();
  },
);

it("retains date and request identity after an uncertain write without exposing its private error", async () => {
  fixture.schedule.mockRejectedValue(
    new Error("synthetic-private@example.test secret-provider-detail"),
  );
  const response = await postSchoolHoursRecipientResponse(post(), token);
  expect(response.status).toBe(503);
  expect(fixture.panel).toHaveBeenCalledWith(state, token, {
    error: "writeFailed",
    draft: { requestId, localTime },
  });
  expect(fixture.schedule).toHaveBeenCalledOnce();
  const html = await response.text();
  expect(html).not.toContain("synthetic-private@example.test");
  expect(html).not.toContain("secret-provider-detail");
  expect(response.headers.get("location")).toBeNull();
});

it("preserves a rejected review draft and never schedules it", async () => {
  const invalid = "2099-02-30T09:30";
  const response = await postSchoolHoursRecipientResponse(
    post({ ...fields("review"), localTime: invalid }),
    token,
  );
  expect(response.status).toBe(400);
  expect(fixture.panel).toHaveBeenCalledWith(state, token, {
    error: "invalidTime",
    draft: { requestId, localTime: invalid },
  });
  expectNoWrite();
});

it("refuses an ineligible reminder review while keeping report reading available", async () => {
  state.eligible = false;
  const response = await postSchoolHoursRecipientResponse(
    post(fields("review")),
    token,
  );
  expect(response.status).toBe(400);
  expect(fixture.panel).toHaveBeenCalledWith(state, token, {
    error: "recipientRemoved",
    draft: { requestId, localTime },
  });
  expectNoWrite();
});
