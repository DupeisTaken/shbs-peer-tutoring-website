import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { EmailMessage } from "~/server/email/sender";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => vi.fn<(message: EmailMessage) => Promise<void>>());
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail },
  isEmailConfigured: () => true,
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { hashPassword, verifyPassword } from "./password";
import { verifySigninPassword } from "./credentials";
import { issuePasswordReset, resetPassword } from "./password-reset";
import { issueLoginCode, verifyLoginCode } from "./two-factor";
import { changeVerifiedPassword, isSessionCurrent } from "./session-version";

const oldPassword = "SessionOldPassword123!";
const newPassword = "SessionNewPassword456!";
let userId = "";
let serial = 0;
const caller = (role: Session["role"] = "VIEWER", tutorId: string | null = null) =>
  createCaller({ db, headers: new Headers(), session: {
    user: { id: userId, email: `${userId}@example.test`, name: "Session Test" },
    role, tutorId, expires: "2099-01-01",
  } });
const oldSession = () => ({ sub: userId, sessionVersion: 0 });
function assertSessionTestDatabase() {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/shbs_shipping_test")
    throw new Error("Use the isolated local shbs_shipping_test database.");
}
const lastCode = () => {
  const code = /code is ([A-Z0-9]+)/.exec(mail.mock.calls.at(-1)?.[0].text ?? "")?.[1];
  if (!code) throw new Error("Expected an emailed verification code");
  return code;
};
async function resetLink() {
  await issuePasswordReset(`${userId}@example.test`);
  const token = /token=([a-f0-9]+)/.exec(mail.mock.calls.at(-1)?.[0].text ?? "")?.[1];
  if (!token) throw new Error("Expected an emailed reset link");
  return token;
}

beforeEach(async () => {
  assertSessionTestDatabase();
  await db.programFeature.upsert({ where: { key: "EMAIL_2FA" }, create: { key: "EMAIL_2FA", enabled: true }, update: { enabled: true } });
  userId = `session115-${++serial}`;
  mail.mockReset().mockResolvedValue(undefined);
  await db.user.create({ data: {
    id: userId, email: `${userId}@example.test`, username: userId, role: "VIEWER",
    passwordHash: hashPassword(oldPassword), emailVerifiedAt: new Date(),
  } });
});
afterAll(async () => {
  try {
    // Vitest still runs cleanup after a failed beforeEach; guard destructive queries again.
    assertSessionTestDatabase();
    await db.user.deleteMany({ where: { id: { startsWith: "session115-" } } });
    await db.tutor.deleteMany({ where: { id: { startsWith: "session115-" } } });
  } finally {
    await db.$disconnect();
  }
});

it("revokes every old session after recovery and accepts only newly verified credentials", async () => {
  const verified = await verifySigninPassword(`${userId}@example.test`, oldPassword, userId);
  expect(verified).toMatchObject({ ok: true, user: { sessionVersion: 0 } });
  expect(await isSessionCurrent(db, oldSession())).toBe(true);
  expect(await resetPassword(await resetLink(), newPassword)).toMatchObject({ email: `${userId}@example.test` });
  // Two browsers carry the same generation; there is no exception for the requesting browser.
  expect(await Promise.all([isSessionCurrent(db, oldSession()), isSessionCurrent(db, { ...oldSession() })])).toEqual([false, false]);
  expect(await verifySigninPassword(`${userId}@example.test`, oldPassword, userId)).toMatchObject({ ok: false });
  expect(await verifySigninPassword(`${userId}@example.test`, newPassword, userId)).toMatchObject({ ok: true, user: { sessionVersion: 1 } });
  expect(await isSessionCurrent(db, { sub: userId, sessionVersion: 1 })).toBe(true);
});

it.each(["account", "tutor"] as const)("revokes the requesting session after the %s password flow with email step-up", async (path) => {
  let api = caller();
  if (path === "tutor") {
    await db.tutor.create({ data: { id: userId, englishName: "Session Tutor", email: `${userId}@example.test` } });
    await db.user.update({ where: { id: userId }, data: { role: "TUTOR", tutorId: userId } });
    api = caller("TUTOR", userId);
  }
  await api[path].requestPasswordChangeCode({ currentPassword: oldPassword });
  await expect(api[path].changePassword({ currentPassword: oldPassword, newPassword, code: lastCode() })).resolves.toEqual({ ok: true });
  expect(await isSessionCurrent(db, oldSession())).toBe(false);
  const current = await db.user.findUniqueOrThrow({ where: { id: userId } });
  expect(current.sessionVersion).toBe(1);
  expect(verifyPassword(newPassword, current.passwordHash!)).toBe(true);
});

it("rejects legacy, malformed and deleted-account sessions without revoking unchanged profiles", async () => {
  for (const sessionVersion of [undefined, "0", NaN, 0.5, -1])
    expect(await isSessionCurrent(db, { sub: userId, sessionVersion })).toBe(false);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await db.user.update({ where: { id: userId }, data: { name: "Updated", passwordHash: user.passwordHash, sessionVersion: 99 } });
  expect(await isSessionCurrent(db, oldSession())).toBe(true);
  await db.user.delete({ where: { id: userId } });
  expect(await isSessionCurrent(db, oldSession())).toBe(false);
});

it("advances the generation on any password write and prevents restoring an old generation", async () => {
  await db.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(newPassword), sessionVersion: 0 } });
  await db.user.update({ where: { id: userId }, data: { sessionVersion: 0 } });
  expect(await isSessionCurrent(db, oldSession())).toBe(false);
  expect(await isSessionCurrent(db, { sub: userId, sessionVersion: 1 })).toBe(true);
});

it("does not issue a fresh login grant from password evidence captured before rotation", async () => {
  await issueLoginCode(userId, 0);
  const oldCode = lastCode();
  await resetPassword(await resetLink(), newPassword);
  await expect(issueLoginCode(userId, 0)).rejects.toThrow("Credentials changed");
  expect(await verifyLoginCode(userId, oldCode)).toBe(false);
  expect(await db.emailVerificationCode.count({ where: { userId, purpose: "LOGIN_2FA", consumedAt: null } })).toBe(0);
  await issueLoginCode(userId, 1);
  expect(await verifyLoginCode(userId, lastCode())).toBe(true);
});

it("allows only one concurrent password change authorized by the same current password", async () => {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const candidates = [newPassword, "AnotherNewPassword789!"];
  const results = await Promise.allSettled(candidates.map((value) => changeVerifiedPassword(db, userId, user.passwordHash!, value)));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected).toMatchObject({ reason: { code: "CONFLICT" } });
  const winner = results.findIndex((result) => result.status === "fulfilled");
  const current = await db.user.findUniqueOrThrow({ where: { id: userId } });
  expect(current.sessionVersion).toBe(1);
  expect(verifyPassword(candidates[winner]!, current.passwordHash!)).toBe(true);
});

it("does not overwrite a recovered password when an older verified change resumes", async () => {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await resetPassword(await resetLink(), newPassword);
  await expect(changeVerifiedPassword(db, userId, user.passwordHash!, "StalePassword123!")).rejects.toMatchObject({ code: "CONFLICT" });
  const current = await db.user.findUniqueOrThrow({ where: { id: userId } });
  expect(current.sessionVersion).toBe(1);
  expect(verifyPassword(newPassword, current.passwordHash!)).toBe(true);
});
