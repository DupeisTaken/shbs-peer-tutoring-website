// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en.json";
import { TutorPairings } from "./tutor-pairings";
import { MergeProvider } from "./merge-context";
const state = vi.hoisted(() => ({
  confirm: vi.fn(async (_options: { message: string }) => false),
  setSlot: vi.fn(),
  remove: vi.fn(),
  recall: vi.fn(),
  error: "",
  queryError: false,
  pending: false,
  removalPending: false,
  refresh: vi.fn(async () => undefined),
  callbacks: null as null | {
    onSuccess: (result: { roomOutcome: string }) => Promise<void>;
    onError: () => void;
  },
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: state.confirm, dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      student: { me: { invalidate: vi.fn() } },
      studentWorkflow: { mine: { invalidate: vi.fn() } },
      pairingGroups: { mine: { invalidate: vi.fn() } },
      notification: {
        list: { invalidate: vi.fn() },
        unreadCount: { invalidate: vi.fn() },
      },
      tutor: {
        myPairings: { invalidate: state.refresh },
        schedule: { invalidate: vi.fn() },
        myTuteeRemovalRequests: { invalidate: vi.fn() },
      },
    }),
    studentWorkflow: { tutorRoster: { useQuery: () => ({ data: [] }) } },
    tutor: {
      myPairings: {
        useQuery: () => ({
          error: state.queryError ? new Error("Read outage") : null,
          data: [
            {
              id: "pairing",
              subject: "Maths",
              scheduleConfirmed: true,
              roomMode: "AUTO",
              roomNeedsAssignment: false,
              roomVersion: 3,
              dayOfWeek: 1,
              startMin: 900,
              endMin: 960,
              room: { name: "A101" },
              timeSlotId: "one",
              timeSlot: null,
              tutees: [
                { tuteeId: "tutee", tutee: { englishName: "Sample Learner" } },
              ],
            },
            {
              id: "merge-pairing",
              subject: "Maths",
              scheduleConfirmed: true,
              roomMode: "AUTO",
              roomNeedsAssignment: false,
              roomVersion: 3,
              dayOfWeek: 2,
              startMin: 900,
              endMin: 960,
              room: null,
              timeSlotId: "one",
              timeSlot: null,
              tutees: [],
            },
          ],
        }),
      },
      myAvailability: {
        useQuery: () => ({
          isSuccess: true,
          refetch: vi.fn(async () => ({ isSuccess: true })),
          data: {
            slots: [
              {
                id: "one",
                label: "Monday",
                dayOfWeek: 1,
                startMin: 900,
                endMin: 960,
              },
            ],
          },
        }),
      },
      myTuteeRemovalRequests: {
        useQuery: () => ({
          data: state.removalPending
            ? [
                {
                  id: "request",
                  pairingId: "pairing",
                  tuteeId: "tutee",
                  eligibleAt: new Date("2026-10-09T00:00:00Z"),
                },
              ]
            : [],
        }),
      },
      setPairingSlot: {
        useMutation: (callbacks: typeof state.callbacks) => {
          state.callbacks = callbacks;
          return { mutate: state.setSlot };
        },
      },
      requestTuteeRemoval: {
        useMutation: () => ({
          mutate: state.remove,
          isPending: state.pending,
          error: state.error ? new Error(state.error) : null,
        }),
      },
      recallTuteeRemoval: { useMutation: () => ({ mutate: state.recall }) },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.confirm.mockResolvedValue(false);
  state.error = "";
  state.queryError = false;
  state.pending = false;
  state.removalPending = false;
  state.refresh.mockResolvedValue(undefined);
});
const element = (active = true) => (
  <NextIntlClientProvider
    locale="en"
    timeZone="Asia/Shanghai"
    messages={messages}
  >
    <MergeProvider>
      <TutorPairings active={active} />
    </MergeProvider>
  </NextIntlClientProvider>
);
it("accepted allocation survives failed refresh and Retry performs reads only", async () => {
  state.confirm.mockResolvedValue(true);
  state.refresh.mockRejectedValueOnce(new Error("Offline"));
  state.setSlot.mockImplementationOnce(() => {
    void state.callbacks?.onSuccess({ roomOutcome: "MOVED" });
  });
  render(element());
  fireEvent.change(screen.getAllByRole("combobox")[0]!, {
    target: { value: "" },
  });
  await waitFor(() =>
    expect(
      screen.getByText(messages.roomAllocation.savedRefreshFailed),
    ).toBeTruthy(),
  );
  expect(screen.getByText(messages.roomAllocation.outcome.MOVED)).toBeTruthy();
  expect(screen.getAllByRole<HTMLSelectElement>("combobox")[0]!.disabled).toBe(
    true,
  );
  fireEvent.click(
    screen.getByRole("button", { name: messages.roomAllocation.retryRefresh }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(messages.roomAllocation.savedRefreshFailed),
    ).toBeNull(),
  );
  expect(state.setSlot).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole<HTMLSelectElement>("combobox")[0]!.disabled).toBe(
    false,
  );
});
it("guards two same-tick confirmations", async () => {
  state.confirm.mockResolvedValue(true);
  render(element());
  const selector = screen.getAllByRole("combobox")[0]!;
  fireEvent.change(selector, { target: { value: "" } });
  fireEvent.change(selector, { target: { value: "" } });
  await waitFor(() => expect(state.setSlot).toHaveBeenCalledTimes(1));
});

