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
import messages from "../../../../messages/en.json";
import { PairingGroupEditor } from "./pairing-group-editor";
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
function element(active = true) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="Asia/Shanghai"
        messages={messages}
      >
        <PairingGroupEditor
          pairings={pairings}
          slots={[
            {
              id: "slot",
              label: "Monday",
              dayOfWeek: 1,
              startMin: 900,
              endMin: 960,
            },
          ]}
          active={active}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}
function show(active = true) {
  return render(element(active));
}
function open() {
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.manage }),
  );
}
function compose() {
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.add }),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Mathematics" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Physics" }));
  fireEvent.change(screen.getByLabelText(messages.pairingGroups.schedule), {
    target: { value: "slot" },
  });
}
it("hides group writes from an inactive tutor", () => {
  show(false);
  expect(screen.queryByRole("button")).toBeNull();
});

it.each(["edit", "review"] as const)(
  "keeps the retained %s draft but blocks new admission after active status is lost",
  async (phase) => {
    const view = show();
    open();
    compose();
    if (phase === "review") {
      fireEvent.click(screen.getByRole("button", {
        name: messages.pairingGroups.review,
      }));
    }
    view.rerender(element(false));
    const action = screen.getByRole<HTMLButtonElement>("button", {
      name: phase === "review"
        ? messages.pairingGroups.save
        : messages.pairingGroups.review,
    });
    expect(action.disabled).toBe(true);
    fireEvent.click(action);
    expect(state.writes).toHaveLength(0);
    view.rerender(element());
    expect(action.disabled).toBe(false);
    if (phase === "edit") {
      expect(screen.getByRole<HTMLInputElement>("checkbox", {
        name: "Mathematics",
      }).checked).toBe(true);
      expect(screen.getByRole<HTMLSelectElement>("combobox", {
        name: messages.pairingGroups.schedule,
      }).value).toBe("slot");
      fireEvent.click(action);
    }
    fireEvent.click(screen.getByRole("button", {
      name: messages.pairingGroups.save,
    }));
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0]!.input).toEqual({
      snapshot: "0".repeat(64),
      groups: [{ pairingIds: ["a", "b"], slotId: "slot" }],
    });
    await act(async () => state.writes[0]!.resolve({ ok: true }));
  },
);

it("waits for a fresh opening read before exposing a cached preview", () => {
  state.fetching = true;
  show();
  open();
  expect(screen.getByText(messages.pairingGroups.loading)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: messages.pairingGroups.add }),
  ).toBeNull();
});

it("hides cached group content after authoritative access denial", () => {
  state.error = { data: { code: "FORBIDDEN" } };
  show();
  open();
  expect(screen.getByText(messages.pairingGroups.accessDenied)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: messages.pairingGroups.add }),
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
  open();
  compose();
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  expect(screen.getByText("Shared room: B201")).toBeTruthy();
  expect(screen.getByText("Fresh Student")).toBeTruthy();
  expect(screen.queryByText("Synthetic Student")).toBeNull();
  expect(screen.getByText(/Fresh slot · Tue/)).toBeTruthy();
});
it("reviews shared schedule, room and deduplicated roster before any write; Cancel and Escape write nothing", () => {
  show();
  open();
  compose();
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
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Physics" }).checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: messages.common.cancel }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.writes).toHaveLength(0);
});
it("guards duplicate writes, locks dismissal while pending and retains a failed review for retry", async () => {
  show();
  open();
  compose();
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  const save = screen.getByRole("button", {
    name: messages.pairingGroups.save,
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
  open();
  compose();
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.save }),
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
    expect(screen.queryByText("Mathematics + Physics")).toBeNull(),
  );
  compose();
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.save }),
  );
  await waitFor(() => expect(state.writes).toHaveLength(2));
  expect(state.writes[1]?.input).toMatchObject({ snapshot: "1".repeat(64) });
});
it("keeps the saved receipt when refresh fails; refresh Retry never repeats the write", async () => {
  state.refresh.mockRejectedValue(new Error("Read unavailable"));
  const view = show();
  open();
  compose();
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.review }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.pairingGroups.save }),
  );
  await waitFor(() => expect(state.writes).toHaveLength(1));
  // A failed batched refresh can also put the editor's own read into error.
  // The accepted-write receipt owns recovery and must offer just one Retry.
  state.error = { data: { code: "INTERNAL_SERVER_ERROR" } };
  await act(async () => state.writes[0]!.resolve({}));
  await screen.findByText(messages.pairingGroups.saved);
  await screen.findByText(messages.pairingGroups.refreshFailed);
  expect(
    screen.getAllByRole("button", { name: messages.pairingGroups.retry }),
  ).toHaveLength(1);
  // Losing eligibility blocks a new write, not synchronization of this receipt.
  view.rerender(element(false));
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
  open();
  fireEvent.click(screen.getByRole("button", { name: messages.pairingGroups.add }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Mathematics" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Physics" }));
  expect(screen.getByLabelText<HTMLSelectElement>(messages.pairingGroups.schedule).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: messages.pairingGroups.review }));
  expect(screen.getByText(messages.pairingGroups.awaiting)).toBeTruthy();
  expect(screen.getByText(messages.pairingGroups.clearSchedule)).toBeTruthy();
  expect(state.writes).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: messages.pairingGroups.save }));
  await waitFor(() => expect(state.writes).toHaveLength(1));
  expect(state.writes[0]!.input).toMatchObject({ groups: [{ pairingIds: ["a", "b"], slotId: null }] });
  await act(async () => state.writes[0]!.resolve({ ok: true }));
});

