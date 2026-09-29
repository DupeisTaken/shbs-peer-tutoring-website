import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const smtp = vi.hoisted(() => {
  const env: Record<string, string | number | undefined> = {};
  return {
    env,
    send: vi.fn(),
    verify: vi.fn(),
    create: vi.fn(),
    close: vi.fn(),
  };
});
vi.mock("~/env", () => ({ env: smtp.env }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: unknown) => {
      smtp.create(options);
      return { sendMail: smtp.send, verify: smtp.verify, close: smtp.close };
    },
  },
}));
import {
  emailSender,
  isEmailConfigured,
  isEmailDeliveryAvailable,
  verifyEmailTransport,
  type EmailCategory,
} from "./sender";

const message = (category: EmailCategory) => ({
  category,
  to: "recipient@example.test",
  subject: "Same subject",
  text: "Same text",
});
function legacy() {
  Object.assign(smtp.env, {
    EMAIL_FROM: "legacy@example.test",
    SMTP_PASSWORD: "legacy-test-secret",
  });
}
function dedicated(category: EmailCategory) {
  smtp.env[`EMAIL_${category}_FROM`] = `${category.toLowerCase()}@example.test`;
  smtp.env[`SMTP_${category}_PASSWORD`] = `${category}-test-secret`;
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(smtp.env)) delete smtp.env[key];
  Object.assign(smtp.env, {
    NODE_ENV: "production",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: 465,
  });
  delete (globalThis as { mailTransports?: unknown }).mailTransports;
  smtp.send.mockResolvedValue({
    accepted: ["recipient@example.test"],
    rejected: [],
  });
  smtp.verify.mockResolvedValue(true);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("purpose-based sender routing", () => {
  it("uses independently authenticated accounts and pools regardless of identical subjects", async () => {
    legacy();
    dedicated("SECURITY");
    dedicated("PROGRAM");
    smtp.env.SMTP_SECURITY_USER = "security-login";
    for (const category of ["SECURITY", "PROGRAM", "SECURITY"] as const)
      await emailSender.send(message(category));
    expect(smtp.create).toHaveBeenCalledTimes(2);
    expect(smtp.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        auth: { user: "security-login", pass: "SECURITY-test-secret" },
        pool: true,
        secure: true,
      }),
    );
    expect(smtp.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        auth: { user: "program@example.test", pass: "PROGRAM-test-secret" },
      }),
    );
    expect(smtp.send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        from: expect.objectContaining({
          address: "security@example.test",
        }) as unknown,
      }),
    );
    expect(smtp.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        from: expect.objectContaining({
          address: "program@example.test",
        }) as unknown,
      }),
    );
  });
  it("preserves a single legacy account and shared pool", async () => {
    legacy();
    smtp.env.SMTP_USER = "legacy-login";
    await emailSender.send(message("SECURITY"));
    await emailSender.send(message("PROGRAM"));
    expect(smtp.create).toHaveBeenCalledTimes(1);
    expect(smtp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: "legacy-login", pass: "legacy-test-secret" },
      }),
    );
    expect(smtp.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: expect.objectContaining({
          address: "legacy@example.test",
        }) as unknown,
      }),
    );
  });
  it.each(["EMAIL_PROGRAM_FROM", "SMTP_PROGRAM_PASSWORD"])(
    "falls back as a whole account when dedicated %s is missing",
    async (missing) => {
      legacy();
      dedicated("SECURITY");
      dedicated("PROGRAM");
      delete smtp.env[missing];
      await emailSender.send(message("SECURITY"));
      await emailSender.send(message("PROGRAM"));
      expect(smtp.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          auth: { user: "legacy@example.test", pass: "legacy-test-secret" },
        }),
      );
      expect(smtp.send).toHaveBeenLastCalledWith(
        expect.objectContaining({
          from: expect.objectContaining({
            address: "legacy@example.test",
          }) as unknown,
        }),
      );
    },
  );
  it.each(["SECURITY", "PROGRAM"] as const)(
    "checks %s availability independently without legacy credentials",
    async (configured) => {
      dedicated(configured);
      const missing = configured === "SECURITY" ? "PROGRAM" : "SECURITY";
      expect(isEmailConfigured(configured)).toBe(true);
      expect(isEmailDeliveryAvailable(configured)).toBe(true);
      expect(isEmailConfigured(missing)).toBe(false);
      expect(isEmailDeliveryAvailable(missing)).toBe(false);
      await expect(emailSender.send(message(missing))).rejects.toThrow(
        "Email delivery is unavailable",
      );
      expect(smtp.send).not.toHaveBeenCalled();
    },
  );
  it("never treats an incomplete dedicated sender plus legacy password as an account", () => {
    smtp.env.EMAIL_SECURITY_FROM = "security@example.test";
    smtp.env.SMTP_PASSWORD = "legacy-test-secret";
    expect(isEmailDeliveryAvailable("SECURITY")).toBe(false);
  });
  it("keeps unconfigured local development email visible", async () => {
    smtp.env.NODE_ENV = "development";
    expect(isEmailDeliveryAvailable("SECURITY")).toBe(true);
    expect(isEmailConfigured("SECURITY")).toBe(false);
    await emailSender.send(message("SECURITY"));
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining("Same text"),
    );
    expect(smtp.create).not.toHaveBeenCalled();
  });
  it("retains STARTTLS enforcement and bounded independent signup delivery", async () => {
    dedicated("SECURITY");
    smtp.env.SMTP_PORT = 587;
    await emailSender.send({ ...message("SECURITY"), signup: true });
    expect(smtp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: false,
        requireTLS: true,
        auth: { user: "security@example.test", pass: "SECURITY-test-secret" },
      }),
    );
    expect(smtp.create.mock.calls[0]![0]).not.toHaveProperty("pool");
    expect(smtp.close).toHaveBeenCalled();
  });
  it.each(["SECURITY", "PROGRAM"] as const)(
    "propagates safe %s failures without leaking provider credentials",
    async (category) => {
      dedicated(category);
      smtp.send.mockRejectedValue(
        new Error("provider echoed SMTP_PASSWORD=private-sentinel"),
      );
      await expect(emailSender.send(message(category))).rejects.toThrow(
        "Email delivery failed",
      );
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
        "private-sentinel",
      );
      expect(smtp.create).toHaveBeenCalledTimes(1); // No retry on a different identity after delivery failure.
    },
  );
  it.each([
    { accepted: [], rejected: ["recipient@example.test"] },
    { accepted: [] },
  ])("rejects unaccepted SMTP delivery: %j", async (result) => {
    dedicated("SECURITY");
    smtp.send.mockResolvedValue(result);
    await expect(emailSender.send(message("SECURITY"))).rejects.toThrow(
      "Email delivery failed",
    );
  });
  it("verifies the requested category and sanitizes authentication failures", async () => {
    dedicated("PROGRAM");
    expect(await verifyEmailTransport("SECURITY")).toBe(false);
    expect(smtp.create).not.toHaveBeenCalled();
    expect(await verifyEmailTransport("PROGRAM")).toBe(true);
    smtp.verify.mockRejectedValue(new Error("password=private-sentinel"));
    expect(await verifyEmailTransport("PROGRAM")).toBe(false);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private-sentinel",
    );
  });
});
