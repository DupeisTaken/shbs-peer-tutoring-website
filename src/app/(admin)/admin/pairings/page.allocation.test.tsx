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
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "../../../../../messages/en.json";
import zh from "../../../../../messages/zh.json";
import PairingsPage from "./page";
type PairingOverride = {
  id: string;
  subject?: string;
  groupId?: string | null;
  roomMode?: string;
  room?: { name: string } | null;
  roomId?: string | null;
  roomNeedsAssignment?: boolean;
  scheduleConfirmed?: boolean;
  roomVersion?: number;
};
const state = vi.hoisted(() => ({
  readonly: false,
  grouped: false,
  mode: "FIXED",
  needsRoom: false,
  confirmed: true,
  assignedRoom: true,
  roomVersion: 2,
  rows: null as PairingOverride[] | null,
  autoAssign: vi.fn(async (_input: unknown) => ({
    assigned: 1,
    unassigned: 0,
    total: 1,
  })),
  setRoom: vi.fn(async (_input: unknown) => ({ roomOutcome: "ASSIGNED" })),
  create: vi.fn(async (_input: unknown) => ({ roomOutcome: "ASSIGNED" })),
  update: vi.fn(async () => ({ roomOutcome: "MOVED" })),
  refresh: vi.fn(async () => undefined),
  reload: vi.fn(),
  retry: vi.fn(async () => ({ roomOutcome: "ASSIGNED" })),
}));
vi.mock("~/app/_components/read-only", () => ({
  useReadOnly: () => state.readonly,
}));
vi.mock("~/app/_components/room-grid", () => ({
  RoomGrid: () => <div>Room timetable</div>,
}));
vi.mock("~/app/_components/qualified-tutor-select", () => ({
  QualifiedTutorSelect: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" />
      <option value="tutor">Tutor</option>
    </select>
  ),
}));
vi.mock("~/app/_components/assignment-workload", () => ({
  useAssignmentWorkloads: () => ({
    data: { tutors: [], termId: "term" },
    isFetching: false,
  }),
  AssignmentWorkloadFeedback: () => null,
  WorkloadAssignmentConfirmation: ({
    onConfirm,
    busy,
  }: {
    onConfirm: () => Promise<unknown>;
    busy: boolean;
  }) => (
    <button
      disabled={busy}
      onClick={() => void onConfirm().catch(() => undefined)}
    >
      Confirm assignment
    </button>
  ),
}));
vi.mock("~/app/_components/assignment-confirmation", () => ({
  AssignmentConfirmation: ({ onConfirm }: { onConfirm: () => void }) => (
    <button onClick={() => onConfirm()}>Confirm assignment</button>
  ),
}));
function row() {
  return {
    id: "pair",
    groupId: state.grouped ? "shared" : null,
    tutorId: "tutor",
    tutor: { id: "tutor", englishName: "Sample Tutor", status: "ACTIVE" },
    subject: "Math",
    roomId: state.assignedRoom ? "room" : null,
    room: state.assignedRoom ? { name: "204" } : null,
    roomMode: state.mode,
    roomNeedsAssignment: state.needsRoom,
    roomVersion: state.roomVersion,
    timeSlotId: "slot",
    timeSlot: { label: "Monday" },
    scheduleConfirmed: state.confirmed,
    dayOfWeek: 1,
    startMin: 900,
    endMin: 960,
    tutees: [],
  };
}
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => {
      const read = { invalidate: state.refresh };
      return {
        admin: { pairings: read, rooms: read, timeSlots: read },
        notification: { list: read, unreadCount: read },
        tutor: { myPairings: read, schedule: read },
        student: { me: read },
        studentWorkflow: { mine: read },
        pairingGroups: { mine: read },
      };
    },
    admin: {
      pairings: {
        useQuery: () => ({
          data: state.rows
            ? state.rows.map((override) => ({ ...row(), ...override }))
            : state.grouped
              ? [row(), { ...row(), id: "sibling", subject: "Physics" }]
              : [row()],
          refetch: state.reload,
        }),
      },
      tutors: {
        useQuery: () => ({
          data: [
            { id: "tutor", englishName: "Sample Tutor", status: "ACTIVE" },
          ],
        }),
      },
      subjects: {
        useQuery: () => ({
          data: [{ id: "subject", name: "Math", active: true, level: null }],
        }),
      },
      tutees: { useQuery: () => ({ data: [] }) },
      rooms: {
        useQuery: () => ({
          data: [{ id: "room", name: "204", unavailabilities: [] }],
        }),
      },
      timeSlots: {
        useQuery: () => ({
          data: [
            {
              id: "slot",
              label: "Monday",
              active: true,
              dayOfWeek: 1,
              startMin: 900,
              endMin: 960,
            },
            {
              id: "slot2",
              label: "Tuesday",
              active: true,
              dayOfWeek: 2,
              startMin: 900,
              endMin: 960,
            },
          ],
        }),
      },
      createPairing: { useMutation: () => ({ mutateAsync: state.create }) },
      updatePairing: { useMutation: () => ({ mutateAsync: state.update }) },
      setPairingRoom: { useMutation: () => ({ mutateAsync: state.setRoom }) },
      retryRoomAllocation: {
        useMutation: () => ({ mutateAsync: state.retry }),
      },
      autoAssignUnassignedRooms: {
        useMutation: () => ({ mutateAsync: state.autoAssign }),
      },
      deletePairing: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.mode = "FIXED";
  state.grouped = false;
  state.needsRoom = false;
  state.confirmed = true;
  state.assignedRoom = true;
  state.readonly = false;
  state.roomVersion = 2;
  state.rows = null;
  state.autoAssign.mockResolvedValue({ assigned: 1, unassigned: 0, total: 1 });
  state.refresh.mockResolvedValue(undefined);
  state.setRoom.mockResolvedValue({ roomOutcome: "ASSIGNED" });
});
const element = (locale: "en" | "zh" = "en") => (
  <QueryClientProvider client={new QueryClient()}>
    <NextIntlClientProvider
      locale={locale}
      timeZone="UTC"
      messages={locale === "en" ? en : zh}
    >
      <PairingsPage />
    </NextIntlClientProvider>
  </QueryClientProvider>
);
function openEditor() {
  fireEvent.click(
    screen.getByRole("button", { name: "Edit: Sample Tutor · Math" }),
  );
  return within(screen.getByRole("dialog"));
}

