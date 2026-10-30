import { db } from "./db";
import { expireStudentRequests } from "./student-request-state";
import { deliverSignupNotices } from "./student-signup-appeals";
import { settleActiveContinuationOpening } from "./program/continuation-opening";
import { reconcileStudentContinuations } from "./student-continuation-assignment";

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
      await settleActiveContinuationOpening(db);
      await expireStudentRequests(db);
      await reconcileStudentContinuations(db);
      await db.studentActionConfirmation.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      await deliverSignupNotices(db);
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
