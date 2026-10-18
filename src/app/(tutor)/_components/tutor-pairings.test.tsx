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
  savedGroup: false,
  memberTuteeIds: [] as string[],
  name: "Sample Learner",
  username: null as string | null,
  rosterFailure: "",
  availabilityFailure: "",
  availabilityRefetch: vi.fn(),
  refetch: vi.fn(),
  selectedSlotIds: undefined as string[] | undefined,
  slots: [] as {
    id: string;
    label: string;
    dayOfWeek: number;
    startMin: number;
    endMin: number;
  }[],
  workflowRows: [] as {
    pairingId: string;
    tuteeId: string;
    slots: { id: string }[];
  }[],
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
          data: state.workflowRows,
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
              groupId: state.savedGroup ? "saved-group" : null,
              group: state.savedGroup ? { primaryPairingId: "pairing" } : null,
              roomMode: "FIXED",
              roomNeedsAssignment: false,
              roomVersion: 2,
              subject: "Maths",
              scheduleConfirmed: state.confirmed,
              dayOfWeek: 1,
              startMin: 900,
              endMin: 960,
              room: { name: "A101" },
              roomId: "room",
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
              groupId: state.savedGroup ? "saved-group" : null,
              group: state.savedGroup ? { primaryPairingId: "pairing" } : null,
              roomMode: "AUTO",
              roomNeedsAssignment: false,
              roomVersion: 0,
              subject: state.savedGroup ? "Physics" : "Maths",
              scheduleConfirmed: true,
              dayOfWeek: state.savedGroup ? 1 : 2,
              startMin: 900,
              endMin: 960,
              room: state.savedGroup ? { name: "A101" } : null,
              roomId: state.savedGroup ? "room" : null,
              timeSlotId: "one",
              timeSlot: null,
              tutees: state.memberTuteeIds.map((tuteeId) => ({
                tuteeId,
                tutee: {
                  englishName:
                    tuteeId === "tutee" ? state.name : `Learner ${tuteeId}`,
                  user: { username: null },
                },
              })),
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
            selectedSlotIds: state.selectedSlotIds,
            slots: state.slots.length
              ? state.slots
              : [
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
  state.savedGroup = false;
  state.memberTuteeIds = [];
  state.name = "Sample Learner";
  state.username = null;
  state.rosterFailure = "";
  state.availabilityFailure = "";
  state.selectedSlotIds = undefined;
  state.slots = [];
  state.workflowRows = [];
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
it("ranks exact mutual selections without changing the saved selection or reviewed mutation payload", async () => {
  state.slots = [
    { id: "one", label: "Original", dayOfWeek: 1, startMin: 900, endMin: 960 },
    { id: "shared", label: "Shared", dayOfWeek: 5, startMin: 900, endMin: 960 },
    {
      id: "same-clock",
      label: "Same clock",
      dayOfWeek: 5,
      startMin: 900,
      endMin: 960,
    },
  ];
  state.selectedSlotIds = ["shared"];
  state.workflowRows = [
    {
      pairingId: "pairing",
      tuteeId: "tutee",
      slots: [{ id: "shared" }, { id: "same-clock" }],
    },
  ];
  render(element());
  const select = screen.getAllByRole<HTMLSelectElement>("combobox")[0]!;
  expect([...select.options].map((option) => option.value)).toEqual([
    "",
    "shared",
    "same-clock",
    "one",
  ]);
  expect(select.value).toBe("one");
  expect(select.options[1]?.textContent).toContain("Shared by everyone");
  expect(select.options[2]?.textContent).toContain("not selected by you");
  const wrappingStatus = screen.getByText(
    "Choice availability: 0/1 tutees; not selected by you",
  );
  expect(wrappingStatus.closest("option")).toBeNull();
  expect(
    document
      .getElementById(select.getAttribute("aria-describedby")!)
      ?.contains(wrappingStatus),
  ).toBe(true);
  expect(state.setSlot).not.toHaveBeenCalled();
  state.confirm.mockResolvedValue(true);
  fireEvent.change(select, { target: { value: "shared" } });
  await waitFor(() =>
    expect(state.setSlot).toHaveBeenCalledExactlyOnceWith({
      pairingId: "pairing",
      slotId: "shared",
      expectedRoomVersion: 2,
    }),
  );
});
it("keeps an inactive linked schedule visible and distinguishes missing availability from no common slot", () => {
  state.slots = [
    { id: "new", label: "Published", dayOfWeek: 1, startMin: 900, endMin: 960 },
  ];
  state.selectedSlotIds = ["new"];
  state.workflowRows = [{ pairingId: "pairing", tuteeId: "tutee", slots: [] }];
  const view = render(element());
  const select = screen.getAllByRole<HTMLSelectElement>("combobox")[0]!;
  expect(select.value).toBe("one");
  expect(select.selectedOptions[0]?.textContent).toContain(
    "Current linked slot (not published)",
  );
  expect(
    screen
      .getAllByText("Current linked slot (not published)")
      .every((el) => !el.closest("option")),
  ).toBe(true);
  expect(screen.getByText(/Availability is incomplete/)).toBeTruthy();
  expect(screen.queryByText(/No catalog slot is selected/)).toBeNull();
  state.slots.push({
    id: "other",
    label: "Other",
    dayOfWeek: 2,
    startMin: 900,
    endMin: 960,
  });
  state.workflowRows[0]!.slots = [{ id: "other" }];
  view.rerender(element());
  expect(screen.getByText(/No catalog slot is selected/)).toBeTruthy();
  expect(state.setSlot).not.toHaveBeenCalled();
});
it("recomputes saved-group ranking from every distinct current member tutee when roster availability and assignments refresh, without writes", () => {
  state.savedGroup = true;
  // The same learner appears in both subjects, while a second learner belongs
  // only to Physics. The group-wide denominator must count two people, not three.
  state.memberTuteeIds = ["tutee", "second"];
  state.slots = [
    { id: "one", label: "Original", dayOfWeek: 1, startMin: 900, endMin: 960 },
    {
      id: "primary-only",
      label: "Earlier option",
      dayOfWeek: 2,
      startMin: 900,
      endMin: 960,
    },
    {
      id: "full",
      label: "Later option",
      dayOfWeek: 5,
      startMin: 900,
      endMin: 960,
    },
  ];
  state.selectedSlotIds = ["primary-only", "full"];
  state.workflowRows = [
    {
      pairingId: "pairing",
      tuteeId: "tutee",
      slots: [{ id: "primary-only" }, { id: "full" }],
    },
    {
      pairingId: "merge-pairing",
      tuteeId: "tutee",
      slots: [{ id: "primary-only" }, { id: "full" }],
    },
    { pairingId: "merge-pairing", tuteeId: "second", slots: [{ id: "full" }] },
  ];
  const view = render(element());
  const details = screen
    .getByText(messages.pairingGroups.memberDetails)
    .closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const selections = () => screen.getAllByRole<HTMLSelectElement>("combobox");
  const optionOrder = () =>
    selections().map((select) =>
      [...select.options].map((option) => option.value),
    );
  const optionText = (slotId: string) =>
    selections().map(
      (select) =>
        [...select.options].find((option) => option.value === slotId)!
          .textContent,
    );
  expect(selections()).toHaveLength(2);
  expect(optionOrder()).toEqual([
    ["", "full", "primary-only", "one"],
    ["", "full", "primary-only", "one"],
  ]);
  expect(
    optionText("full").every((text) => text?.includes("Shared by everyone")),
  ).toBe(true);
  expect(
    optionText("primary-only").every((text) =>
      text?.includes("You + 1/2 tutees"),
    ),
  ).toBe(true);

  // A read refresh changes only the second learner's saved availability. The
  // group's controls must immediately agree on the newly mutual catalog ID.
  state.workflowRows = state.workflowRows.map((row) =>
    row.tuteeId === "second"
      ? { ...row, slots: [{ id: "primary-only" }] }
      : row,
  );
  view.rerender(element());
  expect(optionOrder()).toEqual([
    ["", "primary-only", "full", "one"],
    ["", "primary-only", "full", "one"],
  ]);
  expect(
    optionText("primary-only").every((text) =>
      text?.includes("Shared by everyone"),
    ),
  ).toBe(true);
  expect(
    optionText("full").every((text) => text?.includes("You + 1/2 tutees")),
  ).toBe(true);

  // A newly assigned member removes unanimity; a stale workflow row must stop
  // contributing once that learner drops out of the current active roster.
  state.memberTuteeIds = ["tutee", "second", "new"];
  state.workflowRows = [
    ...state.workflowRows,
    { pairingId: "merge-pairing", tuteeId: "new", slots: [{ id: "full" }] },
  ];
  view.rerender(element());
  expect(
    optionText("primary-only").every((text) =>
      text?.includes("You + 2/3 tutees"),
    ),
  ).toBe(true);
  expect(
    optionText("full").every((text) => text?.includes("You + 2/3 tutees")),
  ).toBe(true);
  expect(screen.getAllByText(/No catalog slot is selected/)).toHaveLength(2);
  state.memberTuteeIds = ["tutee", "new"];
  view.rerender(element());
  expect(
    optionText("full").every((text) => text?.includes("Shared by everyone")),
  ).toBe(true);
  expect(
    optionText("primary-only").every((text) =>
      text?.includes("You + 1/2 tutees"),
    ),
  ).toBe(true);
  expect(selections().every((select) => select.value === "one")).toBe(true);
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.setSlot).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
  expect(state.recall).not.toHaveBeenCalled();
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
