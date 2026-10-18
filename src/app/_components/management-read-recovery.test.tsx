/** @vitest-environment jsdom */
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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh.json";
import RegistrationCodesPage from "../(admin)/admin/registration-codes/page";
import ServiceHoursPage from "../(admin)/admin/service-hours/page";
import TimeSlotsPage from "../(admin)/admin/time-slots/page";
import PairingsPage from "../(admin)/admin/pairings/page";
import { ReadOnlyProvider } from "./read-only";

const remote = vi.hoisted(() => ({
  codes: vi.fn(),
  identity: vi.fn(),
  slots: vi.fn(),
  pairings: vi.fn(),
  tutors: vi.fn(),
  subjects: vi.fn(),
  tutees: vi.fn(),
  rooms: vi.fn(),
  summary: vi.fn(),
  write: vi.fn(),
}));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const read = (path: string[], load: typeof remote.codes) => ({
    _def: () => ({ path }),
    useQuery(
      input?: unknown,
      options?: { enabled?: boolean; staleTime?: number },
    ) {
      return useQuery({
        queryKey: [
          path,
          { ...(input === undefined ? {} : { input }), type: "query" },
        ],
        queryFn: (): unknown => load(),
        ...options,
      });
    },
  });
  const write = {
    useMutation: () => ({
      mutate: remote.write,
      mutateAsync: remote.write,
      reset: vi.fn(),
    }),
  };
  const refresh = { invalidate: vi.fn(), refetch: vi.fn() };
  return {
    api: {
      useUtils: () => ({
        admin: {
          registrationCodes: refresh,
          timeSlots: refresh,
          pairings: refresh,
          rooms: refresh,
          assignmentWorkloads: refresh,
        },
        tutor: { myPairings: refresh, schedule: refresh },
        student: { me: refresh },
        studentWorkflow: { mine: refresh },
        pairingGroups: { mine: refresh },
        notification: { list: refresh, unreadCount: refresh },
      }),
      account: { me: read(["account", "me"], remote.identity) },
      admin: {
        registrationCodes: read(["admin", "registrationCodes"], remote.codes),
        assignmentWorkloads: read(
          ["admin", "assignmentWorkloads"],
          vi.fn(async () => ({ termId: null, tutors: [] })),
        ),
        issueRegistrationCode: write,
        revokeRegistrationCode: write,
        periodSummary: read(["admin", "periodSummary"], remote.summary),
        timeSlots: read(["admin", "timeSlots"], remote.slots),
        createTimeSlot: write,
        updateTimeSlot: write,
        deleteTimeSlot: write,
        pairings: read(["admin", "pairings"], remote.pairings),
        createPairing: write,
        updatePairing: write,
        retryRoomAllocation: write,
        autoAssignUnassignedRooms: write,
        setPairingRoom: write,
        deletePairing: write,
        tutors: read(["admin", "tutors"], remote.tutors),
        subjects: read(["admin", "subjects"], remote.subjects),
        tutees: read(["admin", "tutees"], remote.tutees),
        rooms: read(["admin", "rooms"], remote.rooms),
      },
    },
  };
});
vi.mock("../(admin)/admin/registration-codes/share-card", () => ({
  ShareCard: ({ code }: { code: string }) => <div>{code}</div>,
}));
vi.mock("./qualified-tutor-select", () => ({
  QualifiedTutorSelect: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">—</option>
      <option value="tutor">Tutor A</option>
    </select>
  ),
}));
vi.mock("./assignment-confirmation", () => ({
  AssignmentConfirmation: ({
    onConfirm,
  }: {
    onConfirm: (ticket: string) => void;
  }) => (
    <button onClick={() => onConfirm("existing-ticket")}>
      Confirm admitted assignment
    </button>
  ),
}));
const slot = {
  id: "slot",
  label: "Monday block",
  dayOfWeek: 1,
  startMin: 930,
  endMin: 990,
  active: true,
};
const pairing = {
  id: "pair",
  tutorId: "tutor",
  tutor: { id: "tutor", englishName: "Tutor A", status: "ACTIVE" },
  roomId: "room",
  // This existing assignment predates explicit room intent; retain its legacy
  // route through qualification review rather than the new room-only operation.
  roomMode: "LEGACY",
  roomVersion: 1,
  roomNeedsAssignment: false,
  room: { name: "101" },
  timeSlotId: "slot",
  timeSlot: slot,
  subject: "Math",
  scheduleConfirmed: true,
  dayOfWeek: 1,
  startMin: 930,
  endMin: 990,
  tutees: [],
};
const code = {
  id: "invite",
  label: "Private invitation",
  tutorName: null,
  kind: "TUTOR",
  code: "123456",
  expiresAt: new Date("2099-01-01"),
  status: "active",
};
const totals = {
  scope: { label: "Recorded semester" },
  rows: [
    {
      tutorId: "tutor",
      englishName: "Private Tutor",
      active: true,
      sessions: 3,
      earned: 3,
      extras: 1,
      punishments: 0,
      total: 4,
    },
  ],
};
let client: QueryClient;
function mount(ui: ReactElement, locale = "en", readOnly = false) {
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={locale === "zh" ? zh : en}
        timeZone="Asia/Shanghai"
      >
        <ReadOnlyProvider value={readOnly}>{ui}</ReadOnlyProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
async function refresh(name: string) {
  await act(async () => {
    await client.refetchQueries({ queryKey: [["admin", name]] });
  });
}
const message = (
  key: "loadFailed" | "refreshFailed" | "retry" | "denied",
  section: string,
) => en.managementRecovery[key].replace("{section}", section);
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  vi.clearAllMocks();
  remote.codes.mockResolvedValue([code]);
  remote.identity.mockResolvedValue({ role: "HEAD" });
  remote.slots.mockResolvedValue([slot]);
  remote.pairings.mockResolvedValue([pairing]);
  remote.tutors.mockResolvedValue([pairing.tutor]);
  remote.subjects.mockResolvedValue([
    { id: "subject", name: "Math", active: true, level: null },
  ]);
  remote.tutees.mockResolvedValue([]);
  remote.rooms.mockResolvedValue([
    { id: "room", name: "101", unavailabilities: [] },
  ]);
  remote.summary.mockResolvedValue(totals);
  remote.write.mockResolvedValue({ roomOutcome: "none" });
});
afterEach(() => {
  cleanup();
  client.clear();
});
const cases = [
  {
    name: "registrationCodes",
    load: remote.codes,
    Page: RegistrationCodesPage,
    section: en.admin.registrationCodes.title,
    marker: "Private invitation",
    value: [code],
  },
  {
    name: "periodSummary",
    load: remote.summary,
    Page: ServiceHoursPage,
    section: en.admin.summary.title,
    marker: "Private Tutor",
    value: totals,
  },
  {
    name: "timeSlots",
    load: remote.slots,
    Page: TimeSlotsPage,
    section: en.admin.timeslots.title,
    marker: "Monday block",
    value: [slot],
  },
  {
    name: "pairings",
    load: remote.pairings,
    Page: PairingsPage,
    section: en.admin.pairings.title,
    marker: "Tutor A",
    value: [pairing],
  },
];
it.each(cases)(
  "distinguishes $name initial failure from empty and retries only reads",
  async ({ load, Page, section, marker, value }) => {
    load.mockRejectedValue(new Error("Offline"));
    mount(<Page />);
    await screen.findByText(message("loadFailed", section));
    expect(screen.queryByText(en.admin.registrationCodes.empty)).toBeNull();
    expect(screen.queryByText(en.admin.timeslots.empty)).toBeNull();
    expect(screen.queryByText(en.tablePatterns.noRooms)).toBeNull();
    load.mockResolvedValue(value);
    fireEvent.click(
      screen.getByRole("button", { name: message("retry", section) }),
    );
    await screen.findAllByText(marker);
    expect(remote.write).not.toHaveBeenCalled();
  },
);
it.each(cases)(
  "evicts $name on denial without exposing cached content after a transport retry",
  async ({ name, load, Page, section, marker, value }) => {
    mount(<Page />);
    await screen.findAllByText(marker);
    load.mockRejectedValue(
      Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
    );
    await refresh(name);
    await screen.findByText(message("denied", section));
    expect(screen.queryByText(marker)).toBeNull();
    expect(
      client.getQueryData([["admin", name], { type: "query" }]),
    ).toBeUndefined();
    load.mockRejectedValue(new Error("Offline"));
    fireEvent.click(
      screen.getByRole("button", { name: message("retry", section) }),
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByText(message("denied", section))).toBeTruthy();
    load.mockResolvedValue(value);
    fireEvent.click(
      screen.getByRole("button", { name: message("retry", section) }),
    );
    await screen.findAllByText(marker);
  },
);
it.each(["en", "zh"])(
  "associates %s invitation labels and retains draft fields through failure",
  async (locale) => {
    const m = locale === "zh" ? zh : en;
    mount(<RegistrationCodesPage />, locale);
    await screen.findByText("Private invitation");
    const label = screen.getByLabelText<HTMLInputElement>(
      m.admin.registrationCodes.labelField,
    );
    const email = screen.getByLabelText<HTMLInputElement>(
      m.admin.registrationCodes.emailField,
    );
    fireEvent.change(label, { target: { value: "Unsaved invitation" } });
    fireEvent.change(email, { target: { value: "synthetic@example.test" } });
    remote.codes.mockRejectedValue(new Error("Offline"));
    await refresh("registrationCodes");
    await screen.findByText(
      m.managementRecovery.refreshFailed.replace(
        "{section}",
        m.admin.registrationCodes.title,
      ),
    );
    expect(label.value).toBe("Unsaved invitation");
    expect(email.value).toBe("synthetic@example.test");
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: m.admin.registrationCodes.issue,
      }).disabled,
    ).toBe(true);
    expect(screen.getByText("Private invitation")).toBeTruthy();
  },
);
it("keeps a slot editor draft and in-dialog read retry when its list refresh fails", async () => {
  mount(<TimeSlotsPage />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: `${en.admin.timeslots.edit}: Monday block`,
    }),
  );
  const dialog = screen.getByRole("dialog");
  const label = within(dialog).getByLabelText<HTMLInputElement>(
    en.admin.timeslots.label,
  );
  fireEvent.change(label, { target: { value: "Unsaved slot name" } });
  remote.slots.mockRejectedValue(new Error("Offline"));
  await refresh("timeSlots");
  await within(dialog).findByText(
    message("refreshFailed", en.admin.timeslots.title),
  );
  expect(label.value).toBe("Unsaved slot name");
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: en.admin.timeslots.save,
    }).disabled,
  ).toBe(true);
  remote.slots.mockResolvedValue([slot]);
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: message("retry", en.admin.timeslots.title),
    }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole<HTMLButtonElement>("button", {
        name: en.admin.timeslots.save,
      }).disabled,
    ).toBe(false),
  );
  expect(label.value).toBe("Unsaved slot name");
  expect(remote.write).not.toHaveBeenCalled();
});
it("retains pairing edits, identifies the failed prerequisite and preserves an already-admitted confirmation", async () => {
  mount(<PairingsPage />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: `${en.admin.pairings.edit}: Tutor A · Math`,
    }),
  );
  const dialog = screen.getByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.admin.pairings.saveChanges }),
  );
  await screen.findByRole("button", { name: "Confirm admitted assignment" });
  remote.rooms.mockRejectedValue(new Error("Offline"));
  await refresh("rooms");
  await within(dialog).findByText(
    message("refreshFailed", en.admin.rooms.title),
  );
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: en.admin.pairings.saveChanges,
    }).disabled,
  ).toBe(true);
  expect(
    within(dialog).getByLabelText<HTMLSelectElement>(en.admin.pairings.subject)
      .value,
  ).toBe("Math");
  // A background read does not retroactively change the existing domain ticket.
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm admitted assignment" }),
  );
  await waitFor(() => expect(remote.write).toHaveBeenCalledTimes(1));
  expect(remote.write).toHaveBeenCalledWith(
    expect.objectContaining({ id: "pair", overrideTicket: "existing-ticket" }),
  );
});
it("retains recorded service-hour totals beside background recovery", async () => {
  mount(<ServiceHoursPage />);
  await screen.findAllByText("Private Tutor");
  remote.summary.mockRejectedValue(new Error("Offline"));
  await refresh("periodSummary");
  await screen.findByText(message("refreshFailed", en.admin.summary.title));
  expect(screen.getAllByText("Private Tutor").length).toBeGreaterThan(0);
  expect(remote.write).not.toHaveBeenCalled();
});

