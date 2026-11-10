/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppRouter } from "~/server/api/root";
import en from "../../../../messages/en.json";

type Choice = { available: boolean };
type Me = { status: "PENDING" | "ACTIVE" | "OPTED_OUT" };
const fixture = vi.hoisted(() => ({
  refresh: vi.fn<() => void>(),
  write: vi.fn<(input: Choice) => Promise<{ ok: true }>>(),
  readMe: vi.fn<() => Promise<Me>>(),
  requests: [] as { type: string; path: string; input: unknown }[],
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: fixture.refresh }),
}));
// Keep actual tRPC hooks/utilities and TanStack mutation/query lifecycles.
// Only the terminal transport link and Next's void router.refresh boundary vary.
vi.mock("~/trpc/react", async () => {
  const { createTRPCReact } = await import("@trpc/react-query");
  return { api: createTRPCReact<AppRouter>() };
});
import { api } from "~/trpc/react";
import { TutorActivation } from "./tutor-activation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function transport(): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        let subscribed = true;
        fixture.requests.push({
          type: op.type,
          path: op.path,
          input: op.input,
        });
        void Promise.resolve()
          .then<unknown>(() => {
            if (op.type === "query" && op.path === "tutor.me")
              return fixture.readMe();
            if (op.type === "mutation" && op.path === "tutor.activateAccount")
              return fixture.write(op.input as Choice);
            throw new Error(`Unexpected test transport: ${op.type} ${op.path}`);
          })
          .then(
            (data) => {
              if (!subscribed) return;
              observer.next({ result: { data } });
              observer.complete();
            },
            (error: unknown) => {
              if (subscribed) {
                const cause =
                  error instanceof Error
                    ? error
                    : new Error("Synthetic transport failure");
                observer.error(TRPCClientError.from<AppRouter>(cause));
              }
            },
          );
        return () => {
          subscribed = false;
        };
      });
}

