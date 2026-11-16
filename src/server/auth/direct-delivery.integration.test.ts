import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type * as EnvModule from "~/env";
import type { TransactionDb } from "~/server/transactions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";

// Keep production audit middleware, sender and source protocols real. Only the
// provider is replaced, so these regressions exercise actual SMTP deferral.
const smtp = vi.hoisted(() => ({ send: vi.fn(), configured: true, production: true }));
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: smtp.send, close: vi.fn() }) },
}));
vi.mock("~/env", async (original) => {
  const environmentModule = await original<typeof EnvModule>();
  return { env: new Proxy(environmentModule.env, {
    get(target, key) {
      if (key === "NODE_ENV") return smtp.production ? "production" : "development";
      if (key === "SMTP_HOST") return "smtp.example.test";
      if (key === "SMTP_PORT") return 465;
      if (key === "EMAIL_SECURITY_FROM") return smtp.configured ? "security@example.test" : undefined;
      if (key === "SMTP_SECURITY_PASSWORD") return smtp.configured ? "synthetic-password" : undefined;
      if (["SMTP_SECURITY_USER", "EMAIL_FROM", "SMTP_PASSWORD", "SMTP_USER"].includes(String(key))) return undefined;
      const value: unknown = Reflect.get(target, key);
      return value;
    },
  }) };
});

import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { databaseScope } from "~/server/db-scope";
import { runAuditedMutation } from "~/server/audit/evidence";
import { hashPassword } from "./password";
import { issueTutorSetupLink } from "./password-reset";
import { deliverAccountInvitation, inspectAccountInvitation, verifyAccountInvitation } from "./account-invitations";

const password = "SyntheticPassword733!";
const passwordHash = hashPassword(password);
let headId = "";
let userId = "";
let tutorId = "";
let accountlessTutorId = "";
let unverifiedId = "";
const recipient = "recipient@example.test";
type SmtpMessage = { text: string; to: string };

function api(id = headId, role: Session["role"] = "HEAD", database = db) {
  return createCaller({
    db: database,
    headers: new Headers(),
    session: { user: { id }, role, tutorId: id === userId ? tutorId : null, expires: "2099-01-01" },
  });
}
function latestMessage() {
  return smtp.send.mock.lastCall![0] as SmtpMessage;
}
function latestCode() {
  const code = / is ([0-9]{4})\./.exec(latestMessage().text)?.[1];
  if (!code) throw new Error("Expected a synthetic emailed verification code");
  return code;
}
const accepted = () => ({ accepted: [recipient], rejected: [] });

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  if (new URL(process.env.DATABASE_URL!).pathname !== "/shbs_shipping_test")
    throw new Error("Use the isolated shbs_shipping_test database.");
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map((row) => '"' + row.tablename.replaceAll('"', '""') + '"').join(",") + " CASCADE");
  smtp.configured = true;
  smtp.production = true;
  smtp.send.mockReset().mockResolvedValue(accepted());
  delete (globalThis as { mailTransports?: unknown }).mailTransports;
  vi.stubEnv("AUTH_URL", "https://school.example.test");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const head = await db.user.create({ data: { email: "head@example.test", role: "HEAD", name: "Synthetic Head" } });
  headId = head.id;
  const tutor = await db.tutor.create({ data: { englishName: "Synthetic Tutor", email: recipient, status: "ACTIVE" } });
  tutorId = tutor.id;
  const user = await db.user.create({ data: {
    email: recipient, role: "TUTOR", name: "Synthetic Tutor", tutorId, passwordHash, emailVerifiedAt: new Date(),
  } });
  userId = user.id;
  accountlessTutorId = (await db.tutor.create({ data: { englishName: "Synthetic New Tutor", email: "new@example.test" } })).id;
  unverifiedId = (await db.user.create({ data: { email: "unverified@example.test", role: "VIEWER" } })).id;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete (globalThis as { mailTransports?: unknown }).mailTransports;
});
afterAll(() => db.$disconnect());