it("conceals an already-admitted pairing review when prerequisite authority is denied", async () => {
  mount(<PairingsPage />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: `${en.admin.pairings.edit}: Tutor A · Math`,
    }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.admin.pairings.saveChanges,
    }),
  );
  await screen.findByRole("button", { name: "Confirm admitted assignment" });

  // Transient read recovery cannot revoke a prepared ticket, but authoritative
  // denial must conceal its controls and prevent a cached review from writing.
  remote.rooms.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await refresh("rooms");
  await screen.findByText(message("denied", en.admin.pairings.title));
  expect(
    screen.queryByRole("button", { name: "Confirm admitted assignment" }),
  ).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Tutor A")).toBeNull();
  expect(remote.write).not.toHaveBeenCalled();
});

it("keeps unknown pairing prerequisites distinct from empty editor choices", async () => {
  remote.rooms.mockImplementation(() => new Promise(() => undefined));
  mount(<PairingsPage />);
  await screen.findByText("Tutor A");
  expect(screen.queryByLabelText(en.admin.pairings.subject)).toBeNull();
  expect(screen.queryByLabelText(en.admin.pairings.tutor)).toBeNull();
  expect(screen.queryByText(en.tablePatterns.noRooms)).toBeNull();
  expect(
    screen.getByText(
      en.managementRecovery.loading.replace("{section}", en.admin.rooms.title),
    ),
  ).toBeTruthy();
});

