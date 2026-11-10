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
import messages from "../../../messages/en.json";
import {
  getSessionReadReceipts,
  installSessionReadReceipts,
} from "~/lib/session-read-receipts";

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
type Rooms = { id: string; name: string }[];
type ReadState = {
  data: unknown;
  error: unknown;
  status: string;
  fetchStatus: string;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
};
const fixture = vi.hoisted(() => ({
  records: [] as Patrol[],
  rooms: [] as Rooms,
  pages: [] as Patrol[][],
  readHistory: vi.fn<(input?: { cursor?: string }) => Promise<Patrol[]>>(),
  readTarget:
    vi.fn<(input: { id: string }) => Promise<Patrol | null | undefined>>(),
  readRooms: vi.fn<() => Promise<Rooms>>(),
  save: vi.fn<(input: unknown) => Promise<{ ok: true }>>(),
  historyState: null as ReadState | null,
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
        const invalidate =
          (queryKey: string[][]) =>
          (
            _input: undefined,
            filters?: Pick<QueryFilters, "predicate">,
            options?: { throwOnError?: boolean },
          ) =>
            client.invalidateQueries({ queryKey, ...filters }, options);
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
            patrols: { invalidate: invalidate([["corrections", "patrols"]]) },
            patrolById: {
              invalidate: invalidate([["corrections", "patrolById"]]),
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
          useQuery: (_input: undefined, options: { enabled: boolean }) =>
            useQuery({
              queryKey: fixture.roomsKey(),
              queryFn: () => fixture.readRooms(),
              ...options,
            }),
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
            if (!input.cursor) fixture.historyState = result;
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

let client: QueryClient;
const originalVersion = new Date("2026-11-01T06:30:00Z");
const freshVersion = new Date("2026-11-01T07:30:00Z");
const targetId = "synthetic-patrol-000";
const targetCrew = "Private synthetic target crew";
const targetRoom = "Private synthetic target room";
const draftNote = "Private unsaved synthetic note";
const draftReason = "Private unsaved synthetic reason";
function patrol(index: number): Patrol {
  const id = `synthetic-patrol-${String(index).padStart(3, "0")}`;
  return {
    id,
    createdAt: new Date(originalVersion.getTime() + index * 60_000),
    updatedAt: originalVersion,
    hours: 0.5,
    note: `Stored synthetic note ${index}`,
    crewUser: { name: index === 0 ? targetCrew : `Synthetic crew ${index}` },
    observations: [
      {
        id: `observation-${id}`,
        roomId: "room",
        room: { name: index === 0 ? targetRoom : "Synthetic room" },
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
function failure(code: string) {
  return Object.assign(new Error(`Synthetic ${code} read`), { data: { code } });
}
function subject(readOnly = false, timeZone = "Asia/Shanghai") {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={messages}
        timeZone={timeZone}
      >
        <ReadOnlyProvider value={readOnly}>
          <PatrolCorrections />
        </ReadOnlyProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
async function loaded(readOnly = false, timeZone?: string) {
  const view = render(subject(readOnly, timeZone));
  await screen.findByText(new RegExp(targetCrew));
  return view;
}
function targetArticle() {
  return screen.getByText(new RegExp(targetCrew)).closest("article")!;
}
function toggle(details: HTMLDetailsElement, open: boolean) {
  details.open = open;
  fireEvent(details, new Event("toggle"));
}
async function edit() {
  const article = targetArticle();
  const details = article.querySelector("details")!;
  toggle(details, true);
  await waitFor(() => expect(article.querySelector("form")).toBeTruthy());
  fireEvent.change(
    within(article).getByLabelText(messages.corrections.comments),
    { target: { value: draftNote } },
  );
  fireEvent.change(
    within(article).getByLabelText(messages.corrections.reason),
    { target: { value: draftReason } },
  );
  return { article, details, form: article.querySelector("form")! };
}
async function refreshHistory() {
  await act(async () => {
    await client.invalidateQueries({ queryKey: [["corrections", "patrols"]] });
  });
  const state = client.getQueryState(fixture.historyKey())!;
  await waitFor(() => {
    expect(fixture.historyState?.data).toBe(state.data);
    expect(fixture.historyState?.error).toBe(state.error);
    expect(fixture.historyState?.status).toBe(state.status);
    expect(fixture.historyState?.fetchStatus).toBe(state.fetchStatus);
    expect(fixture.historyState?.dataUpdatedAt).toBe(state.dataUpdatedAt);
    expect(fixture.historyState?.errorUpdatedAt).toBe(state.errorUpdatedAt);
  });
}
function moveTargetBeyondNewestPage() {
  fixture.records = fixture.records.map((row) =>
    row.id === targetId
      ? {
          ...row,
          updatedAt: freshVersion,
          note: "Fresh stored target note",
          observations: row.observations.map((observation) => ({
            ...observation,
            headcount: "THREE",
            room: { name: "Fresh synthetic target room" },
          })),
        }
      : row,
  );
  fixture.records.push(patrol(50));
}
function expectDraft(article: HTMLElement) {
  expect(
    within(article).getByLabelText<HTMLTextAreaElement>(
      messages.corrections.reason,
    ).value,
  ).toBe(draftReason);
  expect(
    within(article).getByLabelText<HTMLTextAreaElement>(
      messages.corrections.comments,
    ).value,
  ).toBe(draftNote);
}
function expectPrivateAbsent(container: HTMLElement) {
  expect(container.textContent).not.toContain(targetCrew);
  expect(container.textContent).not.toContain(targetRoom);
  expect(container.textContent).not.toContain(targetId);
  expect(container.textContent).not.toContain(draftNote);
  expect(container.textContent).not.toContain(draftReason);
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector("textarea")).toBeNull();
  expect(container.querySelector("input[type='datetime-local']")).toBeNull();
}
const rejectedTargets = [
  "null",
  "undefined",
  "wrong id",
  "NOT_FOUND",
  "transport",
] as const;
function rejectTarget(kind: (typeof rejectedTargets)[number]) {
  if (kind === "null") fixture.readTarget.mockResolvedValue(null);
  else if (kind === "undefined")
    fixture.readTarget.mockResolvedValue(undefined);
  else if (kind === "wrong id")
    fixture.readTarget.mockResolvedValue({
      ...patrol(1),
      updatedAt: freshVersion,
      note: "Wrong target note",
    });
  else
    fixture.readTarget.mockRejectedValue(
      kind === "NOT_FOUND"
        ? failure(kind)
        : new Error("Synthetic target transport failure"),
    );
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
  fixture.records = Array.from({ length: 50 }, (_, index) => patrol(index));
  fixture.rooms = [
    { id: "room", name: "Synthetic room" },
    { id: "other-room", name: "Other synthetic room" },
  ];
  fixture.pages = [];
  fixture.historyState = null;
  fixture.readHistory.mockImplementation(async (input) => {
    // Match the real discovery ordering and bounded cursor page, rather than
    // special-casing the target into whichever response recovery requests.
    const sorted = [...fixture.records].sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id),
    );
    const start = input?.cursor
      ? sorted.findIndex((row) => row.id === input.cursor) + 1
      : 0;
    const rows = sorted.slice(start, start + 50);
    fixture.pages.push(rows);
    return rows;
  });
  fixture.readTarget.mockImplementation(
    async ({ id }) => fixture.records.find((row) => row.id === id) ?? null,
  );
  fixture.readRooms.mockImplementation(async () => fixture.rooms);
  fixture.save.mockRejectedValue(new Error("Synthetic correction rejected"));
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it("reloads a captured ID after a real 51st arrival permanently removes it from its original newest page", async () => {
  await loaded();
  const { article, form } = await edit();
  moveTargetBeyondNewestPage();
  await refreshHistory();
  const page = client.getQueryData<Patrol[]>(fixture.historyKey())!;
  expect(fixture.records).toHaveLength(51);
  expect(page).toHaveLength(50);
  expect(page[0]!.id).toBe("synthetic-patrol-050");
  expect(page.some((row) => row.id === targetId)).toBe(false);
  expect(fixture.records.some((row) => row.id === targetId)).toBe(true);
  expectDraft(article);
  expect(fixture.readTarget).not.toHaveBeenCalled();
  fireEvent.click(
    within(article).getByRole("button", {
      name: messages.corrections.reloadPatrol,
    }),
  );
  await waitFor(() =>
    expect(
      within(article).getByLabelText<HTMLTextAreaElement>(
        messages.corrections.reason,
      ).value,
    ).toBe(""),
  );
  expect(
    within(article).getByLabelText<HTMLTextAreaElement>(
      messages.corrections.comments,
    ).value,
  ).toBe("Fresh stored target note");
  expect(
    within(article).getByText("Fresh synthetic target room: 3"),
  ).toBeTruthy();
  expect(fixture.readTarget).toHaveBeenCalledWith({ id: targetId });
  expect(
    fixture.readHistory.mock.calls.every(
      ([input]) => input?.cursor === undefined,
    ),
  ).toBe(true);
  expect(
    fixture.pages
      .slice(1)
      .every((rows) => rows.every((row) => row.id !== targetId)),
  ).toBe(true);
  fireEvent.change(
    within(article).getByLabelText(messages.corrections.reason),
    { target: { value: "Fresh deliberate correction" } },
  );
  await act(async () => {
    fireEvent.submit(article.querySelector("form")!);
  });
  expect(fixture.save).toHaveBeenCalledWith(
    expect.objectContaining({ id: targetId, expectedUpdatedAt: freshVersion }),
    expect.anything(),
  );
  expect(form.isConnected).toBe(false);
});

it("synchronizes an accepted save by captured ID while its original 50-row page stays permanently target-free", async () => {
  await loaded();
  const { article, details, form } = await edit();
  fixture.save.mockResolvedValue({ ok: true });
  moveTargetBeyondNewestPage();
  fireEvent.submit(form);
  await waitFor(() => {
    expect(details.open).toBe(false);
    expect(
      details.querySelector("summary")?.getAttribute("aria-disabled"),
    ).toBe("false");
  });
  expect(fixture.save).toHaveBeenCalledOnce();
  expect(fixture.readTarget).toHaveBeenCalledWith({ id: targetId });
  expect(
    client
      .getQueryData<Patrol[]>(fixture.historyKey())!
      .some((row) => row.id === targetId),
  ).toBe(false);
  expect(
    fixture.pages
      .slice(1)
      .every((rows) => rows.every((row) => row.id !== targetId)),
  ).toBe(true);
  toggle(details, true);
  const roomRead = client
    .getQueryCache()
    .find({ queryKey: fixture.roomsKey(), exact: true });
  const pendingRooms = roomRead?.promise;
  if (!roomRead || !pendingRooms)
    throw new Error("Expected the reopened editor's existing rooms read");
  await act(async () => {
    await pendingRooms;
  });
  expect(roomRead.state.status).toBe("success");
  expect(roomRead.state.fetchStatus).toBe("idle");
  expect(
    within(article).getByLabelText<HTMLTextAreaElement>(
      messages.corrections.comments,
    ).value,
  ).toBe("Fresh stored target note");
  expect(
    within(article).getByLabelText<HTMLTextAreaElement>(
      messages.corrections.reason,
    ).value,
  ).toBe("");
  expect(fixture.save).toHaveBeenCalledOnce();
});

it("updates a retained off-page observation summary only after the saved target is explicitly synchronized", async () => {
  await loaded();
  const { article, form, details } = await edit();
  moveTargetBeyondNewestPage();
  await refreshHistory();
  expect(within(article).getByText(`${targetRoom}: 1`)).toBeTruthy();
  expect(
    within(article).queryByText("Fresh synthetic target room: 3"),
  ).toBeNull();
  expectDraft(article);
  fixture.save.mockResolvedValue({ ok: true });
  fireEvent.submit(form);
  await waitFor(() => expect(details.open).toBe(false));
  expect(
    within(article).getByText("Fresh synthetic target room: 3"),
  ).toBeTruthy();
  expect(within(article).queryByText(`${targetRoom}: 1`)).toBeNull();
  expect(
    client
      .getQueryData<Patrol[]>(fixture.historyKey())!
      .some((row) => row.id === targetId),
  ).toBe(false);
  expect(fixture.save).toHaveBeenCalledOnce();
});

it.each(rejectedTargets)(
  "retains all fields and original version after a %s exact Reload result with a successful target-free page",
  async (kind) => {
    await loaded();
    const { article, form } = await edit();
    fireEvent.change(
      within(article).getByLabelText(messages.corrections.room),
      { target: { value: "other-room" } },
    );
    fireEvent.change(
      within(article).getByLabelText(messages.corrections.count),
      { target: { value: "THREE" } },
    );
    fireEvent.change(form.querySelector("input[type='datetime-local']")!, {
      target: { value: "2026-11-01T15:00" },
    });
    moveTargetBeyondNewestPage();
    rejectTarget(kind);
    fireEvent.click(
      within(article).getByRole("button", {
        name: messages.corrections.reloadPatrol,
      }),
    );
    await screen.findByText(messages.corrections.patrolReloadFailed);
    expectDraft(article);
    expect(
      within(article).getByLabelText<HTMLSelectElement>(
        messages.corrections.room,
      ).value,
    ).toBe("other-room");
    expect(
      within(article).getByLabelText<HTMLSelectElement>(
        messages.corrections.count,
      ).value,
    ).toBe("THREE");
    expect(
      form.querySelector<HTMLInputElement>("input[type='datetime-local']")!
        .value,
    ).toBe("2026-11-01T15:00");
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(fixture.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: targetId,
        expectedUpdatedAt: originalVersion,
        note: draftNote,
        reason: draftReason,
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
  },
);

it.each(rejectedTargets)(
  "keeps a saved acceptance fenced after a %s exact synchronization result and retries only reads",
  async (kind) => {
    await loaded();
    const { article, form, details } = await edit();
    fixture.save.mockResolvedValue({ ok: true });
    moveTargetBeyondNewestPage();
    rejectTarget(kind);
    fireEvent.submit(form);
    await screen.findByText(messages.corrections.patrolSavedRefreshFailed);
    expectDraft(article);
    fireEvent.submit(form);
    expect(fixture.save).toHaveBeenCalledOnce();
    fixture.readTarget.mockImplementation(async ({ id }) =>
      fixture.records.find((row) => row.id === id),
    );
    fireEvent.click(
      within(article).getByRole("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }),
    );
    await waitFor(() => expect(details.open).toBe(false));
    expect(
      screen.queryByText(messages.corrections.patrolSavedRefreshFailed),
    ).toBeNull();
    expect(fixture.save).toHaveBeenCalledOnce();
    expect(
      client
        .getQueryData<Patrol[]>(fixture.historyKey())!
        .some((row) => row.id === targetId),
    ).toBe(false);
  },
);

it.each(["null", "transport"])(
  "does not adopt a fresh exact version while the paired rooms read is %s",
  async (kind) => {
    await loaded();
    const { article } = await edit();
    moveTargetBeyondNewestPage();
    if (kind === "null")
      fixture.readRooms.mockResolvedValue(null as unknown as Rooms);
    else
      fixture.readRooms.mockRejectedValue(
        new Error("Synthetic room read failure"),
      );
    fireEvent.click(
      within(article).getByRole("button", {
        name: messages.corrections.reloadPatrol,
      }),
    );
    await screen.findByText(messages.corrections.patrolReloadFailed);
    expectDraft(article);
    expect(fixture.readTarget).toHaveBeenCalledWith({ id: targetId });
    expect(fixture.save).not.toHaveBeenCalled();
  },
);

it("waits for active history and exact-query invalidations even after another exact target read fails", async () => {
  const listRead = vi.fn(async () => [patrol(1)]);
  const exactRead = vi.fn(async () => patrol(1));
  const listObserver = new QueryObserver(client, {
    queryKey: fixture.historyKey("sibling"),
    queryFn: listRead,
  });
  const exactObserver = new QueryObserver(client, {
    queryKey: fixture.targetKey("other-target"),
    queryFn: exactRead,
  });
  const stopList = listObserver.subscribe(() => undefined);
  const stopExact = exactObserver.subscribe(() => undefined);
  await Promise.all([listObserver.refetch(), exactObserver.refetch()]);
  try {
    await loaded();
    const { article, form, details } = await edit();
    const listGate = deferred<Patrol[]>();
    const exactGate = deferred<Patrol>();
    listRead.mockImplementation(() => listGate.promise);
    exactRead.mockImplementation(() => exactGate.promise);
    fixture.save.mockResolvedValue({ ok: true });
    fixture.readTarget.mockRejectedValue(
      new Error("Synthetic captured target read failure"),
    );
    fireEvent.submit(form);
    await waitFor(() => expect(fixture.readTarget).toHaveBeenCalledOnce());
    expect(
      within(article).getByRole<HTMLButtonElement>("button", {
        name: messages.corrections.save,
      }).disabled,
    ).toBe(true);
    toggle(details, false);
    expect(details.open).toBe(true);
    await act(async () => {
      listGate.resolve([patrol(1)]);
    });
    expect(
      screen.queryByText(messages.corrections.patrolSavedRefreshFailed),
    ).toBeNull();
    expect(
      within(article).getByRole<HTMLButtonElement>("button", {
        name: messages.corrections.save,
      }).disabled,
    ).toBe(true);
    await act(async () => {
      exactGate.resolve(patrol(1));
    });
    await screen.findByText(messages.corrections.patrolSavedRefreshFailed);
    expect(fixture.save).toHaveBeenCalledOnce();
  } finally {
    stopList();
    stopExact();
  }
});

it.each(["history", "exact"])(
  "retains accepted draft ownership when fresh paired reads succeed but an active %s invalidation fails",
  async (kind) => {
    const siblingRead = vi.fn(async () =>
      kind === "history" ? [patrol(1)] : patrol(1),
    );
    const observer = new QueryObserver(client, {
      queryKey:
        kind === "history"
          ? fixture.historyKey("sibling")
          : fixture.targetKey("other-target"),
      queryFn: siblingRead,
    });
    const stop = observer.subscribe(() => undefined);
    await observer.refetch();
    try {
      await loaded();
      const { article, form, details } = await edit();
      fixture.save.mockResolvedValue({ ok: true });
      moveTargetBeyondNewestPage();
      siblingRead.mockRejectedValue(
        new Error("Synthetic active sibling refresh failure"),
      );
      fireEvent.submit(form);
      await screen.findByText(messages.corrections.patrolSavedRefreshFailed);
      expectDraft(article);
      expect(fixture.readTarget).toHaveBeenCalledWith({ id: targetId });
      expect(
        within(article).getByRole<HTMLButtonElement>("button", {
          name: messages.corrections.save,
        }).disabled,
      ).toBe(true);
      siblingRead.mockResolvedValue(
        kind === "history" ? [patrol(1)] : patrol(1),
      );
      fireEvent.click(
        within(article).getByRole("button", {
          name: `Retry ${messages.corrections.patrolHistory}`,
        }),
      );
      await waitFor(() => expect(details.open).toBe(false));
      expect(fixture.save).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  },
);

it("keeps a queued proposal and original draft after exact synchronization until explicit successful Reload", async () => {
  await loaded();
  const { article, form } = await edit();
  moveTargetBeyondNewestPage();
  fixture.save.mockRejectedValue(
    Object.assign(new Error("Synthetic queued proposal"), {
      data: { approvalId: "synthetic-approval" },
    }),
  );
  fireEvent.submit(form);
  await screen.findByText(messages.approvals.queuedBody);
  await waitFor(() => expect(fixture.readTarget).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      within(article).getByRole<HTMLButtonElement>("button", {
        name: messages.corrections.reloadPatrol,
      }).disabled,
    ).toBe(false),
  );
  expectDraft(article);
  expect(
    within(article).getByRole<HTMLButtonElement>("button", {
      name: messages.corrections.save,
    }).disabled,
  ).toBe(true);
  fireEvent.submit(form);
  expect(fixture.save).toHaveBeenCalledOnce();
  fireEvent.click(
    within(article).getByRole("button", {
      name: messages.corrections.reloadPatrol,
    }),
  );
  await waitFor(() =>
    expect(
      within(article).getByLabelText<HTMLTextAreaElement>(
        messages.corrections.reason,
      ).value,
    ).toBe(""),
  );
  expect(
    within(article).getByRole<HTMLButtonElement>("button", {
      name: messages.corrections.save,
    }).disabled,
  ).toBe(false);
  expect(
    within(article).getByLabelText<HTMLTextAreaElement>(
      messages.corrections.comments,
    ).value,
  ).toBe("Fresh stored target note");
  expect(fixture.save).toHaveBeenCalledOnce();
});

it("physically conceals exact-denied private evidence immediately and accepts only fresh matching exact-plus-rooms proof", async () => {
  const view = await loaded();
  const { article } = await edit();
  const roomGate = deferred<Rooms>();
  fixture.readRooms.mockImplementation(() => roomGate.promise);
  fixture.readTarget.mockRejectedValue(failure("FORBIDDEN"));
  fireEvent.click(
    within(article).getByRole("button", {
      name: messages.corrections.reloadPatrol,
    }),
  );
  await waitFor(() => expectPrivateAbsent(view.container));
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: `Retry ${messages.corrections.patrolHistory}`,
    }).disabled,
  ).toBe(true);
  await act(async () => {
    roomGate.resolve(fixture.rooms);
  });
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }).disabled,
    ).toBe(false),
  );
  await act(async () => {
    client.setQueryData(fixture.targetKey(targetId), {
      ...patrol(0),
      updatedAt: freshVersion,
    });
  });
  await refreshHistory();
  expectPrivateAbsent(view.container);
  fixture.readTarget.mockResolvedValue({
    ...patrol(0),
    updatedAt: freshVersion,
  });
  fixture.readRooms.mockResolvedValue(null as unknown as Rooms);
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.corrections.patrolHistory}`,
    }),
  );
  await waitFor(() => expect(fixture.readTarget).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }).disabled,
    ).toBe(false),
  );
  expectPrivateAbsent(view.container);
  fixture.readRooms.mockResolvedValue(fixture.rooms);
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.corrections.patrolHistory}`,
    }),
  );
  await screen.findByText(new RegExp(targetCrew));
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.reason)
      .value,
  ).toBe("");
  expect(fixture.save).not.toHaveBeenCalled();
});

