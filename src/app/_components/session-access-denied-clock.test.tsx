/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createQueryClient } from "~/trpc/query-client";
import { useSessionAccessDenied } from "./session-view-state";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function configuredClient() {
  const client = createQueryClient();
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
  return client;
}

it("rejects future-stamped cached scopes and local setQueryData writes, and recovers on a genuine fresh read under backward clock skew and equal timestamps", async () => {
  type Scope = "default" | "filtered";
  const keyFor = (scope: Scope) => ["clock-denial", scope] as const;
  let now = Date.UTC(2026, 10, 9, 12, 30);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const client = configuredClient();

  let failFiltered = false;
  let defaultOutcome: "cached" | "fresh-equal" | "fresh-backward" = "cached";
  let refetchCurrent: (() => Promise<unknown>) | undefined;

  function View({ scope }: { scope: Scope }) {
    const query = useQuery({
      queryKey: keyFor(scope),
      queryFn: async () => {
        if (scope === "filtered" && failFiltered) {
          throw Object.assign(new Error("Denied"), {
            data: { code: "FORBIDDEN" },
          });
        }
        return { scope, label: `${scope}:${defaultOutcome}` };
      },
    });
    useEffect(() => {
      refetchCurrent = query.refetch;
    }, [query.refetch]);
    const denied = useSessionAccessDenied({
      ...query,
      queryKey: keyFor(scope),
      denialKey: "clock-slot",
    });
    return (
      <>
        <p data-testid="status">{denied ? "denied" : "authorized"}</p>
        {!denied && query.data && <p>{query.data.label}</p>}
      </>
    );
  }

  const tree = (scope: Scope) => (
    <QueryClientProvider client={client}>
      <View scope={scope} />
    </QueryClientProvider>
  );

  // 1. Seed default scope with a future-skewed Date.now timestamp (12:30).
  const view = render(tree("default"));
  await waitFor(() => expect(screen.getByText("default:cached")).toBeTruthy());

  // 2. Move wall clock backward to 12:00 and deny filtered scope.
  now = Date.UTC(2026, 10, 9, 12, 0);
  failFiltered = true;
  view.rerender(tree("filtered"));
  await waitFor(() =>
    expect(screen.getByTestId("status").textContent).toBe("denied"),
  );

  // 3. Reset to the future-stamped cached default scope: MUST stay denied.
  view.rerender(tree("default"));
  expect(screen.getByTestId("status").textContent).toBe("denied");
  expect(screen.queryByText("default:cached")).toBeNull();

  // 4. Local setQueryData write (no real network fetch) even with a newer clock
  //    MUST NOT release the denial latch.
  now = Date.UTC(2026, 10, 9, 13, 0);
  await act(async () => {
    client.setQueryData(keyFor("default"), {
      scope: "default",
      label: "default:forged",
    });
  });
  expect(screen.getByTestId("status").textContent).toBe("denied");
  expect(screen.queryByText("default:forged")).toBeNull();

  // 5. Genuine fresh network read at the EXACT SAME timestamp (12:00) MUST recover.
  now = Date.UTC(2026, 10, 9, 12, 0);
  defaultOutcome = "fresh-equal";
  await act(async () => {
    await refetchCurrent?.();
  });
  await waitFor(() =>
    expect(screen.getByTestId("status").textContent).toBe("authorized"),
  );
  expect(screen.getByText("default:fresh-equal")).toBeTruthy();

  // 6. Deny again at 12:00, then recover on a genuine fresh read at 11:00 (backward clock).
  view.rerender(tree("filtered"));
  await waitFor(() =>
    expect(screen.getByTestId("status").textContent).toBe("denied"),
  );
  view.rerender(tree("default"));
  expect(screen.getByTestId("status").textContent).toBe("denied");

  now = Date.UTC(2026, 10, 9, 11, 0);
  defaultOutcome = "fresh-backward";
  await act(async () => {
    await refetchCurrent?.();
  });
  await waitFor(() =>
    expect(screen.getByTestId("status").textContent).toBe("authorized"),
  );
  expect(screen.getByText("default:fresh-backward")).toBeTruthy();
});

it("does not allow an in-flight read started before denial to release the denial latch when it resolves late", async () => {
  type Scope = "slow" | "denied";
  const keyFor = (scope: Scope) => ["inflight-fence", scope] as const;
  const client = configuredClient();

  let resolveSlow: ((value: { label: string }) => void) | undefined;
  let slowAttempt = 0;
  let refetchCurrent: (() => Promise<unknown>) | undefined;

  function View({ scope }: { scope: Scope }) {
    const query = useQuery({
      queryKey: keyFor(scope),
      queryFn: () => {
        if (scope === "denied") {
          return Promise.reject(
            Object.assign(new Error("Denied"), {
              data: { code: "FORBIDDEN" },
            }),
          );
        }
        slowAttempt++;
        if (slowAttempt === 1) {
          return new Promise<{ label: string }>((resolve) => {
            resolveSlow = resolve;
          });
        }
        return Promise.resolve({ label: "Fresh after denial" });
      },
    });
    useEffect(() => {
      refetchCurrent = query.refetch;
    }, [query.refetch]);
    const denied = useSessionAccessDenied({
      ...query,
      queryKey: keyFor(scope),
      denialKey: "inflight-slot",
    });
    return (
      <>
        <p data-testid="status">{denied ? "denied" : "authorized"}</p>
        {!denied && query.data && <p>{query.data.label}</p>}
      </>
    );
  }

  const tree = (scope: Scope) => (
    <QueryClientProvider client={client}>
      <View scope={scope} />
    </QueryClientProvider>
  );

  // Start slow read first, before denial happens.
  const view = render(tree("slow"));
  await waitFor(() => expect(resolveSlow).toBeDefined());

  // Switch to denied scope and trigger FORBIDDEN while slow read is still in flight.
  view.rerender(tree("denied"));
  await waitFor(() =>
    expect(screen.getByTestId("status").textContent).toBe("denied"),
  );

  // Return to slow scope and resolve the pre-denial in-flight promise.
  view.rerender(tree("slow"));
  await act(async () => {
    resolveSlow?.({ label: "Pre-denial in-flight data" });
  });
  expect(screen.getByTestId("status").textContent).toBe("denied");
  expect(screen.queryByText("Pre-denial in-flight data")).toBeNull();

  // Only a genuinely new read started after the denial releases it.
  await act(async () => {
    await refetchCurrent?.();
  });
  await waitFor(() =>
    expect(screen.getByTestId("status").textContent).toBe("authorized"),
  );
  expect(screen.getByText("Fresh after denial")).toBeTruthy();
});
