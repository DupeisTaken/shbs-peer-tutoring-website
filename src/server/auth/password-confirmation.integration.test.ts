import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import * as passwords from "./password";
import { assertCallerPassword } from "./reauth";
import { authenticateEmailAction } from "./account-emails";
import { verifySigninPassword } from "./credentials";
import { PASSWORD_CONFIRMATION_WINDOW_MS } from "./password-confirmation";

const prefix = `confirmation239-${randomUUID()}-`;
const password = "SyntheticConfirmation239!";
let userId: string;
let serial = 0;
function guardDatabase() {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use the isolated local shbs_shipping_test database.");
}
const caller = (id = userId) => createCaller({
  db,
  headers: new Headers({ "x-forwarded-for": "127.0.0.1" }),
  session: { user: { id }, role: "VIEWER", tutorId: null, expires: "2099-01-01" },
});

beforeEach(async () => {
  guardDatabase();
  userId = `${prefix}${++serial}`;
  await db.user.create({ data: {
    id: userId, email: `${userId}@example.test`, username: userId,
    role: "VIEWER", passwordHash: passwords.hashPassword(password), twoFactorEnabled: true,
  } });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  try {
    guardDatabase();
    // Only this run's synthetic accounts and their audit rows belong to this fixture.
    await db.auditLog.deleteMany({ where: { userId: { startsWith: prefix } } });
    await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  } finally {
    await db.$disconnect();
  }
});

it("cuts off real cross-action hashes, leaves state unchanged, and recovers without extending denial", async () => {
  const verify = vi.spyOn(passwords, "verifyPassword");
  const now = Date.now();
  const time = vi.spyOn(Date, "now").mockReturnValue(now);
  for (let i = 0; i < 5; i++) {
    await expect(caller().account.setTwoFactorEnabled({ enabled: false, currentPassword: "wrong" }))
      .rejects.toThrow(/incorrect/);
    await expect(assertCallerPassword(userId, "wrong")).rejects.toThrow(/incorrect/);
  }
  time.mockReturnValue(now + PASSWORD_CONFIRMATION_WINDOW_MS - 1);
  await expect(caller().account.setTwoFactorEnabled({ enabled: false, currentPassword: password }))
    .rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(verify).toHaveBeenCalledTimes(10);
  expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).twoFactorEnabled).toBe(true);
  expect(await db.auditLog.count({ where: { userId } })).toBe(0);

  // Expiry uses the original admitted attempts, even after a last-millisecond denial.
  time.mockReturnValue(now + PASSWORD_CONFIRMATION_WINDOW_MS);
  await expect(caller().account.setTwoFactorEnabled({ enabled: false, currentPassword: password }))
    .resolves.toEqual({ ok: true, enabled: false });
  expect(verify).toHaveBeenCalledTimes(11);
  expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).twoFactorEnabled).toBe(false);
  const audit = await db.auditLog.findMany({ where: { userId } });
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ operation: "account.setTwoFactorEnabled" });
  expect(JSON.stringify(audit)).not.toContain(password);
  expect(JSON.stringify(audit)).not.toContain("scrypt$");
});

it("does not refund a successful password check when its enclosing transaction rolls back", async () => {
  const verify = vi.spyOn(passwords, "verifyPassword");
  for (let i = 0; i < 10; i++) {
    await expect(db.$transaction(async (tx) => {
      await authenticateEmailAction(tx, userId, password);
      await tx.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
      throw new Error("synthetic rollback after confirmation");
    })).rejects.toThrow("synthetic rollback");
  }
  await expect(caller().account.changePassword({ currentPassword: password, newPassword: "Replacement239!" }))
    .rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(verify).toHaveBeenCalledTimes(10);
  expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).twoFactorEnabled).toBe(true);
  expect(await db.auditLog.count({ where: { userId } })).toBe(0);
});

it("keeps the same account budget after handle changes while preserving sign-in and another network peer", async () => {
  for (let i = 0; i < 10; i++) await expect(assertCallerPassword(userId, "wrong")).rejects.toThrow(/incorrect/);
  const renamed = `${userId}-renamed`;
  await db.user.update({ where: { id: userId }, data: { username: renamed } });
  await expect(caller().account.requestPasswordChangeCode({ currentPassword: password }))
    .rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  await expect(verifySigninPassword(renamed, password, "school-ip"))
    .resolves.toMatchObject({ ok: true, user: { id: userId } });
  const peer = `${userId}-peer`;
  await db.user.create({ data: {
    id: peer, email: `${peer}@example.test`, role: "VIEWER", passwordHash: passwords.hashPassword(password),
  } });
  await expect(caller(peer).account.setTwoFactorEnabled({ enabled: false, currentPassword: password }))
    .resolves.toEqual({ ok: true, enabled: false });
});
