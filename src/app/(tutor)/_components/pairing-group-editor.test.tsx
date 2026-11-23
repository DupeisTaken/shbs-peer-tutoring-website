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
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import messages from "../../../../messages/en.json";
import {
  PairingGroupActionDialog,
  type PairingGroupAction,
} from "./pairing-group-editor";
import type { RouterOutputs } from "~/trpc/react";

type Pairing = RouterOutputs["tutor"]["myPairings"][number];
const state = vi.hoisted(() => ({
  writes: [] as {
    input: unknown;
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
  }[],
  refresh: vi.fn(async () => undefined),
  refetch: vi.fn(),
  onClose: vi.fn(),
  onSaved: vi.fn(),
  fetching: false,
  error: null as null | { data: { code: string } },
  data: {
    snapshot: "0".repeat(64),
    termId: "term",
    groups: [] as RouterOutputs["pairingGroups"]["mine"]["groups"],
    pairings: [] as Pairing[],
    slots: [] as {
      id: string;
      label: string;
      dayOfWeek: number;
      startMin: number;
      endMin: number;
    }[],
  },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: { pairings: { invalidate: state.refresh } },
      tutor: {
        myPairings: { invalidate: state.refresh },
        schedule: { invalidate: state.refresh },
      },
    }),
    pairingGroups: {
      mine: {
        useQuery: () => ({
          data: state.data,
          isLoading: false,
          isFetching: state.fetching,
          isSuccess: !state.error,
          error: state.error,
          refetch: state.refetch,
        }),
      },
      save: {
        useMutation: (options: Parameters<typeof useMutation>[0]) =>
          useMutation({
            mutationFn: (input: unknown) =>
              new Promise((resolve, reject) =>
                state.writes.push({ input, resolve, reject }),
              ),
            ...options,
          }),
      },
    },
  },
}));

let client: QueryClient;
const pairings = ["a", "b", "c"].map((id, index) => ({
  id,
  subject: ["Mathematics", "Physics", "Chemistry"][index],
  room: { name: "A101" },
  groupId: null,
  scheduleConfirmed: true,
  timeSlotId: "slot",
  dayOfWeek: index === 2 ? 3 : 1,
  startMin: 900,
  endMin: 960,
  roomId: "room",
  tutees: [
    {
      tuteeId: "student",
      tutee: { englishName: "Synthetic Student", user: null },
    },
  ],
})) as Pairing[];

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  state.writes = [];
  state.fetching = false;
  state.error = null;
  state.refresh.mockReset().mockResolvedValue(undefined);
  state.onClose.mockReset();
  state.onSaved.mockReset();
  state.data = {
    snapshot: "0".repeat(64),
    termId: "term",
    groups: [],
    pairings,
    slots: [
      { id: "slot", label: "Monday", dayOfWeek: 1, startMin: 900, endMin: 960 },
    ],
  };
  state.refetch
    .mockReset()
    .mockResolvedValue({ data: state.data, error: null });
});
afterEach(() => {
  cleanup();
  client.clear();
});

const combineAction: PairingGroupAction = {
  kind: "combine",
  pairingIds: ["a", "b"],
};

function element(action: PairingGroupAction = combineAction, active = true) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <PairingGroupActionDialog
          action={action}
          active={active}
          onClose={state.onClose}
          onSaved={state.onSaved}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function show(action: PairingGroupAction = combineAction, active = true) {
  return render(element(action, active));
}

function pickSlot(value = "slot") {
  fireEvent.change(screen.getByLabelText(messages.pairingGroups.schedule), {
    target: { value },
  });
}

