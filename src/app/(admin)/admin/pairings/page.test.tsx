// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../../messages/en.json";
import PairingsPage from "./page";
const state = vi.hoisted(() => ({
  readonly: false,
  mode: "FIXED",
  needsRoom: false,
  roomVersion: 2,
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
vi.mock("~/app/_components/assignment-confirmation", () => ({
  AssignmentConfirmation: ({ onConfirm }: { onConfirm: () => void }) => (
    <button onClick={() => onConfirm()}>Confirm assignment</button>
  ),
}));
function row() {
  return {
    id: "pair",
    tutorId: "tutor",
    tutor: { id: "tutor", englishName: "Sample Tutor", status: "ACTIVE" },
    subject: "Math",
    roomId: state.mode === "FIXED" ? "room" : null,
    room: state.mode === "FIXED" ? { name: "204" } : null,
    roomMode: state.mode,
    roomNeedsAssignment: state.needsRoom,
    roomVersion: state.roomVersion,
    timeSlotId: "slot",
    timeSlot: { label: "Monday" },
    scheduleConfirmed: true,
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
      };
    },
    admin: {
      pairings: { useQuery: () => ({ data: [row()], refetch: state.reload }) },
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
  state.needsRoom = false;
  state.readonly = false;
  state.roomVersion = 2;
  state.refresh.mockResolvedValue(undefined);
  state.setRoom.mockResolvedValue({ roomOutcome: "ASSIGNED" });
});
const element = () => (
  <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
    <PairingsPage />
  </NextIntlClientProvider>
);
function openEditor() {
  fireEvent.click(
    screen.getByRole("button", { name: "Edit: Sample Tutor · Math" }),
  );
  return within(screen.getByRole("dialog"));
}
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
  state.needsRoom = true;
  state.readonly = true;
  render(element());
  fireEvent.click(screen.getByRole("button", { name: "Needs room (1)" }));
  expect(screen.getByText("Sample Tutor")).toBeTruthy();
  expect(screen.getByText(en.roomAllocation.needsRoom)).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: en.roomAllocation.retryAllocation }),
  ).toBeNull();
});

it("reuses the creation receipt key after an unknown transport failure", async () => {
  state.create.mockRejectedValueOnce(new Error("Connection interrupted"));
  render(element());
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
