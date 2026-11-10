/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createQueryClient } from "~/trpc/query-client";
import { useSessionAccessDenied } from "./session-view-state";

type Scope = "current" | "cached";
type PrivateRead = { label: string };
type ReadError = Error & { data?: { code?: string } };
const key = (scope: Scope) => ["session-denial-clock", scope] as const;
const remote = vi.fn<(scope: Scope) => Promise<PrivateRead>>();
const epoch = Date.UTC(2026, 10, 9, 12);
let clock: number;
let client: QueryClient;

function PrivateScope({ scope }: { scope: Scope }) {
  const read = useQuery<PrivateRead, ReadError>({
    queryKey: key(scope),
    queryFn: () => remote(scope),
  });
  const denied = useSessionAccessDenied({
    ...read,
    queryKey: key(scope),
    denialKey: "private-read",
  });
  return (
    <>
      <output aria-label="Query observer">
        {`${scope}:${read.status}:${read.fetchStatus}`}
      </output>
      {denied ? <p role="alert">Access denied</p> : <p>{read.data?.label}</p>}
    </>
  );
}

function view(scope: Scope) {
  return (
    <QueryClientProvider client={client}>
      <PrivateScope scope={scope} />
    </QueryClientProvider>
  );
}

async function cacheOtherScope() {
  remote.mockResolvedValueOnce({ label: "Private cached evidence" });
  await client.fetchQuery({
    queryKey: key("cached"),
    queryFn: () => remote("cached"),
  });
}

async function denyCurrentScope() {
  remote.mockRejectedValueOnce(
    Object.assign(new Error("Access revoked"), {
      data: { code: "FORBIDDEN" },
    }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: key("current"), exact: true });
  });
  await screen.findByRole("alert");
  expect(client.getQueryState(key("current"))?.status).toBe("error");
  expect(client.getQueryState(key("current"))?.errorUpdatedAt).toBe(clock);
  expect(screen.queryByText("Private current evidence")).toBeNull();
}

async function waitForRead(scope: Scope) {
  await waitFor(() => {
    expect(screen.getByLabelText("Query observer").textContent).toBe(
      `${scope}:success:idle`,
    );
  });
}

beforeEach(() => {
  clock = epoch;
  // Change wall-clock timestamps without freezing Query's notification timers.
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  remote.mockReset();
  client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: {
      ...defaults.queries,
      retry: false,
      staleTime: 30_000,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it("conceals an older cached scope after denial and releases only after a normal-clock fresh successful read", async () => {
  await cacheOtherScope();
  clock += 100;
  remote.mockResolvedValueOnce({ label: "Private current evidence" });
  const rendered = render(view("current"));
  await screen.findByText("Private current evidence");

  clock += 100;
  await denyCurrentScope();
  const deniedAt = clock;
  rendered.rerender(view("cached"));
  await waitForRead("cached");
  expect(remote.mock.calls.map(([scope]) => scope)).toEqual([
    "cached",
    "current",
    "current",
  ]);
  expect(client.getQueryState(key("cached"))?.dataUpdatedAt).toBe(epoch);
  expect(screen.getByRole("alert").textContent).toBe("Access denied");
  expect(screen.queryByText("Private cached evidence")).toBeNull();

  clock += 100;
  remote.mockResolvedValueOnce({ label: "Fresh authorized evidence" });
  await act(async () => {
    await client.refetchQueries({ queryKey: key("cached"), exact: true });
  });
  await screen.findByText("Fresh authorized evidence");
  expect(client.getQueryState(key("cached"))?.dataUpdatedAt).toBeGreaterThan(
    deniedAt,
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(remote.mock.calls.map(([scope]) => scope)).toEqual([
    "cached",
    "current",
    "current",
    "cached",
  ]);
});

it("keeps a pre-denial cached scope concealed when its future timestamp survives a backward clock correction", async () => {
  clock = epoch + 60_000;
  await cacheOtherScope();
  const cachedAt = clock;
  clock = epoch;
  remote.mockResolvedValueOnce({ label: "Private current evidence" });
  const rendered = render(view("current"));
  await screen.findByText("Private current evidence");

  clock += 100;
  await denyCurrentScope();
  const deniedAt = clock;
  rendered.rerender(view("cached"));
  await waitForRead("cached");
  // Actual observer success comes from the earlier network response. A future
  // timestamp keeps that cache fresh under the application's 30-second policy.
  expect(remote.mock.calls.map(([scope]) => scope)).toEqual([
    "cached",
    "current",
    "current",
  ]);
  expect(client.getQueryState(key("cached"))?.dataUpdatedAt).toBe(cachedAt);
  expect(cachedAt).toBeGreaterThan(deniedAt);
  expect(screen.queryByText("Private cached evidence")).toBeNull();
  expect(screen.getByRole("alert").textContent).toBe("Access denied");
});

it("releases denial after a real successful refetch even when the client clock moved behind the denial timestamp", async () => {
  clock = epoch + 60_000;
  remote.mockResolvedValueOnce({ label: "Private current evidence" });
  render(view("current"));
  await screen.findByText("Private current evidence");

  clock += 100;
  await denyCurrentScope();
  const deniedAt = clock;
  clock = epoch + 200;
  remote.mockResolvedValueOnce({ label: "Fresh authorized evidence" });
  await act(async () => {
    await client.refetchQueries({ queryKey: key("current"), exact: true });
  });
  await waitForRead("current");
  expect(remote.mock.calls.map(([scope]) => scope)).toEqual([
    "current",
    "current",
    "current",
  ]);
  const state = client.getQueryState(key("current"));
  expect(state?.error).toBeNull();
  expect(state?.data).toEqual({ label: "Fresh authorized evidence" });
  expect(state?.dataUpdatedAt).toBe(clock);
  expect(clock).toBeLessThan(deniedAt);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Fresh authorized evidence")).toBeTruthy();
});
