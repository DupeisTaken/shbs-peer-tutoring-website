import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "~/server/db";
import { resetPasswordAction } from "~/app/reset-password/actions";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { hashPassword } from "./password";
import type * as PasswordModule from "./password";
import * as resetDomain from "./password-reset";
import { verifySigninPassword } from "./credentials";
import { verifyPasswordConfirmation } from "./password-confirmation";

vi.mock("~/server/auth", () => ({ auth: async () => null }));
// Keep real scrypt for both reset and sign-in. Observe only whether rejected
// input reaches hashing; fixtures must still represent real installed hashes.
vi.mock("./password", async (importOriginal) => {
  const actual = await importOriginal<typeof PasswordModule>();
  return { ...actual, hashPassword: vi.fn(actual.hashPassword) };
});

beforeEach(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  vi.clearAllMocks();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$disconnect());

async function fixture(installedPassword = "OriginalPassword123!") {
  const user = await db.user.create({
    data: {
      // Each fixture owns its sign-in limiter key; database isolation alone does
      // not reset the real in-process limiter, which remains enabled in this suite.
      email: `synthetic-reset-${randomUUID()}@example.test`,
      name: "Synthetic reset recipient",
      role: "VIEWER",
      passwordHash: hashPassword(installedPassword),
      emailVerifiedAt: new Date(),
      mustChangePassword: true,
    },
  });
  // Model already-delivered reset grants without SMTP. Rejected input must not
  // consume either grant; successful correction retains normal single-use rules.
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60_000);
  const grant = await db.passwordResetToken.create({
    data: {
      userId: user.id,
      targetEmail: user.email,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt,
    },
  });
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      targetEmail: user.email,
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      expiresAt,
    },
  });
  return { user, grant, token };
}

function input(token: string, password: string, confirm = password) {
  const form = new FormData();
  form.set("token", token);
  form.set("password", password);
  form.set("confirm", confirm);
  return form;
}

async function retainedState(userId: string) {
  const [user, grants, notifications, deliveries] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        passwordHash: true,
        mustChangePassword: true,
        emailVerifiedAt: true,
        sessionVersion: true,
        refreshAuthorityRevision: true,
        historyAccessRevision: true,
      },
    }),
    db.passwordResetToken.findMany({
      where: { userId },
      orderBy: { id: "asc" },
    }),
    db.notification.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    db.emailDelivery.findMany({ where: { userId }, orderBy: { id: "asc" } }),
  ]);
  return { user, grants, notifications, deliveries };
}

async function expectUsableReset(
  userId: string,
  email: string,
  password: string,
) {
  const fresh = await db.user.findUniqueOrThrow({ where: { id: userId } });
  expect(verifyPasswordConfirmation(userId, password, fresh.passwordHash)).toBe(
    true,
  );
  expect(
    await verifySigninPassword(email, password, randomUUID()),
  ).toMatchObject({ ok: true });
  expect(fresh.mustChangePassword).toBe(false);
  expect(
    await db.passwordResetToken.count({ where: { userId, consumedAt: null } }),
  ).toBe(0);
  return fresh;
}

it.each([7, 8, 1024, 1025])(
  "enforces the new-password length boundary directly in resetPassword (%i characters)",
  async (length) => {
    const { user, token } = await fixture();
    const password = "x".repeat(length);
    const before = await retainedState(user.id);
    if (length === 8 || length === 1024) {
      await expect(
        resetDomain.resetPassword(token, password),
      ).resolves.toMatchObject({ email: user.email });
      const fresh = await expectUsableReset(user.id, user.email, password);
      expect(fresh.passwordHash).not.toBe(before.user.passwordHash);
      expect(fresh.sessionVersion).toBeGreaterThan(before.user.sessionVersion);
      return;
    }

    const lookup = vi.spyOn(db.passwordResetToken, "findUnique");
    const transaction = vi.spyOn(db, "$transaction");
    vi.mocked(hashPassword).mockClear();
    await expect(
      resetDomain.resetPassword(token, password),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        length === 7
          ? "Password must be at least 8 characters."
          : "Password must be at most 1024 characters.",
    });
    // Reject before grant lookup, transaction admission or expensive scrypt. The
    // retained database state additionally catches accidental credential writes.
    expect(lookup).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(await retainedState(user.id)).toEqual(before);
    vi.restoreAllMocks();

    const corrected = "CorrectedPassword123!";
    await expect(
      resetDomain.resetPassword(token, corrected),
    ).resolves.toMatchObject({ email: user.email });
    await expectUsableReset(user.id, user.email, corrected);
    await expect(
      resetDomain.resetPassword(token, "AnotherPassword123!"),
    ).resolves.toBeNull();
  },
);