it.each(["edit", "review"] as const)(
  "keeps the retained %s draft but blocks new admission after active status is lost",
  async (phase) => {
    const view = show();
    pickSlot("slot");
    if (phase === "review") {
      fireEvent.click(
        screen.getByRole("button", { name: messages.pairingGroups.review }),
      );
    }
    view.rerender(element(combineAction, false));
    const actionButton = screen.getByRole<HTMLButtonElement>("button", {
      name:
        phase === "review"
          ? messages.pairingGroups.confirmCombine
          : messages.pairingGroups.review,
    });
    expect(actionButton.disabled).toBe(true);
    fireEvent.click(actionButton);
    expect(state.writes).toHaveLength(0);
    view.rerender(element(combineAction, true));
    expect(actionButton.disabled).toBe(false);
    if (phase === "edit") {
      expect(
        screen.getByRole<HTMLSelectElement>("combobox", {
          name: messages.pairingGroups.schedule,
        }).value,
      ).toBe("slot");
      fireEvent.click(actionButton);
    }
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.pairingGroups.confirmCombine,
      }),
    );
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0]!.input).toEqual({
      snapshot: "0".repeat(64),
      groups: [{ pairingIds: ["a", "b"], slotId: "slot" }],
    });
    await act(async () => state.writes[0]!.resolve({ ok: true }));
    expect(state.onSaved).toHaveBeenCalledOnce();
  },
);

it("waits for a fresh opening read before exposing a cached preview", () => {
  state.fetching = true;
  show();
  expect(screen.getByText(messages.pairingGroups.loading)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: messages.pairingGroups.review }),
  ).toBeNull();
});

it("hides cached group content after authoritative access denial", () => {
  state.error = { data: { code: "FORBIDDEN" } };
  show();
  expect(screen.getByText(messages.pairingGroups.accessDenied)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: messages.pairingGroups.review }),
  ).toBeNull();
  expect(state.writes).toHaveLength(0);
});

it("uses the authoritative preview roster, room and slots rather than an older catalogue cache", () => {
  state.data.pairings = pairings.map((p) => ({
    ...p,
    room: { ...p.room!, name: "B201" },
    tutees: p.tutees.map((x) => ({
      ...x,
      tutee: { ...x.tutee, englishName: "Fresh Student" },
    })),
  }));
  state.data.slots = [
    {
      id: "slot",
      label: "Fresh slot",
      dayOfWeek: 2,
      startMin: 1000,
      endMin: 1060,
    },
  ];
  show();
  pickSlot("slot");
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  expect(screen.getByText("Shared room: B201")).toBeTruthy();
  expect(screen.getByText("Fresh Student")).toBeTruthy();
  expect(screen.queryByText("Synthetic Student")).toBeNull();
  expect(screen.getByText(/Fresh slot · Tue/)).toBeTruthy();
});

it("reviews shared schedule, room and deduplicated roster before any write; Cancel writes nothing", () => {
  show();
  pickSlot("slot");
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  const review = screen.getByRole("region", {
    name: messages.pairingGroups.review,
  });
  expect(within(review).getByText("Mathematics + Physics")).toBeTruthy();
  expect(within(review).getAllByText("Synthetic Student")).toHaveLength(1);
  expect(within(review).getByText("Shared room: A101")).toBeTruthy();
  expect(state.writes).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.back }),
  );
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", {
      name: messages.pairingGroups.schedule,
    }).value,
  ).toBe("slot");
  fireEvent.click(screen.getByRole("button", { name: messages.common.cancel }));
  expect(state.onClose).toHaveBeenCalledOnce();
  expect(state.writes).toHaveLength(0);
});

it("guards duplicate writes, locks dismissal while pending and retains a failed review for retry", async () => {
  show();
  pickSlot("slot");
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  const save = screen.getByRole("button", {
    name: messages.pairingGroups.confirmCombine,
  });
  fireEvent.click(save);
  fireEvent.click(save);
  await waitFor(() => expect(state.writes).toHaveLength(1));
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.accountProfile.close,
    }).disabled,
  ).toBe(true);
  await act(async () =>
    state.writes[0]!.reject(new Error("Stale group. Reload before saving.")),
  );
  await waitFor(() =>
    expect(screen.getByText("Stale group. Reload before saving.")).toBeTruthy(),
  );
  expect(screen.getByText("Mathematics + Physics")).toBeTruthy();
  fireEvent.click(save);
  await waitFor(() => expect(state.writes).toHaveLength(2));
  expect(state.writes[1]!.input).toEqual(state.writes[0]!.input);
});

