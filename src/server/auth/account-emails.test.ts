import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { EmailMessage } from "~/server/email/sender";
vi.mock("~/server/auth", () => ({ auth: async () => null }));
const mail = vi.hoisted(() => ({
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
  available: true,
}));
vi.mock("~/server/email/sender", () => ({
  emailSender: { send: mail.send },
  isEmailConfigured: () => true,
  isEmailDeliveryAvailable: () => mail.available,
}));
import { db } from "~/server/db";
import { createCaller } from "~/server/api/root";
import { hashPassword } from "./password";
import { hashCode } from "./registration";
import {
  requestSecondaryEmail,
  confirmSecondaryEmail,
  manageSecondaryEmail,
} from "./account-emails";
import { verifySigninPassword } from "./credentials";
import { issuePasswordReset, resetPassword } from "./password-reset";
import { requestEmailChange, confirmEmailChange } from "./email-change";
import { deliverNotifications } from "~/server/email/notification-delivery";

const password = "EmailTestPassword123!";
let userId = "";
let adminId = "";
let serial = 0;
const caller = (id = userId, role: Session["role"] = "VIEWER") =>
  createCaller({
    db,
    headers: new Headers(),
    session: {
      user: { id, email: `${id}@example.test`, name: "Email Test" },
      role,
      tutorId: null,
      expires: "2099-01-01",
    },
  });
const secondary = () => `${userId}-secondary@example.test`;
const lastCode = () =>
  /code is ([A-Z0-9]+)/.exec(mail.send.mock.calls.at(-1)?.[0].text ?? "")![1]!;
async function verifiedAlias() {
  await requestSecondaryEmail(userId, secondary(), password);
  expect(await confirmSecondaryEmail(userId, secondary(), lastCode())).toBe(
    true,
  );
}

beforeEach(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/shbs_shipping_test"
  )
    throw new Error("Use the isolated local shbs_shipping_test database.");
  userId = `email54-${++serial}`;
  adminId = `${userId}-admin`;
  mail.available = true;
  mail.send.mockReset().mockResolvedValue(undefined);
  await db.emailDelivery.deleteMany();
  await db.programSettings.upsert({
    where: { id: "program" },
    create: { id: "program", emailNotificationsEnabled: true },
    update: { emailNotificationsEnabled: true },
  });
  await db.user.createMany({
    data: [
      {
        id: userId,
        email: `${userId}@example.test`,
        username: userId,
        name: "Original",
        role: "VIEWER",
        passwordHash: hashPassword(password),
        emailVerifiedAt: new Date(),
      },
      {
        id: adminId,
        email: `${adminId}@example.test`,
        role: "ADMIN",
        emailVerifiedAt: new Date(),
      },
    ],
  });
});
afterAll(async () => {
  await db.user.deleteMany({ where: { id: { startsWith: "email54-" } } });
  await db.$disconnect();
});

it("requires proof before secondary sign-in; case-normalized aliases resolve the same account", async () => {
  await requestSecondaryEmail(
    userId,
    `  ${secondary().toUpperCase()}  `,
    password,
  );
  expect((await verifySigninPassword(secondary(), password, userId)).ok).toBe(
    false,
  );
  expect(await confirmSecondaryEmail(userId, secondary(), lastCode())).toBe(
    true,
  );
  expect(
    await verifySigninPassword(secondary().toUpperCase(), password, userId),
  ).toMatchObject({ ok: true, user: { id: userId } });
  expect(await confirmSecondaryEmail(userId, secondary(), lastCode())).toBe(
    false,
  );
});

it("rejects wrong passwords, cross-account ownership, primary deletion, and unverified promotion", async () => {
  await expect(
    requestSecondaryEmail(userId, secondary(), "wrong"),
  ).rejects.toThrow("password");
  await expect(
    requestSecondaryEmail(userId, `${adminId}@example.test`, password),
  ).rejects.toThrow("unavailable");
  await requestSecondaryEmail(userId, secondary(), password);
  await expect(
    manageSecondaryEmail(userId, secondary(), password, "primary"),
  ).rejects.toThrow("Verify");
  await expect(
    manageSecondaryEmail(userId, `${userId}@example.test`, password, "remove"),
  ).rejects.toThrow("primary");
  expect(await confirmSecondaryEmail(adminId, secondary(), lastCode())).toBe(
    false,
  );
});

