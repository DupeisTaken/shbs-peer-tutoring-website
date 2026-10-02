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
  pending: false,
  removalPending: false,
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: state.confirm, dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tutor: {
        myPairings: { invalidate: vi.fn() },
        schedule: { invalidate: vi.fn() },
        myTuteeRemovalRequests: { invalidate: vi.fn() },
      },
    }),
    studentWorkflow: { tutorRoster: { useQuery: () => ({ data: [] }) } },
    tutor: {
      myPairings: {
        useQuery: () => ({
          data: [
            {
              id: "pairing",
              subject: "Maths",
              scheduleConfirmed: true,
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
      setPairingSlot: { useMutation: () => ({ mutate: state.setSlot }) },
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
  state.pending = false;
  state.removalPending = false;
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