it("uses explicit Reload to replace a failed snapshot; background reads do not replace it", async () => {
  show();
  pickSlot("slot");
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.confirmCombine }),
  );
  await waitFor(() => expect(state.writes).toHaveLength(1));
  await act(async () => state.writes[0]!.reject(new Error("Stale group")));
  const newState = {
    snapshot: "1".repeat(64),
    termId: "term",
    groups: [],
    pairings,
    slots: [
      { id: "slot", label: "Monday", dayOfWeek: 1, startMin: 900, endMin: 960 },
    ],
  };
  state.refetch.mockResolvedValue({ data: newState, error: null });
  fireEvent.click(
    await screen.findByRole("button", { name: messages.pairingGroups.reload }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLSelectElement>(messages.pairingGroups.schedule)
        .value,
    ).toBe(""),
  );
  pickSlot("slot");
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.confirmCombine }),
  );
  await waitFor(() => expect(state.writes).toHaveLength(2));
  expect(state.writes[1]?.input).toMatchObject({ snapshot: "1".repeat(64) });
});

it("keeps the saved receipt when refresh fails; refresh Retry never repeats the write", async () => {
  state.refresh.mockRejectedValue(new Error("Read unavailable"));
  const view = show();
  pickSlot("slot");
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.confirmCombine }),
  );
  await waitFor(() => expect(state.writes).toHaveLength(1));
  state.error = { data: { code: "INTERNAL_SERVER_ERROR" } };
  await act(async () => state.writes[0]!.resolve({}));
  await screen.findByText(messages.pairingGroups.saved);
  await screen.findByText(messages.pairingGroups.refreshFailed);
  expect(
    screen.getAllByRole("button", { name: messages.pairingGroups.retry }),
  ).toHaveLength(1);
  // Losing eligibility blocks a new write, not synchronization of this receipt.
  view.rerender(element(combineAction, false));
  state.refresh.mockResolvedValue(undefined);
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.retry }),
  );
  await waitFor(() =>
    expect(screen.queryByText(messages.pairingGroups.refreshFailed)).toBeNull(),
  );
  expect(state.writes).toHaveLength(1);
});

it("saves eligible members before scheduling and reviews clearing their former reservation", async () => {
  show();
  expect(
    screen.getByLabelText<HTMLSelectElement>(messages.pairingGroups.schedule)
      .value,
  ).toBe("");
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  expect(screen.getByText(messages.pairingGroups.awaiting)).toBeTruthy();
  expect(screen.getByText(messages.pairingGroups.clearSchedule)).toBeTruthy();
  expect(state.writes).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.confirmCombine }),
  );
  await waitFor(() => expect(state.writes).toHaveLength(1));
  expect(state.writes[0]!.input).toMatchObject({
    groups: [{ pairingIds: ["a", "b"], slotId: null }],
  });
  await act(async () => state.writes[0]!.resolve({ ok: true }));
});

it("explains the missing student subject when snapshot coverage is incomplete and blocks review", () => {
  state.data.pairings = pairings.map((p) =>
    p.id === "b"
      ? {
          ...p,
          tutees: [
            ...p.tutees,
            {
              ...p.tutees[0]!,
              tuteeId: "second",
              tutee: {
                ...p.tutees[0]!.tutee,
                id: "second",
                englishName: "Second Student",
                user: null,
              },
            },
          ],
        }
      : p,
  );
  show();
  expect(
    screen.getByText("Second Student is missing: Mathematics."),
  ).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.pairingGroups.review,
    }).disabled,
  ).toBe(true);
  expect(state.writes).toHaveLength(0);
});