it("enforces expired codes, attempt limits, and resend cooldown", async () => {
  await requestSecondaryEmail(userId, secondary(), password);
  const code = lastCode();
  await expect(
    requestSecondaryEmail(userId, secondary(), password),
  ).rejects.toThrow("one minute");
  for (let i = 0; i < 5; i++)
    expect(await confirmSecondaryEmail(userId, secondary(), "WRONG")).toBe(
      false,
    );
  expect(await confirmSecondaryEmail(userId, secondary(), code)).toBe(false);
  await db.emailVerificationCode.updateMany({
    where: { userId },
    data: { attempts: 0, expiresAt: new Date(0) },
  });
  expect(await confirmSecondaryEmail(userId, secondary(), code)).toBe(false);
});

it("supersedes old verification codes on resend and cancels pending ownership", async () => {
  await requestSecondaryEmail(userId, secondary(), password);
  await db.emailVerificationCode.updateMany({
    where: { userId },
    data: { createdAt: new Date(0), codeHash: hashCode("AAAAA") },
  });
  await requestSecondaryEmail(userId, secondary(), password);
  expect(await confirmSecondaryEmail(userId, secondary(), "AAAAA")).toBe(false);
  const code = lastCode();
  await manageSecondaryEmail(userId, secondary(), password, "remove");
  expect(await confirmSecondaryEmail(userId, secondary(), code)).toBe(false);
  expect(await db.emailDelivery.count({ where: { userId } })).toBe(0);
});

it("allows only one concurrent confirmation and preserves one primary under concurrent promotion", async () => {
  await requestSecondaryEmail(userId, secondary(), password);
  const code = lastCode();
  const results = await Promise.all([
    confirmSecondaryEmail(userId, secondary(), code),
    confirmSecondaryEmail(userId, secondary(), code),
  ]);
  expect(results.sort()).toEqual([false, true]);
  await Promise.all([
    manageSecondaryEmail(userId, secondary(), password, "primary"),
    manageSecondaryEmail(userId, secondary(), password, "primary"),
  ]);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } })).email,
  ).toBe(secondary());
  expect(
    await db.emailDelivery.count({
      where: { userId, event: "primary_changed" },
    }),
  ).toBe(2);
});

it("reserves aliases against every primary-account creation path, including a concurrent claim", async () => {
  await verifiedAlias();
  await expect(
    db.user.create({ data: { email: secondary().toUpperCase() } }),
  ).rejects.toThrow();
  const contested = `${userId}-race@example.test`;
  const results = await Promise.allSettled([
    requestSecondaryEmail(userId, contested, password),
    db.user.create({ data: { id: `${userId}-race`, email: contested } }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});

it("caps secondary addresses at five and rejects unrelated roster contacts", async () => {
  await db.accountEmail.createMany({
    data: Array.from({ length: 5 }, (_, i) => ({
      userId,
      email: `${userId}-${i}@example.test`,
      verifiedAt: new Date(),
    })),
  });
  await expect(
    requestSecondaryEmail(userId, secondary(), password),
  ).rejects.toThrow("five");
  const tutor = await db.tutor.create({
    data: {
      email: `${userId}-roster@example.test`,
      englishName: "Unlinked roster",
    },
  });
  await expect(
    requestSecondaryEmail(userId, tutor.email!, password),
  ).rejects.toThrow("unavailable");
  await db.tutor.delete({ where: { id: tutor.id } });
});

it("promotes verified aliases, keeps the former primary, and synchronizes only explicit links", async () => {
  const tutor = await db.tutor.create({
    data: { email: `${userId}@example.test`, englishName: "Linked" },
  });
  const student = await db.tutee.create({
    data: {
      email: `${userId}@example.test`,
      englishName: "Linked",
      signatureName: "Historical signature",
    },
  });
  await db.user.update({
    where: { id: userId },
    data: { tutorId: tutor.id, studentId: student.id },
  });
  await verifiedAlias();
  await manageSecondaryEmail(userId, secondary(), password, "primary");
  const account = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { emails: true, tutor: true, student: true },
  });
  expect(account.emails).toHaveLength(2);
  expect(account.role).toBe("VIEWER");
  expect(account.tutor?.email).toBe(secondary());
  expect(account.student?.email).toBe(secondary());
  expect(account.student?.signatureName).toBe("Historical signature");
  await db.user.update({
    where: { id: userId },
    data: { tutorId: null, studentId: null },
  });
  await db.tutor.delete({ where: { id: tutor.id } });
  await db.tutee.delete({ where: { id: student.id } });
});

it("retains verified replacement compatibility and rejects reuse", async () => {
  await requestEmailChange(userId, secondary(), password);
  expect(await confirmEmailChange(userId, lastCode())).toBe(true);
  expect(await confirmEmailChange(userId, lastCode())).toBe(false);
  expect(await db.accountEmail.count({ where: { userId } })).toBe(2);
});

it("recovers through secondary email without claiming proof of an unrelated primary", async () => {
  await verifiedAlias();
  await db.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: null },
  });
  await issuePasswordReset(secondary());
  expect(mail.send.mock.calls.at(-1)?.[0].to).toBe(secondary());
  const token = /token=([a-f0-9]+)/.exec(
    mail.send.mock.calls.at(-1)?.[0].text ?? "",
  )![1]!;
  const results = await Promise.all([
    resetPassword(token, "NewPassword123!"),
    resetPassword(token, "NewPassword123!"),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } }))
      .emailVerifiedAt,
  ).toBeNull();
});

