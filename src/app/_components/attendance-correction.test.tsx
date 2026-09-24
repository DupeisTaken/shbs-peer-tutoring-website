// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rooms: undefined as { id: string; name: string }[] | undefined,
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      admin: {
        sessions: { invalidate: vi.fn() },
        auditLog: { invalidate: vi.fn() },
      },
      corrections: { attendance: { invalidate: vi.fn() } },
    }),
    corrections: {
      attendance: {
        useQuery: () => ({
          data: [
            {
              id: "session",
              mergeGroupId: null,
              updatedAt: new Date("2026-09-07"),
              date: new Date("2026-09-07"),
              startMin: 930,
              endMin: 990,
              tutorStatus: "PRESENT",
              online: false,
              actualRoomId: "second-room",
              tutees: [],
              tutorAbsentReason: null,
              comments: "",
              ratingPreparedness: 4,
              ratingParticipation: 4,
              ratingUnderstanding: 4,
              ratingBehavior: 4,
              ratingProgress: 4,
            },
          ],
        }),
      },
      correctAttendance: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
      },
    },
    admin: {
      rooms: {
        useQuery: () => ({ data: state.rooms, isLoading: !state.rooms }),
      },
    },
  },
}));
import { AttendanceCorrection } from "./attendance-correction";

afterEach(() => {
  cleanup();
  state.rooms = undefined;
});
it("waits for room options before initializing the recorded room selection", () => {
  const view = render(<AttendanceCorrection id="session" />);
  expect(screen.queryByRole("combobox", { name: "room" })).toBeNull();
  state.rooms = [
    { id: "first-room", name: "A101" },
    { id: "second-room", name: "B201" },
  ];
  view.rerender(<AttendanceCorrection id="session" />);
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "room" }).value,
  ).toBe("second-room");
});
