/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  scheduleConfirmed: true,
  mergeIds: [] as string[],
  invalidateMonthlyTotal: vi.fn(async () => undefined),
  invalidateSessions: vi.fn(async () => undefined),
  submitOnSuccess: undefined as undefined | (() => Promise<void>),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("next-intl", () => ({
  useTimeZone: () => "Asia/Shanghai",
  useFormatter: () => ({ dateTime: (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", ...options }).format(date) }),
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
  }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tutor: {
        myMonthlyTotal: { invalidate: mocks.invalidateMonthlyTotal },
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
            { id: "pairing-2", subject: "Mathematics", dayOfWeek: 1, scheduleConfirmed: false, startMin: 930, endMin: 990, room: null, tutees: [] },
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
            isPending: false,
            isSuccess: false,
            error: null,
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
  mocks.invalidateMonthlyTotal.mockClear();
  mocks.invalidateSessions.mockClear();
  mocks.submitOnSuccess = undefined;
  mocks.scheduleConfirmed = true;
  mocks.mergeIds = [];
});

describe("attendance form", () => {
  it("refreshes server-rendered totals after a successful save", async () => {
    render(<AttendanceForm />);

    expect(mocks.submitOnSuccess).toBeTypeOf("function");
    await act(async () => {
      await mocks.submitOnSuccess?.();
    });

    expect(mocks.invalidateMonthlyTotal).toHaveBeenCalledOnce();
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
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), { target: { value: "pairing-1" } });
  expect((screen.getByLabelText<HTMLInputElement>("tutor.attendance.start")).value).toBe("");
  expect((screen.getByLabelText<HTMLInputElement>("tutor.attendance.end")).value).toBe("");
  expect(screen.getByText("scheduling.actualTimesRequired")).toBeTruthy();
  expect(screen.queryByText(/15:30–16:30/)).toBeNull();
});
it("defaults confirmed schedules but clears assumed times when an unscheduled course is merged", () => {
  const { rerender } = render(<AttendanceForm />);
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), { target: { value: "pairing-1" } });
  const start = screen.getByLabelText<HTMLInputElement>("tutor.attendance.start");
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