// The summary has one stable information hierarchy for staff and observers;
// permissions change available actions, not the meaning or position of columns.
it.each([
  ["en", false],
  ["zh", false],
  ["en", true],
  ["zh", true],
] as const)(
  "keeps six summary columns in %s (read-only: %s)",
  (locale, readOnly) => {
    state.readonly = readOnly;
    const messages = locale === "en" ? en : zh;
    render(element(locale));
    const table = within(
      screen.getByRole("table", { name: messages.admin.pairings.title }),
    );
    expect(
      table.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual([
      messages.admin.pairings.colTutor,
      messages.admin.pairings.colSubject,
      messages.admin.pairings.colWhen,
      messages.admin.pairings.colRoom,
      messages.admin.pairings.colTutees,
      messages.tablePatterns.actions,
    ]);
    expect(table.getAllByRole("cell")).toHaveLength(6);
    expect(
      table.getByRole("button", {
        name: `${messages.tablePatterns.details}: Sample Tutor · Math`,
      }),
    ).toBeTruthy();
    const edit = table.queryByRole("button", {
      name: `${messages.admin.pairings.edit}: Sample Tutor · Math`,
    });
    const remove = table.queryByRole("button", {
      name: messages.admin.pairings.delete,
    });
    expect(Boolean(edit)).toBe(!readOnly);
    expect(Boolean(remove)).toBe(!readOnly);
    expect(
      Boolean(
        screen.queryByRole("button", {
          name: messages.roomAllocation.autoAssignAll,
        }),
      ),
    ).toBe(!readOnly);
  },
);

// Missing-room summaries deliberately share a compact symbol. The detail reader
// must still distinguish scheduling, shortage, intentional NONE and legacy intent.
const roomCases = [
  {
    label: "fixed reservation",
    mode: "FIXED",
    room: true,
    confirmed: true,
    needsRoom: false,
    detail: "fixed",
  },
  {
    label: "automatic reservation",
    mode: "AUTO",
    room: true,
    confirmed: true,
    needsRoom: false,
    detail: "auto",
  },
  {
    label: "unscheduled fixed selection",
    mode: "FIXED",
    room: true,
    confirmed: false,
    needsRoom: false,
    detail: "awaiting",
  },
  {
    label: "unscheduled automatic pairing",
    mode: "AUTO",
    room: false,
    confirmed: false,
    needsRoom: false,
    detail: "awaiting",
  },
  {
    label: "automatic shortage",
    mode: "AUTO",
    room: false,
    confirmed: true,
    needsRoom: true,
    detail: "needsRoom",
  },
  {
    label: "automatic without reservation",
    mode: "AUTO",
    room: false,
    confirmed: true,
    needsRoom: false,
    detail: "unassigned",
  },
  {
    label: "intentional no physical room",
    mode: "NONE",
    room: false,
    confirmed: true,
    needsRoom: false,
    detail: "none",
  },
  {
    label: "legacy roomless pairing",
    mode: "LEGACY",
    room: false,
    confirmed: true,
    needsRoom: false,
    detail: "legacy",
  },
] as const;
it.each(
  (["en", "zh"] as const).flatMap((locale) =>
    roomCases.map((roomCase) => ({ locale, ...roomCase })),
  ),
)(
  "summarizes $label and preserves its detail meaning ($locale)",
  ({ locale, mode, room, confirmed, needsRoom, detail }) => {
    state.mode = mode;
    state.assignedRoom = room;
    state.confirmed = confirmed;
    state.needsRoom = needsRoom;
    const messages = locale === "en" ? en : zh;
    render(element(locale));
    const table = within(
      screen.getByRole("table", { name: messages.admin.pairings.title }),
    );
    const roomCell = table.getAllByRole("cell")[3]!;
    const detailText = {
      fixed: messages.roomAllocation.mode.FIXED,
      auto: messages.roomAllocation.mode.AUTO,
      awaiting: messages.roomAllocation.awaiting,
      needsRoom: messages.roomAllocation.needsRoom,
      unassigned: messages.roomAllocation.outcome.UNASSIGNED,
      none: messages.roomAllocation.mode.NONE,
      legacy: messages.roomAllocation.mode.LEGACY,
    }[detail];
    const summaryText =
      mode === "LEGACY"
        ? messages.roomAllocation.outcome.UNASSIGNED
        : detailText;
    const label =
      confirmed && room ? "204" : !confirmed || mode === "NONE" ? "-" : "x";
    const marker = within(roomCell).getByText(label);
    expect(marker.getAttribute("aria-hidden")).toBe("true");
    expect(
      table.getAllByRole("cell", {
        name: confirmed && room ? `204 · ${summaryText}` : summaryText,
      }),
    ).toContain(roomCell);
    const badge = within(roomCell).getByTitle(summaryText);
    // Color reinforces the translated status; it is never the only distinction.
    if (!confirmed || !room) {
      expect(
        badge.classList.contains("badge-slate") ||
          badge.classList.contains("bg-slate-100"),
      ).toBe(true);
      expect(badge.classList.contains("bg-white")).toBe(false);
      expect(badge.classList.contains("badge-amber")).toBe(false);
      if (needsRoom) expect(badge.classList.contains("text-amber-700")).toBe(true);
    } else if (mode === "FIXED") {
      expect(badge.classList.contains("bg-accent-100")).toBe(true);
      expect(badge.classList.contains("text-accent-800")).toBe(true);
    } else expect(badge.classList.contains("badge-slate")).toBe(true);
    fireEvent.click(
      table.getByRole("button", {
        name: `${messages.tablePatterns.details}: Sample Tutor · Math`,
      }),
    );
    const reader = within(screen.getByRole("dialog"));
    expect(reader.getAllByText(detailText).length).toBeGreaterThan(0);
    expect(Boolean(reader.queryByText("204"))).toBe(confirmed && room);
    expect(state.setRoom).not.toHaveBeenCalled();
    expect(state.retry).not.toHaveBeenCalled();
  },
);

it.each(["AUTO", "NONE", "LEGACY"])(
  "does not infer a shortage from a roomless %s summary",
  (mode) => {
    state.mode = mode;
    state.assignedRoom = false;
    render(element());
    expect(
      within(screen.getByRole("table")).getByText(mode === "NONE" ? "-" : "x"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: en.roomAllocation.needsRoomReservations.replace("{count}", "0"),
      }),
    );
    expect(screen.queryByText("Sample Tutor")).toBeNull();
    expect(screen.getByText(en.roomAllocation.empty)).toBeTruthy();
  },
);

