/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  scheduleConfirmed: true,
  locale: "en",
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
  useLocale: () => mocks.locale,
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
      sessionPlanning: { agenda: { invalidate: async () => undefined } },
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
import { attendanceOccurrence } from "./attendance-test-data";
import type { AgendaCohort } from "~/app/_components/session-agenda";
vi.mock("~/app/_components/profile-dialog", () => ({
  ProfileDialog: ({
    children,
    pending,
    onClose,
  }: {
    children: React.ReactNode;
    pending: boolean;
    onClose: () => void;
  }) => (
    <div role="dialog">
      {children}
      <button disabled={pending} onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  mocks.refresh.mockReset();
  mocks.fetchMonthlyTotal.mockClear();
  mocks.invalidateSessions.mockClear();
  mocks.submitOnSuccess = undefined;
  mocks.scheduleConfirmed = true;
  mocks.locale = "en";
  mocks.mergeScheduleConfirmed = false;
  mocks.mergeIds = [];
  mocks.pending = false;
  mocks.success = false;
  mocks.error = "";
  mocks.reset.mockClear();
  mocks.setAttendanceLocked.mockClear();
});

const tree = (open = true, occurrence: AgendaCohort = attendanceOccurrence) => (
  <AttendanceForm occurrence={occurrence} open={open} onClose={vi.fn()} />
);
it("binds attendance to the exact occurrence and shows only actual tutor states", () => {
  render(tree());
  expect(screen.queryByLabelText("tutor.attendance.pairing")).toBeNull();
  expect(screen.queryByLabelText("tutor.attendance.date")).toBeNull();
  expect(screen.getByText("Remaining Learner")).toBeTruthy();
  const select = screen.getByLabelText<HTMLSelectElement>(
    "tutor.attendance.tutorStatus",
  );
  expect([...select.options].map((option) => option.value)).toEqual([
    "PRESENT",
    "TUTOR_ABSENT",
  ]);
  expect(
    screen.getByText("Mathematics + Physics · 2026-10-26 · 15:00–15:45"),
  ).toBeTruthy();
});
it("retains notes and actual duration when its dialog closes and reopens", () => {
  const view = render(tree());
  fireEvent.change(screen.getByLabelText("tutor.attendance.comments"), {
    target: { value: "Retained synthetic notes" },
  });
  fireEvent.change(screen.getByLabelText("tutor.attendance.end"), {
    target: { value: "16:00" },
  });
  view.rerender(tree(false));
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(tree());
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("tutor.attendance.comments")
      .value,
  ).toBe("Retained synthetic notes");
  expect(
    screen.getByLabelText<HTMLInputElement>("tutor.attendance.end").value,
  ).toBe("16:00");
});
it("does not replace its roster/version snapshot on a background occurrence update", () => {
  const view = render(tree());
  fireEvent.change(screen.getByLabelText("tutor.attendance.start"), {
    target: { value: "14:20" },
  });
  view.rerender(
    tree(true, {
      ...attendanceOccurrence,
      version: 8,
      tutees: [{ id: "other", name: "Different Learner" }],
    }),
  );
  expect(screen.getByText("Remaining Learner")).toBeTruthy();
  expect(screen.queryByText("Different Learner")).toBeNull();
  expect(
    screen.getByLabelText<HTMLInputElement>("tutor.attendance.start").value,
  ).toBe("14:20");
});
it("keeps extra and rescheduled provenance together without allowing either to be selected", () => {
  render(
    tree(true, { ...attendanceOccurrence, kind: "EXTRA", rescheduled: true }),
  );
  expect(screen.getByText("extra")).toBeTruthy();
  expect(screen.getByText("rescheduled")).toBeTruthy();
  expect(screen.queryByRole("option", { name: "extra" })).toBeNull();
});
it("keeps a failed draft editable and freezes pending and accepted evidence", () => {
  const view = render(tree());
  fireEvent.change(screen.getByLabelText("tutor.attendance.comments"), {
    target: { value: "Retained notes" },
  });
  mocks.error = "Synthetic rejection";
  view.rerender(tree());
  expect(screen.getByRole("alert").textContent).toBe(mocks.error);
  expect(
    screen.getByLabelText<HTMLTextAreaElement>("tutor.attendance.comments")
      .value,
  ).toBe("Retained notes");
  mocks.pending = true;
  view.rerender(tree());
  expect(
    screen.getByLabelText("tutor.attendance.comments").closest("fieldset")
      ?.disabled,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Close" }).disabled,
  ).toBe(true);
  mocks.pending = false;
  mocks.success = true;
  mocks.error = "";
  view.rerender(tree());
  expect(
    screen.getByLabelText("tutor.attendance.comments").closest("fieldset")
      ?.disabled,
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: "tutor.attendance.submitAnother" }),
  ).toBeNull();
});
it("keeps a saved receipt through read-only totals recovery", async () => {
  mocks.fetchMonthlyTotal.mockRejectedValueOnce(new Error("Refresh offline"));
  render(tree());
  await act(async () => mocks.submitOnSuccess?.());
  expect(screen.getByRole("alert").textContent).toContain(
    "tutor.tasks.savedRefreshError",
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "tutor.tasks.retry" })),
  );
  expect(mocks.fetchMonthlyTotal).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});
it("keeps the five rating meanings and labelled actual attendance fields", () => {
  render(tree());
  expect(screen.getAllByRole("radio")).toHaveLength(25);
  for (const value of [1, 2, 3, 4, 5])
    expect(
      screen.getAllByText(`${value} · tutor.attendance.likert.${value}`),
    ).toHaveLength(5);
  for (const key of ["tutorStatus", "start", "end", "comments", "roomUsed"])
    expect(screen.getByLabelText(`tutor.attendance.${key}`)).toBeTruthy();
});