it("failed slot writes retain the attempted slot and captured version for explicit retry", async () => {
  state.confirm.mockResolvedValue(true);
  state.setSlot.mockImplementationOnce(() => state.callbacks?.onError());
  render(element());
  fireEvent.change(screen.getAllByRole("combobox")[0]!, {
    target: { value: "" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: messages.common.save }),
    ).toBeTruthy(),
  );
  expect(screen.getAllByRole<HTMLSelectElement>("combobox")[0]!.value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: messages.common.save }));
  await waitFor(() => expect(state.setSlot).toHaveBeenCalledTimes(2));
  expect(state.setSlot).toHaveBeenLastCalledWith({
    pairingId: "pairing",
    slotId: null,
    expectedRoomVersion: 3,
  });
});

it("read-only recovery does not discard a draft from a rejected write", async () => {
  state.confirm.mockResolvedValue(true);
  state.setSlot.mockImplementationOnce(() => state.callbacks?.onError());
  const view = render(element());
  fireEvent.change(screen.getAllByRole("combobox")[0]!, {
    target: { value: "" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: messages.common.save }),
    ).toBeTruthy(),
  );
  state.queryError = true;
  view.rerender(element());
  fireEvent.click(
    screen.getByRole("button", { name: messages.roomAllocation.retryRefresh }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: messages.common.save }),
    ).toBeTruthy(),
  );
  expect(screen.getAllByRole<HTMLSelectElement>("combobox")[0]!.value).toBe("");
  expect(state.setSlot).toHaveBeenCalledTimes(1);
});

it.each(["inactive", "failed read"])(
  "rechecks current %s eligibility after retained confirmation before writing",
  async (kind) => {
    let accept!: (approved: boolean) => void;
    state.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const view = render(element());
    fireEvent.change(screen.getAllByRole("combobox")[0]!, {
      target: { value: "" },
    });
    await waitFor(() => expect(state.confirm).toHaveBeenCalled());
    state.queryError = kind === "failed read";
    view.rerender(element(kind !== "inactive"));
    await act(async () => {
      accept(true);
    });
    expect(state.setSlot).not.toHaveBeenCalled();
    state.queryError = false;
    state.confirm.mockResolvedValue(true);
    view.rerender(element(true));
    fireEvent.change(screen.getAllByRole("combobox")[0]!, {
      target: { value: "" },
    });
    await waitFor(() => expect(state.setSlot).toHaveBeenCalledOnce());
  },
);
