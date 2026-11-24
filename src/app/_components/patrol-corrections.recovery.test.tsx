/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClientProvider,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import { createQueryClient } from "~/trpc/query-client";
import { PatrolCorrections } from "./patrol-corrections";

type PatrolRow = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  hours: number;
  note: string | null;
  crewUser: { name: string };
  observations: Array<{
    id: string;
    roomId: string;
    room: { name: string };
    headcount: "ZERO" | "ONE" | "TWO" | "THREE" | "FOUR_PLUS";
    observedAt: Date;
  }>;
};

const makePatrol = (overrides: Partial<PatrolRow> = {}): PatrolRow => ({
  id: "patrol-1",
  createdAt: new Date("2026-10-01T08:00:00Z"),
  updatedAt: new Date("2026-10-01T08:00:00Z"),
  hours: 0.5,
  note: "Initial note",
  crewUser: { name: "Alex Crew" },
  observations: [
    {
      id: "obs-1",
      roomId: "room-1",
      room: { name: "Room 101" },
      headcount: "ONE",
      observedAt: new Date("2026-10-01T08:00:00Z"),
    },
  ],
  ...overrides,
});

const state = vi.hoisted(() => ({
  patrolsFn: vi.fn<() => Promise<PatrolRow[]>>(),
  roomsFn: vi.fn<() => Promise<Array<{ id: string; name: string }>>>(),
  patrolByIdFn: vi.fn<(input: { id: string }) => Promise<PatrolRow>>(),
  mutateAsync: vi.fn(),
  invalidatePatrols: vi.fn(async () => undefined),
  invalidatePatrolById: vi.fn(async () => undefined),
  resetSave: vi.fn(),
}));

let queryClient: QueryClient;

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        rooms: {
          fetch: async () =>
            queryClient.fetchQuery({
              queryKey: [["admin", "rooms"], { type: "query" }],
              queryFn: () => state.roomsFn(),
              staleTime: 0,
            }),
        },
      },
      corrections: {
        patrols: { invalidate: state.invalidatePatrols },
        patrolById: {
          invalidate: state.invalidatePatrolById,
          fetch: async (input: { id: string }) =>
            queryClient.fetchQuery({
              queryKey: [
                ["corrections", "patrolById"],
                { input, type: "query" },
              ],
              queryFn: () => state.patrolByIdFn(input),
              staleTime: 0,
            }),
        },
      },
    }),
    admin: {
      rooms: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) =>
          useQuery({
            queryKey: [["admin", "rooms"], { type: "query" }],
            queryFn: () => state.roomsFn(),
            enabled: options?.enabled !== false,
          }),
      },
    },
    corrections: {
      patrols: {
        useQuery: (input: { cursor?: string } | undefined) =>
          useQuery({
            queryKey:
              input === undefined
                ? [["corrections", "patrols"], { type: "query" }]
                : [["corrections", "patrols"], { input, type: "query" }],
            queryFn: () => state.patrolsFn(),
          }),
      },
      correctPatrol: {
        useMutation: () => ({
          mutateAsync: state.mutateAsync,
          isPending: false,
          reset: state.resetSave,
        }),
      },
    },
  },
}));

