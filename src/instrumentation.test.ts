import { afterEach, expect, it, vi } from "vitest";
const start = vi.hoisted(() => vi.fn());
vi.mock("./server/student-deadline-worker", () => ({
  startStudentDeadlineWorker: start,
}));
import { register } from "./instrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
  start.mockClear();
});

it.each(["edge", undefined])(
  "never starts the database worker in runtime %s",
  async (runtime) => {
    vi.stubEnv("NEXT_RUNTIME", runtime);
    vi.stubEnv("NODE_ENV", "production");
    await register();
    expect(start).not.toHaveBeenCalled();
  },
);
it("starts the worker on Node servers and skips test execution", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "test");
  await register();
  expect(start).not.toHaveBeenCalled();
  vi.stubEnv("NODE_ENV", "production");
  await register();
  expect(start).toHaveBeenCalledOnce();
});
