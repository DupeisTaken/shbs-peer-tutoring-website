/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
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
    mergeIds: [],
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
              subject: "Mathematics",
              startMin: 900,
              endMin: 960,
              room: { id: "room-1", name: "A101" },
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