function renderPatrols(locale: "en" | "zh" = "en") {
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? zh : en}
        timeZone="UTC"
      >
        <PatrolCorrections />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = createQueryClient();
  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
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
  vi.clearAllMocks();
  state.patrolsFn.mockResolvedValue([makePatrol()]);
  state.roomsFn.mockResolvedValue([
    { id: "room-1", name: "Room 101" },
    { id: "room-2", name: "Room 202" },
  ]);
  state.patrolByIdFn.mockResolvedValue(makePatrol());
  state.mutateAsync.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows named read-only Retry for initial patrols and rooms failures instead of looking empty (#633)", async () => {
  state.patrolsFn.mockRejectedValueOnce(new Error("Patrol history offline"));
  renderPatrols();

  await waitFor(() =>
    expect(
      screen.getByText(
        en.managementRecovery.loadFailed.replace(
          "{section}",
          en.corrections.patrolHistory,
        ),
      ),
    ).toBeTruthy(),
  );
  expect(screen.queryByText(en.corrections.empty)).toBeNull();

  // Retry loads patrol rows without calling mutation.
  state.patrolsFn.mockResolvedValueOnce([makePatrol()]);
  fireEvent.click(
    screen.getByRole("button", {
      name: en.managementRecovery.retry.replace(
        "{section}",
        en.corrections.patrolHistory,
      ),
    }),
  );
  await waitFor(() => expect(screen.getByText(/Alex Crew/)).toBeTruthy());
  expect(state.mutateAsync).not.toHaveBeenCalled();

  // Rooms failure when opening editor shows named Patrol Rooms Retry.
  state.roomsFn.mockRejectedValueOnce(new Error("Rooms offline"));
  const details = document.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await waitFor(() =>
    expect(
      screen.getByText(
        en.managementRecovery.loadFailed.replace(
          "{section}",
          en.corrections.patrolRooms,
        ),
      ),
    ).toBeTruthy(),
  );

  state.roomsFn.mockResolvedValueOnce([{ id: "room-1", name: "Room 101" }]);
  fireEvent.click(
    screen.getByRole("button", {
      name: en.managementRecovery.retry.replace(
        "{section}",
        en.corrections.patrolRooms,
      ),
    }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText(en.corrections.reason)).toBeTruthy(),
  );
});

it("preserves unsaved correction drafts and original expectedUpdatedAt across background refresh and reloads via exact-ID patrolById (#634)", async () => {
  const initial = makePatrol({
    updatedAt: new Date("2026-10-01T08:00:00Z"),
    note: "Initial note",
  });
  const background = makePatrol({
    updatedAt: new Date("2026-10-01T09:00:00Z"),
    note: "Changed in background",
  });
  const offPageReload = makePatrol({
    updatedAt: new Date("2026-10-01T10:00:00Z"),
    note: "Reloaded from patrolById",
  });
  state.patrolsFn.mockResolvedValueOnce([initial]);

  renderPatrols();
  await waitFor(() => expect(screen.getByText(/Alex Crew/)).toBeTruthy());

  const details = document.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await waitFor(() =>
    expect(screen.getByLabelText(en.corrections.reason)).toBeTruthy(),
  );

  fireEvent.change(screen.getByLabelText(en.corrections.comments), {
    target: { value: "My unsaved draft" },
  });
  fireEvent.change(screen.getByLabelText(en.corrections.reason), {
    target: { value: "Count mismatch" },
  });

  // Background refresh updates row.updatedAt AND removes row from page 1.
  state.patrolsFn.mockResolvedValueOnce([
    makePatrol({ id: "newer-patrol", crewUser: { name: "Newer Crew" } }),
  ]);
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: [["corrections", "patrols"]],
    });
  });
  await waitFor(() => expect(screen.getByText(/Newer Crew/)).toBeTruthy());

  // Unsaved draft MUST remain intact even though the target left page 1.
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.corrections.comments).value,
  ).toBe("My unsaved draft");
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.corrections.reason).value,
  ).toBe("Count mismatch");

  // Also test background row.updatedAt change while staying on page 1 keeps original expectedUpdatedAt.
  state.patrolsFn.mockResolvedValueOnce([background]);
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: [["corrections", "patrols"]],
    });
  });
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.corrections.comments).value,
  ).toBe("My unsaved draft");

  // Submitting sends original expectedUpdatedAt (08:00:00Z), not the background 09:00:00Z.
  state.mutateAsync.mockRejectedValueOnce(
    new Error("Patrol changed. Reload before correcting it."),
  );
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });
  expect(state.mutateAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "patrol-1",
      expectedUpdatedAt: new Date("2026-10-01T08:00:00Z"),
      note: "My unsaved draft",
      reason: "Count mismatch",
    }),
  );
  // Known stale refusal is shown while keeping the draft intact.
  expect(screen.getByRole("alert").textContent).toBe(
    en.corrections.patrolChanged,
  );
  expect(
    screen.getByLabelText<HTMLTextAreaElement>(en.corrections.comments).value,
  ).toBe("My unsaved draft");

  // Deliberate Reload patrol draft calls exact-ID patrolById and adopts fresh baseline.
  state.patrolByIdFn.mockResolvedValueOnce(offPageReload);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: en.corrections.reloadPatrol }),
    );
  });
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLTextAreaElement>(en.corrections.comments).value,
    ).toBe("Reloaded from patrolById"),
  );
  expect(state.patrolByIdFn).toHaveBeenCalledWith({ id: "patrol-1" });
});

