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
import zhMessages from "../../../../messages/zh.json";
import esMessages from "../../../../messages/es.json";
import jaMessages from "../../../../messages/ja.json";
import koMessages from "../../../../messages/ko.json";
import elMessages from "../../../../messages/el.json";
import deMessages from "../../../../messages/de.json";
import frMessages from "../../../../messages/fr.json";
import { type Locale } from "~/i18n/config";
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
// Exercise each real bundled catalog; default-hidden languages can be published.
const catalogs = {
  en: messages,
  zh: zhMessages,
  es: esMessages,
  ja: jaMessages,
  ko: koMessages,
  el: elMessages,
  de: deMessages,
  fr: frMessages,
} satisfies Record<Locale, typeof messages>;
const element = (active = true, locale: Locale = "en") => (
  <NextIntlClientProvider
    locale={locale}
    timeZone="Asia/Shanghai"
    messages={catalogs[locale]}
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
  expect(select.options[1]?.parentElement?.getAttribute("label")).toBe(
    "Both Available",
  );
  expect(select.options[2]?.parentElement?.getAttribute("label")).toBe(
    "Other Time Slots",
  );
  expect(select.options[1]?.textContent).toBe("Shared · Fri 15:00–16:00");
  expect(select.options[2]?.textContent).toBe("Same clock · Fri 15:00–16:00");
  expect(
    screen.queryByText(
      /Choice availability|Shared by everyone|not selected by you/,
    ),
  ).toBeNull();
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
it("keeps an inactive linked schedule visible and puts incomplete or nonmatching availability in Other Time Slots", () => {
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
  expect(select.selectedOptions[0]?.disabled).toBe(true);
  expect(screen.queryByRole("group", { name: "Both Available" })).toBeNull();
  expect(select.options[2]?.parentElement?.getAttribute("label")).toBe(
    "Other Time Slots",
  );
  state.slots.push({
    id: "other",
    label: "Other",
    dayOfWeek: 2,
    startMin: 900,
    endMin: 960,
  });
  state.workflowRows[0]!.slots = [{ id: "other" }];
  view.rerender(element());
  expect(screen.queryByRole("group", { name: "Both Available" })).toBeNull();
  expect(state.setSlot).not.toHaveBeenCalled();
});
it.each([
  ["en", "Both Available", "Other Time Slots", "Mon"],
  ["zh", "双方均有空", "其他时段", "周一"],
  ["es", "Ambos disponibles", "Otras franjas horarias", "lun"],
  ["ja", "双方が対応可能", "その他の時間帯", "月"],
  ["ko", "모두 가능한 시간", "기타 시간대", "월"],
  ["el", "Κοινή διαθεσιμότητα", "Άλλες χρονικές ζώνες", "Δευ"],
  ["de", "Beide verfügbar", "Andere Zeitfenster", "Mo"],
  ["fr", "Disponibilités communes", "Autres créneaux horaires", "lun."],
] as const)(
  "shows concise localized slot groups in %s without repeated guidance",
  (locale, both, other, day) => {
    state.selectedSlotIds = ["one"];
    state.workflowRows = [
      { pairingId: "pairing", tuteeId: "tutee", slots: [{ id: "one" }] },
    ];
    render(element(true, locale));
    const select = screen.getAllByRole<HTMLSelectElement>("combobox")[0]!;
    expect(select.querySelector("optgroup")?.label).toBe(both);
    expect(select.options[1]?.textContent).toBe(`Monday · ${day} 15:00–16:00`);
    expect(select.querySelectorAll("optgroup")).toHaveLength(1);
    // The separate empty assignment cannot imply mutual availability with nobody.
    expect(
      screen
        .getAllByRole<HTMLSelectElement>("combobox")[1]!
        .querySelector("optgroup")?.label,
    ).toBe(other);
    expect(select.hasAttribute("aria-describedby")).toBe(false);
    expect(state.confirm).not.toHaveBeenCalled();
    expect(state.setSlot).not.toHaveBeenCalled();
  },
);
it.each(["roster", "availability", "missingTutor", "missingTutee"])(
  "never calls a slot shared after %s availability becomes unknown",
  (failure) => {
    state.selectedSlotIds = ["one"];
    state.workflowRows = [
      { pairingId: "pairing", tuteeId: "tutee", slots: [{ id: "one" }] },
    ];
    const view = render(element());
    const select = screen.getAllByRole<HTMLSelectElement>("combobox")[0]!;
    expect(select.querySelector("optgroup")?.label).toBe("Both Available");
    if (failure === "roster") state.rosterFailure = "transport";
    if (failure === "availability") state.availabilityFailure = "transport";
    if (failure === "missingTutor") state.selectedSlotIds = [];
    if (failure === "missingTutee") state.workflowRows = [];
    view.rerender(element());
    expect(select.querySelector("optgroup")?.label).toBe("Other Time Slots");
    expect(select.value).toBe("one");
    expect(select.options[1]?.textContent).toBe("Monday · Mon 15:00–16:00");
    expect(state.setSlot).not.toHaveBeenCalled();
  },
);
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
  const optionGroup = (slotId: string) =>
    selections().map((select) =>
      [...select.options]
        .find((option) => option.value === slotId)!
        .parentElement?.getAttribute("label"),
    );
  expect(selections()).toHaveLength(2);
  expect(optionOrder()).toEqual([
    ["", "full", "primary-only", "one"],
    ["", "full", "primary-only", "one"],
  ]);
  expect(optionGroup("full").every((text) => text === "Both Available")).toBe(
    true,
  );
  expect(
    optionGroup("primary-only").every((text) => text === "Other Time Slots"),
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
    optionGroup("primary-only").every((text) => text === "Both Available"),
  ).toBe(true);
  expect(optionGroup("full").every((text) => text === "Other Time Slots")).toBe(
    true,
  );

  // A newly assigned member removes unanimity; a stale workflow row must stop
  // contributing once that learner drops out of the current active roster.
  state.memberTuteeIds = ["tutee", "second", "new"];
  state.workflowRows = [
    ...state.workflowRows,
    { pairingId: "merge-pairing", tuteeId: "new", slots: [{ id: "full" }] },
  ];
  view.rerender(element());
  expect(
    optionGroup("primary-only").every((text) => text === "Other Time Slots"),
  ).toBe(true);
  expect(optionGroup("full").every((text) => text === "Other Time Slots")).toBe(
    true,
  );
  expect(screen.queryByRole("group", { name: "Both Available" })).toBeNull();
  state.memberTuteeIds = ["tutee", "new"];
  view.rerender(element());
  expect(optionGroup("full").every((text) => text === "Both Available")).toBe(
    true,
  );
  expect(
    optionGroup("primary-only").every((text) => text === "Other Time Slots"),
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
] as const)("localizes %s tutor pairing schedule evidence", (locale, weekday) => {
  render(element(false, locale));
  expect(screen.getByText(`· ${weekday} 15:00–16:00`)).toBeTruthy();
});

it("never exposes an unconfirmed placeholder schedule in Chinese", () => {
  state.confirmed = false;
  render(element(false, "zh"));
  expect(screen.getByText(`· ${zhMessages.scheduling.awaiting}`)).toBeTruthy();
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