function prepareBulkRoomless() {
  state.mode = "AUTO";
  state.assignedRoom = false;
}
function openBulkReview() {
  fireEvent.click(
    screen.getByRole("button", { name: en.roomAllocation.autoAssignAll }),
  );
  return within(screen.getByRole("dialog"));
}

it("reviews all eligible reservations independently of the shortage filter and counts a shared unit once", async () => {
  prepareBulkRoomless();
  state.rows = [
    { id: "shortage", roomNeedsAssignment: true },
    { id: "legacy", roomMode: "LEGACY", roomVersion: 3 },
    { id: "group-a", groupId: "group", subject: "Grouped Math" },
    {
      id: "group-b",
      groupId: "group",
      subject: "Grouped Physics",
      roomVersion: 4,
    },
    { id: "none", roomMode: "NONE" },
    { id: "unscheduled", scheduleConfirmed: false },
    { id: "reserved", roomId: "room", room: { name: "204" } },
  ];
  render(element());
  fireEvent.click(
    screen.getByRole("button", {
      name: en.roomAllocation.needsRoomReservations.replace("{count}", "1"),
    }),
  );
  expect(within(screen.getByRole("table")).getAllByRole("cell")).toHaveLength(
    6,
  );
  const review = openBulkReview();
  expect(
    review.getByText(en.roomAllocation.autoAssignCount.replace("{count}", "3")),
  ).toBeTruthy();
  expect(state.autoAssign).not.toHaveBeenCalled();
  fireEvent.click(
    review.getByRole("button", { name: en.roomAllocation.autoAssignAll }),
  );
  await waitFor(() =>
    expect(state.autoAssign).toHaveBeenCalledWith({
      targets: [
        { id: "shortage", expectedRoomVersion: 2 },
        { id: "legacy", expectedRoomVersion: 3 },
        { id: "group-a", expectedRoomVersion: 2 },
        { id: "group-b", expectedRoomVersion: 4 },
      ],
    }),
  );
  expect(state.setRoom).not.toHaveBeenCalled();
  expect(state.retry).not.toHaveBeenCalled();
});

