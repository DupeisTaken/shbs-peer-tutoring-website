import { db } from "~/server/db";
import { sweepSchoolHours } from "./school-hours";

const state = globalThis as typeof globalThis & {
  schoolHoursWorker?: ReturnType<typeof setInterval>;
};

/** One bounded domain sweep per tick. The persisted occurrence and predecessor,
 * not the timer or delivery success, own the financial reporting chain. */
export function startSchoolHoursWorker() {
  if (state.schoolHoursWorker) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await sweepSchoolHours(db);
    } catch {
      console.error(
        "[school-hours] Issue sweep failed; check database and reporting configuration.",
      );
    } finally {
      running = false;
    }
  };
  state.schoolHoursWorker = setInterval(() => void run(), 60_000);
  state.schoolHoursWorker.unref();
  void run();
}
