import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { EmailMessage } from "~/server/email/sender";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

const mocks = vi.hoisted(() => ({
  session: null as Session | null,
  available: true,
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
}));
vi.mock("~/server/auth", () => ({ auth: async () => mocks.session }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mocks.send }, isEmailConfigured: () => true,
  isEmailDeliveryAvailable: () => mocks.available,
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("~/server/branding-metadata", () => ({ brandingMetadata: vi.fn() }));
vi.mock("./onboarding-form", () => ({ OnboardingForm: () => null }));
vi.mock("~/app/_components/floating-language-switcher", () => ({ FloatingLanguageSwitcher: () => null }));
import { db } from "~/server/db";
import { hashPassword, verifyPassword } from "~/server/auth/password";
import { resetPassword } from "~/server/auth/password-reset";
import { isSessionCurrent } from "~/server/auth/session-version";
import { completeOnboardingAction } from "./actions";
import OnboardingPage from "./page";

let serial = 0;
let id = "";
const password = "OnboardingOldPassword123!";
function assertOnboardingTestDatabase() {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/shbs_shipping_test")
    throw new Error("Use the isolated local shbs_shipping_test database.");
}
beforeEach(async () => {
  assertOnboardingTestDatabase();
  id = `onboarding126-${++serial}`;
  mocks.available = true;
  mocks.send.mockReset().mockResolvedValue(undefined);
  await db.user.create({ data: {
    id, email: `${id}@example.test`, username: id, role: "VIEWER",
    passwordHash: hashPassword(password), twoFactorEnabled: true,
    emailVerifiedAt: null, mustChangePassword: true,
  } });
  mocks.session = { user: { id, email: `${id}@example.test` }, role: "VIEWER", tutorId: null, expires: "2099-01-01" };
});
afterAll(async () => {
  try {
    // Vitest still runs cleanup after a failed beforeEach; guard destructive queries again.
    assertOnboardingTestDatabase();
    await db.user.deleteMany({ where: { id: { startsWith: "onboarding126-" } } });
  } finally {
    await db.$disconnect();
  }
});
function forgedFields() {
  const form = new FormData();
  // Even a configured-but-unused bootstrap alias cannot be claimed by this endpoint.
  form.set("email", "unused-bootstrap-admin@example.test");
  form.set("password", "AttackerPassword123!");
  form.set("confirm", "AttackerPassword123!");
  return form;
}
function emailedToken() {
  const token = /token=([a-f0-9]+)/.exec(mocks.send.mock.calls.at(-1)?.[0].text ?? "")?.[1];
  if (!token) throw new Error("Expected a mailbox-proof link");
  return token;
}

it("cannot change or verify arbitrary credentials through a forged onboarding POST", async () => {
  expect(await completeOnboardingAction(undefined, forgedFields())).toEqual({ sent: true });
  const user = await db.user.findUniqueOrThrow({ where: { id } });
  expect(user).toMatchObject({ email: `${id}@example.test`, emailVerifiedAt: null,
    mustChangePassword: true, twoFactorEnabled: true, role: "VIEWER", sessionVersion: 0 });
  expect(verifyPassword(password, user.passwordHash!)).toBe(true);
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(mocks.send.mock.calls[0]![0].to).toBe(`${id}@example.test`);
  expect(await db.accountEmail.findUnique({ where: { email: "unused-bootstrap-admin@example.test" } })).toBeNull();

  // Only consuming the real primary mailbox's link can complete setup and rotate credentials.
  expect(await resetPassword(emailedToken(), "OwnerChosenPassword456!")).toBeTruthy();
  const confirmed = await db.user.findUniqueOrThrow({ where: { id } });
  expect(confirmed).toMatchObject({ email: `${id}@example.test`, mustChangePassword: false,
    twoFactorEnabled: true, role: "VIEWER", sessionVersion: 1 });
  expect(confirmed.emailVerifiedAt).toBeInstanceOf(Date);
  expect(await isSessionCurrent(db, { sub: id, sessionVersion: 0 })).toBe(false);
});

it("rejects already-onboarded callers even when they invoke the action directly", async () => {
  await db.user.update({ where: { id }, data: { emailVerifiedAt: new Date(), mustChangePassword: false } });
  expect(await completeOnboardingAction(undefined, forgedFields())).toEqual({ sent: false });
  expect(mocks.send).not.toHaveBeenCalled();
  const user = await db.user.findUniqueOrThrow({ where: { id } });
  expect(user.twoFactorEnabled).toBe(true);
  expect(verifyPassword(password, user.passwordHash!)).toBe(true);
});

it("lets an email-verified account complete a required password rotation without a dashboard loop", async () => {
  await db.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
  await expect(OnboardingPage()).resolves.toBeTruthy();
  expect(await completeOnboardingAction(undefined, new FormData())).toEqual({ sent: true });
  await resetPassword(emailedToken(), "OwnerChosenPassword456!");
  await expect(OnboardingPage()).rejects.toThrow("redirect:/dashboard");
});

it("cannot use a paused onboarding form to overwrite a recovered password or reuse its proof", async () => {
  await completeOnboardingAction(undefined, new FormData());
  const token = emailedToken();
  await resetPassword(token, "RecoveredPassword456!");
  expect(await completeOnboardingAction(undefined, forgedFields())).toEqual({ sent: false });
  expect(await resetPassword(token, "AttackerPassword123!")).toBeNull();
  const user = await db.user.findUniqueOrThrow({ where: { id } });
  expect(verifyPassword("RecoveredPassword456!", user.passwordHash!)).toBe(true);
});

it("fails closed without delivery and limits repeated emails", async () => {
  mocks.available = false;
  expect(await completeOnboardingAction(undefined, new FormData())).toEqual({ sent: false });
  expect(mocks.send).not.toHaveBeenCalled();
  mocks.available = true;
  expect(await completeOnboardingAction(undefined, new FormData())).toEqual({ sent: true });
  expect(await completeOnboardingAction(undefined, new FormData())).toEqual({ sent: false });
  expect(mocks.send).toHaveBeenCalledOnce();
});

it("requires a signed-in identity before exposing or sending a setup link", async () => {
  mocks.session = null;
  await expect(completeOnboardingAction(undefined, forgedFields())).rejects.toThrow("redirect:/signin");
  expect(mocks.send).not.toHaveBeenCalled();
});
