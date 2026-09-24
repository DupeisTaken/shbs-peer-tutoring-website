import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { EmailMessage } from "~/server/email/sender";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({ send: vi.fn<(message: EmailMessage) => Promise<void>>(), available: true }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailConfigured: () => true,
  isEmailDeliveryAvailable: () => mail.available,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { issueTutorSetupLink, resetPassword } from "./password-reset";
import { hashPassword, verifyPassword } from "./password";

const password = "OriginalPassword123!";
const caller = (role: Session["role"]) => createCaller({ db, headers: new Headers(), session: {
  user: { id: "actor" }, role, tutorId: null, expires: "2099-01-01",
} });
beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/shbs_shipping_test")
    throw Error("Dedicated local test database required");
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map((t) => '"' + t.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  mail.send.mockReset().mockResolvedValue(undefined); mail.available = true;
});
afterAll(() => db.$disconnect());

it.each([
  ["COORDINATOR", "HEAD"], ["COORDINATOR", "ADMIN"], ["ADMIN", "HEAD"], ["ADMIN", "ADMIN"],
] as const)("%s receives no recovery secret for a tutor-linked %s; only the recipient can redeem mail", async (actorRole, targetRole) => {
  const tutor = await db.tutor.create({ data: { englishName: "Target", email: "target@example.test" } });
  await db.user.createMany({ data: [
    { id: "actor", email: "actor@example.test", role: actorRole },
    { id: "target", email: "target@example.test", role: targetRole, tutorId: tutor.id, passwordHash: hashPassword(password), emailVerifiedAt: new Date() },
  ] });
  const result = await caller(actorRole).admin.sendTutorSetup({ tutorId: tutor.id });
  expect(result).toEqual({ emailed: true });
  expect(result).not.toHaveProperty("link");
  expect(mail.send).toHaveBeenCalledTimes(1);
  const message = mail.send.mock.calls[0]![0];
  expect(message.to).toBe("target@example.test");
  const token = /token=([a-f0-9]{64})/.exec(message.text)?.[1];
  if (!token) throw Error("Expected recipient-only reset token");
  expect(JSON.stringify(result)).not.toContain(token);
  expect(await resetPassword("0".repeat(64), "AttackerPassword123!")).toBeNull();
  expect(verifyPassword(password, (await db.user.findUniqueOrThrow({ where: { id: "target" } })).passwordHash!)).toBe(true);
  expect(await resetPassword(token, "OwnerNewPassword123!")).toMatchObject({ email: "target@example.test" });
  expect((await db.user.findUniqueOrThrow({ where: { id: "target" } })).role).toBe(targetRole);
});

it("preserves Head-only provisioning and never returns a setup token even internally", async () => {
  const tutor = await db.tutor.create({ data: { englishName: "New Tutor", email: "new-tutor@example.test" } });
  await db.user.create({ data: { id: "actor", email: "actor@example.test", role: "COORDINATOR" } });
  await expect(caller("COORDINATOR").admin.sendTutorSetup({ tutorId: tutor.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await db.passwordResetToken.count()).toBe(0);
  await db.user.update({ where: { id: "actor" }, data: { role: "HEAD" } });
  expect(await issueTutorSetupLink(tutor.id, "actor")).toEqual({ ok: true, emailed: true });
  expect(await db.user.findUnique({ where: { email: "new-tutor@example.test" } })).toMatchObject({ role: "TUTOR", tutorId: tutor.id });
  expect(mail.send.mock.calls[0]![0].to).toBe("new-tutor@example.test");
});

it("fails before provisioning or issuing grants when email delivery is unavailable", async () => {
  const tutor = await db.tutor.create({ data: { englishName: "New Tutor", email: "new-tutor@example.test" } });
  await db.user.create({ data: { id: "actor", email: "actor@example.test", role: "HEAD" } });
  mail.available = false;
  await expect(caller("HEAD").admin.sendTutorSetup({ tutorId: tutor.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(await db.user.count()).toBe(1);
  expect(await db.passwordResetToken.count()).toBe(0);
  expect(mail.send).not.toHaveBeenCalled();
});
