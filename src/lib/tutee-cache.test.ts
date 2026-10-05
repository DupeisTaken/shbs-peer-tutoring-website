import { expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
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

it.each(["rejected", "synchronous"])(
  "waits for an independent nested refresh after another is %s",
  async (failure) => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const problem = new Error("Roster unavailable");
    const utils = {
      admin: {
        tutees: {
          invalidate: vi.fn(() => {
            if (failure === "synchronous") throw problem;
            return Promise.reject(problem);
          }),
        },
        tuteeStats: { invalidate: vi.fn(() => held) },
        pairings: { invalidate: vi.fn(async () => undefined) },
        accounts: { invalidate: vi.fn(async () => undefined) },
      },
      tuteeHistory: { invalidate: vi.fn(async () => undefined) },
    };
    let settled = false;
    const refresh = invalidateTuteeViews(utils, { reportErrors: true }).then(
      () => {
        settled = true;
        return null;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    for (const view of [...Object.values(utils.admin), utils.tuteeHistory])
      expect(view.invalidate).toHaveBeenCalledWith(
        undefined,
        { predicate: expect.any(Function) as unknown },
        {
          throwOnError: false,
        },
      );
    finish();
    expect(await refresh).toBe(problem);
    expect(settled).toBe(true);
  },
);

it("reports an actual cached React Query refetch failure when the caller opts in", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const problem = new Error("Refresh unavailable");
  const observer = new QueryObserver(client, {
    queryKey: ["tutees"],
    queryFn: async () => {
      throw problem;
    },
    initialData: [{ id: "retained" }],
    staleTime: Infinity,
  });
  const stop = observer.subscribe(() => undefined);
  const quiet = { invalidate: async () => undefined };
  try {
    await expect(
      invalidateTuteeViews(
        {
          admin: {
            tutees: {
              invalidate: (_input, filters, options) =>
                client.invalidateQueries(
                  { queryKey: ["tutees"], ...filters },
                  options,
                ),
            },
            tuteeStats: quiet,
            pairings: quiet,
            accounts: quiet,
          },
          tuteeHistory: quiet,
        },
        { reportErrors: true },
      ),
    ).rejects.toBe(problem);
    expect(observer.getCurrentResult().isError).toBe(true);
    expect(observer.getCurrentResult().data).toEqual([{ id: "retained" }]);
  } finally {
    stop();
    client.clear();
  }
});