describe("real audited credential APIs with the production sender", () => {
  it.each(["account", "tutor"] as const)("reports %s code acceptance only after its challenge commits", async (path) => {
    smtp.send.mockImplementation(async () => {
      expect(databaseScope.getStore()).toBeUndefined();
      expect(await db.emailVerificationCode.count({ where: { userId, purpose: "PASSWORD_CHANGE" } })).toBe(1);
      return accepted();
    });
    await expect(api(userId, "TUTOR")[path].requestPasswordChangeCode({ currentPassword: password }))
      .resolves.toMatchObject({ sent: true });
    expect(smtp.send).toHaveBeenCalledOnce();
  });

  it.each(["account", "tutor"] as const)("rejects a failed %s code send while preserving committed issuance", async (path) => {
    smtp.send.mockRejectedValueOnce(new Error("Synthetic SMTP rejected"));
    await expect(api(userId, "TUTOR")[path].requestPasswordChangeCode({ currentPassword: password }))
      .rejects.toThrow("Email delivery failed");
    expect(await db.emailVerificationCode.count({ where: { userId, purpose: "PASSWORD_CHANGE" } })).toBe(1);
    expect(smtp.send).toHaveBeenCalledOnce();
  });

  it.each(["account", "tutor"] as const)("refuses unavailable %s transport before issuance", async (path) => {
    smtp.configured = false;
    await expect(api(userId, "TUTOR")[path].requestPasswordChangeCode({ currentPassword: password }))
      .rejects.toThrow("delivery is unavailable");
    expect(await db.emailVerificationCode.count()).toBe(0);
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it("keeps an incorrect-password request from sending or creating a challenge", async () => {
    await expect(api(userId, "TUTOR").tutor.requestPasswordChangeCode({ currentPassword: "incorrect" }))
      .rejects.toThrow("Current password is incorrect");
    expect(await db.emailVerificationCode.count()).toBe(0);
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it.each(["accepted", "rejected"] as const)("settles staff verification %s without undoing the committed token", async (outcome) => {
    smtp.send.mockImplementation(async () => {
      expect(databaseScope.getStore()).toBeUndefined();
      expect(await db.passwordResetToken.count({ where: { userId: unverifiedId } })).toBe(1);
      if (outcome === "rejected") throw new Error("Synthetic SMTP rejected");
      return accepted();
    });
    await expect(api().admin.sendAccountVerification({ userId: unverifiedId }))
      .resolves.toEqual({ emailed: outcome === "accepted" });
    expect(smtp.send).toHaveBeenCalledOnce();
    expect(await db.passwordResetToken.count({ where: { userId: unverifiedId } })).toBe(1);
    expect(await db.auditLog.count({ where: { operation: "admin.sendAccountVerification", details: { path: ["outcome"], equals: "DELIVERY_FAILED" } } }))
      .toBe(outcome === "rejected" ? 1 : 0);
  });

  it.each(["linked", "accountless"] as const)("settles %s tutor setup from actual SMTP acceptance", async (kind) => {
    const target = kind === "linked" ? tutorId : accountlessTutorId;
    smtp.send.mockImplementation(async () => {
      expect(databaseScope.getStore()).toBeUndefined();
      expect(kind === "linked" ? await db.passwordResetToken.count() : await db.accountInvitation.count()).toBe(1);
      return accepted();
    });
    await expect(api().admin.sendTutorSetup({ tutorId: target })).resolves.toEqual({ emailed: true });
    expect(smtp.send).toHaveBeenCalledOnce();
  });

  it.each(["linked", "accountless"] as const)("reports failed %s setup without losing prior usable grants", async (kind) => {
    const target = kind === "linked" ? tutorId : accountlessTutorId;
    await api().admin.sendTutorSetup({ tutorId: target });
    const firstMessage = latestMessage();
    const priorInvitation = kind === "accountless" ? await db.accountInvitation.findFirstOrThrow() : null;
    const firstCode = kind === "accountless" ? latestCode() : null;
    const priorToken = kind === "linked" ? await db.passwordResetToken.findFirstOrThrow() : null;
    smtp.send.mockRejectedValueOnce(new Error("Synthetic SMTP rejected"));
    await expect(api().admin.sendTutorSetup({ tutorId: target })).resolves.toEqual({ emailed: false });
    expect(smtp.send).toHaveBeenCalledTimes(2);
    if (priorInvitation && firstCode) {
      expect(await db.accountInvitation.findUniqueOrThrow({ where: { id: priorInvitation.id } })).toEqual(priorInvitation);
      const proof = await verifyAccountInvitation(db, { invitationId: priorInvitation.id, email: firstMessage.to, code: firstCode });
      await expect(inspectAccountInvitation(db, { invitationId: priorInvitation.id, ...proof })).resolves.toMatchObject({ kind: "TUTOR" });
    } else if (priorToken) {
      expect(await db.passwordResetToken.findUniqueOrThrow({ where: { id: priorToken.id } })).toEqual(priorToken);
      expect(priorToken.consumedAt).toBeNull();
    }
  });

  it("does not infer email acceptance when existing-account recovery is a no-op", async () => {
    vi.spyOn(db.user, "findFirst").mockResolvedValueOnce(null);
    await expect(issueTutorSetupLink(tutorId, headId)).resolves.toEqual({ ok: true, delivery: { emailed: false } });
    expect(smtp.send).not.toHaveBeenCalled();
    expect(await db.passwordResetToken.count()).toBe(0);
  });

  it("keeps unavailable staff delivery from issuing new grants", async () => {
    smtp.configured = false;
    await expect(api().admin.sendAccountVerification({ userId: unverifiedId })).resolves.toEqual({ emailed: false });
    for (const target of [tutorId, accountlessTutorId])
      await expect(api().admin.sendTutorSetup({ tutorId: target })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await db.passwordResetToken.count()).toBe(0);
    expect(await db.registrationCode.count()).toBe(0);
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it("reports no accepted email when development only logs an unconfigured send", async () => {
    smtp.configured = false;
    smtp.production = false;
    await expect(api().admin.sendTutorSetup({ tutorId })).resolves.toEqual({ emailed: false });
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it("does not send a queued verification when the enclosing write rolls back", async () => {
    const rollbackDb = new Proxy(db, { get(target, key) {
      if (key === "$transaction") return async (work: (tx: TransactionDb) => Promise<unknown>) =>
        db.$transaction(async (tx) => {
          await work(tx);
          throw new Error("Synthetic failure before commit");
        });
      const value: unknown = Reflect.get(target, key);
      return value;
    } });
    await expect(api(headId, "HEAD", rollbackDb).admin.sendAccountVerification({ userId: unverifiedId }))
      .rejects.toThrow("Synthetic failure before commit");
    expect(await db.passwordResetToken.count()).toBe(0);
    expect(smtp.send).not.toHaveBeenCalled();
  });

  it("does not label an exact invitation-source retry as another accepted send", async () => {
    await api().admin.sendTutorSetup({ tutorId: accountlessTutorId });
    const before = await db.accountInvitation.findFirstOrThrow();
    const source = before.source as { type: "staff"; id: string; challenge: string };
    const delivery = { emailed: false };
    await runAuditedMutation(db, { id: headId, name: "Synthetic Head", role: "HEAD" }, "admin.sendTutorSetup", async (tx) => {
      await deliverAccountInvitation(tx, { kind: "TUTOR", email: before.email, sourceKey: before.sourceKey, source, deliveryReceipt: delivery });
      return { ok: true, data: delivery };
    });
    expect(delivery.emailed).toBe(false);
    expect(smtp.send).toHaveBeenCalledOnce();
    expect(await db.accountInvitation.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
  });
});
