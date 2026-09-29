import { afterAll, beforeEach, expect, it, vi } from "vitest";
const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailDeliveryAvailable: () => true,
}));
import { db } from "~/server/db";
import { lockAccountProfile } from "~/server/account-profile";
import { assertIsolatedTestDatabase } from "~/test/database-guard";
import { hashPassword } from "./password";
import { hashCode } from "./registration";
import {
  requestSecondaryEmail,
  confirmSecondaryEmail,
  manageSecondaryEmail,
} from "./account-emails";
import { requestEmailChange } from "./email-change";
import { issueStepUpCode } from "./step-up";
import { issueLoginCode } from "./two-factor";

assertIsolatedTestDatabase(process.env.DATABASE_URL);
const password = "Retired-email-test-190!";
let userId: string;
let survivorId: string;
beforeEach(async () => {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    "TRUNCATE " +
      tables
        .map(({ tablename }) => '"' + tablename.replaceAll('"', '""') + '"')
        .join(",") +
      " CASCADE",
  );
  mail.send.mockReset().mockResolvedValue(undefined);
  survivorId = (
    await db.user.create({
      data: { email: "kept-email190@example.test", role: "STUDENT" },
    })
  ).id;
  userId = (
    await db.user.create({
      data: {
        email: "old-email190@example.test",
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
        role: "STUDENT",
      },
    })
  ).id;
});
afterAll(async () => {
  // Retired identities deliberately cannot be deleted through ordinary account operations.
  await db.$executeRawUnsafe('TRUNCATE "User" CASCADE');
  await db.$disconnect();
});
async function retire() {
  await db.$transaction(async (tx) => {
    await lockAccountProfile(tx, userId);
    await tx.user.update({
      where: { id: userId },
      data: { mergedIntoId: survivorId, passwordHash: null },
    });
    await tx.emailVerificationCode.deleteMany({ where: { userId } });
  });
}

it("retired accounts cannot reserve, promote or release secondary aliases", async () => {
  await db.accountEmail.create({
    data: {
      userId,
      email: "retained-alias@example.test",
      verifiedAt: new Date(),
    },
  });
  await retire();
  await expect(
    requestSecondaryEmail(userId, "new-alias@example.test", password),
  ).rejects.toThrow("retired");
  await expect(
    manageSecondaryEmail(
      userId,
      "retained-alias@example.test",
      password,
      "primary",
    ),
  ).rejects.toThrow("retired");
  await expect(
    manageSecondaryEmail(
      userId,
      "retained-alias@example.test",
      password,
      "remove",
    ),
  ).rejects.toThrow("retired");
  expect(
    await confirmSecondaryEmail(userId, "new-alias@example.test", "ABCDE"),
  ).toBe(false);
  expect(
    await db.accountEmail.findUnique({
      where: { email: "retained-alias@example.test" },
    }),
  ).toMatchObject({ userId });
  expect(await db.emailVerificationCode.count({ where: { userId } })).toBe(0);
  expect(mail.send).not.toHaveBeenCalled();
});

it("a pending verification cannot acquire an alias after the retirement lock", async () => {
  await db.emailVerificationCode.create({
    data: {
      userId,
      purpose: "SECONDARY_EMAIL",
      targetEmail: "pending-alias@example.test",
      codeHash: hashCode("ABCDE"),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await retire();
  expect(
    await confirmSecondaryEmail(userId, "pending-alias@example.test", "ABCDE"),
  ).toBe(false);
  expect(
    await db.accountEmail.findUnique({
      where: { email: "pending-alias@example.test" },
    }),
  ).toBeNull();
});

it.each(["step-up", "email-change", "secondary", "login"] as const)(
  "fences a %s request admitted before retirement and resumed afterward",
  async (kind) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const retirement = db.$transaction(async (tx) => {
      await lockAccountProfile(tx, userId);
      locked();
      await gate;
      await tx.user.update({
        where: { id: userId },
        data: { mergedIntoId: survivorId, passwordHash: null },
      });
      await tx.emailVerificationCode.deleteMany({ where: { userId } });
    });
    await acquired;
    const operation =
      kind === "step-up"
        ? issueStepUpCode(userId, "PASSWORD_CHANGE")
        : kind === "email-change"
          ? requestEmailChange(userId, "replacement@example.test", password)
          : kind === "secondary"
            ? requestSecondaryEmail(userId, "new-alias@example.test", password)
            : issueLoginCode(userId, user.sessionVersion);
    const rejected = expect(operation).rejects.toThrow();
    release();
    await retirement;
    await rejected;
    expect(await db.emailVerificationCode.count({ where: { userId } })).toBe(0);
    expect(
      await db.accountEmail.findUnique({
        where: { email: "new-alias@example.test" },
      }),
    ).toBeNull();
    expect(mail.send).not.toHaveBeenCalled();
  },
);
