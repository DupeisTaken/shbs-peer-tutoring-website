/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import type { QueryFilters } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import messages from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { installSessionReadReceipts } from "~/lib/session-read-receipts";
import { createQueryClient } from "~/trpc/query-client";
import type { AppRouter } from "~/server/api/root";

type Patrol = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  hours: number;
  note: string | null;
  crewUser: { name: string };
  observations: {
    id: string;
    roomId: string;
    room: { name: string };
    headcount: string;
    observedAt: Date;
  }[];
};
type ObservedRead = {
  data: unknown;
  error: unknown;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  fetchStatus: string;
  status: string;
};
const fixture = vi.hoisted(() => ({
  rows: [] as Patrol[],
  nextRows: [] as Patrol[],
  rooms: [] as { id: string; name: string }[],
  readHistory: vi.fn<(input?: { cursor?: string }) => Promise<Patrol[]>>(),
  readTarget: vi.fn<(input: { id: string }) => Promise<Patrol | null>>(),
  readRooms: vi.fn<() => Promise<{ id: string; name: string }[]>>(),
  save: vi.fn<(input: unknown) => Promise<{ ok: true }>>(),
  observedRooms: null as ObservedRead | null,
  observedHistory: new Map<string | null, ObservedRead>(),
  historyKey: (cursor?: string) => [
    ["corrections", "patrols"],
    { input: { cursor }, type: "query" },
  ],
  targetKey: (id: string) => [
    ["corrections", "patrolById"],
    { input: { id }, type: "query" },
  ],
  roomsKey: () => [["admin", "rooms"], { type: "query" }],
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery, useQueryClient, useMutation } =
    await import("@tanstack/react-query");
  return {
    api: {
      useUtils: () => {
        const client = useQueryClient();
        return {
          admin: {
            rooms: {
              fetch: (_input: undefined, options: { staleTime: number }) =>
                client.fetchQuery({
                  queryKey: fixture.roomsKey(),
                  queryFn: () => fixture.readRooms(),
                  ...options,
                }),
            },
          },
          corrections: {
            patrols: {
              invalidate: (
                _input: undefined,
                filters?: Pick<QueryFilters, "predicate">,
                options?: { throwOnError?: boolean },
              ) =>
                client.invalidateQueries(
                  { queryKey: [["corrections", "patrols"]], ...filters },
                  options,
                ),
              fetch: (
                input: { cursor?: string },
                options: { staleTime: number },
              ) =>
                client.fetchQuery({
                  queryKey: fixture.historyKey(input.cursor),
                  queryFn: () => fixture.readHistory(input),
                  ...options,
                }),
            },
            patrolById: {
              invalidate: (
                _input: undefined,
                filters?: Pick<QueryFilters, "predicate">,
                options?: { throwOnError?: boolean },
              ) =>
                client.invalidateQueries(
                  { queryKey: [["corrections", "patrolById"]], ...filters },
                  options,
                ),
              fetch: (input: { id: string }, options: { staleTime: number }) =>
                client.fetchQuery({
                  queryKey: fixture.targetKey(input.id),
                  queryFn: () => fixture.readTarget(input),
                  ...options,
                }),
            },
          },
        };
      },
      admin: {
        rooms: {
          _def: () => ({ path: ["admin", "rooms"] }),
          useQuery: (_input: undefined, options: { enabled: boolean }) => {
            const result = useQuery({
              queryKey: fixture.roomsKey(),
              queryFn: () => fixture.readRooms(),
              ...options,
            });
            fixture.observedRooms = result;
            return result;
          },
        },
      },
      corrections: {
        patrolById: { _def: () => ({ path: ["corrections", "patrolById"] }) },
        patrols: {
          _def: () => ({ path: ["corrections", "patrols"] }),
          useQuery: (input: { cursor?: string }) => {
            const result = useQuery({
              queryKey: fixture.historyKey(input.cursor),
              queryFn: () => fixture.readHistory(input),
            });
            fixture.observedHistory.set(input.cursor ?? null, result);
            return result;
          },
        },
        correctPatrol: {
          useMutation: () => useMutation({ mutationFn: fixture.save }),
        },
      },
    },
  };
});

import { PatrolCorrections } from "./patrol-corrections";
import { ReadOnlyProvider } from "./read-only";
import { SaveNotifications } from "./save-notifications";

