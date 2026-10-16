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
  confirmed: true,
  name: "Sample Learner",
  username: null as string | null,
  rosterFailure: "",
  availabilityFailure: "",
  availabilityRefetch: vi.fn(),
  refetch: vi.fn(),
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
        myPairings: { invalidate: vi.fn() },
        schedule: { invalidate: vi.fn() },
        myTuteeRemovalRequests: { invalidate: vi.fn() },
      },
    }),
    studentWorkflow: {
      tutorRoster: {
        useQuery: () => ({
          data: [],
          isSuccess: !state.rosterFailure,
          error: state.rosterFailure
            ? {
                message: "Read failed",
                data: {
                  code:
                    state.rosterFailure === "denied"
                      ? "FORBIDDEN"
                      : "INTERNAL_SERVER_ERROR",
                },
              }
            : null,
          refetch: state.refetch,
        }),
      },
    },
    tutor: {
      myPairings: {
        useQuery: () => ({
          isSuccess: true,
          refetch: state.refetch,
          data: [
            {
              id: "pairing",
              roomMode: "FIXED",
              roomNeedsAssignment: false,
              roomVersion: 2,
              subject: "Maths",
              scheduleConfirmed: state.confirmed,
              dayOfWeek: 1,
              startMin: 900,
              endMin: 960,
              room: { name: "A101" },
              timeSlotId: "one",
              timeSlot: null,
              tutees: [
                {
                  tuteeId: "tutee",
                  tutee: {
                    englishName: state.name,
                    user: { username: state.username },
                  },
                },
              ],
            },
            {
              id: "merge-pairing",
              roomMode: "AUTO",
              roomNeedsAssignment: false,
              roomVersion: 0,
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
          isSuccess: !state.availabilityFailure,
          error: state.availabilityFailure
            ? {
                message: "Availability read failed",
                data: {
                  code:
                    state.availabilityFailure === "denied"
                      ? "FORBIDDEN"
                      : "INTERNAL_SERVER_ERROR",
                },
              }
            : null,
          refetch: state.availabilityRefetch,
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
          isSuccess: true,
          refetch: state.refetch,
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
  state.confirmed = true;
  state.name = "Sample Learner";
  state.username = null;
  state.rosterFailure = "";
  state.availabilityFailure = "";
  state.availabilityRefetch.mockResolvedValue({ isSuccess: true });
});
const element = (active = true, locale = "en") => (
  <NextIntlClientProvider
    locale={locale}
    timeZone="Asia/Shanghai"
    messages={messages}
  >
    <MergeProvider>
      <TutorPairings active={active} />
    </MergeProvider>
  </NextIntlClientProvider>
);
it("places the default slot before tutee availability and preserves a named participant", () => {
  render(element());
  const select = screen.getAllByRole("combobox")[0]!;
  const participant = screen.getByText("Sample Learner");
  expect(
    select.compareDocumentPosition(participant) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
it.each(["learner", null])(
  "uses current account identity or localized unnamed fallback without changing saved names (%s)",
  (username) => {
    state.name = "";
    state.username = username;
    render(element(false));
    expect(
      screen.getByText(username ?? messages.participantNames.unnamed),
    ).toBeTruthy();
    expect(state.setSlot).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  },
);
it.each([
  ["en", "Mon"],
  ["zh", "周一"],
])("localizes %s tutor pairing schedule evidence", (locale, weekday) => {
  render(element(false, locale));
  expect(screen.getByText(`· ${weekday} 15:00–16:00`)).toBeTruthy();
});

it("never exposes an unconfirmed placeholder schedule in Chinese", () => {
  state.confirmed = false;
  render(element(false, "zh"));
  expect(screen.getByText(`· ${messages.scheduling.awaiting}`)).toBeTruthy();
  expect(screen.queryByText("周一 15:00–16:00")).toBeNull();
});
it("inactive tutors keep pairing evidence without schedule/removal/merge writes", () => {
  render(element(false));
  expect(screen.getByText("Sample Learner")).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(
    screen.getByRole("button", {
      name: `${messages.tablePatterns.details}: Sample Learner`,
    }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", {
      name: `${messages.tablePatterns.details}: Sample Learner`,
    }),
  );
  expect(
    screen.queryByRole("button", {
      name: messages.tutor.pairings.requestRemoval,
    }),
  ).toBeNull();
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
      expectedRoomVersion: 2,
    }),
  );
});
it("canceling removal writes nothing, while a failed confirmed request retains the reason", async () => {
  const view = render(element());
  fireEvent.click(
    screen.getByRole("button", {
      name: `${messages.tablePatterns.details}: Sample Learner`,
    }),
  );
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
  expect(screen.queryByText(messages.tutor.pairings.removalPending)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: `${messages.tablePatterns.details}: Sample Learner`,
    }),
  );
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

it("conceals cached Details and forgets its drafts after authoritative denial until fresh recovery", () => {
  const view = render(element());
  fireEvent.click(
    screen.getByRole("button", {
      name: `${messages.tablePatterns.details}: Sample Learner`,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.tutor.pairings.requestRemoval,
    }),
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Private transient reason" },
  });
  state.rosterFailure = "denied";
  view.rerender(element());
  expect(screen.queryByText("Sample Learner")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: messages.tutor.tasks.retry }),
  );
  expect(state.refetch).toHaveBeenCalledTimes(3);
  state.rosterFailure = "transport";
  view.rerender(element());
  expect(screen.queryByText("Sample Learner")).toBeNull();
  state.rosterFailure = "";
  view.rerender(element());
  fireEvent.click(
    screen.getByRole("button", {
      name: `${messages.tablePatterns.details}: Sample Learner`,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.tutor.pairings.requestRemoval,
    }),
  );
  expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("");
  expect(state.remove).not.toHaveBeenCalled();
});