it.each(rejectedTargets)(
  "keeps prior exact denial concealed after a %s target result despite successful list and rooms reads",
  async (kind) => {
    const view = await loaded();
    const { article } = await edit();
    fixture.readTarget.mockRejectedValue(failure("FORBIDDEN"));
    fireEvent.click(
      within(article).getByRole("button", {
        name: messages.corrections.reloadPatrol,
      }),
    );
    await waitFor(() => expectPrivateAbsent(view.container));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: `Retry ${messages.corrections.patrolHistory}`,
        }).disabled,
      ).toBe(false),
    );
    rejectTarget(kind);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }),
    );
    await waitFor(() => expect(fixture.readTarget).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: `Retry ${messages.corrections.patrolHistory}`,
        }).disabled,
      ).toBe(false),
    );
    expectPrivateAbsent(view.container);
    expect(fixture.save).not.toHaveBeenCalled();
    fixture.readTarget.mockResolvedValue({
      ...patrol(0),
      updatedAt: freshVersion,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }),
    );
    await screen.findByText(new RegExp(targetCrew));
    expect(fixture.save).not.toHaveBeenCalled();
  },
);

it("retains exact denial and accepted ownership across child/history concealment and read-only remounts", async () => {
  const view = await loaded();
  const { form } = await edit();
  fixture.save.mockResolvedValue({ ok: true });
  fixture.readTarget.mockRejectedValue(failure("FORBIDDEN"));
  fireEvent.submit(form);
  await waitFor(() => expectPrivateAbsent(view.container));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }).disabled,
    ).toBe(false),
  );
  fixture.readHistory.mockRejectedValue(failure("FORBIDDEN"));
  await refreshHistory();
  expectPrivateAbsent(view.container);
  fixture.readHistory.mockResolvedValue([...fixture.records].reverse());
  await refreshHistory();
  await screen.findByRole("button", {
    name: `Retry ${messages.corrections.patrolHistory}`,
  });
  expectPrivateAbsent(view.container);
  view.rerender(subject(true));
  expectPrivateAbsent(view.container);
  view.rerender(subject());
  expectPrivateAbsent(view.container);
  await act(async () => {
    client.setQueryData(fixture.targetKey(targetId), {
      ...patrol(0),
      updatedAt: freshVersion,
    });
  });
  expectPrivateAbsent(view.container);
  fixture.readTarget.mockResolvedValue({
    ...patrol(0),
    updatedAt: freshVersion,
  });
  fixture.readRooms.mockResolvedValue(fixture.rooms);
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.corrections.patrolHistory}`,
    }),
  );
  await screen.findByText(new RegExp(targetCrew));
  await waitFor(() =>
    expect(targetArticle().querySelector("details")!.open).toBe(false),
  );
  expect(fixture.save).toHaveBeenCalledOnce();
});

it("retains the captured repeated-hour instant and timezone through page loss and an unsuccessful exact Reload", async () => {
  const view = await loaded(false, "America/New_York");
  const { article, form } = await edit();
  moveTargetBeyondNewestPage();
  await refreshHistory();
  view.rerender(subject(false, "Asia/Shanghai"));
  expect(
    form.querySelector<HTMLInputElement>("input[type='datetime-local']")!.value,
  ).toBe("2026-11-01T01:30");
  fixture.readTarget.mockRejectedValue(
    new Error("Synthetic exact read unavailable"),
  );
  fireEvent.click(
    within(article).getByRole("button", {
      name: messages.corrections.reloadPatrol,
    }),
  );
  await screen.findByText(messages.corrections.patrolReloadFailed);
  expectDraft(article);
  await act(async () => {
    fireEvent.submit(form);
  });
  expect(fixture.save).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedUpdatedAt: originalVersion,
      observations: [expect.objectContaining({ observedAt: originalVersion })],
    }),
    expect.anything(),
  );
});

it("does not request private exact targets or room choices for read-only patrol summaries", async () => {
  const view = await loaded(true);
  expect(view.container.querySelector("details")).toBeNull();
  expect(fixture.readTarget).not.toHaveBeenCalled();
  expect(fixture.readRooms).not.toHaveBeenCalled();
  expect(fixture.save).not.toHaveBeenCalled();
});

it.each(["equal", "backwards"])(
  "requires actual exact and rooms reads before adopting a Reload version under an %s clock",
  async (direction) => {
    let clock = Date.UTC(2026, 10, 9, 12);
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    await loaded();
    const { article } = await edit();
    // Both caches are warm at the original clock. A rollback can make staleTime:0
    // fetchQuery return future-dated cached rooms without starting any query read.
    await act(async () => {
      client.setQueryData(fixture.targetKey(targetId), patrol(0));
    });
    moveTargetBeyondNewestPage();
    fixture.rooms = fixture.rooms.map((room) => ({
      ...room,
      name: `Fresh ${room.name}`,
    }));
    const priorRoomCalls = fixture.readRooms.mock.calls.length;
    if (direction === "backwards") clock -= 60_000;
    fireEvent.click(
      within(article).getByRole("button", {
        name: messages.corrections.reloadPatrol,
      }),
    );
    await waitFor(() =>
      expect(fixture.readTarget).toHaveBeenCalledWith({ id: targetId }),
    );
    await waitFor(() =>
      expect(fixture.readRooms.mock.calls.length).toBeGreaterThan(
        priorRoomCalls,
      ),
    );
    await waitFor(() =>
      expect(
        within(article).getByLabelText<HTMLTextAreaElement>(
          messages.corrections.reason,
        ).value,
      ).toBe(""),
    );
    expect(
      within(article).getByLabelText<HTMLTextAreaElement>(
        messages.corrections.comments,
      ).value,
    ).toBe("Fresh stored target note");
    expect(
      within(article).getByRole("option", {
        name: "Fresh Other synthetic room",
      }),
    ).toBeTruthy();
    fireEvent.change(
      within(article).getByLabelText(messages.corrections.reason),
      { target: { value: "Fresh clock-independent correction" } },
    );
    await act(async () => {
      fireEvent.submit(article.querySelector("form")!);
    });
    expect(fixture.save).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUpdatedAt: freshVersion }),
      expect.anything(),
    );
  },
);

it.each(["equal", "backwards"])(
  "releases parent room denial after an actual authorized read across history remount under an %s clock",
  async (direction) => {
    let clock = Date.UTC(2026, 10, 9, 12);
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const view = await loaded();
    await edit();
    const authorizedHistory = fixture.readHistory.getMockImplementation()!;
    fixture.readRooms.mockRejectedValue(failure("FORBIDDEN"));
    await act(async () => {
      await client.invalidateQueries({ queryKey: fixture.roomsKey() });
    });
    await screen.findByRole("button", {
      name: `Retry ${messages.corrections.patrolRooms}`,
    });
    expect(screen.queryByLabelText(messages.corrections.reason)).toBeNull();
    fixture.readHistory.mockRejectedValue(failure("FORBIDDEN"));
    await refreshHistory();
    expectPrivateAbsent(view.container);
    if (direction === "backwards") clock -= 60_000;
    fixture.readHistory.mockImplementation(authorizedHistory);
    await refreshHistory();
    await screen.findByText(new RegExp(targetCrew));
    toggle(targetArticle().querySelector("details")!, true);
    const retry = await screen.findByRole("button", {
      name: `Retry ${messages.corrections.patrolRooms}`,
    });
    expect(screen.queryByLabelText(messages.corrections.reason)).toBeNull();
    fixture.readRooms.mockResolvedValue(fixture.rooms);
    const priorRoomCalls = fixture.readRooms.mock.calls.length;
    fireEvent.click(retry);
    await screen.findByLabelText(messages.corrections.reason);
    expect(fixture.readRooms.mock.calls.length).toBeGreaterThan(priorRoomCalls);
    fireEvent.change(screen.getByLabelText(messages.corrections.reason), {
      target: { value: "Fresh authorized correction" },
    });
    await act(async () => {
      fireEvent.submit(targetArticle().querySelector("form")!);
    });
    expect(fixture.save).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUpdatedAt: originalVersion }),
      expect.anything(),
    );
  },
);

it("rejects a held pre-denial rooms GET even when the matching exact target subsequently returns a valid authorized row", async () => {
  const view = await loaded();
  let editing = await edit();
  // Establish the exact target's retained binding before an independently
  // started target denial, while a background rooms retryer is still running.
  fireEvent.click(
    within(editing.article).getByRole("button", {
      name: messages.corrections.reloadPatrol,
    }),
  );
  await waitFor(() =>
    expect(
      within(editing.article).getByLabelText<HTMLTextAreaElement>(
        messages.corrections.reason,
      ).value,
    ).toBe(""),
  );
  fireEvent.change(
    within(editing.article).getByLabelText(messages.corrections.reason),
    { target: { value: draftReason } },
  );
  fireEvent.change(
    within(editing.article).getByLabelText(messages.corrections.comments),
    { target: { value: draftNote } },
  );
  editing = { ...editing, form: editing.article.querySelector("form")! };
  const roomGate = deferred<Rooms>();
  fixture.readRooms.mockImplementation(() => roomGate.promise);
  const priorRoomCalls = fixture.readRooms.mock.calls.length;
  let backgroundRooms!: Promise<void>;
  act(() => {
    backgroundRooms = client.refetchQueries({
      queryKey: fixture.roomsKey(),
      exact: true,
    });
  });
  await waitFor(() =>
    expect(fixture.readRooms.mock.calls.length).toBe(priorRoomCalls + 1),
  );
  fixture.readTarget.mockRejectedValue(failure("FORBIDDEN"));
  await act(async () => {
    await client
      .fetchQuery({
        queryKey: fixture.targetKey(targetId),
        queryFn: () => fixture.readTarget({ id: targetId }),
        staleTime: 0,
      })
      .catch(() => undefined);
  });
  await waitFor(() => expectPrivateAbsent(view.container));
  fixture.readTarget.mockResolvedValue({
    ...patrol(0),
    updatedAt: freshVersion,
    note: "Fresh authorized target note",
  });
  const targetCalls = fixture.readTarget.mock.calls.length;
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.corrections.patrolHistory}`,
    }),
  );
  await waitFor(() =>
    expect(fixture.readTarget.mock.calls.length).toBe(targetCalls + 1),
  );
  // The existing explicit rooms fetch joins the old retryer; it is not a new GET.
  expect(fixture.readRooms.mock.calls.length).toBe(priorRoomCalls + 1);
  await act(async () => {
    roomGate.resolve(fixture.rooms);
    await backgroundRooms;
  });
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }).disabled,
    ).toBe(false),
  );
  expectPrivateAbsent(view.container);
  expect(fixture.save).not.toHaveBeenCalled();
  fixture.readRooms.mockResolvedValue(fixture.rooms);
  fireEvent.click(
    screen.getByRole("button", {
      name: `Retry ${messages.corrections.patrolHistory}`,
    }),
  );
  await screen.findByText(new RegExp(targetCrew));
  expect(fixture.readRooms.mock.calls.length).toBe(priorRoomCalls + 2);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(messages.corrections.comments)
      .value,
  ).toBe("Fresh authorized target note");
  expect(fixture.save).not.toHaveBeenCalled();
});

