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
import messages from "../../../../../messages/en.json";
import TimeSlotsPage from "./page";

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  onSuccess: null as null | (() => Promise<void>),
  onSettled: null as null | (() => void),
}));
vi.mock("~/app/_components/read-only", () => ({ useReadOnly: () => false }));
vi.mock("~/app/_components/ui/action-review", () => ({
  useActionReview: () => ({
    dialog: null,
    blocked: () => false,
    open: vi.fn(),
  }),
}));
vi.mock("~/trpc/react", () => {
  const target = { invalidate: state.invalidate };
  return {
    api: {
      useUtils: () => ({
        admin: { timeSlots: target, pairings: target },
        tutor: { myPairings: target, schedule: target },
        student: { me: target },
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
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
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
  state.invalidate.mockReset().mockResolvedValue(undefined);
  state.mutate.mockImplementation(() => {
    void state.onSuccess?.().finally(() => state.onSettled?.());
  });
});
afterEach(cleanup);
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {children}
  </NextIntlClientProvider>
);

it("recovers a committed catalog allocation using reads only and locks further edits until synchronized", async () => {
  state.invalidate.mockRejectedValueOnce(new Error("Schedule read failed"));
  render(<TimeSlotsPage />, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: "Edit: Monday" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: messages.admin.timeslots.save,
    }),
  );
  await screen.findByText(messages.roomAllocation.savedRefreshFailed);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Edit: Monday" })
      .disabled,
  ).toBe(true);
  expect(state.invalidate).toHaveBeenCalledTimes(7);
  fireEvent.click(
    screen.getByRole("button", { name: messages.roomAllocation.retryRefresh }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Edit: Monday" })
        .disabled,
    ).toBe(false),
  );
  expect(state.invalidate).toHaveBeenCalledTimes(14);
  expect(state.mutate).toHaveBeenCalledTimes(1);
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
});