it("can cancel a bulk review without changing allocation", () => {
  prepareBulkRoomless();
  render(element());
  const review = openBulkReview();
  fireEvent.click(review.getByRole("button", { name: en.actionReview.cancel }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.autoAssign).not.toHaveBeenCalled();
});

it("disables bulk allocation when all pairings are assigned, unscheduled or intentionally roomless", () => {
  state.rows = [
    { id: "reserved" },
    { id: "unscheduled", scheduleConfirmed: false },
    { id: "none", roomMode: "NONE", roomId: null, room: null },
  ];
  render(element());
  const trigger = screen.getByRole<HTMLButtonElement>("button", {
    name: en.roomAllocation.autoAssignAll,
  });
  expect(trigger.disabled).toBe(true);
  fireEvent.click(trigger);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.autoAssign).not.toHaveBeenCalled();
});

it("retains the reviewed versions after a stale bulk failure and a background update", async () => {
  prepareBulkRoomless();
  state.autoAssign.mockRejectedValueOnce(
    new Error("Room allocation changed; reload before trying again."),
  );
  const view = render(element());
  const review = openBulkReview();
  fireEvent.click(
    review.getByRole("button", { name: en.roomAllocation.autoAssignAll }),
  );
  await waitFor(() =>
    expect(
      review.getByText("Room allocation changed; reload before trying again."),
    ).toBeTruthy(),
  );
  state.roomVersion = 9;
  view.rerender(element());
  fireEvent.click(
    review.getByRole("button", { name: en.roomAllocation.autoAssignAll }),
  );
  await waitFor(() => expect(state.autoAssign).toHaveBeenCalledTimes(2));
  expect(state.autoAssign.mock.calls.map(([input]) => input)).toEqual([
    { targets: [{ id: "pair", expectedRoomVersion: 2 }] },
    { targets: [{ id: "pair", expectedRoomVersion: 2 }] },
  ]);
});