it("retains viewer summaries and read recovery without exposing write controls", async () => {
  mount(<PairingsPage />, "en", true);
  await screen.findByText("Tutor A");
  expect(screen.queryByLabelText(en.admin.pairings.subject)).toBeNull();
  expect(screen.queryByRole("button", { name: /Edit:/ })).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.admin.pairings.delete }),
  ).toBeNull();
  remote.pairings.mockRejectedValue(new Error("Offline"));
  await refresh("pairings");
  await screen.findByText(message("refreshFailed", en.admin.pairings.title));
  expect(screen.getByText("Tutor A")).toBeTruthy();
  expect(remote.write).not.toHaveBeenCalled();
});

// Private review evidence has a shorter lifetime than cached read recovery.
// A transport error retains it; authoritative denial releases it permanently.
async function openBulkRoomReview() {
  const trigger = await screen.findByRole<HTMLButtonElement>("button", {
    name: en.roomAllocation.autoAssignAll,
  });
  await waitFor(() => expect(trigger.disabled).toBe(false));
  fireEvent.click(trigger);
  return screen.getByRole("dialog");
}
it.each(["FORBIDDEN", "UNAUTHORIZED"])(
  "releases a bulk room review on %s without reviving it after read recovery",
  async (denial) => {
    remote.pairings.mockResolvedValue([
      { ...pairing, room: null, roomId: null, roomMode: "AUTO" },
    ]);
    mount(<PairingsPage />);
    const review = await openBulkRoomReview();
    expect(review.textContent).toContain("Tutor A · Math");
    remote.rooms.mockRejectedValue(new Error("Offline"));
    await refresh("rooms");
    await screen.findByText(message("refreshFailed", en.admin.rooms.title));
    expect(screen.getByRole("dialog")).toBe(review);

    remote.rooms.mockRejectedValue(
      Object.assign(new Error("Denied"), { data: { code: denial } }),
    );
    await refresh("rooms");
    await screen.findByText(message("denied", en.admin.pairings.title));
    expect(screen.queryByRole("dialog")).toBeNull();
    remote.rooms.mockRejectedValue(new Error("Offline"));
    fireEvent.click(
      screen.getByRole("button", {
        name: message("retry", en.admin.pairings.title),
      }),
    );
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByRole("dialog")).toBeNull();
    remote.rooms.mockResolvedValue([
      { id: "room", name: "101", unavailabilities: [] },
    ]);
    fireEvent.click(
      screen.getByRole("button", {
        name: message("retry", en.admin.pairings.title),
      }),
    );
    await screen.findByText("Tutor A");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(remote.write).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: en.roomAllocation.autoAssignAll }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  },
);

