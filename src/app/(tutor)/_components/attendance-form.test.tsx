/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  scheduleConfirmed: true,
  mergeScheduleConfirmed: false,
  mergeIds: [] as string[],
  pending: false,
  success: false,
  error: "",
  reset: vi.fn(),
  setAttendanceLocked: vi.fn(),
  fetchMonthlyTotal: vi.fn(async () => undefined),
  invalidateSessions: vi.fn(async () => undefined),
  submitOnSuccess: undefined as undefined | (() => Promise<void>),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("next-intl", () => ({
  useTimeZone: () => "Asia/Shanghai",
  useFormatter: () => ({
    dateTime: (date: Date, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en", {
        timeZone: "Asia/Shanghai",
        ...options,
      }).format(date),
  }),
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: vi.fn(), dialog: null }),
}));
vi.mock("~/app/(tutor)/_components/merge-context", () => ({
  useMerge: () => ({
    setPrimaryPairingId: vi.fn(),
    mergeIds: mocks.mergeIds,
    setMergeIds: vi.fn(),
    setAttendanceLocked: mocks.setAttendanceLocked,
  }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tutor: {
        myMonthlyTotal: { fetch: mocks.fetchMonthlyTotal },
        mySessions: { invalidate: mocks.invalidateSessions },
      },
    }),
    tutor: {
      myPairings: {
        useQuery: () => ({
          data: [
            {
              id: "pairing-1",
              dayOfWeek: 1,
              scheduleConfirmed: mocks.scheduleConfirmed,
              subject: "Mathematics",
              startMin: 900,
              endMin: 960,
              room: { id: "room-1", name: "A101" },
              tutees: [],
            },
            {
              id: "pairing-2",
              subject: "Mathematics",
              dayOfWeek: 1,
              scheduleConfirmed: mocks.mergeScheduleConfirmed,
              startMin: 930,
              endMin: 990,
              room: null,
              tutees: [],
            },
          ],
          isLoading: false,
        }),
      },
      myTuteeDiscipline: { useQuery: () => ({ data: [] }) },
      rooms: {
        useQuery: () => ({ data: [{ id: "room-1", name: "A101" }] }),
      },
      schedule: {
        useQuery: () => ({ data: { pairings: [], blocks: [] } }),
      },
      submitAttendance: {
        useMutation: (options: { onSuccess?: () => Promise<void> }) => {
          mocks.submitOnSuccess = options.onSuccess;
          return {
            mutate: vi.fn(),
            isPending: mocks.pending,
            isSuccess: mocks.success,
            error: mocks.error ? new Error(mocks.error) : null,
            reset: mocks.reset,
          };
        },
      },
    },
    program: { features: { useQuery: () => ({ data: {} }) } },
  },
}));

import { AttendanceForm } from "./attendance-form";

afterEach(() => {
  cleanup();
  mocks.refresh.mockReset();
  mocks.fetchMonthlyTotal.mockClear();
  mocks.invalidateSessions.mockClear();
  mocks.submitOnSuccess = undefined;
  mocks.scheduleConfirmed = true;
  mocks.mergeScheduleConfirmed = false;
  mocks.mergeIds = [];
  mocks.pending = false;
  mocks.success = false;
  mocks.error = "";
  mocks.reset.mockClear();
  mocks.setAttendanceLocked.mockClear();
});

it("keeps a failed attendance draft and freezes pending/successful snapshots until a new entry", () => {
  const view = render(<AttendanceForm />);
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), {
    target: { value: "pairing-1" },
  });
  fireEvent.change(screen.getByLabelText("tutor.attendance.comments"), {
    target: { value: "Retained attendance notes" },
  });
  mocks.error = "Synthetic rejected write";
  view.rerender(<AttendanceForm />);
  expect(screen.getByRole("alert").textContent).toBe(mocks.error);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("tutor.attendance.comments")
      .value,
  ).toBe("Retained attendance notes");
  mocks.pending = true;
  view.rerender(<AttendanceForm />);
  expect(mocks.setAttendanceLocked).toHaveBeenLastCalledWith(true);
  expect(
    screen.getByLabelText("tutor.attendance.comments").closest("fieldset")
      ?.disabled,
  ).toBe(true);
  mocks.pending = false;
  mocks.success = true;
  mocks.error = "";
  view.rerender(<AttendanceForm />);
  expect(mocks.setAttendanceLocked).toHaveBeenLastCalledWith(true);
  expect(
    screen.getByLabelText("tutor.attendance.comments").closest("fieldset")
      ?.disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "tutor.attendance.submitAnother" }),
  );
  expect(mocks.reset).toHaveBeenCalledOnce();
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("tutor.attendance.comments")
      .value,
  ).toBe("");
});