it("admits one bulk write and keeps review dismissal locked while it is pending", async () => {
  prepareBulkRoomless();
  let finish!: (result: {
    assigned: number;
    unassigned: number;
    total: number;
  }) => void;
  state.autoAssign.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(element());
  const review = openBulkReview();
  const confirm = review.getByRole<HTMLButtonElement>("button", {
    name: en.roomAllocation.autoAssignAll,
  });
  act(() => {
    fireEvent.click(confirm);
    fireEvent.click(confirm);
  });
  expect(state.autoAssign).toHaveBeenCalledTimes(1);
  expect(confirm.matches(":disabled")).toBe(true);
  const cancel = review.getByRole<HTMLButtonElement>("button", {
    name: en.actionReview.cancel,
  });
  fireEvent.click(cancel);
  expect(screen.getByRole("dialog")).toBeTruthy();
  await act(async () => finish({ assigned: 1, unassigned: 0, total: 1 }));
  await waitFor(() =>
    expect(review.getByText(en.actionReview.applied)).toBeTruthy(),
  );
  expect(state.autoAssign).toHaveBeenCalledTimes(1);
});

it("reports bulk outcome and retries only reads after an accepted write fails to refresh", async () => {
  prepareBulkRoomless();
  state.rows = [{ id: "first" }, { id: "second" }];
  state.autoAssign.mockResolvedValueOnce({
    assigned: 1,
    unassigned: 1,
    total: 2,
  });
  state.refresh.mockRejectedValueOnce(new Error("Offline"));
  render(element());
  const review = openBulkReview();
  fireEvent.click(
    review.getByRole("button", { name: en.roomAllocation.autoAssignAll }),
  );
  await waitFor(() =>
    expect(review.getByText(en.actionReview.refreshFailed)).toBeTruthy(),
  );
  expect(
    review.getByText(
      en.roomAllocation.autoAssignResult
        .replace("{assigned}", "1")
        .replace("{unassigned}", "1")
        .replace("{total}", "2"),
    ),
  ).toBeTruthy();
  expect(
    review.queryByRole("button", { name: en.roomAllocation.autoAssignAll }),
  ).toBeNull();
  fireEvent.click(review.getByRole("button", { name: en.actionReview.retry }));
  await waitFor(() =>
    expect(review.queryByText(en.actionReview.refreshFailed)).toBeNull(),
  );
  expect(review.getByText(en.actionReview.applied)).toBeTruthy();
  expect(state.autoAssign).toHaveBeenCalledTimes(1);
});

