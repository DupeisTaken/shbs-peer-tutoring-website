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
  const refresh = invalidateTuteeViews(utils).then((values) => {
    expect(values).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
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

const viewNames = [
  "tutees",
  "tuteeStats",
  "pairings",
  "accounts",
  "tuteeHistory",
] as const;
it.each(
  viewNames.flatMap((failed) =>
    (["rejection", "synchronous throw"] as const).map((mode) => ({
      failed,
      mode,
    })),
  ),
)(
  "waits for the remaining tutee views after $failed fails with $mode",
  async ({ failed, mode }) => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const views = {
      tutees: vi.fn<() => Promise<void>>(),
      tuteeStats: vi.fn<() => Promise<void>>(),
      pairings: vi.fn<() => Promise<void>>(),
      accounts: vi.fn<() => Promise<void>>(),
      tuteeHistory: vi.fn<() => Promise<void>>(),
    };
    for (const invalidate of Object.values(views))
      invalidate.mockResolvedValue(undefined);
    const stillPending = failed === "tutees" ? "tuteeHistory" : "tutees";
    views[stillPending].mockReturnValue(held);
    const error = new Error(`Failed ${failed}`);
    if (mode === "rejection") views[failed].mockRejectedValue(error);
    else
      views[failed].mockImplementation(() => {
        throw error;
      });
    const succeeded = vi.fn();
    const rejected = vi.fn();
    const refresh = invalidateTuteeViews({
      admin: {
        tutees: { invalidate: views.tutees },
        tuteeStats: { invalidate: views.tuteeStats },
        pairings: { invalidate: views.pairings },
        accounts: { invalidate: views.accounts },
      },
      tuteeHistory: { invalidate: views.tuteeHistory },
    }).then(succeeded, rejected);
    // A synchronous failure must not prevent the other cache refreshes from starting.
    for (const invalidate of Object.values(views))
      expect(invalidate).toHaveBeenCalledOnce();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(succeeded).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
    finish();
    await refresh;
    expect(succeeded).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledExactlyOnceWith(error);
  },
);