it("rejects same-reference manual rooms data that invalidates an otherwise valid paired receipt before all invalidations settle", async () => {
  const siblingRead = vi.fn(async () => [patrol(1)]);
  const observer = new QueryObserver(client, {
    queryKey: fixture.historyKey("sibling"),
    queryFn: siblingRead,
  });
  const stop = observer.subscribe(() => undefined);
  await observer.refetch();
  try {
    const view = await loaded();
    const { article } = await edit();
    fixture.readTarget.mockRejectedValue(failure("FORBIDDEN"));
    fireEvent.click(
      within(article).getByRole("button", {
        name: messages.corrections.reloadPatrol,
      }),
    );
    await waitFor(() => expectPrivateAbsent(view.container));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: `Retry ${messages.corrections.patrolHistory}`,
        }).disabled,
      ).toBe(false),
    );
    const siblingGate = deferred<Patrol[]>();
    siblingRead.mockImplementation(() => siblingGate.promise);
    fixture.readTarget.mockResolvedValue({
      ...patrol(0),
      updatedAt: freshVersion,
    });
    const priorRoomCalls = fixture.readRooms.mock.calls.length;
    fireEvent.click(
      screen.getByRole("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }),
    );
    await waitFor(() => {
      expect(fixture.readRooms.mock.calls.length).toBe(priorRoomCalls + 1);
      const query = client
        .getQueryCache()
        .find({ queryKey: fixture.roomsKey(), exact: true });
      expect(
        query && getSessionReadReceipts(client)?.read(query).proof,
      ).toBeTruthy();
    });
    const sameRooms = client.getQueryData(fixture.roomsKey());
    await act(async () => {
      client.setQueryData(fixture.roomsKey(), sameRooms);
    });
    await act(async () => {
      siblingGate.resolve([patrol(1)]);
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: `Retry ${messages.corrections.patrolHistory}`,
        }).disabled,
      ).toBe(false),
    );
    expectPrivateAbsent(view.container);
    expect(fixture.save).not.toHaveBeenCalled();
    siblingRead.mockResolvedValue([patrol(1)]);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Retry ${messages.corrections.patrolHistory}`,
      }),
    );
    await screen.findByText(new RegExp(targetCrew));
    expect(fixture.readRooms.mock.calls.length).toBe(priorRoomCalls + 2);
    expect(fixture.save).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it("does not let a later retryer's valid target receipt certify an older returned DTO while a sibling invalidation is pending", async () => {
  const siblingRead = vi.fn(async () => [patrol(1)]);
  const observer = new QueryObserver(client, {
    queryKey: fixture.historyKey("sibling"),
    queryFn: siblingRead,
  });
  const stop = observer.subscribe(() => undefined);
  await observer.refetch();
  try {
    await loaded();
    const { article, form } = await edit();
    moveTargetBeyondNewestPage();
    const siblingGate = deferred<Patrol[]>();
    siblingRead.mockImplementation(() => siblingGate.promise);
    fireEvent.click(
      within(article).getByRole("button", {
        name: messages.corrections.reloadPatrol,
      }),
    );
    await waitFor(() => {
      expect(fixture.readTarget).toHaveBeenCalledOnce();
      const query = client
        .getQueryCache()
        .find({ queryKey: fixture.targetKey(targetId), exact: true });
      expect(
        query && getSessionReadReceipts(client)?.read(query).proof,
      ).toBeTruthy();
    });
    const laterVersion = new Date("2026-11-01T08:30:00Z");
    fixture.records = fixture.records.map((row) =>
      row.id === targetId
        ? {
            ...row,
            updatedAt: laterVersion,
            note: "Later independently refreshed note",
          }
        : row,
    );
    await act(async () => {
      await client.invalidateQueries({
        queryKey: fixture.targetKey(targetId),
        exact: true,
        refetchType: "none",
      });
      await client.fetchQuery({
        queryKey: fixture.targetKey(targetId),
        queryFn: () => fixture.readTarget({ id: targetId }),
        staleTime: 0,
      });
    });
    await act(async () => {
      siblingGate.resolve([patrol(1)]);
    });
    await screen.findByText(messages.corrections.patrolReloadFailed);
    expectDraft(article);
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(fixture.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedUpdatedAt: originalVersion }),
      expect.anything(),
    );
    siblingRead.mockResolvedValue([patrol(1)]);
    fireEvent.click(
      within(article).getByRole("button", {
        name: messages.corrections.reloadPatrol,
      }),
    );
    await waitFor(() =>
      expect(
        within(article).getByLabelText<HTMLTextAreaElement>(
          messages.corrections.reason,
        ).value,
      ).toBe(""),
    );
    expect(
      within(article).getByLabelText<HTMLTextAreaElement>(
        messages.corrections.comments,
      ).value,
    ).toBe("Later independently refreshed note");
    fireEvent.change(
      within(article).getByLabelText(messages.corrections.reason),
      { target: { value: "Fresh deliberate later correction" } },
    );
    await act(async () => {
      fireEvent.submit(article.querySelector("form")!);
    });
    expect(fixture.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedUpdatedAt: laterVersion }),
      expect.anything(),
    );
  } finally {
    stop();
  }
});
