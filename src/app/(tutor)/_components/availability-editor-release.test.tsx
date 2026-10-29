// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../../../messages/en.json";
import { AvailabilityEditor } from "./availability-editor";

const state = vi.hoisted(() => ({
  save: vi.fn(),
  refetch: vi.fn(),
  pairings: vi.fn(),
  schedule: vi.fn(),
  roster: vi.fn(),
  agenda: vi.fn(),
  groups: vi.fn(),
  workload: vi.fn(),
  managementWorkload: vi.fn(),
  accepted: undefined as
    undefined | ((result: { released: number }) => Promise<void>),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      tutor: {
        myPairings: { invalidate: state.pairings },
        schedule: { invalidate: state.schedule },
        workloadPreference: { invalidate: state.workload },
      },
      studentWorkflow: { tutorRoster: { invalidate: state.roster } },
      sessionPlanning: { agenda: { invalidate: state.agenda } },
      pairingGroups: { mine: { invalidate: state.groups } },
      admin: { assignmentWorkloads: { invalidate: state.managementWorkload } },
    }),
    tutor: {
      myAvailability: {
        useQuery: () => ({
          data: {
            slots: [
              {
                id: "monday",
                label: "Monday",
                dayOfWeek: 1,
                startMin: 960,
                endMin: 1005,
              },
            ],
            selectedSlotIds: ["monday"],
          },
          refetch: state.refetch,
          isSuccess: true,
          isFetching: false,
        }),
      },
      setAvailability: {
        useMutation: (options: {
          onSuccess: (result: { released: number }) => Promise<void>;
        }) => {
          state.accepted = options.onSuccess;
          return {
            mutate: state.save,
            reset: vi.fn(),
            isPending: false,
            isSuccess: false,
            error: null,
          };
        },
      },
    },
  },
}));
const readers = () => [
  state.pairings,
  state.schedule,
  state.roster,
  state.agenda,
  state.groups,
  state.workload,
  state.managementWorkload,
];
beforeEach(() => {
  vi.clearAllMocks();
  for (const reader of [state.refetch, ...readers()])
    reader.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
function mountAndSave() {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Shanghai">
      <AvailabilityEditor />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Monday (16:00–16:45)" }));
  fireEvent.click(
    screen.getByRole("button", { name: en.tutor.availability.save }),
  );
  expect(state.save).toHaveBeenCalledExactlyOnceWith({ slotIds: [] });
}

it("refreshes affected mounted pairing, roster, agenda and workload readers after a release", async () => {
  mountAndSave();
  await act(async () => state.accepted!({ released: 1 }));
  expect(state.refetch).toHaveBeenCalledExactlyOnceWith({ throwOnError: true });
  for (const reader of readers()) expect(reader).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(en.tutor.availability.refreshFailed)).toBeNull();
  expect(state.save).toHaveBeenCalledTimes(1);
});

it("does not refresh enrollment readers for a save without released assignments", async () => {
  mountAndSave();
  await act(async () => state.accepted!({ released: 0 }));
  expect(state.refetch).toHaveBeenCalledTimes(1);
  for (const reader of readers()) expect(reader).not.toHaveBeenCalled();
});

it("retains read-only recovery across a post-release agenda failure without replaying availability", async () => {
  state.agenda.mockRejectedValueOnce(
    new Error("Synthetic agenda refresh failure"),
  );
  mountAndSave();
  await act(async () => state.accepted!({ released: 1 }));
  expect(screen.getByText(en.tutor.availability.refreshFailed)).toBeTruthy();
  const monday = screen.getByRole("button", { name: "Monday (16:00–16:45)" });
  expect(monday.hasAttribute("disabled")).toBe(true);
  expect(monday.getAttribute("aria-pressed")).toBe("false");
  expect(
    screen
      .getByRole("button", { name: en.uiPatterns.cancel })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: en.uiPatterns.retry }));
  await waitFor(() =>
    expect(screen.queryByText(en.tutor.availability.refreshFailed)).toBeNull(),
  );
  for (const reader of readers()) expect(reader).toHaveBeenCalledTimes(2);
  expect(state.refetch).toHaveBeenCalledTimes(2);
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(monday.hasAttribute("disabled")).toBe(false);
});

it("waits for every affected read before exposing the saved-but-refresh-failed boundary", async () => {
  state.pairings.mockRejectedValueOnce(
    new Error("Synthetic pairing refresh failure"),
  );
  let resolveAgenda!: () => void;
  state.agenda.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      resolveAgenda = resolve;
    }),
  );
  mountAndSave();
  let completing!: Promise<void>;
  act(() => {
    completing = state.accepted!({ released: 1 });
  });
  expect(screen.queryByText(en.tutor.availability.refreshFailed)).toBeNull();
  expect(
    screen
      .getByRole("button", { name: en.tutor.availability.saving })
      .hasAttribute("disabled"),
  ).toBe(true);
  await act(async () => {
    resolveAgenda();
    await completing;
  });
  expect(screen.getByText(en.tutor.availability.refreshFailed)).toBeTruthy();
  expect(state.save).toHaveBeenCalledTimes(1);
});
