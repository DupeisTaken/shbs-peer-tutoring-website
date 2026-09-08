/** Durable deadlines are checked once a minute and on access. Timers never own the deadline. */
export async function register() {
  // Keep the Node-only import inside the positive runtime branch so both webpack
  // and Turbopack can exclude PostgreSQL/fs from the Edge instrumentation bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "test") return;
    const { startStudentDeadlineWorker } =
      await import("./server/student-deadline-worker");
    startStudentDeadlineWorker();
  }
}
