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
import { MergeProvider, useMerge } from "./merge-context";
const state = vi.hoisted(() => ({
  grouped: true,
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
      tutor: {
        myMonthlyTotal: { fetch: async () => undefined },
        mySessions: { invalidate: async () => undefined },
      },
    }),
    program: { features: { useQuery: () => ({ data: {} }) } },
    tutor: {
      myPairings: {
        useQuery: () => ({
          data: ["a", "b"].map((id) => ({
            id,
            subject: id === "a" ? "Mathematics" : "Physics",
            groupId: state.grouped ? "g" : null,
            group: { primaryPairingId: "a" },
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
              ...(id === "b"
                ? [
                    {
                      tuteeId: "second",
                      tutee: { englishName: "Second Student", user: null },
                    },
                  ]
                : []),
            ],
          })),
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
function CatalogueAction() {
  const { selectAttendance } = useMerge();
  return (
    <button onClick={() => selectAttendance("group:g")}>Use saved group</button>
  );
}
const tree = () => (
  <MergeProvider>
    <CatalogueAction />
    <AttendanceForm />
  </MergeProvider>
);
beforeEach(() => {
  state.grouped = true;
  state.mutate.mockReset();
  state.pending = false;
  state.saved = false;
});
afterEach(cleanup);
function chooseGroup() {
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), {
    target: { value: "group:g" },
  });
}
async function submit() {
  fireEvent.change(screen.getByLabelText("tutor.attendance.comments"), {
    target: { value: "Synthetic combined attendance" },
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
it("prefills a saved group with each distinct student once and submits real pairing IDs", async () => {
  render(tree());
  chooseGroup();
  expect(screen.getAllByText("Shared Student")).toHaveLength(1);
  expect(screen.getAllByText("Second Student")).toHaveLength(1);
  expect(
    screen.getByLabelText<HTMLInputElement>("tutor.attendance.start").value,
  ).toBe("15:00");
  await submit();
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
    pairingId: "a",
    mergePairingIds: ["b"],
    tutees: [
      { tuteeId: "shared", status: "PRESENT" },
      { tuteeId: "second", status: "PRESENT" },
    ],
  });
});
it("lets a grouped subject be recorded independently for one attendance", async () => {
  render(tree());
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), {
    target: { value: "a" },
  });
  expect(screen.queryByText("Second Student")).toBeNull();
  await submit();
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
    pairingId: "a",
    mergePairingIds: undefined,
    tutees: [{ tuteeId: "shared", status: "PRESENT" }],
  });
});
it("retains a composed attendance snapshot when a saved group is split in the background", async () => {
  const view = render(tree());
  chooseGroup();
  fireEvent.change(screen.getByLabelText("tutor.attendance.start"), {
    target: { value: "14:30" },
  });
  state.grouped = false;
  view.rerender(tree());
  expect(
    screen.getByLabelText<HTMLInputElement>("tutor.attendance.start").value,
  ).toBe("14:30");
  expect(screen.getByText("Second Student")).toBeTruthy();
  await submit();
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
    pairingId: "a",
    mergePairingIds: ["b"],
    startMin: 870,
  });
});
it("uses the explicit catalogue action to start the selected group draft", () => {
  render(tree());
  fireEvent.click(screen.getByRole("button", { name: "Use saved group" }));
  expect(
    screen.getByLabelText<HTMLSelectElement>("tutor.attendance.pairing").value,
  ).toBe("group:g");
  expect(screen.getByText("Second Student")).toBeTruthy();
});
it("does not replace a pending or saved attendance through a catalogue action", () => {
  const view = render(tree());
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), {
    target: { value: "a" },
  });
  state.pending = true;
  view.rerender(tree());
  fireEvent.click(screen.getByRole("button", { name: "Use saved group" }));
  expect(screen.queryByText("Second Student")).toBeNull();
});
