import { beforeEach, expect, it, vi } from "vitest";
const signOut = vi.hoisted(() => vi.fn());
vi.mock("~/server/auth", () => ({ signOut }));
import { switchHistoryAccount } from "./actions";
beforeEach(() => vi.clearAllMocks());
it("preserves the exact history invitation on explicit account switching", async () => {
  const token = "a".repeat(64);
  await switchHistoryAccount(token);
  expect(signOut).toHaveBeenCalledWith({
    redirectTo: `/history/claim?token=${token}`,
  });
});
it.each(["", "https://evil.test", "x&callbackUrl=//evil.test"])(
  "rejects arbitrary redirect content %s",
  async (token) => {
    await switchHistoryAccount(token);
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/history/claim" });
  },
);
