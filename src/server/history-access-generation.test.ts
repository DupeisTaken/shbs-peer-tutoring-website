import { expect, it, vi } from "vitest";
import type { DomainDb } from "./transactions";
import { assertHistoryAccessGeneration } from "./history-access-generation";

function fixture() {
  const account = { historyAccessRevision: 7, mergedIntoId: null as string | null, recoveryVoidedAt: null as Date | null };
  const find = vi.fn().mockResolvedValue(account);
  return { account, find, db: { user: { findUnique: find } } as unknown as DomainDb };
}

it("permits an unchanged fresh generation without writing or acquiring locks", async () => {
  const { db, find } = fixture();
  await expect(assertHistoryAccessGeneration(db, { userId: "reader", historyAccessRevision: 7 })).resolves.toBeUndefined();
  expect(find).toHaveBeenCalledOnce();
  expect(find).toHaveBeenCalledWith({ where: { id: "reader" }, select: { historyAccessRevision: true, mergedIntoId: true, recoveryVoidedAt: true } });
});

it.each([8, 9, 6])("rejects a query when the final history generation is %s", async (revision) => {
  const { db, account } = fixture();
  account.historyAccessRevision = revision;
  await expect(assertHistoryAccessGeneration(db, { userId: "reader", historyAccessRevision: 7 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("does not return private results after a delayed query overlaps A-to-B-to-A access changes", async () => {
  const { db, account } = fixture();
  let finish!: (value: string) => void;
  const read = new Promise<string>((resolve) => { finish = resolve; });
  const query = async () => {
    const privateResult = await read;
    await assertHistoryAccessGeneration(db, { userId: "reader", historyAccessRevision: 7 });
    return privateResult;
  };
  const pending = query();
  account.historyAccessRevision += 2;
  finish("Synthetic original private evidence");
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it.each(["missing", "retired", "voided"] as const)("rejects a %s reader even if its numeric generation matches", async (state) => {
  const { db, find, account } = fixture();
  if (state === "missing") find.mockResolvedValue(null);
  if (state === "retired") account.mergedIntoId = "survivor";
  if (state === "voided") account.recoveryVoidedAt = new Date("2026-11-03T00:00:00Z");
  await expect(assertHistoryAccessGeneration(db, { userId: "reader", historyAccessRevision: 7 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it.each([-1, NaN, 1.5])("rejects invalid preauthorization generation %s", async (historyAccessRevision) => {
  const { db } = fixture();
  await expect(assertHistoryAccessGeneration(db, { userId: "reader", historyAccessRevision })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("propagates database failures without treating an unverified response as current", async () => {
  const { db, find } = fixture();
  const failure = new Error("Synthetic unavailable database");
  find.mockRejectedValue(failure);
  await expect(assertHistoryAccessGeneration(db, { userId: "reader", historyAccessRevision: 7 })).rejects.toBe(failure);
});
