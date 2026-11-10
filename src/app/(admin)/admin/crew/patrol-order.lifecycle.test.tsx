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
import en from "../../../../../messages/en.json";

type Room = { id: string; name: string };
type Order = { roomIds: string[] };
const fixture = vi.hoisted(() => ({
  catalogue: [] as Room[],
  serverOrder: [] as Room[],
  readOrder: vi.fn<() => Promise<Room[]>>(),
  writeOrder: vi.fn<(input: Order) => Promise<{ ok: true }>>(),
  requests: [] as { type: string; path: string; input: unknown }[],
}));
// Exercise the actual CrewPage order owner, tRPC utility forwarding and real
// TanStack lifecycles. Unrelated patrol-detail/receipt UI is outside this test.
vi.mock("~/app/_components/patrol-corrections", () => ({
  PatrolCorrections: () => null,
}));
vi.mock("~/app/_components/email-details", () => ({
  EmailDetails: () => null,
}));
vi.mock("~/trpc/react", async () => {
  const { createTRPCReact } = await import("@trpc/react-query");
  return { api: createTRPCReact<AppRouter>() };
});
import { api } from "~/trpc/react";
import { ReadOnlyProvider } from "~/app/_components/read-only";
import { SessionViewProvider } from "~/app/_components/session-view-state";
import CrewPage from "./page";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function applyOrder(input: Order) {
  fixture.serverOrder = input.roomIds.map((id) => {
    const room = fixture.catalogue.find((candidate) => candidate.id === id);
    if (!room) throw new Error("Unknown synthetic room");
    return { ...room };
  });
}
function transport(): TRPCLink<AppRouter> {
  const emptyReads = new Set([
    "admin.crewRoster",
    "admin.crewApplications",
    "admin.crewRequests",
    "admin.crewIssuedCodes",
  ]);
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
            if (op.type === "query" && op.path === "admin.patrolOrder")
              return fixture.readOrder();
            if (op.type === "query" && emptyReads.has(op.path)) return [];
            if (op.type === "mutation" && op.path === "admin.setPatrolOrder")
              return fixture.writeOrder(op.input as Order);
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
  fixture.catalogue = [
    { id: "room-a", name: "Synthetic Room A" },
    { id: "room-b", name: "Synthetic Room B" },
    { id: "room-c", name: "Synthetic Room C" },
  ];
  fixture.serverOrder = fixture.catalogue.map((room) => ({ ...room }));
  fixture.requests = [];
  fixture.readOrder
    .mockReset()
    .mockImplementation(async () =>
      fixture.serverOrder.map((room) => ({ ...room })),
    );
  fixture.writeOrder.mockReset().mockImplementation(async (input) => {
    applyOrder(input);
    return { ok: true };
  });
  sessionStorage.clear();
  queryClient = new QueryClient({
    defaultOptions: {
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
function key() {
  return getQueryKey(api.admin.patrolOrder, undefined, "query");
}
function show() {
  const client = api.createClient({ links: [transport()] });
  return render(
    <QueryClientProvider client={queryClient}>
      <api.Provider client={client} queryClient={queryClient}>
        <NextIntlClientProvider
          locale="en"
          timeZone="Asia/Shanghai"
          messages={en}
        >
          <SessionViewProvider
            identity="coverage-head"
            pathname="/admin/crew"
            verified
          >
            <ReadOnlyProvider value={false}>
              <CrewPage />
            </ReadOnlyProvider>
          </SessionViewProvider>
        </NextIntlClientProvider>
      </api.Provider>
    </QueryClientProvider>,
  );
}
function section() {
  return screen
    .getByRole("heading", { name: en.admin.crew.orderHeading })
    .closest("section")!;
}
function displayedOrder() {
  return within(section())
    .getAllByRole("listitem")
    .map(
      (item) => within(item).getByText(/^Synthetic Room [ABC]$/).textContent,
    );
}
function saveButton() {
  return within(section()).getByRole<HTMLButtonElement>("button", {
    name: en.admin.crew.saveOrder,
  });
}
async function openOrder() {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("tab", { name: en.admin.crew.panels.patrol }),
    );
  });
}
async function ready() {
  show();
  await waitFor(() =>
    expect(queryClient.getQueryState(key())?.status).toBe("success"),
  );
  await openOrder();
  await waitFor(() => expect(displayedOrder()).toHaveLength(3));
}
function moveFirstDown() {
  fireEvent.click(
    within(section()).getAllByRole("button", {
      name: en.admin.crew.moveDown,
    })[0]!,
  );
}
function expectOrderArrowsDisabled() {
  // Check both complete families, not only the naturally disabled edge arrows.
  for (const name of [en.admin.crew.moveUp, en.admin.crew.moveDown]) {
    const arrows = within(section()).getAllByRole<HTMLButtonElement>("button", {
      name,
    });
    expect(arrows).toHaveLength(fixture.catalogue.length);
    for (const button of arrows) expect(button.disabled).toBe(true);
  }
}
function latestMutation() {
  return queryClient.getMutationCache().getAll().at(-1)?.state;
}
const original = ["Synthetic Room A", "Synthetic Room B", "Synthetic Room C"];
const staged = ["Synthetic Room B", "Synthetic Room A", "Synthetic Room C"];

it("retains a dirty order through a real background read and panel visits and admits one pending save", async () => {
  await ready();
  expect(displayedOrder()).toEqual(original);
  expect(saveButton().disabled).toBe(true);
  expect(
    within(section()).getAllByRole<HTMLButtonElement>("button", {
      name: en.admin.crew.moveUp,
    })[0]!.disabled,
  ).toBe(true);
  act(moveFirstDown);
  expect(displayedOrder()).toEqual(staged);
  // Another legitimate manager's complete order is a new read, not setQueryData.
  fixture.serverOrder = [...fixture.catalogue].reverse();
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: key(), exact: true });
  });
  expect(fixture.readOrder).toHaveBeenCalledTimes(2);
  expect(queryClient.getQueryData(key())).toEqual(fixture.serverOrder);
  expect(displayedOrder()).toEqual(staged);
  fireEvent.click(
    screen.getByRole("tab", { name: en.admin.crew.panels.review }),
  );
  await openOrder();
  expect(displayedOrder()).toEqual(staged);
  const write = deferred<void>();
  const read = deferred<Room[]>();
  fixture.writeOrder.mockImplementationOnce(async (input) => {
    await write.promise;
    applyOrder(input);
    return { ok: true };
  });
  fixture.readOrder.mockImplementationOnce(() => read.promise);
  const save = saveButton();
  act(() => {
    fireEvent.click(save);
    fireEvent.click(save);
  });
  await waitFor(() =>
    expect(fixture.writeOrder).toHaveBeenCalledExactlyOnceWith({
      roomIds: ["room-b", "room-a", "room-c"],
    }),
  );
  expect(save.disabled).toBe(true);
  expectOrderArrowsDisabled();
  await act(async () => write.resolve());
  await waitFor(() => expect(fixture.readOrder).toHaveBeenCalledTimes(3));
  expect(latestMutation()?.status).toBe("pending");
  expect(save.disabled).toBe(true);
  expectOrderArrowsDisabled();
  await act(async () =>
    read.resolve(fixture.serverOrder.map((room) => ({ ...room }))),
  );
  await waitFor(() => expect(latestMutation()?.status).toBe("success"));
  expect(displayedOrder()).toEqual(staged);
  expect(save.disabled).toBe(true);
  fireEvent.click(save);
  expect(fixture.writeOrder).toHaveBeenCalledTimes(1);
});