let queryClient: QueryClient;
beforeEach(() => {
  fixture.requests = [];
  fixture.refresh.mockReset();
  fixture.write.mockReset().mockResolvedValue({ ok: true });
  fixture.readMe.mockReset().mockResolvedValue({ status: "PENDING" });
  queryClient = new QueryClient({
    defaultOptions: {
      // Bound retries/timers, preserving default invalidate/refetch error policy.
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

// This optional sibling is a test observer, not the server-rendered dashboard.
// It is used only to exercise the installed active-query invalidation branch.
function ActiveMeProbe() {
  const query = api.tutor.me.useQuery();
  return (
    <>
      <output data-testid="me-status">{query.data?.status ?? "missing"}</output>
      <output data-testid="me-read-state">{query.status}</output>
    </>
  );
}
function show(observeMe = false) {
  const client = api.createClient({ links: [transport()] });
  return render(
    <QueryClientProvider client={queryClient}>
      <api.Provider client={client} queryClient={queryClient}>
        <NextIntlClientProvider
          locale="en"
          timeZone="Asia/Shanghai"
          messages={en}
        >
          {observeMe && <ActiveMeProbe />}
          <TutorActivation />
        </NextIntlClientProvider>
      </api.Provider>
    </QueryClientProvider>,
  );
}
function choice(available: boolean) {
  return screen.getByRole<HTMLButtonElement>("button", {
    name: available ? en.tutor.activate.available : en.tutor.activate.optOut,
  });
}
async function review(available: boolean) {
  await act(async () => {
    fireEvent.click(choice(available));
  });
  return screen.findByRole("dialog", {
    name: available ? en.tutor.activate.available : en.tutor.activate.optOut,
  });
}
async function confirm(available: boolean, twice = false) {
  const dialog = await review(available);
  const button = within(dialog).getByRole("button", {
    name: available ? en.tutor.activate.available : en.tutor.activate.optOut,
  });
  await act(async () => {
    fireEvent.click(button);
    if (twice) fireEvent.click(button);
  });
}
function mutationState() {
  return queryClient.getMutationCache().getAll().at(-1)?.state;
}

it("uses the real confirmation and completes without inventing an unobserved tutor.me fetch", async () => {
  const write = deferred<{ ok: true }>();
  fixture.write.mockImplementationOnce(() => write.promise);
  show();
  const cancelled = await review(true);
  expect(fixture.write).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(
      within(cancelled).getByRole("button", { name: en.common.cancel }),
    );
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fixture.refresh).not.toHaveBeenCalled();
  await confirm(true, true);
  await waitFor(() => expect(fixture.write).toHaveBeenCalledTimes(1));
  expect(choice(true).disabled).toBe(true);
  expect(choice(false).disabled).toBe(true);
  expect(fixture.refresh).not.toHaveBeenCalled();
  await act(async () => write.resolve({ ok: true }));
  await waitFor(() => expect(mutationState()?.status).toBe("success"));
  expect(
    await screen.findByText(en.workflows.saved, { exact: true }),
  ).toBeTruthy();
  expect(fixture.refresh).toHaveBeenCalledOnce();
  // The dashboard reads me on the server. No mounted client observer means
  // active-only invalidation does not fetch, nor certify an RSC refresh result.
  expect(fixture.readMe).not.toHaveBeenCalled();
  expect(
    queryClient.getQueryData(getQueryKey(api.tutor.me, undefined, "query")),
  ).toBeUndefined();
  expect(
    fixture.requests.filter((request) => request.type === "mutation"),
  ).toHaveLength(1);
});

it.each([true, false])(
  "preserves accepted choice %s when a real active-query transport refetch fails, then recovers through reads",
  async (available) => {
    show(true);
    await waitFor(() =>
      expect(screen.getByTestId("me-read-state").textContent).toBe("success"),
    );
    const read = deferred<Me>();
    const write = deferred<{ ok: true }>();
    fixture.readMe.mockImplementationOnce(() => read.promise);
    fixture.write.mockImplementationOnce(() => write.promise);
    const invalidation = vi.spyOn(queryClient, "invalidateQueries");
    await confirm(available);
    await waitFor(() =>
      expect(fixture.write).toHaveBeenCalledExactlyOnceWith({ available }),
    );
    await act(async () => write.resolve({ ok: true }));
    await waitFor(() => expect(fixture.readMe).toHaveBeenCalledTimes(2));
    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(fixture.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      invalidation.mock.invocationCallOrder[0]!,
    );
    expect(mutationState()?.status).toBe("pending");
    expect(choice(true).disabled).toBe(true);
    expect(choice(false).disabled).toBe(true);
    // Refute a fake invalidate rejection: installed defaults swallow this real
    // queryFn/link error, leaving the write successful and the query in error.
    await act(async () =>
      read.reject(new Error("Synthetic tutor read unavailable")),
    );
    await waitFor(() => expect(mutationState()?.status).toBe("success"));
    const key = getQueryKey(api.tutor.me, undefined, "query");
    expect(queryClient.getQueryState(key)?.status).toBe("error");
    expect(queryClient.getQueryData(key)).toMatchObject({ status: "PENDING" });
    expect(
      await screen.findByText(en.workflows.saved, { exact: true }),
    ).toBeTruthy();
    expect(mutationState()?.error).toBeNull();
    expect(fixture.write).toHaveBeenCalledTimes(1);
    const finalStatus = available ? "ACTIVE" : "OPTED_OUT";
    fixture.readMe.mockResolvedValue({ status: finalStatus });
    // External cache refresh is deliberately labeled test-driven. The feature
    // has no owned Retry button; this is not a GUI/RSC recovery claim.
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: key, exact: true });
    });
    await waitFor(() =>
      expect(screen.getByTestId("me-read-state").textContent).toBe("success"),
    );
    expect(screen.getByTestId("me-status").textContent).toBe(finalStatus);
    expect(fixture.write).toHaveBeenCalledTimes(1);
    expect(fixture.refresh).toHaveBeenCalledOnce();
  },
);

it("retains a refused choice as a refused write and permits a deliberate confirmed retry", async () => {
  fixture.write.mockRejectedValueOnce(
    new Error("Synthetic activation refused"),
  );
  show();
  await confirm(false);
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain(
    "Synthetic activation refused",
  );
  expect(screen.queryByText(en.workflows.saved, { exact: true })).toBeNull();
  expect(fixture.refresh).not.toHaveBeenCalled();
  expect(fixture.readMe).not.toHaveBeenCalled();
  expect(choice(false).disabled).toBe(false);
  await confirm(false);
  await waitFor(() => expect(mutationState()?.status).toBe("success"));
  expect(fixture.write.mock.calls.map(([input]) => input)).toEqual([
    { available: false },
    { available: false },
  ]);
  expect(fixture.refresh).toHaveBeenCalledOnce();
  expect(
    await screen.findByText(en.workflows.saved, { exact: true }),
  ).toBeTruthy();
});