let client: QueryClient;
const originalVersion = new Date("2026-11-01T06:30:00Z");
const newerVersion = new Date("2026-11-01T06:31:00Z");
function patrol(id = "synthetic-patrol"): Patrol {
  return {
    id,
    createdAt: originalVersion,
    updatedAt: originalVersion,
    hours: 0.5,
    note: "Saved synthetic note",
    crewUser: { name: "Synthetic crew" },
    observations: [
      {
        id: `observation-${id}`,
        roomId: "room",
        room: { name: "Synthetic room" },
        headcount: "ONE",
        observedAt: originalVersion,
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function accessDenied() {
  return Object.assign(new Error("Synthetic denied read"), {
    data: { code: "FORBIDDEN" },
  });
}
function subject(
  readOnly = false,
  onViewReadState = vi.fn(),
  timeZone = "Asia/Shanghai",
) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={messages}
        timeZone={timeZone}
      >
        <ReadOnlyProvider value={readOnly}>
          <PatrolCorrections onViewReadState={onViewReadState} />
        </ReadOnlyProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
async function loaded(readOnly = false) {
  const view = render(subject(readOnly));
  await waitFor(() =>
    expect(view.container.querySelector("article")).toBeTruthy(),
  );
  return view;
}
function toggle(details: HTMLDetailsElement, open: boolean) {
  details.open = open;
  fireEvent(details, new Event("toggle"));
}
async function expand(container: HTMLElement) {
  const details = container.querySelector("details")!;
  toggle(details, true);
  await waitFor(() => expect(container.querySelector("form")).toBeTruthy());
  return details;
}
function fill(container: HTMLElement) {
  fireEvent.change(screen.getByLabelText(messages.corrections.reason), {
    target: { value: "Unsaved synthetic reason" },
  });
  fireEvent.change(screen.getByLabelText(messages.corrections.comments), {
    target: { value: "Unsaved synthetic note" },
  });
  return container.querySelector("form")!;
}
async function refresh(key: string) {
  await act(async () => {
    await client.invalidateQueries({
      queryKey:
        key === "rooms" ? fixture.roomsKey() : [["corrections", "patrols"]],
    });
  });
  // Query promises settle before notifyManager's scheduled observer callbacks.
  // Wait for the production hook to observe this exact cache revision before
  // asserting its DOM or issuing the next synthetic failure/recovery transition.
  const current = client.getQueryState(
    key === "rooms" ? fixture.roomsKey() : fixture.historyKey(),
  )!;
  await waitFor(() => {
    const observed =
      key === "rooms"
        ? fixture.observedRooms
        : fixture.observedHistory.get(null);
    expect(observed).toBeTruthy();
    expect(observed?.data).toBe(current.data);
    expect(observed?.error).toBe(current.error);
    expect(observed?.dataUpdatedAt).toBe(current.dataUpdatedAt);
    expect(observed?.errorUpdatedAt).toBe(current.errorUpdatedAt);
    expect(observed?.fetchStatus).toBe(current.fetchStatus);
    expect(observed?.status).toBe(current.status);
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  installSessionReadReceipts(client);
  fixture.rows = [patrol()];
  fixture.nextRows = [patrol("next-patrol")];
  fixture.rooms = [
    { id: "room", name: "Synthetic room" },
    { id: "other-room", name: "Other synthetic room" },
  ];
  fixture.readHistory.mockImplementation(async (input) =>
    input?.cursor ? fixture.nextRows : fixture.rows,
  );
  fixture.readTarget.mockImplementation(
    async ({ id }) =>
      [...fixture.rows, ...fixture.nextRows].find((row) => row.id === id) ??
      null,
  );
  fixture.readRooms.mockImplementation(async () => fixture.rooms);
  fixture.save.mockRejectedValue(new Error("Synthetic correction rejected"));
  fixture.observedRooms = null;
  fixture.observedHistory.clear();
});
afterEach(() => {
  cleanup();
  client.clear();
});

it.each(["en", "zh"] as const)(
  "localizes both retained stale-patrol errors in %s without replacing the draft or replaying its save",
  async (locale) => {
    const previousHref = window.location.href;
    const wireMessage = "Patrol changed. Reload before correcting it.";
    const localizedMessage = {
      en: wireMessage,
      zh: "巡查记录已变更。请重新加载后再更正。",
    };
    const catalogs = { en: messages, zh };
    client.clear();
    client = createQueryClient();
    client.setDefaultOptions({
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    });
    const write = deferred<{ ok: true }>();
    fixture.save.mockImplementation(() => write.promise);
    const show = (language: "en" | "zh") => (
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale={language}
          messages={catalogs[language]}
          timeZone="Asia/Shanghai"
        >
          <ReadOnlyProvider value={false}>
            <PatrolCorrections />
            <SaveNotifications />
          </ReadOnlyProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
    window.history.replaceState(null, "", "/admin/crew");
    try {
      const view = render(show(locale));
      await waitFor(() =>
        expect(view.container.querySelector("article")).toBeTruthy(),
      );
      await expand(view.container);
      const article = view.container.querySelector("article")!;
      const catalog = catalogs[locale];
      const form = article.querySelector("form")!;
      const note = within(article).getByLabelText<HTMLTextAreaElement>(
        catalog.corrections.comments,
      );
      const reason = within(article).getByLabelText<HTMLTextAreaElement>(
        catalog.corrections.reason,
      );
      const room = within(article).getByLabelText<HTMLSelectElement>(
        catalog.corrections.room,
      );
      const count = within(article).getByLabelText<HTMLSelectElement>(
        catalog.corrections.count,
      );
      const time = form.querySelector<HTMLInputElement>(
        "input[type='datetime-local']",
      )!;
      fireEvent.change(note, { target: { value: "Unsaved synthetic note" } });
      fireEvent.change(reason, {
        target: { value: "Unsaved synthetic reason" },
      });
      fireEvent.change(room, { target: { value: "other-room" } });
      fireEvent.change(count, { target: { value: "THREE" } });
      fireEvent.change(time, { target: { value: "2026-11-01T15:00" } });
      act(() => {
        fireEvent.submit(form);
        fireEvent.submit(form);
      });
      await waitFor(() => expect(fixture.save).toHaveBeenCalledOnce());
      expect(form.querySelector("fieldset")?.disabled).toBe(true);
      await act(async () => {
        write.reject(
          TRPCClientError.from<AppRouter>({
            error: {
              code: -32009,
              message: wireMessage,
              data: {
                code: "CONFLICT",
                path: "corrections.correctPatrol",
                httpStatus: 409,
              },
            },
          }),
        );
      });
      const expectRetained = (language: "en" | "zh") => {
        expect(within(article).getByRole("alert").textContent).toBe(
          localizedMessage[language],
        );
        const notice = view.container.querySelector("aside[role='alert']")!;
        expect(notice.querySelector("p")?.textContent).toBe(
          localizedMessage[language],
        );
        expect(screen.getAllByRole("alert")).toHaveLength(2);
        expect(note.value).toBe("Unsaved synthetic note");
        expect(reason.value).toBe("Unsaved synthetic reason");
        expect(room.value).toBe("other-room");
        expect(count.value).toBe("THREE");
        expect(time.value).toBe("2026-11-01T15:00");
        expect(fixture.save).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            expectedUpdatedAt: originalVersion,
            note: note.value,
            reason: reason.value,
            observations: [
              expect.objectContaining({
                roomId: room.value,
                headcount: count.value,
                observedAt: new Date("2026-11-01T07:00:00Z"),
              }),
            ],
          }),
          expect.anything(),
        );
        expect(fixture.readTarget).not.toHaveBeenCalled();
        expect(screen.queryByRole("status")).toBeNull();
      };
      await waitFor(() => expectRetained(locale));
      const otherLocale = locale === "en" ? "zh" : "en";
      view.rerender(show(otherLocale));
      expectRetained(otherLocale);
      view.rerender(show(locale));
      expectRetained(locale);
    } finally {
      window.history.replaceState(null, "", previousHref);
    }
  },
);

it("offers a named read-only Retry for an initial patrol history failure", async () => {
  fixture.readHistory.mockRejectedValue(
    new Error("Synthetic history unavailable"),
  );
  render(subject());
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.corrections.patrolHistory}`,
    }),
  );
  await waitFor(() =>
    expect(fixture.readHistory.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }).disabled,
    ).toBe(false),
  );
  expect(fixture.save).not.toHaveBeenCalled();
  fixture.readHistory.mockResolvedValue(fixture.rows);
  fireEvent.click(
    await screen.findByRole("button", {
      name: `Retry ${messages.corrections.patrolHistory}`,
    }),
  );
  await screen.findByText(/Synthetic crew/);
});

it("offers read-only room recovery inside the editor instead of an empty disclosure", async () => {
  fixture.readRooms.mockRejectedValue(new Error("Synthetic rooms unavailable"));
  const view = await loaded();
  toggle(view.container.querySelector("details")!, true);
  await screen.findByRole("alert");
  const retry = screen.getByRole("button", {
    name: `Retry ${messages.corrections.patrolRooms}`,
  });
  fixture.readRooms.mockResolvedValue(fixture.rooms);
  fireEvent.click(retry);
  await screen.findByLabelText(messages.corrections.reason);
  expect(fixture.save).not.toHaveBeenCalled();
});

it.each(["patrols", "rooms"])(
  "treats a successful null %s result as unavailable with read-only recovery",
  async (key) => {
    if (key === "patrols")
      fixture.readHistory.mockResolvedValue(null as unknown as Patrol[]);
    else
      fixture.readRooms.mockResolvedValue(
        null as unknown as typeof fixture.rooms,
      );
    const view = render(subject());
    if (key === "rooms") {
      await waitFor(() =>
        expect(view.container.querySelector("details")).toBeTruthy(),
      );
      toggle(view.container.querySelector("details")!, true);
    }
    await screen.findByRole("alert");
    expect(screen.queryByText(messages.corrections.empty)).toBeNull();
    expect(
      screen.getByRole("button", {
        name: `Retry ${key === "patrols" ? messages.corrections.patrolHistory : messages.corrections.patrolRooms}`,
      }),
    ).toBeTruthy();
    expect(fixture.save).not.toHaveBeenCalled();
  },
);

it.each(["patrols", "rooms"])(
  "retains the current draft when a background %s response is null",
  async (key) => {
    const view = await loaded();
    await expand(view.container);
    const form = fill(view.container);
    if (key === "patrols")
      fixture.readHistory.mockResolvedValue(null as unknown as Patrol[]);
    else
      fixture.readRooms.mockResolvedValue(
        null as unknown as typeof fixture.rooms,
      );
    await refresh(key);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
        .value,
    ).toBe("Unsaved synthetic reason");
    fireEvent.submit(form);
    expect(fixture.save).not.toHaveBeenCalled();
  },
);

it("retains every correction field and its original version after a changed background patrol read", async () => {
  const view = await loaded();
  await expand(view.container);
  const form = fill(view.container);
  fireEvent.change(screen.getByLabelText(messages.corrections.room), {
    target: { value: "other-room" },
  });
  fireEvent.change(screen.getByLabelText(messages.corrections.count), {
    target: { value: "THREE" },
  });
  const time = form.querySelector<HTMLInputElement>(
    "input[type='datetime-local']",
  )!;
  fireEvent.change(time, { target: { value: "2026-11-01T15:00" } });
  fixture.rows = [
    {
      ...patrol(),
      updatedAt: newerVersion,
      note: "Another manager's saved note",
    },
  ];
  await refresh("patrols");
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
      .value,
  ).toBe("Unsaved synthetic reason");
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.comments)
      .value,
  ).toBe("Unsaved synthetic note");
  expect(
    screen.getByLabelText<HTMLSelectElement>(messages.corrections.room).value,
  ).toBe("other-room");
  expect(
    screen.getByLabelText<HTMLSelectElement>(messages.corrections.count).value,
  ).toBe("THREE");
  expect(time.value).toBe("2026-11-01T15:00");
  await act(async () => {
    fireEvent.submit(form);
  });
  expect(fixture.save).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedUpdatedAt: originalVersion,
      reason: "Unsaved synthetic reason",
      note: "Unsaved synthetic note",
      observations: [
        expect.objectContaining({
          roomId: "other-room",
          headcount: "THREE",
          observedAt: new Date("2026-11-01T07:00:00Z"),
        }),
      ],
    }),
    expect.anything(),
  );
});

it.each(["patrols", "rooms"])(
  "retains a cached draft and fences Save after a failed %s read until read-only Retry succeeds",
  async (key) => {
    const view = await loaded();
    await expand(view.container);
    const form = fill(view.container);
    const read = key === "patrols" ? fixture.readHistory : fixture.readRooms;
    read.mockRejectedValue(new Error("Synthetic background read failed"));
    await refresh(key);
    await screen.findByRole("alert");
    expect(
      screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
        .value,
    ).toBe("Unsaved synthetic reason");
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.corrections.save,
      }).disabled,
    ).toBe(true);
    fireEvent.submit(form);
    expect(fixture.save).not.toHaveBeenCalled();
    if (key === "patrols") fixture.readHistory.mockResolvedValue(fixture.rows);
    else fixture.readRooms.mockResolvedValue(fixture.rooms);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Retry ${key === "patrols" ? messages.corrections.patrolHistory : messages.corrections.patrolRooms}`,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(
      screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
        .value,
    ).toBe("Unsaved synthetic reason");
    expect(fixture.save).not.toHaveBeenCalled();
  },
);

it("conceals a denied room editor through later transport/null failures and restores its retained fields only after fresh authorization", async () => {
  const view = await loaded();
  await expand(view.container);
  fill(view.container);
  fixture.readRooms.mockRejectedValue(accessDenied());
  await refresh("rooms");
  expect(screen.queryByLabelText(messages.corrections.reason)).toBeNull();
  fixture.readRooms.mockRejectedValue(
    new Error("Synthetic network failure after denial"),
  );
  await refresh("rooms");
  expect(screen.queryByLabelText(messages.corrections.reason)).toBeNull();
  fixture.readRooms.mockResolvedValue(null as unknown as typeof fixture.rooms);
  await refresh("rooms");
  expect(screen.queryByLabelText(messages.corrections.reason)).toBeNull();
  fixture.readRooms.mockResolvedValue(fixture.rooms);
  await refresh("rooms");
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
      .value,
  ).toBe("Unsaved synthetic reason");
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.comments)
      .value,
  ).toBe("Unsaved synthetic note");
  expect(fixture.save).not.toHaveBeenCalled();
});

