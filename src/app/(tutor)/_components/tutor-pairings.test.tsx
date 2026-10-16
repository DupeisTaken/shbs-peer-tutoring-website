// @vitest-environment jsdom
import {
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
import { MergeProvider, useMerge } from "./merge-context";
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
it("inactive tutors keep pairing evidence without schedule/removal/merge writes", () => {
  render(element(false));
  expect(screen.getByText("Sample Learner")).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("names the changed schedule and cancel performs no write", async () => {
  render(element());
  fireEvent.change(screen.getAllByRole("combobox")[0]!, {
    target: { value: "" },
  });
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  expect(state.confirm.mock.calls[0]?.[0].message).toContain("Maths");
  expect(state.setSlot).not.toHaveBeenCalled();
  state.confirm.mockResolvedValue(true);
  fireEvent.change(screen.getAllByRole("combobox")[0]!, {
    target: { value: "" },
  });
  await waitFor(() =>
    expect(state.setSlot).toHaveBeenCalledWith({
      pairingId: "pairing",
      slotId: null,
      expectedRoomVersion: 3,
    }),
  );
});
it("canceling removal writes nothing, while a failed confirmed request retains the reason", async () => {
  const view = render(element());
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.tutor.pairings.requestRemoval,
    }),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Moved to another class" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.pairings.removalSubmit }),
  );
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  expect(state.remove).not.toHaveBeenCalled();
  expect(state.confirm.mock.calls[0]?.[0].message).toContain("Sample Learner");
  state.confirm.mockResolvedValue(true);
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.pairings.removalSubmit }),
  );
  await waitFor(() => expect(state.remove).toHaveBeenCalled());
  state.error = "Synthetic failure";
  view.rerender(element());
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
    "Moved to another class",
  );
  expect(screen.getByRole("alert").textContent).toBe("Synthetic failure");
  state.pending = true;
  view.rerender(element());
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").disabled).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.tutor.pairings.removalCancel,
    }).disabled,
  ).toBe(true);
});
it("keeps the learner present during the recall window and permits an inactive tutor to recall", async () => {
  state.removalPending = true;
  render(element(false));
  expect(screen.getByText("Sample Learner")).toBeTruthy();
  expect(screen.getByText(messages.tutor.pairings.removalPending)).toBeTruthy();
  expect(screen.getByText(/^Recall window ends:/)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.pairings.removalRecall }),
  );
  await waitFor(() => expect(state.confirm).toHaveBeenCalled());
  expect(state.recall).not.toHaveBeenCalled();
});

function MergeHarness() {
  const { setPrimaryPairingId, setAttendanceLocked } = useMerge();
  return (
    <>
      <button onClick={() => setPrimaryPairingId("pairing")}>
        Choose attendance pairing
      </button>
      <button onClick={() => setAttendanceLocked(true)}>
        Lock saved attendance
      </button>
      <button onClick={() => setAttendanceLocked(false)}>
        Begin another attendance
      </button>
    </>
  );
}
it("locks merge choices with the attendance save and releases them for a new entry", () => {
  render(
    <NextIntlClientProvider
      locale="en"
      timeZone="Asia/Shanghai"
      messages={messages}
    >
      <MergeProvider>
        <MergeHarness />
        <TutorPairings />
      </MergeProvider>
    </NextIntlClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Choose attendance pairing" }),
  );
  const merge = screen.getByRole<HTMLInputElement>("checkbox");
  fireEvent.click(merge);
  expect(merge.checked).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Lock saved attendance" }),
  );
  expect(merge.disabled).toBe(true);
  expect(merge.checked).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Begin another attendance" }),
  );
  expect(merge.disabled).toBe(false);
});

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
  fireEvent.click(
    screen.getByRole("button", { name: messages.common.save }),
  );
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
