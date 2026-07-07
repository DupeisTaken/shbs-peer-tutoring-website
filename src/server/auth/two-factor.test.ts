import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "~/server/email/sender";

const send = vi.hoisted(() =>
  vi
    .fn<(message: EmailMessage) => Promise<void>>()
    .mockResolvedValue(undefined),
);

vi.mock("~/server/email/sender", () => ({
  emailSender: { send },
}));

import { db } from "~/server/db";
import { REG_CODE_LENGTH } from "./code";
import {
  issueLoginCode,
  MAX_CODE_ATTEMPTS,
  verifyLoginCode,
} from "./two-factor";

const USER_ID = "test-login-2fa-user";
const EMAIL = "login-2fa@example.com";

function extractCode(): string {
  const message = send.mock.calls.at(-1)?.[0];
  const code = message?.text.match(/[2-9A-HJ-KMNP-Z]{5}/)?.[0];
  if (!code) throw new Error("expected an emailed login code");
  return code;
}

async function cleanup() {
  await db.emailVerificationCode.deleteMany({ where: { userId: USER_ID } });
  await db.user.deleteMany({ where: { id: USER_ID } });
}

beforeEach(async () => {
  send.mockClear();
  await cleanup();
  await db.user.create({
    data: {
      id: USER_ID,
      email: EMAIL,
      name: "Login 2FA User",
      twoFactorEnabled: true,
    },
  });
});

afterAll(async () => {
  await cleanup();
});

describe("login 2FA codes", () => {
  it("emails a hashed, single-use login code", async () => {
    const result = await issueLoginCode(USER_ID);
    const code = extractCode();

    expect(result.email).toBe(EMAIL);
    expect(code).toHaveLength(REG_CODE_LENGTH);
    expect(send).toHaveBeenCalledTimes(1);

    const row = await db.emailVerificationCode.findFirstOrThrow({
      where: { userId: USER_ID, purpose: "LOGIN_2FA" },
    });
    expect(row.codeHash).not.toContain(code);
    expect(row.consumedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());

    await expect(verifyLoginCode(USER_ID, code.toLowerCase())).resolves.toBe(
      true,
    );
    await expect(verifyLoginCode(USER_ID, code)).resolves.toBe(false);

    const consumed = await db.emailVerificationCode.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(consumed.consumedAt).toBeInstanceOf(Date);
  });

  it("rejects a code after the attempt cap", async () => {
    await issueLoginCode(USER_ID);
    const code = extractCode();
    const wrong = code === "AAAAA" ? "BBBBB" : "AAAAA";

    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      await expect(verifyLoginCode(USER_ID, wrong)).resolves.toBe(false);
    }
    await expect(verifyLoginCode(USER_ID, code)).resolves.toBe(false);

    const row = await db.emailVerificationCode.findFirstOrThrow({
      where: { userId: USER_ID, purpose: "LOGIN_2FA" },
    });
    expect(row.attempts).toBe(MAX_CODE_ATTEMPTS);
    expect(row.consumedAt).toBeNull();
  });
});
