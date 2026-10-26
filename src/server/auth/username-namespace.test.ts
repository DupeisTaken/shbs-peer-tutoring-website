import { expect, it, vi } from "vitest";
import type { TransactionDb } from "../transactions";
import { lockUsernameNamespace } from "./username-namespace";
import { UsernameSnapshotConflict } from "./username-snapshot";

function transaction() {
  const execute = vi.fn<(query: TemplateStringsArray, ...values: unknown[]) => Promise<number>>()
    .mockResolvedValue(1);
  return { execute, tx: { $executeRaw: execute } as unknown as TransactionDb };
}

it("locks the shared namespace before advancing its durable snapshot fence", async () => {
  const { execute, tx } = transaction();
  await lockUsernameNamespace(tx);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]![0].join("?")).toContain("pg_advisory_xact_lock");
  expect(execute.mock.calls[0]![1]).toBe("identity:username-namespace");
  expect(execute.mock.calls[1]![0].join("?")).toContain('INSERT INTO "UsernameNamespaceGuard"');
  expect(execute.mock.calls[1]![0].join("?")).toContain('"UsernameNamespaceGuard".revision + 1');
});

it("wraps only fence serialization failures and preserves the original cause", async () => {
  const { execute, tx } = transaction();
  const cause = { meta: { driverAdapterError: { cause: { originalCode: "40001" } } } };
  execute.mockResolvedValueOnce(1).mockRejectedValueOnce(cause);
  const result = lockUsernameNamespace(tx);
  await expect(result).rejects.toBeInstanceOf(UsernameSnapshotConflict);
  await expect(result).rejects.toMatchObject({ cause });
  expect(execute).toHaveBeenCalledTimes(2);
});

it("does not relabel advisory-lock failures or other fence errors as safe retries", async () => {
  for (const duringFence of [false, true]) {
    const { execute, tx } = transaction();
    const cause = { code: duringFence ? "42501" : "40001" };
    if (duringFence) execute.mockResolvedValueOnce(1);
    execute.mockRejectedValueOnce(cause);
    await expect(lockUsernameNamespace(tx)).rejects.toBe(cause);
    expect(execute).toHaveBeenCalledTimes(duringFence ? 2 : 1);
  }
});
