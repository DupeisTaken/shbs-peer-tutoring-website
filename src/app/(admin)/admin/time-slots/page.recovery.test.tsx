/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import messages from "../../../../../messages/en.json";
import TimeSlotsPage from "./page";

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  create: vi.fn(),
  reviewOpen: vi.fn(),
  invalidate: vi.fn(),
  onCreateSuccess: null as null | (() => Promise<void>),
  onCreateSettled: null as null | (() => void),
  onSuccess: null as null | (() => Promise<void>),
  onSettled: null as null | (() => void),
}));
vi.mock("~/app/_components/read-only", () => ({ useReadOnly: () => false }));
vi.mock("~/app/_components/ui/action-review", () => ({
  useActionReview: () => ({
    dialog: null,
    blocked: () => false,
    open: state.reviewOpen,
  }),
}));
vi.mock("~/trpc/react", () => {
  const target = { invalidate: state.invalidate };
  return {
    api: {
      useUtils: () => ({
        admin: {
          timeSlots: target,
          pairings: target,
          assignmentWorkloads: target,
        },
        tutor: {
          myPairings: target,
          schedule: target,
          workloadPreference: target,
        },
        student: { me: target },
        studentWorkflow: { mine: target },
        pairingGroups: { mine: target },
        notification: { list: target, unreadCount: target },
      }),
      admin: {
        timeSlots: {
          useQuery: () => ({
            data: [
              {
                id: "slot-1",
                label: "Monday",
                dayOfWeek: 1,
                startMin: 900,
                endMin: 960,
                active: true,
              },
            ],
          }),
        },
        createTimeSlot: {
          useMutation: (options: {
            onSuccess: () => Promise<void>;
            onSettled: () => void;
          }) => {
            state.onCreateSuccess = options.onSuccess;
            state.onCreateSettled = options.onSettled;
            return { mutate: state.create, isPending: false };
          },
        },
        updateTimeSlot: {
          useMutation: (options: {
            onSuccess: () => Promise<void>;
            onSettled: () => void;
          }) => {
            state.onSuccess = options.onSuccess;
            state.onSettled = options.onSettled;
            return { mutate: state.mutate, isPending: false, reset: vi.fn() };
          },
        },
        deleteTimeSlot: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      },
    },
  };
});
beforeEach(() => {
  state.mutate.mockReset();
  state.reviewOpen.mockReset();
  state.create.mockReset().mockImplementation(() => {
    void state.onCreateSuccess?.().finally(() => state.onCreateSettled?.());
  });
  state.invalidate.mockReset().mockResolvedValue(undefined);
  state.mutate.mockImplementation(() => {
    void state.onSuccess?.().finally(() => state.onSettled?.());
  });
});
afterEach(cleanup);
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  </QueryClientProvider>
);

it("recovers a committed catalog allocation using reads only and locks further edits until synchronized", async () => {
  state.invalidate.mockRejectedValueOnce(new Error("Schedule read failed"));
  render(<TimeSlotsPage />, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: "Edit: Monday" }));
  const dialog = screen.getByRole("dialog");
  const label = within(dialog).getByRole<HTMLInputElement>("textbox");
  fireEvent.change(label, { target: { value: "Accepted Monday" } });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: messages.admin.timeslots.save,
    }),
  );
  await screen.findByText(messages.roomAllocation.savedRefreshFailed);
  // Accepted writes retain their editor and draft while recovery only repeats reads.
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(label.value).toBe("Accepted Monday");
  expect(label.matches(":disabled")).toBe(true);
  const save = within(dialog).getByRole<HTMLButtonElement>("button", {
    name: messages.admin.timeslots.save,
  });
  expect(save.disabled).toBe(true);
  fireEvent.click(save);
  expect(state.mutate).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Edit: Monday" })
      .disabled,
  ).toBe(true);
  expect(state.invalidate).toHaveBeenCalledTimes(11);
  // Closing the accepted editor must not expose a destructive write while its
  // schedule/allocation readers are still unsynchronized.
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: messages.admin.timeslots.cancel,
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.admin.timeslots.delete,
    }).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: messages.roomAllocation.retryRefresh }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Edit: Monday" })
        .disabled,
    ).toBe(false),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.invalidate).toHaveBeenCalledTimes(22);
  expect(state.mutate).toHaveBeenCalledTimes(1);
  expect(state.create).not.toHaveBeenCalled();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: messages.admin.timeslots.delete,
    }).disabled,
  ).toBe(false);
});

it("retains a committed creation until read-only refresh succeeds without creating twice", async () => {
  state.invalidate.mockRejectedValueOnce(new Error("Group read failed"));
  render(<TimeSlotsPage />, { wrapper });
  fireEvent.click(
    screen.getByRole("button", { name: messages.admin.timeslots.addSlot }),
  );
  const dialog = screen.getByRole("dialog");
  const label = within(dialog).getByRole<HTMLInputElement>("textbox");
  fireEvent.change(label, { target: { value: "Accepted new slot" } });
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: messages.admin.timeslots.addSlot,
    }),
  );
  await within(dialog).findByText(messages.roomAllocation.savedRefreshFailed);
  expect(label.value).toBe("Accepted new slot");
  expect(label.matches(":disabled")).toBe(true);
  // Programmatic form submission must also respect the accepted-write lock.
  fireEvent.submit(label.closest("form")!);
  expect(state.create).toHaveBeenCalledTimes(1);
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: messages.roomAllocation.retryRefresh,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: messages.admin.timeslots.addSlot }),
  );
  expect(
    within(screen.getByRole("dialog")).getByRole<HTMLInputElement>("textbox")
      .value,
  ).toBe("");
});

it("admits only one same-tick catalog save", () => {
  state.mutate.mockImplementation(() => undefined);
  render(<TimeSlotsPage />, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: "Edit: Monday" }));
  const save = within(screen.getByRole("dialog")).getByRole("button", {
    name: messages.admin.timeslots.save,
  });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(state.mutate).toHaveBeenCalledTimes(1);
  // No pending rerender is supplied by this mock: the feature admission ref
  // must also prevent a second destructive review in that same tick.
  fireEvent.click(
    screen.getByRole("button", {
      name: messages.admin.timeslots.delete,
    }),
  );
  expect(state.reviewOpen).not.toHaveBeenCalled();
});