it.each([7, 8, 1024, 1025])(
  "enforces the same boundary at the reset action (%i characters)",
  async (length) => {
    const { user, grant, token } = await fixture();
    const password = "x".repeat(length);
    const before = await retainedState(user.id);
    const reset = vi.spyOn(resetDomain, "resetPassword");
    const result = await resetPasswordAction(undefined, input(token, password));
    if (length === 8 || length === 1024) {
      expect(result).toMatchObject({ ok: true, email: user.email });
      expect(reset).toHaveBeenCalledWith(token, password);
      await expectUsableReset(user.id, user.email, password);
      return;
    }

    expect(result).toEqual({
      code: "password-length",
      error:
        length === 7
          ? "Password must be at least 8 characters."
          : "Password must be at most 1024 characters.",
    });
    expect(reset).not.toHaveBeenCalled();
    const after = await retainedState(user.id);
    // Preserve the audit probe's concrete acceptance/hash/grant assertions, with
    // explicit rejection and all credential generations/grants checked as well.
    expect({
      resetAccepted: result?.ok === true,
      passwordUnchanged: after.user.passwordHash === user.passwordHash,
      grantConsumed: Boolean(
        after.grants.find((row) => row.id === grant.id)!.consumedAt,
      ),
    }).toEqual({
      resetAccepted: false,
      passwordUnchanged: true,
      grantConsumed: false,
    });
    expect(after).toEqual(before);
    await expect(
      resetPasswordAction(result, input(token, "CorrectedPassword123!")),
    ).resolves.toMatchObject({ ok: true });
    await expectUsableReset(user.id, user.email, "CorrectedPassword123!");
  },
);

it("rejects an oversized action password as length-invalid before confirmation mismatch or domain admission", async () => {
  const { user, token } = await fixture();
  const before = await retainedState(user.id);
  const reset = vi.spyOn(resetDomain, "resetPassword");
  await expect(
    resetPasswordAction(undefined, input(token, "x".repeat(1025), "different")),
  ).resolves.toEqual({
    code: "password-length",
    error: "Password must be at most 1024 characters.",
  });
  expect(reset).not.toHaveBeenCalled();
  expect(await retainedState(user.id)).toEqual(before);
});

it("preserves every character of a valid password without trimming", async () => {
  const { user, token } = await fixture();
  const password = "  abcd  ";
  await expect(
    resetDomain.resetPassword(token, password),
  ).resolves.toMatchObject({ email: user.email });
  await expectUsableReset(user.id, user.email, password);
  expect(
    await verifySigninPassword(user.email, password.trim(), randomUUID()),
  ).toMatchObject({ ok: false, reason: "invalid" });
});

it("keeps an already-installed 1025-character credential compatible with sign-in while confirmation retains its existing maximum", async () => {
  const password = "x".repeat(1025);
  const { user } = await fixture(password);
  expect(
    await verifySigninPassword(user.email, password, randomUUID()),
  ).toMatchObject({ ok: true });
  expect(() =>
    verifyPasswordConfirmation(user.id, password, user.passwordHash),
  ).toThrow(/1024/);
});