it("keeps an accepted order successful on default-swallowed read failure and retries the actual query without another write", async () => {
  await ready();
  act(moveFirstDown);
  fixture.readOrder.mockRejectedValueOnce(
    new Error("Synthetic order read unavailable"),
  );
  const save = saveButton();
  fireEvent.click(save);
  await waitFor(() =>
    expect(queryClient.getQueryState(key())?.status).toBe("error"),
  );
  await waitFor(() => expect(latestMutation()?.status).toBe("success"));
  expect(latestMutation()?.error).toBeNull();
  expect(
    await within(section()).findByText(en.admin.crew.saved, { exact: true }),
  ).toBeTruthy();
  expect((await within(section()).findByRole("alert")).textContent).toContain(
    en.managementRecovery.refreshFailed.replace(
      "{section}",
      en.admin.crew.orderHeading,
    ),
  );
  expect(displayedOrder()).toEqual(staged);
  expect(save.disabled).toBe(true);
  expectOrderArrowsDisabled();
  // Try non-boundary moves separately so opposite actions cannot cancel out.
  for (const name of [en.admin.crew.moveUp, en.admin.crew.moveDown]) {
    act(() => {
      fireEvent.click(
        within(section()).getAllByRole<HTMLButtonElement>("button", {
          name,
        })[1]!,
      );
    });
    expect(displayedOrder()).toEqual(staged);
    expect(fixture.writeOrder).toHaveBeenCalledTimes(1);
  }
  fireEvent.click(save);
  expect(fixture.writeOrder).toHaveBeenCalledTimes(1);
  const retry = within(section()).getByRole("button", {
    name: en.managementRecovery.retry.replace(
      "{section}",
      en.admin.crew.orderHeading,
    ),
  });
  fireEvent.click(retry);
  await waitFor(() =>
    expect(queryClient.getQueryState(key())?.status).toBe("success"),
  );
  await waitFor(() =>
    expect(within(section()).queryByRole("alert")).toBeNull(),
  );
  expect(displayedOrder()).toEqual(staged);
  expect(fixture.readOrder).toHaveBeenCalledTimes(3);
  expect(fixture.writeOrder).toHaveBeenCalledTimes(1);
  expect(save.disabled).toBe(true);
});

