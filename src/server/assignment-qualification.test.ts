import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enforceAssignmentQualification, overrideTarget, prepareAssignmentOverride } from "./assignment-qualification";
import type { TransactionDb } from "./transactions";

vi.mock("~/server/qualifications", () => ({ lockCatalogue: vi.fn() }));
vi.mock("~/server/transactions", () => ({ lockEntity: vi.fn() }));
const value = { tutorId: "tutor", subjectId: "subject", subject: "Math", timeSlotId: "slot" };
const operation = "admin.createPairing";
let ticket: { id: string; userId: string; target: string; action: string; readyAt: Date; expiresAt: Date; usedAt: Date | null } | null;
const grants = vi.fn(async () => 0);
const tx = {
  tutor: { findUnique: vi.fn(async () => ({ id: "tutor", englishName: "Ada", status: "ACTIVE" })) },
  subject: { findUnique: vi.fn(async () => ({ id: "subject", name: "Math", active: true })) },
  qualificationGrant: { count: grants },
  studentActionConfirmation: {
    deleteMany: vi.fn(async () => { ticket = null; return { count: 1 }; }),
    create: vi.fn(async ({ data }: { data: Omit<NonNullable<typeof ticket>, "id" | "usedAt"> }) => { ticket = { ...data, id: "ticket", usedAt: null }; return ticket; }),
    updateMany: vi.fn(async ({ where }: { where: { id: string; userId: string; target: string; action: string; readyAt: { lte: Date }; expiresAt: { gt: Date } } }) => {
      if (!ticket || ticket.usedAt || ticket.id !== where.id || ticket.userId !== where.userId || ticket.target !== where.target || ticket.action !== where.action || ticket.readyAt > where.readyAt.lte || ticket.expiresAt <= where.expiresAt.gt) return { count: 0 };
      ticket.usedAt = new Date(); return { count: 1 };
    }),
  },
} as unknown as TransactionDb;
beforeEach(() => { vi.useFakeTimers(); ticket = null; grants.mockResolvedValue(0); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it("requires explicit evidence at 2999ms and accepts it exactly at 3000ms only once", async () => {
  await prepareAssignmentOverride(tx, "actor", operation, value);
  const input = { ...value, overrideTicket: "ticket" };
  await vi.advanceTimersByTimeAsync(2999);
  await expect(enforceAssignmentQualification(tx, "actor", operation, input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await vi.advanceTimersByTimeAsync(1);
  await expect(enforceAssignmentQualification(tx, "actor", operation, input)).resolves.toBeUndefined();
  await expect(enforceAssignmentQualification(tx, "actor", operation, input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
});
it("rejects another actor, changed assignment, or expired evidence", async () => {
  await prepareAssignmentOverride(tx, "actor", operation, value); await vi.advanceTimersByTimeAsync(3000);
  await expect(enforceAssignmentQualification(tx, "reviewer", operation, { ...value, overrideTicket: "ticket" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await expect(enforceAssignmentQualification(tx, "actor", operation, { ...value, timeSlotId: "changed", overrideTicket: "ticket" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  await expect(enforceAssignmentQualification(tx, "actor", operation, { ...value, overrideTicket: "ticket" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(overrideTarget(operation, value)).not.toBe(overrideTarget("admin.updatePairing", value));
});
it("reopening restarts the delay and eligibility uses only approved concrete grants", async () => {
  await prepareAssignmentOverride(tx, "actor", operation, value); await vi.advanceTimersByTimeAsync(3000);
  await prepareAssignmentOverride(tx, "actor", operation, value);
  await expect(enforceAssignmentQualification(tx, "actor", operation, { ...value, overrideTicket: "ticket" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  grants.mockResolvedValue(1);
  await expect(enforceAssignmentQualification(tx, "actor", operation, value)).resolves.toBeUndefined();
  expect(grants).toHaveBeenCalledWith({ where: { tutorId: "tutor", subjectId: "subject", qualification: { status: "APPROVED" } } });
});
