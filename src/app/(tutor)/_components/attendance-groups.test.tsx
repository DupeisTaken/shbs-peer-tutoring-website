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
      tutor: {
        myMonthlyTotal: { fetch: async () => undefined },
        mySessions: { invalidate: async () => undefined },
      },
    }),
    program: { features: { useQuery: () => ({ data: {} }) } },
    tutor: {
      myPairings: {
        useQuery: () => ({
          data: ["a", "b", ...(state.extraIndependent ? ["c"] : [])].map((id) => ({
            id,
            subject: state.splitRoster ? "Chemistry" : id === "a" ? "Mathematics" : "Physics",
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
            ].filter((student) => !state.splitRoster || student.tuteeId === (id === "a" ? "shared" : "second")),
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
  const { selectAttendance, setMergeIds } = useMerge();
  return (
    <>
      <button onClick={() => selectAttendance("group:g")}>Use saved group</button>
      <button onClick={() => setMergeIds(["c"])}>Merge independent Physics</button>
    </>
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
  state.incomplete = false;
  state.extraIndependent = false;
  state.primaryId = "a";
  state.splitRoster = false;
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
  expect(screen.getByText("Second Student")).toBeTruthy();
  await submit();
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
    pairingId: "a",
    mergePairingIds: undefined,
    tutees: [{ tuteeId: "shared", status: "PRESENT" }, { tuteeId: "second", status: "PRESENT" }],
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
  expect(screen.getByLabelText<HTMLSelectElement>("tutor.attendance.pairing").value).toBe("a");
});


it("keeps a legacy incomplete group discoverable but blocks combined attendance", async () => {
  state.incomplete = true;
  render(tree());
  const select = screen.getByLabelText<HTMLSelectElement>("tutor.attendance.pairing");
  const option = select.querySelector<HTMLOptionElement>('option[value="group:g"]')!;
  expect(option.disabled).toBe(true);
  expect(option.textContent).toContain("pairingGroups.status.needsRepair");
  chooseGroup();
  await submit();
  expect(screen.getByRole("alert").textContent).toContain("pairingGroups.needsRepair");
  expect(state.mutate).not.toHaveBeenCalled();
});


it("blocks a locally complete one-off merge containing a member of a saved group needing repair", async () => {
  state.incomplete = true;
  state.extraIndependent = true;
  render(tree());
  // Physics rows b/c have the same full roster and pass local coverage. The
  // existing Mathematics/Physics saved group containing b still needs repair.
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), { target: { value: "b" } });
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Merge independent Physics" }));
  expect(screen.getByRole("alert").textContent).toContain("pairingGroups.needsRepair");
  await submit();
  expect(state.mutate).not.toHaveBeenCalled();
});

it("preserves zero-merge individual attendance from a saved group needing repair", async () => {
  state.incomplete = true;
  render(tree());
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), { target: { value: "b" } });
  expect(screen.queryByRole("alert")).toBeNull();
  await submit();
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({ pairingId: "b", mergePairingIds: undefined });
});


it("retains the original primary and every attendance row when a saved group's primary changes in the background", async () => {
  state.splitRoster = true;
  const view = render(tree());
  chooseGroup();
  fireEvent.change(screen.getByLabelText("tutor.attendance.start"), { target: { value: "14:30" } });
  state.primaryId = "b";
  view.rerender(tree());
  expect(screen.getByText("Shared Student")).toBeTruthy();
  expect(screen.getByText("Second Student")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("tutor.attendance.start").value).toBe("14:30");
  await submit();
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
    pairingId: "a", mergePairingIds: ["b"], startMin: 870,
    tutees: [{ tuteeId: "shared", status: "PRESENT" }, { tuteeId: "second", status: "PRESENT" }],
  });
});

it("uses the newly chosen individual pairing after a background primary change instead of retaining another selection", async () => {
  state.splitRoster = true;
  const view = render(tree());
  chooseGroup();
  state.primaryId = "b";
  view.rerender(tree());
  fireEvent.change(screen.getByLabelText("tutor.attendance.pairing"), { target: { value: "b" } });
  expect(screen.queryByText("Shared Student")).toBeNull();
  expect(screen.getByText("Second Student")).toBeTruthy();
  await submit();
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
  expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
    pairingId: "b", mergePairingIds: undefined,
    tutees: [{ tuteeId: "second", status: "PRESENT" }],
  });
});