it("presents queued bulk approval without claiming an allocation outcome or replaying the proposal", async () => {
  prepareBulkRoomless();
  state.autoAssign.mockRejectedValueOnce({
    data: { approvalId: "bulk-approval" },
  });
  render(element());
  const review = openBulkReview();
  fireEvent.click(
    review.getByRole("button", { name: en.roomAllocation.autoAssignAll }),
  );
  await waitFor(() =>
    expect(review.getByText(en.actionReview.queued)).toBeTruthy(),
  );
  expect(review.queryByText(en.actionReview.applied)).toBeNull();
  expect(review.queryByText(/^Checked \d+ reservations:/)).toBeNull();
  expect(
    review
      .getByRole("link", { name: en.actionReview.viewRequest })
      .getAttribute("href"),
  ).toBe("/admin/approvals?request=bulk-approval");
  expect(
    review.queryByRole("button", { name: en.roomAllocation.autoAssignAll }),
  ).toBeNull();
  expect(state.refresh).not.toHaveBeenCalled();
  fireEvent.click(review.getByRole("button", { name: en.actionReview.close }));
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: en.roomAllocation.autoAssignAll,
    }).disabled,
  ).toBe(true);
  expect(state.autoAssign).toHaveBeenCalledTimes(1);
});

it("fixed rooms require deliberate release and room-only changes bypass assignment replacement", async () => {
  render(element());
  const editor = openEditor();
  fireEvent.change(
    editor.getByRole("combobox", { name: en.roomAllocation.modeLabel }),
    { target: { value: "AUTO" } },
  );
  expect(
    editor.getByRole<HTMLButtonElement>("button", {
      name: en.admin.pairings.saveChanges,
    }).disabled,
  ).toBe(true);
  fireEvent.click(
    editor.getByRole("checkbox", { name: en.roomAllocation.release }),
  );
  fireEvent.click(
    editor.getByRole("button", { name: en.admin.pairings.saveChanges }),
  );
  await waitFor(() =>
    expect(state.setRoom).toHaveBeenCalledWith({
      id: "pair",
      roomMode: "AUTO",
      roomId: null,
      expectedRoomVersion: 2,
      releaseRoomToAuto: true,
    }),
  );
  expect(state.update).not.toHaveBeenCalled();
  expect(screen.queryByText("Confirm assignment")).toBeNull();
});
it("accepted write with failed refresh cannot replay allocation; Retry only reads", async () => {
  state.refresh.mockRejectedValueOnce(new Error("Offline"));
  render(element());
  const editor = openEditor();
  fireEvent.change(
    editor.getByRole("combobox", { name: en.roomAllocation.modeLabel }),
    { target: { value: "NONE" } },
  );
  fireEvent.click(
    editor.getByRole("button", { name: en.admin.pairings.saveChanges }),
  );
  await waitFor(() =>
    expect(screen.getByText(en.roomAllocation.savedRefreshFailed)).toBeTruthy(),
  );
  expect(
    editor.getByRole<HTMLButtonElement>("button", {
      name: en.admin.pairings.saveChanges,
    }).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: en.roomAllocation.retryRefresh }),
  );
  await waitFor(() =>
    expect(screen.queryByText(en.roomAllocation.savedRefreshFailed)).toBeNull(),
  );
  expect(state.setRoom).toHaveBeenCalledTimes(1);
});
it("queued room intent stays unapplied and prevents resubmission", async () => {
  state.setRoom.mockRejectedValueOnce({ data: { approvalId: "review" } });
  render(element());
  const editor = openEditor();
  fireEvent.change(
    editor.getByRole("combobox", { name: en.roomAllocation.modeLabel }),
    { target: { value: "NONE" } },
  );
  fireEvent.click(
    editor.getByRole("button", { name: en.admin.pairings.saveChanges }),
  );
  await waitFor(() =>
    expect(screen.getByText(en.roomAllocation.queued)).toBeTruthy(),
  );
  expect(
    editor.getByRole<HTMLButtonElement>("button", {
      name: en.admin.pairings.saveChanges,
    }).disabled,
  ).toBe(true);
  expect(screen.getByText("204")).toBeTruthy();
});
it("failed writes retain the chosen room intent and original version across background reads", async () => {
  state.setRoom.mockRejectedValueOnce(new Error("Conflict"));
  const view = render(element());
  const editor = openEditor();
  fireEvent.change(
    editor.getByRole("combobox", { name: en.roomAllocation.modeLabel }),
    { target: { value: "NONE" } },
  );
  fireEvent.click(
    editor.getByRole("button", { name: en.admin.pairings.saveChanges }),
  );
  await waitFor(() => expect(screen.getByText("Conflict")).toBeTruthy());
  state.roomVersion = 8;
  view.rerender(element());
  expect(
    editor.getByRole<HTMLSelectElement>("combobox", {
      name: en.roomAllocation.modeLabel,
    }).value,
  ).toBe("NONE");
  fireEvent.click(
    editor.getByRole("button", { name: en.admin.pairings.saveChanges }),
  );
  await waitFor(() => expect(state.setRoom).toHaveBeenCalledTimes(2));
  expect(state.setRoom.mock.calls[1]?.[0]).toEqual(
    expect.objectContaining({ expectedRoomVersion: 2 }),
  );
});
it("shortage filtering remains available to observers without allocation controls", () => {
  state.mode = "AUTO";
  state.assignedRoom = false;
  state.needsRoom = true;
  state.readonly = true;
  render(element());
  fireEvent.click(
    screen.getByRole("button", {
      name: en.roomAllocation.needsRoomReservations.replace("{count}", "1"),
    }),
  );
  expect(screen.getByText("Sample Tutor")).toBeTruthy();
  const table = within(screen.getByRole("table"));
  expect(table.getByText("x")).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.roomAllocation.retryAllocation }),
  ).toBeNull();
  fireEvent.click(
    table.getByRole("button", {
      name: `${en.tablePatterns.details}: Sample Tutor · Math`,
    }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText(en.roomAllocation.needsRoom),
  ).toBeTruthy();
});

