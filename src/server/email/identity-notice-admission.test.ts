import { beforeEach, expect, it, vi } from "vitest";
import type { TransactionDb } from "~/server/transactions";
const steps = vi.hoisted(() => [] as string[]);
vi.mock("~/server/transactions", () => ({
  inTransaction: vi.fn(async (db: unknown, work: (tx: unknown) => Promise<unknown>) => work(db)),
  lockEntity: vi.fn(async (_db: unknown, key: string) => { steps.push(key); }),
}));
vi.mock("~/server/history-row-ownership", () => ({
  notificationOwnershipWhere: vi.fn(async () => ({ id: { in: ["notice"] } })),
}));
import { inTransaction } from "~/server/transactions";
import { admitIdentityNotice, finishIdentityNotice } from "./identity-notice-admission";

function fixture() {
  const lease = new Date(Date.now() + 300_000);
  const row = { id: "mail", userId: "reader", category: "info", sourceNotificationId: "notice" as string | null,
    status: "PENDING", attempts: 0, leaseUntil: lease as Date | null, attemptId: null as string | null, attemptStartedAt: null as Date | null };
  const state = { roots: [{ actionId: "root-z" }, { actionId: "root-a" }], cancelled: false };
  const tx = {
    user: { findUnique: vi.fn().mockResolvedValue({ mergedIntoId: null, recoveryVoidedAt: null, suspendedAt: null }) },
    historyRowOwnership: { findUnique: vi.fn().mockResolvedValue(null) },
    notification: { count: vi.fn().mockResolvedValue(1) },
    emailDelivery: {
      findUnique: vi.fn(async () => row),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const attempts = row.attempts + (typeof data.attempts === "object" ? 1 : 0);
        Object.assign(row, data, { attempts });
        return row;
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(row, data); return { count: 1 }; }),
    },
    $executeRaw: vi.fn(async () => { steps.push("ownership"); return 0; }),
    $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes('SELECT DISTINCT "actionId"')) return state.roots;
      if (sql.includes('FROM "EmailDelivery"') && sql.includes("FOR UPDATE")) steps.push("delivery");
      if (sql.includes("SELECT true AS found")) return state.cancelled ? [{ found: true }] : [];
      return [];
    }),
  };
  return { tx, db: tx as unknown as TransactionDb, state, row, lease };
}
beforeEach(() => { steps.length = 0; vi.clearAllMocks(); });

it.each([false, true])("uses one identity/root/row admission and one attempt (no causal roots=%s)", async (independent) => {
  const { tx, db, row, state, lease } = fixture();
  if (independent) state.roots = [];
  const attempt = await admitIdentityNotice(db, row.id, lease, null);
  expect(attempt).toBeTruthy();
  expect(vi.mocked(inTransaction)).toHaveBeenCalledTimes(1);
  expect(steps).toEqual(independent ? ["ownership", "delivery"] : ["ownership", "recovery:root-a", "recovery:root-z", "delivery"]);
  expect(tx.notification.count).toHaveBeenCalledWith({ where: { id: "notice", recoveryWithdrawnAt: null, AND: [{ id: { in: ["notice"] } }] } });
  expect(tx.emailDelivery.update).toHaveBeenCalledTimes(1);
  expect(row).toMatchObject({ status: "SENDING", attemptId: attempt, attempts: 1 });
  await finishIdentityNotice(db, row.id, attempt!, true);
  expect(vi.mocked(inTransaction)).toHaveBeenCalledTimes(2);
  expect(row).toMatchObject({ status: "SENT", attemptId: attempt, attempts: 1 });
});

it.each(["stop", "quarantine", "different-reader", "lost-notification", "retired", "voided", "suspended"])("cannot bypass %s through an existing recovery origin", async (mode) => {
  const { tx, db, state, row, lease } = fixture();
  if (mode === "stop") state.cancelled = true;
  if (mode === "quarantine") tx.historyRowOwnership.findUnique.mockResolvedValue({ readerUserId: null });
  if (mode === "different-reader") tx.historyRowOwnership.findUnique.mockResolvedValue({ readerUserId: "someone-else" });
  if (mode === "lost-notification") tx.notification.count.mockResolvedValue(0);
  if (mode === "retired") tx.user.findUnique.mockResolvedValue({ mergedIntoId: "survivor", recoveryVoidedAt: null, suspendedAt: null });
  if (mode === "voided") tx.user.findUnique.mockResolvedValue({ mergedIntoId: null, recoveryVoidedAt: new Date(), suspendedAt: null });
  if (mode === "suspended") tx.user.findUnique.mockResolvedValue({ mergedIntoId: null, recoveryVoidedAt: null, suspendedAt: new Date() });
  expect(await admitIdentityNotice(db, row.id, lease, null)).toBeNull();
  expect(tx.emailDelivery.update).not.toHaveBeenCalled();
  expect(row.attemptStartedAt).toBeNull();
});

it.each(["old-lease", "old-attempt", "expired", "started-pending", "SENDING", "UNCERTAIN"])("rejects %s without admitting another attempt", async (mode) => {
  const { tx, db, row, lease } = fixture();
  if (mode === "started-pending") row.attemptStartedAt = new Date();
  if (mode === "SENDING" || mode === "UNCERTAIN") row.status = mode;
  const suppliedLease = mode === "old-lease" ? new Date(lease.getTime() - 1) : mode === "expired" ? new Date(0) : lease;
  expect(await admitIdentityNotice(db, row.id, suppliedLease, mode === "old-attempt" ? "stale" : null)).toBeNull();
  expect(tx.emailDelivery.update).not.toHaveBeenCalled();
});

it("does not infer a notification for a legacy independent delivery", async () => {
  const { tx, db, row, state, lease } = fixture();
  state.roots = [];
  row.sourceNotificationId = null;
  expect(await admitIdentityNotice(db, row.id, lease, null)).toBeTruthy();
  expect(tx.historyRowOwnership.findUnique).toHaveBeenCalledWith({ where: { entity_recordId: { entity: "EmailDelivery", recordId: row.id } } });
  expect(tx.notification.count).not.toHaveBeenCalled();
});

it.each([false, true])("retains admitted uncertainty and exact late acceptance after an ownership change (stopped=%s)", async (stopped) => {
  const { tx, db, row, state, lease } = fixture();
  const attempt = await admitIdentityNotice(db, row.id, lease, null);
  await finishIdentityNotice(db, row.id, "stale-token", true);
  expect(tx.emailDelivery.updateMany).not.toHaveBeenCalled();
  await finishIdentityNotice(db, row.id, attempt!, false);
  expect(row).toMatchObject({ status: "UNCERTAIN", attempts: 1 });
  state.cancelled = stopped;
  tx.notification.count.mockResolvedValue(0);
  await finishIdentityNotice(db, row.id, attempt!, true);
  expect(row).toMatchObject({ status: "SENT", attempts: 1, attemptId: attempt });
});

it("records failure after any root's durable stop without clearing the admitted token", async () => {
  const { db, row, state, lease } = fixture();
  const attempt = await admitIdentityNotice(db, row.id, lease, null);
  state.cancelled = true;
  await finishIdentityNotice(db, row.id, attempt!, false);
  expect(row).toMatchObject({ status: "CANCELLED", attempts: 1, attemptId: attempt });
  expect(row.attemptStartedAt).not.toBeNull();
});