it("blocks an overlapping independent copied interval while allowing adjacency and excluding draft members", () => {
  state.data.pairings = pairings.map((p) =>
    p.id === "c"
      ? { ...p, dayOfWeek: 1, startMin: 930, endMin: 990, timeSlotId: null }
      : p,
  );
  state.data.slots.push({
    id: "adjacent",
    label: "Adjacent",
    dayOfWeek: 1,
    startMin: 990,
    endMin: 1050,
  });
  show();
  pickSlot("slot");
  const select = screen.getByLabelText<HTMLSelectElement>(
    messages.pairingGroups.schedule,
  );
  expect(
    select.querySelector<HTMLOptionElement>('option[value="slot"]')!.disabled,
  ).toBe(true);
  expect(
    select.querySelector<HTMLOptionElement>('option[value="adjacent"]')!
      .disabled,
  ).toBe(false);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.pairingGroups.review,
    }).disabled,
  ).toBe(true);
  pickSlot("adjacent");
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.pairingGroups.review,
    }).disabled,
  ).toBe(false);
});

it.each([null, "unpublished"])(
  "requires an explicit choice to clear an existing confirmed schedule linked to %s in partial split",
  async (timeSlotId) => {
    state.data.pairings = pairings.map((p) => ({
      ...p,
      groupId: "saved-group",
      group: { primaryPairingId: "a" },
      timeSlotId,
    }));
    state.data.groups = [
      {
        id: "saved-group",
        pairingIds: ["a", "b", "c"],
        slotId: timeSlotId,
        scheduleConfirmed: true,
        dayOfWeek: 1,
        startMin: 900,
        endMin: 960,
        groupStatus: "scheduled",
        retainSchedule: true,
        groupEligibility: {
          eligible: true,
          reason: null,
          missing: [],
          emptyPairingIds: [],
        },
      },
    ];
    show({ kind: "split", groupId: "saved-group" });
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.pairingGroups.splitModePartial,
      }),
    );
    const select = screen.getByLabelText<HTMLSelectElement>(
      messages.pairingGroups.schedule,
    );
    expect(select.value).toBe("__retain__");
    // Removing a member blocks retainSchedule until a slot or Awaiting is explicitly chosen.
    fireEvent.click(screen.getByRole("checkbox", { name: "Chemistry" }));
    expect(
      screen.getByText(messages.pairingGroups.scheduleAfterMembershipChange),
    ).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.pairingGroups.review,
      }).disabled,
    ).toBe(true);
    pickSlot("");
    fireEvent.click(
      screen.getByRole("button", { name: messages.pairingGroups.review }),
    );
    expect(screen.getByText(messages.pairingGroups.clearSchedule)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: messages.pairingGroups.confirmSplit }),
    );
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0]!.input).toMatchObject({
      groups: [{ id: "saved-group", pairingIds: ["a", "b"], slotId: null }],
    });
    expect(
      (state.writes[0]!.input as { groups: { retainSchedule?: boolean }[] })
        .groups[0]!.retainSchedule,
    ).not.toBe(true);
    await act(async () => state.writes[0]!.resolve({ ok: true }));
  },
);

