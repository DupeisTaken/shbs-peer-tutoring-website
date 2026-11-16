import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterCommitScope, flushCommittedEffects } from "~/server/db-scope";

const transport = vi.hoisted(() => ({ send: vi.fn(), configured: true }));
vi.mock("./sender", () => ({
  emailSender: { send: transport.send },
  isEmailConfigured: () => transport.configured,
}));
import { sendEmailWithReceipt } from "./direct-delivery";

const message = {
  category: "SECURITY" as const,
  to: "recipient@example.test",
  subject: "Synthetic verification",
  text: "Synthetic verification body",
};
const queue = () => ({
  effects: [] as Array<() => Promise<void>>,
  committed: false,
  onFailure: vi.fn(async () => undefined),
});

beforeEach(() => {
  transport.configured = true;
  transport.send.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("direct email acceptance receipts", () => {
  it("keeps queued mail false and settles the same receipt only after commit", async () => {
    const effects = queue();
    const receipt = { emailed: false };
    await afterCommitScope.run(effects, async () => {
      await sendEmailWithReceipt(message, receipt);
      expect(receipt.emailed).toBe(false);
      expect(transport.send).not.toHaveBeenCalled();
      await flushCommittedEffects();
      await flushCommittedEffects();
    });
    expect(receipt.emailed).toBe(true);
    expect(transport.send).toHaveBeenCalledExactlyOnceWith(message);
  });

  it("retains false and delegates a rejected deferred send to the audit owner", async () => {
    transport.send.mockRejectedValueOnce(new Error("Synthetic delivery failure"));
    const effects = queue();
    const receipt = { emailed: false };
    await afterCommitScope.run(effects, async () => {
      await sendEmailWithReceipt(message, receipt);
      await flushCommittedEffects();
    });
    expect(receipt.emailed).toBe(false);
    expect(effects.onFailure).toHaveBeenCalledOnce();
  });

  it("preserves synchronous failure outside an audit transaction", async () => {
    transport.send.mockRejectedValueOnce(new Error("Synthetic delivery failure"));
    const receipt = { emailed: false };
    await expect(sendEmailWithReceipt(message, receipt)).rejects.toThrow("Synthetic delivery failure");
    expect(receipt.emailed).toBe(false);
  });

  it("never reports a local development log as accepted SMTP", async () => {
    transport.configured = false;
    const receipt = { emailed: false };
    await sendEmailWithReceipt(message, receipt);
    expect(receipt.emailed).toBe(false);
  });
});