it("reuses the creation receipt key after an unknown transport failure", async () => {
  state.create.mockRejectedValueOnce(new Error("Connection interrupted"));
  render(element());
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.pairings.newPairing }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: en.admin.creationRisk.acknowledgement,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.creationRisk.continue }),
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: en.admin.pairings.subject }),
    { target: { value: "Math" } },
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: en.admin.pairings.tutor }),
    { target: { value: "tutor" } },
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: en.admin.pairings.timeSlot }),
    { target: { value: "slot" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: en.admin.pairings.createPairing }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm assignment" }));
  await waitFor(() =>
    expect(screen.getByText("Connection interrupted")).toBeTruthy(),
  );
  const first = state.create.mock.calls[0]?.[0] as { clientKey: string };
  expect(first.clientKey).toMatch(/^[0-9a-f-]{36}$/);
  fireEvent.click(screen.getByRole("button", { name: "Confirm assignment" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(2));
  expect(state.create.mock.calls[1]?.[0]).toEqual(
    expect.objectContaining({ clientKey: first.clientKey }),
  );
});

it("shows the complete shared room unit in edit and retry review while counting one reservation", () => {
  state.grouped = true;
  state.mode = "AUTO";
  state.assignedRoom = false;
  state.needsRoom = true;
  render(element());
  expect(
    screen.getByRole("button", {
      name: en.roomAllocation.needsRoomReservations.replace("{count}", "1"),
    }),
  ).toBeTruthy();
  const editor = openEditor();
  expect(
    editor.getByText(
      en.roomAllocation.groupScope.replace("{subjects}", "Math + Physics"),
    ),
  ).toBeTruthy();
  fireEvent.click(editor.getByRole("button", { name: en.common.close }));
  fireEvent.click(
    screen.getAllByRole("button", {
      name: en.roomAllocation.retryAllocation,
    })[0]!,
  );
  expect(
    within(screen.getByRole("dialog")).getByText(
      en.roomAllocation.groupScope.replace("{subjects}", "Math + Physics"),
    ),
  ).toBeTruthy();
  expect(state.retry).not.toHaveBeenCalled();
});
