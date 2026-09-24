import { db } from "./db";
import { expireStudentRequests } from "./student-request-state";

const state = globalThis as typeof globalThis & {
  studentDeadlineWorker?: ReturnType<typeof setInterval>;
};
/** One lightweight worker per process; database locks make multiple instances safe. */
export function startStudentDeadlineWorker() {
  if (state.studentDeadlineWorker) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await expireStudentRequests(db);
      await db.studentActionConfirmation.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
    } catch (error) {
      console.error(
        "[student-deadlines] sweep failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      running = false;
    }
  };
  state.studentDeadlineWorker = setInterval(() => void run(), 60_000);
  state.studentDeadlineWorker.unref();
  void run();
}