it("retains room denial across history-denial unmounts until the remounted editor freshly authorizes its rooms", async () => {
  const view = await loaded();
  await expand(view.container);
  fill(view.container);
  fixture.readRooms.mockRejectedValue(accessDenied());
  await refresh("rooms");
  fixture.readRooms.mockRejectedValue(
    new Error("Synthetic transport failure after room denial"),
  );
  await refresh("rooms");
  expect(screen.queryByLabelText(messages.corrections.reason)).toBeNull();
  fixture.readHistory.mockRejectedValue(accessDenied());
  await refresh("patrols");
  expect(screen.queryByText(/Synthetic crew/)).toBeNull();
  fixture.readHistory.mockResolvedValue(fixture.rows);
  await refresh("patrols");
  await waitFor(() =>
    expect(view.container.querySelector("details")).toBeTruthy(),
  );
  toggle(view.container.querySelector("details")!, true);
  await screen.findByRole("button", {
    name: `Retry ${messages.corrections.patrolRooms}`,
  });
  expect(screen.queryByLabelText(messages.corrections.reason)).toBeNull();
  fixture.readRooms.mockResolvedValue(null as unknown as typeof fixture.rooms);
  await refresh("rooms");
  expect(screen.queryByLabelText(messages.corrections.reason)).toBeNull();
  fixture.readRooms.mockResolvedValue(fixture.rooms);
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.corrections.patrolRooms}`,
    }),
  );
  await screen.findByLabelText(messages.corrections.reason);
  expect(fixture.save).not.toHaveBeenCalled();
});

it("replaces a draft/version only after explicit Reload successfully reads both the matching patrol and rooms", async () => {
  const view = await loaded();
  await expand(view.container);
  fill(view.container);
  fixture.rows = [
    { ...patrol(), updatedAt: newerVersion, note: "New stored note" },
  ];
  const roomRead = deferred<typeof fixture.rooms>();
  fixture.readRooms.mockImplementation(() => roomRead.promise);
  fireEvent.click(
    screen.getByRole("button", { name: messages.corrections.reloadPatrol }),
  );
  await waitFor(() =>
    expect(fixture.readHistory.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
      .value,
  ).toBe("Unsaved synthetic reason");
  await act(async () => {
    roomRead.reject(new Error("Synthetic room reload failed"));
  });
  await screen.findByText(messages.corrections.patrolReloadFailed);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.comments)
      .value,
  ).toBe("Unsaved synthetic note");
  fixture.readRooms.mockResolvedValue(fixture.rooms);
  fireEvent.click(
    screen.getByRole("button", { name: messages.corrections.reloadPatrol }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
        .value,
    ).toBe(""),
  );
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.comments)
      .value,
  ).toBe("New stored note");
  fireEvent.change(screen.getByLabelText(messages.corrections.reason), {
    target: { value: "Fresh explicit correction" },
  });
  await act(async () => {
    fireEvent.submit(view.container.querySelector("form")!);
  });
  expect(fixture.save).toHaveBeenCalledWith(
    expect.objectContaining({ expectedUpdatedAt: newerVersion }),
    expect.anything(),
  );
});

it("never adopts a different patrol when the exact target read cannot find the captured id", async () => {
  const view = await loaded();
  await expand(view.container);
  fill(view.container);
  fixture.rows = [
    {
      ...patrol("unrelated-patrol"),
      updatedAt: newerVersion,
      note: "Unrelated stored note",
    },
  ];
  fireEvent.click(
    screen.getByRole("button", { name: messages.corrections.reloadPatrol }),
  );
  await screen.findByText(messages.corrections.patrolReloadFailed);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
      .value,
  ).toBe("Unsaved synthetic reason");
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.comments)
      .value,
  ).toBe("Unsaved synthetic note");
  expect(fixture.save).not.toHaveBeenCalled();
});

it("keeps the draft's captured program timezone and repeated-hour instant when the live timezone changes", async () => {
  const view = render(subject(false, vi.fn(), "America/New_York"));
  await waitFor(() =>
    expect(view.container.querySelector("article")).toBeTruthy(),
  );
  await expand(view.container);
  const form = fill(view.container);
  view.rerender(subject(false, vi.fn(), "Asia/Shanghai"));
  expect(
    form.querySelector<HTMLInputElement>("input[type='datetime-local']")!.value,
  ).toBe("2026-11-01T01:30");
  await act(async () => {
    fireEvent.submit(form);
  });
  expect(fixture.save).toHaveBeenCalledWith(
    expect.objectContaining({
      observations: [expect.objectContaining({ observedAt: originalVersion })],
    }),
    expect.anything(),
  );
});

it("preserves the draft across native close/reopen and paging to another patrol context", async () => {
  fixture.rows = Array.from({ length: 50 }, (_, index) =>
    patrol(index ? `page-row-${index}` : "synthetic-patrol"),
  );
  const view = await loaded();
  const details = await expand(view.container);
  fill(view.container);
  toggle(details, false);
  toggle(details, true);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
      .value,
  ).toBe("Unsaved synthetic reason");
  fireEvent.click(
    screen.getByRole("button", { name: messages.corrections.older }),
  );
  await waitFor(() =>
    expect(client.getQueryData(fixture.historyKey("page-row-49"))).toBeTruthy(),
  );
  expect(details.closest("article")!.hidden).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: messages.corrections.newer }),
  );
  await waitFor(() => expect(details.closest("article")!.hidden).toBe(false));
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
      .value,
  ).toBe("Unsaved synthetic reason");
  expect(fixture.save).not.toHaveBeenCalled();
});

it("admits one same-turn write and prevents native collapse or paging while it remains pending", async () => {
  fixture.rows = Array.from({ length: 50 }, (_, index) =>
    patrol(index ? `page-row-${index}` : "synthetic-patrol"),
  );
  const write = deferred<{ ok: true }>();
  fixture.save.mockImplementation(() => write.promise);
  const view = await loaded();
  const details = await expand(view.container);
  const form = fill(view.container);
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
    toggle(details, false);
    fireEvent.click(
      screen.getByRole("button", { name: messages.corrections.older }),
    );
  });
  expect(details.open).toBe(true);
  expect(
    client.getQueryData(fixture.historyKey("page-row-49")),
  ).toBeUndefined();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.corrections.older,
    }).disabled,
  ).toBe(true);
  await waitFor(() => expect(fixture.save).toHaveBeenCalledOnce());
  await act(async () => {
    write.reject(new Error("Synthetic rejection"));
  });
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.corrections.save,
      }).disabled,
    ).toBe(false),
  );
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
      .value,
  ).toBe("Unsaved synthetic reason");
});

it("waits for every active QueryClient history variant and recovers accepted writes through reads only", async () => {
  const siblingRead = vi.fn(async () => fixture.nextRows);
  const observer = new QueryObserver(client, {
    queryKey: fixture.historyKey("sibling"),
    queryFn: siblingRead,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await observer.refetch();
  const view = await loaded();
  const details = await expand(view.container);
  const form = fill(view.container);
  const siblingGate = deferred<Patrol[]>();
  siblingRead.mockClear();
  siblingRead.mockImplementation(() => siblingGate.promise);
  fixture.save.mockResolvedValue({ ok: true });
  fixture.readHistory.mockRejectedValue(
    new Error("Synthetic accepted-save read failure"),
  );
  fireEvent.submit(form);
  await waitFor(() => expect(fixture.save).toHaveBeenCalledOnce());
  await waitFor(() => expect(siblingRead).toHaveBeenCalledOnce());
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.corrections.save,
    }).disabled,
  ).toBe(true);
  toggle(details, false);
  expect(details.open).toBe(true);
  await act(async () => {
    siblingGate.resolve(fixture.nextRows);
  });
  await screen.findByText(messages.corrections.patrolSavedRefreshFailed);
  fireEvent.submit(form);
  expect(fixture.save).toHaveBeenCalledOnce();
  fixture.rows = [
    { ...patrol(), updatedAt: newerVersion, note: "Accepted stored note" },
  ];
  fixture.readHistory.mockResolvedValue(fixture.rows);
  siblingRead.mockResolvedValue(fixture.nextRows);
  fireEvent.click(
    screen
      .getAllByRole("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      })
      .at(-1)!,
  );
  await waitFor(() =>
    expect(
      screen.queryByText(messages.corrections.patrolSavedRefreshFailed),
    ).toBeNull(),
  );
  expect(fixture.save).toHaveBeenCalledOnce();
  expect(details.open).toBe(false);
  unsubscribe();
});

it("starts QueryClient invalidation before its explicit origin read so default cancellation cannot cause a false refresh failure", async () => {
  const view = await loaded();
  const details = await expand(view.container);
  const form = fill(view.container);
  const history = deferred<Patrol[]>();
  fixture.save.mockResolvedValue({ ok: true });
  fixture.readHistory.mockImplementation(() => history.promise);
  fireEvent.submit(form);
  await waitFor(() =>
    expect(fixture.readRooms.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  expect(fixture.readHistory).toHaveBeenCalledTimes(2);
  await act(async () => {
    history.resolve([{ ...patrol(), updatedAt: newerVersion }]);
  });
  await waitFor(() => expect(details.open).toBe(false));
  expect(
    screen.queryByText(messages.corrections.patrolSavedRefreshFailed),
  ).toBeNull();
  expect(fixture.save).toHaveBeenCalledOnce();
});

it("keeps an accepted receipt and captured draft visible when a refreshed page no longer contains that patrol", async () => {
  const view = await loaded();
  await expand(view.container);
  const form = fill(view.container);
  fixture.save.mockResolvedValue({ ok: true });
  fixture.rows = [];
  fireEvent.submit(form);
  await screen.findByText(messages.corrections.patrolSavedRefreshFailed);
  expect(view.container.querySelector("article")!.hidden).toBe(false);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
      .value,
  ).toBe("Unsaved synthetic reason");
  fireEvent.submit(form);
  expect(fixture.save).toHaveBeenCalledOnce();
  fixture.rows = [{ ...patrol(), updatedAt: newerVersion }];
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.corrections.patrolHistory}`,
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(messages.corrections.patrolSavedRefreshFailed),
    ).toBeNull(),
  );
  expect(fixture.save).toHaveBeenCalledOnce();
});