it.each(["denied", "transport"])(
  "recovers a lone availability %s failure using read-only Retry",
  async (failure) => {
    const view = render(element());
    state.availabilityFailure = failure;
    view.rerender(element());
    const retryName =
      failure === "denied"
        ? messages.tutor.tasks.retry
        : messages.roomAllocation.retryRefresh;
    if (failure === "denied")
      expect(screen.queryByText("Sample Learner")).toBeNull();
    else {
      expect(screen.getByText(messages.roomAllocation.readFailed)).toBeTruthy();
      expect(
        screen.getAllByRole<HTMLSelectElement>("combobox")[0]!.disabled,
      ).toBe(true);
    }
    fireEvent.click(screen.getByRole("button", { name: retryName }));
    expect(state.availabilityRefetch).toHaveBeenCalledOnce();
    state.availabilityFailure = "";
    view.rerender(element());
    await waitFor(() =>
      expect(screen.getByText("Sample Learner")).toBeTruthy(),
    );
    expect(state.setSlot).not.toHaveBeenCalled();
  },
);

it("does not claim an allocation was saved when ordinary availability recovery also fails", async () => {
  state.availabilityFailure = "transport";
  state.availabilityRefetch.mockRejectedValueOnce(new Error("Still offline"));
  const view = render(element());
  fireEvent.click(
    screen.getByRole("button", { name: messages.roomAllocation.retryRefresh }),
  );
  await waitFor(() => expect(state.availabilityRefetch).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: messages.roomAllocation.retryRefresh,
      }).disabled,
    ).toBe(false),
  );
  expect(screen.getByText(messages.roomAllocation.readFailed)).toBeTruthy();
  expect(
    screen.queryByText(messages.roomAllocation.savedRefreshFailed),
  ).toBeNull();
  expect(state.setSlot).not.toHaveBeenCalled();
  state.availabilityFailure = "";
  view.rerender(element());
  fireEvent.click(
    screen.getByRole("button", { name: messages.roomAllocation.retryRefresh }),
  );
  await waitFor(() =>
    expect(state.availabilityRefetch).toHaveBeenCalledTimes(2),
  );
  await waitFor(() =>
    expect(screen.queryByText(messages.roomAllocation.readFailed)).toBeNull(),
  );
  expect(state.setSlot).not.toHaveBeenCalled();
});
