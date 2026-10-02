/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import TimeSlotsPage from "../(admin)/admin/time-slots/page";
import PairingsPage from "../(admin)/admin/pairings/page";
import MeetingsPage from "../(admin)/admin/meetings/page";
import AdminHome from "../(admin)/admin/page";

const mocks = vi.hoisted(() => ({
  readOnly: false,
  pending: false,
  updateSlot: vi.fn(),
  updatePairing: vi.fn(),
  remove: vi.fn(),
  reset: vi.fn(),
  slots: [
    {
      id: "slot-1",
      label: "Monday block",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      active: true,
    },
  ],
  tutors: [{ id: "tutor-1", englishName: "Alex Tutor", status: "ACTIVE" }],
  pairings: [
    {
      id: "pair-1",
      tutorId: "tutor-1",
      tutor: { id: "tutor-1", englishName: "Alex Tutor", status: "ACTIVE" },
      subject: "Algebra",
      roomId: "room-1",
      room: { name: "204" },
      timeSlotId: "slot-1",
      dayOfWeek: 1,
      startMin: 900,
      endMin: 960,
      timeSlot: { label: "Monday block" },
      tutees: [
        { tuteeId: "student-1", tutee: { englishName: "Jordan Student" } },
        { tuteeId: "student-2", tutee: { englishName: "Casey Student" } },
      ],
    },
  ],
  meetings: [
    {
      id: "meeting-1",
      title: "Long planning meeting title",
      date: new Date("2030-01-05T04:00:00Z"),
      attendances: [
        {
          tutorId: "tutor-1",
          status: "EXCUSED_ABSENT",
          excusedAt: null,
          reason: "Academic competition",
          tutor: { englishName: "Alex Tutor" },
        },
      ],
    },
  ],
  sessions: [
    {
      id: "session-1",
      date: new Date("2030-01-05T00:00:00Z"),
      tutor: { englishName: "Alex Tutor" },
      pairing: { subject: "Algebra" },
      tutorStatus: "PRESENT",
      shCount: 1.5,
      tutees: [
        { tuteeId: "student-1", tutee: { englishName: "Jordan Student" } },
      ],
    },
  ],
}));
vi.mock("./read-only", () => ({ useReadOnly: () => mocks.readOnly }));
vi.mock("./room-grid", () => ({ RoomGrid: () => null }));
vi.mock("./charts", () => ({ BarList: () => null, SegmentBar: () => null }));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/program/features", () => ({
  getFeatures: async () => ({ SERVICE_HOURS: true, CREW: false }),
}));
vi.mock("next-intl/server", () => ({
  getFormatter: async () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
  getTranslations: async () => (key: string) => key,
}));
vi.mock("~/trpc/server", () => ({
  api: {
    admin: {
      pairings: async () => mocks.pairings,
      tutees: async () => [],
      sessions: async () => mocks.sessions,
      crewSummary: async () => ({}),
      periodSummary: async () => ({
        scope: { label: "Term" },
        rows: [],
        totals: {
          total: 1.5,
          earned: 1.5,
          extras: 0,
          punishments: 0,
          present: 0,
          excused: 0,
          unexcused: 0,
        },
      }),
    },
  },
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
      <option value="tutor-1">Alex Tutor</option>
    </select>
  ),
}));
// Ticket generation has its own integration tests; this verifies the edit dialog still passes it through.
vi.mock("./assignment-confirmation", () => ({
  AssignmentConfirmation: ({
    onConfirm,
  }: {
    onConfirm: (ticket?: string) => void;
  }) => (
    <button onClick={() => onConfirm("confirmed-ticket")}>
      Confirm assignment
    </button>
  ),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        timeSlots: { invalidate: vi.fn() },
        pairings: { invalidate: vi.fn() },
        meetings: { invalidate: vi.fn() },
      },
      tutor: {
        myPairings: { invalidate: vi.fn() },
        schedule: { invalidate: vi.fn() },
      },
    }),
    admin: {
      timeSlots: { useQuery: () => ({ data: mocks.slots }) },
      tutors: { useQuery: () => ({ data: mocks.tutors }) },
      tutees: {
        useQuery: () => ({
          data: [
            { id: "student-1", englishName: "Jordan Student" },
            { id: "student-2", englishName: "Casey Student" },
          ],
        }),
      },
      subjects: {
        useQuery: () => ({
          data: [
            { id: "subject-1", name: "Algebra", active: true, level: null },
          ],
        }),
      },
      rooms: {
        useQuery: () => ({
          data: [{ id: "room-1", name: "204", unavailabilities: [] }],
        }),
      },
      pairings: { useQuery: () => ({ data: mocks.pairings }) },
      meetings: { useQuery: () => ({ data: mocks.meetings }) },
      createTimeSlot: { useMutation: () => ({ mutate: vi.fn() }) },
      updateTimeSlot: {
        useMutation: () => ({
          mutate: mocks.updateSlot,
          reset: mocks.reset,
          isPending: mocks.pending,
        }),
      },
      deleteTimeSlot: { useMutation: () => ({ mutate: mocks.remove }) },
      createPairing: { useMutation: () => ({ mutate: vi.fn() }) },
      updatePairing: {
        useMutation: () => ({
          mutate: mocks.updatePairing,
          isPending: mocks.pending,
        }),
      },
      deletePairing: { useMutation: () => ({ mutate: mocks.remove }) },
      createMeeting: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteMeeting: { useMutation: () => ({ mutate: mocks.remove }) },
      recordMeetingAttendance: {
        useMutation: () => ({ mutate: vi.fn(), reset: vi.fn() }),
      },
    },
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
    {children}
  </NextIntlClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOnly = false;
  mocks.pending = false;
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
});
afterEach(cleanup);