it("does not replay an admitted bulk write that settles after its evidence is revoked", async () => {
  remote.pairings.mockResolvedValue([
    { ...pairing, room: null, roomId: null, roomMode: "AUTO" },
  ]);
  let finish!: (result: {
    assigned: number;
    unassigned: number;
    total: number;
  }) => void;
  remote.write.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount(<PairingsPage />);
  await openBulkRoomReview();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: en.roomAllocation.autoAssignAll,
    }),
  );
  expect(remote.write).toHaveBeenCalledOnce();
  remote.rooms.mockRejectedValue(
    Object.assign(new Error("Denied"), { data: { code: "FORBIDDEN" } }),
  );
  await refresh("rooms");
  await screen.findByText(message("denied", en.admin.pairings.title));
  await act(async () => finish({ assigned: 1, unassigned: 0, total: 1 }));
  remote.rooms.mockResolvedValue([
    { id: "room", name: "101", unavailabilities: [] },
  ]);
  fireEvent.click(
    screen.getByRole("button", {
      name: message("retry", en.admin.pairings.title),
    }),
  );
  await screen.findByText("Tutor A");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText(en.actionReview.applied)).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.roomAllocation.autoAssignAll,
    }).disabled,
  ).toBe(true);
  expect(remote.write).toHaveBeenCalledOnce();
});