it("treats a queued correction as an accepted proposal and retries failed synchronization without resubmitting it", async () => {
  const view = await loaded();
  await expand(view.container);
  const form = fill(view.container);
  fixture.save.mockRejectedValue(
    Object.assign(new Error("Synthetic queued correction"), {
      data: { approvalId: "synthetic-approval" },
    }),
  );
  fixture.readHistory.mockRejectedValue(
    new Error("Synthetic proposal refresh failed"),
  );
  fireEvent.submit(form);
  await screen.findByText(messages.corrections.patrolQueuedRefreshFailed);
  fireEvent.submit(form);
  expect(fixture.save).toHaveBeenCalledOnce();
  fixture.readHistory.mockResolvedValue(fixture.rows);
  fireEvent.click(
    screen
      .getAllByRole("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      })
      .at(-1)!,
  );
  await waitFor(() =>
    expect(
      screen.queryByText(messages.corrections.patrolQueuedRefreshFailed),
    ).toBeNull(),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.corrections.save,
    }).disabled,
  ).toBe(true);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
      .value,
  ).toBe("Unsaved synthetic reason");
  expect(fixture.save).toHaveBeenCalledOnce();
});

it.each(["pending", "accepted"])(
  "retains read-only accepted recovery after history denial unmounts a %s editor and fresh authorization remounts it",
  async (phase) => {
    const write = deferred<{ ok: true }>();
    fixture.save.mockImplementation(() => write.promise);
    const view = await loaded();
    await expand(view.container);
    const form = fill(view.container);
    if (phase === "accepted")
      fixture.readHistory.mockRejectedValue(
        new Error("Synthetic refresh failed"),
      );
    fireEvent.submit(form);
    await waitFor(() => expect(fixture.save).toHaveBeenCalledOnce());
    if (phase === "accepted") {
      await act(async () => {
        write.resolve({ ok: true });
      });
      await screen.findByText(messages.corrections.patrolSavedRefreshFailed);
    }
    fixture.readHistory.mockRejectedValue(accessDenied());
    await refresh("patrols");
    await waitFor(() =>
      expect(screen.queryByText(/Synthetic crew/)).toBeNull(),
    );
    if (phase === "pending") {
      fixture.readHistory.mockRejectedValue(
        new Error("Synthetic network failure after denial"),
      );
      await act(async () => {
        write.resolve({ ok: true });
      });
    }
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: `Retry ${messages.corrections.patrolHistory}`,
        }).disabled,
      ).toBe(false),
    );
    expect(screen.queryByText(/Synthetic crew/)).toBeNull();
    fixture.rows = [{ ...patrol(), updatedAt: newerVersion }];
    fixture.readHistory.mockResolvedValue(fixture.rows);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }),
    );
    await screen.findByText(messages.corrections.patrolSavedRefreshFailed);
    expect(view.container.querySelector("details")!.open).toBe(false);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(messages.corrections.patrolSavedRefreshFailed),
      ).toBeNull(),
    );
    expect(fixture.save).toHaveBeenCalledOnce();
  },
);