it("explains the missing student subject and retains the selection until it is repaired", () => {
  state.data.pairings = pairings.map((p) => p.id === "b" ? {
    ...p, tutees: [...p.tutees, { ...p.tutees[0]!, tuteeId: "second", tutee: { ...p.tutees[0]!.tutee, id: "second", englishName: "Second Student", user: null } }],
  } : p);
  show();
  open();
  fireEvent.click(screen.getByRole("button", { name: messages.pairingGroups.add }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Mathematics" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Physics" }));
  expect(screen.getByText("Second Student is missing: Mathematics.")).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: messages.pairingGroups.review }).disabled).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Physics" }).checked).toBe(true);
  expect(state.writes).toHaveLength(0);
});

it("blocks an overlapping independent copied interval while allowing adjacency and excluding draft members", () => {
  state.data.pairings = pairings.map((p) => p.id === "c" ? { ...p, dayOfWeek: 1, startMin: 930, endMin: 990, timeSlotId: null } : p);
  state.data.slots.push({ id: "adjacent", label: "Adjacent", dayOfWeek: 1, startMin: 990, endMin: 1050 });
  show();
  open();
  compose();
  const select = screen.getByLabelText<HTMLSelectElement>(messages.pairingGroups.schedule);
  expect(select.querySelector<HTMLOptionElement>('option[value="slot"]')!.disabled).toBe(true);
  expect(select.querySelector<HTMLOptionElement>('option[value="adjacent"]')!.disabled).toBe(false);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: messages.pairingGroups.review }).disabled).toBe(true);
  fireEvent.change(select, { target: { value: "adjacent" } });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: messages.pairingGroups.review }).disabled).toBe(false);
});


it.each([null, "unpublished"])("requires an explicit choice to clear an existing confirmed schedule linked to %s", async (timeSlotId) => {
  state.data.pairings = pairings.map((p) => p.id === "c" ? p : {
    ...p, groupId: "saved-group", group: { primaryPairingId: "a" }, timeSlotId,
  });
  state.data.groups = [{
    id: "saved-group", pairingIds: ["a", "b"], slotId: timeSlotId,
    scheduleConfirmed: true, dayOfWeek: 1, startMin: 900, endMin: 960,
    groupStatus: "scheduled", retainSchedule: true,
    groupEligibility: { eligible: true, reason: null, missing: [], emptyPairingIds: [] },
  }];
  show();
  open();
  const select = screen.getByLabelText<HTMLSelectElement>(messages.pairingGroups.schedule);
  expect(select.value).toBe("__retain__");
  fireEvent.click(screen.getByRole("button", { name: messages.pairingGroups.review }));
  expect(screen.getByText(/Keep the current confirmed time · Mon 15:00–16:00/)).toBeTruthy();
  expect(screen.queryByText(messages.pairingGroups.clearSchedule)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: messages.pairingGroups.back }));
  fireEvent.change(screen.getByLabelText(messages.pairingGroups.schedule), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: messages.pairingGroups.review }));
  expect(screen.getByText(messages.pairingGroups.clearSchedule)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: messages.pairingGroups.save }));
  await waitFor(() => expect(state.writes).toHaveLength(1));
  expect(state.writes[0]!.input).toMatchObject({ groups: [{ id: "saved-group", pairingIds: ["a", "b"], slotId: null }] });
  expect((state.writes[0]!.input as { groups: { retainSchedule?: boolean }[] }).groups[0]!.retainSchedule).not.toBe(true);
  await act(async () => state.writes[0]!.resolve({ ok: true }));
});


it("allows separate students' assignments for one common subject without a slot", () => {
  state.data.pairings = pairings.slice(0, 2).map((p, index) => ({
    ...p,
    subject: "Chemistry",
    tutees: p.tutees.map((student) => ({
      ...student, tuteeId: `student-${index}`,
      tutee: { ...student.tutee, englishName: `Learner ${index}` },
    })),
  }));
  show();
  open();
  fireEvent.click(screen.getByRole("button", { name: messages.pairingGroups.add }));
  for (const checkbox of screen.getAllByRole("checkbox", { name: "Chemistry" })) fireEvent.click(checkbox);
  const review = screen.getByRole<HTMLButtonElement>("button", { name: messages.pairingGroups.review });
  expect(review.disabled).toBe(false);
  fireEvent.click(review);
  expect(screen.getByRole("heading", { name: "Chemistry" })).toBeTruthy();
  expect(screen.getByText("Learner 0, Learner 1")).toBeTruthy();
  expect(screen.getByText(messages.pairingGroups.awaiting)).toBeTruthy();
  expect(state.writes).toHaveLength(0);
});
