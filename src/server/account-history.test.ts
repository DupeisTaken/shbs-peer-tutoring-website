import { expect, it, vi } from "vitest";
import { accountHistoryIds, accountHistoryReaderId, accountRetirementFamilyIds } from "./account-history";
import { accountPolicyIds, findAccountPolicy } from "./policy-acceptance";
import { eligiblePatrolCredit, lockPatrolCreditOwner } from "./crew/patrol-credit";
import type { TransactionDb } from "./transactions";

type User = { id: string; mergedIntoId: string | null; recoveryVoidedAt?: Date | null };
type Ownership = { sourceUserId: string; readerUserId: string | null; state: string; revision: number };
type UserFilter = { where: { id?: { in: string[] }; mergedIntoId: { in?: string[]; not?: null }; recoveryVoidedAt?: null } };
type OwnershipFilter = { where: { readerUserId: string; state: string } };

/** Exercise graph semantics using persisted-row-shaped data, without a database. */
function fixture() {
  const users: User[] = [
    { id: "B", mergedIntoId: "A" }, { id: "A", mergedIntoId: "D" },
    { id: "D", mergedIntoId: null }, { id: "C", mergedIntoId: null },
    { id: "unrelated", mergedIntoId: null },
  ];
  const ownerships: Ownership[] = [
    { sourceUserId: "A", readerUserId: "D", state: "ASSIGNED", revision: 1 },
    { sourceUserId: "B", readerUserId: "D", state: "ASSIGNED", revision: 1 },
  ];
  const findUser = ({ where }: { where: { id: string } }) => users.find((row) => row.id === where.id) ?? null;
  const policy = vi.fn().mockResolvedValue(null);
  const latestPatrol = vi.fn().mockResolvedValue(null);
  const window = vi.fn().mockResolvedValue({ patrolId: "original-patrol" });
  const db = {
    user: {
      findUnique: vi.fn(async (input: { where: { id: string } }) => findUser(input)),
      findUniqueOrThrow: vi.fn(async (input: { where: { id: string } }) => {
        const row = findUser(input);
        if (!row) throw new Error("Missing synthetic account");
        return row;
      }),
      findMany: vi.fn(async ({ where }: UserFilter) => users.filter((row) =>
        (!where.id || where.id.in.includes(row.id)) &&
        (where.mergedIntoId.in ? row.mergedIntoId !== null && where.mergedIntoId.in.includes(row.mergedIntoId) : row.mergedIntoId !== null) &&
        (where.recoveryVoidedAt !== null || !row.recoveryVoidedAt),
      ).sort((a, b) => a.id.localeCompare(b.id))),
    },
    retiredHistoryOwnership: {
      findUnique: vi.fn(async ({ where }: { where: { sourceUserId: string } }) => ownerships.find((row) => row.sourceUserId === where.sourceUserId) ?? null),
      findMany: vi.fn(async ({ where }: OwnershipFilter) => ownerships.filter((row) => row.readerUserId === where.readerUserId && row.state === where.state)),
    },
    policyAcceptance: { findFirst: policy },
    patrol: { findFirst: latestPatrol }, patrolCreditWindow: { findFirst: window },
    $executeRaw: vi.fn().mockResolvedValue(0),
  };
  const assign = (sourceUserId: string, readerUserId: string | null, state = "ASSIGNED") => {
    const old = ownerships.find((row) => row.sourceUserId === sourceUserId);
    if (old) Object.assign(old, { readerUserId, state, revision: old.revision + 1 });
    else ownerships.push({ sourceUserId, readerUserId, state, revision: 1 });
  };
  return { tx: db as unknown as TransactionDb, users, ownerships, assign, policy, window };
}

it("reads exact terminal-reader backfill while withholding access to retired callers", async () => {
  const { tx } = fixture();
  expect(await accountHistoryIds(tx, "D")).toEqual(["D", "A", "B"]);
  expect(await accountHistoryReaderId(tx, "B")).toBe("D");
  expect(await accountHistoryIds(tx, "C")).toEqual(["C"]);
  expect(await accountHistoryIds(tx, "B")).toEqual([]);
});

it("fails closed when a retired original lacks its authoritative mapping", async () => {
  const { tx, ownerships } = fixture();
  ownerships.splice(0);
  expect(await accountHistoryIds(tx, "D")).toEqual(["D"]);
  expect(await accountHistoryReaderId(tx, "B")).toBeNull();
  expect(await accountRetirementFamilyIds(tx, "D")).toEqual(["D", "A", "B"]);
});

it("corrects only the selected retired original and preserves unrelated private history", async () => {
  const { tx, assign } = fixture();
  assign("B", "C");
  expect(await accountHistoryIds(tx, "D")).toEqual(["D", "A"]);
  expect(await accountHistoryIds(tx, "C")).toEqual(["C", "B"]);
  expect(await accountHistoryIds(tx, "unrelated")).toEqual(["unrelated"]);
  expect(await accountHistoryReaderId(tx, "B")).toBe("C");
  expect(await accountHistoryReaderId(tx, "A")).toBe("D");
});

it.each([
  [null, "QUARANTINED"], ["C", "QUARANTINED"], [null, "ASSIGNED"], ["C", "UNKNOWN"],
] as const)("withholds explicit %s/%s ownership without retirement fallback", async (reader, state) => {
  const { tx, assign } = fixture();
  assign("B", reader, state);
  expect(await accountHistoryReaderId(tx, "B")).toBeNull();
  expect(await accountHistoryIds(tx, "D")).toEqual(["D", "A"]);
  expect(await accountHistoryIds(tx, "C")).toEqual(["C"]);
});

