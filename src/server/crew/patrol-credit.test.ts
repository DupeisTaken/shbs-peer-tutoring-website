import { expect, it, vi } from "vitest";
import type { TransactionDb } from "~/server/transactions";
import { eligiblePatrolCredit, isRecentPatrol, patrolEvidenceWindows } from "./patrol-credit";

const observation = (instant: string) => ({ observedAt: new Date(instant) });
it("normalizes equivalent instants, ignores ordering, and reserves every observed interval", () => {
  expect(patrolEvidenceWindows([
    observation("2026-09-01T16:20:00+08:00"), observation("2026-09-01T08:19:59.999Z"),
    observation("2026-09-01T08:20:00Z"),
  ]).map((date) => date.toISOString())).toEqual(["2026-09-01T08:00:00.000Z", "2026-09-01T08:20:00.000Z"]);
});
it("accepts only recent sweeps for automatic credit; historical/invalid evidence earns none", () => {
  const now = new Date("2026-09-01T08:20:00Z");
  expect(isRecentPatrol([observation("2026-09-01T08:00:00Z"), observation("2026-09-01T08:21:00Z")], now)).toBe(true);
  expect(isRecentPatrol([observation("2026-09-01T07:59:59.999Z"), { observedAt: now }], now)).toBe(false);
  expect(isRecentPatrol([observation("2026-09-01T08:21:00.001Z")], now)).toBe(false);
  expect(isRecentPatrol([], now)).toBe(false);
  expect(isRecentPatrol([observation("invalid")], now)).toBe(false);
});
it("does not let a fixed interval boundary bypass the rolling server-time cooldown", async () => {
  const latest = vi.fn().mockResolvedValue({ creditAwardedAt: new Date("2026-09-01T08:19:59Z") });
  const claim = vi.fn().mockResolvedValue(null);
  const tx = { patrol: { findFirst: latest }, patrolCreditWindow: { findFirst: claim } } as unknown as TransactionDb;
  const now = new Date("2026-09-01T08:20:00Z");
  expect(await eligiblePatrolCredit(tx, ["live", "retired"], [{ observedAt: now }], now)).toBe(false);
  expect(claim).not.toHaveBeenCalled();
  const later = new Date("2026-09-01T08:39:59Z");
  expect(await eligiblePatrolCredit(tx, ["live", "retired"], [{ observedAt: later }], later)).toBe(true);
  expect(latest).toHaveBeenLastCalledWith({
    where: { crewUserId: { in: ["live", "retired"] }, creditAwardedAt: { not: null } },
    orderBy: { creditAwardedAt: "desc" }, select: { creditAwardedAt: true },
  });
  claim.mockResolvedValue({ patrolId: "old" });
  expect(await eligiblePatrolCredit(tx, ["live", "retired"], [{ observedAt: later }], later)).toBe(false);
});
