import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { getEmailDeliveryStatus } from "./delivery-status";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  available: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("./sender", () => ({
  isEmailConfigured: mocks.configured,
  isEmailDeliveryAvailable: mocks.available,
  verifyEmailTransport: mocks.verify,
}));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T01:00:00Z"));
  mocks.configured.mockReturnValue(true);
  mocks.available.mockReturnValue(true);
  mocks.verify.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

function fixture() {
  const count = vi.fn().mockResolvedValue(0);
  const database = { emailDelivery: { count } } as unknown as Parameters<
    typeof getEmailDeliveryStatus
  >[0];
  return { database, count };
}

it("reports category outages independently and reads only safe queue aggregates", async () => {
  const { getEmailDeliveryStatus } = await import("./delivery-status");
  const { database, count } = fixture();
  mocks.verify.mockImplementation(async (category) => category === "SECURITY");
  count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
  const result = await getEmailDeliveryStatus(database);
  expect(result).toEqual({
    channels: [
      { category: "SECURITY", state: "READY", checkedAt: new Date() },
      { category: "PROGRAM", state: "UNAVAILABLE", checkedAt: new Date() },
    ],
    retrying: 3,
    failed: 2,
  });
  expect(count.mock.calls).toEqual([
    [{ where: { status: "PENDING", attempts: { gt: 0 } } }],
    [{ where: { status: "FAILED" } }],
  ]);
});

it.each([true, false])(
  "distinguishes local logging from missing production configuration (available=%s)",
  async (available) => {
    const { getEmailDeliveryStatus } = await import("./delivery-status");
    mocks.configured.mockReturnValue(false);
    mocks.available.mockReturnValue(available);
    const result = await getEmailDeliveryStatus(fixture().database);
    expect(result.channels.map((channel) => channel.state)).toEqual(
      Array(2).fill(available ? "LOCAL" : "UNCONFIGURED"),
    );
    expect(mocks.verify).not.toHaveBeenCalled();
  },
);

it("shares in-flight checks and caches results for a minute while refreshing queue evidence", async () => {
  const { getEmailDeliveryStatus } = await import("./delivery-status");
  const { database, count } = fixture();
  let resolve!: (ready: boolean) => void;
  const pending = new Promise<boolean>((done) => {
    resolve = done;
  });
  mocks.verify.mockReturnValue(pending);
  const first = getEmailDeliveryStatus(database);
  const second = getEmailDeliveryStatus(database);
  await Promise.resolve();
  expect(mocks.verify).toHaveBeenCalledTimes(2);
  resolve(false);
  const [initial, concurrent] = await Promise.all([first, second]);
  expect(concurrent).toEqual(initial);
  await vi.advanceTimersByTimeAsync(59_999);
  expect((await getEmailDeliveryStatus(database)).channels).toEqual(
    initial.channels,
  );
  expect(mocks.verify).toHaveBeenCalledTimes(2);
  expect(count).toHaveBeenCalledTimes(6);
  mocks.verify.mockResolvedValue(true);
  await vi.advanceTimersByTimeAsync(1);
  const recovered = await getEmailDeliveryStatus(database);
  expect(recovered.channels.every((channel) => channel.state === "READY")).toBe(
    true,
  );
  expect(recovered.channels[0]!.checkedAt.getTime()).toBe(
    initial.channels[0]!.checkedAt.getTime() + 60_000,
  );
  expect(mocks.verify).toHaveBeenCalledTimes(4);
});

it("propagates failed queue reads instead of reporting a false all-clear", async () => {
  const { getEmailDeliveryStatus } = await import("./delivery-status");
  const { database, count } = fixture();
  count.mockRejectedValue(new Error("Database unavailable"));
  await expect(getEmailDeliveryStatus(database)).rejects.toThrow(
    "Database unavailable",
  );
});
