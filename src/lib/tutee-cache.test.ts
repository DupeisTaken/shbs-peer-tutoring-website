import { expect, it, vi } from "vitest";
import { invalidateTuteeViews } from "./tutee-cache";
it("refreshes every affected view and waits for completion", async () => {
  let finish!: () => void;
  const delayed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const utils = {
    admin: {
      tutees: { invalidate: vi.fn(() => delayed) },
      tuteeStats: { invalidate: vi.fn(async () => undefined) },
      pairings: { invalidate: vi.fn(async () => undefined) },
      accounts: { invalidate: vi.fn(async () => undefined) },
    },
    tuteeHistory: { invalidate: vi.fn(async () => undefined) },
  };
  let done = false;
  const refresh = invalidateTuteeViews(utils).then(() => {
    done = true;
  });
  for (const view of [...Object.values(utils.admin), utils.tuteeHistory])
    expect(view.invalidate).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(done).toBe(false);
  finish();
  await refresh;
  expect(done).toBe(true);
});
