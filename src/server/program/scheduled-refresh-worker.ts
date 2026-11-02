import { db } from "~/server/db";
import { processDueScheduledRefreshes } from "./scheduled-refresh";

const state = globalThis as typeof globalThis & {
  scheduledRefreshWorker?: ReturnType<typeof setInterval>;
};

/** Process guards bound local work; database transactions own cross-instance admission. */
export function startScheduledRefreshWorker() {
  if (state.scheduledRefreshWorker) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await processDueScheduledRefreshes(db);
    } catch {
      console.error(
        "[scheduled-refresh] sweep failed; due schedules will retry on the next sweep.",
      );
    } finally {
      running = false;
    }
  };
  state.scheduledRefreshWorker = setInterval(() => void run(), 30_000);
  state.scheduledRefreshWorker.unref();
  void run();
}