it("retains a rejected dirty order and allows its deliberate retry without an acceptance refetch", async () => {
  await ready();
  act(moveFirstDown);
  fixture.writeOrder.mockRejectedValueOnce(
    new Error("Synthetic order refused"),
  );
  fireEvent.click(saveButton());
  await waitFor(() => expect(latestMutation()?.status).toBe("error"));
  expect(screen.getByRole("alert").textContent).toContain(
    "Synthetic order refused",
  );
  expect(displayedOrder()).toEqual(staged);
  expect(saveButton().disabled).toBe(false);
  expect(fixture.readOrder).toHaveBeenCalledTimes(1);
  fireEvent.click(saveButton());
  await waitFor(() => expect(latestMutation()?.status).toBe("success"));
  expect(fixture.writeOrder.mock.calls.map(([input]) => input)).toEqual([
    { roomIds: ["room-b", "room-a", "room-c"] },
    { roomIds: ["room-b", "room-a", "room-c"] },
  ]);
  expect(displayedOrder()).toEqual(staged);
  expect(fixture.readOrder).toHaveBeenCalledTimes(2);
  expect(saveButton().disabled).toBe(true);
});

it("treats an initial order transport failure as unavailable and retries only the read", async () => {
  fixture.readOrder.mockRejectedValueOnce(
    new Error("Synthetic initial order unavailable"),
  );
  show();
  await openOrder();
  const retry = await within(section()).findByRole("button", {
    name: en.managementRecovery.retry.replace(
      "{section}",
      en.admin.crew.orderHeading,
    ),
  });
  expect(within(section()).queryByRole("listitem")).toBeNull();
  expect(
    within(section()).queryByRole("button", { name: en.admin.crew.saveOrder }),
  ).toBeNull();
  expect(fixture.writeOrder).not.toHaveBeenCalled();
  fireEvent.click(retry);
  await waitFor(() => expect(displayedOrder()).toEqual(original));
  expect(fixture.readOrder).toHaveBeenCalledTimes(2);
  expect(fixture.writeOrder).not.toHaveBeenCalled();
});