it("keeps a removed selected room explicit and gates Save until an available choice is deliberate", async () => {
  const view = await loaded();
  await expand(view.container);
  const form = fill(view.container);
  fixture.rooms = [{ id: "other-room", name: "Other synthetic room" }];
  await refresh("rooms");
  expect(
    screen.getByLabelText<HTMLSelectElement>(messages.corrections.room).value,
  ).toBe("room");
  expect(
    screen.getByRole("option", { name: "Synthetic room (unavailable)" }),
  ).toBeTruthy();
  fireEvent.submit(form);
  expect(fixture.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(messages.corrections.room), {
    target: { value: "other-room" },
  });
  await act(async () => {
    fireEvent.submit(form);
  });
  expect(fixture.save).toHaveBeenCalledWith(
    expect.objectContaining({
      observations: [expect.objectContaining({ roomId: "other-room" })],
    }),
    expect.anything(),
  );
});

it("keeps observers read-only and does not call the private room reader", async () => {
  const view = await loaded(true);
  expect(view.container.querySelector("details")).toBeNull();
  expect(fixture.readRooms).not.toHaveBeenCalled();
  expect(fixture.save).not.toHaveBeenCalled();
});

it("does not label a failed cached empty read as a current empty result", async () => {
  fixture.rows = [];
  render(subject());
  await screen.findByText(messages.corrections.empty);
  fixture.readHistory.mockRejectedValue(
    new Error("Synthetic empty refresh failed"),
  );
  await refresh("patrols");
  expect(screen.queryByText(messages.corrections.empty)).toBeNull();
  expect(screen.getByRole("alert")).toBeTruthy();
});
