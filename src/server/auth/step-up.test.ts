import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "~/server/email/sender";

const send = vi.hoisted(() =>
  vi
    .fn<(message: EmailMessage) => Promise<void>>()
    .mockResolvedValue(undefined),
);

vi.mock("~/server/email/sender", () => ({
  emailSender: { send },
  isEmailDeliveryAvailable: () => true,
}));

import { db } from "~/server/db";
import { issueStepUpCode, verifyStepUpCode } from "./step-up";

const USER_ID = "test-step-up-user";

function extractCode(): string {
  const message = send.mock.calls.at(-1)?.[0];
  const code = message?.text.match(/[2-9A-HJ-KMNP-Z]{5}/)?.[0];
  if (!code) throw new Error("expected an emailed step-up code");
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
    data: { id: USER_ID, email: "step-up@example.com", name: "Step-up User" },
  });
});

afterAll(cleanup);

describe("step-up verification codes", () => {
  it("allows exactly one concurrent consumer", async () => {
    await issueStepUpCode(USER_ID, "PASSWORD_CHANGE");
    const code = extractCode();

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        verifyStepUpCode(USER_ID, "PASSWORD_CHANGE", code),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("invalidates an older code when a replacement is issued", async () => {
    await issueStepUpCode(USER_ID, "PASSWORD_CHANGE");
    const oldCode = extractCode();
    await issueStepUpCode(USER_ID, "PASSWORD_CHANGE");
    const newCode = extractCode();

    await expect(
      verifyStepUpCode(USER_ID, "PASSWORD_CHANGE", oldCode),
    ).resolves.toEqual({
      ok: false,
      error: "incorrect",
    });
    await expect(
      verifyStepUpCode(USER_ID, "PASSWORD_CHANGE", newCode),
    ).resolves.toEqual({
      ok: true,
    });
  });
});
