// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../messages/en.json";
import { TutorRoomSchedule } from "./tutor-room-schedule";

const state = vi.hoisted(() => ({
  missing: false,
  error: null as null | { message: string; data?: { code: string } },
  refetch: vi.fn(),
}));
const initial: Parameters<typeof TutorRoomSchedule>[0]["initialData"] = {
  rooms: [],
  slots: [],
  pairings: [],
  blocks: [],
  myTutorId: "owned-tutor",
};
vi.mock("~/trpc/react", () => ({
  api: {
    tutor: {
      schedule: {
        useQuery: () => ({
          data: state.missing ? undefined : initial,
          error: state.error,
          isSuccess: !state.missing && !state.error,
          isLoading: state.missing && !state.error,
          refetch: state.refetch,
        }),
      },
    },
  },
}));
vi.mock("~/app/_components/room-grid", () => ({
  RoomGrid: () => <div>Authorized cached schedule</div>,
}));
const page = () => (
  <NextIntlClientProvider locale="en" messages={en}>
    <TutorRoomSchedule initialData={initial} />
  </NextIntlClientProvider>
);
beforeEach(() => {
  state.missing = false;
  state.error = null;
  state.refetch.mockReset();
});
afterEach(cleanup);

it("conceals cached private occupancy on denial and restores it only after authorized recovery", async () => {
  const view = render(page());
  expect(screen.getByText("Authorized cached schedule")).toBeTruthy();
  state.error = { message: "Denied", data: { code: "FORBIDDEN" } };
  view.rerender(page());
  expect(screen.queryByText("Authorized cached schedule")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: en.roomAllocation.retryRefresh }),
  );
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(screen.queryByText("Authorized cached schedule")).toBeNull();
  state.error = null;
  view.rerender(page());
  await waitFor(() =>
    expect(screen.getByText("Authorized cached schedule")).toBeTruthy(),
  );
});
it("retains useful cached occupancy for a transient read error without mounting a write", () => {
  state.error = { message: "Temporary read failure" };
  render(page());
  expect(screen.getByText("Authorized cached schedule")).toBeTruthy();
  expect(screen.getByText(en.roomAllocation.readFailed)).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: en.roomAllocation.retryRefresh }),
  );
  expect(state.refetch).toHaveBeenCalledOnce();
});
it("does not present a missing initial query as empty room availability", () => {
  state.missing = true;
  render(page());
  expect(screen.queryByText("Authorized cached schedule")).toBeNull();
  expect(screen.getByText(en.roomAllocation.loading)).toBeTruthy();
});
