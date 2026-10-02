import { expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  invalidateAndReport,
  type InvalidationTarget,
} from "./invalidate-refresh";

function target(client: QueryClient): InvalidationTarget {
  return {
    invalidate: (_input, filters, options) =>
      client.invalidateQueries({ queryKey: ["roster"], ...filters }, options),
  };
}

it("does not turn an inactive cached error into a new refresh failure", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryFn = vi.fn(async () => {
    throw new Error("Earlier failure");
  });
  try {
    await expect(
      client.fetchQuery({ queryKey: ["roster", "inactive"], queryFn }),
    ).rejects.toThrow("Earlier failure");
    await expect(invalidateAndReport(target(client))).resolves.toBeUndefined();
    expect(queryFn).toHaveBeenCalledOnce();
  } finally {
    client.clear();
  }
});

it("allows a later successful refresh after reporting a real cached-data failure", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryFn = vi.fn(async () => ["fresh"]);
  const observer = new QueryObserver(client, {
    queryKey: ["roster", "active"],
    queryFn,
    initialData: ["cached"],
    staleTime: Infinity,
  });
  const stop = observer.subscribe(() => undefined);
  try {
    queryFn.mockRejectedValueOnce(new Error("New refresh failure"));
    await expect(invalidateAndReport(target(client))).rejects.toThrow(
      "New refresh failure",
    );
    expect(observer.getCurrentResult().data).toEqual(["cached"]);
    await expect(invalidateAndReport(target(client))).resolves.toBeUndefined();
    expect(observer.getCurrentResult().data).toEqual(["fresh"]);
    expect(observer.getCurrentResult().isError).toBe(false);
  } finally {
    stop();
    client.clear();
  }
});
