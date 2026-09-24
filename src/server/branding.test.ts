import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(async () => undefined),
  sendMail: vi.fn(async () => ({ messageId: "branding-test" })),
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail }) },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // Exercise the actual env schema, including its blank-string handling.
  vi.stubEnv("SKIP_ENV_VALIDATION", "");
  for (const key of [
    "APP_TITLE",
    "TEAM_TITLE",
    "ORG_NAME",
    "SUPPORT_EMAIL",
    "PROGRAM_TERM_LABEL",
    "EMAIL_FROM_NAME",
  ])
    vi.stubEnv(key, "");
  vi.stubEnv("EMAIL_FROM", "sender@example.test");
  vi.stubEnv("SMTP_PASSWORD", "private-smtp-sentinel");
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "Campus Peer Support"])(
  "keeps runtime metadata, server values and email sender consistent: %s",
  async (title) => {
    if (title) vi.stubEnv("APP_TITLE", title);
    const expected = title ?? "SHBS Peer Tutoring";
    const { BRANDING, APP_TITLE } = await import("~/lib/branding");
    const { brandingMetadata } = await import("./branding-metadata");
    expect(APP_TITLE).toBe(expected);
    expect(BRANDING.APP_TITLE).toBe(expected);
    expect(await brandingMetadata()).toEqual({
      title: expected,
      description: `Pairings, attendance, and service-hour tracking for the ${expected} program.`,
    });
    expect(await brandingMetadata("Register")).toEqual({
      title: `Register · ${expected}`,
    });
    expect(mocks.connection).toHaveBeenCalledTimes(2);
    const { emailSender } = await import("./email/sender");
    await emailSender.send({
      to: "recipient@example.test",
      subject: "Test",
      text: "Test",
    });
    expect(mocks.sendMail).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: { name: expected, address: "sender@example.test" },
      }),
    );
    expect(JSON.stringify(BRANDING)).not.toContain("private-smtp-sentinel");
  },
);
it("allows a separate server-only sender display name", async () => {
  vi.stubEnv("APP_TITLE", "Campus Help");
  vi.stubEnv("EMAIL_FROM_NAME", "School Mail Office");
  const { emailSender } = await import("./email/sender");
  await emailSender.send({
    to: "recipient@example.test",
    subject: "Test",
    text: "Test",
  });
  expect(mocks.sendMail).toHaveBeenLastCalledWith(
    expect.objectContaining({
      from: { name: "School Mail Office", address: "sender@example.test" },
    }),
  );
  const { BRANDING } = await import("~/lib/branding");
  expect(BRANDING.APP_TITLE).toBe("Campus Help");
  expect(JSON.stringify(BRANDING)).not.toContain("School Mail Office");
});
