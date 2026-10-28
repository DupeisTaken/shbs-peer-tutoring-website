import { db } from "~/server/db";
import { sweepMonthlyHours } from "./monthly-hours";

const state = globalThis as typeof globalThis & {
  monthlyHoursWorker?: ReturnType<typeof setInterval>;
};
export function startMonthlyHoursWorker() {
  if (state.monthlyHoursWorker) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await sweepMonthlyHours(db);
    } catch {
      console.error(
        "[monthly-hours] Report sweep failed; check database availability.",
      );
    } finally {
      running = false;
    }
  };
  state.monthlyHoursWorker = setInterval(() => void run(), 60_000);
  state.monthlyHoursWorker.unref();
  void run();
}
