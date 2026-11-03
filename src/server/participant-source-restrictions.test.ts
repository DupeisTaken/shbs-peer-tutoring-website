import { expect, it, vi } from "vitest";
import { participantSourceRestrictions, requireParticipantSourceParticipation } from "./participant-source-restrictions";
import type { TransactionDb } from "./transactions";

type Account = { id: string; suspendedAt: Date | null; recoveryVoidedAt: Date | null;
  schoolDeparture: { reason: string | null; revision: number; observerRevoked: boolean } | null };
function fixture() {
  const account = (id: string): Account => ({ id, suspendedAt: null, recoveryVoidedAt: null, schoolDeparture: null });
  const accounts = [account("B"), account("C"), account("unrelated")];
  const override = { sourceUserIds: ["B"], readerUserId: "C", revision: 3 };
  const retained = { userId: "C", revision: 2 };
  const receipts = [{ id: "receipt", ownershipTransfers: [
    { entity: "Tutor", recordId: "tutor", sourceUserId: "B", readerUserId: "D" },
    { entity: "Tutor", recordId: "other", sourceUserId: "unrelated", readerUserId: "D" },
    { entity: "Tutee", recordId: "tutor", sourceUserId: "unrelated", readerUserId: "D" },
  ] }];
  const direct = vi.fn().mockResolvedValue(null);
  const ownership = vi.fn().mockResolvedValue(retained);
  const db = {
    historyRowOwnership: { findUnique: vi.fn().mockResolvedValue(override) },
    tutorProfileOwnership: { findUnique: ownership }, studentProfileOwnership: { findUnique: ownership },
    personCombineReceipt: { findMany: vi.fn().mockResolvedValue(receipts) },
    user: { findUnique: direct, findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => accounts.filter((row) => where.id.in.includes(row.id))) },
  };
  return { db: db as unknown as TransactionDb, mocks: db, accounts, override, retained, receipts, direct };
}

it("preserves B's exact restriction after B to D retirement and B history to C correction", async () => {
  const f = fixture();
  f.accounts[0]!.schoolDeparture = { reason: "TRANSFERRED", revision: 7, observerRevoked: true };
  f.accounts[2]!.suspendedAt = new Date();
  const evidence = await participantSourceRestrictions(f.db, "TUTOR", "tutor");
  expect(evidence.sourceUserIds).toEqual(["B", "C"]);
  expect(evidence.blockers).toEqual([{ userId: "B", reason: "SCHOOL_DEPARTURE" }]);
  expect(evidence.accounts.find((row) => row.id === "B")?.schoolDeparture?.revision).toBe(7);
  await expect(requireParticipantSourceParticipation(f.db, "TUTOR", "tutor")).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("uses exact combine receipt evidence even before an explicit history override exists", async () => {
  const f = fixture();
  f.mocks.historyRowOwnership.findUnique.mockResolvedValue(null);
  f.accounts[0]!.suspendedAt = new Date();
  expect((await participantSourceRestrictions(f.db, "TUTOR", "tutor")).blockers).toEqual([{ userId: "B", reason: "SUSPENDED" }]);
  expect(f.mocks.personCombineReceipt.findMany).toHaveBeenCalledWith({
    where: { ownershipTransfers: { array_contains: [{ entity: "Tutor", recordId: "tutor" }] } },
    select: { id: true, ownershipTransfers: true }, orderBy: { id: "asc" },
  });
});

it("keeps quarantined source provenance without granting it a reader", async () => {
  const f = fixture();
  f.mocks.historyRowOwnership.findUnique.mockResolvedValue({ ...f.override, readerUserId: null });
  f.mocks.tutorProfileOwnership.findUnique.mockResolvedValue(null);
  f.accounts[0]!.suspendedAt = new Date();
  expect((await participantSourceRestrictions(f.db, "TUTOR", "tutor")).sourceUserIds).toEqual(["B"]);
  await expect(requireParticipantSourceParticipation(f.db, "TUTOR", "tutor")).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("checks exact current direct and retained owners in addition to original provenance", async () => {
  const f = fixture();
  f.direct.mockResolvedValue({ id: "unrelated" });
  f.accounts[1]!.suspendedAt = new Date();
  f.accounts[2]!.schoolDeparture = { reason: "GRADUATED", revision: 1, observerRevoked: false };
  expect((await participantSourceRestrictions(f.db, "TUTEE", "student")).blockers).toEqual([
    { userId: "C", reason: "SUSPENDED" }, { userId: "unrelated", reason: "SCHOOL_DEPARTURE" },
  ]);
});

it("does not turn retained observer revocation into a participation or private-history ban", async () => {
  const f = fixture();
  f.accounts[0]!.schoolDeparture = { reason: null, revision: 8, observerRevoked: true };
  expect((await requireParticipantSourceParticipation(f.db, "TUTOR", "tutor")).blockers).toEqual([]);
});

it.each(["missing", "voided"])("fails closed for %s exact source provenance", async (condition) => {
  const f = fixture();
  if (condition === "missing") f.accounts.splice(0, 1);
  else f.accounts[0]!.recoveryVoidedAt = new Date();
  expect((await participantSourceRestrictions(f.db, "TUTOR", "tutor")).blockers).toEqual([
    { userId: "B", reason: condition === "missing" ? "MISSING_SOURCE" : "VOIDED" },
  ]);
});

it("allows a truly accountless source without importing unrelated Person or retirement-family restrictions", async () => {
  const f = fixture();
  f.mocks.historyRowOwnership.findUnique.mockResolvedValue(null);
  f.mocks.tutorProfileOwnership.findUnique.mockResolvedValue(null);
  f.mocks.personCombineReceipt.findMany.mockResolvedValue([]);
  expect((await requireParticipantSourceParticipation(f.db, "TUTOR", "tutor")).sourceUserIds).toEqual([]);
});

it("returns changed source restriction revision for stale-preview rejection", async () => {
  const f = fixture();
  f.accounts[0]!.schoolDeparture = { reason: "TRANSFERRED", revision: 1, observerRevoked: false };
  const first = JSON.stringify(await participantSourceRestrictions(f.db, "TUTOR", "tutor"));
  f.accounts[0]!.schoolDeparture.revision = 3;
  expect(JSON.stringify(await participantSourceRestrictions(f.db, "TUTOR", "tutor"))).not.toBe(first);
});
