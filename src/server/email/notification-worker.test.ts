import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverNotifications,
  drainNotificationQueue,
} from "./notification-delivery";

const mocks = vi.hoisted(() => ({
  available: true,
  lease: vi.fn(),
  update: vi.fn(),
  send: vi.fn(),
}));
vi.mock("~/server/db", () => ({
  db: {
    programSettings: {
      findUnique: async () => ({ emailNotificationsEnabled: true }),
    },
    $queryRaw: mocks.lease,
    emailDelivery: { updateMany: mocks.update },
  },
}));
vi.mock("./sender", () => ({
  emailSender: { send: mocks.send },
  isEmailDeliveryAvailable: () => mocks.available,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.available = true;
});

describe("bounded notification queue draining", () => {
  it("releases only its remaining exact leases when the deadline passes before dispatch", async () => {
    const leases = [
      {
        id: "first",
        leaseUntil: new Date("2026-10-28T07:35:00Z"),
        attemptId: null,
      },
      {
        id: "second",
        leaseUntil: new Date("2026-10-28T07:35:00Z"),
        attemptId: "attempt",
      },
    ];
    mocks.lease.mockResolvedValueOnce(leases);
    mocks.update.mockResolvedValueOnce({ count: 2 });
    expect(await deliverNotifications(10, performance.now() - 1)).toBe(0);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { status: { in: ["PENDING", "SENDING"] }, OR: leases },
      data: { leaseUntil: null },
    });
  });

  it("returns zero without leasing when both transports are unavailable", async () => {
    mocks.available = false;
    expect(await drainNotificationQueue()).toBe(0);
    expect(mocks.lease).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("drains a burst beyond one batch in order with serial dispatch", async () => {
    const pending = Array.from({ length: 35 }, (_, index) => index);
    const sent: number[] = [];
    let active = 0;
    let maximumActive = 0;
    const batch = vi.fn(async (limit: number) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      const rows = pending.splice(0, limit);
      sent.push(...rows);
      active--;
      return rows.length;
    });
    expect(await drainNotificationQueue(batch, () => 0)).toBe(35);
    expect(sent).toEqual(Array.from({ length: 35 }, (_, index) => index));
    expect(maximumActive).toBe(1);
    expect(batch).toHaveBeenCalledTimes(4);
    expect(batch).toHaveBeenCalledWith(10, 20_000);
  });

  it("does not spin when transport is unavailable or no rows are due", async () => {
    const batch = vi.fn(async () => 0);
    expect(await drainNotificationQueue(batch, () => 0)).toBe(0);
    expect(batch).toHaveBeenCalledOnce();
  });

  it("stops admitting batches at the elapsed budget", async () => {
    let elapsed = 0;
    const batch = vi.fn(async () => {
      elapsed += 10_000;
      return 10;
    });
    expect(await drainNotificationQueue(batch, () => elapsed)).toBe(20);
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it("has a finite 1000-row bound even when the clock does not advance", async () => {
    const batch = vi.fn(async () => 10);
    expect(await drainNotificationQueue(batch, () => 0)).toBe(1000);
    expect(batch).toHaveBeenCalledTimes(100);
  });

  it("stops a partially processed batch without immediately reacquiring released leases", async () => {
    const batch = vi.fn(async () => 3);
    expect(await drainNotificationQueue(batch, () => 0)).toBe(3);
    expect(batch).toHaveBeenCalledOnce();
  });
});
