import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issue: vi.fn(),
  available: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "192.0.2.1" }),
}));
vi.mock("~/server/auth/password-reset", () => ({
  issuePasswordReset: mocks.issue,
}));
vi.mock("~/server/email/sender", () => ({
  isEmailDeliveryAvailable: mocks.available,
}));
vi.mock("~/server/rate-limit", () => ({ rateLimit: mocks.limit }));

import { forgotPasswordAction } from "./actions";

beforeEach(() => {
  mocks.issue.mockReset().mockResolvedValue(undefined);
  mocks.available.mockReset().mockReturnValue(true);
  mocks.limit.mockReset().mockReturnValue({ ok: true });
});

function request(identifier = "person@example.test") {
  const form = new FormData();
  form.set("identifier", identifier);
  return forgotPasswordAction(undefined, form);
}

it("returns the generic recovery receipt after an accepted request", async () => {
  await expect(request()).resolves.toEqual({ sent: true });
  expect(mocks.issue).toHaveBeenCalledWith("person@example.test");
});

it("keeps transient delivery failure inside the generic recovery result", async () => {
  // The sender throws this sanitized failure after configured SMTP rejects or
  // times out. Recovery must not send only matched accounts to an error boundary.
  mocks.issue.mockRejectedValueOnce(
    new Error("Email delivery failed. Please try again later."),
  );
  await expect(request()).resolves.toEqual({ sent: true });
});

it("does not expose or log issuer details when containing an unexpected failure", async () => {
  const errorLog = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const warningLog = vi
    .spyOn(console, "warn")
    .mockImplementation(() => undefined);
  try {
    mocks.issue.mockRejectedValueOnce(
      new Error("person@example.test synthetic-token synthetic-provider-secret"),
    );
    await expect(request()).resolves.toEqual({ sent: true });
    expect(errorLog).not.toHaveBeenCalled();
    expect(warningLog).not.toHaveBeenCalled();
  } finally {
    errorLog.mockRestore();
    warningLog.mockRestore();
  }
});

it("explains globally unavailable delivery without issuing a token", async () => {
  mocks.available.mockReturnValue(false);
  await expect(request()).resolves.toEqual({ sent: false, unavailable: true });
  expect(mocks.issue).not.toHaveBeenCalled();
});

it("retains the generic response when recovery admission is throttled", async () => {
  mocks.limit.mockReturnValue({ ok: false });
  await expect(request()).resolves.toEqual({ sent: true });
  expect(mocks.issue).not.toHaveBeenCalled();
});
