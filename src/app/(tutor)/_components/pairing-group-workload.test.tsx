// @vitest-environment jsdom
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
  useQuery,
} from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import {
  PairingGroupActionDialog,
  type PairingGroupAction,
} from "./pairing-group-editor";
import { TutorWorkloadPreference } from "~/app/_components/tutor-workload-preference";
import type { RouterOutputs } from "~/trpc/react";
import type { InvalidationTarget } from "~/lib/invalidate-refresh";

type Pairing = RouterOutputs["tutor"]["myPairings"][number];
type GroupState = RouterOutputs["pairingGroups"]["mine"];
type Preference = NonNullable<RouterOutputs["tutor"]["workloadPreference"]>;
type GroupInput = { groups: { pairingIds: string[] }[] };
const state = vi.hoisted(() => ({
  client: null as QueryClient | null,
  groups: {} as GroupState,
  preference: {} as Preference,
  groupSave: vi.fn<(input: GroupInput) => Promise<object>>(),
  preferenceRead: vi.fn<() => Promise<Preference>>(),
  preferenceSave:
    vi.fn<
      (input: {
        preferredMaximum: number | null;
        expectedVersion: number;
      }) => Promise<object>
    >(),
  adminRead: vi.fn<(variant: string) => Promise<number>>(),
  refresh: vi.fn(async () => undefined),
}));

vi.mock("@trpc/react-query", () => ({
  getQueryKey: () => ["preference"],
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery, useMutation } = await import("@tanstack/react-query");
  // Keep the installed QueryClient's matching, error suppression and all-read
  // waiting. A mocked invalidate promise cannot prove recovery ownership.
  const target = (key: string): InvalidationTarget => ({
    invalidate: (_input, filters, options) =>
      state.client!.invalidateQueries({ queryKey: [key], ...filters }, options),
  });
  return {
    api: {
      useUtils: () => ({
        admin: {
          assignmentWorkloads: target("admin-workload"),
          pairings: { invalidate: state.refresh },
        },
        tutor: {
          myPairings: { invalidate: state.refresh },
          schedule: { invalidate: state.refresh },
          workloadPreference: {
            ...target("preference"),
            fetch: () =>
              state.client!.fetchQuery({
                queryKey: ["preference"],
                queryFn: state.preferenceRead,
                staleTime: 0,
              }),
          },
        },
      }),
      tutor: {
        workloadPreference: {
          useQuery: (_input: unknown, options: object) =>
            useQuery({
              queryKey: ["preference"],
              queryFn: state.preferenceRead,
              ...options,
            }),
        },
        setWorkloadPreference: {
          useMutation: (options: object) =>
            useMutation({
              mutationFn: state.preferenceSave,
              ...options,
            }),
        },
      },
      pairingGroups: {
        mine: {
          useQuery: (_input: unknown, options: object) =>
            useQuery({
              queryKey: ["groups"],
              queryFn: async () => state.groups,
              ...options,
            }),
        },
        save: {
          useMutation: (options: object) =>
            useMutation({
              mutationFn: state.groupSave,
              ...options,
            }),
        },
      },
    },
  };
});

const slot = {
  id: "slot",
  label: "Monday",
  dayOfWeek: 1,
  startMin: 900,
  endMin: 960,
};
const pairings = ["a", "b"].map((id, index) => ({
  id,
  subject: ["Mathematics", "Physics"][index],
  room: null,
  roomId: null,
  groupId: null,
  scheduleConfirmed: true,
  timeSlotId: "slot",
  dayOfWeek: index + 1,
  startMin: 900,
  endMin: 960,
  tutees: [
    {
      tuteeId: "shared",
      tutee: { englishName: `Synthetic ${id}`, user: null },
    },
  ],
})) as Pairing[];

function AdminWorkload({ variant }: { variant: string }) {
  const query = useQuery({
    queryKey: ["admin-workload", variant],
    queryFn: () => state.adminRead(variant),
  });
  return <output aria-label={`Admin workload ${variant}`}>{query.data}</output>;
}