function expectActionsLast(table: HTMLElement) {
  const headers = within(table).getAllByRole("columnheader");
  expect(headers.at(-1)?.textContent).toBe("Actions");
  for (const row of within(table).getAllByRole("row").slice(1)) {
    const cells = Array.from(row.querySelectorAll("td, th"));
    for (const cell of cells.slice(0, -1))
      expect(cell.querySelector("button, input, select, a")).toBeNull();
    expect(cells.at(-1)?.querySelector("button, a")).toBeTruthy();
  }
}

it("edits a complete time-slot draft in a dialog and keeps the summary unchanged until saving", () => {
  render(<TimeSlotsPage />, { wrapper });
  const table = screen.getByRole("table", { name: "Time Slots" });
  expectActionsLast(table);
  const trigger = within(table).getByRole("button", {
    name: "Edit: Monday block",
  });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Label"), {
    target: { value: "New Monday block" },
  });
  fireEvent.change(within(dialog).getByLabelText("Start"), {
    target: { value: "15:30" },
  });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Active" }));
  expect(within(table).getByText("Monday block")).toBeTruthy();
  expect(mocks.updateSlot).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
  expect(mocks.updateSlot).toHaveBeenCalledWith({
    id: "slot-1",
    label: "New Monday block",
    dayOfWeek: 1,
    startMin: 930,
    endMin: 960,
    active: false,
  });
});

it("rejects invalid time ranges and cancels the slot draft without a write", () => {
  render(<TimeSlotsPage />, { wrapper });
  const trigger = screen.getByRole("button", { name: "Edit: Monday block" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("End"), {
    target: { value: "14:00" },
  });
  expect(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "Save changes",
    }).disabled,
  ).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.updateSlot).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
});

it("keeps time-slot detail access but removes edits for viewers", () => {
  mocks.readOnly = true;
  render(<TimeSlotsPage />, { wrapper });
  expect(screen.queryByRole("button", { name: /^Edit:/ })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "View details: Monday block" }),
  );
  expect(screen.getByRole("dialog", { name: "Monday block" })).toBeTruthy();
  expect(mocks.updateSlot).not.toHaveBeenCalled();
});

it("replaces pairing rosters with a count and opens the full list through the final column", () => {
  mocks.readOnly = true;
  render(<PairingsPage />, { wrapper });
  const table = screen.getByRole("table", { name: en.admin.pairings.title });
  expectActionsLast(table);
  expect(within(table).queryByText("Jordan Student")).toBeNull();
  expect(within(table).getByText("2")).toBeTruthy();
  fireEvent.click(
    within(table).getByRole("button", {
      name: "View details: Alex Tutor · Algebra",
    }),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Jordan Student")).toBeTruthy();
  expect(within(dialog).getByText("Casey Student")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Edit:/ })).toBeNull();
});

it("retains assignment confirmation and its ticket in the pairing editor dialog", () => {
  render(<PairingsPage />, { wrapper });
  fireEvent.click(
    screen.getByRole("button", { name: "Edit: Alex Tutor · Algebra" }),
  );
  const dialog = screen.getByRole("dialog", {
    name: en.admin.pairings.editPairing,
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: en.admin.pairings.saveChanges }),
  );
  expect(mocks.updatePairing).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm assignment" }));
  expect(mocks.updatePairing).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "pair-1",
      tutorId: "tutor-1",
      subjectId: "subject-1",
      tuteeIds: ["student-1", "student-2"],
      overrideTicket: "confirmed-ticket",
    }),
    expect.anything(),
  );
});

it("keeps meeting totals and matrix cells brief and makes full reasons available from details", () => {
  render(<MeetingsPage />, { wrapper });
  const totals = screen.getByRole("table", { name: "Tutor Attendance" });
  expectActionsLast(totals);
  expect(within(totals).queryByText("Academic competition")).toBeNull();
  fireEvent.click(
    within(totals).getByRole("button", { name: "View details: Alex Tutor" }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText("Academic competition", {
      exact: false,
    }),
  ).toBeTruthy();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Show summary" }));
  const matrix = screen.getByRole("table", { name: "Show summary" });
  expectActionsLast(matrix);
  expect(within(matrix).getByText("EA")).toBeTruthy();
  fireEvent.click(
    within(matrix).getByRole("button", { name: "View details: Alex Tutor" }),
  );
  expect(
    within(screen.getByRole("dialog")).getByRole("heading", {
      name: "Long planning meeting title",
    }),
  ).toBeTruthy();
});

it("opens full recent-session participants without expanding the dashboard table", async () => {
  render(await AdminHome(), { wrapper });
  const table = screen.getByRole("table", {
    name: "admin.dashboard.recentSubmissions.title",
  });
  expect(within(table).queryByText("Jordan Student")).toBeNull();
  fireEvent.click(
    within(table).getByRole("button", {
      name: "View details: Alex Tutor · Algebra",
    }),
  );
  expect(
    within(screen.getByRole("dialog")).getByText("Jordan Student"),
  ).toBeTruthy();
  expect(within(table).getByText("1.5")).toBeTruthy();
});
