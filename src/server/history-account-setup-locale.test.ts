import { beforeEach, expect, it, vi } from "vitest";
import type { DomainDb } from "~/server/transactions";
import type { EmailMessage } from "~/server/email/sender";

const fixture = vi.hoisted(() => ({
  exact: vi.fn(),
  send: vi.fn<(message: EmailMessage) => Promise<void>>(),
  user: { findUnique: vi.fn() },
  historicalRecordInvitation: { update: vi.fn() },
}));
vi.mock("~/server/auth", () => ({ auth: async () => null }));
vi.mock("./transactions", () => ({
  inTransaction: async (_db: unknown, work: (tx: unknown) => unknown) =>
    work(fixture),
  lockEntity: async () => undefined,
}));
vi.mock("./auth/username", () => ({
  lockUsernameNamespace: async () => undefined,
}));
vi.mock("./auth/registration", () => ({
  hashCode: (code: string) => `hashed-${code}`,
  freshEmailCode: () => "0012",
  registrationCompletionProof: () => "unused-locale-test",
}));
vi.mock("./email/sender", () => ({
  emailSender: { send: fixture.send },
  isEmailDeliveryAvailable: () => true,
}));
vi.mock("./tutee-history", () => ({
  historyTokenDigest: () => "synthetic-digest",
}));
vi.mock("./exact-history-invitations", () => ({
  exactSetupInvitation: fixture.exact,
  bindExactHistoryRecipient: vi.fn(),
}));
import { startHistoryAccount } from "./history-account-setup";

const invite = {
  scopeKey: "reviewed-scope",
  email: "bound@example.test",
  recipientId: "reviewed-recipient",
  setupUserId: null,
  setupCodeHash: null,
  setupCodeExpiresAt: null,
  emailLocale: "en",
};
beforeEach(() => {
  fixture.exact.mockReset().mockResolvedValue({
    kind: "EXACT",
    invite: { ...invite },
    record: { englishName: "Synthetic history" },
  });
  fixture.send.mockReset().mockResolvedValue(undefined);
  fixture.user.findUnique.mockReset().mockResolvedValue({ emailLocale: "zh" });
  fixture.historicalRecordInvitation.update.mockReset().mockResolvedValue({});
});
const client = fixture as unknown as DomainDb;

it("uses the established exact recipient's current preference before first-code page language", async () => {
  await startHistoryAccount(
    client,
    { token: "synthetic-token", email: invite.email },
    "en",
  );
  expect(fixture.user.findUnique).toHaveBeenCalledWith({
    where: { id: invite.recipientId },
    select: { emailLocale: true },
  });
  expect(fixture.send.mock.lastCall![0].presentation?.locale).toBe("zh");
  expect(fixture.send.mock.lastCall![0].subject).toBe("验证历史记录访问");
  expect(
    fixture.historicalRecordInvitation.update.mock.lastCall![0],
  ).toMatchObject({
    where: { scopeKey: invite.scopeKey },
    data: { emailLocale: "zh", setupCodeHash: "hashed-0012" },
  });
});

it("honors a changed account preference without reusing the invitation's older language", async () => {
  fixture.user.findUnique.mockResolvedValue({ emailLocale: "en" });
  fixture.exact.mockResolvedValue({
    kind: "EXACT",
    invite: { ...invite, emailLocale: "zh" },
    record: { englishName: "Synthetic history" },
  });
  await startHistoryAccount(
    client,
    { token: "synthetic-token", email: invite.email },
    "zh",
  );
  expect(fixture.send.mock.lastCall![0].presentation?.locale).toBe("en");
  expect(fixture.send.mock.lastCall![0].subject).toBe(
    "Verify historical access",
  );
});

it("keeps accountless first requests and resends source-bound without searching by address", async () => {
  fixture.exact.mockResolvedValue({
    kind: "EXACT",
    invite: { ...invite, recipientId: null },
    record: { englishName: "Synthetic history" },
  });
  await startHistoryAccount(
    client,
    { token: "synthetic-token", email: invite.email },
    "zh",
  );
  expect(fixture.send.mock.lastCall![0].presentation?.locale).toBe("zh");
  fixture.exact.mockResolvedValue({
    kind: "EXACT",
    invite: {
      ...invite,
      recipientId: null,
      setupCodeHash: "old-code",
      emailLocale: "zh",
    },
    record: { englishName: "Synthetic history" },
  });
  await startHistoryAccount(
    client,
    { token: "synthetic-token", email: invite.email },
    "en",
  );
  expect(fixture.send.mock.lastCall![0].presentation?.locale).toBe("zh");
  expect(fixture.user.findUnique).not.toHaveBeenCalled();
});
