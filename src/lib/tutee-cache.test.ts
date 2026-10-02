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
        { predicate: expect.any(Function) },
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
