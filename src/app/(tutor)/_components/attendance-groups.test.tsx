// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AttendanceForm } from "./attendance-form";
import { attendanceOccurrence } from "./attendance-test-data";
import type { AgendaCohort } from "~/app/_components/session-agenda";
vi.mock("~/app/_components/profile-dialog", () => ({
  ProfileDialog: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));
const state = vi.hoisted(() => ({
  grouped: true,
  incomplete: false,
  extraIndependent: false,
  primaryId: "a",
  splitRoster: false,
  mutate: vi.fn(),
  pending: false,
  saved: false,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTimeZone: () => "Asia/Shanghai",
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/app/_components/confirm-dialog", () => ({
  useDialog: () => ({ confirm: vi.fn(), dialog: null }),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      sessionPlanning: { agenda: { invalidate: async () => undefined } },
      tutor: {
        myMonthlyTotal: { fetch: async () => undefined },
        mySessions: { invalidate: async () => undefined },
      },
    }),
    program: { features: { useQuery: () => ({ data: {} }) } },
    tutor: {
      myPairings: {
        useQuery: () => ({
          data: ["a", "b", ...(state.extraIndependent ? ["c"] : [])].map(
            (id) => ({
              id,
              subject: state.splitRoster
                ? "Chemistry"
                : id === "a"
                  ? "Mathematics"
                  : "Physics",
              groupId: state.grouped && id !== "c" ? "g" : null,
              group: { primaryPairingId: state.primaryId },
              dayOfWeek: 1,
              startMin: 900,
              endMin: 960,
              timeSlotId: "slot",
              scheduleConfirmed: true,
              roomId: "room",
              room: { id: "room", name: "A101" },
              tutees: [
                {
                  tuteeId: "shared",
                  tutee: { englishName: "Shared Student", user: null },
                },
                ...(!state.incomplete || id !== "a"
                  ? [
                      {
                        tuteeId: "second",
                        tutee: { englishName: "Second Student", user: null },
                      },
                    ]
                  : []),
              ].filter(
                (student) =>
                  !state.splitRoster ||
                  student.tuteeId === (id === "a" ? "shared" : "second"),
              ),
            }),
          ),
        }),
      },
      myTuteeDiscipline: { useQuery: () => ({ data: [] }) },
      rooms: { useQuery: () => ({ data: [{ id: "room", name: "A101" }] }) },
      schedule: { useQuery: () => ({ data: { pairings: [], blocks: [] } }) },
      submitAttendance: {
        useMutation: () => ({
          mutate: state.mutate,
          isPending: state.pending,
          isSuccess: state.saved,
          reset: vi.fn(),
        }),
      },
    },
  },
}));

beforeEach(() => {
  state.mutate.mockReset();
  state.pending = false;
  state.saved = false;
});
afterEach(cleanup);
const tree = (occurrence: AgendaCohort = attendanceOccurrence) => (
  <AttendanceForm occurrence={occurrence} open onClose={vi.fn()} />
);
async function submit() {
  fireEvent.change(screen.getByLabelText("tutor.attendance.comments"), {
    target: { value: "Synthetic cohort attendance" },
  });
  for (const name of [
    "Preparedness",
    "Participation",
    "Understanding",
    "Behavior",
    "Progress",
  ])
    fireEvent.click(
      screen.getByRole("radio", {
        name: `tutor.attendance.rating.rating${name}: 4 · tutor.attendance.likert.4`,
      }),
    );
  await act(async () =>
    fireEvent.submit(
      screen.getByLabelText("tutor.attendance.comments").closest("form")!,
    ),
  );
}
it("submits the exact dated cohort and version, without selecting a moved learner or arbitrary pairing merge", async () => {
  render(tree());
  await submit();
  await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
  expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
    cohortId: "cohort-synthetic",
    expectedCohortVersion: 7,
    pairingId: "a",
    tutees: [{ tuteeId: "remaining", status: "PRESENT" }],
  });
  expect(state.mutate.mock.calls[0]?.[0]).not.toHaveProperty("mergePairingIds");
});
it("retains the original cohort roster when another saved group or assignment changes", async () => {
  const view = render(tree());
  view.rerender(
    tree({
      ...attendanceOccurrence,
      pairingIds: ["b"],
      primaryPairingId: "b",
      version: 8,
      tutees: [{ id: "moved", name: "Moved Learner" }],
    }),
  );
  expect(screen.getByText("Remaining Learner")).toBeTruthy();
  expect(screen.queryByText("Moved Learner")).toBeNull();
  await submit();
  await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
  expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
    expectedCohortVersion: 7,
    pairingId: "a",
  });
});
it("does not submit a future, cancelled or otherwise ineligible cohort", async () => {
  render(tree({ ...attendanceOccurrence, canRecordAttendance: false }));
  await submit();
  expect(state.mutate).not.toHaveBeenCalled();
});
it("records a planned midnight boundary as minute 1440 rather than an invalid reversed interval", async () => {
  render(tree({ ...attendanceOccurrence, startMin: 1395, endMin: 1440 }));
  expect(
    screen.getByLabelText<HTMLInputElement>("tutor.attendance.end").value,
  ).toBe("00:00");
  await submit();
  await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
  expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
    startMin: 1395,
    endMin: 1440,
  });
});
