import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ publication: vi.fn(), sweep: vi.fn(), notices: vi.fn() }));
vi.mock("~/server/db", () => ({ db: { $queryRaw: calls.notices } }));
vi.mock("~/server/email/sender", () => ({ emailSender: { send: vi.fn() }, isEmailConfigured: vi.fn() }));
vi.mock("~/server/session-planning", () => ({
  ensureSessionPlanningWindow: calls.publication,
  sweepSessionPlanning: calls.sweep,
  lockSessionPlanning: vi.fn(),
  markSessionResponseDelivered: vi.fn(),
}));
import { startSessionPlanningWorker } from "~/server/session-planning-delivery";

const state = globalThis as typeof globalThis & { sessionPlanningWorker?: ReturnType<typeof setInterval> };
let ownedInterval: ReturnType<typeof setInterval> | undefined;
beforeEach(() => {
  expect(state.sessionPlanningWorker).toBeUndefined();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  calls.notices.mockResolvedValue([]);
  calls.sweep.mockResolvedValue(0);
});
afterEach(() => {
  if (ownedInterval && state.sessionPlanningWorker === ownedInterval) {
    clearInterval(ownedInterval);
    delete state.sessionPlanningWorker;
  }
  ownedInterval = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("invokes the blocking sweep immediately and every 30s even when publication catch-up fails", async () => {
  calls.publication.mockRejectedValue(new Error("Synthetic publication failure"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  startSessionPlanningWorker();
  ownedInterval = state.sessionPlanningWorker;
  await vi.advanceTimersByTimeAsync(0);
  expect(calls.publication).toHaveBeenCalledTimes(1);
  expect(calls.sweep).toHaveBeenCalledTimes(1);
  expect(calls.notices).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(calls.sweep).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls.sweep).toHaveBeenCalledTimes(2);
  expect(calls.publication).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(calls.sweep).toHaveBeenCalledTimes(3);
  expect(calls.publication).toHaveBeenCalledTimes(2);
});

it("retries an unsuccessful blocking sweep on the next worker interval", async () => {
  calls.publication.mockResolvedValue(undefined);
  calls.sweep.mockRejectedValueOnce(new Error("Synthetic maintenance abort")).mockResolvedValue(0);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  startSessionPlanningWorker();
  ownedInterval = state.sessionPlanningWorker;
  await vi.advanceTimersByTimeAsync(0);
  expect(calls.sweep).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(calls.sweep).toHaveBeenCalledTimes(2);
  expect(calls.notices).toHaveBeenCalledTimes(2);
});