it("keeps the saved receipt when refreshing totals fails", async () => {
  mocks.fetchMonthlyTotal.mockRejectedValueOnce(new Error("Refresh offline"));
  render(<AttendanceForm />);
  await act(async () => mocks.submitOnSuccess?.());
  expect(screen.getByRole("alert").textContent).toContain(
    "tutor.tasks.savedRefreshError",
  );
  expect(mocks.refresh).toHaveBeenCalledOnce();
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "tutor.tasks.retry" })),
  );
  expect(mocks.fetchMonthlyTotal).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps all five rating descriptions accessible in the compact matrix", () => {
  render(<AttendanceForm />);
  expect(screen.getAllByRole("radio")).toHaveLength(25);
  expect(
    screen.getByRole("radio", {
      name: "tutor.attendance.rating.ratingPreparedness: 3 · tutor.attendance.likert.3",
    }),
  ).toBeTruthy();
});

it("does not replace an attendance draft when a background query changes its schedule", () => {
  const view = render(<AttendanceForm />);
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), {
    target: { value: "pairing-1" },
  });
  fireEvent.change(screen.getByLabelText("tutor.attendance.start"), {
    target: { value: "14:20" },
  });
  mocks.scheduleConfirmed = false;
  view.rerender(<AttendanceForm />);
  expect(
    screen.getByLabelText<HTMLInputElement>("tutor.attendance.start").value,
  ).toBe("14:20");
});

describe("attendance form", () => {
  it("refreshes server-rendered totals after a successful save", async () => {
    render(<AttendanceForm />);

    expect(mocks.submitOnSuccess).toBeTypeOf("function");
    await act(async () => {
      await mocks.submitOnSuccess?.();
    });

    expect(mocks.fetchMonthlyTotal).toHaveBeenCalledWith(undefined, {
      staleTime: 0,
    });
    expect(mocks.invalidateSessions).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("associates the visible attendance labels with their controls", async () => {
    render(<AttendanceForm />);

    const pairing = screen.getByLabelText("tutor.attendance.pairing");
    expect(screen.getByLabelText("tutor.attendance.date")).toBeTruthy();
    expect(screen.getByLabelText("tutor.attendance.tutorStatus")).toBeTruthy();
    expect(screen.getByLabelText("tutor.attendance.start")).toBeTruthy();
    expect(screen.getByLabelText("tutor.attendance.end")).toBeTruthy();
    expect(screen.getByLabelText("tutor.attendance.comments")).toBeTruthy();

    fireEvent.change(pairing, { target: { value: "pairing-1" } });
    expect(
      await screen.findByLabelText("tutor.attendance.roomUsed"),
    ).toBeTruthy();
  });
});

it("leaves actual attendance times blank for an unscheduled assignment", () => {
  mocks.scheduleConfirmed = false;
  render(<AttendanceForm />);
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), {
    target: { value: "pairing-1" },
  });
  expect(
    screen.getByLabelText<HTMLInputElement>("tutor.attendance.start").value,
  ).toBe("");
  expect(
    screen.getByLabelText<HTMLInputElement>("tutor.attendance.end").value,
  ).toBe("");
  expect(screen.getByText("scheduling.actualTimesRequired")).toBeTruthy();
  expect(screen.queryByText(/15:30–16:30/)).toBeNull();
});
it("defaults confirmed schedules but clears assumed times when an unscheduled course is merged", () => {
  const { rerender } = render(<AttendanceForm />);
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), {
    target: { value: "pairing-1" },
  });
  const start = screen.getByLabelText<HTMLInputElement>(
    "tutor.attendance.start",
  );
  const end = screen.getByLabelText<HTMLInputElement>("tutor.attendance.end");
  expect(start.value).toBe("15:00");
  expect(end.value).toBe("16:00");
  mocks.mergeIds = ["pairing-2"];
  rerender(<AttendanceForm />);
  expect(start.value).toBe("");
  expect(end.value).toBe("");
  fireEvent.change(start, { target: { value: "14:00" } });
  fireEvent.change(end, { target: { value: "14:40" } });
  rerender(<AttendanceForm />);
  expect(start.value).toBe("14:00");
  expect(end.value).toBe("14:40");
});

it.each([false, true])(
  "retains entered merge times after a background schedule change (saved: %s)",
  (saved) => {
    mocks.mergeScheduleConfirmed = true;
    const view = render(<AttendanceForm />);
    fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), {
      target: { value: "pairing-1" },
    });
    mocks.mergeIds = ["pairing-2"];
    view.rerender(<AttendanceForm />);
    fireEvent.change(screen.getByLabelText("tutor.attendance.start"), {
      target: { value: "14:20" },
    });
    mocks.success = saved;
    mocks.mergeScheduleConfirmed = false;
    view.rerender(<AttendanceForm />);
    expect(
      screen.getByLabelText<HTMLInputElement>("tutor.attendance.start").value,
    ).toBe("14:20");
  },
);