it("locks accepted save when post-save synchronization fails and recovers via read-only Retry without replaying correctPatrol (#634)", async () => {
  renderPatrols();
  await waitFor(() => expect(screen.getByText(/Alex Crew/)).toBeTruthy());

  const details = document.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await waitFor(() =>
    expect(screen.getByLabelText(en.corrections.reason)).toBeTruthy(),
  );

  fireEvent.change(screen.getByLabelText(en.corrections.reason), {
    target: { value: "Fixed count" },
  });

  // Save succeeds, then patrolById sync fails.
  state.mutateAsync.mockResolvedValueOnce({ ok: true });
  state.patrolByIdFn.mockRejectedValueOnce(new Error("Sync network error"));
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });

  await waitFor(() =>
    expect(
      screen.getByText(en.corrections.patrolSavedRefreshFailed),
    ).toBeTruthy(),
  );
  expect(state.mutateAsync).toHaveBeenCalledTimes(1);

  // Retry synchronization uses patrolById only — never replays correctPatrol.
  const synced = makePatrol({
    updatedAt: new Date("2026-10-01T11:00:00Z"),
    note: "Synced note",
  });
  state.patrolByIdFn.mockResolvedValueOnce(synced);
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: en.managementRecovery.retry.replace(
          "{section}",
          en.corrections.patrolHistory,
        ),
      }),
    );
  });

  await waitFor(() =>
    expect(
      screen.queryByText(en.corrections.patrolSavedRefreshFailed),
    ).toBeNull(),
  );
  expect(state.mutateAsync).toHaveBeenCalledTimes(1);
});

it("shows distinct queued notice for Coordinator submissions without marking saved", async () => {
  renderPatrols();
  await waitFor(() => expect(screen.getByText(/Alex Crew/)).toBeTruthy());

  const details = document.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await waitFor(() =>
    expect(screen.getByLabelText(en.corrections.reason)).toBeTruthy(),
  );
  fireEvent.change(screen.getByLabelText(en.corrections.reason), {
    target: { value: "Coordinator request" },
  });

  state.mutateAsync.mockRejectedValueOnce(
    Object.assign(new Error("Queued"), { data: { approvalId: "appr-123" } }),
  );
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });
  await waitFor(() =>
    expect(screen.getByText(en.approvals.queuedBody)).toBeTruthy(),
  );
  expect(screen.queryByText(en.corrections.patrolSaved)).toBeNull();
});

it("conceals cached patrol history on FORBIDDEN denial and recovers only after a fresh authorized read", async () => {
  let now = Date.UTC(2026, 10, 9, 12, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  renderPatrols("zh");
  await waitFor(() => expect(screen.getByText(/Alex Crew/)).toBeTruthy());

  now = Date.UTC(2026, 10, 9, 12, 0);
  state.patrolsFn.mockRejectedValueOnce(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await queryClient.refetchQueries({
      queryKey: [["corrections", "patrols"]],
    });
  });

  await waitFor(() =>
    expect(
      screen.getByText(
        zh.managementRecovery.denied.replace(
          "{section}",
          zh.corrections.patrolHistory,
        ),
      ),
    ).toBeTruthy(),
  );
  expect(screen.queryByText(/Alex Crew/)).toBeNull();

  // Recovery succeeds under backward clock skew.
  now = Date.UTC(2026, 10, 9, 11, 50);
  state.patrolsFn.mockResolvedValueOnce([
    makePatrol({ crewUser: { name: "Recovered Crew" } }),
  ]);
  fireEvent.click(
    screen.getByRole("button", {
      name: zh.managementRecovery.retry.replace(
        "{section}",
        zh.corrections.patrolHistory,
      ),
    }),
  );
  await waitFor(() => expect(screen.getByText(/Recovered Crew/)).toBeTruthy());
});