it("revokes removed-address sign-in, reset grants, and pending challenges, even after re-addition", async () => {
  await verifiedAlias();
  await issuePasswordReset(secondary());
  const token = /token=([a-f0-9]+)/.exec(
    mail.send.mock.calls.at(-1)?.[0].text ?? "",
  )![1]!;
  await manageSecondaryEmail(userId, secondary(), password, "remove");
  expect((await verifySigninPassword(secondary(), password, userId)).ok).toBe(
    false,
  );
  await db.accountEmail.create({
    data: { userId, email: secondary(), verifiedAt: new Date() },
  });
  expect(await resetPassword(token, "OtherPassword123!")).toBeNull();
});

it("admin enablement and personal categories gate notifications without affecting essential mail", async () => {
  await caller(adminId, "ADMIN").program.setEmailNotifications({
    enabled: false,
    expectedEnabled: true,
  });
  await expect(
    caller().account.setEmailPreferences({
      emailSecurity: true,
      emailMessages: true,
      emailInfo: true,
      emailSecondaryRecipients: false,
    }),
  ).rejects.toThrow("disabled");
  await verifiedAlias();
  expect(mail.send).toHaveBeenCalledTimes(1);
  expect(await db.emailDelivery.count({ where: { userId } })).toBe(0);
  await expect(
    caller().program.setEmailNotifications({
      enabled: true,
      expectedEnabled: false,
    }),
  ).rejects.toThrow();
  await caller(adminId, "ADMIN").program.setEmailNotifications({
    enabled: true,
    expectedEnabled: false,
  });
  await caller().account.setEmailPreferences({
    emailSecurity: false,
    emailMessages: true,
    emailInfo: true,
    emailSecondaryRecipients: true,
  });
  await db.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });
  expect(await db.emailDelivery.count({ where: { userId } })).toBe(0);
  await db.notification.create({
    data: { userId, title: "Hidden private content", link: "/messages" },
  });
  await caller().account.updateName({ name: "Updated" });
  await deliverNotifications();
  expect(mail.send).toHaveBeenCalledTimes(5);
  expect(
    mail.send.mock.calls
      .slice(1)
      .every(([m]) => !String(m.text).includes("Hidden private content")),
  ).toBe(true);
});

it("ignores no-op writes and rolls back notification events with failed changes", async () => {
  await db.user.update({ where: { id: userId }, data: { emailInfo: true } });
  await db.user.update({
    where: { id: userId },
    data: { name: "Original", twoFactorEnabled: false },
  });
  await expect(
    db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { name: "Rolled back" },
      });
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(await db.emailDelivery.count({ where: { userId } })).toBe(0);
});

it("notifies both primary addresses and drops ordinary notices to removed secondary addresses", async () => {
  await verifiedAlias();
  await db.emailDelivery.deleteMany();
  await manageSecondaryEmail(userId, secondary(), password, "primary");
  await manageSecondaryEmail(
    userId,
    `${userId}@example.test`,
    password,
    "remove",
  );
  await deliverNotifications();
  const notices = mail.send.mock.calls.filter(([m]) =>
    m.subject.includes("primary"),
  );
  expect(new Set(notices.map(([m]) => m.to))).toEqual(
    new Set([`${userId}@example.test`, secondary()]),
  );
});