beforeEach(() => {
  state.client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  state.groups = {
    snapshot: "0".repeat(64),
    termId: "term",
    groups: [],
    pairings,
    slots: [slot],
  };
  state.preference = {
    id: "tutor",
    status: "ACTIVE",
    assignable: true,
    count: 2,
    blocks: [],
    preferredMaximum: 2,
    version: 7,
    canEdit: true,
  };
  state.preferenceRead
    .mockReset()
    .mockImplementation(async () => state.preference);
  state.adminRead
    .mockReset()
    .mockImplementation(async () => state.preference.count);
  state.preferenceSave.mockReset().mockResolvedValue({});
  state.refresh.mockReset().mockResolvedValue(undefined);
  state.groupSave.mockReset().mockImplementation(async (input) => {
    state.preference = {
      ...state.preference,
      count: input.groups.length ? 1 : 2,
    };
    return {};
  });
});
afterEach(() => {
  cleanup();
  state.client?.clear();
});

function show(action: PairingGroupAction | null = null) {
  return render(
    <QueryClientProvider client={state.client!}>
      <NextIntlClientProvider
        locale="en"
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <TutorWorkloadPreference />
        <AdminWorkload variant="all" />
        <AdminWorkload variant="selected" />
        {action && (
          <PairingGroupActionDialog
            action={action}
            active
            onClose={() => undefined}
          />
        )}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
function preferenceControl() {
  return screen.getByRole<HTMLButtonElement>("button", {
    name: "4",
  });
}
const countText = (count: number) =>
  `${count} assigned block${count === 1 ? "" : "s"}`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

it.each(["combine", "split"] as const)(
  "refreshes mounted tutor and admin counts after %s without replacing a preference draft/version",
  async (operation) => {
    if (operation === "split") {
      state.preference = { ...state.preference, count: 1 };
      state.groups = {
        ...state.groups,
        pairings: pairings.map((p) => ({
          ...p,
          groupId: "group",
          group: { primaryPairingId: "a" },
        })),
        groups: [
          {
            id: "group",
            pairingIds: ["a", "b"],
            slotId: "slot",
            scheduleConfirmed: true,
            dayOfWeek: 1,
            startMin: 900,
            endMin: 960,
            retainSchedule: false,
            groupStatus: "scheduled",
            groupEligibility: {
              eligible: true,
              reason: null,
              missing: [],
              emptyPairingIds: [],
            },
          },
        ],
      };
    }
    const action: PairingGroupAction =
      operation === "combine"
        ? { kind: "combine", pairingIds: ["a", "b"] }
        : { kind: "split", groupId: "group" };
    const view = show(null);
    await screen.findByRole("group", { name: /Preferred Sessions/ });
    const before = state.preference.count;
    fireEvent.click(preferenceControl());
    view.rerender(
      <QueryClientProvider client={state.client!}>
        <NextIntlClientProvider
          locale="en"
          timeZone="Asia/Shanghai"
          messages={messages}
        >
          <TutorWorkloadPreference />
          <AdminWorkload variant="all" />
          <AdminWorkload variant="selected" />
          <PairingGroupActionDialog
            action={action}
            active
            onClose={() => undefined}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    if (operation === "combine") {
      await screen.findByLabelText(messages.pairingGroups.schedule);
      fireEvent.change(screen.getByLabelText(messages.pairingGroups.schedule), {
        target: { value: "slot" },
      });
      click(messages.pairingGroups.review);
    } else {
      await screen.findByRole("region", {
        name: messages.pairingGroups.review,
      });
    }
    // Simulate an independent preference revision arriving in the group refresh.
    // The local draft retains version 7 until an explicit successful Reload.
    state.preference = { ...state.preference, preferredMaximum: 1, version: 8 };
    click(
      operation === "combine"
        ? messages.pairingGroups.confirmCombine
        : messages.pairingGroups.confirmSplit,
    );
    await screen.findByText(messages.pairingGroups.saved);
    const after = before === 2 ? 1 : 2;
    await waitFor(() =>
      expect(
        screen.getByText((text) => text.startsWith(countText(after))),
      ).toBeTruthy(),
    );
    for (const variant of ["all", "selected"]) {
      await waitFor(() =>
        expect(
          screen.getByLabelText(`Admin workload ${variant}`).textContent,
        ).toBe(String(after)),
      );
    }
    expect(state.groupSave).toHaveBeenCalledTimes(1);
    expect(preferenceControl().getAttribute("aria-pressed")).toBe("true");
    expect(state.preferenceSave).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getAllByRole<HTMLButtonElement>("button", {
          name: messages.accountProfile.close,
        })[0]!.disabled,
      ).toBe(false),
    );
    view.rerender(
      <QueryClientProvider client={state.client!}>
        <NextIntlClientProvider
          locale="en"
          timeZone="Asia/Shanghai"
          messages={messages}
        >
          <TutorWorkloadPreference />
          <AdminWorkload variant="all" />
          <AdminWorkload variant="selected" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    click(messages.tutorWorkload.save);
    await waitFor(() =>
      expect(state.preferenceSave.mock.calls[0]?.[0]).toEqual({
        preferredMaximum: 4,
        expectedVersion: 7,
      }),
    );
    expect(state.preferenceSave).toHaveBeenCalledTimes(1);
  },
);

it("keeps the accepted receipt and waits for every workload read; failed refresh Retry is read-only", async () => {
  const view = show(null);
  await screen.findByRole("group", { name: /Preferred Sessions/ });
  await waitFor(() =>
    expect(screen.getByLabelText("Admin workload selected").textContent).toBe(
      "2",
    ),
  );
  fireEvent.click(preferenceControl());
  view.rerender(
    <QueryClientProvider client={state.client!}>
      <NextIntlClientProvider
        locale="en"
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <TutorWorkloadPreference />
        <AdminWorkload variant="all" />
        <AdminWorkload variant="selected" />
        <PairingGroupActionDialog
          action={{ kind: "combine", pairingIds: ["a", "b"] }}
          active
          onClose={() => undefined}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  await screen.findByLabelText(messages.pairingGroups.schedule);
  fireEvent.change(screen.getByLabelText(messages.pairingGroups.schedule), {
    target: { value: "slot" },
  });
  click(messages.pairingGroups.review);
  const held = deferred<number>();
  state.preferenceRead.mockRejectedValue(
    new Error("Preference read unavailable"),
  );
  state.adminRead.mockImplementation((variant) =>
    variant === "selected"
      ? held.promise
      : Promise.reject(new Error("Admin read unavailable")),
  );
  click(messages.pairingGroups.confirmCombine);
  await screen.findByText(messages.pairingGroups.saved);
  await waitFor(() =>
    expect(state.client!.getQueryState(["admin-workload", "all"])?.status).toBe(
      "error",
    ),
  );
  expect(screen.queryByText(messages.pairingGroups.refreshFailed)).toBeNull();
  expect(
    screen.getAllByRole<HTMLButtonElement>("button", {
      name: messages.accountProfile.close,
    })[0]!.disabled,
  ).toBe(true);
  await act(async () => held.resolve(1));
  await screen.findByText(messages.pairingGroups.refreshFailed);
  expect(preferenceControl().getAttribute("aria-pressed")).toBe("true");
  const dialog = screen.getByRole("dialog", {
    name: messages.pairingGroups.combineTitle,
  });
  expect(
    within(dialog).queryByRole("button", {
      name: messages.pairingGroups.confirmCombine,
    }),
  ).toBeNull();
  state.preferenceRead.mockImplementation(async () => state.preference);
  state.adminRead.mockImplementation(async () => state.preference.count);
  fireEvent.click(
    within(dialog).getByRole("button", { name: messages.pairingGroups.retry }),
  );
  await waitFor(() =>
    expect(screen.queryByText(messages.pairingGroups.refreshFailed)).toBeNull(),
  );
  expect(
    screen.getByText((text) => text.startsWith(countText(1))),
  ).toBeTruthy();
  expect(screen.getByLabelText("Admin workload all").textContent).toBe("1");
  expect(screen.getByLabelText("Admin workload selected").textContent).toBe(
    "1",
  );
  expect(preferenceControl().getAttribute("aria-pressed")).toBe("true");
  expect(state.groupSave).toHaveBeenCalledTimes(1);
  expect(state.preferenceSave).not.toHaveBeenCalled();
});
