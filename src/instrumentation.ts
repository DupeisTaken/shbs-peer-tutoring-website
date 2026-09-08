/** Durable deadlines are checked once a minute and on access. Timers never own the deadline. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV === "test")
    return;
  const { startStudentDeadlineWorker } =
    await import("./server/student-deadline-worker");
  startStudentDeadlineWorker();
}