it("requires retirement to retarget exact incoming mappings instead of traversing corrections", async () => {
  const { tx, assign, users } = fixture();
  assign("B", "C");
  users.find((row) => row.id === "C")!.mergedIntoId = "unrelated";
  expect(await accountHistoryReaderId(tx, "B")).toBeNull();
  expect(await accountHistoryIds(tx, "unrelated")).toEqual(["unrelated"]);
  assign("C", "unrelated");
  assign("B", "unrelated");
  expect(await accountHistoryReaderId(tx, "B")).toBe("unrelated");
  expect(await accountHistoryIds(tx, "unrelated")).toEqual(["unrelated", "B", "C"]);
  expect(await accountHistoryIds(tx, "D")).toEqual(["D", "A"]);
});

it("does not cache a corrected source through A-to-B-to-A review changes", async () => {
  const { tx, assign, ownerships } = fixture();
  assign("B", "D");
  expect(await accountHistoryReaderId(tx, "B")).toBe("D");
  assign("B", "C");
  expect(await accountHistoryIds(tx, "D")).toEqual(["D", "A"]);
  assign("B", "D");
  expect(await accountHistoryIds(tx, "D")).toEqual(["D", "A", "B"]);
  expect(await accountHistoryIds(tx, "C")).toEqual(["C"]);
  expect(ownerships.find((row) => row.sourceUserId === "B")?.revision).toBe(4);
});

it("corrects A independently without moving B whose immutable retirement once passed through A", async () => {
  const { tx, assign } = fixture();
  assign("A", "C");
  expect(await accountHistoryIds(tx, "D")).toEqual(["D", "B"]);
  expect(await accountHistoryIds(tx, "C")).toEqual(["C", "A"]);
  expect(await accountHistoryReaderId(tx, "B")).toBe("D");
});

it("fails closed on missing targets and effective ownership cycles", async () => {
  const { tx, assign } = fixture();
  assign("B", "missing");
  expect(await accountHistoryReaderId(tx, "B")).toBeNull();
  expect(await accountHistoryIds(tx, "missing")).toEqual([]);
  assign("B", "A");
  assign("A", "B");
  expect(await accountHistoryReaderId(tx, "B")).toBeNull();
  expect(await accountHistoryIds(tx, "D")).toEqual(["D"]);
});

it("does not let a malformed source assignment expose another live account", async () => {
  const { tx, assign } = fixture();
  assign("unrelated", "C");
  expect(await accountHistoryIds(tx, "C")).toEqual(["C"]);
  expect(await accountHistoryReaderId(tx, "unrelated")).toBe("unrelated");
});

it("withholds voided readers and originals without inventing another destination", async () => {
  const { tx, assign, users } = fixture();
  assign("B", "C");
  users.find((row) => row.id === "C")!.recoveryVoidedAt = new Date("2026-11-03T00:00:00Z");
  expect(await accountHistoryIds(tx, "C")).toEqual([]);
  expect(await accountHistoryReaderId(tx, "B")).toBeNull();
  users.find((row) => row.id === "A")!.recoveryVoidedAt = new Date("2026-11-03T00:00:00Z");
  expect(await accountHistoryIds(tx, "D")).toEqual(["D"]);
  expect(await accountHistoryReaderId(tx, "A")).toBeNull();
});

it("retains every original patrol claim after private history moves or is quarantined", async () => {
  const { tx, assign, window } = fixture();
  assign("B", "C");
  expect(await accountRetirementFamilyIds(tx, "D")).toEqual(["D", "A", "B"]);
  const owners = await lockPatrolCreditOwner(tx, "D");
  expect(owners).toEqual(["D", "A", "B"]);
  const now = new Date("2026-11-03T08:00:00Z");
  expect(await eligiblePatrolCredit(tx, owners, [{ observedAt: now }], now)).toBe(false);
  expect(window).toHaveBeenCalledWith({ where: { crewUserId: { in: owners }, windowStart: { in: [now] } }, select: { patrolId: true } });
  assign("B", null, "QUARANTINED");
  expect(await lockPatrolCreditOwner(tx, "D")).toEqual(owners);
  await expect(lockPatrolCreditOwner(tx, "B")).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("separates displayed corrected signatures from current consent eligibility", async () => {
  const { tx, assign, policy } = fixture();
  expect(await accountPolicyIds(tx, "D")).toEqual(["D", "A", "B"]);
  assign("B", "C");
  expect(await accountHistoryIds(tx, "C")).toEqual(["C", "B"]);
  expect(await accountPolicyIds(tx, "C")).toEqual(["C"]);
  expect(await accountPolicyIds(tx, "D")).toEqual(["D", "A"]);
  await findAccountPolicy(tx, "C", "tutee-policy", "reviewed-revision");
  expect(policy).toHaveBeenLastCalledWith({ where: { userId: { in: ["C"] }, slug: "tutee-policy", revision: "reviewed-revision" }, orderBy: { acceptedAt: "desc" } });
  assign("B", null, "QUARANTINED");
  expect(await accountPolicyIds(tx, "D")).toEqual(["D", "A"]);
});