it("rechecks preferences at dispatch and preserves them when the admin disables and re-enables", async () => {
  await db.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });
  await caller().account.setEmailPreferences({
    emailSecurity: false,
    emailMessages: true,
    emailInfo: true,
    emailSecondaryRecipients: true,
  });
  await deliverNotifications();
  expect(mail.send).not.toHaveBeenCalled();
  await caller(adminId, "ADMIN").program.setEmailNotifications({
    enabled: false,
    expectedEnabled: true,
  });
  await caller(adminId, "ADMIN").program.setEmailNotifications({
    enabled: true,
    expectedEnabled: false,
  });
  expect(await caller().account.emailSettings()).toMatchObject({
    emailSecurity: false,
    emailMessages: true,
    emailInfo: true,
    emailSecondaryRecipients: true,
  });
});

it("retries delivery without duplicate concurrent sends or rolling back an account change", async () => {
  await db.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });
  mail.send.mockRejectedValueOnce(new Error("private SMTP diagnostic"));
  await deliverNotifications();
  let row = await db.emailDelivery.findFirstOrThrow({ where: { userId } });
  expect(row).toMatchObject({ status: "PENDING", attempts: 1 });
  expect(row.lastError).not.toContain("private");
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: userId } }))
      .twoFactorEnabled,
  ).toBe(true);
  await db.emailDelivery.update({
    where: { id: row.id },
    data: { availableAt: new Date(0) },
  });
  await Promise.all([deliverNotifications(), deliverNotifications()]);
  row = await db.emailDelivery.findUniqueOrThrow({ where: { id: row.id } });
  expect(row.status).toBe("SENT");
  expect(mail.send).toHaveBeenCalledTimes(2);
});

it("password rotation invalidates pending address verification and recovery grants", async () => {
  await requestSecondaryEmail(userId, secondary(), password);
  const code = lastCode();
  await issuePasswordReset(`${userId}@example.test`);
  const token = /token=([a-f0-9]+)/.exec(
    mail.send.mock.calls.at(-1)?.[0].text ?? "",
  )![1]!;
  await caller().account.changePassword({
    currentPassword: password,
    newPassword: "RotatedPassword123!",
  });
  expect(await confirmSecondaryEmail(userId, secondary(), code)).toBe(false);
  expect(await resetPassword(token, "AnotherPassword123!")).toBeNull();
});

it("a pending address cannot recover an account, and essential delivery outages fail closed", async () => {
  await requestSecondaryEmail(userId, secondary(), password);
  mail.send.mockClear();
  await issuePasswordReset(secondary());
  expect(mail.send).not.toHaveBeenCalled();
  mail.available = false;
  await expect(
    requestSecondaryEmail(userId, `${userId}-other@example.test`, password),
  ).rejects.toThrow("unavailable");
  await issuePasswordReset(`${userId}@example.test`);
  expect(mail.send).not.toHaveBeenCalled();
});

it("replacing an unverified primary permanently revokes its recovery grants", async () => {
  const previous = `${userId}@example.test`;
  await db.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: null },
  });
  await issuePasswordReset(previous);
  const token = /token=([a-f0-9]+)/.exec(
    mail.send.mock.calls.at(-1)?.[0].text ?? "",
  )![1]!;
  await requestEmailChange(userId, secondary(), password);
  expect(await confirmEmailChange(userId, lastCode())).toBe(true);
  await db.accountEmail.create({
    data: { userId, email: previous, verifiedAt: new Date() },
  });
  expect(await resetPassword(token, "ReplacementPassword123!")).toBeNull();
});

it("rechecks secondary recipients and stops retries after five failures", async () => {
  await verifiedAlias();
  await db.emailDelivery.deleteMany();
  await db.user.update({
    where: { id: userId },
    data: { emailSecondaryRecipients: true, twoFactorEnabled: true },
  });
  await manageSecondaryEmail(userId, secondary(), password, "remove");
  mail.send.mockClear().mockRejectedValue(new Error("SMTP unavailable"));
  for (let attempt = 0; attempt < 5; attempt++) {
    await db.emailDelivery.updateMany({
      where: { status: "PENDING" },
      data: { availableAt: new Date(0) },
    });
    await deliverNotifications();
  }
  expect(
    mail.send.mock.calls.some(([message]) => message.to === secondary()),
  ).toBe(false);
  expect(
    await db.emailDelivery.count({ where: { status: "FAILED", userId } }),
  ).toBe(2);
  expect(
    await db.emailDelivery.count({ where: { status: "PENDING", userId } }),
  ).toBe(0);
});
