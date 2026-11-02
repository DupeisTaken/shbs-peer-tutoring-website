import { afterEach, expect, it, vi } from "vitest";
const domain = vi.hoisted(() => ({
  sweep: vi.fn<() => Promise<{ generated: boolean }>>(),
}));
vi.mock("~/server/db", () => ({ db: { synthetic: true } }));
vi.mock("./school-hours", () => ({ sweepSchoolHours: domain.sweep }));
import { startSchoolHoursWorker } from "./school-hours-worker";

const state = globalThis as typeof globalThis & {
  schoolHoursWorker?: ReturnType<typeof setInterval>;
};
afterEach(() => {
  if (state.schoolHoursWorker) clearInterval(state.schoolHoursWorker);
  delete state.schoolHoursWorker;
  vi.useRealTimers();
});
it("starts once, bounds concurrent sweeps and retries on a later tick", async () => {
  vi.useFakeTimers();
  let finish: (() => void) | undefined;
  domain.sweep
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ generated: false });
        }),
    )
    .mockResolvedValue({ generated: false });
  startSchoolHoursWorker();
  startSchoolHoursWorker();
  expect(domain.sweep).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(domain.sweep).toHaveBeenCalledTimes(1);
  finish?.();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(domain.sweep).toHaveBeenCalledTimes(2);
});
