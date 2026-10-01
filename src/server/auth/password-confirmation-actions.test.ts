import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Exercise real procedure middleware and shared password budgets without a database/server.
const mocks = vi.hoisted(() => ({
  findUser: vi.fn(), updateUser: vi.fn(), audit: vi.fn(), hash: vi.fn(),
  features: vi.fn(), issueCode: vi.fn(), verifyCode: vi.fn(), change: vi.fn(), delivery: vi.fn(),
}));
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("~/server/db", () => ({ db: {
  user: { findUnique: mocks.findUser, findUniqueOrThrow: mocks.findUser, update: mocks.updateUser },
  auditLog: { create: mocks.audit },
} }));
vi.mock("./password", () => ({ verifyPassword: mocks.hash }));
vi.mock("./step-up", () => ({ issueStepUpCode: mocks.issueCode, verifyStepUpCode: mocks.verifyCode }));
vi.mock("./session-version", () => ({ changeVerifiedPassword: mocks.change }));
vi.mock("~/server/program/features", () => ({ getFeatures: mocks.features }));
vi.mock("~/server/email/sender", () => ({ isEmailDeliveryAvailable: mocks.delivery, emailSender: { send: vi.fn() } }));
vi.mock("~/server/account-profile", () => ({ lockAccountProfile: vi.fn(), updateAccountProfile: vi.fn() }));
vi.mock("./username", () => ({ lockUsernameNamespace: vi.fn(), ensureUserUsername: vi.fn() }));

import { db } from "~/server/db";
import { createTRPCRouter } from "~/server/api/trpc";
import { accountRouter } from "~/server/api/routers/account";
import { tutorRouter } from "~/server/api/routers/tutor";
import { adminRouter } from "~/server/api/routers/admin";
import { assertCallerPassword } from "./reauth";
import { authenticateEmailAction } from "./account-emails";
import { requestEmailChange } from "./email-change";
import { combineAccounts } from "~/server/combine-accounts";
import type { TransactionDb } from "~/server/transactions";
import { PASSWORD_CONFIRMATION_WINDOW_MS } from "./password-confirmation";

const router = createTRPCRouter({ account: accountRouter, tutor: tutorRouter, admin: adminRouter });
const caller = (id: string, role: Session["role"] = "HEAD") => router.createCaller({
  db, headers: new Headers(),
  session: { user: { id }, role, tutorId: "tutor", expires: "2099-01-01" },
});
const transaction = { user: db.user, $executeRaw: vi.fn() } as unknown as TransactionDb;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01"));
  mocks.findUser.mockResolvedValue({ role: "HEAD", tutorId: "tutor", passwordHash: "stored", name: "Test" });
  mocks.hash.mockReturnValue(false);
  mocks.features.mockResolvedValue({ EMAIL_2FA: true });
  mocks.delivery.mockReturnValue(true);
  mocks.issueCode.mockResolvedValue({ email: "test@example.test" });
  mocks.verifyCode.mockResolvedValue({ ok: true });
});
afterEach(() => vi.useRealTimers());

it("shares failures across every authenticated password-check path, including legacy tutor APIs", async () => {
  const id = randomUUID(); const api = caller(id);
  const attempts = [
    () => api.account.setTwoFactorEnabled({ enabled: false, currentPassword: "wrong" }),
    () => api.account.requestPasswordChangeCode({ currentPassword: "wrong" }),
    () => api.account.changePassword({ currentPassword: "wrong", newPassword: "NewPassword" }),
    () => api.tutor.requestPasswordChangeCode({ currentPassword: "wrong" }),
    () => api.tutor.changePassword({ currentPassword: "wrong", newPassword: "NewPassword" }),
    () => assertCallerPassword(id, "wrong"),
    () => authenticateEmailAction(transaction, id, "wrong"),
    () => requestEmailChange(id, "new@example.test", "wrong"),
    () => combineAccounts(transaction, id, { survivorId: "a", duplicateId: "b", fingerprint: "unused", confirmPassword: "wrong" }),
    () => api.account.setTwoFactorEnabled({ enabled: true, currentPassword: "wrong" }),
  ];
  for (const attempt of attempts) await expect(attempt()).rejects.toThrow(/incorrect/);
  expect(mocks.hash).toHaveBeenCalledTimes(10);
  for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(mocks.hash).toHaveBeenCalledTimes(10);
  expect(mocks.updateUser).not.toHaveBeenCalled();
  expect(mocks.issueCode).not.toHaveBeenCalled();
  expect(mocks.change).not.toHaveBeenCalled();
  vi.advanceTimersByTime(PASSWORD_CONFIRMATION_WINDOW_MS);
  mocks.hash.mockReturnValue(true);
  await expect(api.account.setTwoFactorEnabled({ enabled: false, currentPassword: "valid" })).resolves.toMatchObject({ enabled: false });
});

it("keeps MFA and delivery checks after valid confirmation and permits normal password change", async () => {
  mocks.hash.mockReturnValue(true);
  const api = caller(randomUUID());
  await expect(api.account.requestPasswordChangeCode({ currentPassword: "valid" })).resolves.toMatchObject({ sent: true });
  await expect(api.account.changePassword({ currentPassword: "valid", newPassword: "NewPassword" })).rejects.toThrow(/Request a verification/);
  expect(mocks.change).not.toHaveBeenCalled();
  await api.account.changePassword({ currentPassword: "valid", newPassword: "NewPassword", code: "12345" });
  expect(mocks.verifyCode).toHaveBeenCalledTimes(1);
  expect(mocks.change).toHaveBeenCalledTimes(1);
  mocks.delivery.mockReturnValue(false);
  await expect(api.account.setTwoFactorEnabled({ enabled: true, currentPassword: "valid" })).rejects.toThrow(/delivery/);
  await expect(api.account.changePassword({ currentPassword: "valid", newPassword: "NewPassword", code: "12345" })).rejects.toThrow(/delivery/);
  expect(mocks.change).toHaveBeenCalledTimes(1);
  await expect(api.account.setTwoFactorEnabled({ enabled: false, currentPassword: "valid" })).resolves.toMatchObject({ enabled: false });
});

it("rejects oversized input and unauthorized callers before verification", async () => {
  const api = caller(randomUUID());
  await expect(api.account.requestPasswordChangeCode({ currentPassword: "x".repeat(1025) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(api.account.changePassword({ currentPassword: "valid", newPassword: "x".repeat(1025) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  mocks.findUser.mockResolvedValue({ role: "VIEWER", tutorId: null });
  await expect(api.tutor.requestPasswordChangeCode({ currentPassword: "wrong" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(api.admin.deleteUser({ userId: "cjld2cjxh0000qzrmn831i7rn", confirmPassword: "wrong" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.hash).not.toHaveBeenCalled();
});