it("opens a 2-member split directly in review, retains a rejected split and reloads explicitly", async () => {
  state.data.pairings = pairings.map((p) =>
    p.id === "c"
      ? p
      : {
          ...p,
          groupId: "saved-group",
          group: { primaryPairingId: "a" },
        },
  );
  state.data.groups = [
    {
      id: "saved-group",
      pairingIds: ["a", "b"],
      slotId: "slot",
      scheduleConfirmed: true,
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      groupStatus: "scheduled",
      retainSchedule: false,
      groupEligibility: {
        eligible: true,
        reason: null,
        missing: [],
        emptyPairingIds: [],
      },
    },
  ];
  show({ kind: "split", groupId: "saved-group" });
  expect(
    screen.getByRole("region", { name: messages.pairingGroups.review }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.confirmSplit }),
  );
  await waitFor(() => expect(state.writes).toHaveLength(1));
  expect(state.writes[0]!.input).toEqual({
    snapshot: "0".repeat(64),
    groups: [],
  });
  const conflict = TRPCClientError.from({
    error: {
      message:
        "Pairings or schedules changed. Reload before saving this group draft.",
      code: -32009,
      data: { code: "CONFLICT", path: "pairingGroups.save" },
    },
  });
  await act(async () => state.writes[0]!.reject(conflict));
  expect((await screen.findByRole("alert")).textContent).toContain(
    conflict.message,
  );
  expect(
    screen.getByRole("region", { name: messages.pairingGroups.review }),
  ).toBeTruthy();

  // A failed Reload cannot adopt a newer version or silently discard the split.
  state.refetch.mockResolvedValueOnce({ error: new Error("Read unavailable") });
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.reload }),
  );
  await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(1));
  expect(screen.getByText(conflict.message)).toBeTruthy();
  expect(state.writes).toHaveLength(1);
  state.refetch.mockResolvedValue({
    data: { ...state.data, snapshot: "1".repeat(64) },
    error: null,
  });
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.reload }),
  );
  await waitFor(() => expect(screen.queryByText(conflict.message)).toBeNull());
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.confirmSplit }),
  );
  await waitFor(() => expect(state.writes).toHaveLength(2));
  expect(state.writes[1]!.input).toEqual({
    snapshot: "1".repeat(64),
    groups: [],
  });
  state.refresh.mockRejectedValue(new Error("Read unavailable"));
  await act(async () => state.writes[1]!.resolve({}));
  await screen.findByText(messages.pairingGroups.saved);
  await screen.findByText(messages.pairingGroups.refreshFailed);
  state.refresh.mockResolvedValue(undefined);
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.retry }),
  );
  await waitFor(() =>
    expect(screen.queryByText(messages.pairingGroups.refreshFailed)).toBeNull(),
  );
  expect(state.writes).toHaveLength(2);
});

it("allows separate students' assignments for one common subject without a slot", () => {
  state.data.pairings = pairings.slice(0, 2).map((p, index) => ({
    ...p,
    subject: "Chemistry",
    tutees: p.tutees.map((student) => ({
      ...student,
      tuteeId: `student-${index}`,
      tutee: { ...student.tutee, englishName: `Learner ${index}` },
    })),
  }));
  show();
  const review = screen.getByRole<HTMLButtonElement>("button", {
    name: messages.pairingGroups.review,
  });
  expect(review.disabled).toBe(false);
  fireEvent.click(review);
  expect(screen.getByRole("heading", { name: "Chemistry" })).toBeTruthy();
  expect(screen.getByText("Learner 0, Learner 1")).toBeTruthy();
  expect(screen.getByText(messages.pairingGroups.awaiting)).toBeTruthy();
  expect(state.writes).toHaveLength(0);
});

it("preserves unrelated saved groups when combining two other pairings", async () => {
  const fourth = {
    ...pairings[2]!,
    id: "d",
    subject: "Biology",
    dayOfWeek: 4,
  };
  state.data.pairings = [
    { ...pairings[0]!, groupId: "existing", group: { primaryPairingId: "a" } },
    { ...pairings[1]!, groupId: "existing", group: { primaryPairingId: "a" } },
    pairings[2]!,
    fourth,
  ];
  state.data.groups = [
    {
      id: "existing",
      pairingIds: ["a", "b"],
      slotId: "slot",
      scheduleConfirmed: true,
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      groupStatus: "scheduled",
      retainSchedule: false,
      groupEligibility: {
        eligible: true,
        reason: null,
        missing: [],
        emptyPairingIds: [],
      },
    },
  ];
  show({ kind: "combine", pairingIds: ["c", "d"] });
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.confirmCombine }),
  );
  await waitFor(() => expect(state.writes).toHaveLength(1));
  expect(state.writes[0]!.input).toEqual({
    snapshot: "0".repeat(64),
    groups: [
      { id: "existing", pairingIds: ["a", "b"], slotId: "slot" },
      { pairingIds: ["c", "d"], slotId: null },
    ],
  });
  await act(async () => state.writes[0]!.resolve({ ok: true }));
});
